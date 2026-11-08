#!/usr/bin/env python3
"""Motion Bot — question gate (v2.1).

Before the watcher claims a narrated task, this gate checks for a
genuine creative fork — a choice where guessing would visibly
change the video and no safe default exists. On a fork it asks ONE
concise question and leaves the task OPEN and unclaimed; the
watcher skips it on later cycles and never re-asks while the
question is unanswered. When he answers by editing the task (adding
the missing context), the gate clears and the task renders.

Triggers (narrated tasks only — Harness tasks have safe fallbacks:
motif orbit, neutral mood, no on-screen project):
  (a) no concrete visual concept survives the semantics layer in
      ANY scene (every keyword abstract or stop-word);
  (b) a keyword with several unrelated visual senses (AMBIGUOUS
      words: chain, wave, star, key) is a scene's keyword and
      nothing in the task disambiguates it;
  (c) an explicit either/or tone fork in the task text
      ("dark or bright");
  (d) a project/subtitle the task implies is missing (an empty
      `Project:` / `Subtitle:` label, or "TBD" on either).

NEVER asked about: length, voice, music, orientation, palette —
all have safe defaults. At most one question per task, enforced by
the asked-record (asked_questions.json beside this module).

Posting: Mission Control tasks carry a `needsDecision` flag and
decisions carry `taskId` + `status` ("needed" vs "made", observed
2026-10-28). post_question_to_mc POSTs a "needed" decision with
the question + options and PATCHes the task's needsDecision flag.
Both calls are best-effort: if the decisions endpoint rejects the
POST, the needsDecision PATCH still surfaces the task, and the
local asked-record still prevents re-asking. Never raises.
"""

import json
import re
import subprocess
from pathlib import Path

import concepts
from concepts import AMBIGUOUS_WORDS, DISAMBIGUATORS, semantic_keywords
from harness_director import (
    NARRATED_STOP_WORDS,
    split_scenes,
)

API_BASE = "https://mission-control-hq-api.mwszghdkkf.workers.dev"
USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"
ASKED_PATH = Path(__file__).resolve().parent / "asked_questions.json"

TONE_WORDS = (
    "dark", "bright", "serious", "playful", "warm", "ominous", "calm",
    "bold", "somber", "dramatic", "gentle", "hopeful", "energetic",
    "urgent",
)
TONE_FORK_RE = re.compile(
    r"\b(" + "|".join(TONE_WORDS) + r")\s+or\s+(" + "|".join(TONE_WORDS) + r")\b",
    re.I,
)
EMPTY_LABEL_RE = re.compile(
    r"(?im)^\s*(project|subtitle|tagline|end card)\s*[:\-=]\s*$")
TBD_RE = re.compile(
    r"\b(project|subtitle|tagline|end card)\b[^.\n]{0,40}\b(TBD|to be decided|to decide)\b",
    re.I,
)


def _scene_keywords(text):
    """Semantic keywords WITHOUT the landscape fallback.

    Returns (keywords, concepts). Empty keywords = nothing concrete
    survived (trigger (a) territory).
    """
    keywords, scene_concepts, _ = semantic_keywords(
        text, stop_words=NARRATED_STOP_WORDS, limit=4)
    return keywords, scene_concepts


def _disambiguated(word, task_text):
    """True when the task text contains a distinguishing word from
    one of the ambiguous word's option senses, or a domain cue word
    for any sense ("bicycle" picks the metal-chain sense). The
    ambiguous word itself never counts (its presence is the
    ambiguity)."""
    low = task_text.lower()
    word_stem = word.lower()
    cues = set(DISAMBIGUATORS.get(word, set()))
    for option in AMBIGUOUS_WORDS[word]:
        for w in re.findall(r"[a-z]+", option.lower()):
            if len(w) >= 4 and w != word_stem:
                cues.add(w)
    for cue in cues:
        if re.search(r"\b" + re.escape(cue) + r"\b", low):
            return True
    return False


