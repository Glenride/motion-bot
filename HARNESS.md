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
Since v2.1 a trigger immediately preceded by "no", "not",
"without", "never", or "don't" (within 16 chars) does NOT count;
the task is narrated only if at least one trigger occurrence is
NOT negated, so "no voiceover" no longer triggers.
Signalwood tasks never take the narrated route.

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

## Creative upgrade (v2.1, built 2026-10-28)

Three layers, authorized by D'Vaughn's "Full creative upgrade"
tap (2026-10-28 20:43 ET). The motivating failure: the v2 proof's
scene 3 ("make the chain visible") picked a chainsaw cutting a
log — tag-overlap scoring matched the literal word "chain".

**Taste (2026-10-28, his "just taste" tap).** Subframe Motion
Library guidance, fetched from the free motion MCP endpoint
(https://mcp.subframe.com/motion/mcp, no account) and distilled
into `watcher/motion_taste.md` (UI timings translated to 30fps
frames). It loads into the LLM Director's system prompt at import
(`llm_director.py` `_load_motion_taste`, missing file = no taste
section, never a failure) and ships to the iMac via the
`run_llm_via_imac` rsync list. Taste only: purposeful motion
(every move answers a question), ease-out entrances, exits a
third faster, never pop from scale 0, word/line text reveals,
quiet low-amplitude ambient motion, meaning lives in voiceover +
captions, never in motion alone. It touches ONLY the LLM path —
the deterministic Director, the proven compositions, and the
task-161 regression are unchanged. Live-verified 2026-10-28: the
taste-loaded prompt returned a valid storyboard (lab/pharmacy →
freight/port/warehouse) via glimmer in 88s.

**Layer 1 — semantics (`watcher/concepts.py`, no model).**
A concept map from domain/abstract terms to concrete visual
keywords, seed entries: "supply chain"/"supply chains" → freight
truck, shipping port, warehouse, cargo containers, delivery van;
"logistics" → freight truck, warehouse, shipping port; "drug
shortage"/"drug shortages" → empty shelf, pharmacy counter,
medicine bottles; "shortage"/"shortages" → empty shelf, pharmacy
counter, warehouse aisle, medicine bottles; "drug"/"drugs" →
pharmacy, medicine bottles, laboratory; "pharma"/"pharmaceutical"
→ pharmacy, laboratory, medicine bottles; "medicine" → pharmacy,
medicine bottles; "delivery" → delivery van, courier, package;
"freight" → freight truck, cargo train; "warehouse" → warehouse
aisle, forklift; "shipping" → shipping port, cargo ship;
"manufacturing" → factory, assembly line. Matching is
phrase-first (longest phrase wins, kept whole — "supply chain"
never becomes ["supply", "chain"]); an abstract-word stoplist
(visible, visibility, work, starts, long, make, take, get, thing,
way, point, idea, story, question, problem, solution, future,
today, world, people, change, need, want, know, think, look, see,
show, give, help, keep, put, set, turn, move, go, come, find,
real, true, new, old, big, small, good, bad, important,
different, possible, hard, easy, first, last, next, own, able,
and more) is applied ONLY to standalone words, never inside a
mapped phrase. Scene keywords are hook-aware: a scene whose bare
word refers back to a hook-level concept ("the chain" in scene 3
of the Glenride hook) inherits that concept's visuals instead of
searching the bare word. `AMBIGUOUS_WORDS` (chain, wave, star,
key) + `DISAMBIGUATORS` (domain cue words, e.g. bicycle/bike for
the metal-chain sense, port/freight for the supply-chain sense)
feed the question gate. Scoring (`score_hit_semantic` in
`narrated_stock.py`): tag-overlap base (exact word +2, substring
+1 for words ≥4 chars) PLUS +6 per concept visual whose words
ALL appear in the hit's tags, +2 per visual with ≥1 word in
tags; a hit whose ONLY match is a single word that is a mapped
concept's fragment ("chain" for "supply chain", stemmed so
plurals count) scores −1 and is NEVER downloaded — it is the
safety net for stale briefs and model slips. Queries are
phrase-first: every keyword is its own query (concept visuals
first), then the joined single words, then each single word
alone; the old joined soup never happens. A scene never reuses
another scene's clip (per-scene hit-id dedupe). Everything else
is unchanged: best-2-per-query, all queries searched, trim /
downscale to 1280w on the VM, rsync `--bwlimit=400`.

