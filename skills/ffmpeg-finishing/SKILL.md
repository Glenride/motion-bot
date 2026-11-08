# ffmpeg-skill finishing tools — Motion Bot notes (opt-in only)

Upstream: kajisho5/ffmpeg-skill (MIT), vendored at
`skills/ffmpeg-skill/` (scripts + templates + references + docs
notes; full clone lives on the VM). Python standard library
only, no cloud, no API keys. Workflow: probe → edit → verify,
structured JSON output.

## Status in Motion Bot (2026-11-01)

- WIRED (verification lane): `watcher/ffmpeg_skill_verify.py` +
  `watcher/skill_verify.py` `verify()` attaches an advisory
  `ffmpeg_skill` result (upstream probe + youtube platform
  check, look sheet on demand). Advisory only — it never
  changes `structural_ok`.
- DOCUMENTED HERE, NOT AUTO-RUN: the finishing tools below.
  The watcher has NO finishing execution step, so no router
  entry auto-applies them and no live task changes because
  of this file. A finishing step runs only when a brief
  explicitly requests it AND a human runs it (or a future
  watcher step is built and proven for it).

## Available finishing tools (upstream script → use)

- `fit.py` — fit a clip to a duration and aspect (e.g. 9:16
  crop for vertical delivery). Does not invent a new
  composition; it reframes an existing render.
- `export.py` / `render.py --template` — platform delivery
  packs: tiktok, reels, shorts, youtube, x, linkedin,
  facebook. Templates carry each platform's frames, limits,
  safe zones, and caption placement.
- `silence.py` — silence removal / filler handling. The
  `--transcribe` variants need a local speech engine
  (parakeet or whisper); neither is installed on the iMac,
  so those variants refuse rather than guess. Use an
  existing transcript instead.
- `caption.py` — karaoke / animated captions. Caption
  WORDING comes only from the brief/hook or an existing
  SRT — this tool never rewrites what a caption says.
- `loudness.py` — loudness normalization (platform
  delivery commonly targets −14 LUFS). This does NOT
  change Motion Bot's narrated voiceover level: the
  proven narrated level stays as it is unless a brief
  explicitly requests a platform loudness pass, in
  which case that pass is a separate, labeled step.

## Hard limits (do not cross)

- Never replace the alpha ProRes lower-third mux (PNG
  sequence → ProRes 4444 yuva444p12le) or the slideshow
  concat with timed silent segments. Both are proven
  Motion Bot paths with known footguns; a swap needs a
  proof on those exact cases first.
- Run finishing steps on the iMac only. The VM ffmpeg
  OOMs on multi-input concats; the iMac handles them.
- Verify after every finishing step: upstream probe +
  platform check + look sheet, before the result is
  reported as delivered.
- No MCP server wiring: the watcher is a Python cron,
  not an MCP client. No npx install into ~/.claude/skills:
  that path is for coding agents, not Motion Bot.
- No purple in any new styling. New proof briefs carry
  "Background: parchment, gold".
