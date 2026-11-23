import React from "react";
import { AbsoluteFill, interpolate } from "remotion";
import type { HarnessPalette } from "./primitives";

/**
 * motionDesign — the motion-design-skills pack (pack 12) as code.
 *
 * One shared module, always on in the router (the pack is base
 * craft): the named easing library, the beat grid, OKLab palette
 * transitions, the motion-personality table, shot-composition
 * framings / safe areas / parallax speeds, motion-background
 * patterns, and the code-drawn logo reveal. The v2.6 panels and
 * motions are EXTENDED here, not duplicated: new kinetic reveals
 * live in primitives.tsx (KineticReveal), new backgrounds reuse
 * Vertical's PortraitDots / PortraitBands geometry, and the
 * camera keeps its existing shape with an ease-in-out drive.
 *
 * DROPPED from this pack:
 * - After Effects itself (expressions, MOGRTs, Render Queue / AME
 *   export recipes, ExtendScript): Motion Bot renders in Remotion,
 *   not After Effects. The export half is already covered by the
 *   ffmpeg-finishing pack (v2.9, watcher/finishing.py).
 * - Variable-font animation: no variable font is installed on the
 *   render host (fc-list, 2026-11-20: zero families match
 *   "variable"; Liberation Serif/Sans/Mono are static weights), so
 *   a wght-axis animation would clamp silently. Per-character
 *   morph is dropped for the same reason; per-character stagger
 *   (CharStaggerLine) is the shipped kinetic form.
 * - The Glenride camel / D'Vaughn sphere as a drawn mark: no SVG
 *   asset of either mark is available to the renderer (the camel
 *   PNG lives outside the repo, and a PNG cannot draw on — only
 *   fade/scale in). LogoReveal draws a generic code-drawn mark
 *   (sphere + orbit ring, stroke draw-on) with the brief's own
 *   wordmark; swap in a real SVG path when one lands in public/.
 */

// ---------------------------------------------------------------- easings
// animation-principles: the named curves, exact values from the skill.
// Enter = ease-out, exit = ease-in, move = ease-in-out, branded pop =
// overshoot (the 1.56 pushes past 1.0). Linear is reserved for
// continuous loops only — never for a discrete enter/exit.

export const EASING_CURVES: Record<string, [number, number, number, number]> = {
  easeOut: [0.16, 1, 0.3, 1],
  easeIn: [0.7, 0, 0.84, 0],
  easeInOut: [0.65, 0, 0.35, 1],
  overshoot: [0.34, 1.56, 0.64, 1],
};

export const EASING_NAMES = ["easeOut", "easeIn", "easeInOut", "overshoot", "linear"] as const;
export type EasingName = (typeof EASING_NAMES)[number];

/** Cubic-bezier solver (Newton + bisection fallback), so the named
 *  curves above are exact, not approximations. */
const cubicBezierFn = (x1: number, y1: number, x2: number, y2: number) => {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const sampleDX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sampleX(t) - x;
      if (Math.abs(err) < 1e-6) break;
      const d = sampleDX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    if (t < 0 || t > 1) {
      let lo = 0;
      let hi = 1;
      t = x;
      while (hi - lo > 1e-6) {
        if (sampleX(t) < x) lo = t;
        else hi = t;
        t = (lo + hi) / 2;
      }
    }
    return sampleY(Math.max(0, Math.min(1, t)));
  };
};

const EASING_FNS: Record<string, (t: number) => number> = {};
for (const [name, c] of Object.entries(EASING_CURVES)) {
  EASING_FNS[name] = cubicBezierFn(c[0], c[1], c[2], c[3]);
}
EASING_FNS.linear = (t: number) => t;

/** Apply a named easing to a 0..1 progress. Unknown names fall back
 *  to easeOut — the skill's "when in doubt, decelerate into rest". */
export const applyEasing = (name: string | undefined, t: number): number => {
  const clamped = Math.max(0, Math.min(1, t));
  const fn = EASING_FNS[name ?? ""] ?? EASING_FNS.easeOut;
  return fn(clamped);
};

// ---------------------------------------------------------------- beat grid
// beat-sync-editing: cuts land on the music's rhythmic grid, not on
// arbitrary timecodes. frames_per_beat = (60 / BPM) * fps; structural
// cuts sit on phrases (2/4/8 beats), accents on the eighth-grid.

export const framesPerBeat = (bpm: number, fps: number): number => (60 / bpm) * fps;

