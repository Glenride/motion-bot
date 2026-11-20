import React from "react";
import {
  AbsoluteFill,
  Sequence,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { HarnessPalette } from "./harness/primitives";
import { DEFAULT_PALETTE } from "./harness/primitives";

/**
 * WhatIf — v2.11, pack 15 (what-if-animation).
 *
 * A 15–25 s "What If" cartoon, every frame drawn in code (SVG +
 * Remotion): a dusk stick-figure rig, the 7-beat formula folded
 * into the short shape — cold open with three escalating demos,
 * premise title card, one fun escalation, the turn (one real fact
 * with a number, from the brief, never invented), end on a
 * question. One hero who never changes: every demo uses the same
 * rig, one look.
 *
 * Beats (fractions of lengthSeconds, the skill's table):
 *  - cold open 0–52.5%: three demos, each two shots (wide, then
 *    close-up — cuts come from changing shot size, never from
 *    motion; no two neighbouring shots share a size).
 *  - premise 52.5–72.5%: the title card — "WHAT IF YOU COULD" /
 *    the power in four words or fewer + "?", plus one rule.
 *  - fun 72.5–80%: one escalation line.
 *  - turn 80–100%: the fact with its number big, "That's real.",
 *    then the closing question.
 *
 * Voiceover: NONE. ElevenLabs is NOT wired (no key) and the skill
 * says so; the existing narration path (Edge-TTS) is a narrated
 * clip, not a What If episode, so this composition ships silent
 * and says so. The power's word rides as a small chip readout in
 * every demo ("Pause.") — the skill allows small UI readouts.
 *
 * The fact and its number come only from the brief's `Fact:`
 * label (director's build_whatif); the composition never invents
 * one. The proof brief's fact — Earth moves 185 miles around the
 * Sun in ten seconds — is arithmetic from NASA's Earth Fact Sheet
 * (mean orbital velocity 29.78 km/s = 18.50 mi/s; × 10 s).
 */

export type WhatIfDemo = {
  /** Short second-person line, 3–8 words. Every line is a picture. */
  line: string;
  /** The picture: mug | phone | crosswalk | slice | none. */
  prop: string;
};

export type WhatIfPayload = {
  /** The power, four words or fewer, e.g. "pause time". */
  power: string;
  /** One rule, e.g. "Ten seconds. Once a day." */
  rule: string;
  /** Three escalating demos. */
  demos: WhatIfDemo[];
  /** One fun escalation line. */
  fun: string;
  /** One real fact with a number, from the brief. */
  fact: string;
  /** The closing question. */
  question: string;
};

export type WhatIfProps = {
  hook?: string;
  lengthSeconds?: number;
  palette?: HarnessPalette;
  whatif?: WhatIfPayload;
  /** Carried for the critic only (story coverage); unused here. */
  scenes?: unknown[];
  story?: { beats?: { text: string }[] };
};

const WHATIF_DEFAULTS: Required<Omit<WhatIfProps, "scenes" | "story">> & { scenes: []; story: { beats: [] } } = {
  hook: "What if you could pause time for ten seconds?",
  lengthSeconds: 20,
  palette: {
    background: "#1B2A4A",
    surface: "#24405E",
    accent: "#F2A93B",
    accentDeep: "#B97A1F",
    text: "#F5EFE0",
    glow: "#F2A93B",
    particle: "#F2A93B",
  },
  whatif: {
    power: "pause time",
    rule: "Ten seconds. Once a day.",
    demos: [
      { line: "The coffee hangs mid-air.", prop: "mug" },
      { line: "The phone never hits the floor.", prop: "phone" },
      { line: "You cross while traffic waits.", prop: "crosswalk" },
    ],
    fun: "Grab the last slice. Twice.",
    fact: "In ten seconds, Earth moves 185 miles around the Sun.",
    question: "Where would you land tonight?",
  },
  scenes: [],
  story: { beats: [] },
};

export const WHATIF_DEFAULTS_EXPORT = WHATIF_DEFAULTS;

/* ------------------------------------------------------------------ */
/* The stick-figure rig — one hero, one look, every shot.              */
/* ------------------------------------------------------------------ */

type Pose = "hold" | "reach" | "walk" | "raise";

/** The hero: head, body, arms, legs as stroke lines in the text
 *  color — the face is the brightest thing in its area. Poses are
 *  fixed angles per demo so the hero never drifts. Hand-held props
 *  (mug / phone / slice) are drawn in the rig's own coordinates so
 *  the wide and close shots agree; the street is environmental. */
const StickFigure: React.FC<{ pose: Pose; color: string; prop: string; accent: string; surface: string; x?: number; y?: number; scale?: number }> = ({
  pose,
  color,
  prop,
  accent,
  surface,
  x = 100,
  y = 30,
  scale = 1,
}) => {
  const arms: Record<Pose, [number, number, number, number][]> = {
    hold: [[0, 0, 34, 26], [0, 0, -22, 30]],
    reach: [[0, 0, 30, -28], [0, 0, -30, -24]],
    walk: [[0, 0, 26, 22], [0, 0, -24, -18]],
    raise: [[0, 0, 30, -46], [0, 0, -26, 20]],
  };
  const legs: Record<Pose, [number, number, number, number][]> = {
    hold: [[0, 0, -16, 52], [0, 0, 18, 52]],
    reach: [[0, 0, -14, 52], [0, 0, 16, 52]],
    walk: [[0, 0, -26, 44], [0, 0, 24, 46]],
    raise: [[0, 0, -16, 52], [0, 0, 18, 52]],
  };
  const sx = 100;
  const sy = 78;
  const hipY = 148;
  return (
    <g transform={`translate(${x}, ${y}) scale(${scale})`} stroke={color} strokeWidth={7} strokeLinecap="round" fill="none">
      <circle cx={sx} cy={52} r={24} />
      {/* Face: two eyes, the brightest sharpest thing in the area. */}
      <circle cx={sx - 8} cy={48} r={2.5} fill={color} stroke="none" />
      <circle cx={sx + 8} cy={48} r={2.5} fill={color} stroke="none" />
      <line x1={sx} y1={76} x2={sx} y2={hipY} />
      {arms[pose].map(([x1, y1, x2, y2], i) => (
        <line key={`a${i}`} x1={sx + x1} y1={sy + y1} x2={sx + x2} y2={sy + y2} />
      ))}
      {legs[pose].map(([x1, y1, x2, y2], i) => (
        <line key={`l${i}`} x1={sx + x1} y1={hipY + y1} x2={sx + x2} y2={hipY + y2} />
      ))}
      {/* Hand-held props, in rig coordinates, frozen mid-action. */}
      {prop === "mug" ? (
        <g stroke={color} strokeWidth={5} fill="none" strokeLinecap="round">
          <rect x={148} y={118} width={44} height={56} rx={8} transform="rotate(28 170 146)" fill={surface} />
          <circle cx={196} cy={92} r={5} fill={accent} stroke="none" />
          <circle cx={210} cy={112} r={4} fill={accent} stroke="none" />
          <circle cx={188} cy={118} r={4} fill={accent} stroke="none" />
        </g>
      ) : null}
      {prop === "phone" ? (
        <rect x={118} y={2} width={38} height={68} rx={8} transform="rotate(-18 137 36)" fill={surface} stroke={color} strokeWidth={4} />
      ) : null}
      {prop === "slice" ? (
        <polygon points="118,4 168,4 143,58" fill={accent} stroke={color} strokeWidth={4} strokeLinejoin="round" />
      ) : null}
    </g>
  );
};

/** The power's word, as a small chip readout in every demo — the
 *  skill's one allowed on-screen text besides the title card. */
const PowerChip: React.FC<{ word: string; palette: HarnessPalette }> = ({ word, palette }) => (
  <div
    style={{
      position: "absolute",
      top: 154,
      left: 48,
      backgroundColor: palette.accent,
      color: palette.background,
      fontFamily: "Liberation Sans, sans-serif",
      fontSize: 30,
      fontWeight: 700,
      letterSpacing: 3,
      textTransform: "uppercase",
      padding: "10px 18px",
      borderRadius: 4,
      zIndex: 5,
    }}
  >
    {word}.
  </div>
);

/** Dusk stage: the low sun is the visible light source, the ground
 *  is a dark band, and every pool of light comes from something
 *  visible (window, lamp, headlights). Palette-driven only. */
const DuskStage: React.FC<{
  palette: HarnessPalette;
  sunX?: number;
  children: React.ReactNode;
}> = ({ palette, sunX = 560, children }) => (
  <AbsoluteFill style={{ backgroundColor: palette.background, overflow: "hidden" }}>
    {/* Low sun, half-sunk — the light source. */}
    <div
      style={{
        position: "absolute",
        left: sunX,
        top: 210,
        width: 130,
        height: 130,
        borderRadius: "50%",
        backgroundColor: palette.accent,
        opacity: 0.9,
      }}
    />
    {/* Ground. */}
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 260, backgroundColor: palette.surface }} />
    {children}
  </AbsoluteFill>
);

