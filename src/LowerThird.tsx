import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { SERIF, resolveFont, DEFAULT_PALETTE, type HarnessPalette } from "./harness/primitives";

/**
 * LowerThird — the transparent-overlay rung (v2.3, lower-thirds-skills;
 * v2.10: first-class overlay with keyword pills + corner source credit).
 *
 * Props: name, role, pills (keyword chips), source (corner credit),
 * palette, lengthSeconds (default 6), font.
 * NO background fill anywhere on the root: the composition is
 * transparent so the export (VP9 WebM or ProRes 4444) carries an
 * alpha channel for OBS / Premiere / Resolve. A name strap slides in
 * over the first 11 frames, dwells, and slides out over the last 11
 * — the skill's in/out rule (under 12 frames; v2.3 shipped 15).
 * The first and last frames are empty, so the clip never pops on or
 * cuts off in the edit. Rendered at 1280x720 so it drops over any
 * 720p timeline; the strap sits in the lower third, inside the 6%
 * title-safe margin (left 80px, bottom 90px). Text sits on its own
 * backing panel, never bare on footage. Long names shrink to fit
 * instead of overflowing.
 *
 * LowerThirdOverlay is the same strap as an in-clip overlay for
 * Vertical shorts and the Harness composition: same slide/settle,
 * same pills and credit, positioned inside the 9:16 safe areas
 * (top 12% / bottom 18% / sides 6%) instead of the 720p ones.
 */

export type LowerThirdProps = {
  name?: string;
  role?: string;
  pills?: string[];
  source?: string;
  lengthSeconds?: number;
  palette?: HarnessPalette;
  font?: string;
};

/** In/out length in frames — the skill's "under 12 frames" rule. */
export const LOWER_THIRD_IN_FRAMES = 11;

/** Shrink a long name to its box instead of overflowing it. */
const nameSize = (name: string, base: number): number =>
  name.length > 24 ? Math.round(base * 0.68) : name.length > 16 ? Math.round(base * 0.82) : base;

const LowerThirdStrap: React.FC<{
  name: string;
  role: string;
  pills: string[];
  palette: HarnessPalette;
  frame: number;
  durationInFrames: number;
  fontFamily: string;
  nameFontSize: number;
  roleFontSize: number;
  left: number;
  bottom: number;
  maxWidth: number;
}> = ({ name, role, pills, palette, frame, durationInFrames, fontFamily, nameFontSize, roleFontSize, left, bottom, maxWidth }) => {
  const inEnd = LOWER_THIRD_IN_FRAMES;
  const outStart = durationInFrames - LOWER_THIRD_IN_FRAMES;
  const slideIn = interpolate(frame, [0, inEnd], [-560, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const slideOut = interpolate(frame, [outStart, durationInFrames], [0, -560], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const x = slideIn + slideOut;
  // Opacity reaches 0 two frames before the end, so the last frame
  // is empty (the skill's "starts and ends empty" rule).
  const opacity = interpolate(frame, [0, 5, outStart, durationInFrames - 2], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        position: "absolute",
        left,
        bottom,
        maxWidth,
        transform: `translateX(${x}px)`,
        opacity,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        fontFamily,
      }}
    >
      <div style={{ display: "flex", alignItems: "stretch" }}>
        <div style={{ width: 10, backgroundColor: palette.accent }} />
        <div
          style={{
            backgroundColor: palette.background,
            padding: "18px 32px 18px 24px",
          }}
        >
          <div style={{ fontSize: nameFontSize, fontWeight: 700, color: palette.text, lineHeight: 1.1 }}>
            {name}
          </div>
          {role ? (
            <div style={{ fontSize: roleFontSize, color: palette.accent, marginTop: 4 }}>{role}</div>
          ) : null}
        </div>
      </div>
      {pills.length > 0 ? (
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          {pills.map((pill, i) => {
            const pillOpacity = interpolate(frame, [inEnd + 2 + i * 3, inEnd + 8 + i * 3], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            const pillY = interpolate(pillOpacity, [0, 1], [10, 0]);
            return (
              <div
                key={`${pill}-${i}`}
                style={{
                  opacity: pillOpacity,
                  transform: `translateY(${pillY}px)`,
                  border: `2px solid ${palette.accent}`,
                  backgroundColor: palette.background,
                  color: palette.text,
                  fontSize: Math.max(16, roleFontSize - 6),
                  fontWeight: 700,
                  padding: "4px 12px",
                  borderRadius: 999,
                  whiteSpace: "nowrap",
                }}
              >
                {pill}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};

/**
 * LowerThirdOverlay — the strap + corner credit as an in-clip
 * overlay. `layout` picks the safe-area geometry: "landscape"
 * (1280x720, 6% margins) or "vertical" (720x1280, 9:16 safe areas).
 * Mounted by Vertical and Harness when the storyboard carries a
 * Name: label; the standalone LowerThird composition wraps it in a
 * transparent root. The strap slides in over the clip's first 11
 * frames, holds, and slides out over the last 11 — the same timing
 * as the standalone export.
 */
export const LowerThirdOverlay: React.FC<{
  name: string;
  role?: string;
  pills?: string[];
  source?: string;
  palette: HarnessPalette;
  frame: number;
  durationInFrames: number;
  fontFamily?: string;
  layout: "landscape" | "vertical";
}> = ({ name, role = "", pills = [], source = "", palette, frame, durationInFrames, fontFamily, layout }) => {
  const family = fontFamily ?? SERIF;
  const vertical = layout === "vertical";
  const inEnd = LOWER_THIRD_IN_FRAMES;
  const outStart = durationInFrames - LOWER_THIRD_IN_FRAMES;
  const creditOpacity = interpolate(frame, [inEnd, inEnd + 6, outStart, durationInFrames - 2], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <>
      <LowerThirdStrap
        name={name}
        role={role}
        pills={pills}
        palette={palette}
        frame={frame}
        durationInFrames={durationInFrames}
        fontFamily={family}
        nameFontSize={nameSize(name, vertical ? 34 : 44)}
        roleFontSize={vertical ? 22 : 28}
        left={vertical ? 43 : 80}
        bottom={vertical ? 230 : 90}
        maxWidth={vertical ? 430 : 700}
      />
      {source ? (
        <div
          style={{
            position: "absolute",
            right: vertical ? 43 : 77,
            bottom: vertical ? 230 : 43,
            maxWidth: vertical ? 200 : 320,
            textAlign: "right",
            fontFamily: family,
            fontSize: vertical ? 20 : 20,
            color: palette.text,
            opacity: 0.75 * creditOpacity,
          }}
        >
          {source}
        </div>
      ) : null}
    </>
  );
};

export const LowerThird: React.FC<LowerThirdProps> = (props) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const palette = { ...DEFAULT_PALETTE, ...(props.palette ?? {}) };
  const name = props.name ?? "";
  const role = props.role ?? "";
  const pills = props.pills ?? [];
  const source = props.source ?? "";
  const fontFamily = resolveFont(props.font);

  return (
    <AbsoluteFill>
      <LowerThirdOverlay
        name={name}
        role={role}
        pills={pills}
        source={source}
        palette={palette}
        frame={frame}
        durationInFrames={durationInFrames}
        fontFamily={fontFamily}
        layout="landscape"
      />
    </AbsoluteFill>
  );
};

export const LOWER_THIRD_DEFAULTS = {
  lengthSeconds: 6,
  palette: DEFAULT_PALETTE,
  name: "",
  role: "",
  pills: [],
  source: "",
};
