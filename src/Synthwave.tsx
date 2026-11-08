import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { rand, SERIF } from "./harness/primitives";
import { HARNESS_DEFAULTS, type HarnessProps } from "./Harness";

/**
 * Synthwave — the purple-free retro style (v2.3).
 *
 * Adapted from the mg-styles-15 "80s Synthwave" film grammar, shifted
 * off purple per D'Vaughn's standing rule (no purple / magenta):
 * navy sky, striped orange-to-gold sun, cyan perspective grid,
 * wireframe mountains, chrome title, scanlines, VHS glitch.
 * No purple, no magenta, no pink anywhere in this file.
 *
 * Structure (title-sequence form, not scene splits): the hook IS the
 * title. Sun rises over the first 40%, the title slams in around
 * 40-55%, the subtitle/project flickers on in cyan neon after 60%,
 * the grid scrolls throughout, scanlines throughout.
 * Palette is locked to the style — a brief palette does not override
 * it, or it stops being synthwave.
 */

const NAVY_TOP = "#020617";
const NAVY_MID = "#0A2540";
const HORIZON = "#123A6B";
const CYAN = "#00E5FF";
const CYAN_DIM = "#0E7490";
const ORANGE = "#FF7A18";
const GOLD = "#FFD23F";
const CREAM = "#FFF7E6";

const Stars: React.FC = () => {
  const stars = Array.from({ length: 90 }, (_, i) => ({
    left: rand(i) * 1280,
    top: rand(i + 40) * 380,
    size: 1 + rand(i + 80) * 2,
    opacity: 0.3 + rand(i + 120) * 0.7,
  }));
  return (
    <AbsoluteFill>
      {stars.map((s, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: s.left,
            top: s.top,
            width: s.size,
            height: s.size,
            borderRadius: "50%",
            backgroundColor: "#FFFFFF",
            opacity: s.opacity,
          }}
        />
      ))}
    </AbsoluteFill>
  );
};

/** Striped retro sun, rising from below the horizon. */
const Sun: React.FC<{ frame: number; durationInFrames: number }> = ({
  frame,
  durationInFrames,
}) => {
  const rise = interpolate(frame, [0, durationInFrames * 0.4], [130, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  // Stripe bars: thin near the top, thickening toward the bottom.
  const stripes = [0, 1, 2, 3, 4, 5].map((i) => ({
    top: 150 + i * 30,
    height: 4 + i * 5,
  }));
  return (
    <div
      style={{
        position: "absolute",
        left: 640 - 165,
        top: 250 + rise,
        width: 330,
        height: 330,
        borderRadius: "50%",
        overflow: "hidden",
        background: `linear-gradient(${GOLD}, ${ORANGE})`,
        boxShadow: `0 0 60px ${ORANGE}, 0 0 140px ${ORANGE}55`,
      }}
    >
      {stripes.map((s, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: s.top,
            height: s.height,
            backgroundColor: NAVY_MID,
          }}
        />
      ))}
    </div>
  );
};

/** One-point perspective grid floor, scrolling toward the camera. */
const Grid: React.FC<{ frame: number }> = ({ frame }) => {
  const horizonY = 430;
  const fans = [-640, -420, -260, -140, -60, 0, 60, 140, 260, 420, 640];
  const scroll = (frame * 2.2) % 60;
  const rows = [0, 1, 2, 3, 4, 5, 6].map((k) => {
    const t = (k * 60 + scroll) / 420;
    return horizonY + Math.pow(t, 1.7) * 290;
  });
  return (
    <svg
      style={{ position: "absolute", left: 0, top: 0, width: 1280, height: 720 }}
      viewBox="0 0 1280 720"
    >
      {fans.map((x, i) => (
        <line
          key={`f${i}`}
          x1={640}
          y1={horizonY}
          x2={640 + x * 2.2}
          y2={720}
          stroke={CYAN}
          strokeWidth={1.5}
          opacity={0.75}
        />
      ))}
      {rows.map((y, i) => (
        <line
          key={`r${i}`}
          x1={0}
          y1={y}
          x2={1280}
          y2={y}
          stroke={CYAN}
          strokeWidth={1 + i * 0.4}
          opacity={0.35 + i * 0.09}
        />
      ))}
      <polyline
        points="0,430 180,390 320,410 480,380 640,405 820,385 1000,410 1150,395 1280,420"
        fill="none"
        stroke={CYAN}
        strokeWidth={2}
        opacity={0.9}
      />
      <polyline
        points="0,430 220,400 420,415 700,395 900,412 1280,400"
        fill="none"
        stroke={CYAN_DIM}
        strokeWidth={1.5}
        opacity={0.7}
      />
    </svg>
  );
};