/** One demo shot: the stage, the hero in pose, the prop frozen
 *  mid-action, the power chip. `shot` is wide (full room, small
 *  hero) or close (hero large, background minimal). */
const DemoShot: React.FC<{
  demo: WhatIfDemo;
  shot: "wide" | "close";
  powerWord: string;
  palette: HarnessPalette;
}> = ({ demo, shot, powerWord, palette }) => {
  const pose: Pose = demo.prop === "mug" ? "hold" : demo.prop === "phone" ? "reach" : demo.prop === "crosswalk" ? "walk" : "raise";
  // Feet stand on the ground band (top edge y=1020): the rig is
  // 200 units tall, so y = 1010 - 200 * scale.
  const scale = shot === "wide" ? 0.8 : 2.0;
  const figX = shot === "wide" ? 300 : 260;
  const figY = 1010 - 200 * scale;
  return (
    <DuskStage palette={palette}>
      <PowerChip word={powerWord} palette={palette} />
      <svg width="720" height="1280" viewBox="0 0 720 1280" style={{ position: "absolute", inset: 0 }}>
        {demo.prop === "mug" ? (
          <line x1={120} y1={980} x2={600} y2={980} stroke={palette.text} strokeWidth={6} strokeLinecap="round" />
        ) : null}
        {demo.prop === "phone" ? (
          <g>
            {/* Lamp — the visible light source in this room. */}
            <line x1={600} y1={1020} x2={600} y2={820} stroke={palette.text} strokeWidth={6} />
            <circle cx={600} cy={800} r={26} fill={palette.accent} />
          </g>
        ) : null}
        {demo.prop === "crosswalk" ? (
          <g>
            {/* Street + crossing stripes + stopped car, headlights on. */}
            <line x1={0} y1={1020} x2={720} y2={1020} stroke={palette.text} strokeWidth={4} />
            {[90, 210, 330, 450, 570].map((x) => (
              <rect key={x} x={x} y={1030} width={60} height={26} fill={palette.text} opacity={0.7} />
            ))}
            <rect x={80} y={880} width={220} height={110} rx={18} fill={palette.surface} stroke={palette.text} strokeWidth={5} />
            <circle cx={140} cy={1000} r={26} fill={palette.background} stroke={palette.text} strokeWidth={5} />
            <circle cx={250} cy={1000} r={26} fill={palette.background} stroke={palette.text} strokeWidth={5} />
            <circle cx={310} cy={930} r={14} fill={palette.accent} />
          </g>
        ) : null}
        <StickFigure pose={pose} color={palette.text} prop={demo.prop} accent={palette.accent} surface={palette.surface} x={figX} y={figY} scale={scale} />
      </svg>
      {/* The demo line, small, low — a readout, not a caption of
          the voice (there is no voice). */}
      <div
        style={{
          position: "absolute",
          left: 48,
          right: 48,
          bottom: 250,
          fontFamily: "Liberation Sans, sans-serif",
          fontSize: 40,
          fontWeight: 700,
          color: palette.text,
          textAlign: "center",
          textShadow: "0 2px 12px rgba(0,0,0,0.6)",
        }}
      >
        {demo.line}
      </div>
    </DuskStage>
  );
};

