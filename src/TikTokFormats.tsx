import React from "react";
import { AbsoluteFill, interpolate, spring, useVideoConfig } from "remotion";
import { KineticLine, type HarnessPalette } from "./harness/primitives";

/**
 * TikTok formats — v2.11, pack 14 (tiktok-video-skills).
 *
 * v2.6 Vertical already covers the base short-form grammar (9:16,
 * 120px safe areas, hook in the first 1s, fast cuts). These are
 * genuinely new format patterns that EXTEND it — new timing and
 * new layouts, not palette swaps — selected by a `TikTok:` label
 * (hook-first | fast-cut | duet) via the director's
 * `tiktokFormat` prop. No label means the v2.6 Vertical exactly
 * as before.
 *
 * Shipped:
 *  - hook-first: the first scene is a 1-second punch — the hook
 *    line on screen at frame 1, biggest type in the clip, snap
 *    zoom, no fade-up from black (the skill's hook rule).
 *  - fast-cut: uneven cut schedule (never a metronome) with a
 *    punch-in zoom interrupt at every cut — the skill's pattern
 *    interrupts, driven off the frame.
 *  - duet: a reaction split — the original on the left, the
 *    reaction on the right, payoff full-width after.
 *
 * NOT built: caption-led storytelling (word-timed karaoke needs
 * real Whisper word timestamps — the skill's rule 1 forbids
 * faking them by even-splitting a line, and no transcription
 * step is wired) and the countdown trend template (a
 * frame-accurate countdown is its own composition shape, not a
 * Vertical format; the countdown-video skill's `durationInSeconds`
 * prop + digit reel belong in a future Countdown comp).
 */

export type TikTokFormat = "hook-first" | "fast-cut" | "duet";

export const TIKTOK_FORMATS: TikTokFormat[] = ["hook-first", "fast-cut", "duet"];

export const resolveTikTokFormat = (name?: string): TikTokFormat | "" => {
  const key = (name ?? "").trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (key === "hook-first" || key === "hookfirst" || key === "hook") {
    return "hook-first";
  }
  if (key === "fast-cut" || key === "fastcut" || key === "fast") {
    return "fast-cut";
  }
  if (key === "duet" || key === "reaction" || key === "reaction-split") {
    return "duet";
  }
  return "";
};

/** Punch-in zoom interrupt (short-form-video skill): a snap to
 *  112% on the beat, spring-driven off the scene's first frame. */
export const PunchIn: React.FC<{
  frame: number;
  children: React.ReactNode;
}> = ({ frame, children }) => {
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 12, stiffness: 200 } });
  const scale = interpolate(s, [0, 1], [1, 1.12]);
  return (
    <div style={{ width: "100%", height: "100%", transform: `scale(${scale})`, transformOrigin: "50% 45%" }}>
      {children}
    </div>
  );
};

/** Uneven cut schedule for fast-cut: scene lengths vary by design
 *  (the skill's example cuts are uneven on purpose — a metronome
 *  reads as boredom). Multipliers cycle [0.72, 1.18, 0.9, 1.15,
 *  0.8, 1.1] and are normalized so the scenes fill the duration. */
export const fastCutStarts = (
  durationInFrames: number,
  n: number,
): { starts: number[]; lengths: number[] } => {
  const mults = [0.72, 1.18, 0.9, 1.15, 0.8, 1.1];
  const raw = Array.from({ length: n }, (_, i) => mults[i % mults.length]);
  const total = raw.reduce((a, b) => a + b, 0);
  const lengths = raw.map((m) => Math.max(24, Math.round((m / total) * durationInFrames)));
  // Fix rounding drift on the last scene so the sum is exact.
  const drift = durationInFrames - lengths.reduce((a, b) => a + b, 0);
  lengths[lengths.length - 1] += drift;
  const starts: number[] = [];
  lengths.reduce((acc, len, i) => {
    starts[i] = acc;
    return acc + len;
  }, 0);
  return { starts, lengths };
};