export const Synthwave: React.FC<HarnessProps> = (props) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const title = props.hook ?? "";
  const sub = props.subtitle ?? props.project ?? "";
  const slamAt = durationInFrames * 0.4;
  const slam = interpolate(frame, [slamAt, slamAt + 18], [1.35, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const titleOpacity = interpolate(frame, [slamAt, slamAt + 8], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const flareOpacity = interpolate(
    frame,
    [slamAt, slamAt + 10, slamAt + 45],
    [0, 0.9, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const subOn = frame > durationInFrames * 0.6;
  const flicker = subOn ? 0.75 + 0.25 * Math.sin(frame * 0.9) : 0;
  const glitch = frame % 47 < 2 ? 6 : 0;
  const playOpacity = interpolate(frame, [0, 24, 30], [0.9, 0.9, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(${NAVY_TOP} 0%, ${NAVY_MID} 42%, ${HORIZON} 60%, #04101F 60%, #020617 100%)`,
        transform: `translateX(${glitch}px)`,
        overflow: "hidden",
        fontFamily: SERIF,
      }}
    >
      <Stars />
      <Sun frame={frame} durationInFrames={durationInFrames} />
      <Grid frame={frame} />
      {/* Chrome title slam */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 130,
          textAlign: "center",
          opacity: titleOpacity,
          transform: `scale(${slam})`,
        }}
      >
        <div
          style={{
            fontSize: 84,
            fontWeight: 800,
            letterSpacing: 2,
            color: CREAM,
            textShadow: `0 0 12px ${CYAN}, 0 0 42px ${CYAN}88, 0 4px 0 #94A3B8`,
            lineHeight: 1.05,
            padding: "0 60px",
          }}
        >
          {title}
        </div>
        <div
          style={{
            width: 260,
            height: 6,
            margin: "18px auto 0 auto",
            background: `linear-gradient(90deg, ${ORANGE}, ${GOLD})`,
            boxShadow: `0 0 18px ${ORANGE}`,
          }}
        />
      </div>
      {/* Lens flare on the slam */}
      <div
        style={{
          position: "absolute",
          left: 640 - 90,
          top: 190,
          width: 180,
          height: 180,
          borderRadius: "50%",
          background: `radial-gradient(circle, #FFFFFFCC 0%, ${CYAN}55 40%, transparent 70%)`,
          opacity: flareOpacity,
        }}
      />
      {/* Cyan neon subtitle / project */}
      {sub ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 42,
            textAlign: "center",
            fontSize: 30,
            fontWeight: 700,
            letterSpacing: 6,
            color: CYAN,
            opacity: flicker,
            textShadow: `0 0 8px ${CYAN}, 0 0 28px ${CYAN}`,
          }}
        >
          {sub.toUpperCase()}
        </div>
      ) : null}
      {/* VHS PLAY indicator, first second */}
      <div
        style={{
          position: "absolute",
          left: 40,
          top: 36,
          fontFamily: "monospace",
          fontSize: 26,
          letterSpacing: 3,
          color: "#FFFFFF",
          opacity: playOpacity,
        }}
      >
        PLAY ▶
      </div>
      {/* Scanlines */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "repeating-linear-gradient(transparent 0 2px, rgba(0,0,0,0.16) 2px 4px)",
          pointerEvents: "none",
        }}
      />
    </AbsoluteFill>
  );
};

export const SYNTHWAVE_DEFAULTS = {
  lengthSeconds: 12,
  palette: HARNESS_DEFAULTS.palette,
  hook: "Build your way out",
};