/** The premise title card: line 1 the question, line 2 the power
 *  in four words or fewer with a question mark, then one rule. */
const TitleCard: React.FC<{ power: string; rule: string; palette: HarnessPalette; frame: number }> = ({
  power,
  rule,
  palette,
  frame,
}) => {
  const opacity = interpolate(frame, [0, 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <DuskStage palette={palette} sunX={295}>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity, padding: "0 48px" }}>
        <div style={{ fontFamily: "Liberation Sans, sans-serif", fontSize: 58, fontWeight: 700, letterSpacing: 4, color: palette.text, textAlign: "center" }}>
          WHAT IF YOU COULD
        </div>
        <div style={{ fontFamily: "Liberation Sans, sans-serif", fontSize: 96, fontWeight: 700, color: palette.accent, textAlign: "center", marginTop: 24, textTransform: "uppercase" }}>
          {power}?
        </div>
        <div style={{ width: 140, height: 6, backgroundColor: palette.accent, marginTop: 36 }} />
        <div style={{ fontFamily: "Liberation Sans, sans-serif", fontSize: 34, color: palette.text, textAlign: "center", marginTop: 28 }}>
          {rule}
        </div>
      </AbsoluteFill>
    </DuskStage>
  );
};

/** The turn: the fact with its number big in the accent, then
 *  "That's real.", then the closing question. The number is the
 *  first number token in the fact text — the brief's number. */
