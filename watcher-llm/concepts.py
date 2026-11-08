#!/usr/bin/env python3
"""Motion Bot — semantics layer for narrated stock search (v2.1).

The v2 picker scored Pixabay tags by plain string overlap, which is
literal in exactly the wrong way: the scene "make the chain visible"
searched ["work", "make", "chain", "visible"] and a chainsaw cutting
a log won on the word "chain" (observed 2026-10-26). This module
fixes that deterministically, with no model and no network:

  * CONCEPT_MAP — a domain/abstract term maps to CONCRETE visual
    keywords (filmable things, not the abstract word). "supply
    chain" maps to freight truck / shipping port / warehouse, never
    to a bare "chain".
  * Phrase-first matching — a mapped multi-word concept is matched
    and kept whole BEFORE any single-word split. "supply chain"
    never becomes the keywords ["supply", "chain"].
  * ABSTRACT_STOPLIST — words that are never search terms on their
    own (visible, work, starts, long, make, ...). Applied only to
    standalone words, never inside a mapped phrase.
  * Fragment rule — when a scene's text contains a mapped concept,
    a stock hit matching ONLY a fragment word of that concept
    ("chain" for "supply chain") is misleading and is rejected, even
    if nothing better exists: the free ladder / placeholder is
    preferable to a wrong literal.

The LLM Director's keywords pass through this layer too, so a model
slip ("chain") still gets corrected before any stock search runs.
"""

import re

# ---------------------------------------------------------------- concepts
# Phrase -> concrete visual keywords. Longer phrases match first.
# Each visual keyword is itself a Pixabay search phrase ("freight
# truck" searches as one query, not two words).
CONCEPT_MAP = {
    # logistics / supply chain family (the motivating case)
    "supply chain": ["freight truck", "shipping port", "warehouse",
                     "cargo containers", "delivery van"],
    "supply chains": ["freight truck", "shipping port", "warehouse",
                      "cargo containers", "delivery van"],
    "logistics": ["freight truck", "warehouse", "shipping port"],
    "drug shortage": ["empty shelf", "pharmacy counter",
                      "medicine bottles"],
    "drug shortages": ["empty shelf", "pharmacy counter",
                       "medicine bottles"],
    "shortage": ["empty shelf", "pharmacy counter", "warehouse aisle",
                 "medicine bottles"],
    "shortages": ["empty shelf", "pharmacy counter", "warehouse aisle",
                  "medicine bottles"],
    # pharma family
    "drug": ["pharmacy", "medicine bottles", "laboratory"],
    "drugs": ["pharmacy", "medicine bottles", "laboratory"],
    "pharma": ["pharmacy", "laboratory", "medicine bottles"],
    "pharmaceutical": ["pharmacy", "laboratory", "medicine bottles"],
    "medicine": ["pharmacy", "medicine bottles"],
    # trade / movement family
    "delivery": ["delivery van", "courier", "package"],
    "freight": ["freight truck", "cargo train"],
    "warehouse": ["warehouse aisle", "forklift"],
    "shipping": ["shipping port", "cargo ship"],
    "manufacturing": ["factory", "assembly line"],
}

# Longest first so "drug shortage" wins over "shortage", and
# "supply chains" over any single word inside it.
_SORTED_CONCEPTS = sorted(CONCEPT_MAP, key=len, reverse=True)

# Words that are never search terms on their own. These are abstract
# verbs / adjectives / glue words that produced the v2 literal
# misses ("work", "make", "visible" searched as stock keywords).
# Applied ONLY to standalone words — never inside a mapped phrase,
# and never to a word that is itself a mapped concept.
ABSTRACT_STOPLIST = {
    "visible", "visibility", "work", "works", "working", "starts",
    "start", "long", "make", "makes", "made", "take", "takes",
    "get", "gets", "become", "becomes", "thing", "things", "way",
    "ways", "point", "idea", "story", "question", "answer",
    "problem", "solution", "future", "today", "world", "people",
    "everyone", "change", "changes", "need", "needs", "want",
    "wants", "know", "think", "look", "looks", "see", "sees",
    "show", "shows", "give", "gives", "help", "helps", "keep",
    "keeps", "put", "puts", "set", "sets", "turn", "turns",
    "move", "moves", "go", "goes", "come", "comes", "find",
    "finds", "real", "true", "new", "old", "big", "small",
    "good", "bad", "important", "different", "possible",
    "hard", "easy", "first", "last", "next", "own", "able",
}

# Words with several unrelated visual senses. When one of these is a
# scene's primary keyword and no mapped concept or domain context
# disambiguates it, the question gate asks instead of guessing.
AMBIGUOUS_WORDS = {
    "chain": ["supply chain (freight / logistics)",
              "metal chain / hardware",
              "jewelry chain"],
    "wave": ["ocean wave", "hand wave", "radio wave"],
    "star": ["night sky star", "celebrity", "star shape"],
    "key": ["door key", "answer key", "piano key"],
}

