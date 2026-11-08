# Briefs

One JSON file per clip. A brief drives the **Generic** composition — the
same render pipeline renders any project, no code change needed. The
Signalwood proof clip keeps its own composition and its own brief
(`signalwood-proof.json`); it is not driven by this schema.

## Schema

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `project` | string | No | _(omitted — no name on screen)_ | Project name. Shown big in scene 1 and on the end card. Omit it to show no project name at all. |
| `hook` | string | No | `"Something worth seeing."` | Main title / message text. Shown in scene 2. |
| `subtitle` | string | No | `""` (omitted) | End-card line under the project name. Leave out to skip it. |
| `lengthSeconds` | number | No | `12` | Clip length in seconds. 30 fps, so `lengthSeconds × 30` frames. |
| `colors.background` | string (hex) | No | `"#111827"` | Scene background colour. |
| `colors.accent` | string (hex) | No | `"#FFB02E"` | Glow, accent rule, and end-card project name. |
| `colors.text` | string (hex) | No | `"#FFFFFF"` | On-screen text colour. |
| `images` | string[] | No | `[]` (no image) | Image filenames under `public/` (e.g. `"forest.jpg"`). Only the **first** image is used, as the scene-2 backdrop with a slow Ken Burns zoom. Omit for a plain glow background. |

Every field is optional — an empty brief `{}` renders a valid 12-second
clip with all defaults. Unknown fields are ignored.

**No Project: label = no project name on screen.** Motion Bot never names
itself: a task in the Motion Bot project (or assigned to the Motion Bot
person) with no explicit `Project:` label renders with no project name —
the hook scene takes the extra time and the end card shows only the
subtitle, or nothing at all. An explicit `Project:` label (e.g.
`Project: Reynard`) is the only way a name appears on screen.

## Clip structure (fractions of the total duration)

- **Scene 1 (0–25%)** — project name, big, accent rule underneath.
  Skipped entirely when no project is supplied; the hook scene then
  runs 0–70%.
- **Scene 2 (25–70%, or 0–70% with no project)** — hook text over the first image (if any), else an
  accent glow on the background colour.
- **Scene 3 (70–100%)** — end card: project name in accent + subtitle.
  With no project, the subtitle alone, or nothing at all.

## Example

```json
{
  "project": "Acme Demo (sample project — not real)",
  "hook": "A sample clip to prove any brief renders.",
  "subtitle": "Rendered from briefs/sample-generic.json",
  "lengthSeconds": 9,
  "colors": {
    "background": "#0F2A43",
    "accent": "#4FC3F7",
    "text": "#FFFFFF"
  },
  "images": ["forest.jpg"]
}
```

## Render

```bash
# From the repo root, on the iMac (the render host):
./render.sh briefs/sample-generic.json
# -> out/sample-generic.mp4

# Fully explicit:
./render.sh briefs/my-project.json Generic out/my-project.mp4
```

No price, no URL, no traffic promises in any clip.

## Harness storyboards

The Harness composition (`Harness`) is driven by a **storyboard**
JSON, not the brief schema above. Storyboards are produced by the
Director (`watcher/harness_director.py`) from a Mission Control task
and live here as `briefs/task-<id>-harness.json`. See `HARNESS.md`
for the full pipeline.

| Field | Type | Notes |
|---|---|---|
| `version` | number | Storyboard version, currently `1`. |
| `hook` | string | The task title, verbatim. Scene text comes only from this. |
| `lengthSeconds` | number | 3–60, from `Length:` label or `Ns` in the details, default 12. |
| `palette` | object | `background` / `surface` / `accent` / `accentDeep` / `text` / `glow` / `particle` — hex. Roles filled from named colors in order of appearance; text derived for contrast. |
| `mood` | object | `{tone, pacing}` from mood words in the task text. |
| `motif` | object | `{type, scene, reflectionWord?, tears?, ticking?}` — code-drawn motif + the scene it belongs to. |
| `scenes` | array | 1–4 scenes: `{words[], camera{fromScale,toScale,fromX,toX}, transitionOut}` — `wipe` / `zoom-cut` / `none`. Words rejoin to the hook. |
| `project` / `subtitle` | string | Only from explicit `Project:` / `Subtitle:` labels. Omitted otherwise. |
| `notes` | string[] | One line per derivation (color mapping, motif pick, …). |

Render a storyboard with `./render.sh briefs/task-161-harness.json Harness out/task-161-harness.mp4` (on the iMac, the render host).