def check_question(task):
    """Task dict -> question dict or None.

    Pure function: no API calls, no file writes. The watcher calls
    this BEFORE claiming; a non-None result means skip the task.
    """
    title = (task.get("title") or "").strip()
    details = task.get("details") or ""
    if not title:
        return None  # empty title blocks separately, asking for the hook
    text = title + " " + details
    scene_texts = split_scenes(title) or [title]

    # (d) missing project/subtitle the task implies.
    m = EMPTY_LABEL_RE.search(details)
    if m:
        return {
            "trigger": "missing_credit",
            "question": f"What {m.group(1).lower()} should this clip carry? "
                        f"The task leaves it blank.",
            "options": [],
        }
    m = TBD_RE.search(text)
    if m:
        return {
            "trigger": "missing_credit",
            "question": f"What {m.group(1).lower()} should this clip carry? "
                        f"The task marks it TBD.",
            "options": [],
        }

    # (c) explicit either/or tone fork.
    m = TONE_FORK_RE.search(text)
    if m:
        a, b = m.group(1).lower(), m.group(2).lower()
        if a != b:
            return {
                "trigger": "tone_fork",
                "question": f"Which tone for this clip: {a} or {b}?",
                "options": [a, b],
            }

    # (a) no concrete visual concept in ANY scene.
    per_scene = [_scene_keywords(t) for t in scene_texts]
    if all(not kws for kws, _ in per_scene):
        return {
            "trigger": "no_concept",
            "question": "What should the viewer see in this clip? "
                        "The hook gives no concrete visual to search for.",
            "options": [],
        }

    # (b) ambiguous word as a keyword, undisambiguated.
    for (kws, scene_concepts), scene_text in zip(per_scene, scene_texts):
        if scene_concepts:
            continue  # a mapped concept already disambiguates
        for kw in kws:
            base = kw.lower()
            if base in AMBIGUOUS_WORDS and not _disambiguated(base, text):
                return {
                    "trigger": "ambiguous_word",
                    "question": f"When you say {base!r}, which did you mean?",
                    "options": list(AMBIGUOUS_WORDS[base]),
                    "scene": scene_text,
                }
    return None


# ------------------------------------------------------------ asked record
def load_asked(path=ASKED_PATH):
    try:
        data = json.loads(Path(path).read_text())
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def is_asked(path, task_id):
    return str(task_id) in load_asked(path)


def record_asked(path, task_id, question):
    data = load_asked(path)
    data[str(task_id)] = question
    tmp = Path(str(path) + ".tmp")
    tmp.write_text(json.dumps(data, indent=2) + "\n")
    tmp.replace(path)


def clear_asked(path, task_id):
    data = load_asked(path)
    if str(task_id) in data:
        del data[str(task_id)]
        tmp = Path(str(path) + ".tmp")
        tmp.write_text(json.dumps(data, indent=2) + "\n")
        tmp.replace(path)


# ------------------------------------------------------------ MC posting
def _api(password, method, path, body=None):
    cmd = [
        "curl", "-sS", "--fail-with-body",
        "-H", f"User-Agent: {USER_AGENT}",
        "-H", f"Authorization: Bearer {password}",
        "-X", method,
    ]
    if body is not None:
        cmd += ["-H", "Content-Type: application/json",
                "--data", json.dumps(body)]
    cmd.append(API_BASE + path)
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise RuntimeError(
            f"{method} {path} failed (exit {r.returncode}): "
            f"{(r.stdout or r.stderr or '').strip()[-300:]}")
    return json.loads(r.stdout) if (r.stdout or "").strip() else {}


def post_question_to_mc(password, task, question):
    """Post a question for a task. Returns a status dict, never raises.

    POSTs a "needed" decision carrying the question + options, then
    PATCHes the task's needsDecision flag. Either call failing still
    leaves the other (and the local asked-record) in place.
    """
    status = {"decision_posted": False, "needs_decision_set": False}
    tid = task["id"]
    try:
        _api(password, "POST", "/api/decisions", {
            "taskId": tid,
            "projectId": task.get("projectId"),
            "title": question["question"],
            "optionsConsidered": " | ".join(question.get("options") or []),
            "context": f"Motion Bot question gate ({question['trigger']})",
            "status": "needed",
        })
        status["decision_posted"] = True
    except Exception as e:  # noqa: BLE001 - best-effort by design
        status["decision_error"] = str(e)[:300]
    try:
        _api(password, "PATCH", f"/api/tasks/{tid}",
             {"needsDecision": True})
        status["needs_decision_set"] = True
    except Exception as e:  # noqa: BLE001 - best-effort by design
        status["needs_decision_error"] = str(e)[:300]
    return status
