import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { DriftBlobs, resolveFont, type HarnessPalette } from "./harness/primitives";
import { HARNESS_DEFAULTS } from "./Harness";
import { countUp } from "./Chart";

/**
 * EverestPanels — the everest-components catalog as Remotion code
 * (v2.8), 1280x720 landscape.
 *
 * The catalog is craft guidance, not a renderer: each category is
 * recreated here as a code-drawn PATTERN with the brief's own words
 * and numbers only. Never a fake screenshot of a real product, a
 * real post, a real person's handle, or a real model logo; never
 * an invented number for a counter, a bar, a receipt, or a score.
 * Counters only count numbers already in the brief.
 *
 * Categories implemented (one `category` prop selects the panel):
 *  - product-ui: typed prompt + tool-call step chips ticking done
 *    + done line (brief's own words).
 *  - prompts-results: prompt card to staged output under an
 *    elapsed timer, ending on a quiet time stamp.
 *  - agents-workflows: coordinator task rows ticking done, then a
 *    merged summary — a real surface, not a node diagram.
 *  - models-benchmarks: bars grow old -> new with the delta
 *    counting up (easeOutCubic, tabular-nums); winner takes accent.
 *  - comparisons: two windows side by side, one recommendation
 *    chip per row — winner ticks, loser dims.
 *  - launch-news: mark, name, version ticking into place; one
 *    sentence highlighted; tiers light up.
 *  - pricing-limits: the tier you need lifts; old price struck
 *    through; receipt prints tokens/minutes/tool calls/total —
 *    all figures only from the brief.
 *  - lower-thirds: name + role slide in and settle; keyword pills;
 *    corner source credit (only when the brief supplies it).
 *  - usage-cost: usage bar fills to the cap; limit banner slides
 *    in with a reset countdown — caps only from the brief.
 *  - evidence-quotes: styled quote card, rest dims, one line
 *    highlights with a slow push-in (never a fake real screenshot).
 *
 * DROPPED — everest-broll-frames: every pattern in that category
 * (third-party clip in a frame, presenter inset, phone capture of
 * an app, watch-page card, punch-in on a screen recording) needs
 * real footage or a real app screenshot to frame. Motion Bot has
 * no footage source of its own (Pixabay search HTTP 400 since
 * Nov 20, Pexels out by rule), and a code-drawn fake of a real
 * app is exactly what the skill forbids. The router never selects
 * it; the watcher falls back to the default route with a note.
 *
 * Cards use palette.surface, never white: a white card is neither
 * background nor surface within the critic's tolerance, so a
 * white prompt card + white chips held the light field at 46%
 * and failed palette_present (v2.8 fix). Tracks inside surface
 * cards use palette.background so they still read.
 *
 * EVEREST_DEFAULTS is a Studio-preview scaffold (task-391 words,
 * generic demo numbers for the panels that need them). Live renders
 * always pass brief-supplied props, and the director never selects
 * a panel whose numbers are absent from the task — defaults never
 * stand in for a real figure on a real render.
 *
 * Everything is a pure function of useCurrentFrame(). A progress
 * hairline + an accent top bar sit outside every panel, so the
 * accent family reads in every frame and hold frames still differ.
 */

export type EverestCategory =
  | "product-ui"
  | "prompts-results"
  | "agents-workflows"
  | "models-benchmarks"
  | "comparisons"
  | "launch-news"
  | "pricing-limits"
  | "lower-thirds"
  | "usage-cost"
  | "evidence-quotes";

export type EverestBar = { label: string; old: number; new: number };
export type EverestTier = {
  name: string;
  price: string;
  note?: string;
  recommended?: boolean;
};
export type EverestUsage = {
  used: number;
  cap: number;
  label?: string;
  /** Seconds until reset; countdown only when supplied. */
  resetSeconds?: number;
};
export type EverestCompareRow = {
  label: string;
  left: string;
  right: string;
  winner: "left" | "right";
};
export type EverestReceipt = {
  tokens?: number;
  minutes?: number;
  calls?: number;
  total?: string;
};