/** Frame numbers of the beat grid inside a clip (0 excluded). */
export const beatGridFrames = (bpm: number, fps: number, totalFrames: number): number[] => {
  const fpb = framesPerBeat(bpm, fps);
  const out: number[] = [];
  for (let b = 1; b * fpb < totalFrames; b++) {
    out.push(Math.round(b * fpb));
  }
  return out;
};

/**
 * Scene starts for a clip. No BPM: the pre-existing even split
 * (remainder to the last scene). With a BPM: each start after the
 * first snaps to the nearest beat, at least one beat after the
 * previous start, so cuts land on the grid. A storyboard without a
 * BPM renders exactly as before.
 *
 * Weighted split (Writer stage, opt-in): when `weights` is supplied
 * — one positive number per scene — totalFrames splits
 * proportionally to the weights (remainder to the last scene) and
 * the BPM snap, when set, applies on top of the weighted starts
 * exactly as it does on the even split. When weights are absent,
 * short, or contain a non-positive value, the even split above is
 * byte-for-byte the old behavior.
 */
export const sceneStarts = (
  totalFrames: number,
  sceneCount: number,
  bpm: number | undefined,
  fps: number,
  weights?: number[],
): { starts: number[]; lengths: number[] } => {
  const n = Math.max(1, sceneCount);
  const useWeights =
    !!weights &&
    weights.length === n &&
    weights.every((w) => typeof w === "number" && w > 0);
  let base: number[];
  if (useWeights) {
    const total = (weights as number[]).reduce((a, b) => a + b, 0);
    base = [0];
    let acc = 0;
    for (let i = 0; i < n - 1; i++) {
      acc += (weights as number[])[i];
      base.push(Math.round((totalFrames * acc) / total));
    }
  } else {
    const per = Math.floor(totalFrames / n);
    base = [];
    let at = 0;
    for (let i = 0; i < n; i++) {
      base.push(at);
      at += i === n - 1 ? totalFrames - at : per;
    }
  }
  if (!bpm || bpm <= 0) {
    return {
      starts: base,
      lengths: base.map((s, i) => (i === n - 1 ? totalFrames - s : base[i + 1] - s)),
    };
  }
  const fpb = framesPerBeat(bpm, fps);
  const starts = [0];
  for (let i = 1; i < n; i++) {
    const snapped = Math.round(base[i] / fpb) * fpb;
    const prev = starts[i - 1];
    starts.push(Math.max(prev + Math.round(fpb), Math.min(snapped, totalFrames - Math.round(fpb))));
  }
  return {
    starts,
    lengths: starts.map((s, i) => (i === n - 1 ? totalFrames - s : starts[i + 1] - s)),
  };
};

// ---------------------------------------------------------------- OKLab color
// color-motion: interpolate in OKLab, never raw sRGB — an sRGB lerp
// between two hues passes through a desaturated gray/muddy midpoint.
// OKLab keeps midpoints vivid and lightness even. Matrices are the
// standard Björn Ottosson sRGB <-> OKLab pair.

type RGB = [number, number, number];

const hexToRgb = (hex: string): RGB => {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [
    parseInt(full.slice(0, 2), 16) / 255,
    parseInt(full.slice(2, 4), 16) / 255,
    parseInt(full.slice(4, 6), 16) / 255,
  ];
};

const rgbToHex = (rgb: RGB): string => {
  const c = rgb.map((v) => Math.max(0, Math.min(255, Math.round(v * 255))));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
};

const srgbToLinear = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

const linearToSrgb = (c: number): number =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

const rgbToOklab = (rgb: RGB): [number, number, number] => {
  const [r, g, b] = rgb.map(srgbToLinear);
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l1 = Math.cbrt(l);
  const m1 = Math.cbrt(m);
  const s1 = Math.cbrt(s);
  return [
    0.2104542553 * l1 + 0.793617785 * m1 - 0.0040720468 * s1,
    1.9779984951 * l1 - 2.428592205 * m1 + 0.4505937099 * s1,
    0.0259040371 * l1 + 0.7827717662 * m1 - 0.808675766 * s1,
  ];
};

