#!/usr/bin/env python3
"""Motion Bot Harness — Writer (Video Bot Writer stage).

Turns a task (title + details) into 2-5 on-screen beats, each a
short screen of text: a headline (<= 6 words) plus an optional
support line (<= 12 words), 15 words max per beat, 2-6s per beat.

This is the fix for the one-scene failure: the deterministic
Director turns a whole story into ONE scene (task 486: 41 words on
screen at once), because it never condenses. The Writer condenses
the task's own story into capped beats; the Director then builds
one scene per beat, so no scene ever exceeds 15 words.

Model-gated, never hard-depended on. The model call runs ON THE
IMAC via run_module_via_imac (llm_director.py) — the VM cannot
reach the Studio model directly. ANY failure (Strata down,
timeout, bad JSON, validation failure after one retry) returns
(None, info) so the caller falls back to the deterministic
Director with no error surfaced to the task.

Fact rule (his standing rule 2026-11-03, enforced in code, not
just in the prompt): no FACTS or numbers are invented — every
number in a beat must trace to the task text (validate_beats
checks each numeric token against the title + details, normalizing
$, commas, % and x suffixes). A missing number renders as
[VALUE NEEDED], never invented. The Writer may condense and
rephrase; it may not invent.

Beat schema (exact):
  {"role": "hook|idea|proof|payoff|cta",
   "headline": "<=6 words>",
   "support": "<=12 words or null>",
   "emphasis_word": "<one word in headline or support, or null>",
   "content_type": "stat|list|statement|quote|sequence",
   "duration_sec": <float>}

Local LLMs only: NO Claude, NO Grok, NO Gemini, NO paid API, no
new keys. Env overrides are the llm_director ones:
MOTION_BOT_LLM_BASE_URLS / MOTION_BOT_LLM_MODEL /
MOTION_BOT_LLM_TIMEOUT.

Usage (iMac-side run, via run_module_via_imac):
  python3 harness_writer.py --task-file <task.json>
  # task = {"title": ..., "details": ...}
  # prints {"info": ..., "beats": [...]}
"""

import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from harness_director import LENGTH_RE, parse_labels  # noqa: E402
from llm_director import (  # noqa: E402
    _call_model_messages,
    _endpoints,
    _model,
    _parse_json_loose,
    _timeout,
    run_module_via_imac,
)

# iMac connection — same values as watch_motion_bot.py.
IMAC_HOST = os.environ.get("MOTION_BOT_IMAC_HOST",
                           "housedv@100.81.149.115")
IMAC_REPO = os.environ.get("MOTION_BOT_IMAC_REPO",
                           "~/projects/motion-bot")
IMAC_SSH = os.path.expanduser(
    os.environ.get("MOTION_BOT_IMAC_SSH",
                   "~/workspace/.imac-ssh.sh"))
IMAC_RSYNC_SSH = os.path.expanduser(
    os.environ.get("MOTION_BOT_IMAC_RSYNC_SSH",
                   "~/workspace/.imac-rsync-ssh.sh"))

# Files the iMac-side run needs in watcher-llm/: this module, the
# transport, and everything llm_director -> harness_director pulls
# in (concepts, story_intake, memory) plus the taste file.
WRITER_FILES = ("harness_writer.py", "llm_director.py", "concepts.py",
                "harness_director.py", "motion_taste.md",
                "story_intake.py", "memory.py")

ROLES = {"hook", "idea", "proof", "payoff", "cta"}
CONTENT_TYPES = {"stat", "list", "statement", "quote", "sequence"}

WRITER_SYSTEM_PROMPT = """You are the beat writer for short Glenride videos. You turn a task brief into 2-5 on-screen beats. Each beat is one short screen of text: a headline plus an optional support line.

HARD CAPS (never break these):
- 2-5 beats per video.
- headline: at most 6 words, never more.
- support: at most 12 words, or null when the headline stands alone.
- headline + support: at most 15 words total per beat.
- duration_sec: 2-6 seconds per beat; the durations must sum to the target total length given in the task.
- role: hook opens, idea explains, proof evidences, payoff lands the turn, cta closes.
- content_type: stat when the beat carries a real number from the task, written as digits (42%, $1,605, 3x); a spelled-out number such as "one hour" does not make a beat a stat beat — label that beat sequence or statement. list when it enumerates items; sequence when it orders steps in time; quote when it repeats the task's own words; otherwise statement.
- emphasis_word: one single word that appears in the headline or support, or null.

FACT RULE — no FACTS or numbers invented. Every number or fact must trace to the task text. A missing number renders as [VALUE NEEDED], never invented. Condense and rephrase the task's own words; do not invent new claims, names, or numbers. Keep numbers exactly as written in the task — do not convert a spelled-out number to digits, or digits to words. If the task states a real number, at least one beat should be a stat beat using that number, with the number in the headline or support. If the task states no number, use no stat beats and no numbers at all.

Return ONLY JSON, no prose, no markdown fences."""

