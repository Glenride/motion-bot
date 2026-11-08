#!/usr/bin/env python3
"""Motion Bot — LLM Director for narrated storyboards (v2.1).

The deterministic Director (harness_director.py) splits the hook on
clause breaks and searches stock with literal keywords. It is
reliable and it works when the Studio is down — and it stays the
fallback. The LLM Director is the creativity layer on top of it:
given the same task, the Studio model picks metaphor-aware,
concrete visuals per scene (freight / ports / warehouses for a
supply-chain hook, never a bare "chain").

Model-gated, never hard-depended on. Endpoints are tried in order
— the iMac socat proxy first, the direct tailnet URL second —
and ANY failure (timeout, bad JSON, failed word validation, proxy
down, model missing) returns (None, info) so the caller falls back
to the deterministic Director with no error surfaced to the task.
The proxy was DOWN on 2026-10-27 and back on 2026-10-28: this
module must assume it can disappear again.

WHERE THE CALL RUNS: the VM cannot reach the proxy or the Studio
directly — the sandbox egress closes those connections ("Remote
end closed connection without response", verified 2026-10-29).
The model call therefore runs ON THE IMAC via SSH
(run_llm_via_imac): the watcher rsyncs this file + concepts.py +
harness_director.py + motion_taste.md to the iMac and runs this module's __main__
there, where the proxy URL is reachable. try_llm_storyboard is
the pure logic used by that iMac-side run; it is NOT callable
from the VM.

Strict output rules, enforced in code, not just in the prompt:
  * the storyboard schema is exactly build_narrated_storyboard's
    (version / narrated / hook / lengthSeconds / scenes with
    voiceoverText + visualKeywords + concepts / notes).
  * voiceoverText reuses ONLY words from the hook, in order, with
    no additions, removals, or reorderings — validated by token
    multiset comparison. A model that invents copy fails validation
    and the deterministic storyboard is used instead.
  * visual keywords pass through the semantics layer (concepts.py)
    before stock fetch, so a model slip ("chain") still gets
    corrected to concept visuals.

Env:
  LLM_DIRECTOR — "1" (default) tries the LLM first, "0" forces
    the deterministic Director. Read by the watcher, not here.
  MOTION_BOT_LLM_MODEL — default "meta/muse-glimmer" (fast,
    JSON-friendly). Set to a 35B model id for harder tasks.
  MOTION_BOT_LLM_BASE_URLS — comma-separated OpenAI-compatible
    base URLs. Default: the iMac proxy, then the direct tailnet URL.
  MOTION_BOT_LLM_TIMEOUT — seconds per endpoint attempt (default 120;
    reasoning models are slow, and the via-imac poll allows 420s).
"""

import json
import os
import re
import sys
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from concepts import ABSTRACT_STOPLIST, find_concepts  # noqa: E402
from harness_director import (  # noqa: E402
    estimate_scene_seconds,
    parse_labels,
    LENGTH_RE,
)

DEFAULT_MODEL = "meta/muse-glimmer"
DEFAULT_BASE_URLS = [
    "http://100.81.149.115:12345/v1",
    "http://mac-studio.tail22a20c.ts.net:1234/v1",
]
DEFAULT_TIMEOUT = 120

SYSTEM_PROMPT = """You are the visual director for short Glenride videos. The voiceover words are FIXED — you never write, change, or add to them. Your only job is choosing what the viewer SEES for each scene.

Taste rules:
- Prefer metaphor and implication over literal illustration. A supply chain is freight trucks, shipping ports, warehouses, cargo containers — never a bare chain, never a chainsaw, never a padlock.
- Avoid flat stock clichés: no handshakes, no lightbulbs, no blank notebooks, no generic business people pointing at screens.
- Every visual keyword must be a concrete, filmable thing (a place, a vehicle, an object, a person doing something).
- Vary the approach across scenes: aerial, close-up, human scale, interior, exterior — never the same shot type twice in a row.
- Never invent new voiceover claims. You only direct the visuals.

Return ONLY JSON, no prose, no markdown fences."""


