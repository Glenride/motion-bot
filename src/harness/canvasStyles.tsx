import React from "react";
import { AbsoluteFill, interpolate } from "remotion";
import { rand, type HarnessPalette } from "./primitives";

/**
 * Canvas styles (animate-canvas, v2.7) — procedural looks drawn in
 * code, not named palettes. Two styles are real Remotion code here:
 *
 *   cut-paper: torn-edge layered paper shapes with offset shadows.
 *   crosshatch: hatched ink lines (SVG strokes) that boil on 2s.
 *
 * Both keep the skill's rules: one style per piece, colour means one
 * thing (the accent is the single colour spent on emphasis), the
 * medium shows at phone size (torn edges / hatching are the frame,
 * not a filter), deterministic seeded randomness only, and a
 * shape-morph bridge at each scene boundary (MorphBridge: a circle
 * window that grows to cover the frame and shrinks open as a rounded
 * square — one bridge per beat, ~1.2s, 3 or fewer in a short piece).
 *
 * The words themselves still come from the storyboard scenes; the
 * style only supplies the drawing kit.
 */

/** Jagged torn-edge polygon points for a w×h rect, seeded. */
const tornPoints = (seed: number, w: number, h: number): string => {
  const pts: string[] = [];
  const step = 46;
  for (let x = 0; x <= w; x += step) {
    pts.push(`${x},${(rand(seed + x) - 0.5) * 14}`);
  }
  for (let y = 0; y <= h; y += step) {
    pts.push(`${w + (rand(seed + 400 + y) - 0.5) * 14},${y}`);
  }
  for (let x = w; x >= 0; x -= step) {
    pts.push(`${x},${h + (rand(seed + 800 + x) - 0.5) * 14}`);
  }
  for (let y = h; y >= 0; y -= step) {
    pts.push(`${(rand(seed + 1200 + y) - 0.5) * 14},${y}`);
  }
  return pts.join(" ");
};

/** One torn paper sheet: shadow copy offset down-right behind it. */
export const TornSheet: React.FC<{
  seed: number;
  x: number;
  y: number;
  w: number;
  h: number;
  rotate: number;
  fill: string;
  shadow: string;
}> = ({ seed, x, y, w, h, rotate, fill, shadow }) => {
  const points = tornPoints(seed, w, h);
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: w,
        height: h,
        transform: `rotate(${rotate}deg)`,
      }}
    >
      <svg
        width={w + 24}
        height={h + 24}
        viewBox={`-12 -12 ${w + 24} ${h + 24}`}
        style={{ position: "absolute", left: -12, top: -12, overflow: "visible" }}
      >
        <polygon points={points} fill={shadow} opacity={0.4} transform="translate(10,12)" />
        <polygon points={points} fill={fill} stroke={shadow} strokeWidth={2} />
      </svg>
    </div>
  );
};

/** Cut-paper backdrop: three layered torn sheets in surface / accent
 *  tints on the palette background, drifting a few px with the frame
 *  so a held frame still moves. */
export const CutPaperBackdrop: React.FC<{
  frame: number;
  palette: HarnessPalette;
}> = ({ frame, palette }) => {
  // Slow sway, wide enough that two frames 1.5s apart differ
  // decisively (the critic's frames_differ gate): the sheets are
  // big, so a ~15px shift moves a long torn edge. The small accent
  // sheet also turns continuously — a held scene still moves.
  const drift = Math.sin(frame * 0.035) * 18;
  const drift2 = Math.cos(frame * 0.03 + 1) * 14;
  const spin = 8 + frame * 0.2;
  return (
    <AbsoluteFill style={{ backgroundColor: palette.background, overflow: "hidden" }}>
      <TornSheet seed={11} x={-60 + drift} y={120} w={560} h={420} rotate={-4} fill={palette.surface} shadow={palette.accentDeep} />
      <TornSheet seed={29} x={220 - drift} y={640 + drift2} w={520} h={380} rotate={3} fill={palette.surface} shadow={palette.accentDeep} />
      <TornSheet seed={47} x={420 + drift2} y={90} w={280} h={220} rotate={spin} fill={palette.accent} shadow={palette.accentDeep} />
    </AbsoluteFill>
  );
};