# Domain cue words that disambiguate an ambiguous word even when
# they are not in the option texts ("bicycle" picks the metal-chain
# sense). Any cue present in the task text counts as context — the
# gate stays silent and the context words join the search.
DISAMBIGUATORS = {
    "chain": {"supply", "freight", "logistics", "port", "warehouse",
              "cargo", "truck", "delivery", "shipment", "container",
              "bicycle", "bike", "motorcycle", "anchor", "hardware",
              "metal", "steel", "lock", "tow", "necklace", "gold",
              "silver", "pendant", "jewelry", "bracelet"},
    "wave": {"ocean", "sea", "beach", "surf", "tide", "water", "hand",
             "hello", "goodbye", "waving", "radio", "signal",
             "frequency", "sound"},
    "star": {"night", "sky", "astronomy", "telescope", "space",
             "galaxy", "celebrity", "famous", "actor", "singer",
             "shape", "christmas", "ornament"},
    "key": {"door", "lock", "house", "car", "answer", "solution",
            "exam", "test", "piano", "keyboard", "music", "note"},
}


def _word_re(phrase):
    return re.compile(r"\b" + re.escape(phrase) + r"\b")


def _stem(word):
    """Crude singular: 'chains' -> 'chain', 'bottles' -> 'bottle'.

    Only for matching (fragment detection, disambiguation) — never
    for display. Guards the plural trap: the concept "supply
    chains" fragments to {supply, chain}, and a tag saying "chain"
    must count as that fragment.
    """
    w = (word or "").lower()
    if len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
        return w[:-1]
    return w


def find_concepts(text):
    """Mapped concepts present in text, in order of appearance.

    Returns a list of (phrase, visuals). A phrase matched once is
    not matched again, and words inside a matched phrase are not
    available for single-word use (the caller removes the matched
    spans before extracting content words).
    """
    low = (text or "").lower()
    found = []  # (position, phrase)
    claimed = []  # (start, end) spans of matched phrases
    for phrase in _SORTED_CONCEPTS:
        for m in _word_re(phrase).finditer(low):
            start, end = m.span()
            if any(start < c_end and end > c_start for c_start, c_end in claimed):
                continue
            claimed.append((start, end))
            found.append((start, phrase))
            break  # one match per phrase is enough
    found.sort()
    return [(phrase, CONCEPT_MAP[phrase]) for _, phrase in found]


def concept_spans(text):
    """Character spans of matched concept phrases (for masking)."""
    low = (text or "").lower()
    spans = []
    for phrase in _SORTED_CONCEPTS:
        for m in _word_re(phrase).finditer(low):
            start, end = m.span()
            if any(start < c_end and end > c_start for c_start, c_end in spans):
                continue
            spans.append((start, end))
            break
    return spans


def mask_spans(text, spans):
    """Replace matched spans with spaces (keeps positions stable)."""
    chars = list(text or "")
    for start, end in spans:
        for i in range(start, min(end, len(chars))):
            chars[i] = " "
    return "".join(chars)


def semantic_keywords(text, stop_words=frozenset(), limit=4):
    """Scene text -> (keywords, concepts, dropped).

    keywords: concept visuals first (each a search phrase), then
    concrete single content words, in order of appearance, deduped.
    concepts: matched concept phrases. dropped: abstract/stop words
    that were filtered out (for the question gate's "nothing
    concrete survives" check). A scene with no concept and no
    concrete word yields keywords == [] — the CALLER decides the
    fallback (the stock fetcher uses "landscape"; the question gate
    treats empty as a fork). Nothing here invents words.
    """
    concepts = find_concepts(text)
    masked = mask_spans(text, concept_spans(text))
    words = re.findall(r"[a-z][a-z\-']{2,}", masked.lower())
    keywords = []
    for phrase, visuals in concepts:
        for visual in visuals:
            if visual not in keywords:
                keywords.append(visual)
    concrete = []
    dropped = []
    for w in words:
        w = w.strip("-'")
        if len(w) < 3 or w in stop_words:
            continue
        if w in ABSTRACT_STOPLIST:
            dropped.append(w)
            continue
        if w not in concrete and w not in keywords:
            concrete.append(w)
    keywords.extend(concrete[:max(0, limit)])
    return keywords, [phrase for phrase, _ in concepts], dropped


def concept_visual_words(concepts):
    """All single words inside a scene's concept visuals."""
    words = set()
    for phrase, visuals in concepts:
        for visual in visuals:
            words.update(re.findall(r"[a-z]+", visual.lower()))
    return words


def fragment_words(concepts):
    """Words of the concept phrases themselves (the misleading bits).

    For "supply chain" this is {"supply", "chain"}: a hit matching
    ONLY these words is matching the concept's name, not its visuals.
    """
    words = set()
    for phrase, _ in concepts:
        words.update(re.findall(r"[a-z]+", phrase.lower()))
    return words