def _load_motion_taste():
    """Taste section for the prompt, from motion_taste.md beside this
    file. Missing file = no taste section (old behavior), never a
    failure — the iMac-side run gets the file via rsync."""
    try:
        text = (Path(__file__).resolve().parent
                / "motion_taste.md").read_text().strip()
    except OSError:
        return ""
    return text


_MOTION_TASTE = _load_motion_taste()
if _MOTION_TASTE:
    SYSTEM_PROMPT += ("\n\nMotion taste (Subframe motion guidance, "
                      "adapted to video):\n" + _MOTION_TASTE)

USER_TEMPLATE = """Split this hook into 2-4 scenes on natural clause breaks, and choose stock-search visuals for each scene.

Hook: {hook}

Details (labels and context; the hook's words still rule): {details}

Return exactly this JSON shape:
{{"scenes": [{{"voiceoverText": "...", "visualKeywords": ["...", "..."]}}, ...]}}

Rules:
- Each scene's voiceoverText must consist ONLY of words from the hook, in their original order, with no added, removed, or reordered words. The scenes concatenated must reproduce the hook exactly (punctuation may differ).
- Each scene's visualKeywords: 2-5 concrete search phrases for stock footage, following the taste rules above."""


def _endpoints():
    raw = os.environ.get("MOTION_BOT_LLM_BASE_URLS", "").strip()
    if raw:
        return [u.strip().rstrip("/") for u in raw.split(",") if u.strip()]
    return list(DEFAULT_BASE_URLS)