const oklabToRgb = (lab: [number, number, number]): RGB => {
  const [L, a, b] = lab;
  const l1 = L + 0.3963377774 * a + 0.2158037573 * b;
  const m1 = L - 0.1055613458 * a - 0.0638541728 * b;
  const s1 = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l1 * l1 * l1;
  const m = m1 * m1 * m1;
  const s = s1 * s1 * s1;
  return [
    linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
};

/** Mix two hex colors in OKLab (t = 0 -> a, 1 -> b). */
export const mixOklab = (a: string, b: string, t: number): string => {
  const la = rgbToOklab(hexToRgb(a));
  const lb = rgbToOklab(hexToRgb(b));
  const c = Math.max(0, Math.min(1, t));
  return rgbToHex(
    oklabToRgb([
      la[0] + (lb[0] - la[0]) * c,
      la[1] + (lb[1] - la[1]) * c,
      la[2] + (lb[2] - la[2]) * c,
    ]),
  );
};

const rgbDistance = (a: string, b: string): number => {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  return (
    Math.sqrt(
      (ra[0] - rb[0]) ** 2 + (ra[1] - rb[1]) ** 2 + (ra[2] - rb[2]) ** 2,
    ) * 255
  );
};

/**
 * Palette transition for the frame background: the background drifts
 * in OKLab from background toward surface across the clip. The drift
 * is CAPPED so the rendered background never strays more than 24 RGB
 * units from the storyboard background — inside the critic's 30-unit
 * palette tolerance, so the light field (bg/surface union) still
 * reads >50% every frame.
 */
export const tintedBackground = (palette: HarnessPalette, progress: number): string => {
  const dist = rgbDistance(palette.background, palette.surface);
  const cap = dist > 0 ? Math.min(0.12, 24 / dist) : 0;
  return mixOklab(palette.background, palette.surface, cap * Math.max(0, Math.min(1, progress)));
};

/** The wash color at clip progress 0..1: an OKLab path accent ->
 *  surface -> accentDeep -> accent, so the grade cycles through
 *  vivid midpoints instead of muddying through gray. */
export const washColor = (palette: HarnessPalette, progress: number): string => {
  const p = Math.max(0, Math.min(1, progress));
  if (p < 1 / 3) return mixOklab(palette.accent, palette.surface, p * 3);
  if (p < 2 / 3) return mixOklab(palette.surface, palette.accentDeep, (p - 1 / 3) * 3);
  return mixOklab(palette.accentDeep, palette.accent, (p - 2 / 3) * 3);
};

/**
 * ColorMotionWash — the color-motion layer: a slow radial grade whose
 * color travels the OKLab path above while its position breathes.
 * Opacity 0.18 and a 65% falloff keep it a grade, not a repaint:
 * the light field underneath still dominates every sampled frame.
 */
export const ColorMotionWash: React.FC<{
  frame: number;
  durationInFrames: number;
  palette: HarnessPalette;
}> = ({ frame, durationInFrames, palette }) => {
  const progress = durationInFrames > 1 ? frame / (durationInFrames - 1) : 0;
  const color = washColor(palette, progress);
  const driftX = Math.sin(frame * 0.01) * 6;
  const driftY = Math.cos(frame * 0.008 + 1) * 5;
  return (
    <AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          left: `${44 + driftX}%`,
          top: `${44 + driftY}%`,
          width: "70%",
          height: "70%",
          transform: "translate(-50%, -50%)",
          borderRadius: "50%",
          background: `radial-gradient(circle, ${color} 0%, transparent 65%)`,
          opacity: 0.18,
        }}
      />
    </AbsoluteFill>
  );
};

// ------------------------------------------------------- motion personalities
// motion-art-direction: one named preset commits the cut rhythm, the
// easing, and the transition family together. The Director's mood
// tone picks the personality; the router's base-craft note names it.

export const PERSONALITIES = {
  playful: { phraseBeats: 4, easing: "overshoot", transition: "match-cut" },
  premium: { phraseBeats: 8, easing: "easeOut", transition: "hard-cut" },
  corporate: { phraseBeats: 8, easing: "easeInOut", transition: "hard-cut" },
  energetic: { phraseBeats: 2, easing: "overshoot", transition: "whip" },
} as const;

export type PersonalityName = keyof typeof PERSONALITIES;

export const personalityForTone = (tone: string | undefined): PersonalityName => {
  const t = (tone ?? "").toLowerCase();
  if (["bold", "dramatic", "ominous", "haunting"].includes(t)) return "energetic";
  if (["calm", "gentle", "somber", "dark"].includes(t)) return "premium";
  if (["warm", "cozy"].includes(t)) return "corporate";
  return "premium";
};