**Layer 2 — LLM Director (`watcher/llm_director.py`, model-gated,
deterministic fallback).** Given a task, it calls the Studio
model (OpenAI-compatible `/v1/chat/completions`) with a system
prompt encoding his taste (unique/artistic, metaphor over
literal, never flat stock clichés: no handshakes, no lightbulbs,
no blank notebooks, no generic business people pointing at
screens; concrete filmable things; vary shot type across scenes;
never invent voiceover claims) and strict output rules (ONLY a
JSON storyboard in the `build_narrated_storyboard` schema;
voiceoverText reuses ONLY hook words). Validation is hard:
scenes 2–4, non-empty voiceoverText + visualKeywords, and the
concatenated scene texts' token multiset must EXACTLY equal the
hook's (case-insensitive) — a model inventing copy fails
validation and the deterministic storyboard is used instead.
LLM keywords pass through the semantics layer (concept visuals
first, abstract + fragment words removed, capped at 8/scene).
Endpoints, in order: iMac socat proxy
`http://100.81.149.115:12345/v1` → Studio LAN 192.168.1.187:1234,
then direct tailnet `http://mac-studio.tail22a20c.ts.net:1234/v1`.
Default model `meta/muse-glimmer`, override
`MOTION_BOT_LLM_MODEL` (35B for harder tasks), timeout 120s via
`MOTION_BOT_LLM_TIMEOUT`, endpoints via
`MOTION_BOT_LLM_BASE_URLS`. The VM CANNOT reach the proxy or the
Studio directly (sandbox egress closes those connections), so
the call runs on the iMac via SSH (`run_llm_via_imac`: rsyncs
the module + task to `<imac_repo>/watcher-llm/`, starts it
detached with nohup, polls for `out.json`; VM-side env overrides
are forwarded explicitly in the remote command, because the
iMac-side run inherits nothing from the VM shell). Two LM Studio
quirks, both handled: the server rejects
`response_format: {type: json_object}` with HTTP 400, so NO
`response_format` is sent (JSON discipline comes from the
prompt + fence-strip + loose parse); glimmer is a reasoning
model whose reasoning tokens eat the same `max_tokens` budget,
so `max_tokens` is 4096 (at 1024 the content was truncated to 2
characters) and a truncated first sample is retried once on the
primary endpoint. On ANY failure (timeout, bad JSON, proxy down,
model missing) the watcher falls back to
`build_narrated_storyboard`, logs the reason, and the task is
never failed because the model is down. Watcher flag
`LLM_DIRECTOR` (default on, 0 forces deterministic); on success
the task entry records `director: "llm"` + model/endpoint, on
failure `llm_fallback` with the reason (truncated 300 chars).

