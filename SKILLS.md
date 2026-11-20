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
| b-roll-skills | 1 | B-roll timed to spoken words: BRoll comp, cuts on the noun from local pool clips, code-drawn panel fallback (v2.7) |
| ad-video-skills | 3 | Ad arcs: hook → CTA, launch films, testimonial cards — AdTemplate, one data-driven variant prop, one variable per test (v2.7) |
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

## Viral Claude Code formats (2026-11-10)

Source: Theo @theoxmotion's Oct 31 thread, "how to make viral videos
with Claude Code for $0". Checked live Nov 10: his whatif-3d-studio
and explainer-reel-studio repos 404 (account also 404 — deleted,
renamed, or private; do not build on those links). Three formats
from other creators verified live and wired here, all MIT, all as
craft guidance only — same pattern as Everest: router matches brief
text with narrow multi-word triggers, matched packs add skills /
format / craft_notes to the storyboard, narrated LLM prompts get the
matched skill text as craft guidance only. No new renderer, no
upstream engine, studio, rig, or Canvas code imported. Motion Bot
recreates the patterns code-drawn in Remotion with the brief's own
words and numbers.

| Pack | Source | What it adds |
|---|---|---|
| what-if-animation | kelano86/what-if-animation (300 stars) | 15–25 s "What If" cartoons: 7-beat formula, cold open with three escalating demos, premise title card, one real fact with a number in the turn, end on a question. 27+ cuts/min opening, one hero who never changes, storyboard self-check before animating. |
| animate-canvas | cth9191/animate (1,729 stars) | Procedural canvas animation: 7 styles (cut paper, crosshatch ink, riso, sketchbook, math, pixel, isometric), story → look → storyboard approvals before animating, shape-morph bridges, silence before the payoff / loudest on it, one constant the eye can hold, colour means one thing. Cut-paper and crosshatch render as Remotion code since v2.7 (CanvasStyles); the other five stay craft notes only. |
| motion-prompt | showheyohtaki/motion-prompt (1,899 stars) | A naming dictionary: 192 named moves in 8 packs × 24 (motion, camera, UI, landing-page, photo, motion2, lp2, camera2). Name the move with its duration, strength, and what moves; keep the spec's timings and easing, replace only words, colours, and content. |

### Router entries (watcher/skill_router.py)

| Router entry | Triggers |
|---|---|
| what-if-animation | what if episode, what-if episode, what if cartoon, dusk stick figure, stick figure episode |
| animate-canvas | cut paper, cut-paper, crosshatch ink, crosshatch-ink, riso print, sketchbook style, pixel animation, isometric animation, canvas animation, procedural animation |
| motion-prompt | motion prompt, motion-prompt, motion dictionary, mask reveal, slow dolly in, dolly in, shape morph, count-up, mask transition, jump cut, match cut, rack focus, impact shake, light sweep |

All three pack ids equal their `skills/` dir names, so
`load_skill_text` resolves them by direct lookup — no Everest-style
shared-file mapping was needed. Router test
`watcher/test_viral_formats.py`: 26 checks pass (each pack fires on
its triggers, vague briefs match base craft only, vertical + what-if
keeps the vertical format, skill text loads for all three,
single-word near-misses like "what if" / "dolly" / "motion" alone do
not fire).

### Limits (honest)

- **ElevenLabs is NOT wired.** Both what-if and animate voice with
  ElevenLabs upstream (what-if free plan ~10,000 credits/month,
  about 40 episodes, non-commercial use with credit). No
  ElevenLabs key is on file and none was provisioned. Motion Bot's
  voiceover stays on its existing path; the -14 LUFS master target
  is guidance for the mix, not a new step.
- The what-if 15–25 s pace is guidance, not a new composition:
  briefs still render through the existing Harness / Vertical /
  Narrated routes at their own lengths.
- motion-prompt is a naming dictionary, not a renderer: the catalog
  only covers individual moves. The watcher has no gallery picker
  — moves come from the brief's own words or the director naming
  them in the storyboard, never invented IDs. Never write a move
  from its name alone; the numbers live in the element's spec.
- Upstream formats F2 (chronology / morph chain) and F4 (mission)
  are the proven animate formats; the others are documented from
  study but unproven. Isometric has only its demo so far.
- Never claim the viral channels are made with Claude or any other
  tool. Nobody has said how they're made.
- No fake real things, no invented figures: facts and numbers only
  from the brief. Voiceover words and scene text still come only
  from the hook; the story gate, title-is-hook, and palette
  (parchment/gold, never purple/magenta/pink) rules are untouched.

## Panel / font / motion variety (v2.6, 2026-11-20)

The sameness correction: variants (orbit / kinetic / sweep / rise)
changed background + type size, but every clip still read as the
same centered serif paragraph. v2.6 adds three independent axes to
the Vertical composition, wired through the Director
(watcher/harness_director.py) and the storyboard JSON — not through
skill text. Skills stay text guidance; they do not render.

- **Panel** (`Panel:` label, else rotation by task id): centered |
  split | card | lower-third | word-stack. Each is a different
  composition of the same scene words.
- **Font** (`Font:` label, else rotation): serif | sans | mono.
  Stacks resolve on the iMac render host (Georgia / EB Garamond /
  Arial are NOT installed there; serif falls back to Liberation
  Serif, sans to Liberation Sans, mono to Liberation Mono).
- **Motion** (`Motion:` / `Move:` label, else rotation): kinetic |
  slide | scale | rise. `Motion:` stays the variant label; when its
  value is also a motion name it sets the motion too. `Move:` sets
  the motion only.

Defaults (centered / serif / kinetic) render exactly the pre-v2.6
look. Rotation strides differ per axis, so adjacent tasks differ in
all three. No axis changes the palette — the field follows the
brief, as always. Proof renders: briefs/proof-panel-*.json, critic
PASS each, 2026-11-20.

