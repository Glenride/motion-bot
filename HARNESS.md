# Motion Bot Harness

The creative pipeline between a Mission Control task and the Remotion
render. The old watcher only read the task **title** as the hook and
only accepted hex codes in strict `Label: value` lines — everything
else D'Vaughn wrote in the details was silently dropped (task 161's
"Background: white, gold, parchment" rendered as a bare hook + 10s).
The Harness reads the whole task and turns it into a real
motion-graphics clip: kinetic type, an animated background, camera
moves, transitions, and a code-drawn motif.

```
Mission Control task (title + full details)
        │
        ▼
Director  watcher/harness_director.py   (deterministic, no LLM/keys)
        │  named colors · mood · scenes · motif · camera plan
        ▼
Storyboard JSON  briefs/task-<id>-harness.json
        │
        ▼
Builder   src/Harness.tsx + src/harness/   (Remotion, iMac render host)
        │  kinetic words · moving gradient + particles · camera ·
        │  wipe / zoom-cut · motif · teardrops
        ▼
Critic    watcher/harness_critic.py   (frame diffs + palette + OCR)
        │
        ▼
MP4  out/task-<id>-harness.mp4  (+ .critic.json beside it)
```

## Director

`watcher/harness_director.py` — `build_storyboard(task)` takes
`{"title", "details"}` and returns the storyboard. No network, no
model, no keys: it works when the Mac Studio is down.

- **Colors.** Named colors *anywhere* in the details (not just labelled
  lines), plus hex codes, in order of appearance. Order fills roles:
  background → accent → surface. Text is **derived** for contrast
  (dark ink on light backgrounds, white/parchment on dark ones) unless
  an explicit `Text:` label gives one; if the derived text still
  contrasts below 3.0 the Director picks whichever of ink/white
  contrasts better and notes it. A light third color on a dark
  background becomes the text color.
- **No colors named (explicit fallback).** When the details name no
  color at all, the palette is dark slate background `#111827` with
  amber accent `#FFB02E` and derived text — the Director's
  deterministic fallback, not a house look. Briefs SHOULD name
  colors: the look follows the brief, and no single palette is the
  default for briefs. Never copy one palette into every brief.
