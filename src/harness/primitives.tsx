import React from "react";
import { AbsoluteFill, interpolate, spring } from "remotion";

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

export const SERIF = "Georgia, 'Times New Roman', serif";

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
 *  the "rise" variant's type motion. */
export const KineticLine: React.FC<{
  words: string[];
  firstFrame: number;
  frame: number;
  fps: number;
  fontSize: number;
  color?: string;
  gapFrames?: number;
  rise?: boolean;
}> = ({ words, firstFrame, frame, fps, fontSize, color = "#FFFFFF", gapFrames = 7, rise = false }) => (
  <div
    style={{
      display: "flex",
      flexWrap: "wrap",
      justifyContent: "center",
      alignItems: "center",
      fontFamily: SERIF,
      lineHeight: 1.25,
      textAlign: "center",
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

/** Camera wrapper: scale + lateral drift driven by the local frame. */
export const Camera: React.FC<{
  localFrame: number;
  sceneFrames: number;
  fromScale: number;
  toScale: number;
  fromX: number;
  toX: number;
  children: React.ReactNode;
}> = ({ localFrame, sceneFrames, fromScale, toScale, fromX, toX, children }) => {
  const progress = interpolate(localFrame, [0, Math.max(1, sceneFrames - 1)], [0, 1]);
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