// ------------------------------------------------------------ shot composition
// shot-composition: title-safe margins per aspect (9:16 platform UI
// eats the top ~12-14% and bottom ~18-20%), rule-of-thirds power
// points, and the depth-layer parallax speeds (background 0.1-0.3x,
// midground 0.5-0.7x, foreground 1.0-1.5x — one primary move only).

export const SAFE_16_9 = { top: 0.05, bottom: 0.05, sides: 0.05 };
export const SAFE_9_16 = { top: 0.12, bottom: 0.18, sides: 0.06 };

export const PARALLAX = { background: 0.2, midground: 0.6, foreground: 1.2 } as const;

/** Rule-of-thirds power points (33% / 67% intersections). */
export const powerPoint = (
  which: "left" | "right",
  width: number,
  height: number,
): { x: number; y: number } => ({
  x: width * (which === "left" ? 1 / 3 : 2 / 3),
  y: height * (1 / 3),
});

/** Deterministic pseudo-random (local copy — primitives.tsx has its
 *  own; this module must not import values from it, or the two
 *  modules import each other). */
const rand01 = (seed: number) => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

// ---------------------------------------------------------- motion backgrounds
// motion-background: subtle, slow (8-30s loops), seamless (periodic
// functions only, so time wraps with no jump), never competing with
// the text. Three patterns; the Vertical variant picks one.

/** Mesh — drifting radial gradients (the cheapest pattern, no JS
 *  per-pixel work). Two accent blobs + one surface blob breathe
 *  across the frame on sine paths. */
export const MeshGradient: React.FC<{
  frame: number;
  palette: HarnessPalette;
  width: number;
  height: number;
}> = ({ frame, palette, width, height }) => {
  const dx1 = Math.sin(frame * 0.011) * 70;
  const dy1 = Math.cos(frame * 0.009 + 1) * 50;
  const dx2 = Math.cos(frame * 0.013 + 2) * 60;
  const dy2 = Math.sin(frame * 0.01 + 0.5) * 70;
  const blobs = [
    { left: width * 0.08 + dx1, top: height * 0.1 + dy1, size: 460, color: palette.accent, opacity: 0.32 },
    { left: width * 0.55 + dx2, top: height * 0.55 + dy2, size: 520, color: palette.accentDeep, opacity: 0.26 },
    { left: width * 0.3 - dx1 * 0.5, top: height * 0.72 - dy1 * 0.5, size: 420, color: palette.surface, opacity: 0.5 },
  ];
  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: palette.surface }}>
      {blobs.map((b, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: b.left,
            top: b.top,
            width: b.size,
            height: b.size,
            borderRadius: "50%",
            background: `radial-gradient(circle, ${b.color} 0%, transparent 65%)`,
            opacity: b.opacity,
          }}
        />
      ))}
    </AbsoluteFill>
  );
};

/** Constellation — drifting dots with faint lines between near
 *  neighbours (the canvas-constellation pattern, code-drawn). Dots
 *  use different seeds from PortraitDots so the two fields do not
 *  double up. */
export const ConstellationLines: React.FC<{
  frame: number;
  palette: HarnessPalette;
  width: number;
  height: number;
}> = ({ frame, palette, width, height }) => {
  const dots = Array.from({ length: 24 }, (_, i) => {
    const x0 = rand01(i + 200) * width;
    const y0 = rand01(i + 250) * height;
    const sway = Math.sin(frame * 0.02 + i * 2.1) * 30;
    return {
      x: x0 + sway,
      y: (y0 + frame * (0.4 + rand01(i + 290) * 1.1)) % (height + 20) - 10,
    };
  });
  const lines: { x: number; y: number; len: number; angle: number }[] = [];
  for (let i = 0; i < dots.length && lines.length < 24; i++) {
    for (let j = i + 1; j < dots.length && lines.length < 24; j++) {
      const dx = dots[j].x - dots[i].x;
      const dy = dots[j].y - dots[i].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 0 && dist < 170) {
        lines.push({
          x: dots[i].x,
          y: dots[i].y,
          len: dist,
          angle: (Math.atan2(dy, dx) * 180) / Math.PI,
        });
      }
    }
  }
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {lines.map((l, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: l.x,
            top: l.y,
            width: l.len,
            height: 1,
            backgroundColor: palette.particle,
            opacity: 0.28,
            transform: `rotate(${l.angle}deg)`,
            transformOrigin: "0 50%",
          }}
        />
      ))}
    </AbsoluteFill>
  );
};