WRITER_USER_TEMPLATE = """Title: {title}

Details: {details}

Target total length: {target}s. Beat durations must sum to about {target}s.

Return exactly this JSON shape:
{{"beats": [{{"role": "hook", "headline": "...", "support": "...", "emphasis_word": "...", "content_type": "statement", "duration_sec": 3.0}}, ...]}}

Rules:
- 2-5 beats, in story order: hook first, cta last when the task has a call to action.
- headline at most 6 words; support at most 12 words or null; headline + support at most 15 words per beat.
- duration_sec 2-6 per beat; durations sum to about {target}s.
- emphasis_word is one word from the headline or support, or null.
- content_type stat ONLY when the beat carries a real number from the task text above, written as digits; a spelled-out number (e.g. "one hour") never makes a beat a stat beat. Otherwise statement, list, sequence, or quote.
- No invented numbers, names, or facts. A number you cannot find in the task text above renders as [VALUE NEEDED], never as a made-up figure."""


# ------------------------------------------------------------ numbers
# A numeric token: optional $, digits with commas, optional
# decimals, optional % or x suffix. A digit glued to a letter
# ("Q2", "B2B") is NOT a number — the char before the match must
# not be a letter or digit.
_NUMBER_RE = re.compile(r"\$?\d[\d,]*(?:\.\d+)?\s*(?:%|x|X)?")
_TOTAL_DURATION_RE = re.compile(
    r"(?i)Total Duration\s*:\s*([\d.]+)\s*(?:seconds|secs|sec|s)\b")


def _number_tokens(text):
    """Text -> [(raw, value)] for every numeric token, in order."""
    out = []
    for m in _NUMBER_RE.finditer(text or ""):
        if m.start() > 0 and (text[m.start() - 1].isalpha()
                              or text[m.start() - 1].isdigit()):
            continue
        raw = (m.group(0).replace("$", "").replace(",", "")
               .replace("%", "").replace("x", "").replace("X", "")
               .strip())
        if not raw:
            continue
        try:
            out.append((m.group(0), float(raw)))
        except ValueError:
            continue
    return out


def parse_stat_number(text):
    """First numeric token in text -> float, or None.

    Handles $, commas, % and x suffixes, decimals. The validator's
    stat-number check and the Director's bar synthesis both use
    this same parser, so a stat beat that passes validation always
    yields a parseable number downstream.
    """
    tokens = _number_tokens(text)
    return tokens[0][1] if tokens else None


def _words(text):
    return [w for w in re.split(r"\s+", (text or "").strip()) if w]


# ------------------------------------------------------------ length
def target_length(title, details):
    """Video length in seconds: explicit Length:/Duration: label,
    else a beat-sheet Total Duration:, else an 'Ns' in the details,
    else 12s. Clamped 3-60s."""
    labels = parse_labels(details or "")
    length = None
    if labels.get("length") or labels.get("duration"):
        m = LENGTH_RE.search(labels.get("length")
                             or labels.get("duration"))
        length = float(m.group(1)) if m else None
    if length is None:
        m = _TOTAL_DURATION_RE.search(details or "")
        length = float(m.group(1)) if m else None
    if length is None:
        m = LENGTH_RE.search(details or "")
        length = float(m.group(1)) if m else None
    if length is None:
        return 12.0
    return max(3.0, min(60.0, float(length)))


def _normalize_durations(beats, target):
    """Scale beat durations to sum to ~target, keeping each in 2-6s.

    Best effort: when the target cannot be reached inside 2-6s per
    beat (e.g. 2 beats and a 30s target), the durations stay valid
    and the sum lands as close as the caps allow — the validator
    only requires the sum in 3-60s, and the Director sizes the
    clip from the actual sum.
    """
    if not isinstance(beats, list) or not beats:
        return beats
    durations = []
    for b in beats:
        try:
            durations.append(float(b.get("duration_sec")))
        except (TypeError, ValueError, AttributeError):
            durations.append(0.0)
    total = sum(durations)
    if total <= 0:
        durations = [target / len(beats)] * len(beats)
        total = target
    scale = target / total if total else 1.0
    durations = [max(2.0, min(6.0, round(d * scale, 1)))
                 for d in durations]
    for _ in range(20):
        diff = round(target - sum(durations), 1)
        if abs(diff) < 0.05:
            break
        if diff > 0:
            idx = max(range(len(durations)),
                      key=lambda i: 6.0 - durations[i])
            if 6.0 - durations[idx] <= 0:
                break
            durations[idx] = round(
                durations[idx] + min(diff, 6.0 - durations[idx]), 1)
        else:
            idx = max(range(len(durations)),
                      key=lambda i: durations[i] - 2.0)
            if durations[idx] - 2.0 <= 0:
                break
            durations[idx] = round(
                durations[idx] - min(-diff, durations[idx] - 2.0), 1)
    for b, d in zip(beats, durations):
        if isinstance(b, dict):
            b["duration_sec"] = d
    return beats


