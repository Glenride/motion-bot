#!/usr/bin/env python3
"""Motion Bot — b-roll timing (b-roll-skills, v2.7).

Pure functions: word timings -> cuts on the noun -> segment list
for the BRoll composition. No I/O, no network, no keys.

Rules (from the skill):
  * Cut on the noun: a segment starts at the frame its noun is
    spoken. The cut word per beat is its first content word
    (non-stopword) — "Panels turn...", "The grid wakes..." cuts on
    "grid", "Power reaches..." cuts on "Power".
  * The keyword overlay reveals exactly at the noun (nounAt), not at
    the segment start; the clip plays bare before it.
  * A segment whose noun matches no local pool clip renders as a
    code-drawn panel (kind "panel") — never a still, never a hotlink,
    never a fresh search. Motion Bot has no footage source of its
    own; the pool is the local Pixabay stock under
    ~/workspace/your_files/video-stock/pixabay-2026-11-20-stock/
    (Pixabay search is HTTP 400 since Nov 20 16:34 ET; Pexels is out
    by his rule; no new keys). The pool ledger below is the only
    footage the watcher may assign.

Word timings are estimates (~2.2 words/sec, the same rate the
Director uses for voiceover estimates) with a short gap between
beats; a real transcript's word timings replace them when one
exists. Estimated timings are never presented as measured.
"""

import re

WORDS_PER_SEC = 2.2
BEAT_GAP_SEC = 0.5

STOPWORDS = {
    "a", "an", "the", "and", "or", "but", "of", "to", "in", "on", "for",
    "with", "by", "at", "from", "is", "are", "was", "were", "be", "it",
    "its", "this", "that", "these", "those", "you", "your", "we", "our",
    "he", "she", "they", "i", "me", "my", "his", "her", "their", "not",
    "no", "do", "does", "did", "can", "could", "will", "would",
    "should", "when", "where", "why", "how", "what", "who", "which",
    "there", "here", "very", "just", "only", "also", "than", "then",
    "so", "as", "if", "about", "into", "over", "after", "before",
    "between", "through", "during", "without", "within", "every",
    "each", "all", "any", "some", "more", "most", "other", "such",
    "own", "same", "too", "again", "once", "now", "out", "up", "down",
    "off", "am", "us",
}

# Local pool: file -> (duration seconds, tags from the Pixabay search
# JSONs that fetched it, 2026-11-20). Only these files may be
# assigned; a noun matching none of them falls back to a panel.
# Files live in the repo at public/broll/ (gitignored *.mp4) and are
# rsynced to the iMac with the brief — never hotlinked, never
# re-downloaded.
POOL = {
    "pixabay-1044.mp4": (
        14,
        "new york city manhattan people cars crossroads street city "
        "skyscrapers pedestrians town",
    ),
    "pixabay-21118.mp4": (
        6,
        "seoul traffic cars city speed lights night outdoor street "
        "live wallpaper",
    ),
    "pixabay-1643.mp4": (
        14,
        "india people street asian person culture city town road busy "
        "crowd market",
    ),
}

# Editorial concept map (cut word -> tag words that stand in for it).
# This is a judgment call, recorded in the storyboard notes — NOT a
# tag match. "grid" has no literal footage in the pool; city lights
# at night (21118) stand in for the grid waking. "town" matches
# literally (1643). "Panels" matches nothing: no solar-panel footage
# exists in the pool, so that segment is a code-drawn panel.
CONCEPTS = {
    "grid": ["lights", "city"],
    "power": ["city"],
}


def cut_word(beat_words):
    """First content word of a beat — the noun the cut lands on."""
    for w in beat_words:
        clean = re.sub(r"[^A-Za-z]", "", w).lower()
        if clean and clean not in STOPWORDS and len(clean) >= 3:
            return w
    return beat_words[0] if beat_words else ""


