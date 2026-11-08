# Motion taste — for the LLM Director's eye, not its words

Source: Subframe Motion Library guidance, fetched 2026-10-28 from the
free motion MCP endpoint (https://mcp.subframe.com/motion/mcp — no
account). UI timings below are translated to 30fps video frames
(1 frame ≈ 33ms). This file is TASTE ONLY: it changes what the
Director prefers, never the voiceover, never the schema, never the
deterministic fallback. If this file is missing, the LLM prompt
simply carries no taste section.

## Purpose before decoration

- Every move must answer a question: where did this come from, what
  changed, what comes next. If it answers none of those, leave it out.
- One motion language per piece: shared durations, curves and
  distances, so similar elements move the same way. Never a new
  effect per scene just because it exists.
- Motion never carries meaning on its own. The voiceover and the
  captions carry the meaning; motion is enhancement. The final state
  of any shot must read with the motion removed.

## Entrances, exits, and weight

- Entrances decelerate (ease-out): fast start, gentle landing.
  Never ease-in on an entrance — it feels late.
- Exits run about a third faster than entrances. The viewer has
  already moved on; do not linger on the way out.
- Never pop from scale 0. Enter from 0.95 or above, paired with a
  fade. A fade alone feels flat; movement alone feels abrupt.
  Pair opacity with a small move or a small scale, always.
- Travel little. Reveals move a short distance and finish in
  10–15 frames. Staggers step 1–2 frames per item with the whole
  sequence under 15 frames.
- Camera moves stay modest (the deterministic Director's
  push-in/pull-back range is the model: roughly 1.00–1.14 scale).
  A camera move that calls attention to itself has failed.

## Text and numbers

- Reveal text by word or by line, never letter by letter — except
  a short display headline, where per-letter is allowed.
- Keep text readable mid-motion. Never make the viewer wait for
  important content: a typewriter-style reveal shows whole words,
  never one character at a time.
- Numbers animate from their previous value, never from zero, and
  finish within about 30 frames. Keep their width stable so the
  digits do not jitter.

## Ambient motion and backgrounds

- Ambient motion (particles, rings, drifting light) stays quiet,
  low-amplitude and slow. It is background, never the subject.
- Behind text, keep contrast with a scrim or overlay. Nothing
  flashes more than three times per second.
- An ambient loop that runs longer than a few seconds must be
  able to end gracefully; it never loops loudly enough to compete
  with the voiceover.

## Smoothness

- Animate transform and opacity, not layout. Moving a fixed-size
  element or fading a layer is cheap; resizing, reflowing or
  re-laying-out every frame is not.
- Bound the layers: a few moving elements, each with a clear job.
  A shot with everything moving at once reads as noise.

## Borrowing examples (for later, not this file)

- When adapting a library example, keep its motion mechanism and
  swap in the project's content and palette. Keep its licence
  header. Never add a whole animation library for one effect.

## This week's theme (fleet wiki, background only)
One idea, one motion language: each piece expresses a single idea in exactly one motion language, with the story gate passing before anything renders. Theme notes: fleet wiki motionbot-theme-one-idea-one-language.md. This section changes taste preference only \u2014 never the voiceover, never the schema, never the deterministic fallback. Theme notes are reference material only and never themselves an intake; renders happen only through genuine Mission Control intake.