## Packs 1–3 as Remotion code (v2.7, 2026-11-20)

ad-video-skills, animate-canvas, and b-roll-skills each gained a
composition — craft notes alone do not count as translated. Wiring
lives in `watcher/harness_director.py` (`build_ad_variant`,
`ad_beat_scenes`, `pick_canvas_style`), `watcher/broll_timing.py`
(cut-on-the-noun timing + pool matching), and the Harness route in
`watcher/watch_motion_bot.py` (rungs after chart, before synthwave).

- **AdTemplate** (`src/AdTemplate.tsx`): variant {hook, benefit,
  proof, cta} prop, 5-beat hook → CTA, CTA hold ≥2s, `testField`
  names the one variable per variant. Variant from `Hook:` /
  `Benefit:` / `Proof:` / `CTA:` labels, else story beats; CTA
  defaults to the hook (message-matched, nothing invented).
- **CanvasStyles** (`src/CanvasStyles.tsx`,
  `src/harness/canvasStyles.tsx`): cut-paper (torn-edge layered
  sheets, offset shadows) and crosshatch (SVG hatch, boil on 2s),
  with shape-morph bridges at scene boundaries. `Style:` label
  picks the style; riso / sketchbook / math / pixel / isometric
  have no Remotion implementation and stay craft notes only.
- **BRoll** (`src/BRoll.tsx`, `watcher/broll_timing.py`): cuts on
  the noun from word timings, keyword overlay at the noun, panel
  fallback when no local pool clip matches. Pool is the Pixabay
  stock under `public/broll/` (gitignored mp4s, rsynced to the
  iMac per render); no new footage source, Pixabay search HTTP 400
  since Nov 20 16:34 ET, Pexels out by rule. Proof clips:
  `pixabay-21118.mp4` (concept match: city lights for the grid),
  `pixabay-1044.mp4` (tag match: town); 'Panels' had no clip and
  rendered as a panel.

Proof renders: `briefs/proof-v27-*.json`, critic PASS each
(ad 25s, both canvas styles 12s, b-roll 12s), 2026-11-20. The v2.6
centered proof re-rendered byte-identical after the v2.7 sync.

## Packs 4–6 as Remotion code (v2.8, 2026-11-20)

data-animation-skills, ecommerce-video-skills, and
everest-components each gained a composition (or a code path
into one) — craft notes alone do not count as translated. Wiring
lives in `watcher/harness_director.py` (`parse_data_rows`,
`build_product_demo`, `build_everest_panel`) and the Harness
route in `watcher/watch_motion_bot.py` (chart rung fires on data
rows alone; product-demo rung on the ecommerce trigger OR a
`Product:` label; everest rung on any `everest-*` route match OR
an `Everest:` label).

- **Chart / D3Chart** (`src/Chart.tsx`, `src/D3Chart.tsx`):
  count-up on the value (easeOutCubic, rounded before
  formatting, lands exactly on the final value, `tabular-nums`),
  build-and-hold pacing (1s intro hold with the axis readable,
  bars build one at a time, final hold ≥2s), axis static from
  frame 0 — never animated away from the data. `mode: "stats"`
  is the animated-infographic half (stat cards, icon pop, one
  number counting at a time, draw-on connectors).
- **ProductDemo** (`src/ProductDemo.tsx`): product-first frame,
  one feature beat per feature (cursor glide → click → ripple +
  state change on the click frame), end card with the offer and
  CTA, hold ≥2s. Props only from the task: product, features,
  offer text/code/deadline from labels; was→now only when both
  parse and now < was, `% OFF` computed, never typed twice.
  No product, no demo. Browser frame is code-drawn, never a
  fake URL; no fake deadline timer.
- **EverestPanels** (`src/EverestPanels.tsx`): 10 of 11
  categories as code-drawn panels (product-ui, prompts-results,
  agents-workflows, models-benchmarks, comparisons, launch-news,
  pricing-limits, lower-thirds, usage-cost, evidence-quotes),
  built from the brief's own words and numbers only; the builder
  returns None when a category's numbers are absent. **DROPPED
  — everest-broll-frames**: needs real footage or a real app
  screenshot; no footage source, and a code-drawn fake of a real
  app is what the skill forbids.
- **DriftBlobs** (`src/harness/primitives.tsx`): three large
  SOLID surface-color circles drifting behind every v2.8
  composition, so settled hold frames still differ by more than
  the critic's 2.0 mean diff. Solid, not translucent: a
  0.5-opacity blend counts toward neither background nor surface
  and dropped the light field to 45–49% (palette FAIL). Cards
  use `palette.surface`, never white, for the same reason.
- **Watcher LABEL_RE fix**: the watcher's local `parse_labels()`
  shadowed the director import and its old LABEL_RE listed only
  translate_to_brief keys — `Name:` (lower-thirds) and `Chart:
  d3` (D3 rung) could never parse, so both rungs were dead
  through the watcher. Fixed in v2.8.

Proof renders: `briefs/proof-v28-*.json`, critic PASS each
(chart 12s, chart-stats 12s, d3chart 12s, product 15s, promo
15s, everest-product-ui 12s, everest-benchmarks 12s),
2026-11-20. Routing simulation 8/8 (data rows → Chart, `Chart:
d3` → D3Chart, `Product:` → ProductDemo, `Everest:` label and
trigger phrase → EverestPanels, broll-frames / number-less
benchmarks → default). The v2.6 centered proof re-rendered
after the v2.8 sync, critic PASS (no byte-identical md5 check:
the pre-render file was overwritten in place first;
`src/Vertical.tsx` untouched, `primitives.tsx` only gains the
DriftBlobs export).
