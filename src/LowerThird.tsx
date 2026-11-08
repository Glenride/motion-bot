import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { SERIF, type HarnessPalette } from "./harness/primitives";
import { HARNESS_DEFAULTS } from "./Harness";

/**
 * LowerThird — the transparent-overlay rung (v2.3, lower-thirds-skills).
 *
 * Props: name, role, palette, lengthSeconds (default 6).
 * NO background fill anywhere: the composition is transparent so the
 * export (VP9 WebM or ProRes 4444) carries an alpha channel for OBS /
 * Premiere / Resolve. A name strap slides in over the first 15
 * frames, dwells, and slides out over the last 15 — the skill's
 * in/out timing rule. Rendered at 1280x720 so it drops over any
 * 720p timeline; the strap sits in the lower third, 90px above the
 * bottom edge (broadcast safe area).
 */

export type LowerThirdProps = {
  name?: string;
  role?: string;
  lengthSeconds?: number;
  palette?: HarnessPalette;
};

export const LowerThird: React.FC<LowerThirdProps> = (props) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const palette = { ...HARNESS_DEFAULTS.palette, ...(props.palette ?? {}) };
  const name = props.name ?? "";
  const role = props.role ?? "";
  const inEnd = 15;
  const outStart = durationInFrames - 15;
  const slideIn = interpolate(frame, [0, inEnd], [-560, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const slideOut = interpolate(frame, [outStart, durationInFrames], [0, -560], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const x = slideIn + slideOut;
  const opacity = interpolate(frame, [0, 6, outStart, durationInFrames], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: 80,
          bottom: 90,
          transform: `translateX(${x}px)`,
          opacity,
          display: "flex",
          alignItems: "stretch",
          fontFamily: SERIF,
        }}
      >
        <div style={{ width: 10, backgroundColor: palette.accent }} />
        <div
          style={{
            backgroundColor: palette.background,
            padding: "18px 32px 18px 24px",
          }}
        >
          <div style={{ fontSize: 44, fontWeight: 700, color: palette.text, lineHeight: 1.1 }}>
            {name}
          </div>
          {role ? (
            <div style={{ fontSize: 28, color: palette.accent, marginTop: 4 }}>{role}</div>
          ) : null}
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const LOWER_THIRD_DEFAULTS = {
  lengthSeconds: 6,
  palette: HARNESS_DEFAULTS.palette,
  name: "",
  role: "",
};
