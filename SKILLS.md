# Motion Bot v2.2 — iart-ai motion skills

Source: https://github.com/iart-ai/motion-skills.git (index repo, MIT).
Installed packs live in `skills/` (9 packs, 30 skills, cloned 2026-10-29):

| Pack | Skills | What it adds to Motion Bot |
|---|---|---|
| motion-design-skills | 9 | Base craft, always on: easing, safe areas, loops, color, shot composition, Remotion technique |
| kinetic-typography-skills | 1 | Kinetic type: word/character stagger, title cards |
| explainer-video-skills | 5 | Explainer grammar: one idea per scene, diagram reveal, whiteboard, wrapped-style data recaps |
| tiktok-video-skills | 4 | Short-form vertical: 9:16, hook in 1s, caption animation, countdowns |
| data-animation-skills | 3 | Data: chart animation, infographic reveals, key-number counters |
| lower-thirds-skills | 1 | Transparent lower thirds / overlays |
| b-roll-skills | 1 | B-roll timed to spoken words (Narrated route) |
| ad-video-skills | 3 | Ad arcs: hook → CTA, launch films, testimonial cards |
| ecommerce-video-skills | 3 | Product demos, promos (was→now price), photo slideshows |

## How they wire in (watcher/skill_router.py)

1. **Route.** The watcher routes every task's title + details through
   `skill_route()`. Triggers are narrow and explicit — "vertical" /
   "reel" / "9:16" for short-form, "chart" / "percent" for data,
   "explain" for explainer, "ad" / "promo" for ads, "lower third"
   for overlays, "b-roll" for talking-head. A vague brief matches
   only the base craft pack; the router never guesses a format.
2. **Craft, never copy.** Matched packs add `skills`, `format`, and
   `craft_notes` to the storyboard. For narrated tasks, the matched
   skill's text (truncated) is appended to the LLM Director's system
   prompt as craft guidance — it may change HOW visuals move, never
   WHAT is said: voiceover words still come only from the hook.
3. **Format.** `format: "vertical"` renders the new `Vertical`
   composition (720x1280, 120px top / 160px bottom safe areas);
   everything else renders `Harness` (1280x720) as before.
4. **Verify loop.** After copy-back, `skill_verify` probes the MP4
   (duration / fps / resolution / codec — the iart probe-mp4 check)
   and treats a resolution or duration mismatch as a structural
   failure, same as the Critic's structural checks. The iart verify
   scripts live in `watcher/verify/` (contact-sheet, probe-mp4,
   seek-shot) for contact-sheet evidence on demand.

## What Motion Bot could NOT do before v2.2

- Vertical 9:16 clips at all (every composition was 1280x720).
- A named craft for a brief type: a chart brief, an explainer brief,
  and an ad brief all got the same generic kinetic treatment.
- Any post-render probe beyond the Critic's frame checks.

## Limits (honest)

- Skills are guidance, not new renderers: Motion Bot still renders
  code-drawn kinetic type + stock footage, not After Effects, Manim,
  or Three.js scenes. A brief asking for a true 3D scene or a
  hand-drawn whiteboard still gets the closest code-drawn treatment.
- Data skills guide pacing and counters; they do not yet parse a CSV
  into a chart — a chart brief needs its numbers in the task text.
- Lower-thirds transparency (WebM alpha) is not wired: the skill is
  craft guidance for name straps inside a clip, not a standalone
  transparent export yet.

## v2.3 additions (2026-10-29)
- Chart: data-animation craft is now a renderer, not just guidance —
  `parse_data_rows()` + Chart composition (see GOAL.md for proof).
- Lower thirds: transparent export is ProRes 4444 via PNG sequence
  (render.sh `alpha-prores`), NOT VP9 WebM — video encoders drop
  alpha; PNG stills + prores_ks mux keep it (yuva444p12le).
- Synthwave style preset (purple-free by his call): Synthwave
  composition + `synthwave-style` router entry. Palette locked:
  navy sky, cyan grid, orange/gold sun. No purple, magenta, or pink.

## Everest components (2026-11-01)

Source: https://www.everestchris.com/components ("Video components ·
Skills by Chris"). 69 components, three variants each, light and dark.
Reference file: `skills/everest-components/SKILL.md` (full catalog +
craft guidance + guardrails).

## How they wire in (watcher/skill_router.py)

One router entry per catalog category, narrow multi-word triggers
only — a brief pulls just the categories that fit it, never the
whole catalog:

| Router entry | Triggers (examples) |
|---|---|
| everest-product-ui | agent cli, tool call, chat window, permission prompt, step chips, done card, desktop agent, messaging app, prompt input |
| everest-prompts-results | prompt card, elapsed timer, failure call-out, output builds, key phrases light, local preview, creator handle |
| everest-agents-workflows | coordinator agent, sub-agents, connectors, memory surface, inbox sorts, week strip, cloud task card, SKILL.md card |
| everest-models-benchmarks | model lineup, spec picker, spec card, token chips, model versions, benchmark bars, old/new score, delta counts |
| everest-comparisons | side by side, two results, recommendation table, finish order, checklist collapses, two real app windows |
| everest-launch-news | launch post, version number ticks, who gets it, official post, system card scrolls |
| everest-pricing-limits | subscription tiers, per 1M tokens, price in/out, receipt prints, token cost, old price struck |
| everest-lower-thirds | keyword pills, corner badge, corner credit, source chip, guest/speaker name, floating keyword |
| everest-broll-frames | presenter inset, phone capture, punch-in, watch-page card, b-roll frame |
| everest-evidence-quotes | key phrase, reaction post, rest dims, slow push-in, key line highlighted |
| everest-usage-cost | usage bar/panel, limit banner, reset countdown, hits the cap |

All eleven entries share the one `skills/everest-components/SKILL.md`
file (`load_skill_text` maps any `everest-*` pack to it), so the
narrated path's first-non-base-pack detail load works for Everest
briefs exactly as for iart packs. Matched entries add `skills`,
`format`, and `craft_notes` to the storyboard the same way; format
is unchanged (landscape Harness unless a vertical trigger fires).

## Limits (honest)

- Guidance, not a renderer: components are shot descriptions, not
  code or plugins. Motion Bot recreates the pattern code-drawn in
  Remotion; it does not import real product UIs, posts, or footage.
- No fake real things: a component that shows a "real" chat window,
  post, handle, or model logo is recreated only with text the brief
  itself supplies. Nothing real is fabricated.
- No invented figures: counters, bars, receipts, and scores only
  count numbers already in the brief.
- Palette: parchment/gold by default; never purple, magenta, or
  pink. Voiceover words and scene text still come only from the
  hook; the story gate, title-is-hook, and palette footgun rules
  are untouched.

## ffmpeg-skill (2026-11-01)

Source: https://github.com/kajisho5/ffmpeg-skill (MIT), vendored
at `skills/ffmpeg-skill/` — 42 FFmpeg tools, Python standard
library only, no cloud, no API keys, workflow probe → edit →
verify, structured JSON output, plus an MCP server. Motion Bot
uses it in the post-processing + verification lane ONLY. It is
NOT a motion replacement and does NOT decide what any video
says.

### What is wired

- Verification lane: `watcher/ffmpeg_skill_verify.py` runs
  upstream `probe.py` (structured probe), `check.py`
  (platform delivery check, default platform youtube), and
  `look.py` (contact sheet, on demand). `watcher/skill_verify.py`
  `verify()` attaches the result as `ffmpeg_skill`, ADVISORY
  ONLY — its rows never change `structural_ok`, which stays
  decided by the existing ffprobe. Pass `ffmpeg_skill=False`
  to skip it; pass `ffmpeg_sheet_path` to also write a
  look sheet.
- iMac doctor (2026-11-01, `scripts/_contract.py doctor
  --json` on the iMac): ok=True, ffmpeg/ffprobe n9.0.2,
  Python 3.14.8, 42/42 tools usable "yes", missing [],
  unsupported [], unknown []. Only `missing_optional`:
  external:parakeet, external:whisper — local speech
  engines, so `caption --transcribe` and `silence --filler
  --transcribe` refuse on the iMac until an engine is
  installed; everything else runs.
- Proof (2026-11-01, on the iMac, existing clip
  `out/proof-v24-everest.mp4` — no new brief, no invented
  numbers): upstream probe 12.0s, 1280x720, 30.0 fps, h264,
  yuv420p, 360 frames, 1 video stream, 0 audio streams;
  youtube platform check ok=True, 0 failed, 3 warnings
  (colour tag bt709/iec61966-2-1 vs bt709/bt709, no
  subtitle track, no audio stream — all properties of
  that silent proof clip, not render failures); look.py
  contact sheet 1290x548 PNG, 12 frames. All three
  steps exit 0.

### Available but unwired (opt-in manual steps only)

See `skills/ffmpeg-finishing/SKILL.md`: fit to duration /
aspect, platform export templates (tiktok, reels, shorts,
youtube, x, linkedin, facebook), silence removal, karaoke
captions, loudness. No router entry auto-applies them —
the watcher has no finishing execution step — and no live
task's loudness target, caption wording, or render path
changes in this pass.

