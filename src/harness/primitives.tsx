import React from "react";
import { AbsoluteFill, interpolate, spring } from "remotion";
import { applyEasing } from "./motionDesign";

/**
 * Harness primitives — the shared motion engine.
 *
 * Generalized from the MotionTest prototype (kinetic type, animated
 * background, camera moves, wipe / zoom-cut transitions, teardrops).
 * MotionTest.tsx itself is untouched; these are the same ideas,
 * parameterized by a storyboard palette instead of hardcoded blues.
 *
 * Everything moves every frame, all in code: no stills, no plain
 * crossfades, no static text blocks.
 */

export type HarnessPalette = {
  background: string;
  surface: string;
  accent: string;
  accentDeep: string;
  text: string;
  glow: string;
  particle: string;
};

/** The default palette (v2.10: lives here, not in Harness.tsx, so
 *  LowerThird can use it without importing Harness — Harness
 *  imports LowerThirdOverlay, and the reverse import was a cycle
 *  that crashed the bundle: "Cannot access HARNESS_DEFAULTS before
 *  initialization"). */
export const DEFAULT_PALETTE: HarnessPalette = {
  background: "#FFFFFF",
  surface: "#F4EEDC",
  accent: "#D4AF37",
  accentDeep: "#8A7224",
  text: "#1F1A14",
  glow: "#D4AF37",
  particle: "#D4AF37",
};

export const SERIF = "Georgia, 'Times New Roman', serif";

/**
 * Font families that actually resolve on the render host (the iMac,
 * Arch Linux, fontconfig). Verified 2026-11-20 with fc-list:
 * Georgia, EB Garamond, Arial, Helvetica, Menlo and Courier New are
 * NOT installed there, so a bare "Georgia" stack silently falls back
 * to generic serif — which is why every clip's letterforms looked
 * identical even when a brief asked for a different feel. Each stack
 * below starts with the named family for hosts that have it, then a
 * family that is installed on the iMac, so the letterforms really
 * change: serif -> Liberation Serif, sans -> Liberation Sans,
 * mono -> Liberation Mono.
 */
export const FONTS = {
  serif: "Georgia, 'Times New Roman', 'Liberation Serif', serif",
  sans: "'Liberation Sans', Arial, 'Helvetica Neue', sans-serif",
  mono: "'Liberation Mono', 'JetBrainsMono Nerd Font', monospace",
} as const;

export type FontName = keyof typeof FONTS;
export const FONT_NAMES = ["serif", "sans", "mono"] as const;

export const resolveFont = (name?: string): string =>
  FONTS[(name ?? "") as FontName] ?? FONTS.serif;

/** Deterministic pseudo-random from a seed — stable across frames. */
export const rand = (seed: number) => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** One drifting particle. Position is a pure function of the frame.
 *  On light backgrounds particles get a higher opacity floor — a faint
 *  gold dot on white is invisible, which is how a scene goes flat. */
export const Particle: React.FC<{
  seed: number;
  frame: number;
  color: string;
  minOpacity?: number;
}> = ({ seed, frame, color, minOpacity = 0.25 }) => {
  const x0 = rand(seed) * 1280;
  const y0 = rand(seed + 50) * 720;
  const size = 2 + rand(seed + 90) * 5;
  const speed = 0.4 + rand(seed + 130) * 1.1;
  const sway = Math.sin(frame * 0.02 + seed * 2.1) * 34;
  const y = (y0 + frame * speed) % 760 - 20;
  const x = x0 + sway;
  const opacity =
    minOpacity + (0.7 - minOpacity) * (0.5 + 0.5 * Math.sin(frame * 0.05 + seed * 3.3));
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: size,
        height: size,
        borderRadius: "50%",
        backgroundColor: color,
        opacity,
        boxShadow: `0 0 12px ${color}`,
      }}
    />
  );
};

/** Background that changes every frame: rotating gradient + particles.
 *  On light backgrounds (white / parchment) the glow and particles run
 *  stronger — at dark-background strengths they wash out to nothing
 *  and the scene reads flat. */
