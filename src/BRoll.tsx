import React from "react";
import {
  AbsoluteFill,
  Loop,
  OffthreadVideo,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { KineticLine, resolveFont, type HarnessPalette } from "./harness/primitives";

/**
 * BRoll — the b-roll-skills timing logic as Remotion code (v2.7),
 * 1280x720 landscape (the local pool clips are landscape).
 *
 * The skill's rules, implemented:
 *  - Cut on the noun: each segment starts at the frame its noun is
 *    spoken (segments are cut at noun timestamps, computed by
 *    watcher/broll_timing.py from word timings).
 *  - Never a still: a clip segment plays real footage; a panel
 *    segment (no usable clip) is code-drawn motion — drifting blobs
 *    + words landing — never a frozen frame.
 *  - Sync the fact to the word: the keyword overlay reveals exactly
 *    at the noun (nounAt), not at the segment start; the clip plays
 *    bare before it. One idea on screen at a time; the overlay
 *    leaves when the segment ends.
 *  - Fallback to a code-drawn panel when a clip is missing: kind
 *    "panel" (or a clip whose file is absent) renders the panel.
 *
 * Footage limit (honest): Motion Bot has no footage source of its
 * own. Clips come only from the local pool under public/broll/
 * (Pixabay stock downloaded 2026-11-20; Pixabay search is HTTP 400
 * since Nov 20 16:34 ET, Pexels is out by his rule, no new keys).
 * Segments whose noun matches no pool clip render as panels — the
 * storyboard records which segments are clips and which are panels.
 */

export type BRollSegment = {
  /** Segment window, seconds from the clip start. */
  from: number;
  to: number;
  /** "clip" plays pool footage; "panel" is code-drawn. */
  kind: "clip" | "panel";
  /** Path relative to public/, e.g. "broll/pixabay-1044.mp4". */
  clip?: string;
  /** Real duration of the clip file, seconds (for looping). */
  clipDurationSeconds?: number;
  /** Absolute second the noun is spoken — overlay reveal + cut. */
  nounAt: number;
  /** The noun / keyword shown on screen (a few words, not the line). */
  keyword: string;
  /** The beat's words (for the panel fallback's big type). */
  words: string[];
};

export type BRollProps = {
  segments?: BRollSegment[];
  palette?: HarnessPalette;
  lengthSeconds?: number;
};

export const BROLL_DEFAULTS: Required<BRollProps> = {
  segments: [
    {
      from: 0,
      to: 4,
      kind: "panel",
      nounAt: 0,
      keyword: "Panels turn",
      words: ["Panels", "turn", "to", "face", "the", "morning"],
    },
    {
      from: 4,
      to: 7,
      kind: "clip",
      clip: "broll/pixabay-21118.mp4",
      clipDurationSeconds: 6,
      nounAt: 4,
      keyword: "grid wakes",
      words: ["The", "grid", "wakes", "row", "by", "row"],
    },
    {
      from: 7,
      to: 12,
      kind: "clip",
      clip: "broll/pixabay-1044.mp4",
      clipDurationSeconds: 14,
      nounAt: 7,
      keyword: "Power reaches",
      words: ["Power", "reaches", "the", "town", "by", "noon"],
    },
  ],
  palette: {
    background: "#D9C7A7",
    surface: "#4FC3F7",
    accent: "#0F766E",
    accentDeep: "#0A4D48",
    text: "#1F1A14",
    glow: "#0F766E",
    particle: "#0F766E",
  },
  lengthSeconds: 12,
};

const FONT = resolveFont("serif");

/** Keyword overlay card: surface card, accent left bar, keyword in
 *  palette text. Reveals at the noun, inside its segment. */
const KeywordCard: React.FC<{
  keyword: string;
  localFrame: number;
  revealFrame: number;
  palette: HarnessPalette;
}> = ({ keyword, localFrame, revealFrame, palette }) => {
  const p = interpolate(localFrame - revealFrame, [0, 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const y = interpolate(p, [0, 1], [60, 0]);
  return (
    <div
      style={{
        position: "absolute",
        left: 64,
        bottom: 72,
        opacity: p,
        transform: `translateY(${y}px)`,
        zIndex: 4,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "stretch",
          backgroundColor: palette.surface,
          borderRadius: 6,
          overflow: "hidden",
        }}
      >
        <div style={{ width: 10, backgroundColor: palette.accent }} />
        <div
          style={{
            fontFamily: FONT,
            fontSize: 54,
            fontWeight: 800,
            color: palette.text,
            padding: "18px 28px",
            whiteSpace: "nowrap",
          }}
        >
          {keyword}
        </div>
      </div>
    </div>
  );
};

/** Code-drawn panel fallback: drifting surface blobs + the beat's
 *  words landing + an accent shape. Moves every frame — never a still. */
const PanelFallback: React.FC<{
  segment: BRollSegment;
  localFrame: number;
  fps: number;
  palette: HarnessPalette;
}> = ({ segment, localFrame, fps, palette }) => {
  const x1 = Math.sin(localFrame * 0.008) * 70;
  const y1 = Math.cos(localFrame * 0.006) * 46;
  return (
    <AbsoluteFill style={{ backgroundColor: palette.background, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          left: 80 + x1,
          top: 90 + y1,
          width: 420,
          height: 420,
          borderRadius: "50%",
          backgroundColor: palette.surface,
          opacity: 0.55,
        }}
      />
      <div
        style={{
          position: "absolute",
          right: 60 - x1,
          bottom: 60 - y1,
          width: 300,
          height: 300,
          borderRadius: "50%",
          backgroundColor: palette.accent,
          opacity: 0.28,
        }}
      />
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          padding: "0 90px",
        }}
      >
        <KineticLine
          words={segment.words}
          firstFrame={6}
          frame={localFrame}
          fps={fps}
          fontSize={64}
          color={palette.text}
          gapFrames={6}
          fontFamily={FONT}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const BSegment: React.FC<{
  segment: BRollSegment;
  localFrame: number;
  fps: number;
  palette: HarnessPalette;
}> = ({ segment, localFrame, fps, palette }) => {
  const revealFrame = Math.max(0, Math.round((segment.nounAt - segment.from) * fps));
  const segFrames = Math.max(1, Math.round((segment.to - segment.from) * fps));
  const clipFrames = Math.round((segment.clipDurationSeconds ?? segFrames / fps) * fps);
  const needsLoop = segment.kind === "clip" && segment.clip && clipFrames < segFrames;
  return (
    <AbsoluteFill style={{ backgroundColor: "#0a0a0a" }}>
      {segment.kind === "clip" && segment.clip ? (
        needsLoop ? (
          <Loop durationInFrames={clipFrames}>
            <OffthreadVideo
              src={staticFile(segment.clip)}
              trimAfter={clipFrames}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
              muted
              pauseWhenBuffering
            />
          </Loop>
        ) : (
          <OffthreadVideo
            src={staticFile(segment.clip)}
            trimAfter={segFrames}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
            muted
            pauseWhenBuffering
          />
        )
      ) : (
        <PanelFallback
          segment={segment}
          localFrame={localFrame}
          fps={fps}
          palette={palette}
        />
      )}
      {/* Legibility shade under the keyword card. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 190,
          background:
            "linear-gradient(to top, rgba(0,0,0,0.45) 0%, transparent 100%)",
        }}
      />
      <KeywordCard
        keyword={segment.keyword}
        localFrame={localFrame}
        revealFrame={revealFrame}
        palette={palette}
      />
    </AbsoluteFill>
  );
};

export const BRoll: React.FC<BRollProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const palette = { ...BROLL_DEFAULTS.palette, ...(props.palette ?? {}) };
  const segments =
    props.segments && props.segments.length > 0
      ? props.segments
      : BROLL_DEFAULTS.segments;

  return (
    <AbsoluteFill style={{ backgroundColor: "#0a0a0a" }}>
      {segments.map((segment, i) => (
        <Sequence
          key={i}
          from={Math.round(segment.from * fps)}
          durationInFrames={Math.max(
            1,
            Math.round((segment.to - segment.from) * fps),
          )}
          name={`Segment ${i + 1} (${segment.kind})`}
        >
          <BSegment
            segment={segment}
            localFrame={frame - Math.round(segment.from * fps)}
            fps={fps}
            palette={palette}
          />
        </Sequence>
      ))}
      {/* Clip-level accent bar for continuity across cuts. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          height: 8,
          backgroundColor: palette.accent,
          zIndex: 5,
        }}
      />
    </AbsoluteFill>
  );
};
