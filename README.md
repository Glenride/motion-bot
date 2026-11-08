# Motion Bot

A video bot for D'Vaughn's projects. Remotion 4 compositions, rendered to short clips.

Two compositions:

- **Signalwood** — a 12-second proof clip (1280×720, 30 fps). See `STORYBOARD.md` and `briefs/signalwood-proof.json`. Untouched by the generic pipeline; it still renders exactly as before.
- **Generic** — a brief-driven composition (1280×720, 30 fps) that renders a clean clip for **any** project from a JSON brief. See `briefs/README.md` for the schema.

## Render any brief (Generic)

```bash
# From the repo root, on the iMac (the render host):
./render.sh briefs/sample-generic.json
# -> out/sample-generic.mp4

# Fully explicit (brief, composition, output):
./render.sh briefs/my-project.json Generic out/my-project.mp4
```

A brief needs only the fields you care about — everything else has a
sensible default (project, hook, subtitle, lengthSeconds, colors,
optional images under `public/`). An empty brief `{}` renders a valid
12-second clip.

## Render the Signalwood proof clip (unchanged)

## Run it on the iMac

```bash
# 1. Get the repo onto the iMac (copy this folder, or clone if it is pushed to GitHub)
cd ~/motion-bot

# 2. Install dependencies (first time only)
npm install

# 3. Preview in the Remotion Studio
npm start

# 4. Render the Signalwood proof clip
./render.sh
# — or directly —
npx remotion render Signalwood out/signalwood-proof.mp4
```

Output: `out/signalwood-proof.mp4`.

## Layout

- `src/Root.tsx` — registers compositions (`Signalwood`, `Generic`)
- `src/Signalwood.tsx` — the Signalwood composition (3 scenes)
- `src/Generic.tsx` — the brief-driven Generic composition (3 scenes, length from `lengthSeconds`)
- `public/` — still images used by compositions (`forest.jpg`, `cap.jpg`, `network.jpg`)
- `briefs/` — one JSON brief per clip (`briefs/README.md` documents the schema)
- `render.sh` — render helper: no args renders Signalwood; a brief path renders Generic