### Deliberately NOT wired or replaced

- MCP server: the watcher is a Python cron, not an MCP
  client. No npx install into ~/.claude/skills: that path
  is for coding agents, not Motion Bot.
- Alpha ProRes lower-third mux (PNG sequence → ProRes
  4444 yuva444p12le): untouched.
- Slideshow concat with timed silent segments (each
  silent segment gets a `-t`; VM ffmpeg OOMs on
  multi-input concats, the iMac handles it): untouched.
  A swap of either proven path needs a proof on those
  exact cases first.
- Story gate, title-is-hook, voiceover-words-only-from-
  hook: untouched.
- Mirror scope (honest): the VM holds the full 47 MB
  upstream clone. The iMac mirror carries the functional
  payload — scripts, templates, references, mcp, SKILL.md,
  LICENSE, package.json, docs markdown files — plus the
  new wrapper, finishing notes, and this section. The
  non-functional bulk (site, demos, assets, brand, evals,
  examples, tests, docs demo gifs) was not mirrored:
  the tailnet proxy drops sustained transfers, and none
  of it is needed to run the tools.

## Auto-Editor silence-cut + D3 charts (Nov 3 2026, opt-in only)

Two tools from the open-source motion list, wired at D'Vaughn's tap
"Wire them". Neither changes any live watcher render unless a task
explicitly asks for it — there is no new default behavior.

### Auto-Editor (silence cutting)
- Install (iMac render host only): `uv tool install auto-editor`
  → auto-editor 29.3.1, binary ~/.local/bin/auto-editor. The iMac's
  /usr/bin python3 has no pip (externally managed, ensurepip fails)
  and the mise python3.11 is uv-managed (PEP 668 refuses plain pip),
  so uv tool is the install path that survives. Requires the iMac's
  ffmpeg 9.0.2, already present. Not installed on the VM (the watcher
  runs the cut on the iMac, where the clip already lives).
- Module: watcher/auto_editor.py — builds the CLI command
  (`auto-editor <in> --edit audio --no-open -o <out>`, tool defaults:
  silence cut, 0.2s margin) and ffprobe-verifies the cut (shorter or
  equal, video kept, audio kept when the source had it).
- Opt-in label: task details must carry `Silence-cut: on`
  (parse_labels key "silence-cut"). The watcher hook sits in the
  Harness route AFTER critic PASS and BEFORE mark-done: it cuts on
  the iMac, copies back, verifies, and only then swaps the delivered
  file. Any failure keeps the original clip and is recorded in the
  run entry — a finishing step never blocks or silently degrades a
  task. Default tasks (no label) take the exact old path.
- Proof (iMac, existing clip only, no new brief): out/proof-v21-llm.mp4
  (11.008s, h264+aac) → out/proof-autoeditor-silencecut.mp4
  (7.300s, h264+aac, 3.71s of silence removed), verify() ok, md5
  identical VM/iMac. Note: auto-editor tries to open the output
  when done; --no-open suppresses that (harmless xdg-open errors
  were seen on the first proof run before the flag was added).

### D3 charts (in-composition charting)
- Install (same version both sides): d3 7.9.0, @types/d3 7.4.3
  (`npm install --save-exact d3@7.9.0`,
  `npm install --save-dev --save-exact @types/d3@7.4.3` in the repo
  on the VM and on the iMac; package.json md5 matches).
- Composition: src/D3Chart.tsx, registered in src/Root.tsx as
  "D3Chart" (1280x720, 30fps). Same props as Chart (hook, bars,
  palette, lengthSeconds, project); layout comes from d3 scales —
  scaleBand for bar x/width, scaleLinear for heights, the linear
  scale's ticks for faint gridlines. Bars still grow on a spring
  and values count up, as in Chart.
- Opt-in label: task details must carry `Chart: d3`
  (parse_labels key "chart"). Inside the existing chart rung, that
  label switches the composition from Chart to D3Chart; without it
  the default Chart rung is byte-for-byte the old path. The Chart
  composition itself is untouched.
- Proof (iMac, reused proof figures only, no new claims):
  briefs/proof-d3chart.json (ASHP Q2 2026: 227, Q3 2026: 225 — the
  v2.3 proof figures) → out/proof-d3chart.mp4, 360/360 frames,
  12.0s, 1280x720, 30fps, h264; mid-clip frame grab
  out/proof-d3chart-frame.png (1280x720 PNG, 48KB, non-blank).
  Both md5-identical VM/iMac. Palette is the parchment/gold
  default, passed explicitly in the brief.