def is_fragment_only_hit(hit_tags, concepts):
    """True when a hit's tag matches are ONLY concept-fragment words.

    A hit matching any concept-visual word (freight, truck, port,
    warehouse, cargo, ...) is NOT fragment-only — it is about the
    concept's visuals. A hit matching nothing at all is not
    fragment-only either (it scores 0 on its own merits).
    Comparison is stemmed, so a tag saying "chain" counts as the
    fragment of the concept "supply chains".
    """
    if not concepts:
        return False
    tags = (hit_tags or "").lower()
    tag_words = {_stem(w) for w in re.split(r"[^a-z0-9]+", tags)}
    visual_words = {_stem(w) for w in concept_visual_words(concepts)}
    fragments = {_stem(w) for w in fragment_words(concepts)}
    matched_visual = bool(visual_words & tag_words)
    if matched_visual:
        return False
    matched_fragment = bool(fragments & tag_words)
    if not matched_fragment:
        return False
    # Matched a fragment and no visual word: misleading literal.
    return True


def score_hit_semantic(hit, keywords, concepts):
    """Relevance score with a concept-match bonus and fragment rule.

    Returns (score, fragment_only). Base scoring is the v2
    tag-overlap rule (exact word +2, substring +1 for words >= 4
    chars). Bonus: +6 per concept visual whose words ALL appear in
    the tags, +2 per concept visual with at least one word in the
    tags. A fragment-only hit scores -1: it is never downloaded
    when the scene has a mapped concept, because a wrong literal
    (chainsaw for "supply chain") is worse than the free ladder.
    """
    tags = (hit.get("tags") or "").lower()
    tag_words = set(re.split(r"[^a-z0-9]+", tags))
    flat_words = []
    for kw in keywords:
        flat_words.extend(re.findall(r"[a-z]+", kw.lower()))
    score = 0
    for w in flat_words:
        if len(w) < 3:
            continue
        if w in tag_words:
            score += 2
            continue
        if len(w) >= 4 and any(len(t) >= 4 and (w in t or t in w)
                               for t in tag_words):
            score += 1
    for phrase, visuals in concepts:
        for visual in visuals:
            vwords = re.findall(r"[a-z]+", visual.lower())
            if not vwords:
                continue
            if all(w in tag_words for w in vwords):
                score += 6
            elif any(w in tag_words for w in vwords):
                score += 2
    fragment_only = is_fragment_only_hit(hit.get("tags") or "", concepts)
    if fragment_only:
        return -1, True
    return score, False


def referenced_hook_concept(scene_text, hook_concepts):
    """The hook-level concept a scene's bare word refers back to.

    Scene 3 of the Glenride hook ("make the chain visible") has no
    concept of its own, but its word "chain" is a fragment of the
    hook-level concept "supply chains" — the scene is about that
    concept, not about chains in general. Returns (phrase, visuals)
    for the first such concept, else None.
    """
    words = {_stem(w) for w in
             re.findall(r"[a-z]+", (scene_text or "").lower())}
    for phrase, visuals in hook_concepts:
        frags = {_stem(w) for w in re.findall(r"[a-z]+", phrase.lower())}
        if words & frags:
            return (phrase, visuals)
    return None


def scene_keywords(scene_text, hook_text, stop_words=frozenset(), limit=4):
    """Hook-aware scene keywords: (keywords, concepts, dropped).

    Same as semantic_keywords, plus hook context: a single word
    that is a fragment of a hook-level concept ("chain" when the
    hook contains "supply chains") is a reference to that concept,
    not a standalone search term — it is dropped, and if the scene
    then has no keywords left, the referenced concept's visuals
    become the keywords. Without this, scene 3 of the Glenride
    hook would still search a bare "chain" and could still pick
    the chainsaw.
    """
    keywords, scene_concepts, dropped = semantic_keywords(
        scene_text, stop_words, limit)
    hook_concepts = find_concepts(hook_text)
    if not hook_concepts:
        return keywords, scene_concepts, dropped
    frag_to_concept = {}
    for phrase, visuals in hook_concepts:
        for w in re.findall(r"[a-z]+", phrase.lower()):
            frag_to_concept.setdefault(_stem(w), (phrase, visuals))
    kept = []
    frag_concept = None
    for kw in keywords:
        if " " in kw:
            kept.append(kw)  # concept visuals stay
            continue
        hit = frag_to_concept.get(_stem(kw.lower()))
        if hit:
            frag_concept = hit
            continue
        kept.append(kw)
    if not kept and frag_concept is not None:
        phrase, visuals = frag_concept
        kept = list(visuals)
        if phrase not in scene_concepts:
            scene_concepts = scene_concepts + [phrase]
    return kept, scene_concepts, dropped