/** Crosshatch field: diagonal ink strokes clipped to a big circle
 *  plus a counter-angle patch for shading. Boils on 2s: the whole
 *  hatch group jitters ±1.5px, stepping every 2 frames (frame//2),
 *  never smoothly — hand-drawn styles move on 2s. */
export const CrosshatchField: React.FC<{
  frame: number;
  palette: HarnessPalette;
}> = ({ frame, palette }) => {
  const boil = (frame >> 1) % 2 === 0 ? 0 : 1.5;
  // Slow drift on top of the 2s boil: the boil alone can land in the
  // same phase 1.5s apart, so the field also slides a few px — the
  // hatch lines are long, so a small shift moves many pixels.
  const dx = Math.sin(frame * 0.008) * 8;
  const dy = Math.cos(frame * 0.006) * 8;
  const lines = Array.from({ length: 34 }, (_, i) => i * 46 - 300);
  const ink = palette.text;
  return (
    <AbsoluteFill style={{ backgroundColor: palette.background, overflow: "hidden" }}>
      <svg
        width={720}
        height={1280}
        viewBox="0 0 720 1280"
        style={{ position: "absolute", left: 0, top: 0, transform: `translate(${dx}px, ${dy}px)` }}
      >
        <defs>
          <clipPath id="hatch-circle">
            <circle cx={360} cy={560} r={330} />
          </clipPath>
          <clipPath id="hatch-patch">
            <rect x={90} y={880} width={540} height={260} rx={8} />
          </clipPath>
        </defs>
        <g clipPath="url(#hatch-circle)" transform={`translate(${boil},${-boil})`}>
          {lines.map((x) => (
            <line key={x} x1={x} y1={180} x2={x + 420} y2={940} stroke={ink} strokeWidth={3} opacity={0.55} />
          ))}
          {lines.map((x) => (
            <line key={`b${x}`} x1={x + 420} y1={180} x2={x} y2={940} stroke={ink} strokeWidth={2} opacity={0.3} />
          ))}
        </g>
        <g clipPath="url(#hatch-patch)" transform={`translate(${-boil},${boil})`}>
          {lines.map((x) => (
            <line key={`p${x}`} x1={x} y1={880} x2={x + 260} y2={1140} stroke={ink} strokeWidth={3} opacity={0.45} />
          ))}
        </g>
        {/* The one colour: a navy-ink world with a single accent sun. */}
        <circle cx={360} cy={300} r={74} fill={palette.accent} opacity={0.9} />
        <circle cx={360} cy={300} r={74} fill="none" stroke={ink} strokeWidth={4} />
      </svg>
    </AbsoluteFill>
  );
};

/** Wobbly hand-drawn underline for the crosshatch style. */
export const SketchUnderline: React.FC<{
  width: number;
  color: string;
  seed?: number;
}> = ({ width, color, seed = 7 }) => {
  const pts = Array.from({ length: 9 }, (_, i) => {
    const x = (i / 8) * width;
    const y = 6 + (rand(seed + i * 13) - 0.5) * 10;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width={width} height={16} viewBox={`0 0 ${width} 16`}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={4} strokeLinecap="round" />
    </svg>
  );
};

/** Shape-morph bridge (animate-canvas): at a scene boundary, a
 *  circle window grows from the centre to cover the frame, morphs
 *  toward a rounded square at full cover, then shrinks open on the
 *  next scene. `frame` is local to the 36-frame (~1.2s) bridge. */
export const MorphBridge: React.FC<{
  frame: number;
  palette: HarnessPalette;
}> = ({ frame, palette }) => {
  const p = interpolate(frame, [0, 35], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const scale =
    p < 0.5
      ? interpolate(p, [0, 0.5], [0, 2.6])
      : interpolate(p, [0.5, 1], [2.6, 0]);
  const radius = 50 - 38 * Math.sin(Math.PI * p);
  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          width: 340,
          height: 340,
          borderRadius: `${radius}%`,
          backgroundColor: palette.accent,
          transform: `scale(${scale})`,
          opacity: scale > 0.05 ? 1 : 0,
        }}
      />
    </AbsoluteFill>
  );
};