- **Color map** (every mapping, also in the module's `COLOR_NAMES`):
  white `#FFFFFF` · parchment/paper `#F4EEDC` (Signalwood paper, locked)
  · cream `#FFF8E7` · ivory `#FFFFF0` · sand `#D9C7A7` · gold `#D4AF37`
  · silver `#C0C0C0` · bronze `#CD7F32` · copper `#B87333` · black
  `#0A0A0A` · ink `#1F1A14` · charcoal `#1F2937` · slate `#334155` ·
  midnight `#05080A` · soil `#0E1A10` · forest green `#3E6B3A` · deep
  forest `#24402A` · fern green / emerald `#2E7D4F` · olive `#6B7C3F` ·
  neon green `#39FF6A` · amber `#FFB02E` · amber deep `#D97E1F` · burnt
  sienna `#E97451` · sienna deep `#B84A2B` · crimson `#9B1B30` · rose
  `#E8B4B8` · navy `#0F2A43` · sky `#4FC3F7` · teal `#0F766E` · mud
  `#7A5A3A` · bark `#4A3220` · wood `#8A5A33` · forest floor `#6B4A2F`.
  **Banned, never rendered:** purple / violet / lavender / indigo /
  magenta / plum — named ones are ignored and noted, never mapped.
- **Mood.** Words like ominous / dramatic / haunting / warm / bold /
  calm / playful map to a tone + pacing (slow / medium / fast). Mood
  never overrides an explicit palette — it tunes the kinetic stagger
  and camera feel only.
- **Scenes.** The hook splits on clause breaks — em/en dashes,
  semicolons, ", except / but / that's when / and then", then a comma
  inside a segment over 8 words — into 2–4 scenes (cap by merging the
  shortest adjacent pair). Commas stay attached to the word before the
  break. The scenes' words rejoin to the hook: **no copy is invented,
  none is dropped.**
- **Motif.** From an explicit `Motif:` label, else the hook's nouns:
  mirror · clock · door · key · fox · tree · flame · wave · star ·
  crown · coin · window · orbit (fallback). Mirror carries the first
  `-ing` word as its flipped reflection (e.g. SMILING) and a tears
  flag when the hook mentions cry/tear. The motif belongs to the first
  scene naming its keyword, else scene 2 of 3+, else scene 1.
- **Variant.** One of orbit / kinetic / sweep / rise, from an explicit
  `Variant:` / `Motion:` label (exact single-word line), else rotation
  by task id. Variants change the motion language — background
  treatment + type treatment + accent-carrier geometry — in BOTH
  compositions (Harness and Vertical). They never change the palette:
  the field follows the brief's colors, the variant changes how it
  moves. Vertical honors `variant` since v2.5 (before that it
  rendered one fixed recipe for every variant).
- **Panel / font / motion (v2.6, Vertical only).** The 2026-11-20
  correction: variants changed background + type size, but every
  clip still read as the same centered serif paragraph. `Panel:`
  changes the composition of the words — centered (the pre-v2.6
  layout) | split (hook huge in accent on top, support line below,
  accent rule between) | card (words inside a bordered surface card
  offset up-left, first word as a small-caps kicker) | lower-third
  (headline + subhead anchored low, top ~60% negative space) |
  word-stack (one word per line, huge, staggered rise). `Font:`
  changes the typeface — serif | sans | mono. Each stack resolves
  on the render host: Georgia / EB Garamond / Arial are NOT
  installed on the iMac, so serif falls back to Liberation Serif,
  sans to Liberation Sans, mono to Liberation Mono (verified with
  fc-list 2026-11-20). `Motion:` / `Move:` changes how words enter
  — kinetic (word-by-word spring) | slide (whole lines slide in
  from alternating sides) | scale (words punch in place) | rise
  (words lift from below). `Motion:` stays the variant label: when
  its value is also a motion name it sets the motion too
  (kinetic/rise mean the same in both vocabularies); `Move:` sets
  the motion only and wins when both are present. Each of panel /
  font / motion rotates by task id on a different stride, so
  adjacent tasks differ in all three. Defaults (centered / serif /
  kinetic) render exactly the pre-v2.6 look. The word-stack panel
  always uses its stacked-rise entry whatever the motion prop says.
  The end card renders only on centered and card panels, where
  there is room below the words. No panel, font, or motion changes
  the palette: the field follows the brief, as always.
- **Camera + transitions.** Scenes alternate push-in / pull-back /
  push-in-closer / lateral drift; transitions alternate diagonal wipe
  / zoom-cut. Never plain fades only.
- **Length.** `Length:` / `Duration:` label first, else `Ns` anywhere
  in the details, clamped 3–60s, default 12s.
- **Labels are overrides.** `Project:` / `Subtitle:` / `Background:` /
  `Accent:` / `Text:` (hex or named) / `Mood:` / `Motif:` /
  `Length:` win over free text wherever present. Project/subtitle come
  ONLY from explicit labels — never invented, never "Motion Bot".
- **Notes.** Every storyboard carries a `notes` list explaining each
  derivation ("color 'gold' -> #D4AF37", "motif 'mirror' in scene 1…")
  so a render can always be traced back to the task text.

## Builder

`src/Harness.tsx` (composition `Harness`, registered in
`src/Root.tsx` with `calculateMetadata` from `lengthSeconds`) driven
by the storyboard; shared engine in `src/harness/`:

- `primitives.tsx` — `KineticWord` / `KineticLine` (words spring in one
  at a time, slide + scale + rotate), `MovingBackground` (gradient
  angle drifts every frame + drifting particles), `Camera` (scale +
  lateral drift), `DiagonalWipe`, `ZoomCut`, `Teardrop` / `Teardrops`.
  Generalised from the MotionTest prototype — `MotionTest.tsx` itself
  is untouched. On light backgrounds the glow runs stronger and the
  particles render in the deeper gold: bright gold on white washes out
  to pale yellow specks (measured: 0 gold pixels at full res before
  this fix).
- `motifs.tsx` — the motif library, all code-drawn divs / clip-paths
  in the storyboard palette: mirror (frame + sweeping sheen + flipped
  reflection word; wraps its scene's kinetic line inside the glass),
  clock (hands actually turn), door, key, fox (geometric), tree,
  flame (flicker), wave, star, crown, coin (shine sweep), window,
  orbit (fallback rings + travelling dot). `MotifLayer` switches on
  `motif.type`; unknown types fall back to orbit.
- Scenes split the duration evenly (remainder to the last scene).
  Font size scales with word count (88 / 76 / 64 / 52). The final
  scene carries falling teardrops when the motif says so, and an
  end-card line (project in accent + subtitle) fading in over its last
  30% when labelled. A project of "Motion Bot" / "Untitled Project"
  is treated as no project, same as Generic.

`src/Vertical.tsx` (composition `Vertical`, 720x1280) renders the same
storyboard for 9:16 — hook big and centered, 120px top / 160px
bottom safe areas, wipe / zoom-cut between scenes. It honors
`variant` (v2.5): orbit keeps the drifting-dot field, kinetic is a
flat surface field with bigger/faster type, sweep gets swaying
accent bands, rise drops the dots and lifts the words from below.
Since v2.6 it also honors `panel` / `font` / `motion` (see Director
above): five panel layouts, three typefaces that resolve on the
iMac, four word-entry motions. New primitives in
`src/harness/primitives.tsx`: `SlideLines`, `ScaleLine`, `StackLine`,
plus the `FONTS` map and `resolveFont`. The clip-level accent
carrier (`AccentMark`, outside the scene cameras) follows
`palette.accent` and varies by variant — top bar for orbit/kinetic,
bottom bar for sweep, left rail for rise. Motifs do not render in
Vertical (the motif library is sized for
landscape); the palette still follows the brief.

`Generic.tsx` and `Signalwood.tsx` are untouched. The Harness is one
more composition, not a replacement.

## Watcher routing

`watcher/watch_motion_bot.py` (cron `motion-bot-watcher`, every
15 min): claim-first unchanged, empty title still blocks asking for
the hook. Per task:

1. Signalwood (explicit `Project: Signalwood`) → Signalwood path,
   unchanged.
2. **Narrated** (title or details contain "narrated" or "voiceover")
   → **Narrated first**: Director → narrated storyboard (voiceover
   text + stock keywords per scene) → delta-sync `src/` to the iMac
   → `prepare` on the iMac (stock fetch + Edge-TTS + captions) →
   enriched storyboard back → render `Narrated` → MP4 + global
   subtitles.srt back md5-verified → Critic (narrated checks).
3. Everything else → **Harness first**: Director → storyboard JSON →
   delta-sync `src/` to the iMac → render `Harness` → MP4 back
   md5-verified → Critic.
4. If any Narrated step fails → **Harness fallback** (same pattern
   as Harness → Generic); if any Harness step fails → **Generic
   fallback**, logged in the summary and noted in the task's
   completionSteps ("Generic fallback: …"). A render is never blocked
   by a pipeline step alone.
5. If the Critic fails **structurally** (identical frames, blank
   frames, wrong probe — plus, for narrated, missing voiceover or
   missing captions) the task is blocked with the critic detail — a
   broken video is not shipped via fallback. Cosmetic critic
   failures (palette / contrast / OCR) are noted in the completion
   note and the render stands.

## Critic

`watcher/harness_critic.py <mp4> <storyboard.json>
[--imac-mp4 <iMac path>]` — writes
`out/<name>.critic.json`, exit 0 on PASS, 1 on FAIL. Checks:

| Check | What it measures | Pass bar |
|---|---|---|
| probe | ffprobe duration / 1280×720 / 30fps vs storyboard | duration ±0.6s |
| frames_differ | mean abs pixel diff /255 between mid-scene samples + last frame | every pair > 2.0 |
| palette_present | pixel % per palette color at 320×180; background+surface as one light-field union; accent+accentDeep as one accent family | light field >50% every frame; text >0.02% every frame; accent family >0.02% in ≥ half the frames |
| not_blank | pixel stddev per sampled frame | > 5 |
| text_contrast | WCAG contrast text vs background from the palette | ≥ 3.0 |
| ocr_no_self_mention | tesseract on the sampled frames (local, else the iMac copy — tesseract lives on the iMac) | no "motion bot" / "untitled project" |
| storyboard_no_self_mention | same two strings in the storyboard text | none |
| audio_present *(narrated only)* | ffprobe audio stream + ffmpeg volumedetect mean volume | stream present, mean > -60 dB |
| captions_present *(narrated only)* | cue count in the global subtitles.srt sidecar | > 0 cues |

Narrated storyboards (`narrated: true`) skip palette_present and
text_contrast (stock footage has no palette) and gain the two
narrated-only checks above; both are STRUCTURAL (a narrated clip
with no real voiceover or no captions blocks the task). Sampling
for narrated clips uses each scene's real durationSeconds for
midpoints instead of an even split.

Sampling is mid-scene, not fixed clock times: a sample 0.3s into a
scene catches words still fading in and reads 0% text. Tolerances:
RGB distance ≤ 30 per color, except accentDeep ≤ 60 (it only ever
appears blended — reflection at 0.75 opacity, teardrop gradients).

## Proof — task 161

Re-rendered through the Harness (MC task 161 untouched, already done):
`out/task-161-harness.mp4`, 10s, 1280×720, 30fps, 1,345,039 bytes,
md5 `aa228b97bb30df6362b20d42299616ff` (identical on the iMac).
Storyboard `briefs/task-161-harness.json`: white `#FFFFFF` /
gold `#D4AF37` / parchment `#F4EEDC`, ink text `#1F1A14`, 3 scenes,
mirror motif scene 1 with reflection SMILING, tears in scene 3.
Critic **PASS**: frame diffs 22.38 / 5.43 / 6.36; light field ~83%
every frame; accent family in 4/4 frames; text 0.59–1.05% every frame;
contrast 17.3; OCR reads the hook words ("every mirror in your
house", "except when you turn your back", "that's when it starts to
cry.") with no banned strings.

## Proof — panel / font / motion variety (v2.6, 2026-11-20)

Same story + palette as task 391 (sand `#D9C7A7`, surface `#4FC3F7`,
accent teal `#0F766E`, ink `#1F1A14`, 3 scenes, 12s, 720x1280), one
render per new panel, each a different font + motion — so the only
differences are panel / font / motion. All rendered on the iMac,
critic **PASS** each, exit 0:
- centered / serif / kinetic (control): `out/proof-panel-centered.mp4`,
  521,495 B, diffs 2.90 / 5.09 / 2.99.
- split / sans / slide: `out/proof-panel-split.mp4`, 649,545 B,
  diffs 3.47 / 4.37 / 5.51.
- card / mono / scale: `out/proof-panel-card.mp4`, 565,189 B,
  diffs 2.52 / 3.45 / 3.64.
- lower-third / serif / rise: `out/proof-panel-lower-third.mp4`,
  529,581 B, diffs 2.17 / 4.64 / 3.65.
- word-stack / sans / kinetic: `out/proof-panel-word-stack.mp4`,
  653,105 B, diffs 6.74 / 6.05 / 7.24.
Contrast 10.42 on all five. Frame grabs in
`out/proof-panel-frames/` (2s + 6s per panel) show the layouts,
letterforms, and entries are visibly different. Briefs:
`briefs/proof-panel-*.json`.

## Packs 1–3 as Remotion code (v2.7, 2026-11-20)

ad-video-skills, animate-canvas, and b-roll-skills are no longer
craft notes only — each has a composition in `src/`, registered in
`src/Root.tsx`, and a rung in the watcher's Harness route (after the
chart rung, before synthwave). Defaults are unchanged when no pack
is selected (centered / serif / kinetic, Harness or Vertical).

- **AdTemplate** (`src/AdTemplate.tsx`, 720×1280, 25s default) — the
  ad-video-skills template: one `variant` prop {hook, benefit,
  proof, cta} drives the 5-beat anatomy (hook 0–12%, context
  12–32%, payoff 32–64%, proof 64–88%, CTA 88–100%, hold ≥2s at
  25s). Layout/motion/timing are identical across rows; `testField`
  (default `hook`, from a `Test:` label) names the one variable
  under test. The watcher builds the variant from explicit
  `Hook:` / `Benefit:` / `Proof:` / `CTA:` labels, else the story
  beats (beat 1 = hook, beat 2 = benefit, beat 3 = proof); the CTA
  defaults to the hook text — message-matched by construction, and
  no product, price, or claim is ever invented. Length is the
  task's own when it fits the 15–30s anatomy, else 25s.
- **CanvasStyles** (`src/CanvasStyles.tsx` + `src/harness/
  canvasStyles.tsx`, 720×1280, 12s) — animate-canvas, two styles as
  real code: **cut-paper** (torn-edge layered sheets with offset
  shadows, words on a torn surface card) and **crosshatch**
  (SVG hatch strokes that boil on 2s, one accent sun, sketchy
  underline). Shape-morph bridges (`MorphBridge`, ~1.2s, a circle
  window growing to cover the frame and shrinking open as a rounded
  square) sit at each scene boundary. A `Style:` label picks the
  style; riso / sketchbook / math / pixel / isometric have no
  Remotion implementation and stay craft notes only (the router
  returns None for them — never a wrong style).
- **BRoll** (`src/BRoll.tsx`, 1280×720, 12s) — b-roll-skills timing:
  segments cut on the noun (boundaries at noun timestamps from
  `watcher/broll_timing.py`), keyword overlay revealing exactly at
  the noun, code-drawn panel fallback when no pool clip matches.
  Clips come only from the local pool (`public/broll/`, Pixabay
  stock downloaded 2026-11-20); the watcher rsyncs each used clip
  to the iMac's `public/broll/` before rendering. The BRoll
  storyboard carries **no palette key**, so the critic SKIPs
  palette/contrast (footage has no palette) — same rule as
  narrated clips. Footage limit: Motion Bot has no footage source
  of its own; Pixabay search is HTTP 400 since Nov 20 16:34 ET,
  Pexels is out by his rule, no new keys.

Proof (same task-391 story + palette as v2.6, all rendered on the
iMac, critic **PASS** each, exit 0):
- ad: `out/proof-v27-ad.mp4`, 675,652 B, 25s, diffs
  9.28 / 19.96 / 21.25 / 14.64 / 2.70.
- cut-paper: `out/proof-v27-canvas-cut-paper.mp4`, 564,495 B,
  diffs 6.63 / 7.91 / 3.20.
- crosshatch: `out/proof-v27-canvas-crosshatch.mp4`, 2,048,414 B,
  diffs 11.91 / 7.88 / 3.02.
- b-roll: `out/proof-v27-broll.mp4`, 4,276,111 B — segment 1 panel
  (no solar-panel clip in the pool), segment 2 clip
  `pixabay-21118.mp4` (concept match: city lights stand in for the
  grid), segment 3 clip `pixabay-1044.mp4` (tag match: town);
  diffs 128.04 / 62.68 / 11.65.
Regression: `out/proof-panel-centered.mp4` re-rendered after the
v2.7 sync — byte-identical md5 to the v2.6 file, critic PASS.

## Packs 4–6 as Remotion code (v2.8, 2026-11-20)

data-animation-skills, ecommerce-video-skills, and
everest-components are no longer craft notes only — each has a
composition (or a code path into one) in `src/`, registered in
`src/Root.tsx`, and a rung in the watcher's Harness route.
Defaults are unchanged when no pack is selected (centered / serif
/ kinetic, Harness or Vertical).

- **Pack 4 — Chart / D3Chart** (`src/Chart.tsx`,
  `src/D3Chart.tsx`, 1280×720, 12s) — data-animation-skills:
  count-up on the value (`countUp` in `Chart.tsx`, easeOutCubic,
  interpolates then rounds before formatting, lands exactly on the
  final value, `tabular-nums`), frame-accurate numbers, build-and-
  hold pacing (1s intro hold with the axis readable first, bars
  build one at a time, final hold ≥2s). The axis never animates
  away from the data: the max tick + unit label are static from
  frame 0. `mode: "bars" | "stats"` — stats mode is the
  animated-infographic half (stat cards in a row, icon pop, one
  number counting at a time, draw-on connectors). The watcher
  chart rung fires on `Data:` rows ALONE — a task carrying data
  rows is a data task, no trigger words needed
  (`watcher/harness_director.py: parse_data_rows`, also parses
  `Label: number` pairs on one line; bare numbers without a label
  are rejected). `Unit:` / `Mode:` labels pass through; `Chart:
  d3` opts into the D3Chart rung (same count-up, same holds).
- **Pack 5 — ProductDemo** (`src/ProductDemo.tsx`, 1280×720,
  15s default) — ecommerce-video-skills: product-first frame
  (0–15%), one feature beat per feature (15–78%, cursor glides
  on smoothstep then a click at 45% of the beat → ripple +
  chip highlight + the browser-frame state line changes on the
  click frame), end card (78–100%, hold ≥2s) with the offer and
  a CTA button with a shine sweep. Props come only from the task
  (`watcher/harness_director.py: build_product_demo`): product
  from a `Product:` label (else the title when the ecommerce
  trigger matched), features from `Features:` / `Feature:` lines
  (else story beats 2+, capped at 4), offer text/code/deadline
  only from labels, was→now only when both parse and now < was
  — the strike draws first, then the price counts down from
  was, `% OFF` is computed from was/now, never typed twice.
  No product, no demo: the builder returns None and the task
  keeps the default route. The browser frame is code-drawn
  (traffic-light dots + product name as the window title, never
  a fake URL); a deadline renders only when supplied, never a
  fake timer. The watcher rung fires on the ecommerce trigger
  OR a `Product:` label.
- **Pack 6 — EverestPanels** (`src/EverestPanels.tsx`,
  1280×720, 12s default) — everest-components: 10 of 11
  categories as code-drawn panels, one `category` prop:
  product-ui (typed prompt, step chips ticking done, done line),
  prompts-results (prompt card + staged output + elapsed timer),
  agents-workflows (coordinator rows with per-row progress +
  merged summary), models-benchmarks (bars grow old→new, delta
  counts up via `countUp`, winner takes accent), comparisons
  (two windows, running timers, winner ticks / loser dims),
  launch-news (mark + name + version tick in, tiers light up),
  pricing-limits (recommended tier lifts, old price struck,
  receipt prints line by line), lower-thirds (name + role settle,
  keyword pills, corner credit only when a project is named),
  usage-cost (usage bar to the cap, limit banner only at the
  cap, reset countdown only when supplied), evidence-quotes
  (styled card, slow push-in, rest dims as the highlight lands).
  Every panel is built from the brief's own words and numbers
  only (`watcher/harness_director.py: build_everest_panel` —
  per-category requirements, returns None with a note when the
  numbers are absent, never an invented figure). **DROPPED —
  everest-broll-frames**: every pattern needs real footage or a
  real app screenshot; Motion Bot has no footage source of its
  own and a code-drawn fake of a real app is what the skill
  forbids (recorded in `EverestPanels.tsx` header and
  `harness_director.py: EVEREST_DROPPED`). The watcher rung
  fires on any `everest-*` route match OR an `Everest:` label —
  the label alone is a trigger, because the router's everest
  triggers are narrow multi-word phrases that a bare label
  would never match (v2.8 routing fix, found by a simulation
  test: `Everest: models-benchmarks` + `Benchmark:` lines
  routed to the default before the fix).
- **Shared motion — DriftBlobs** (`src/harness/primitives.tsx`):
  three large surface-color circles drifting on sine/cosine
  paths, behind every v2.8 composition, so a settled hold frame
  still differs from the next by more than the critic's 2.0
  mean diff. Two lessons, both measured: (1) small slow blobs
  (first pass) moved too little between samples and failed every
  hold pair — the edge has to travel ~20px at the critic's 320px
  sample scale between samples 1.5s apart; (2) translucent blobs
  (second pass) fixed the diffs but dropped the light field to
  45–49% and failed palette_present — a 0.5-opacity blend sits
  within tolerance of neither background nor surface, so it
  counts toward neither. The blobs are SOLID surface color, so
  they count as surface and help the light field. Same rule
  inside EverestPanels: cards use `palette.surface`, never
  white — a white card is neither background nor surface within
  tolerance and held the light field at 46%.
- **Watcher LABEL_RE fix (v2.8)**: the watcher's local
  `parse_labels()` shadowed the director import and its old
  LABEL_RE listed only translate_to_brief keys — the Harness
  route's `Name:` (lower-thirds rung) and `Chart: d3` (D3 rung)
  labels could never parse, so both rungs were dead through the
  watcher. The watcher's LABEL_RE now carries name, role, chart,
  unit, mode, product, everest (comment at the LABEL_RE).

Proof (task-391 palette; data from `briefs/proof-v23-chart.json`
— ASHP quarterly count Q2 2026: 227, Q3 2026: 225; product/offer
from the record — The First Build $75/hr founding rate, Early
Fox bundle $79 → $22.50, code EARLYFOX26, ends Fri Nov 27 2pm
ET; all rendered on the iMac, critic **PASS** each, exit 0):
- chart: `out/proof-v28-chart.mp4`, 334,622 B, 12s, diffs
  12.36 / 19.38 / 5.08.
- chart-stats: `out/proof-v28-chart-stats.mp4`, 347,922 B, 12s,
  diffs 19.58 / 18.37 / 4.89.
- d3chart: `out/proof-v28-d3chart.mp4`, 307,292 B, 12s, diffs
  10.74 / 13.29 / 4.14.
- product: `out/proof-v28-product.mp4`, 615,994 B, 15s, diffs
  15.22 / 13.59 / 10.52 / 38.73 / 7.15.
- promo: `out/proof-v28-promo.mp4`, 602,994 B, 15s, diffs
  24.67 / 40.16.
- everest-product-ui: `out/proof-v28-everest-product-ui.mp4`,
  330,013 B, 12s, diffs 15.38 / 15.54 / 3.34.
- everest-benchmarks: `out/proof-v28-everest-benchmarks.mp4`,
  323,297 B, 12s, diffs 16.82 / 23.24 / 5.32.
Routing simulation (replicates the watcher elif chain with the
real `route()` / builder functions): 8/8 — data rows alone →
Chart, `Chart: d3` → D3Chart, `Product:` label → ProductDemo,
`Everest:` label and trigger phrase → EverestPanels,
broll-frames and number-less benchmarks → default route.
Regression: `out/proof-panel-centered.mp4` re-rendered after the
v2.8 sync, critic PASS (diffs 2.90 / 5.09 / 2.99). No
byte-identical md5 check this time: the pre-render file was
overwritten in place before the comparison was taken (v2.7's
byte-identical check compared against the on-disk file first);
`src/Vertical.tsx` is untouched and `primitives.tsx` only
gains the DriftBlobs export, so the render path is unchanged.

## Packs 7–9 as Remotion code (v2.9, 2026-11-20)

explainer-video-skills, ffmpeg-finishing, and ffmpeg-skill are
no longer craft notes only — the explainer has a composition in
`src/`, registered in `src/Root.tsx`, with a rung in the
watcher's Harness route; the two ffmpeg packs have real
post-render code that runs on the iMac. Defaults are unchanged
when no pack is selected (centered / serif / kinetic, Harness
or Vertical).

- **Pack 7 — Explainer** (`src/Explainer.tsx`, 1280×720,
  15s default = 3 ideas × 4s + 3s end card) —
  explainer-video-skills: one idea per scene, build-and-hold
  pacing (each idea builds step by step, then holds ≥1s), the
  VO line is the spine (captions are the line itself, driven
  from the same timing array as the scene cuts), end-card recap
  (every idea restated + one CTA, hold ≥2s). Three code-drawn
  styles, one `style` prop: diagram (nodes appear with a
  back-out spring, then edges draw on via stroke-dashoffset
  with `pathLength="1"`, then labels — nodes → edges →
  labels, one node per idea, diagram complete only on the
  last scene); whiteboard (one open stroke per idea — circle,
  swoosh, arrow — drawn via stroke-dashoffset with a
  code-drawn marker nib riding the exact tip, the tip position
  computed from the same progress value that drives the
  dashoffset; the nib lifts between strokes and during holds;
  no fills, so no fill can precede an outline); isometric
  (2:1 dimetric blocks, axes ~26.57°, stacked bottom-up, one
  block per idea, shaded top-light / left-mid / right-dark
  from one fixed light, no perspective shrink, no scaling to
  fake height). Props come only from the task
  (`watcher/harness_director.py: build_explainer`): ideas
  from `Idea:` / `Step:` labels (else story beats, capped at
  4), style from a `Style:` label (diagram / whiteboard /
  isometric + aliases, else the task text, else diagram), CTA
  from `Cta:` else the hook. No ideas, no explainer: the
  builder returns None and the task keeps the default route.
  The watcher rung fires on the explainer trigger; the
  `Style:` / `Finish:` labels were added to the watcher's
  LABEL_RE (v2.8's fix pattern — the rung labels must parse).
  wrapped-video is NOT a separate composition: its grammar is
  the same build-and-hold + end-card shape and its count-up
  already lives in Chart/D3Chart (v2.8) — a Wrapped-style
  brief routes to Chart stats mode. **Measured lesson:**
  the first v2.9 renders used a bg→surface gradient
  background and failed palette_present (light field 42–52%
  — gradient blends count toward neither color); a solid
  background (the v2.8 Chart/ProductDemo pattern) holds it
  at 90–96%.
- **Pack 8 — finishing** (`watcher/finishing.py`, 1280×720
  unchanged unless a preset reframes) — ffmpeg-finishing:
  fade in/out 0.5s (video tfade + audio afade when an audio
  track exists), -14 LUFS loudness (single-pass loudnorm,
  video copied), midpoint thumbnail, platform presets
  (reels/shorts pad to 1080×1920; youtube/x/linkedin/
  facebook keep 1280×720). Runs on the iMac only, after a
  render, only when a brief explicitly requests it — a
  `Finish:` label in the task details (the watcher runs it on
  the iMac, rsyncs the finished file back, and swaps it in
  only after the probe check) or `./render.sh … "" finish`
  by hand. Never overwrites the source
  (`<stem>-finished.mp4`); refuses alpha-channel inputs so
  the ProRes lower-third mux is never finished over; the
  output is probe-verified (duration within 0.15s, dims as
  expected) before it swaps in, and any failure keeps the
  original clip and is recorded, never blocks. Loudness is
  SKIPPED with a note on audio-less clips (most Motion Bot
  renders have no audio) — never faked. The router carries
  a narrow `ffmpeg-finishing` entry (`Finish:`, `loudness`,
  `fade in/out`) so the craft note rides along; it never
  auto-applies.
- **Pack 9 — ffmpeg subset** (`watcher/ffmpeg_tools.py`) —
  ffmpeg-skill, 42 scripts upstream, 8 subcommands shipped:
  probe, trim (frame-accurate re-encode; --copy is a
  keyframe-limited stream copy), scale (pad/crop/stretch),
  concat (concat demuxer, stream copy when codecs match),
  loudness (single-pass loudnorm, refuses audio-less input),
  burn-subs (libass, Liberation Sans, wording exactly as in
  the SRT; --mode mux for toggleable subs), thumbnail, export
  presets (youtube/reels/shorts/x/linkedin/facebook/gif/
  proxy). Every command takes --dry-run (prints the exact
  ffmpeg command, writes nothing) and --json; `scope` prints
  the shipped vs out-of-scope list. **Out of scope:**
  silence/filler removal + transcribe (no speech engine
  installed on the iMac — parakeet/whisper absent, no
  installs without his tap); stabilize/denoise/deinterlace,
  color/LUT grading (camera-footage/taste tools, not a render
  path); multicam/sync, HDR/Dolby/360, redact,
  waveform/audiogram (no such source material);
  scenes/highlights ranking (loudness, not meaning); batch/
  report HTML (the watcher/critic already do those); raw
  ffmpeg passthrough (forbidden by the upstream skill).
  **Measured fix:** trim first shipped with -ss before -i,
  which made --end count from the seek point (2–8 cut 8s,
  not 6s); -ss/-to are output options now (2–8 cuts exactly
  6.0s, verified on the iMac).

Proof (task-391 palette; all rendered on the iMac, critic
**PASS** each, exit 0):
- explainer-diagram: `out/proof-v29-explainer-diagram.mp4`, 662,369 B, 15s, diffs 18.44 / 27.62 / 24.05 / 11.03, light field 90–95%.
- explainer-whiteboard: `out/proof-v29-explainer-whiteboard.mp4`, 605,497 B, 15s, diffs 17.29 / 26.65 / 22.59 / 11.03.
- explainer-isometric: `out/proof-v29-explainer-isometric.mp4`, 642,184 B, 15s, diffs 17.38 / 25.83 / 24.27 / 11.03.
- finished: `out/proof-v29-explainer-diagram-finished.mp4`, 695,898 B, 15s, diffs 18.44 / 27.62 / 24.05 / 11.04, critic PASS; thumbnail `out/proof-v29-explainer-diagram-finished.jpg`, 41,871 B; steps run: video fade in/out 0.5s + thumbnail; loudness skipped (no audio track).
- export-reels: `out/proof-v29-export-reels.mp4`, 620,411 B, 1080x1920, 15s (probe-verified).
- trimmed: `out/proof-v29-trimmed.mp4`, 243,362 B, 6.0s (probe-verified).
- concat: `out/proof-v29-concat.mp4`, 1,267,153 B, 30.0s, stream copy (probe-verified).
- captioned: `out/proof-v29-captioned.mp4`, 748,391 B, 15s, SRT burned in (Liberation Sans), critic PASS (diffs 21.91 / 30.67 / 27.60 / 10.29).
- loudness: tone clip -21.8 LUFS -> -14.0 LUFS (target -14.0, measured with ebur128); refused cleanly (exit 1) on an audio-less clip.
Routing simulation 4/4 — explainer task + `Style: whiteboard` → Explainer/whiteboard, 3 ideas, 15s; no-ideas explainer → None (default route); task-391 text matches no ffmpeg pack; `Finish:` → ffmpeg-finishing.
Regression: `out/proof-panel-centered.mp4` re-rendered after the
v2.9 sync, critic PASS (diffs 2.90 / 5.09 / 2.99 — identical to
v2.8). `src/Vertical.tsx` is untouched.

## Packs 10–12 as Remotion code (v2.10, 2026-11-20)

kinetic-typography-skills, lower-thirds-skills, and
motion-design-skills are no longer craft notes only — each has
real primitives / compositions / router and watcher wiring.
Defaults are unchanged when no pack is selected (centered /
serif / kinetic word-by-word, Harness or Vertical).

- **Pack 10 — Kinetic reveals** (`src/harness/primitives.tsx`:
  `CharStaggerLine`, `MaskRevealLine`, `BlurInLine`,
  `ClipWipeLine`, `ArcText`, dispatcher `KineticReveal`) —
  kinetic-typography-skills. The v2.6 KineticLine is
  word-by-word; these are the pack's other workhorse reveals,
  each a real primitive with the skill's own timings
  (per-fragment 400-600ms, stagger lines 60-100ms, words
  40-70ms, characters 20-40ms = 1 frame at 30fps, total
  reveal capped near ~800ms, ease-out entries via
  `applyEasing("easeOut")`): char stagger (per-character
  fade + rise, 1-frame offset; falls back to mask above 60
  characters — long copy would feel busy), mask/clip reveal
  (line in `overflow:hidden`, child `translateY(110%) -> 0`),
  blur-in (`blur(12px) -> 0` + opacity, per word), clip-path
  wipe (`inset(0 100% 0 0) -> inset(0)`, glyphs never move),
  text-on-path (SVG `textPath` on a gentle arc,
  `startOffset` 100% -> 0%; falls back to mask above 28
  characters so nothing clips mid-word). Splits carry
  `aria-label` on the container + `aria-hidden` on the
  fragments. Selected by an explicit `Kinetic:` label
  (`word | char | mask | blur | wipe | path`) — `pick_kinetic`
  in `watcher/harness_director.py` — or a `Motion:` / `Move:`
  value naming a reveal; there is NO rotation, so a clip
  with no label renders the v2.6 word line exactly as before.
  The reveal replaces the v2.6 motion choice for that clip
  (`Vertical.tsx: renderWords`, `Harness.tsx: Scene`).
  Fonts are the installed Liberation stacks only (see v2.6).
  **DROPPED:** variable-font animation and per-character
  morph — no variable font is installed on the render host
  (`fc-list`, 2026-11-20: zero families match "variable";
  Liberation Serif/Sans/Mono are static weights), so a
  wght-axis animation would clamp silently.
- **Pack 11 — Lower thirds, first-class**
  (`src/LowerThird.tsx`: `LowerThirdOverlay`,
  `LowerThirdStrap`; `src/Vertical.tsx`, `src/Harness.tsx`)
  — lower-thirds-skills. The v2.3 standalone transparent
  overlay is now a shared strap: name + role slide in and
  settle, keyword pills (up to 4, `Pills:` label, staggered
  in after the name settles), corner source credit
  (`Source:` label), in/out in 11 frames (the skill's "under
  12 frames" rule; v2.3 shipped 15), first and last frames
  empty (opacity hits 0 two frames before the end), text on
  its own backing panel, long names shrink to fit, inside the
  6% title-safe margin (landscape) or the 9:16 safe areas
  (vertical: left 43px, bottom 230px). Wiring, verified live
  by simulation: a bare `Name:` label now routes the pack
  (router trigger `\bname\s*:` added) AND fires the watcher
  rung (the rung condition dropped the
  `lower-thirds-skills in route` requirement — v2.8's LABEL_RE
  fix pattern: `Pills:` / `Source:` added to the watcher's
  LABEL_RE too). The Director passes `name` / `role` /
  `pills` / `source` into the storyboard, so a Vertical short
  or Harness clip with a `Name:` label carries the strap
  in-clip (`LowerThirdOverlay`, layout vertical/landscape);
  in Harness the strap suppresses the project end card (the
  strap IS the identification). The standalone export is
  unchanged in shape: 1280x720, ProRes 4444 alpha.
- **Pack 12 — Motion-design core**
  (`src/harness/motionDesign.tsx`, shared module; used by
  `primitives.tsx`, `Vertical.tsx`, `Harness.tsx`) —
  motion-design-skills, always on in the router. Easing
  library: named curves with the skill's exact values
  (`easeOut` 0.16,1,0.3,1; `easeIn` 0.7,0,0.84,0;
  `easeInOut` 0.65,0,0.35,1; `overshoot` 0.34,1.56,0.64,1;
  `linear` for loops only) via a real cubic-bezier solver
  (`applyEasing`); the primitives, the logo reveal, and the
  camera drive use it — the camera's progress is now
  ease-in-out (shot-composition: camera moves use
  ease-in-out, never linear), and each clip's mood tone
  picks a motion personality (playful 4-beat/overshoot,
  premium 8-beat/easeOut, corporate 8-beat/easeInOut,
  energetic 2-beat/overshoot) whose easing the kinetic
  reveals settle with. Beat-sync timing: `BPM:` label
  (40-240) snaps scene starts to the beat grid
  (`frames_per_beat = (60/BPM)*fps`; `sceneStarts` keeps the
  even split when no BPM is set). Color-motion: OKLab
  interpolation (`mixOklab`, standard sRGB<->OKLab
  matrices — never raw sRGB, so midpoints stay vivid);
  `ColorMotionWash` grades the clip along an OKLab path
  (accent -> surface -> accentDeep -> accent, 0.18 opacity)
  and `tintedBackground` drifts the frame background
  bg -> surface, capped so the rendered background never
  strays more than 24 RGB units from the storyboard
  background (inside the critic's 30-unit tolerance).
  Logo animation: `LogoReveal` — one technique per logo,
  stroke draw-on (sphere + orbit ring, `pathLength="1"`,
  ~1.2s, ease-in-out) then the wordmark settles last
  (per-letter mask stagger); the mark is code-drawn with the
  brief's own wordmark (`Logo:` label, end card in Vertical
  and Harness). Motion backgrounds: `MeshGradient`
  (drifting radial blobs, kinetic variant),
  `ConstellationLines` (dots + near-neighbour lines, orbit
  variant, alongside the existing PortraitDots),
  `ParallaxChip` (foreground layer at 1.2x, blurred, below
  the text). Shot composition: 9:16 safe areas are now the
  skill's numbers (top 12% / bottom 18% / sides 6% —
  Vertical content padding 154px / 230px / 48px, was
  120/160px) with `SAFE_16_9` / `SAFE_9_16`, thirds power
  points, and the 0.2x / 0.6x / 1.2x parallax speeds. The
  v2.6 panels/motions are extended, not duplicated. The
  default palette moved to `DEFAULT_PALETTE` in
  `primitives.tsx` — Harness importing LowerThirdOverlay
  while LowerThird imported `HARNESS_DEFAULTS` from Harness
  was a module cycle that crashed the bundle
  ("Cannot access 'HARNESS_DEFAULTS' before
  initialization"); the palette now lives where both can
  reach it without a cycle. **DROPPED:** After Effects
  itself (expressions, MOGRTs, Render Queue / AME recipes,
  ExtendScript) — Motion Bot renders in Remotion, not AE;
  the export half is already covered by ffmpeg-finishing
  (v2.9). The Glenride camel / D'Vaughn sphere as a drawn
  mark: no SVG asset of either mark is available to the
  renderer (the camel PNG lives outside the repo, and a PNG
  cannot draw on — only fade/scale in); `LogoReveal` draws
  the generic sphere + orbit mark instead, and takes a real
  SVG path when one lands in `public/`.

Proof (task-391 story + palette; all rendered on the iMac,
critic **PASS** each, exit 0, unless noted):
- kinetic-mask: `out/proof-v210-kinetic-mask.mp4`, 695,011 B,
  12s, diffs 5.64 / 6.39 / 3.83, light field 84–92%.
- kinetic-char: `out/proof-v210-kinetic-char.mp4`, 692,792 B,
  12s, diffs 5.71 / 8.10 / 4.06.
- kinetic-wipe: `out/proof-v210-kinetic-wipe.mp4`, 679,734 B,
  12s, diffs 5.65 / 6.40 / 3.81.
- kinetic-blur: `out/proof-v210-kinetic-blur.mp4`, 691,091 B,
  12s, diffs 5.68 / 8.07 / 4.02.
- kinetic-path: `out/proof-v210-kinetic-path.mp4`, 482,399 B,
  8s, diffs 7.57 / 3.46; frame read-back shows "Panels
  turn" riding the arc. (Scenes re-split from the hook's own
  words — "Panels turn" / "Face morning" — because the
  full hook exceeds the 28-character path limit.)
- lower-third-vertical: `out/proof-v210-lower-third-vertical.mp4`,
  770,496 B, 12s, diffs 5.57 / 7.97 / 3.95; frame read-back
  shows the strap (D'Vaughn House / Independent AI
  Orchestrator), pills Glenride / Supply chain / AI, and
  corner credit glenride.com.
- lower-third standalone: `out/proof-v210-lower-third.mov`,
  18,844,401 B, ProRes 4444 (`yuva444p12le`), 1280x720, 6.0s;
  alpha verified from decoded frames — first frame 0%
  opaque, hold frame 6.3% nonzero (the strap); frame
  read-back shows strap + pills + credit on transparency.
- motion-design: `out/proof-v210-motion-design.mp4`, 710,475 B,
  12s, diffs 5.61 / 8.48 / 5.39; BPM 100 (18f/beat) snaps
  the cuts to [0, 126, 234] instead of the even [0, 120,
  240] — frame 124f still shows scene-1 words and the wipe
  starts at 122f; frame 11.5s shows the LogoReveal end card
  (drawn sphere + orbit, "Glenride" wordmark).
Routing simulation: bare `Name:` label -> lower-thirds-skills
in route and parses in the watcher's LABEL_RE; Director
passes Kinetic mask / BPM 100 / Name / Role / Pills /
Source / Logo through; a no-label task still gets
kinetic `word`, no bpm, no name, no logo.
Regression: `out/proof-panel-centered.mp4` re-rendered after
the v2.10 sync, critic PASS (diffs 5.89 / 8.20 / 4.17 —
up from v2.8's 2.90 / 5.09 / 2.99; the wash, chip, and
constellation lines add motion). **Known limitation, NOT
a v2.10 regression:** Harness + the task-391 palette fails
palette_present (light field 18–23%) — the landscape
MovingBackground gradient between far-apart colors (sand
#D9C7A7 vs sky #4FC3F7, ~160 apart) leaves most pixels
>30 from both colors, the same mechanism as the v2.9
Explainer lesson. Control render with the wash disabled
measures 19–24% — the wash moves the field by <1pt.
Harness was never proven with this palette (prior Harness
proofs used close bg/surface pairs). Fix owed, out of
scope here: a solid/flat field when bg/surface are far
apart, as v2.9 did for Explainer.

## Packs 13–15 as Remotion code (v2.11, 2026-11-20)

motion-prompt, tiktok-video-skills, and what-if-animation are no
longer craft notes only — each has real primitives / compositions
/ router and watcher wiring. Defaults are unchanged when no pack
is selected (centered / serif / kinetic word-by-word, Harness or
Vertical, no move, no TikTok format).

- **Pack 13 — Motion Prompt registry**
  (`src/harness/motionRegistry.tsx`, consumed by `src/Vertical.tsx`;
  director `pick_move` / `pick_moves` in
  `watcher/harness_director.py`) — motion-prompt. The upstream
  catalog is 192 named moves; 18 are real Remotion code here,
  each with its catalog number, spec duration, and strength:
  reveals pop-in #001 (0.4 s, overshoot spring), stagger #002
  (0.08 s apart), mask reveal #005 (0.6 s, the v2.10 mask
  primitive), typewriter #006 (0.05 s/char + blinking cursor),
  count-up #007 (1.5 s ease-out — the target is the brief's own
  numeric scene word, never a hardcoded number; no numeric word
  falls back to a mask reveal), kinetic type #008 (the v2.6
  KineticLine); effects shape morph #012 (0.8 s, 10-point
  polygon interpolating circle → star, accent → surface),
  light sweep #022 (one band, ~0.9 s), impact shake #024
  (deterministic sine-decay shake, settles in 0.4 s), rack
  focus #033 (1 s, words blur 6px → 0 while a foreground disc
  blurs 0 → 8px); camera pan #025, dolly in #027, zoom in #028
  (Camera param overrides); transitions mask transition #017
  (0.7 s — the next scene appears inside a circle growing from
  the center, implemented as a clip-path on the incoming scene),
  jump cut #041 (mid-scene scale jump 1 → 1.06 at 40%),
  match cut #042 (a shared accent disc grows over the outgoing
  scene's last 6 frames and shrinks away over the incoming
  scene's first 6), whip pan #043 (translate + blur sweep out /
  in, 9 frames), cross dissolve #044 (1 s — outgoing fades out
  over its last 1 s while incoming fades in over its first 1 s;
  a true dissolve needs both scenes' pixels, which an overlay
  never has, so the dissolve lives in-scene, not as an overlay).
  A `Move:` label names one move for every scene; `Moves:` names
  one per scene in order (a transition-kind move sets the cut
  AFTER its scene). Unknown names are dropped with a note, never
  invented. `Motion:` values naming a registry move also set it
  (mask-reveal via the alias map — this also fixed a pre-existing
  gap: `VARIANT_RE` / `MOVE_RE` only captured `[A-Za-z]+`, so a
  hyphenated `Move: mask-reveal` never matched either regex).
  The registry never rotates — no label, no move. **Not
  implemented (174 of 192):** `NOT_IMPLEMENTED_MOVES` in the
  registry lists the SKILL.md-named ones (line draw #004,
  overshoot #010, parallax #016, shape transition #018, zoom
  through #020, orbit #030, slow motion #037, speed ramp #038,
  freeze frame #040, smash cut #046, low/high angle #177/#178,
  over-the-shoulder #180, establishing #183, extreme close-up
  #184, insert #185, fade to black #187, montage #192, the UI
  pack #049/#056/#058/#060/#061/#069/#070/#071, the 24-name
  photo pack #097–#120 as looks-not-code) plus the 149 further
  IDs the skill file never names. **Gap, stated:** the registry
  is wired into Vertical only — Harness (landscape) keeps its
  v2.10 kinetic reveals and does not read `move` / `moves`.
- **Pack 14 — TikTok formats** (`src/TikTokFormats.tsx`,
  consumed by `src/Vertical.tsx`; director `pick_tiktok_format`)
  — tiktok-video-skills. Three genuinely new patterns extending
  the v2.6 Vertical (new timing and layouts, not palette swaps),
  selected by a `TikTok:` label: hook-first (scene 1 is exactly
  1 s — the hook on screen at frame 1, biggest type in the clip,
  snap zoom, no fade-up; word gap tightened to 2 frames so the
  hook lands inside its 1 s scene), fast-cut (uneven cut
  schedule [0.72, 1.18, 0.9, …] normalized to the duration,
  punch-in zoom interrupt at every cut), duet (two-phase
  reaction split: the original plays full-width, then the
  reaction lands at 40% with a punch-in and the frame splits
  50/50 on a 4px accent divider; the payoff scene goes
  full-width after). No label means the v2.6 Vertical exactly as
  before. **Not built:** caption-led storytelling (word-timed
  karaoke needs real Whisper word timestamps — the skill's rule 1
  forbids faking them by even-splitting a line, and no
  transcription step is wired) and the countdown trend template
  (a frame-accurate countdown is its own composition shape, not
  a Vertical format). **Fixes found by the critic:** the first
  duet cut was a static split (frames_differ 1.28 at 2 s vs 6 s)
  — the two-phase beat fixed it (41.38); the first hook-first
  cut sampled beat 1 as missed — the brief now carries the real
  scene durations (`durationSeconds`), so the critic samples the
  1 s punch at its midpoint instead of an even split.
- **Pack 15 — What If** (`src/WhatIf.tsx`, registered in
  `src/Root.tsx`; director `build_whatif`, watcher WhatIf rung)
  — what-if-animation. A 15–25 s episode, every frame drawn in
  code: a dusk stick-figure rig (one hero, one look — head,
  body, arms, legs as stroke lines, fixed poses per demo,
  hand-held props in rig coordinates so wide and close shots
  agree), cold open with three escalating demos (each wide then
  close-up — cuts come from changing shot size), premise title
  card ("WHAT IF YOU COULD" / the power ≤ 4 words + "?" / one
  rule), one fun escalation, the turn (the fact with its number
  big in the accent, "That's real.", then the closing question).
  Dusk palette from the brief (deep navy ground, low amber sun
  as the visible light source, lamp / headlight pools). The
  fact and its number come only from the brief's `Fact:` label
  — the proof fact (Earth moves 185 miles around the Sun in ten
  seconds) is arithmetic from NASA's Earth Fact Sheet (mean
  orbital velocity 29.78 km/s = 18.50 mi/s; × 10 s = 185.0
  miles). **Silent:** ElevenLabs is NOT wired (no key); the
  composition ships with no voiceover, and the power's word
  rides as a small chip readout in every demo. The watcher rung
  sits after Explainer (a task matching both keeps the
  pre-v2.11 Explainer route); `build_whatif` returns None
  without Power + 3 Demo lines + Fact + Question, so those tasks
  keep the default route, craft notes only. **Fix found by the
  critic:** the fun line in the close shot sat across the hero's
  legs and tesseract misread "slice" — the fun beat now uses
  the wide shot, and the proof question carries a matchable word
  ("Where would you land tonight?").