export const MovingBackground: React.FC<{
  frame: number;
  palette: HarnessPalette;
  particleCount?: number;
}> = ({ frame, palette, particleCount = 42 }) => {
  const angle = 115 + frame * 0.35; // gradient rotates ~126deg over 12s
  const shift = Math.sin(frame * 0.015) * 18; // hue/position breathing
  const hex = palette.background.replace("#", "");
  const lum =
    (0.2126 * parseInt(hex.slice(0, 2), 16) +
      0.7152 * parseInt(hex.slice(2, 4), 16) +
      0.0722 * parseInt(hex.slice(4, 6), 16)) /
    255;
  const light = lum > 0.6;
  const glowBase = light ? 0.3 : 0.16;
  const particleFloor = light ? 0.45 : 0.25;
  // On a light background gold particles wash out to pale yellow specks
  // (blended gold-on-white is ~120 RGB away from gold). The deeper gold
  // reads as gold on white; on dark backgrounds the bright gold is right.
  const particleColor = light ? palette.accentDeep : palette.particle;
  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(${angle}deg, ${palette.background} 0%, ${palette.surface} 55%, ${palette.background} 100%)`,
      }}
    >
      {/* Soft accent glow that breathes with the gradient. */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: `${50 + shift * 0.4}%`,
          width: "80%",
          height: "80%",
          transform: "translate(-50%, -50%)",
          borderRadius: "50%",
          background: `radial-gradient(circle, ${palette.glow} 0%, transparent 65%)`,
          opacity: glowBase + 0.06 * Math.sin(frame * 0.03),
          pointerEvents: "none",
        }}
      />
      {Array.from({ length: particleCount }, (_, i) => (
        <Particle
          key={i}
          seed={i + 1}
          frame={frame}
          color={particleColor}
          minOpacity={particleFloor}
        />
      ))}
    </AbsoluteFill>
  );
};

/** A word that springs into place with slide + scale + rotation. */
export const KineticWord: React.FC<{
  word: string;
  startFrame: number;
  frame: number;
  fps: number;
  fontSize: number;
  color: string;
  fromX: number;
  rotate: number;
  fromY?: number;
}> = ({ word, startFrame, frame, fps, fontSize, color, fromX, rotate, fromY = 0 }) => {
  const progress = spring({
    frame: frame - startFrame,
    fps,
    config: { damping: 14, stiffness: 180 },
  });
  const opacity = interpolate(frame - startFrame, [0, 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const x = interpolate(progress, [0, 1], [fromX, 0]);
  const y = interpolate(progress, [0, 1], [fromY, 0]);
  const scale = interpolate(progress, [0, 1], [0.7, 1]);
  const rot = interpolate(progress, [0, 1], [rotate, 0]);
  return (
    <span
      style={{
        display: "inline-block",
        opacity,
        transform: `translateX(${x}px) translateY(${y}px) scale(${scale}) rotate(${rot}deg)`,
        fontSize,
        fontWeight: 700,
        color,
        textShadow: "0 4px 28px rgba(0,0,0,0.35)",
        margin: "0 10px",
        whiteSpace: "nowrap",
      }}
    >
      {word}
    </span>
  );
};

/** A line of kinetic words, staggered, wrapping naturally.
 *  rise: words rise from below (no sideways slide, no rotation) —
 *  the "rise" variant's type motion. fontFamily defaults to SERIF
 *  so existing callers render exactly as before. */
export const KineticLine: React.FC<{
  words: string[];
  firstFrame: number;
  frame: number;
  fps: number;
  fontSize: number;
  color?: string;
  gapFrames?: number;
  rise?: boolean;
  fontFamily?: string;
  align?: "center" | "left";
}> = ({ words, firstFrame, frame, fps, fontSize, color = "#FFFFFF", gapFrames = 7, rise = false, fontFamily = SERIF, align = "center" }) => (
  <div
    style={{
      display: "flex",
      flexWrap: "wrap",
      justifyContent: align === "left" ? "flex-start" : "center",
      alignItems: "center",
      fontFamily,
      lineHeight: 1.25,
      textAlign: align,
      padding: "0 70px",
    }}
  >
    {words.map((w, i) => (
      <KineticWord
        key={`${w}-${i}`}
        word={w}
        startFrame={firstFrame + i * gapFrames}
        frame={frame}
        fps={fps}
        fontSize={fontSize}
        color={color}
        fromX={rise ? 0 : i % 2 === 0 ? -90 : 90}
        rotate={rise ? 0 : i % 2 === 0 ? -7 : 7}
        fromY={rise ? 110 : 0}
      />
    ))}
  </div>
);

/**
 * SlideLines — a second motion language. The words are split into two
 * lines; each line slides in as a whole unit from alternating sides
 * (left, then right), fading in over ~12 frames. No per-word stagger,
 * no rotation, no scale: the line is the unit that moves.
 */
export const SlideLines: React.FC<{
  words: string[];
  firstFrame: number;
  frame: number;
  fontSize: number;
  color?: string;
  fontFamily?: string;
  align?: "center" | "left";
}> = ({ words, firstFrame, frame, fontSize, color = "#FFFFFF", fontFamily = SERIF, align = "center" }) => {
  const mid = Math.max(1, Math.ceil(words.length / 2));
  const lines = [words.slice(0, mid), words.slice(mid)].filter((l) => l.length > 0);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        fontFamily,
        lineHeight: 1.2,
        textAlign: align,
        alignItems: align === "left" ? "flex-start" : "center",
        padding: "0 48px",
      }}
    >
      {lines.map((line, li) => {
        const start = firstFrame + li * 14;
        const p = interpolate(frame - start, [0, 12], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        const x = interpolate(p, [0, 1], [li % 2 === 0 ? -720 : 720, 0]);
        return (
          <div
            key={li}
            style={{
              opacity: p,
              transform: `translateX(${x}px)`,
              fontSize,
              fontWeight: 700,
              color,
              textShadow: "0 4px 28px rgba(0,0,0,0.35)",
              whiteSpace: "nowrap",
            }}
          >
            {line.join(" ")}
          </div>
        );
      })}
    </div>
  );
};

/**
 * ScaleLine — a third motion language. Words punch in one at a time by
 * scaling from 0.5 to 1 with a fade, staggered, in place: no slide, no
 * rise, no rotation. The word stays where it lands.
 */
export const ScaleLine: React.FC<{
  words: string[];
  firstFrame: number;
  frame: number;
  fontSize: number;
  color?: string;
  gapFrames?: number;
  fontFamily?: string;
  align?: "center" | "left";
}> = ({ words, firstFrame, frame, fontSize, color = "#FFFFFF", gapFrames = 6, fontFamily = SERIF, align = "center" }) => (
  <div
    style={{
      display: "flex",
      flexWrap: "wrap",
      justifyContent: align === "left" ? "flex-start" : "center",
      alignItems: "center",
      fontFamily,
      lineHeight: 1.25,
      textAlign: align,
      padding: "0 70px",
    }}
  >
    {words.map((w, i) => {
      const start = firstFrame + i * gapFrames;
      const p = interpolate(frame - start, [0, 10], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
      const scale = interpolate(p, [0, 1], [0.5, 1]);
      return (
        <span
          key={`${w}-${i}`}
          style={{
            display: "inline-block",
            opacity: p,
            transform: `scale(${scale})`,
            fontSize,
            fontWeight: 700,
            color,
            textShadow: "0 4px 28px rgba(0,0,0,0.35)",
            margin: "0 10px",
            whiteSpace: "nowrap",
          }}
        >
          {w}
        </span>
      );
    })}
  </div>
);

/**
 * StackLine — the word-stack panel's motion. One word per line, huge,
 * left-aligned, each word rising from below on a spring, staggered.
 * The stack IS the layout: words never share a line, so a scene reads
 * as a vertical column instead of a centered paragraph.
 */
export const StackLine: React.FC<{
  words: string[];
  firstFrame: number;
  frame: number;
  fps: number;
  fontSize: number;
  color?: string;
  gapFrames?: number;
  fontFamily?: string;
}> = ({ words, firstFrame, frame, fps, fontSize, color = "#FFFFFF", gapFrames = 8, fontFamily = SERIF }) => (
  <div
    style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "flex-start",
      fontFamily,
      lineHeight: 1.08,
      textAlign: "left",
    }}
  >
    {words.map((w, i) => {
      const progress = spring({
        frame: frame - (firstFrame + i * gapFrames),
        fps,
        config: { damping: 16, stiffness: 160 },
      });
      const opacity = interpolate(frame - (firstFrame + i * gapFrames), [0, 8], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
      const y = interpolate(progress, [0, 1], [130, 0]);
      const scale = interpolate(progress, [0, 1], [0.92, 1]);
      return (
        <span
          key={`${w}-${i}`}
          style={{
            display: "block",
            opacity,
            transform: `translateY(${y}px) scale(${scale})`,
            fontSize,
            fontWeight: 800,
            color,
            textShadow: "0 4px 28px rgba(0,0,0,0.35)",
            whiteSpace: "nowrap",
          }}
        >
          {w}
        </span>
      );
    })}
  </div>
);

/**
 * DriftBlobs — surface-color blobs behind the copy (v2.8).
 * The clip's always-on motion: three large circles drift on
 * sine/cosine paths with wide amplitudes, so even a settled hold
 * frame differs from the next by more than the critic's 2.0 mean
 * diff (v2.8 first pass: two small slow blobs measured 0.4–1.5 and
 * failed every hold pair — the edge has to travel ~20px at the
 * critic's 320px sample scale between samples 1.5s apart, which
 * needs amplitudes ~150px+ at ~0.012 rad/frame).
 *
 * The blobs are SOLID surface color, not translucent: a 0.5-opacity
 * blend sits within tolerance of neither background nor surface, so
 * the second pass (three big translucent blobs) fixed the diffs but
 * dropped the light field to 45–49% and failed palette_present.
 * Solid blobs count as surface, so they HELP the light field
 * instead of eating it. zIndex 0: content wrappers sit at
 * zIndex >= 1 above them.
 */
export const DriftBlobs: React.FC<{
  frame: number;
  palette: HarnessPalette;
}> = ({ frame, palette }) => {
  const x1 = Math.sin(frame * 0.012) * 170;
  const y1 = Math.cos(frame * 0.009 + 1) * 110;
  const x2 = Math.cos(frame * 0.01 + 2) * 140;
  const y2 = Math.sin(frame * 0.014 + 0.5) * 130;
  const x3 = Math.sin(frame * 0.013 + 4) * 190;
  const y3 = Math.cos(frame * 0.011 + 2.5) * 90;
  return (
    <AbsoluteFill style={{ overflow: "hidden", zIndex: 0 }}>
      <div
        style={{
          position: "absolute",
          left: -160 + x1,
          top: 60 + y1,
          width: 480,
          height: 480,
          borderRadius: "50%",
          backgroundColor: palette.surface,
        }}
      />
      <div
        style={{
          position: "absolute",
          right: -140 + x2,
          bottom: 40 + y2,
          width: 400,
          height: 400,
          borderRadius: "50%",
          backgroundColor: palette.surface,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 430 + x3,
          top: 330 + y3,
          width: 340,
          height: 340,
          borderRadius: "50%",
          backgroundColor: palette.surface,
        }}
      />
    </AbsoluteFill>
  );
};

/**
 * Kinetic reveals (v2.10, kinetic-typography-skills). The v2.6
 * KineticLine is word-by-word; these are the pack's other workhorse
 * reveals, each a real primitive selectable via the `Kinetic:` label
 * (Director) / `kinetic` prop — not a craft note. Timings are the
 * skill's own: per-fragment 400-600ms, stagger lines 60-100ms,
 * words 40-70ms, characters 20-40ms (1 frame at 30fps = 33ms),
 * total reveal capped near ~800ms, ease-out entries
 * (cubic-bezier 0.16, 1, 0.3, 1 — applyEasing("easeOut")).
 * Splits carry aria-label on the container + aria-hidden on the
 * fragments, so screen readers and copy-paste still see the words.
 */

export type KineticRevealName = "word" | "char" | "mask" | "blur" | "wipe" | "path";
export const KINETIC_REVEALS: KineticRevealName[] = ["word", "char", "mask", "blur", "wipe", "path"];

export const resolveKinetic = (k?: string): KineticRevealName =>
  (KINETIC_REVEALS as string[]).includes(k ?? "") ? (k as KineticRevealName) : "word";

/** Per-character stagger: split to chars, fade + rise each with a
 *  1-frame (33ms) offset. Reserved for short strings — on long copy
 *  it feels busy, so the dispatcher falls back to mask above 60
 *  characters. */
export const CharStaggerLine: React.FC<{
  words: string[];
  firstFrame: number;
  frame: number;
  fontSize: number;
  color?: string;
  fontFamily?: string;
  align?: "center" | "left";
  easing?: string;
}> = ({ words, firstFrame, frame, fontSize, color = "#FFFFFF", fontFamily = SERIF, align = "center", easing }) => {
  const full = words.join(" ");
  let charIndex = 0;
  return (
    <div
      aria-label={full}
      style={{
        display: "flex",
        flexWrap: "wrap",
        justifyContent: align === "left" ? "flex-start" : "center",
        alignItems: "center",
        fontFamily,
        lineHeight: 1.25,
        textAlign: align,
        padding: "0 70px",
      }}
    >
      {words.map((w, wi) => {
        const chars = w.split("").map((ch) => {
          const idx = charIndex++;
          const start = firstFrame + idx;
          const p = applyEasing(
            easing ?? "easeOut",
            interpolate(frame, [start, start + 12], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          );
          return (
            <span
              key={idx}
              aria-hidden="true"
              style={{
                display: "inline-block",
                opacity: p,
                transform: `translateY(${interpolate(p, [0, 1], [16, 0])}px)`,
                fontSize,
                fontWeight: 700,
                color,
                textShadow: "0 4px 28px rgba(0,0,0,0.35)",
                whiteSpace: "pre",
              }}
            >
              {ch}
            </span>
          );
        });
        charIndex++; // the space between words costs one stagger step
        return (
          <span key={`${w}-${wi}`} style={{ display: "inline-flex", margin: "0 10px" }}>
            {chars}
          </span>
        );
      })}
    </div>
  );
};

/** Mask / clip reveal: each line sits in an overflow:hidden wrapper
 *  and wipes up from translateY(110%). The industry-standard
 *  headline reveal — no blur artifacts, GPU-cheap. */
export const MaskRevealLine: React.FC<{
  words: string[];
  firstFrame: number;
  frame: number;
  fontSize: number;
  color?: string;
  fontFamily?: string;
  align?: "center" | "left";
  easing?: string;
}> = ({ words, firstFrame, frame, fontSize, color = "#FFFFFF", fontFamily = SERIF, align = "center", easing }) => {
  const mid = Math.max(1, Math.ceil(words.length / 2));
  const lines = [words.slice(0, mid), words.slice(mid)].filter((l) => l.length > 0);
  return (
    <div
      aria-label={words.join(" ")}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        fontFamily,
        lineHeight: 1.2,
        textAlign: align,
        alignItems: align === "left" ? "flex-start" : "center",
        padding: "0 48px",
      }}
    >
      {lines.map((line, li) => {
        const start = firstFrame + li * 3;
        const p = applyEasing(
          easing ?? "easeOut",
          interpolate(frame, [start, start + 18], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        );
        return (
          <div key={li} style={{ overflow: "hidden" }}>
            <div
              aria-hidden="true"
              style={{
                transform: `translateY(${interpolate(p, [0, 1], [110, 0])}%)`,
                fontSize,
                fontWeight: 700,
                color,
                textShadow: "0 4px 28px rgba(0,0,0,0.35)",
                whiteSpace: "nowrap",
              }}
            >
              {line.join(" ")}
            </div>
          </div>
        );
      })}
    </div>
  );
};

/** Blur-in: filter blur(12px) -> 0 with opacity 0 -> 1, per word.
 *  The focus-pull feel; radius stays modest and durations short,
 *  per the skill (blur is the costliest reveal). */
export const BlurInLine: React.FC<{
  words: string[];
  firstFrame: number;
  frame: number;
  fontSize: number;
  color?: string;
  gapFrames?: number;
  fontFamily?: string;
  align?: "center" | "left";
  easing?: string;
}> = ({ words, firstFrame, frame, fontSize, color = "#FFFFFF", gapFrames = 2, fontFamily = SERIF, align = "center", easing }) => (
  <div
    aria-label={words.join(" ")}
    style={{
      display: "flex",
      flexWrap: "wrap",
      justifyContent: align === "left" ? "flex-start" : "center",
      alignItems: "center",
      fontFamily,
      lineHeight: 1.25,
      textAlign: align,
      padding: "0 70px",
    }}
  >
    {words.map((w, i) => {
      const start = firstFrame + i * gapFrames;
      const p = applyEasing(
        "easeOut",
        interpolate(frame, [start, start + 15], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
      );
      return (
        <span
          key={`${w}-${i}`}
          aria-hidden="true"
          style={{
            display: "inline-block",
            opacity: p,
            filter: `blur(${interpolate(p, [0, 1], [12, 0])}px)`,
            fontSize,
            fontWeight: 700,
            color,
            textShadow: "0 4px 28px rgba(0,0,0,0.35)",
            margin: "0 10px",
            whiteSpace: "nowrap",
          }}
        >
          {w}
        </span>
      );
    })}
  </div>
);

/** Clip-path wipe: a directional reveal without moving the glyphs —
 *  clip-path inset(0 100% 0 0) -> inset(0), per line. */
export const ClipWipeLine: React.FC<{
  words: string[];
  firstFrame: number;
  frame: number;
  fontSize: number;
  color?: string;
  fontFamily?: string;
  align?: "center" | "left";
  easing?: string;
}> = ({ words, firstFrame, frame, fontSize, color = "#FFFFFF", fontFamily = SERIF, align = "center", easing }) => {
  const mid = Math.max(1, Math.ceil(words.length / 2));
  const lines = [words.slice(0, mid), words.slice(mid)].filter((l) => l.length > 0);
  return (
    <div
      aria-label={words.join(" ")}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        fontFamily,
        lineHeight: 1.2,
        textAlign: align,
        alignItems: align === "left" ? "flex-start" : "center",
        padding: "0 48px",
      }}
    >
      {lines.map((line, li) => {
        const start = firstFrame + li * 3;
        const p = applyEasing(
          easing ?? "easeOut",
          interpolate(frame, [start, start + 15], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        );
        return (
          <div
            key={li}
            aria-hidden="true"
            style={{
              clipPath: `inset(0 ${interpolate(p, [0, 1], [100, 0])}% 0 0)`,
              fontSize,
              fontWeight: 700,
              color,
              textShadow: "0 4px 28px rgba(0,0,0,0.35)",
              whiteSpace: "nowrap",
            }}
          >
            {line.join(" ")}
          </div>
        );
      })}
    </div>
  );
};

/** Text on a path: the line rides a gentle SVG arc and scrolls into
 *  place as startOffset runs 100% -> 0%. Falls back to the mask
 *  reveal when the text is too long for the path (a long string
 *  would run off the curve and clip mid-word). */
export const ArcText: React.FC<{
  words: string[];
  firstFrame: number;
  frame: number;
  fontSize: number;
  color?: string;
  fontFamily?: string;
  width?: number;
  easing?: string;
}> = ({ words, firstFrame, frame, fontSize, color = "#FFFFFF", fontFamily = SERIF, width = 720, easing }) => {
  const text = words.join(" ");
  const p = applyEasing(
    easing ?? "easeOut",
    interpolate(frame, [firstFrame, firstFrame + 30], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );
  const startOffset = interpolate(p, [0, 1], [100, 0]);
  return (
    <div aria-label={text} style={{ width: "100%" }}>
      <svg
        width={width}
        height={Math.round(fontSize * 2.4)}
        viewBox={`0 0 ${width} ${Math.round(fontSize * 2.4)}`}
        aria-hidden="true"
      >
        <defs>
          <path
            id="kinetic-arc"
            d={`M 10,${Math.round(fontSize * 1.7)} Q ${width / 2},10 ${width - 10},${Math.round(fontSize * 1.7)}`}
            fill="none"
          />
        </defs>
        <text
          fontSize={fontSize}
          fontWeight={700}
          fill={color}
          fontFamily={fontFamily}
          style={{ textShadow: "0 4px 28px rgba(0,0,0,0.35)" }}
        >
          <textPath href="#kinetic-arc" startOffset={`${startOffset}%`}>
            {text}
          </textPath>
        </text>
      </svg>
    </div>
  );
};

/**
 * KineticReveal — the dispatcher. `word` is the v2.6 KineticLine
 * (word-by-word spring); the other four are the pack-10 reveals.
 * `path` needs a short string; long copy falls back to `mask` so
 * nothing clips mid-word. `rise` only applies to the word path.
 */
export const KineticReveal: React.FC<{
  reveal: string;
  words: string[];
  firstFrame: number;
  frame: number;
  fps: number;
  fontSize: number;
  color?: string;
  gapFrames?: number;
  rise?: boolean;
  fontFamily?: string;
  align?: "center" | "left";
  easing?: string;
}> = ({ reveal, words, firstFrame, frame, fps, fontSize, color, gapFrames = 7, rise = false, fontFamily, align, easing }) => {
  const r = resolveKinetic(reveal);
  if (r === "char") {
    return words.join(" ").length > 60 ? (
      <MaskRevealLine words={words} firstFrame={firstFrame} frame={frame} fontSize={fontSize} color={color} fontFamily={fontFamily} align={align} easing={easing} />
    ) : (
      <CharStaggerLine words={words} firstFrame={firstFrame} frame={frame} fontSize={fontSize} color={color} fontFamily={fontFamily} align={align} easing={easing} />
    );
  }
  if (r === "mask") {
    return <MaskRevealLine words={words} firstFrame={firstFrame} frame={frame} fontSize={fontSize} color={color} fontFamily={fontFamily} align={align} easing={easing} />;
  }
  if (r === "blur") {
    return <BlurInLine words={words} firstFrame={firstFrame} frame={frame} fontSize={fontSize} gapFrames={2} color={color} fontFamily={fontFamily} align={align} easing={easing} />;
  }
  if (r === "wipe") {
    return <ClipWipeLine words={words} firstFrame={firstFrame} frame={frame} fontSize={fontSize} color={color} fontFamily={fontFamily} align={align} easing={easing} />;
  }
  if (r === "path") {
    return words.join(" ").length > 28 ? (
      <MaskRevealLine words={words} firstFrame={firstFrame} frame={frame} fontSize={fontSize} color={color} fontFamily={fontFamily} align={align} easing={easing} />
    ) : (
      <ArcText words={words} firstFrame={firstFrame} frame={frame} fontSize={fontSize} color={color} fontFamily={fontFamily} easing={easing} />
    );
  }
  return (
    <KineticLine
      words={words}
      firstFrame={firstFrame}
      frame={frame}
      fps={fps}
      fontSize={fontSize}
      color={color}
      gapFrames={gapFrames}
      rise={rise}
      fontFamily={fontFamily}
      align={align}
    />
  );
};

/** Camera wrapper: scale + lateral drift driven by the local frame.
 *  v2.10: the drive is ease-in-out (shot-composition: camera moves
 *  use ease-in-out, never linear except continuous loops) — the
 *  move itself is unchanged, only its pacing curve. */
export const Camera: React.FC<{
  localFrame: number;
  sceneFrames: number;
  fromScale: number;
  toScale: number;
  fromX: number;
  toX: number;
  children: React.ReactNode;
}> = ({ localFrame, sceneFrames, fromScale, toScale, fromX, toX, children }) => {
  const raw = interpolate(localFrame, [0, Math.max(1, sceneFrames - 1)], [0, 1]);
  const progress = applyEasing("easeInOut", raw);
  const scale = interpolate(progress, [0, 1], [fromScale, toScale]);
  const x = interpolate(progress, [0, 1], [fromX, toX]);
  return (
    <AbsoluteFill style={{ transform: `scale(${scale}) translateX(${x}px)` }}>
      {children}
    </AbsoluteFill>
  );
};

/** Diagonal wipe transition overlay — a panel with a bright edge
 *  sweeps diagonally across in ~14-18 frames. Panel color is the
 *  palette accent: visible on light and dark backgrounds alike. */
export const DiagonalWipe: React.FC<{
  frame: number;
  palette: HarnessPalette;
}> = ({ frame, palette }) => {
  const x = interpolate(frame, [0, 14], [-900, 1400], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ overflow: "hidden", pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          top: -200,
          left: x,
          width: 700,
          height: 1120,
          background: palette.accent,
          transform: "skewX(-24deg)",
          boxShadow: `12px 0 40px ${palette.accentDeep}`,
        }}
      />
    </AbsoluteFill>
  );
};

/** Zoom-cut transition overlay: a fast scale punch, short and
 *  translucent so the cut never lands on a dead frame. */
export const ZoomCut: React.FC<{ frame: number; palette: HarnessPalette }> = ({
  frame,
  palette,
}) => {
  const scale = interpolate(frame, [0, 5, 10], [1.3, 1.05, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const opacity = interpolate(frame, [0, 10], [0.45, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill
      style={{
        backgroundColor: palette.background,
        opacity,
        transform: `scale(${scale})`,
        pointerEvents: "none",
      }}
    />
  );
};

/** One falling teardrop — y and opacity are pure functions of the frame. */
export const Teardrop: React.FC<{
  seed: number;
  frame: number;
  palette: HarnessPalette;
}> = ({ seed, frame, palette }) => {
  const x = 140 + rand(seed) * 1000;
  const speed = 2.2 + rand(seed + 40) * 2.4;
  const size = 10 + rand(seed + 80) * 14;
  const delay = rand(seed + 120) * 60;
  const local = frame - delay;
  if (local < 0) return null;
  const y = (local * speed) % 760 - 30;
  const opacity = interpolate(local % 120, [0, 15, 100, 119], [0, 0.9, 0.9, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: size,
        height: size * 1.5,
        borderRadius: "50% 50% 50% 50% / 60% 60% 40% 40%",
        background: `radial-gradient(circle at 35% 30%, ${palette.surface} 0%, ${palette.accent} 55%, ${palette.accentDeep} 100%)`,
        opacity,
        transform: `rotate(${Math.sin(frame * 0.05 + seed) * 8}deg)`,
        boxShadow: `0 0 14px ${palette.accent}`,
      }}
    />
  );
};

/** A shower of teardrops across the scene (final scene, cry/tear). */
export const Teardrops: React.FC<{
  frame: number;
  palette: HarnessPalette;
  count?: number;
}> = ({ frame, palette, count = 14 }) => (
  <>
    {Array.from({ length: count }, (_, i) => (
      <Teardrop key={i} seed={i + 1} frame={frame} palette={palette} />
    ))}
  </>
);