def _model():
    return os.environ.get("MOTION_BOT_LLM_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL


def _timeout():
    try:
        return int(os.environ.get("MOTION_BOT_LLM_TIMEOUT", DEFAULT_TIMEOUT))
    except ValueError:
        return DEFAULT_TIMEOUT


def _tokens(text):
    return re.findall(r"[a-z0-9']+", (text or "").lower())


def _strip_fences(text):
    text = (text or "").strip()
    if text.startswith("```"):
        lines = text.split("\n")
        lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    return text


def _parse_json_loose(text):
    """Parse model JSON: direct parse, else the largest {...} block.

    Reasoning models sometimes wrap the answer in prose; the brace
    extraction is the last resort before giving up to the fallback.
    """
    try:
        return json.loads(_strip_fences(text))
    except ValueError:
        pass
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        return json.loads(text[start:end + 1])
    raise ValueError("no JSON object in model output")


def _call_model(base_url, model, hook, details, timeout, system_extra=""):
    """One chat-completions call. Returns the raw content string.

    NOTE: this LM Studio server rejects response_format json_object
    ("must be 'json_schema' or 'text", 400) — so no response_format
    is sent. JSON discipline comes from the prompt ("Return ONLY
    JSON") plus the fence-strip + parse below. Glimmer is a
    reasoning model: if `content` comes back empty, its
    `reasoning_content` is tried as a fallback source.
    """
    body = json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT + system_extra},
            {"role": "user", "content": USER_TEMPLATE.format(
                hook=hook, details=details or "(none)")},
        ],
        "temperature": 0.7,
        # 4096, not 1024: glimmer is a reasoning model and its
        # reasoning tokens come out of this same budget — with 1024
        # the content was truncated to 2 characters ("{\\"", observed
        # 2026-10-28) while the reasoning ate the rest.
        "max_tokens": 4096,
    }).encode("utf-8")
    req = urllib.request.Request(
        base_url + "/chat/completions", data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise RuntimeError(
            f"HTTP {e.code}: {(e.read().decode('utf-8') or '')[:200]}")
    choices = data.get("choices") or []
    if not choices:
        raise RuntimeError("model returned no choices")
    message = choices[0].get("message", {})
    content = (message.get("content") or "").strip()
    if content:
        return content
    reasoning = (message.get("reasoning_content") or "").strip()
    if reasoning:
        return reasoning
    raise RuntimeError("model returned empty content")


def _validate_and_build(task, model_scenes, model, endpoint):
    """Validate an LLM storyboard; return (storyboard, notes) or raise."""
    title = (task.get("title") or "").strip()
    details = task.get("details") or ""
    if not isinstance(model_scenes, list) or not (2 <= len(model_scenes) <= 4):
        raise RuntimeError(
            f"LLM returned {len(model_scenes) if isinstance(model_scenes, list) else 'non-list'} scenes (need 2-4)")
    hook_tokens = Counter(_tokens(title))
    scene_tokens = Counter()
    scenes = []
    for scene in model_scenes:
        if not isinstance(scene, dict):
            raise RuntimeError("LLM scene is not an object")
        text = (scene.get("voiceoverText") or "").strip()
        if not text:
            raise RuntimeError("LLM scene has empty voiceoverText")
        scene_tokens.update(_tokens(text))
        kws = scene.get("visualKeywords") or []
        if not isinstance(kws, list) or not kws:
            raise RuntimeError("LLM scene has no visualKeywords")
        scenes.append((text, [str(k) for k in kws if str(k).strip()]))
    if scene_tokens != hook_tokens:
        only_model = list((scene_tokens - hook_tokens).elements())[:6]
        only_hook = list((hook_tokens - scene_tokens).elements())[:6]
        raise RuntimeError(
            "LLM voiceover words do not match the hook "
            f"(added: {only_model}, missing: {only_hook})")

    labels = parse_labels(details)
    length = None
    if labels.get("length") or labels.get("duration"):
        m = LENGTH_RE.search(labels.get("length") or labels.get("duration"))
        length = float(m.group(1)) if m else None
    if length is None:
        m = LENGTH_RE.search(details)
        length = float(m.group(1)) if m else None
    est_total = sum(estimate_scene_seconds(t) for t, _ in scenes)
    length_seconds = int(length) if length is not None else est_total
    length_seconds = max(3, min(60, length_seconds))

    out_scenes = []
    notes = [f"LLM director: {model} via {endpoint}"]
    for text, llm_kws in scenes:
        concepts = find_concepts(text)
        # Semantics layer over the model's keywords: concept visuals
        # first, then the model's concrete keywords with abstract
        # words and concept-fragment words removed. A model slip
        # ("chain") is corrected here, before any stock search.
        fragment_words = set()
        for phrase, _ in concepts:
            fragment_words.update(re.findall(r"[a-z]+", phrase.lower()))
        concept_visuals = []
        for _phrase, visuals in concepts:
            for visual in visuals:
                if visual not in concept_visuals:
                    concept_visuals.append(visual)
        kept = []
        for kw in llm_kws:
            kw_low = kw.lower().strip()
            if not kw_low or kw_low in ABSTRACT_STOPLIST:
                continue
            if kw_low in fragment_words and kw_low not in concept_visuals:
                continue
            if kw_low not in kept:
                kept.append(kw_low)
        keywords = (concept_visuals + kept)[:8]
        if not keywords:
            keywords = ["landscape"]
        out_scenes.append({
            "voiceoverText": text,
            "visualKeywords": keywords,
            "concepts": [phrase for phrase, _ in concepts],
        })
        if concepts:
            notes.append(f"concept {concepts[0][0]!r} -> "
                         f"{', '.join(keywords[:5])}")

    storyboard = {
        "version": 1,
        "narrated": True,
        "hook": title,
        "lengthSeconds": length_seconds,
        "scenes": out_scenes,
        "notes": notes,
        "llmDirector": {"model": model, "endpoint": endpoint},
    }
    project = (labels.get("project") or "").strip()
    if project:
        storyboard["project"] = project
    subtitle = (labels.get("subtitle") or labels.get("tagline")
                or labels.get("end_card") or "").strip()
    if subtitle:
        storyboard["subtitle"] = subtitle
    return storyboard


def try_llm_storyboard(task):
    """Try the LLM Director. Returns (storyboard_or_None, info).

    info always carries "fallback" (bool) and, on fallback, "reason".
    The caller uses the deterministic Director whenever the first
    element is None. Never raises for model failures.
    """
    title = (task.get("title") or "").strip()
    details = task.get("details") or ""
    if not title:
        return None, {"fallback": True, "reason": "empty title"}
    model = _model()
    timeout = _timeout()
    # Attempt plan: the primary endpoint twice (reasoning length
    # varies run to run — a truncated first sample often parses
    # clean on retry), then each further endpoint once. Worst case
    # 3 x timeout stays inside the via-imac poll budget.
    endpoints = _endpoints()
    attempt_plan = []
    for i, url in enumerate(endpoints):
        attempt_plan.append(url)
        if i == 0:
            attempt_plan.append(url)
    errors = []
    for base_url in attempt_plan:
        try:
            craft = (task.get("skill_craft") or "").strip()
            system_extra = ("\n\nSkill craft guidance (HOW the visuals move, never new words):\n" + craft) if craft else ""
            content = _call_model(base_url, model, title, details, timeout, system_extra)
            parsed = _parse_json_loose(content)
            scenes = parsed.get("scenes") if isinstance(parsed, dict) else None
            storyboard = _validate_and_build(task, scenes, model, base_url)
            return storyboard, {
                "fallback": False, "model": model, "endpoint": base_url,
            }
        except Exception as e:  # noqa: BLE001 - any failure falls back
            errors.append(f"{base_url}: {e}")
            continue
    return None, {
        "fallback": True,
        "reason": f"all endpoints failed ({'; '.join(errors)})",
        "model": model,
    }


if __name__ == "__main__":
    import sys as _sys
    if "--task-file" in _sys.argv:
        _path = _sys.argv[_sys.argv.index("--task-file") + 1]
        task = json.loads(Path(_path).read_text())
    else:
        task = {"title": _sys.argv[1],
                "details": _sys.argv[2] if len(_sys.argv) > 2 else ""}
    board, info = try_llm_storyboard(task)
    print(json.dumps({"info": info, "storyboard": board}, indent=2))


def run_llm_via_imac(task, imac_host, imac_repo, imac_ssh,
                     imac_rsync_ssh, timeout=420):
    """Run the LLM Director on the iMac via SSH (VM-side entry).

    Rsyncs this module + its imports + the taste file + a task.json to
    <imac_repo>/watcher-llm/, then starts the module DETACHED
    (nohup, output to watcher-llm/out.json) and polls for the
    output file. Detached matters: the tsconnect SSH session
    breaks during long model calls, and a foreground run's result
    dies with it (observed 2026-10-28: the iMac process outlived
    the broken session). Returns (storyboard_or_None, info);
    never raises for model/transport failures — the caller falls
    back to the deterministic Director.
    """
    import subprocess
    import tempfile
    here = Path(__file__).resolve().parent
    info = {"fallback": True, "via": "imac"}
    try:
        # The remote dir must exist before single-file rsyncs land
        # in it (rsync will not create it, and the failed target
        # breaks the tsconnect proxy pipe).
        r = subprocess.run(
            [imac_ssh, f"mkdir -p {imac_repo}/watcher-llm"],
            capture_output=True, text=True, timeout=120)
        if r.returncode != 0:
            raise RuntimeError(
                f"mkdir watcher-llm on iMac failed: "
                f"{(r.stderr or r.stdout or '').strip()[-300:]}")
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            (tmp_path / "task.json").write_text(
                json.dumps(task) + "\n")
            for name in ("llm_director.py", "concepts.py",
                         "harness_director.py", "motion_taste.md"):
                r = subprocess.run(
                    ["rsync", "--partial", "-az", "--no-owner",
                     "--no-group", "-e", imac_rsync_ssh,
                     str(here / name),
                     f"{imac_host}:{imac_repo}/watcher-llm/{name}"],
                    capture_output=True, text=True, timeout=120)
                if r.returncode != 0:
                    raise RuntimeError(
                        f"rsync {name} to iMac failed: "
                        f"{(r.stderr or r.stdout or '').strip()[-300:]}")
            r = subprocess.run(
                ["rsync", "--partial", "-az", "--no-owner", "--no-group",
                 "-e", imac_rsync_ssh, str(tmp_path / "task.json"),
                 f"{imac_host}:{imac_repo}/watcher-llm/task.json"],
                capture_output=True, text=True, timeout=120)
            if r.returncode != 0:
                raise RuntimeError(
                    f"rsync task.json to iMac failed: "
                    f"{(r.stderr or r.stdout or '').strip()[-300:]}")
            # Start detached: the SSH session need not survive the
            # model call. Poll for the output file instead.
            # Env passthrough: the iMac-side run inherits NOTHING
            # from the VM shell, so LLM env overrides are forwarded
            # explicitly (otherwise a dead-endpoint test on the VM
            # silently uses the iMac defaults).
            import shlex
            env_prefix = ""
            for var in ("MOTION_BOT_LLM_BASE_URLS", "MOTION_BOT_LLM_MODEL",
                        "MOTION_BOT_LLM_TIMEOUT"):
                if os.environ.get(var):
                    env_prefix += f"{var}={shlex.quote(os.environ[var])} "
            r = subprocess.run(
                [imac_ssh,
                 f"cd {imac_repo} && rm -f watcher-llm/out.json "
                 f"&& nohup env {env_prefix}python3 "
                 f"watcher-llm/llm_director.py "
                 f"--task-file watcher-llm/task.json "
                 f"> watcher-llm/out.json 2> watcher-llm/err.log "
                 f"< /dev/null & echo STARTED"],
                capture_output=True, text=True, timeout=120)
            if "STARTED" not in (r.stdout or ""):
                raise RuntimeError(
                    f"starting iMac llm_director failed: "
                    f"{((r.stdout or '') + (r.stderr or '')).strip()[-300:]}")
            # NOTE: the SSH exit code is ignored here on purpose —
            # tsconnect reports "Broken pipe" (255) even when the
            # remote nohup launch printed STARTED. STARTED in
            # stdout is the success signal, not the exit code.
            import time as _time
            deadline = _time.time() + timeout
            while _time.time() < deadline:
                _time.sleep(10)
                r = subprocess.run(
                    ["rsync", "--partial", "-az", "--no-owner",
                     "--no-group", "-e", imac_rsync_ssh,
                     f"{imac_host}:{imac_repo}/watcher-llm/out.json",
                     str(tmp_path / "out.json")],
                    capture_output=True, text=True, timeout=60)
                if r.returncode != 0 or not (tmp_path / "out.json").exists():
                    continue
                try:
                    result = json.loads((tmp_path / "out.json").read_text())
                except ValueError:
                    continue  # partial write; keep waiting
                board = result.get("storyboard")
                inner = result.get("info") or {}
                if board is not None:
                    inner["via"] = "imac"
                    return board, inner
                info["reason"] = inner.get("reason", "LLM returned no board")
                return None, info
            # Timed out: stop the remote run so it cannot hold the
            # model for the next task, then fall back.
            subprocess.run(
                [imac_ssh,
                 f"pkill -f 'llm_director.py --task-file' || true"],
                capture_output=True, text=True, timeout=60)
            info["reason"] = f"iMac LLM run timed out after {timeout}s"
            return None, info
    except Exception as e:  # noqa: BLE001 - any failure falls back
        info["reason"] = str(e)[:500]
        return None, info