def estimate_word_times(beats, words_per_sec=WORDS_PER_SEC,
                        gap=BEAT_GAP_SEC):
    """Beats (list of word lists) -> [(word, start, end)] in seconds.

    Words run at words_per_sec inside a beat; beats are separated by
    `gap` seconds of silence. Estimated, not measured.
    """
    out = []
    at = 0.0
    step = 1.0 / words_per_sec
    for words in beats:
        for w in words:
            out.append((w, round(at, 2), round(at + step, 2)))
            at += step
        at += gap
    return out


def _match_clip(cut_word_text, beat_words, pool=POOL):
    """Cut word + beat words -> (file, duration, how) or None.

    Match order, all literal except the last step:
      1. the cut word itself in a clip's tags;
      2. any other word of the beat in a clip's tags;
      3. the CONCEPTS map for the cut word (editorial stand-in,
         flagged as "concept" in the returned how).
    First pool entry in file order wins at each step.
    """
    def by_tag_words(wanted):
        for fname, (duration, tags) in pool.items():
            tag_words = set(tags.split())
            if wanted & tag_words:
                return fname, duration
        return None

    def stems(word):
        key = re.sub(r"[^a-z]", "", word.lower())
        return {key, key[:-1]} if key.endswith("s") else {key}

    hit = by_tag_words(stems(cut_word_text))
    if hit:
        return hit[0], hit[1], "tag"
    for w in beat_words:
        hit = by_tag_words(stems(w))
        if hit:
            return hit[0], hit[1], "tag"
    for concept in CONCEPTS.get(cut_word_text.lower(), []):
        hit = by_tag_words({concept})
        if hit:
            return hit[0], hit[1], "concept"
    return None


def build_segments(beats, length_seconds=None, pool=POOL):
    """Beats (list of word lists) -> BRoll segment list.

    One segment per beat; a segment starts at its beat's cut word
    (the noun), so the cut lands on the noun. The keyword overlay
    shows the cut word plus the next word ("grid wakes") — a few key
    words, never the sentence. The last segment runs to the clip
    end; length_seconds defaults to the timed end + a 2s tail.
    Returns (segments, total_seconds, notes).
    """
    timed = estimate_word_times(beats)
    # Cut word per beat, with its timestamp.
    cuts = []
    idx = 0
    for words in beats:
        cw = cut_word(words)
        # Timestamp of the cut word: its position inside the beat.
        pos = words.index(cw)
        start = timed[idx + pos][1] if idx + pos < len(timed) else timed[idx][1]
        cuts.append((cw, start, words))
        idx += len(words)
    total = (length_seconds if length_seconds is not None
             else round(timed[-1][2] + 2.0, 2) if timed else 12)
    segments = []
    notes = []
    for i, (cw, start, words) in enumerate(cuts):
        end = cuts[i + 1][1] if i + 1 < len(cuts) else total
        # Keyword: cut word + the word after it, when there is one.
        pos = words.index(cw)
        keyword = " ".join(words[pos:pos + 2]).strip(",")
        match = _match_clip(cw, words, pool)
        if match:
            fname, duration, how = match
            segments.append({
                "from": start,
                "to": round(end, 2),
                "kind": "clip",
                "clip": f"broll/{fname}",
                "clipDurationSeconds": duration,
                "nounAt": start,
                "keyword": keyword,
                "words": words,
            })
            notes.append(f"b-roll: '{cw}' -> clip {fname} "
                         f"({how} match, {start}s–{round(end, 2)}s)")
        else:
            segments.append({
                "from": start,
                "to": round(end, 2),
                "kind": "panel",
                "nounAt": start,
                "keyword": keyword,
                "words": words,
            })
            notes.append(f"b-roll: '{cw}' has no pool clip — "
                         f"code-drawn panel ({start}s–{round(end, 2)}s)")
    return segments, total, notes


if __name__ == "__main__":
    import json
    demo = [
        ["Panels", "turn", "to", "face", "the", "morning"],
        ["The", "grid", "wakes", "row", "by", "row"],
        ["Power", "reaches", "the", "town", "by", "noon"],
    ]
    segs, total, notes = build_segments(demo, length_seconds=12)
    print(json.dumps({"segments": segs, "total": total,
                      "notes": notes}, indent=2))