**Layer 3 — question gate (`watcher/question_gate.py`, narrated
tasks only).** BEFORE the claim PATCH, `check_question` checks,
in order: (d) a missing project/subtitle — an empty
`Project:`/`Subtitle:`/`Tagline:`/`End card:` label, or
"TBD"/"to be decided"/"to decide" attached to those words; (c)
an explicit either/or tone fork — tone words (dark, bright,
serious, playful, warm, ominous, calm, bold, somber, dramatic,
gentle, hopeful, energetic, urgent) joined by "or", different
words only; (a) no concrete visual concept survives the
semantics layer in ANY scene (before any landscape fallback);
(b) an ambiguous word as a scene keyword with no mapped concept
in that scene and no disambiguating cue in the full task text.
NEVER asked about: length, voice, music, orientation, palette
(all have safe defaults). Harness tasks have safe fallbacks, so
the gate does not apply to them. Mechanism: the question posts
to Mission Control as a decision (`POST /api/decisions`,
taskId + projectId + title = the question + optionsConsidered
joined by " | " + context "Motion Bot question gate
(<trigger>)" + status "needed") and the task is flagged
(`PATCH /api/tasks/{id}`, needsDecision: true); the task stays
OPEN and unclaimed. At most one question per task: the asked
record (`watcher/asked_questions.json`, atomic tmp+replace)
means a task with an unanswered question is skipped on later
cycles (outcome `awaiting_answer`), not re-asked, not rendered;
an edited task that resolves the fork clears the record and
renders. Empty-title tasks return no question (they block
separately asking for the hook). Both MC calls are best-effort
and never raise.

**Proof — v2.1 (2026-10-28).**
- Proof A (semantics, Glenride hook brief
  `briefs/sample-narrated-v21.json`): scene 1 "warehouse" hit
  23008, score 23 (container terminal / harbor / cargo / port /
  shipping / logistics — genuinely supply-chain); scene 2
  "pharmacy counter" hit 289881, score 14 (pharmacy / pharmacist
  / medication / medicine — genuinely shortage/pharma, far
  better than the v2 drought aerial); scene 3 "warehouse" hit
  43658, score 21 (warehouse / parcels / shelf / rack / shipping
  / cargo / delivery — genuinely supply-chain, a DIFFERENT clip
  from scene 1). The chainsaw is gone because no bare "chain"
  query exists anymore; `fragmentSkipped` was 0 in all scenes
  and the fragment rule stands proven by unit test (chainsaw
  hit scores −1, rejected). First v2.1 run picked the same clip
  for scenes 1 and 3 — the per-scene hit-id dedupe was added and
  the re-run picks distinct clips.
- Proof B (LLM Director, hook "Glenride traces a shortage from
  the factory floor to the empty shelf, and asks who pays when
  the truck never arrives.", details "narrated"): glimmer via
  the iMac proxy in 84s; 3 scenes, voiceover words exactly from
  the hook (token-multiset validation passed); keywords are
  metaphor-aware — scene 2 "who pays" → customer holding empty
  shopping basket, grocery price tag on empty shelf, family at
  checkout with fewer items, manager reviewing inventory (the
  human cost, not a literal payment); scene 3 → idle semi truck
  at distribution yard, closed bay doors, freight trucks at port
  at dawn, loading dock worker waiting. Stock: scene 1 pharmacy
  counter hit 289881 score 14; scene 2 "customer holding empty
  shopping basket" hit 1735 score 12 (supermarket / cart / price
  / shopping / customer); scene 3 "loading dock worker waiting"
  hit 24255 score 10 (container terminal / cargo / shipping /
  port / logistics). A query-construction bug found here: the
  first version only queued concept visuals + single words, so
  scenes whose LLM keywords were all phrases searched nothing
  but "landscape" (scores 1 and 0) — fixed by queuing every
  keyword as its own query. Render `out/proof-v21-llm.mp4`:
  1280×720, 30fps, 11.008s, 4,449,524 bytes, AAC mean −24.5 dB /
  max −5.0 dB, 3 caption cues, Critic PASS. Fallback proof:
  director pointed at a dead endpoint (127.0.0.1:9) returned
  (None, connection-refused on both attempts) in 24s, the
  deterministic storyboard rendered `out/proof-v21-fallback.mp4`
  (1280×720, 30fps, 9.003s, 2,035,295 bytes, AAC mean −23.9 dB /
  max −5.0 dB, Critic PASS) — the task never fails because the
  model is down. (Env-forwarding fix found here: the first dead-
  endpoint test silently succeeded on the proxy because VM env
  does not propagate to the iMac-side run; `run_llm_via_imac`
  now forwards the three MOTION_BOT_LLM_* vars explicitly.)
- Proof C (question gate): local cycle test — ambiguous task
  ("Make it about the chain", narrated) produces the question
  once, the second cycle skips as `awaiting_answer` with no
  re-ask and no render, and an edit to "supply chain" clears the
  gate. LIVE MC verification: TEST task 182 created in project
  56, question posted as decision 165 (title = the question,
  options = supply chain / metal chain / jewelry chain, status
  "needed"), task flagged needsDecision: true and left open;
  then dismissed (task 182 → done with "TEST ONLY" completion
  steps, decision 165 → made with "Test only" text, asked
  record cleared). No render was triggered for the gated task.
- Regression (task-161 Harness): 1,345,039 bytes, 10.000s,
  identical decoded frames (framemd5 e41f5bf083ab2ab3c79f8aaa1
  b8f241e matches the Oct 25 reference) — the file md5 differs
  only by MP4 container metadata (creation_time), not picture
  content. Watcher compiles clean; Signalwood/Harness/Generic
  compositions and claim/stale-claim logic untouched.

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