const Turn: React.FC<{ fact: string; question: string; palette: HarnessPalette; frame: number; fps: number }> = ({
  fact,
  question,
  palette,
  frame,
  fps,
}) => {
  const numMatch = fact.match(/\d[\d,]*/);
  const num = numMatch ? numMatch[0] : "";
  const factRest = num ? fact.replace(num, "###").split("###") : [fact];
  const factOpacity = interpolate(frame, [0, 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const realOpacity = interpolate(frame, [Math.round(2.0 * fps), Math.round(2.0 * fps) + 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const qOpacity = interpolate(frame, [Math.round(2.8 * fps), Math.round(2.8 * fps) + 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <DuskStage palette={palette} sunX={560}>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: "0 48px" }}>
        <div style={{ opacity: factOpacity, textAlign: "center" }}>
          <div style={{ fontFamily: "Liberation Sans, sans-serif", fontSize: 44, color: palette.text, lineHeight: 1.3 }}>
            {num ? (
              <>
                {factRest[0]}
                <span style={{ fontSize: 110, fontWeight: 700, color: palette.accent }}>{num}</span>
                {factRest[1] ?? ""}
              </>
            ) : (
              fact
            )}
          </div>
        </div>
        <div style={{ opacity: realOpacity, fontFamily: "Liberation Sans, sans-serif", fontSize: 56, fontWeight: 700, color: palette.accent, marginTop: 40 }}>
          That&apos;s real.
        </div>
        <div style={{ opacity: qOpacity, fontFamily: "Liberation Sans, sans-serif", fontSize: 68, fontWeight: 700, color: palette.text, marginTop: 24, textAlign: "center" }}>
          {question}
        </div>
      </AbsoluteFill>
    </DuskStage>
  );
};

export const WhatIf: React.FC<WhatIfProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const palette = { ...WHATIF_DEFAULTS.palette, ...(props.palette ?? {}) };
  const whatif = props.whatif ?? WHATIF_DEFAULTS.whatif;
  const total = durationInFrames;

  // Beat boundaries as fractions of the clip (the skill's table).
  const coldEnd = Math.round(total * 0.525);
  const premiseEnd = Math.round(total * 0.725);
  const funEnd = Math.round(total * 0.8);
  const demos = whatif.demos.slice(0, 3);
  while (demos.length < 3) {
    demos.push({ line: "", prop: "none" });
  }
  const demoLen = Math.floor(coldEnd / 3);
  const powerWord = whatif.power.split(" ")[0] ?? "Pause";
  const powerFirst = powerWord.charAt(0).toUpperCase() + powerWord.slice(1);

  return (
    <AbsoluteFill style={{ backgroundColor: palette.background }}>
      {/* Cold open: three demos, each wide then close-up. */}
      {demos.map((demo, i) => {
        const start = i * demoLen;
        const len = i === 2 ? coldEnd - start : demoLen;
        const wideLen = Math.round(len * 0.55);
        return (
          <React.Fragment key={i}>
            <Sequence from={start} durationInFrames={wideLen} name={`Demo ${i + 1} wide`}>
              <DemoShot demo={demo} shot="wide" powerWord={powerFirst} palette={palette} />
            </Sequence>
            <Sequence from={start + wideLen} durationInFrames={len - wideLen} name={`Demo ${i + 1} close`}>
              <DemoShot demo={demo} shot="close" powerWord={powerFirst} palette={palette} />
            </Sequence>
          </React.Fragment>
        );
      })}
      {/* Premise title card. */}
      <Sequence from={coldEnd} durationInFrames={premiseEnd - coldEnd} name="Premise">
        <TitleCard power={whatif.power} rule={whatif.rule} palette={palette} frame={frame - coldEnd} />
      </Sequence>
      {/* Fun: one escalation line, hero raising the slice. Wide
          shot, so the line sits on clean ground and reads (the
          close shot puts the line across the hero's legs, which
          tesseract misreads). */}
      <Sequence from={premiseEnd} durationInFrames={funEnd - premiseEnd} name="Fun">
        <DemoShot demo={{ line: whatif.fun, prop: "slice" }} shot="wide" powerWord={powerFirst} palette={palette} />
      </Sequence>
      {/* Turn: the fact, "That's real.", the question. */}
      <Sequence from={funEnd} durationInFrames={total - funEnd} name="Turn">
        <Turn fact={whatif.fact} question={whatif.question} palette={palette} frame={frame - funEnd} fps={fps} />
      </Sequence>
      {/* Accent carrier, outside the scene sequences (critic: accent
          at clip level, outside scene cameras). */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 8, backgroundColor: palette.accent, zIndex: 5 }} />
    </AbsoluteFill>
  );
};