Proof (all rendered on the iMac, critic **PASS** each, exit 0):
- motion-registry: `out/proof-v211-motion-registry.mp4`, 689,075 B,
  12s, diffs 5.81 / 8.08 / 3.59, story 3/3. Moves: pop-in,
  mask-transition, dolly-in (task-391 story + palette).
- motion-registry-2: `out/proof-v211-motion-registry-2.mp4`,
  732,546 B, 12s, diffs 5.20 / 7.77 / 4.00, story 3/3. Moves:
  typewriter, count-up, impact-shake. Scene 2 carries the
  brief's own test figure 1,280 ("The grid wakes 1,280 homes")
  as the count-up target.
- motion-registry-3: `out/proof-v211-motion-registry-3.mp4`,
  725,718 B, 12s, diffs 6.06 / 8.26 / 4.08, story 3/3. Moves:
  shape-morph, cross-dissolve, rack-focus.
- tiktok-duet: `out/proof-v211-tiktok-duet.mp4`, 617,189 B, 12s,
  diffs 41.38 / 40.07 / 4.68, story 3/3.
- tiktok-hook-first: `out/proof-v211-tiktok-hook-first.mp4`,
  745,858 B, 12s, diffs 11.57 / 9.26 / 5.26, story 3/3.
- tiktok-fast-cut: `out/proof-v211-tiktok-fast-cut.mp4`, 750,572 B,
  12s, diffs 6.12 / 9.82 / 4.53, story 3/3.