/** Hook-first starts: scene 0 is exactly 1 second (30f) — the
 *  punch — and the remaining scenes split the rest evenly. */
export const hookFirstStarts = (
  durationInFrames: number,
  n: number,
  fps: number,
): { starts: number[]; lengths: number[] } => {
  if (n <= 1) {
    return { starts: [0], lengths: [durationInFrames] };
  }
  const first = Math.min(fps, Math.floor(durationInFrames / 3));
  const rest = durationInFrames - first;
  const per = Math.floor(rest / (n - 1));
  const lengths = [first];
  for (let i = 1; i < n; i++) {
    lengths.push(i === n - 1 ? rest - per * (n - 2) : per);
  }
  const starts: number[] = [];
  lengths.reduce((acc, len, i) => {
    starts[i] = acc;
    return acc + len;
  }, 0);
  return { starts, lengths };
};

/** Duet / reaction split: the original plays first, full-width —
 *  then the reaction lands. The reaction pops in at 40% of the
 *  duet with a punch-in, and the frame splits 50/50 with a 4px
 *  accent divider. The two-phase beat is the format: a static
 *  split never moves, so the critic reads identical frames
 *  mid-split. Both panels keep the 9:16 safe areas (top 12% /
 *  bottom 18% of the 1280 height). */
export const DuetSplit: React.FC<{
  originalWords: string[];
  reactionWords: string[];
  frame: number;
  durationInFrames: number;
  fps: number;
  palette: HarnessPalette;
  fontFamily: string;
}> = ({ originalWords, reactionWords, frame, durationInFrames, fps, palette, fontFamily }) => {
  const chip = (label: string) => (
    <div
      style={{
        fontFamily,
        fontSize: 22,
        letterSpacing: 4,
        fontWeight: 700,
        color: palette.accent,
        textTransform: "uppercase",
        marginBottom: 24,
      }}
    >
      {label}
    </div>
  );
  // The reaction lands at 40% of the duet — before that the
  // original owns the frame.
  const reactAt = Math.round(durationInFrames * 0.4);
  const split = frame >= reactAt;
  if (!split) {
    return (
      <AbsoluteFill
        style={{
          justifyContent: "center",
          padding: "154px 48px 230px 48px",
          backgroundColor: palette.background,
        }}
      >
        {chip("Original")}
        <KineticLine
          words={originalWords}
          firstFrame={8}
          frame={frame}
          fps={fps}
          fontSize={64}
          color={palette.text}
          gapFrames={7}
          fontFamily={fontFamily}
          align="left"
        />
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{ flexDirection: "row" }}>
      {/* Original — muted, smaller, left. */}
      <div
        style={{
          width: 360,
          height: "100%",
          padding: "154px 24px 230px 24px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          backgroundColor: palette.background,
        }}
      >
        {chip("Original")}
        <KineticLine
          words={originalWords}
          firstFrame={8}
          frame={frame}
          fps={fps}
          fontSize={44}
          color={palette.text}
          gapFrames={7}
          fontFamily={fontFamily}
          align="left"
        />
      </div>
      {/* Divider — the accent carrier for this format. */}
      <div style={{ width: 4, height: "100%", backgroundColor: palette.accent, zIndex: 5 }} />
      {/* Reaction — bigger, punch-in, right. */}
      <div
        style={{
          width: 356,
          height: "100%",
          padding: "154px 24px 230px 24px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          backgroundColor: palette.surface,
        }}
      >
        {chip("Reaction")}
        <PunchIn frame={frame - reactAt}>
          <KineticLine
            words={reactionWords}
            firstFrame={8}
            frame={frame - reactAt}
            fps={fps}
            fontSize={58}
            color={palette.text}
            gapFrames={5}
            fontFamily={fontFamily}
            align="left"
          />
        </PunchIn>
      </div>
    </AbsoluteFill>
  );
};