/**
 * ParallaxChip — the shot-composition foreground layer: one
 * out-of-focus surface chip drifts past at 1.2x (foreground speed),
 * blurred, below the text. The background dots move at 0.2x, the
 * words sit midground — three depth speeds in one frame, one
 * primary move (the chip) at a time.
 */
export const ParallaxChip: React.FC<{
  frame: number;
  durationInFrames: number;
  palette: HarnessPalette;
  width: number;
}> = ({ frame, durationInFrames, palette, width }) => {
  const p = durationInFrames > 1 ? frame / (durationInFrames - 1) : 0;
  const x = interpolate(p, [0, 1], [-140, width + 40]);
  const y = 300 + Math.sin(frame * 0.01) * 40;
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: 150,
        height: 92,
        borderRadius: 10,
        backgroundColor: palette.surface,
        border: `2px solid ${palette.accent}`,
        opacity: 0.35,
        filter: "blur(3px)",
        transform: "rotate(-8deg)",
        zIndex: 1,
      }}
    />
  );
};

// ------------------------------------------------------------- logo animation
// logo-animation: ONE technique per logo — stroke draw-on for the
// mark, then the wordmark settles last. Reveal runs ~1.2s for the
// mark + a letter stagger; never distorts the geometry (scale and
// fade only, no skew/squash). The mark is code-drawn (sphere +
// orbit ring); the wordmark is the brief's own words.

export const LogoReveal: React.FC<{
  wordmark: string;
  palette: HarnessPalette;
  frame: number;
  fps: number;
  fontFamily: string;
  size?: number;
}> = ({ wordmark, palette, frame, fps, fontFamily, size = 420 }) => {
  // Mark draws on over 1.2s (inside the skill's 0.8-2.5s window),
  // ease-in-out; the orbit ring follows ~0.27s later. Frame counts
  // scale with fps so the timing holds at any composition rate.
  const scale = fps / 30;
  const markEnd = Math.round(36 * scale);
  const ringStart = Math.round(8 * scale);
  const ringEnd = Math.round(44 * scale);
  const wordStart = Math.round(30 * scale);
  const markP = applyEasing("easeInOut", interpolate(frame, [0, markEnd], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  }));
  const ringP = applyEasing("easeInOut", interpolate(frame, [ringStart, ringEnd], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  }));
  const letters = wordmark.split("");
  const markR = 46;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 18,
      }}
    >
      <svg width={size * 0.42} height={size * 0.42} viewBox="0 0 120 120">
        <circle
          cx="60"
          cy="60"
          r={markR}
          fill="none"
          stroke={palette.accent}
          strokeWidth={5}
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={1 - markP}
        />
        <ellipse
          cx="60"
          cy="60"
          rx={56}
          ry={20}
          fill="none"
          stroke={palette.accentDeep}
          strokeWidth={3}
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={1 - ringP}
          transform="rotate(-24 60 60)"
          opacity={0.9}
        />
        <circle
          cx={60 + 56 * Math.cos(-0.6)}
          cy={60 + 20 * Math.sin(-0.6) * 0.9}
          r={5}
          fill={palette.accent}
          opacity={ringP}
        />
      </svg>
      <div
        aria-label={wordmark}
        style={{
          display: "flex",
          fontFamily,
          fontSize: Math.max(30, size * 0.11),
          fontWeight: 700,
          color: palette.text,
          letterSpacing: 2,
          overflow: "hidden",
        }}
      >
        {letters.map((ch, i) => {
          const start = wordStart + i * Math.round(2 * scale);
          const charEnd = start + Math.round(12 * scale);
          const p = applyEasing("easeOut", interpolate(frame, [start, charEnd], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }));
          return (
            <span
              key={i}
              aria-hidden="true"
              style={{
                display: "inline-block",
                opacity: p,
                transform: `translateY(${interpolate(p, [0, 1], [110, 0], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                })}%)`,
              }}
            >
              {ch === " " ? "\u00A0" : ch}
            </span>
          );
        })}
      </div>
      <div
        style={{
          width: 90,
          height: 4,
          backgroundColor: palette.accent,
          opacity: interpolate(frame, [ringEnd, ringEnd + Math.round(12 * scale)], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      />
    </div>
  );
};
// The logo settle completes by this frame at 30fps (ring end +
// wordmark settle); callers sizing a hold use it, not a magic number.
export const LOGO_MARK_FRAMES = 56;