- whatif: `out/proof-v211-whatif.mp4`, 250,054 B, 20s, diffs 2.75 /
  4.69 / 13.53 / 10.94 / 5.49 / 4.61, story 7/7, contrast 12.4.
Routing simulation: `Moves: pop-in, mask-transition, dolly-in`
→ moves list; `Move: typewriter` → move; unknown `Move:
zoom-through` dropped, no crash; `Motion: mask-reveal` → move
mask-reveal; `Motion: kinetic` → motion kinetic + move
kinetic-type (same render — kinetic-type IS the KineticLine);
`Motion: rise` / `Variant: sweep` set no move; `TikTok: duet` →
tiktokFormat duet; what-if labels → payload with 3 demos + 20 s
+ 7 beats + scene durations summing to 20.0; what-if without
Fact → None; a no-label task gets no move / moves /
tiktokFormat props. Pre-existing router tests
(`watcher/test_viral_formats.py`): 26/26 pass.
Regression: `out/proof-panel-centered.mp4` re-rendered after
the v2.11 sync, critic PASS with diffs 5.89 / 8.20 / 4.17 —
identical to v2.10, so the Vertical changes did not move the
default path. **Known limitation, NOT a v2.11 regression:**
Harness + the task-391 palette still fails palette_present
(light field 18–23%) — recorded in v2.10, untouched here.
**iMac note (pre-existing, fixed in this run):** renders were
blocked on arrival — `node_modules/@remotion/cli/
remotion-cli.js`, `@esbuild/linux-x64/bin/esbuild`, and the
headless-Chrome binary under `node_modules/.remotion/` had all
lost their exec bits (644, dated Oct 24). Fixed with `chmod +x`
on those binaries only — no install, no new packages — and the
bundle then listed all 17 compositions including WhatIf.

