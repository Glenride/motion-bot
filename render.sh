#!/usr/bin/env bash
# Render a clip. Run from the repo root (or anywhere — it cds to its own dir).
# Requires: npm install (first time only).
#
# Usage:
#   ./render.sh
#       Render the Signalwood proof clip (default, unchanged):
#         npx remotion render Signalwood out/signalwood-proof.mp4
#
#   ./render.sh <brief.json>
#       Render the Generic composition from a brief, output named after
#       the brief:  ./render.sh briefs/sample-generic.json
#         -> out/sample-generic.mp4
#
#   ./render.sh <brief.json> <composition> <output.mp4>
#       Fully explicit:  ./render.sh briefs/sample-generic.json Generic out/sample-generic.mp4
#       Composition defaults to Generic when a brief is given; output
#       defaults to out/<brief-basename>.mp4.
#
# The brief's props are passed to Remotion as --props JSON. A brief may
# omit any field — see briefs/README.md for the schema and defaults.
set -euo pipefail
cd "$(dirname "$0")"

if [ $# -eq 0 ]; then
  npx remotion render Signalwood out/signalwood-proof.mp4
  exit 0
fi

BRIEF="$1"
COMPOSITION="${2:-Generic}"
OUTPUT="${3:-out/$(basename "${BRIEF%.json}").mp4}"
CODEC="${4:-}"

if [ ! -f "$BRIEF" ]; then
  echo "Brief not found: $BRIEF" >&2
  exit 1
fi

PROPS="$(cat "$BRIEF")"
mkdir -p "$(dirname "$OUTPUT")"
if [ "$CODEC" = "alpha-prores" ]; then
  # Transparent overlay path (proven 2026-10-29): Remotion video
  # encoders drop alpha, but PNG stills carry it — so render a PNG
  # sequence and mux it to ProRes 4444, which keeps the alpha channel.
  SEQDIR="$(dirname "$OUTPUT")/$(basename "$OUTPUT" .mov)-seq"
  npx remotion render "$COMPOSITION" "$SEQDIR" --props="$PROPS" --sequence --image-format=png
  ffmpeg -y -v error -framerate 30 -i "$SEQDIR/element-%03d.png" -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le "$OUTPUT"
  rm -rf "$SEQDIR"
  exit 0
fi
if [ -n "$CODEC" ]; then
  npx remotion render "$COMPOSITION" "$OUTPUT" --props="$PROPS" --codec="$CODEC"
else
  npx remotion render "$COMPOSITION" "$OUTPUT" --props="$PROPS"
fi