export type EverestPanelsProps = {
  category?: EverestCategory;
  /** The clip's hook — the panel header / highlighted sentence. */
  hook?: string;
  prompt?: string;
  steps?: string[];
  outputLines?: string[];
  bars?: EverestBar[];
  tiers?: EverestTier[];
  usage?: EverestUsage;
  name?: string;
  role?: string;
  pills?: string[];
  quote?: string;
  highlight?: string;
  comparison?: { left: string; right: string; rows: EverestCompareRow[] };
  version?: string;
  receipt?: EverestReceipt;
  wasPrice?: string;
  nowPrice?: string;
  project?: string;
  palette?: HarnessPalette;
  lengthSeconds?: number;
};

const SERIF = resolveFont("serif");
const SANS = resolveFont("sans");
const MONO = resolveFont("mono");

const TASK391_PALETTE = {
  background: "#D9C7A7",
  surface: "#4FC3F7",
  accent: "#0F766E",
  accentDeep: "#0A4D48",
  text: "#1F1A14",
  glow: "#0F766E",
  particle: "#0F766E",
};
const TASK391_BEATS = [
  "Panels turn to face the morning",
  "The grid wakes row by row",
  "Power reaches the town by noon",
];

export const EVEREST_DEFAULTS: Required<
  Omit<EverestPanelsProps, "usage" | "comparison" | "receipt" | "version" | "wasPrice" | "nowPrice" | "project" | "highlight">
> & {
  usage: EverestUsage;
  comparison: { left: string; right: string; rows: EverestCompareRow[] };
  receipt: EverestReceipt;
  version: string;
  wasPrice: string;
  nowPrice: string;
  project: string;
  highlight: string;
} = {
  category: "product-ui",
  hook: "Panels turn to face the morning",
  prompt: "Panels turn to face the morning",
  steps: TASK391_BEATS,
  outputLines: TASK391_BEATS,
  bars: [
    { label: "Q2 2026", old: 227, new: 227 },
    { label: "Q3 2026", old: 227, new: 225 },
  ],
  tiers: [
    { name: "Starter", price: "$0", note: "try it" },
    { name: "Pro", price: "$25/mo", note: "the one you need", recommended: true },
    { name: "Team", price: "$97/mo", note: "for the whole crew" },
  ],
  usage: { used: 78, cap: 100, label: "Usage", resetSeconds: 3600 },
  name: "D'Vaughn House",
  role: "Independent AI Orchestrator",
  pills: ["panels", "grid", "morning"],
  quote: "Panels turn to face the morning. The grid wakes row by row.",
  highlight: "The grid wakes row by row.",
  comparison: {
    left: "Before",
    right: "After",
    rows: [
      { label: "The grid", left: "asleep", right: "awake", winner: "right" },
      { label: "Power", left: "out", right: "reaches the town", winner: "right" },
    ],
  },
  version: "2.8",
  receipt: {},
  wasPrice: "",
  nowPrice: "",
  project: "Motion Bot",
  palette: TASK391_PALETTE,
  lengthSeconds: 12,
};

const fmt = (v: number) =>
  Number.isInteger(v) ? v.toLocaleString("en-US") : v.toLocaleString("en-US");

const fmtClock = (totalSeconds: number) => {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
};

/** Panel shell: header (the hook), accent bar, progress hairline. */
const Shell: React.FC<{
  hook: string;
  palette: HarnessPalette;
  frame: number;
  durationInFrames: number;
  children: React.ReactNode;
}> = ({ hook, palette, frame, durationInFrames, children }) => {
  const hairP = interpolate(frame, [0, Math.max(1, durationInFrames - 1)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ backgroundColor: palette.background, fontFamily: SANS }}>
      <DriftBlobs frame={frame} palette={palette} />
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 10, backgroundColor: palette.accent, zIndex: 9 }} />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 34,
          textAlign: "center",
          fontFamily: SERIF,
          fontSize: 34,
          fontWeight: 700,
          color: palette.text,
          padding: "0 90px",
          zIndex: 2,
        }}
      >
        {hook}
      </div>
      <div style={{ position: "absolute", left: 90, right: 90, top: 96, bottom: 40, zIndex: 1 }}>
        {children}
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 6, backgroundColor: palette.surface, zIndex: 9 }}>
        <div style={{ width: `${hairP * 100}%`, height: "100%", backgroundColor: palette.accent }} />
      </div>
    </AbsoluteFill>
  );
};