# ------------------------------------------------------------ validation
def validate_beats(beats, title, details):
    """Validate writer beats against the schema + the fact rule.

    Returns (cleaned_beats, errors): cleaned is a list of beats in
    the exact schema (emphasis_word set to None when absent rather
    than failing the beat) when valid, else None; errors is a list
    of human-readable failure strings (empty when valid).

    Checks: 2-5 beats; headline <= 6 words; support <= 12 words or
    null; headline + support <= 15 words per beat; role and
    content_type in the allowed sets; duration_sec each 2-6s and
    summing to 3-60s; a stat beat MUST contain a numeric token
    parseable by parse_stat_number() in headline or support; EVERY
    number token in any beat must appear in title + details
    (normalizing $, commas, % and x suffixes); emphasis_word, when
    present, must appear in the headline or support
    (case-insensitive) — otherwise it is set to None.
    """
    errors = []
    if not isinstance(beats, list):
        return None, ["beats is not a list"]
    if not 2 <= len(beats) <= 5:
        return None, [f"{len(beats)} beats (need 2-5)"]
    source_numbers = {v for _, v in
                      _number_tokens((title or "") + "\n" + (details or ""))}
    total_duration = 0.0
    cleaned = []
    for i, beat in enumerate(beats):
        tag = f"beat {i + 1}"
        if not isinstance(beat, dict):
            errors.append(f"{tag}: not an object")
            continue
        role = beat.get("role")
        if role not in ROLES:
            errors.append(f"{tag}: role {role!r} not in {sorted(ROLES)}")
        ctype = beat.get("content_type")
        if ctype not in CONTENT_TYPES:
            errors.append(f"{tag}: content_type {ctype!r} not in "
                          f"{sorted(CONTENT_TYPES)}")
        headline = beat.get("headline")
        if not isinstance(headline, str) or not headline.strip():
            errors.append(f"{tag}: headline missing or empty")
            headline_words = []
        else:
            headline_words = _words(headline)
            if len(headline_words) > 6:
                errors.append(f"{tag}: headline {len(headline_words)} "
                              f"words (max 6): {headline!r}")
        support = beat.get("support")
        if support is None:
            support_words = []
        elif isinstance(support, str):
            support_words = _words(support)
            if len(support_words) > 12:
                errors.append(f"{tag}: support {len(support_words)} "
                              f"words (max 12): {support!r}")
        else:
            errors.append(f"{tag}: support is not a string or null")
            support_words = []
        if len(headline_words) + len(support_words) > 15:
            errors.append(f"{tag}: headline + support "
                          f"{len(headline_words) + len(support_words)} "
                          f"words (max 15)")
        try:
            duration = float(beat.get("duration_sec"))
        except (TypeError, ValueError):
            errors.append(f"{tag}: duration_sec "
                          f"{beat.get('duration_sec')!r} is not a number")
            duration = 0.0
        else:
            total_duration += duration
            if not 2.0 <= duration <= 6.0:
                errors.append(f"{tag}: duration_sec {duration} "
                              f"outside 2-6s")
        # Stat beats must carry a parseable number; EVERY number in
        # any beat must trace to the task text.
        beat_text = ((headline or "") + " "
                     + (support or "")).strip()
        for raw, value in _number_tokens(beat_text):
            if value not in source_numbers:
                errors.append(f"{tag}: number {raw!r} not in the task "
                              f"text (no invented numbers)")
        if ctype == "stat" and parse_stat_number(beat_text) is None:
            errors.append(f"{tag}: stat beat carries no parseable "
                          f"number in headline or support")
        # emphasis_word: one word in the headline or support, else
        # None — never a failure.
        emphasis = beat.get("emphasis_word")
        if isinstance(emphasis, str) and emphasis.strip():
            token = emphasis.strip()
            hay = " ".join(headline_words + support_words).lower()
            hay_words = [re.sub(r"[^\w']", "", w) for w in hay.split()]
            if len(token.split()) != 1 or \
                    re.sub(r"[^\w']", "", token.lower()) not in hay_words:
                emphasis = None
            else:
                emphasis = token
        else:
            emphasis = None
        cleaned.append({
            "role": role,
            "headline": " ".join(headline_words),
            "support": (" ".join(support_words)
                        if support_words else None),
            "emphasis_word": emphasis,
            "content_type": ctype,
            "duration_sec": duration,
        })
    if not 3.0 <= total_duration <= 60.0:
        errors.append(f"total duration {total_duration}s outside 3-60s")
    if errors:
        return None, errors
    return cleaned, []