## Narrated mode (v2, built 2026-10-26)

Ported from Automated Video Generator (MIT, v5.0.0) — only its
proven pieces: Edge-TTS voiceover, SRT captions, the stock ladder,
and the per-scene Remotion pattern. AVG's job service, web portal,
queue, update-check, and agentic brain did NOT come over; Motion
Bot keeps its own watcher / Director / Critic / Mission Control
intake.

**Trigger.** A task is narrated when its title or details contain
"narrated", "narration", "voiceover", or "voice-over"
(case-insensitive, deterministic — the Director has no LLM).
Limitation, noted: a task saying "no voiceover" would still
trigger. Signalwood tasks never take the narrated route.

**Pipeline.** Director (`build_narrated_storyboard` in
`watcher/harness_director.py`) splits the hook into 2–4 scenes on
the same clause breaks as the Harness; each scene carries its
voiceover text (the hook's own words, never invented) and up to 4
stock-search keywords (content words, stop-words dropped). Then
the watcher fetches Pixabay stock ON THE VM
(`watcher/narrated_stock.py` → the `custom.pixabay` connector —
the key lives in authd on the VM only and can never be copied to
the iMac) and ships the downloaded files to the iMac with the
storyboard (`prefetchedVisual` per scene). Then
`src/narrated/prepare.ts` runs ON the iMac
(`npx tsx src/narrated/prepare.ts <in.json> <out.json>`): per
scene it uses the prefetched Pixabay visual when present, else
fetches a free-ladder visual, synthesizes the voiceover, groups
word cues into short phrases, and sets the scene duration to the
real audio length (ceil, min 3s). The enriched storyboard is the
render `--props` for the `Narrated` composition
(`src/Narrated.tsx`, 1280×720, 30fps — NOT AVG's 1080×1350
portrait): OffthreadVideo (loops when shorter than the scene) or
Img with a slow Ken Burns push-in, 40% black overlay, burned-in
speech-timed captions, voiceover audio. No music in v2.0.

**Voice.** Edge-TTS, default voice `en-US-GuyNeural`, rate +0%,
pitch +0Hz — $0, no key, proven on the iMac (AVG test 2026-10-26:
34s, real voiceover, mean volume -24.5 dB). Binary resolution:
`EDGE_TTS_PATH` → `<repo>/.venv/bin/edge-tts` → `edge-tts` on
PATH. 3 retries per scene; a failed scene falls back to a silent
track so the render still completes (the Critic's audio check
then blocks it honestly). Kokoro was the original v2 plan — not
built; Edge-TTS is proven now, Kokoro stays a later option.
Cached MP3s are reused ONLY when a `.txt-hash` sidecar matches
the exact text (the AVG staleness fix). **Caption granularity:**
this edge-tts version emits ONE SRT cue per scene (the whole
sentence), not word boundaries — the overlay shows the sentence
for the scene, which reads fine; word-level karaoke would need a
different TTS or a forced aligner (whisper.cpp, still unbuilt).

**Stock ladder.** Two tiers, split by machine because the Pixabay
key lives in authd on the VM only (verified live 2026-10-26
23:33 ET; the key can never be read back or copied to the iMac):
**VM tier** — Pixabay video, then Pixabay image, via the
`custom.pixabay` connector (`watcher/narrated_stock.py` calls
`pixabay_search.py --type videos|images`, downloads the chosen
file, ffprobes its duration). **Relevance:** Pixabay's own
ranking is popularity-ish — the first hit for a keyword soup is
often unrelated (a book on a beach for "glenride studies supply
chains", a lipstick close-up for "work make chain visible" —
both observed 2026-10-26). So the fetcher scores hits by tag
overlap with the scene's keywords and tries downloads in score
order across ALL queries (joined, then each keyword alone),
best 2 per query; a failed/oversize download falls through to
the next candidate instead of abandoning the query. A downloaded
video longer than the scene needs is trimmed + downscaled to
1280w on the VM (no audio — the render mutes stock) before
shipping: the first Pixabay proof run's 88MB 4K truck clip
became 4.3MB of 720p. **iMac tier** (`src/narrated/
stock.ts`, plain `fetch`, no Pexels, no Ollama, no Pinterest) —
free video: Wikimedia Commons, then Internet Archive; free image:
Openverse, then Wikimedia Commons; then an ffmpeg gradient
placeholder card with the keyword burned on. The iMac tier runs
only for scenes with no prefetched Pixabay visual. Downloads cap
at 60MB (VM) / 150MB (iMac) with a 30s stall guard. Video
candidates are picked smallest-first (a 3s background wants the
lightest file that clears 640px wide, not a feature film;
Wikimedia/Archive candidates over 60MB are skipped at search
time), and any video longer than the scene needs + 5s is
ffmpeg-trimmed to scene length + 2s and re-encoded to mp4 — the
first proof run pulled a 108MB webm for a 3s scene before this
was added. A `[Visual: file]` / `Image:` label is used ONLY when
the file exists under `public/` — a missing file is ignored,
never searched as stock keywords (the AVG trap that looped
`logoautomationpng` ~150×).

**Env** (`<repo>/.env` on the iMac, read by prepare.ts):
`VIDEO_VOICE`, `EDGE_TTS_PATH`. There is NO Pixabay key on the
iMac — the key lives in authd on the VM only (connector
`custom.pixabay`); Pixabay fetching runs VM-side and the files
ship with the storyboard. No Pexels key anywhere: Pexels closed
new API issuance (verified 2026-10-26).

**Deps added for v2:** `@remotion/captions` ^4.0.0 (SRT parse)
and `tsx` ^4.0.0 (dev, runs prepare.ts). No sharp, no
ffmpeg-static — the iMac's system ffmpeg/ffprobe are used.

**Proof — sample narrated clip**

PROOF (2026-10-26, sample brief `briefs/sample-narrated.json` —
"Glenride studies supply chains — a shortage starts long before
the shelf is empty, and the work is to make the chain visible.").
Two renders, both Critic PASS:
- Render 1 (Pixabay, first-hit picks, before tag scoring):
  `out/sample-narrated.mp4` — 10.005s, 1280x720, 30fps, h264 +
  AAC, 3,031,461 bytes; audio mean −24.0 dB, max −6.2 dB; 3 SRT
  cues, all burned in correctly; stock relevance POOR (book on a
  beach, abstract rings, lipstick close-up) — the first-hit picker
  was the cause.
- Render 2 (tag-overlap scoring + VM trim, Pixabay ids 282082 /
  23205 / 150367): `out/sample-narrated2.mp4` — 10.005s, 1280x720,
  30fps, h264 + AAC, 5,580,769 bytes; audio mean −24.0 dB, max
  −6.2 dB; 3 cues; Critic PASS (probe, frames_differ 35.16 /
  33.69 / 21.79, not_blank 37.03 / 30.89 / 27.92, audio_present,
  captions_present, storyboard_no_self_mention; palette /
  text_contrast SKIP by design). Stock relevance: scene 1 truck /
  highway aerial — genuinely supply-chain; scene 2 rural
  drought aerial — "shortage" in the loose sense, Pixabay has 1
  hit for "shortage"; scene 3 chainsaw — literal "chain" wins
  the tag match, the word is ambiguous. Copies on the VM:
  `~/workspace/your_files/motion-bot-v2-proof/` (both MP4s,
  enriched storyboards, SRTs, critic JSONs, frames).
- Harness sanity re-render (task-161): byte-identical to the
  Oct 25 proof (1,345,039 bytes) — the existing path is
  untouched.

## Adding a new motif

1. Add a component in `src/harness/motifs.tsx` (palette-driven divs,
   `frame` prop for motion) + a case in `MotifLayer` + the name in
   `MOTIF_TYPES`.
2. Add its keywords to `MOTIF_KEYWORDS` in
   `watcher/harness_director.py` (+ any special params in
   `pick_motif`, e.g. mirror's reflection word).
3. Render a proof clip, run the Critic, record the numbers here.

## Open questions (need D'Vaughn)

- **Still images / b-roll.** The Harness is code-drawn motion only —
  no generated stills. Narrated mode (above) fetches stock video /
  images per scene; generated stills are still unwired. His
  preference is Grok or Gemini for stills; no image API or key is
  wired. If he wants generated imagery behind the kinetic type, that
  is a separate decision (which source, who pays, how images reach
  `public/`).
- **Voiceover / captions.** BUILT 2026-10-26 (Narrated mode, above):
  Edge-TTS voiceover + burned-in captions, $0. Kokoro +
  whisper.cpp remain unbuilt — Edge-TTS is proven now, Kokoro stays
  a later option.