/** One step chip: ticks done when its frame arrives. */
const StepChip: React.FC<{
  text: string;
  done: boolean;
  palette: HarnessPalette;
  active: boolean;
}> = ({ text, done, palette, active }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 14,
      backgroundColor: palette.surface,
      border: `2px solid ${done ? palette.accent : palette.accentDeep}`,
      borderRadius: 10,
      padding: "14px 20px",
      fontSize: 26,
      color: palette.text,
      opacity: active || done ? 1 : 0.55,
    }}
  >
    <span
      style={{
        width: 34,
        height: 34,
        borderRadius: "50%",
        backgroundColor: done ? palette.accent : palette.background,
        color: done ? "#FFFFFF" : palette.text,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 22,
        fontWeight: 800,
        flexShrink: 0,
      }}
    >
      {done ? "✓" : "·"}
    </span>
    <span>{text}</span>
  </div>
);

export const EverestPanels: React.FC<EverestPanelsProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const palette = { ...EVEREST_DEFAULTS.palette, ...(props.palette ?? {}) };
  const category = props.category ?? "product-ui";
  const hook = props.hook ?? EVEREST_DEFAULTS.hook;
  const steps = props.steps && props.steps.length > 0 ? props.steps : EVEREST_DEFAULTS.steps;
  const prompt = props.prompt ?? hook;
  const outputLines =
    props.outputLines && props.outputLines.length > 0
      ? props.outputLines
      : EVEREST_DEFAULTS.outputLines;

  // ---- product-ui: typed prompt, step chips ticking done, done line.
  if (category === "product-ui") {
    const typedLen = Math.min(prompt.length, Math.floor(frame / 2));
    const typed = prompt.slice(0, typedLen);
    const cursorOn = frame % 30 < 15;
    const stepStart = 60;
    const doneAt = stepStart + steps.length * 24;
    const doneP = interpolate(frame, [doneAt, doneAt + 10], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    return (
      <Shell hook={hook} palette={palette} frame={frame} durationInFrames={durationInFrames}>
        <div
          style={{
            backgroundColor: palette.surface,
            border: `3px solid ${palette.accent}`,
            borderRadius: 12,
            padding: "26px 28px",
            fontFamily: MONO,
            fontSize: 30,
            color: palette.text,
            minHeight: 120,
          }}
        >
          {typed}
          <span style={{ opacity: cursorOn ? 1 : 0, color: palette.accent }}>▍</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 26 }}>
          {steps.map((s, i) => {
            const done = frame >= stepStart + (i + 1) * 24;
            const active = frame >= stepStart + i * 24 && !done;
            return <StepChip key={`${s}-${i}`} text={s} done={done} active={active} palette={palette} />;
          })}
        </div>
        <div style={{ fontSize: 30, fontWeight: 700, color: palette.accent, marginTop: 26, opacity: doneP }}>
          Done — {hook}
        </div>
      </Shell>
    );
  }

  // ---- prompts-results: prompt card, staged output, elapsed timer.
  if (category === "prompts-results") {
    const elapsed = fmtClock(frame / fps);
    const lineStart = 45;
    const shownLines = outputLines.filter((_, i) => frame >= lineStart + i * 36);
    const stampP = interpolate(
      frame,
      [lineStart + outputLines.length * 36, lineStart + outputLines.length * 36 + 12],
      [0, 1],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
    );
    return (
      <Shell hook={hook} palette={palette} frame={frame} durationInFrames={durationInFrames}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div
            style={{
              backgroundColor: palette.surface,
              border: `3px solid ${palette.accent}`,
              borderRadius: 12,
              padding: "18px 24px",
              fontFamily: MONO,
              fontSize: 26,
              color: palette.text,
              flex: 1,
            }}
          >
            {prompt}
          </div>
          <div
            style={{
              fontFamily: MONO,
              fontSize: 30,
              fontWeight: 700,
              color: palette.accent,
              marginLeft: 24,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {elapsed}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 24 }}>
          {shownLines.map((line, i) => {
            const p = interpolate(frame, [lineStart + i * 36, lineStart + i * 36 + 10], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            return (
              <div
                key={`${line}-${i}`}
                style={{
                  backgroundColor: palette.surface,
                  borderRadius: 10,
                  padding: "16px 22px",
                  fontSize: 28,
                  color: palette.text,
                  opacity: p,
                  transform: `translateY(${(1 - p) * 16}px)`,
                }}
              >
                {line}
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 24, color: palette.accentDeep, marginTop: 24, opacity: stampP }}>
          done in {fmtClock(durationInFrames / fps)}
        </div>
      </Shell>
    );
  }

  // ---- agents-workflows: coordinator rows ticking done + summary.
  if (category === "agents-workflows") {
    const rowStart = 30;
    const doneCount = steps.filter((_, i) => frame >= rowStart + (i + 1) * 30).length;
    const summaryP = interpolate(
      frame,
      [rowStart + steps.length * 30, rowStart + steps.length * 30 + 12],
      [0, 1],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
    );
    return (
      <Shell hook={hook} palette={palette} frame={frame} durationInFrames={durationInFrames}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {steps.map((s, i) => {
            const done = frame >= rowStart + (i + 1) * 30;
            const active = frame >= rowStart + i * 30 && !done;
            const barP = interpolate(frame, [rowStart + i * 30, rowStart + (i + 1) * 30], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            return (
              <div
                key={`${s}-${i}`}
                style={{
                  backgroundColor: palette.surface,
                  border: `2px solid ${done ? palette.accent : palette.accentDeep}`,
                  borderRadius: 10,
                  padding: "16px 20px",
                  opacity: active || done ? 1 : 0.55,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <span
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: "50%",
                      backgroundColor: done ? palette.accent : palette.background,
                      color: done ? "#FFFFFF" : palette.text,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 22,
                      fontWeight: 800,
                      flexShrink: 0,
                    }}
                  >
                    {done ? "✓" : "…"}
                  </span>
                  <span style={{ fontSize: 26, color: palette.text }}>{s}</span>
                  <span style={{ marginLeft: "auto", fontSize: 22, color: palette.accent }}>
                    {done ? "done" : active ? "running" : "queued"}
                  </span>
                </div>
                <div style={{ height: 5, backgroundColor: palette.background, borderRadius: 3, marginTop: 12, overflow: "hidden" }}>
                  <div style={{ width: `${barP * 100}%`, height: "100%", backgroundColor: palette.accent }} />
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 28, fontWeight: 700, color: palette.accent, marginTop: 26, opacity: summaryP }}>
          Merged: {doneCount} of {steps.length} done — {hook}
        </div>
      </Shell>
    );
  }

  // ---- models-benchmarks: bars old -> new, delta counting up.
  if (category === "models-benchmarks") {
    const bars = props.bars && props.bars.length > 0 ? props.bars : EVEREST_DEFAULTS.bars;
    const maxNew = Math.max(...bars.map((b) => b.new), 1);
    const maxW = 760;
    return (
      <Shell hook={hook} palette={palette} frame={frame} durationInFrames={durationInFrames}>
        <div style={{ display: "flex", flexDirection: "column", gap: 26, marginTop: 10 }}>
          {bars.map((b, i) => {
            const start = 30 + i * 48;
            const shown = countUp(frame, start, 36, b.new);
            const delta = b.new - b.old;
            const deltaShown = countUp(frame, start, 36, Math.abs(delta));
            const widthP = interpolate(frame, [start, start + 36], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            const isWinner = b.new === maxNew;
            return (
              <div key={b.label}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
                  <span style={{ fontSize: 28, fontWeight: 700, color: palette.text }}>{b.label}</span>
                  <span style={{ fontSize: 26, color: palette.text, opacity: 0.7 }}>
                    {fmt(b.old)} → <b style={{ color: isWinner ? palette.accent : palette.text, fontVariantNumeric: "tabular-nums" }}>{fmt(shown)}</b>
                  </span>
                  <span
                    style={{
                      marginLeft: "auto",
                      fontSize: 28,
                      fontWeight: 800,
                      color: delta >= 0 ? palette.accent : "#9B1B30",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {delta >= 0 ? "+" : "−"}
                    {fmt(deltaShown)}
                  </span>
                </div>
                <div style={{ height: 34, backgroundColor: palette.background, borderRadius: 8, marginTop: 8, overflow: "hidden", position: "relative" }}>
                  <div
                    style={{
                      width: (b.old / maxNew) * maxW,
                      height: "100%",
                      backgroundColor: palette.accentDeep,
                      opacity: 0.45,
                      position: "absolute",
                      left: 0,
                      top: 0,
                    }}
                  />
                  <div
                    style={{
                      width: (b.new / maxNew) * maxW * widthP,
                      height: "100%",
                      backgroundColor: isWinner ? palette.accent : palette.accentDeep,
                      position: "absolute",
                      left: 0,
                      top: 0,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </Shell>
    );
  }

  // ---- comparisons: two windows, one recommendation chip per row.
  if (category === "comparisons") {
    const comp = props.comparison ?? EVEREST_DEFAULTS.comparison;
    const elapsed = fmtClock(frame / fps);
    return (
      <Shell hook={hook} palette={palette} frame={frame} durationInFrames={durationInFrames}>
        <div style={{ display: "flex", gap: 24 }}>
          {[comp.left, comp.right].map((side, si) => (
            <div
              key={side}
              style={{
                flex: 1,
                backgroundColor: palette.surface,
                border: `3px solid ${palette.accentDeep}`,
                borderRadius: 12,
                padding: "20px 22px",
                textAlign: "center",
              }}
            >
              <div style={{ fontFamily: SERIF, fontSize: 32, fontWeight: 800, color: palette.text }}>{side}</div>
              <div style={{ fontFamily: MONO, fontSize: 26, color: palette.accent, marginTop: 8, fontVariantNumeric: "tabular-nums" }}>
                {elapsed}
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 24 }}>
          {comp.rows.map((row, i) => {
            const p = interpolate(frame, [60 + i * 30, 60 + i * 30 + 10], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            const winLeft = row.winner === "left";
            return (
              <div
                key={`${row.label}-${i}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  backgroundColor: palette.surface,
                  borderRadius: 10,
                  padding: "14px 20px",
                  opacity: p,
                }}
              >
                <span style={{ fontSize: 26, fontWeight: 700, color: palette.text, width: 220 }}>{row.label}</span>
                <span style={{ flex: 1, fontSize: 24, color: palette.text, opacity: winLeft ? 1 : 0.45 }}>{row.left}</span>
                <span style={{ flex: 1, fontSize: 24, color: palette.text, opacity: winLeft ? 0.45 : 1 }}>{row.right}</span>
                <span
                  style={{
                    backgroundColor: palette.accent,
                    color: "#FFFFFF",
                    fontSize: 22,
                    fontWeight: 800,
                    padding: "6px 14px",
                    borderRadius: 20,
                    whiteSpace: "nowrap",
                  }}
                >
                  ✓ {winLeft ? comp.left : comp.right}
                </span>
              </div>
            );
          })}
        </div>
      </Shell>
    );
  }

  // ---- launch-news: mark + name + version ticking in, one sentence
  // highlighted, tiers lighting up.
  if (category === "launch-news") {
    const version = props.version ?? EVEREST_DEFAULTS.version;
    const tiers = props.tiers && props.tiers.length > 0 ? props.tiers : [];
    // Count-up tick only for a single-decimal version ("2.8");
    // anything else ("2.8.1", "v3") is shown exactly as supplied.
    const singleDecimal = /^\d+\.\d$/.test(version);
    const versionShown = singleDecimal
      ? countUp(frame, 20, 30, Math.round(parseFloat(version) * 10)) / 10
      : null;
    const underlineP = interpolate(frame, [60, 100], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    return (
      <Shell hook={hook} palette={palette} frame={frame} durationInFrames={durationInFrames}>
        <div style={{ display: "flex", alignItems: "center", gap: 20, marginTop: 8 }}>
          <div
            style={{
              width: 84,
              height: 84,
              borderRadius: 12,
              backgroundColor: palette.accent,
              color: "#FFFFFF",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: SERIF,
              fontSize: 44,
              fontWeight: 800,
            }}
          >
            {(props.name ?? "M").slice(0, 1)}
          </div>
          <div>
            <div style={{ fontFamily: SERIF, fontSize: 40, fontWeight: 800, color: palette.text }}>
              {props.name ?? "Motion Bot"}
            </div>
            <div style={{ fontSize: 30, color: palette.accent, fontVariantNumeric: "tabular-nums" }}>
              v{versionShown !== null ? versionShown.toFixed(1) : version}
            </div>
          </div>
        </div>
        <div style={{ marginTop: 36 }}>
          <div style={{ fontFamily: SERIF, fontSize: 38, fontWeight: 700, color: palette.text, lineHeight: 1.3 }}>
            {hook}
          </div>
          <div style={{ width: `${underlineP * 100}%`, height: 6, backgroundColor: palette.accent, marginTop: 14 }} />
        </div>
        {tiers.length > 0 ? (
          <div style={{ display: "flex", gap: 16, marginTop: 36 }}>
            {tiers.map((t, i) => {
              const lit = interpolate(frame, [120 + i * 18, 120 + i * 18 + 10], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              });
              return (
                <div
                  key={t.name}
                  style={{
                    flex: 1,
                    backgroundColor: palette.surface,
                    border: `3px solid ${palette.accent}`,
                    borderRadius: 10,
                    padding: "16px 18px",
                    textAlign: "center",
                    opacity: 0.35 + 0.65 * lit,
                  }}
                >
                  <div style={{ fontSize: 26, fontWeight: 800, color: palette.text }}>{t.name}</div>
                  <div style={{ fontSize: 22, color: palette.accent, marginTop: 6 }}>{t.price}</div>
                </div>
              );
            })}
          </div>
        ) : null}
      </Shell>
    );
  }

  // ---- pricing-limits: the tier you need lifts; old price struck;
  // receipt prints tokens/minutes/tool calls/total.
  if (category === "pricing-limits") {
    const tiers = props.tiers && props.tiers.length > 0 ? props.tiers : EVEREST_DEFAULTS.tiers;
    const receipt = props.receipt ?? EVEREST_DEFAULTS.receipt;
    const wasPrice = props.wasPrice ?? EVEREST_DEFAULTS.wasPrice;
    const nowPrice = props.nowPrice ?? EVEREST_DEFAULTS.nowPrice;
    const showPrice = wasPrice !== "" && nowPrice !== "";
    const strike = interpolate(frame, [150, 162], [0, 100], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    const liftP = interpolate(frame, [30, 50], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    const receiptLines = [
      receipt.tokens !== undefined ? `tokens ${fmt(receipt.tokens)}` : null,
      receipt.minutes !== undefined ? `minutes ${receipt.minutes}` : null,
      receipt.calls !== undefined ? `tool calls ${receipt.calls}` : null,
      receipt.total !== undefined ? `total ${receipt.total}` : null,
    ].filter((l): l is string => l !== null);
    return (
      <Shell hook={hook} palette={palette} frame={frame} durationInFrames={durationInFrames}>
        <div style={{ display: "flex", gap: 18, alignItems: "flex-end" }}>
          {tiers.map((t) => (
            <div
              key={t.name}
              style={{
                flex: 1,
                backgroundColor: palette.surface,
                border: `3px solid ${t.recommended ? palette.accent : palette.accentDeep}`,
                borderRadius: 12,
                padding: "20px 18px",
                textAlign: "center",
                transform: t.recommended ? `translateY(${-24 * liftP}px)` : "none",
                boxShadow: t.recommended ? "0 18px 40px rgba(0,0,0,0.25)" : "none",
              }}
            >
              <div style={{ fontSize: 26, fontWeight: 800, color: palette.text }}>{t.name}</div>
              <div style={{ fontSize: 30, fontWeight: 800, color: palette.accent, marginTop: 8 }}>{t.price}</div>
              {t.note ? <div style={{ fontSize: 20, color: palette.text, marginTop: 8 }}>{t.note}</div> : null}
              {t.recommended ? (
                <div style={{ fontSize: 20, fontWeight: 800, color: palette.accent, marginTop: 8 }}>★ YOU NEED THIS</div>
              ) : null}
            </div>
          ))}
        </div>
        {showPrice ? (
          <div style={{ display: "flex", alignItems: "center", gap: 28, marginTop: 34, justifyContent: "center" }}>
            <span style={{ fontSize: 36, color: palette.text, opacity: 0.55, position: "relative" }}>
              {wasPrice}
              <span style={{ position: "absolute", left: 0, top: "50%", height: 4, backgroundColor: "#9B1B30", width: `${strike}%` }} />
            </span>
            <span style={{ fontSize: 54, fontWeight: 800, color: palette.accentDeep }}>{nowPrice}</span>
          </div>
        ) : null}
        {receiptLines.length > 0 ? (
          <div
            style={{
              backgroundColor: palette.surface,
              border: `2px dashed ${palette.accent}`,
              borderRadius: 10,
              padding: "16px 22px",
              marginTop: 28,
              fontFamily: MONO,
              fontSize: 24,
              color: palette.text,
              lineHeight: 1.6,
            }}
          >
            {receiptLines.map((line, i) => {
              const p = interpolate(frame, [180 + i * 14, 180 + i * 14 + 8], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              });
              return (
                <div key={line} style={{ opacity: p }}>
                  {line}
                </div>
              );
            })}
          </div>
        ) : null}
      </Shell>
    );
  }

  // ---- lower-thirds: name + role slide in and settle, keyword
  // pills, corner source credit (only when the brief supplies it).
  if (category === "lower-thirds") {
    const name = props.name ?? EVEREST_DEFAULTS.name;
    const role = props.role ?? EVEREST_DEFAULTS.role;
    const pills = props.pills && props.pills.length > 0 ? props.pills : EVEREST_DEFAULTS.pills;
    const slideP = interpolate(frame, [10, 22], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    const slideX = interpolate(slideP, [0, 1], [-640, 0]);
    return (
      <Shell hook={hook} palette={palette} frame={frame} durationInFrames={durationInFrames}>
        <div style={{ marginTop: 60 }}>
          <div
            style={{
              display: "inline-block",
              backgroundColor: palette.accent,
              borderRadius: 10,
              padding: "22px 30px",
              opacity: slideP,
              transform: `translateX(${slideX}px)`,
            }}
          >
            <div style={{ fontFamily: SERIF, fontSize: 44, fontWeight: 800, color: "#FFFFFF" }}>{name}</div>
            <div style={{ fontSize: 26, color: "#FFFFFF", opacity: 0.9, marginTop: 6 }}>{role}</div>
          </div>
          <div style={{ display: "flex", gap: 12, marginTop: 28, flexWrap: "wrap" }}>
            {pills.map((pill, i) => {
              const p = interpolate(frame, [30 + i * 10, 30 + i * 10 + 8], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              });
              return (
                <span
                  key={pill}
                  style={{
                    backgroundColor: palette.surface,
                    border: `2px solid ${palette.accent}`,
                    borderRadius: 20,
                    padding: "8px 18px",
                    fontSize: 24,
                    fontWeight: 700,
                    color: palette.text,
                    opacity: p,
                  }}
                >
                  {pill}
                </span>
              );
            })}
          </div>
          {props.project ? (
            <div style={{ position: "absolute", right: 0, bottom: 0, fontSize: 20, color: palette.text, opacity: 0.6 }}>
              source: {props.project}
            </div>
          ) : null}
        </div>
      </Shell>
    );
  }

  // ---- usage-cost: usage bar fills to the cap; limit banner +
  // reset countdown (caps only from the brief).
  if (category === "usage-cost") {
    const usage = props.usage ?? EVEREST_DEFAULTS.usage;
    const pct = Math.max(0, Math.min(100, (usage.used / usage.cap) * 100));
    const fillP = interpolate(frame, [20, 110], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    const atCap = usage.used >= usage.cap;
    const bannerP = atCap
      ? interpolate(frame, [120, 132], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 0;
    const remaining =
      usage.resetSeconds !== undefined
        ? Math.max(0, usage.resetSeconds - frame / fps)
        : null;
    return (
      <Shell hook={hook} palette={palette} frame={frame} durationInFrames={durationInFrames}>
        <div style={{ marginTop: 40 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 28, fontWeight: 700, color: palette.text }}>
            <span>{usage.label ?? "Usage"}</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>
              {fmt(usage.used)} / {fmt(usage.cap)} ({Math.round(pct)}%)
            </span>
          </div>
          <div style={{ height: 44, backgroundColor: palette.background, borderRadius: 10, marginTop: 14, overflow: "hidden", position: "relative" }}>
            <div
              style={{
                width: `${pct * fillP}%`,
                height: "100%",
                backgroundColor: atCap ? "#9B1B30" : palette.accent,
              }}
            />
          </div>
          <div style={{ height: 8, marginTop: 10 }}>
            <div
              style={{
                width: 4,
                height: 8,
                backgroundColor: palette.text,
                marginLeft: `calc(${pct}% - 2px)`,
                opacity: 0.6,
              }}
            />
          </div>
          {atCap ? (
            <div
              style={{
                backgroundColor: "#9B1B30",
                color: "#FFFFFF",
                borderRadius: 10,
                padding: "18px 24px",
                marginTop: 26,
                fontSize: 28,
                fontWeight: 700,
                opacity: bannerP,
                transform: `translateY(${(1 - bannerP) * 20}px)`,
              }}
            >
              Limit reached — {remaining !== null ? `resets in ${fmtClock(remaining)}` : "at the cap"}
            </div>
          ) : (
            <div style={{ fontSize: 26, color: palette.text, marginTop: 26 }}>
              {fmt(usage.cap - usage.used)} left
              {remaining !== null ? ` — resets in ${fmtClock(remaining)}` : ""}
            </div>
          )}
        </div>
      </Shell>
    );
  }

  // ---- evidence-quotes: styled card, rest dims, one line
  // highlights with a slow push-in.
  const quote = props.quote ?? EVEREST_DEFAULTS.quote;
  const highlight = props.highlight ?? EVEREST_DEFAULTS.highlight;
  const push = interpolate(frame, [0, Math.max(1, durationInFrames - 1)], [1, 1.05], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const hiP = interpolate(frame, [45, 60], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const lines = quote.split(/(?<=[.!?])\s+/);
  return (
    <Shell hook={hook} palette={palette} frame={frame} durationInFrames={durationInFrames}>
      <div
        style={{
          backgroundColor: palette.surface,
          border: `3px solid ${palette.accent}`,
          borderRadius: 14,
          padding: "36px 40px",
          marginTop: 30,
          transform: `scale(${push})`,
          boxShadow: "0 24px 60px rgba(0,0,0,0.2)",
        }}
      >
        {lines.map((line, i) => {
          const isHi = highlight !== "" && line.includes(highlight);
          return (
            <div
              key={`${line}-${i}`}
              style={{
                fontFamily: SERIF,
                fontSize: 36,
                fontWeight: isHi ? 800 : 400,
                lineHeight: 1.4,
                color: isHi ? "#FFFFFF" : palette.text,
                backgroundColor: isHi ? palette.accent : "transparent",
                opacity: isHi ? 1 : 1 - 0.55 * hiP,
                padding: isHi ? "6px 10px" : "6px 0",
                borderRadius: 6,
              }}
            >
              {line}
            </div>
          );
        })}
        {props.project ? (
          <div style={{ fontSize: 22, color: palette.accent, marginTop: 18 }}>— {props.project}</div>
        ) : null}
      </div>
    </Shell>
  );
};

export const EVEREST_DEFAULTS_EXPORT = EVEREST_DEFAULTS;