# ------------------------------------------------------------ iMac-side run
def try_write_beats_local(task):
    """Try the Writer against the local model (runs ON the iMac).

    Returns (beats_or_None, info). info always carries "fallback"
    (bool) and, on fallback, "reason". Validates the model's beats
    and retries ONCE on validation failure. Never raises for model
    failures.
    """
    title = (task.get("title") or "").strip()
    details = task.get("details") or ""
    if not title:
        return None, {"fallback": True, "reason": "empty title"}
    target = target_length(title, details)
    model = _model()
    timeout = _timeout()
    endpoints = _endpoints()
    messages = [
        {"role": "system", "content": WRITER_SYSTEM_PROMPT},
        {"role": "user", "content": WRITER_USER_TEMPLATE.format(
            title=title, details=details or "(none)", target=target)},
    ]
    errors = []
    for attempt in range(1, 3):  # initial + ONE retry on validation failure
        content = None
        endpoint_used = None
        last_err = ""
        for base_url in endpoints:
            try:
                content = _call_model_messages(
                    base_url, model, messages, timeout, temperature=0.3)
                endpoint_used = base_url
                break
            except Exception as e:  # noqa: BLE001 - try next endpoint
                last_err = f"{base_url}: {e}"
                continue
        if content is None:
            return None, {
                "fallback": True,
                "reason": f"all endpoints failed ({last_err})",
                "model": model, "attempts": attempt,
            }
        try:
            parsed = _parse_json_loose(content)
            beats = parsed.get("beats") if isinstance(parsed, dict) else None
        except Exception as e:  # noqa: BLE001 - bad JSON = validation failure
            errors = [f"model output is not JSON: {e}"]
            beats = None
        if beats is None and not errors:
            errors = ["model output has no beats list"]
        if isinstance(beats, list):
            _normalize_durations(beats, target)
            cleaned, errors = validate_beats(beats, title, details)
            if cleaned is not None:
                return cleaned, {
                    "fallback": False, "model": model,
                    "endpoint": endpoint_used, "attempts": attempt,
                    "target_length": target,
                }
        # Validation failed: loop retries once, then falls through.
    return None, {
        "fallback": True,
        "reason": "validation failed after retry: " + "; ".join(errors[:4]),
        "model": model, "attempts": 2,
    }


# ------------------------------------------------------------ VM-side entry
def write_beats(title, details):
    """Write beats for a task via the iMac model run.

    Returns (beats_or_None, info). info carries model/endpoint/
    attempts on success, and fallback + reason otherwise. ANY
    exception (Strata down, timeout, bad JSON) -> (None, info with
    reason). Never raises for model/transport failures.
    """
    try:
        title = (title or "").strip()
        details = details or ""
        if not title:
            return None, {"fallback": True, "reason": "empty title"}
        task = {"title": title, "details": details}
        attempts = 0
        last_reason = ""
        for _ in range(2):  # initial + ONE retry on validation failure
            attempts += 1
            result, rinfo = run_module_via_imac(
                task, "harness_writer.py", WRITER_FILES,
                IMAC_HOST, IMAC_REPO, IMAC_SSH, IMAC_RSYNC_SSH,
                timeout=420, run_label="Writer")
            if result is None:
                # Transport failure: no retry — the model run itself
                # already retried once on validation failure.
                return None, {
                    "fallback": True,
                    "reason": rinfo.get("reason", "iMac run failed"),
                    "attempts": attempts, "model": _model(),
                }
            inner = result.get("info") or {}
            beats = result.get("beats")
            if not isinstance(beats, list):
                # Surface the iMac-side reason (e.g. the validation
                # errors) instead of a generic message — the run
                # entry and the proof both read it.
                last_reason = (inner.get("reason")
                               or "iMac run returned no beats list")
                continue
            cleaned, errors = validate_beats(beats, title, details)
            if cleaned is not None:
                return cleaned, {
                    "fallback": False,
                    "model": inner.get("model") or _model(),
                    "endpoint": inner.get("endpoint"),
                    "attempts": attempts,
                    "target_length": inner.get("target_length"),
                    "via": "imac",
                }
            last_reason = ("validation failed: " + "; ".join(errors[:4]))
        return None, {
            "fallback": True, "reason": last_reason,
            "attempts": attempts, "model": _model(),
        }
    except Exception as e:  # noqa: BLE001 - any failure falls back
        return None, {"fallback": True, "reason": str(e)[:500]}


if __name__ == "__main__":
    if "--task-file" in sys.argv:
        _path = sys.argv[sys.argv.index("--task-file") + 1]
        _task = json.loads(Path(_path).read_text())
    else:
        _task = {"title": sys.argv[1],
                 "details": sys.argv[2] if len(sys.argv) > 2 else ""}
    _beats, _info = try_write_beats_local(_task)
    print(json.dumps({"info": _info, "beats": _beats}, indent=2))