### Limits (honest)
- Silence-cut needs an audio track: silent clips (e.g. the Everest
  proof, 0 audio streams) have nothing to cut and come back
  unchanged. It does not transcribe, caption, or loudness-normalize.
- D3Chart does not parse CSVs — bars still come from the task's
  data rows, same as the Chart rung. It adds layout, not new data.
- Story gate, title-is-hook, voiceover-words-only-from-hook, and
  the critic's structural_ok decision are untouched. No live
  Mission Control task was claimed, rendered, or marked done in
  this wiring; proofs only, local briefs only.

## Auto-story + stale-claim fix (Nov 3 2026, his call "build its own story")

- Story gate v2.5 (watcher/story_gate.py): a story-less task NO LONGER
  waits on him. auto_story() builds a 3-beat arc from the task's own
  words — existing beats first, then hook-derived scenes (words never
  invented), then method-language arc lines about how the clip itself
  is built (never topic facts). The watcher writes it visibly into
  the task details as a Story: block labeled bot-built, so he can see
  and correct it, then renders. The v2.4 ask path (posted "needed"
  decision, ask-once record) is retired; old asked-records are cleared
  when a task is auto-storied. The question gate (genuine visual forks
  on narrated tasks only) is UNCHANGED and can still ask one question.
- Stale-claim fix (watcher/watch_motion_bot.py): Mission Control PATCHes
  do not reliably set updatedAt, so in_progress tasks with no updatedAt
  were skipped by stale recovery forever (Nov 3: tasks 236-238 sat
  claimed-but-unrendered with zero history). Recovery now uses local
  claim records (watcher/claims.json, written when the watcher claims a
  task, pruned after 7 days): a task is stale when no fresh (< 3h)
  claim covers it AND updatedAt is missing or 3h+ old. A fresh claim
  always protects a mid-render task, even when updatedAt is old or
  missing. Tests: auto-story on labels-only details yields 3 beats and
  parse_story() finds 2+ in the written block; stale matrix 6/6.
- Deployed VM + iMac mirror md5-verified (watch_motion_bot.py
  7cfccb046130dd5e5be088516080d968, story_gate.py
  88aca266d4bf3625c85908438e89f9df, both sides). No live task was
  claimed or rendered by the deploy itself.

## Story-first remake + done-guard (Nov 3 2026)
- The watcher reads the WHOLE task now: story_intake.py parses the
  completionSteps beat sheet first ([BEAT n: TITLE | start - end] +
  Narrative Text + header duration/fps/viewport), then a Story: block.
  build_storyboard turns beats into scenes and takes the beat-sheet
  duration (15s for the Anti-Slop episodes — this also kills the old
  0.3s-from-banned-examples length bug for beat-sheet tasks).
- Critic story_coverage (OCR, tesseract): FAIL only when zero beats
  match on screen; SKIP when OCR is unavailable; missed beats are
  reported, not silently dropped.
- Memory: watcher/memory.py — renders, verbatim corrections, observed
  learnings. Atomic writes, never breaks a render. (Wiring the watcher
  to call record_render / learnings_summary is still owed.)
- Done-guard (mark_done): a done PATCH re-GETs the task and applies
  ONLY if status is still in_progress; when completionSteps carries a
  beat sheet, the render report is APPENDED, never a replace. This
  closes the Nov 3 10:06 race that destroyed the Anti-Slop beat
  sheets. Never revert to unconditional done PATCHes.

## Bot HQ direct interface (Nov 3 2026)
- watcher/hq_bridge.py: X-Bot-Key auth, GET /api/messages/inbox
  (fetching marks delivered — every fetched message goes to
  hq_pending.json BEFORE tasking, so a crash cannot lose it),
  POST /api/messages (in_reply_to threads replies), heartbeat with
  capabilities ["chat"], events. Key file:
  goals/motion-bot/hidden_files/bot-hq-key (600, never printed).
- Watcher step runs before the queue loop: task-NNN messages are
  corrections (verbatim into memory + appended verbatim to the task
  details, task reopened); "status"/"help" are replies, no task; all
  else becomes an MC task (project 56, title = first line,
  details + completionSteps = full body verbatim). Seen map makes
  retries idempotent — never create a second task for one HQ id.
  After the queue loop, rendered/blocked/question outcomes for
  HQ-origin tasks are replied to HQ (fail-silent; MC is the truth).
- Known limit: HQ reads a bot "idle" after 180s without heartbeat, so
  Motion Bot reads idle between 15-min runs (same cosmetic state as
  Content Engine).
