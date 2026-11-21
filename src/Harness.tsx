import React from "react";
import {
  AbsoluteFill,
  Sequence,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  Camera,
  DiagonalWipe,
  KineticLine,
  KineticReveal,
  MovingBackground,
  ScaleLine,
  SlideLines,
  StackLine,
  Teardrops,
  ZoomCut,
  resolveFont,
  resolveKinetic,
  DEFAULT_PALETTE,
  SERIF,
  type HarnessPalette,
} from "./harness/primitives";
import { ColorMotionWash, LogoReveal, PERSONALITIES, personalityForTone, sceneStarts } from "./harness/motionDesign";
import {
  MoveEffect,
  MoveReveal,
  incomingTransitionDisc,
  incomingTransitionStyle,
  moveCamera,
  outgoingTransition,
  sceneMoveFor,
  transitionForMove,
  type MoveSpec,
} from "./harness/motionRegistry";
import { LowerThirdOverlay } from "./LowerThird";
import { MotifLayer, type HarnessMotif } from "./harness/motifs";

/**
 * Harness — the storyboard-driven composition.
 *
 * Props are a storyboard JSON from the Director
 * (watcher/harness_director.py): palette, mood, motif, scenes with
 * per-scene words + camera + transition-out, optional project /
 * subtitle (explicit `Project:` / `Subtitle:` labels only).
 *
 * Every scene: animated gradient + particles background, a camera move
 * (push in / pull back / drift), kinetic words springing in one at a
 * time, the scene's motif (mirror wraps its scene's words inside the
 * glass; others sit behind the line), and a real transition into the
 * next scene (diagonal wipe or zoom-cut — never a plain fade).
 * The final scene carries falling teardrops when the motif says so,
 * and an end-card line when a project / subtitle was labelled.
 *
 * Panel / font / motion (v2.13 — the v2.6 Vertical variety, ported to
 * the 1280x720 landscape canvas): props.panel picks the word layout
 * (centered | split | card | lower-third | word-stack), props.font
 * the typeface (serif | sans | mono, via resolveFont), props.motion
 * the word entry (kinetic | slide | scale | rise), props.kinetic a
 * pack-10 reveal (mask / blur / wipe / char / path), and props.move /
 * props.moves a motion-registry move per scene. Defaults (centered /
 * serif / kinetic / word, no move) render exactly the pre-v2.13 look.
 * Labels (Panel: / Font: / Motion: / Kinetic: / Move:) win; the
 * Director rotates panel / font / motion by task id when no label
 * is present.
 *
 * Any length 3-60s: scenes split the duration evenly (remainder to the
 * last scene). No "Motion Bot" / "Untitled Project" ever renders: the
 * Director only sets a project from an explicit label, and this
 * composition treats those two names as no project anyway.
 */

export type HarnessCamera = {
  fromScale: number;
  toScale: number;
  fromX: number;
  toX: number;
};

export type HarnessScene = {
  words: string[];
  camera: HarnessCamera;
  transitionOut: string;
};

export type HarnessProps = {
  version?: number;
  hook?: string;
  lengthSeconds?: number;
  palette?: HarnessPalette;
  mood?: { tone: string; pacing: string };
  motif?: HarnessMotif;
  scenes?: HarnessScene[];
  project?: string;
  subtitle?: string;
  notes?: string[];
  /** Motion variant (v2.4): orbit | kinetic | sweep | rise.
   *  Orbit is the original recipe. The others change the motion
   *  language itself (background + type treatment), not just the
   *  palette — so a run of clips no longer looks identical. */
  variant?: string;
  /** Panel layout (v2.6 in Vertical, v2.13 in Harness): centered |
   *  split | card | lower-third | word-stack. Changes the
   *  composition of the scene's words, not the background.
   *  Defaults to centered. */
  panel?: string;
  /** Typeface (v2.6): serif | sans | mono. Each stack resolves on the
   *  render host (see FONTS in harness/primitives). Defaults to
   *  serif. */
  font?: string;
  /** Word motion (v2.6): kinetic | slide | scale | rise. Kinetic is
   *  the word-by-word spring; slide moves whole lines; scale punches
   *  words in place; rise lifts words from below. Defaults to
   *  kinetic. */
  motion?: string;
  /** Kinetic reveal (v2.10, kinetic-typography-skills): word | char |
   *  mask | blur | wipe | path. `word` is the v2.6 KineticLine; the
   *  others are the pack's reveal primitives (KineticReveal). From
   *  an explicit `Kinetic:` label, else a `Motion:`/`Move:` value
   *  naming one. Defaults to word — no label, no change. */
  kinetic?: string;
  /** Beat grid (v2.10, motion-design-skills): BPM for beat-sync
   *  cuts. 0 / unset = the even scene split, exactly as before;
   *  a BPM snaps scene starts to the nearest beat. From a `BPM:`
   *  label (40-240). */
  bpm?: number;
  /** Lower-third overlay (v2.10, lower-thirds-skills): name + role
   *  (+ keyword pills, + corner source credit) from `Name:` /
   *  `Role:` / `Pills:` / `Source:` labels. When set, the strap
   *  overlays every scene and the project end card is suppressed
   *  (the strap IS the identification). */
  name?: string;
  role?: string;
  pills?: string[];
  source?: string;
  /** Logo reveal (v2.10, motion-design-skills): wordmark for the
   *  code-drawn LogoReveal end card, from a `Logo:` label. When
   *  set, the last scene's end card is the drawn mark + wordmark
   *  instead of plain project text. */
  logo?: string;
  /** Named motion (v2.11 in Vertical, v2.13 in Harness): one `Move:`
   *  label value naming a registry move (e.g. pop-in, typewriter,
   *  dolly-in, mask-transition) applied to every scene, or a
   *  `Moves:` list naming one move per scene. A registry reveal
   *  replaces the motion / kinetic entry for its scene; a registry
   *  camera move overrides the scene's camera; effect / cut moves
   *  wrap the scene body; transition moves drive the cut after the
   *  scene. Defaults to none — no label, no change. */
  move?: string;
  moves?: string[];
  /** TikTok format (v2.11, tiktok-video-skills): hook-first |
   *  fast-cut | duet, from a `TikTok:` label. Extends Vertical;
   *  unset means the v2.6 Vertical exactly as before. */
  tiktokFormat?: string;
};

export const HARNESS_DEFAULTS: Required<
  Omit<HarnessProps, "project" | "subtitle" | "notes" | "hook">
> & { project: string; subtitle: string; notes: string[]; hook: string } = {
  version: 1,
  hook: "Every mirror in your house shows you smiling, except when you turn your back — that's when it starts to cry.",
  lengthSeconds: 10,
  palette: DEFAULT_PALETTE,
  mood: { tone: "neutral", pacing: "medium" },
  motif: { type: "mirror", scene: 0, reflectionWord: "SMILING", tears: true },
  scenes: [
    {
      words: ["Every", "mirror", "in", "your", "house", "shows", "you", "smiling,"],
      camera: { fromScale: 1, toScale: 1.08, fromX: 0, toX: -26 },
      transitionOut: "wipe",
    },
    {
      words: ["except", "when", "you", "turn", "your", "back"],
      camera: { fromScale: 1.08, toScale: 1, fromX: -26, toX: 22 },
      transitionOut: "zoom-cut",
    },
    {
      words: ["that's", "when", "it", "starts", "to", "cry."],
      camera: { fromScale: 1, toScale: 1.14, fromX: 22, toX: 0 },
      transitionOut: "none",
    },
  ],
  project: "",
  subtitle: "",
  notes: [],
  variant: "orbit",
  panel: "centered",
  font: "serif",
  motion: "kinetic",
  kinetic: "word",
  bpm: 0,
  name: "",
  role: "",
  pills: [],
  source: "",
  logo: "",
  move: "",
  moves: [],
  tiktokFormat: "",
};

const VARIANTS = ["orbit", "kinetic", "sweep", "rise"] as const;

const resolveVariant = (v?: string) =>
  VARIANTS.includes((v ?? "") as (typeof VARIANTS)[number])
    ? (v as (typeof VARIANTS)[number])
    : "orbit";

/** Panel layouts (v2.13 — the v2.6 Vertical panels, adapted to the
 *  1280x720 landscape canvas). Unknown values fall back to
 *  centered, so a bad label renders the pre-v2.13 look. */
const PANELS = ["centered", "split", "card", "lower-third", "word-stack"] as const;

const resolvePanel = (p?: string) =>
  PANELS.includes((p ?? "") as (typeof PANELS)[number])
    ? (p as (typeof PANELS)[number])
    : "centered";

/** Word-entry motions (v2.13 — the v2.6 Vertical motions). */
const MOTIONS = ["kinetic", "slide", "scale", "rise"] as const;

const resolveMotion = (m?: string) =>
  MOTIONS.includes((m ?? "") as (typeof MOTIONS)[number])
    ? (m as (typeof MOTIONS)[number])
    : "kinetic";

/** Diagonal accent bands that sway (never jump) — the sweep variant's
 *  background. Sienna + gold on the light field; no particles. */
const DiagonalBands: React.FC<{ frame: number; palette: HarnessPalette }> = ({
  frame,
  palette,
}) => {
  const sway = Math.sin(frame * 0.02) * 42;
  const bands = [
    { top: "16%", color: palette.accent, opacity: 0.55 },
    { top: "46%", color: palette.accentDeep, opacity: 0.4 },
    { top: "76%", color: palette.accent, opacity: 0.3 },
  ];
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {bands.map((b, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: "-30%",
            top: b.top,
            width: "160%",
            height: 110,
            backgroundColor: b.color,
            opacity: b.opacity,
            transform: `translateX(${sway * (i % 2 === 0 ? 1 : -1)}px) rotate(-14deg)`,
          }}
        />
      ))}
    </AbsoluteFill>
  );
};

const resolveProps = (props: HarnessProps) => {
  const palette = { ...HARNESS_DEFAULTS.palette, ...(props.palette ?? {}) };
  const rawProject = (props.project ?? "").trim();
  const project =
    rawProject &&
    rawProject.toLowerCase() !== "untitled project" &&
    rawProject.toLowerCase() !== "motion bot"
      ? rawProject
      : "";
  return {
    lengthSeconds: props.lengthSeconds ?? HARNESS_DEFAULTS.lengthSeconds,
    palette,
    mood: props.mood ?? HARNESS_DEFAULTS.mood,
    motif: props.motif ?? HARNESS_DEFAULTS.motif,
    scenes:
      props.scenes && props.scenes.length > 0
        ? props.scenes
        : HARNESS_DEFAULTS.scenes,
    project,
    subtitle: props.subtitle ?? "",
    variant: resolveVariant(props.variant),
    panel: resolvePanel(props.panel),
    motion: resolveMotion(props.motion),
    kinetic: resolveKinetic(props.kinetic),
    easing: PERSONALITIES[personalityForTone(props.mood?.tone ?? "neutral")].easing,
    bpm: props.bpm ?? 0,
    name: (props.name ?? "").trim(),
    role: (props.role ?? "").trim(),
    pills: props.pills ?? [],
    source: (props.source ?? "").trim(),
    logo: (props.logo ?? "").trim(),
    fontFamily: resolveFont(props.font),
    move: props.move ?? "",
    moves: props.moves ?? [],
  };
};

/** Font size by word count — fewer words, bigger type. */
const fontSizeFor = (wordCount: number) =>
  wordCount <= 4 ? 88 : wordCount <= 6 ? 76 : wordCount <= 9 ? 64 : 52;

/** Kinetic stagger by pacing: slow reads land slower. */
const gapFor = (pacing: string) =>
  pacing === "slow" ? 9 : pacing === "fast" ? 5 : 7;

const Scene: React.FC<{
  scene: HarnessScene;
  sceneFrames: number;
  frame: number;
  fps: number;
  palette: HarnessPalette;
  motif: HarnessMotif;
  isMotifScene: boolean;
  isLastScene: boolean;
  project: string;
  subtitle: string;
  pacing: string;
  variant: string;
  panel: string;
  fontFamily: string;
  motion: string;
  kinetic: string;
  easing: string;
  logo: string;
  hasName: boolean;
  /** v2.13: the registry move for this scene (Move:/Moves: label). */
  sceneMove: MoveSpec | null;
  /** v2.13: the transitionOut of the previous scene (incoming cut). */
  prevTransition?: string;
  /** v2.13: this scene's cut, after the registry move overrides it. */
  effectiveTransitionOut: string;
}> = ({ scene, sceneFrames, frame, fps, palette, motif, isMotifScene, isLastScene, project, subtitle, pacing, variant, panel, fontFamily, motion, kinetic, easing, logo, hasName, sceneMove, prevTransition, effectiveTransitionOut }) => {
  const gapFrames = gapFor(pacing);
  // Variant type treatments: orbit = the original kinetic line;
  // kinetic = bigger, faster, type-only; rise = words rise from below.
  // v2.10: a Kinetic: reveal replaces the word-by-word line with the
  // pack-10 primitive (mask / blur / wipe / char / path); `word`
  // keeps exactly the v2.6 line.
  const fontSize =
    variant === "kinetic"
      ? fontSizeFor(scene.words.length) + 14
      : fontSizeFor(scene.words.length);
  // Rise stays on for the rise variant (pre-v2.6 behavior) and for
  // the rise motion; every other motion keeps its own entry.
  const rise = motion === "rise" || variant === "rise";
  const gap = variant === "kinetic" ? 4 : gapFrames;

  /** Render words with the clip's motion language. A registry
   *  reveal (v2.13) IS the entry for its scene — it replaces the
   *  v2.6 motion choice and the v2.10 kinetic reveal alike. A
   *  Kinetic: reveal (v2.10) IS the entry — it replaces the v2.6
   *  motion choice for that clip; `word` keeps the motion dispatch
   *  below exactly as before. Mirrors Vertical's renderWords. */
  const renderWords = (
    ws: string[],
    size: number,
    color: string,
    align: "center" | "left" = "center",
  ) => {
    if (sceneMove && sceneMove.kind === "reveal") {
      return (
        <MoveReveal
          move={sceneMove}
          words={ws}
          firstFrame={8}
          frame={frame}
          fps={fps}
          fontSize={size}
          color={color}
          gapFrames={gap}
          rise={rise}
          fontFamily={fontFamily}
          align={align}
        />
      );
    }
    if (kinetic !== "word") {
      return (
        <KineticReveal
          reveal={kinetic}
          words={ws}
          firstFrame={8}
          frame={frame}
          fps={fps}
          fontSize={size}
          color={color}
          gapFrames={gap}
          rise={rise}
          fontFamily={fontFamily}
          align={align}
          easing={easing}
        />
      );
    }
    if (motion === "slide") {
      return (
        <SlideLines
          words={ws}
          firstFrame={8}
          frame={frame}
          fontSize={size}
          color={color}
          fontFamily={fontFamily}
          align={align}
        />
      );
    }
    if (motion === "scale") {
      return (
        <ScaleLine
          words={ws}
          firstFrame={8}
          frame={frame}
          fontSize={size}
          color={color}
          gapFrames={gap}
          fontFamily={fontFamily}
          align={align}
        />
      );
    }
    return (
      <KineticLine
        words={ws}
        firstFrame={8}
        frame={frame}
        fps={fps}
        fontSize={size}
        color={color}
        gapFrames={gap}
        rise={rise}
        fontFamily={fontFamily}
        align={align}
      />
    );
  };

  // Panel layouts (v2.13 — the v2.6 Vertical panels, re-geometried
  // for the 1280x720 landscape canvas; same words, same palette).
  // centered is the pre-v2.13 layout, unchanged.
  const words = scene.words;
  const half = Math.max(1, Math.ceil(words.length / 2));
  const head = words.slice(0, half);
  const tail = words.slice(half);
  let body: React.ReactNode;
  if (panel === "split") {
    // Hook words huge in the accent at the top-left, an accent
    // rule, then the supporting line at the bottom-left.
    const hook = words.slice(0, 2);
    const rest = words.slice(2);
    body = (
      <AbsoluteFill
        style={{
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "90px 90px 110px 90px",
        }}
      >
        <div>{renderWords(hook, fontSize + 26, palette.accent, "left")}</div>
        <div style={{ width: 140, height: 6, backgroundColor: palette.accent }} />
        {rest.length > 0 ? (
          <div>{renderWords(rest, Math.max(34, fontSize - 10), palette.text, "left")}</div>
        ) : null}
      </AbsoluteFill>
    );
  } else if (panel === "card") {
    // Words inside a bordered card on the brief's surface, offset
    // up-left from center, with the first word as a small-caps
    // kicker in the accent.
    const kicker = words[0];
    const rest = words.slice(1);
    body = (
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          padding: "90px 90px 110px 90px",
        }}
      >
        <div
          style={{
            backgroundColor: palette.surface,
            border: `3px solid ${palette.accent}`,
            borderRadius: 6,
            padding: "36px 32px",
            maxWidth: 780,
            transform: "translate(-28px, -48px)",
          }}
        >
          {rest.length > 0 ? (
            <>
              <div
                style={{
                  fontFamily,
                  fontSize: 24,
                  letterSpacing: 5,
                  color: palette.accent,
                  textTransform: "uppercase",
                  marginBottom: 18,
                }}
              >
                {kicker}
              </div>
              {renderWords(rest, Math.max(36, fontSize - 8), palette.text)}
            </>
          ) : (
            renderWords(words, fontSize, palette.text)
          )}
        </div>
      </AbsoluteFill>
    );
  } else if (panel === "lower-third") {
    // Headline + subhead anchored low-left, with an accent bar
    // above the headline. The top ~60% of the frame is deliberate
    // negative space — the opposite of the centered panel.
    body = (
      <AbsoluteFill
        style={{
          justifyContent: "flex-end",
          alignItems: "flex-start",
          padding: "0 90px 96px 90px",
        }}
      >
        <div
          style={{
            width: 120,
            height: 8,
            backgroundColor: palette.accent,
            marginBottom: 20,
          }}
        />
        {renderWords(head, fontSize + 8, palette.text, "left")}
        {tail.length > 0 ? (
          <div style={{ marginTop: 14 }}>
            {renderWords(tail, 34, palette.text, "left")}
          </div>
        ) : null}
      </AbsoluteFill>
    );
  } else if (panel === "word-stack") {
    // One word per line, huge, staggered rise. The stack's motion
    // is inherent: it always uses StackLine, whatever the motion
    // prop says — the layout and the entry are the same move here.
    const stackSize =
      words.length <= 4 ? 96 : words.length <= 6 ? 80 : 64;
    body = (
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "flex-start",
          padding: "0 90px 0 120px",
        }}
      >
        <StackLine
          words={words}
          firstFrame={8}
          frame={frame}
          fps={fps}
          fontSize={stackSize}
          color={palette.text}
          fontFamily={fontFamily}
        />
      </AbsoluteFill>
    );
  } else {
    // centered — the pre-v2.13 layout, unchanged.
    body = (
      <AbsoluteFill
        style={{ display: "flex", alignItems: "center", justifyContent: "center" }}
      >
        {renderWords(words, fontSize, palette.text)}
      </AbsoluteFill>
    );
  }

  // Variant backgrounds: orbit = gradient + particles (+ motif);
  // kinetic = flat field, type is the motion; sweep = swaying bands;
  // rise = clean gradient, no particles, so the rising type reads.
  const background =
    variant === "sweep" ? (
      <DiagonalBands frame={frame} palette={palette} />
    ) : variant === "kinetic" ? (
      <AbsoluteFill style={{ backgroundColor: palette.surface }} />
    ) : (
      <MovingBackground
        frame={frame}
        palette={palette}
        particleCount={variant === "rise" ? 0 : undefined}
      />
    );
  const showMotif = variant === "orbit" && isMotifScene;
  // v2.13: a registry camera move overrides the scene's camera plan.
  const camera =
    sceneMove && sceneMove.kind === "camera"
      ? moveCamera(sceneMove, scene.camera)
      : variant === "kinetic"
        ? { fromScale: 1, toScale: 1.04, fromX: 0, toX: 0 }
        : scene.camera;
  // v2.13: registry transition geometry is in-scene work on the two
  // scenes either side of the cut (see motionRegistry). The shared
  // helpers are portrait-tuned for whip-pan (720px sweep), so the
  // landscape frame uses its own 1280px sweep for that one move;
  // mask / match-cut / cross-dissolve are width-independent and use
  // the shared helpers unchanged. Wipe / zoom-cut return empty
  // geometry here — they ride as clip-level overlays, as before.
  const inStyle: React.CSSProperties =
    prevTransition === "whip-pan"
      ? {
          transform: `translateX(${interpolate(frame, [0, 9], [1280, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}px)`,
          filter: `blur(${interpolate(frame, [0, 9], [8, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}px)`,
        }
      : incomingTransitionStyle(prevTransition, frame, fps);
  const inDisc = incomingTransitionDisc(prevTransition, frame, palette);
  const out =
    effectiveTransitionOut === "whip-pan"
      ? {
          style: {
            transform: `translateX(${interpolate(frame, [Math.max(0, sceneFrames - 9), sceneFrames], [0, -1280], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}px)`,
            filter: `blur(${interpolate(frame, [Math.max(0, sceneFrames - 9), sceneFrames], [0, 8], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}px)`,
          } as React.CSSProperties,
          disc: null as React.ReactNode,
        }
      : outgoingTransition(effectiveTransitionOut, frame, sceneFrames, fps, palette);
  const outWindow =
    effectiveTransitionOut === "cross-dissolve" ? fps : effectiveTransitionOut === "whip-pan" ? 9 : 6;
  const outActive =
    (effectiveTransitionOut === "cross-dissolve" ||
      effectiveTransitionOut === "whip-pan" ||
      effectiveTransitionOut === "match-cut") &&
    frame >= Math.max(0, sceneFrames - outWindow);
  const wrapStyle: React.CSSProperties = { ...inStyle };
  if (outActive) {
    if (out.style.opacity !== undefined && wrapStyle.opacity !== undefined) {
      wrapStyle.opacity = (wrapStyle.opacity as number) * (out.style.opacity as number);
    } else if (out.style.opacity !== undefined) {
      wrapStyle.opacity = out.style.opacity;
    }
    if (out.style.transform) {
      wrapStyle.transform = out.style.transform;
    }
    if (out.style.filter) {
      wrapStyle.filter = out.style.filter;
    }
  }
  let content: React.ReactNode = body;
  if (sceneMove && (sceneMove.kind === "effect" || sceneMove.kind === "cut")) {
    content = (
      <MoveEffect move={sceneMove} frame={frame} fps={fps} sceneFrames={sceneFrames} palette={palette}>
        {body}
      </MoveEffect>
    );
  }
  // The mirror motif wraps the words inside the glass — only for
  // the centered panel, where the line is the body. Other panels
  // lay out across the frame, so the glass sits behind them like
  // every other motif instead of clipping the layout.
  const mirrorWrap = showMotif && motif.type === "mirror" && panel === "centered";
  // End-card line fades in over the last 30% of the final scene.
  // Only on panels with room below the words (centered, card) —
  // split / lower-third / word-stack leave it off rather than
  // colliding with the layout.
  const endOpacity =
    logo || project || subtitle
      ? interpolate(frame, [sceneFrames * 0.7, sceneFrames * 0.85], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 0;
  const showEndCard = isLastScene && !hasName && (logo || project || subtitle) && (panel === "centered" || panel === "card");
  return (
    <Camera
      localFrame={frame}
      sceneFrames={sceneFrames}
      fromScale={camera.fromScale}
      toScale={camera.toScale}
      fromX={camera.fromX}
      toX={camera.toX}
    >
      {background}
      <div style={{ position: "relative", width: "100%", height: "100%", ...wrapStyle }}>
        {mirrorWrap ? (
          <MotifLayer frame={frame} palette={palette} motif={motif}>
            {content}
          </MotifLayer>
        ) : (
          <>
            {showMotif ? (
              <MotifLayer frame={frame} palette={palette} motif={motif} />
            ) : null}
            {content}
          </>
        )}
        {inDisc}
        {outActive ? out.disc : null}
      </div>
      {isLastScene && motif.tears && variant === "orbit" ? (
        <Teardrops frame={frame} palette={palette} />
      ) : null}
      {/* End card: suppressed when a name strap overlays the clip
          (the strap IS the identification). With a Logo: label the
          end card is the code-drawn mark + wordmark; otherwise the
          plain project / subtitle lines, as before. */}
      {showEndCard ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 56,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
            opacity: endOpacity,
            fontFamily: SERIF,
            textAlign: "center",
            padding: "0 60px",
          }}
        >
          {logo ? (
            <LogoReveal wordmark={logo} palette={palette} frame={frame} fps={fps} fontFamily={fontFamily} size={360} />
          ) : (
            project ? (
              <div style={{ fontSize: 44, fontWeight: 700, color: palette.accent }}>
                {project}
              </div>
            ) : null
          )}
          {subtitle ? (
            <div style={{ fontSize: 30, color: palette.text }}>{subtitle}</div>
          ) : null}
        </div>
      ) : null}
    </Camera>
  );
};

export const Harness: React.FC<HarnessProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const { palette, mood, motif, scenes, project, subtitle, variant, panel, motion, kinetic, easing, bpm, name, role, pills, source, logo, fontFamily, move, moves } = resolveProps(props);

  // Scenes split the duration evenly (v2.10: or snap to the beat grid
  // when a BPM is set — sceneStarts keeps the even split when bpm
  // is 0, so no-BPM storyboards render exactly as before).
  const n = scenes.length;
  const { starts, lengths } = sceneStarts(durationInFrames, n, bpm > 0 ? bpm : undefined, fps);
  // v2.13: the registry move per scene (Move: / Moves: labels). A
  // transition-kind move overrides the scene's transitionOut for
  // the cut after it. No label means no move prop at all, so a
  // clip with no Move: / Moves: label renders exactly as before.
  const sceneMoves = scenes.map((_, i) => sceneMoveFor(moves ?? [], move, i));
  const effectiveTransitions = scenes.map(
    (scene, i) => transitionForMove(sceneMoves[i]) ?? scene.transitionOut,
  );

  return (
    <AbsoluteFill style={{ backgroundColor: palette.background }}>
      {scenes.map((scene, i) => (
        <Sequence
          key={i}
          from={starts[i]}
          durationInFrames={lengths[i]}
          name={`Scene ${i + 1}`}
        >
          <Scene
            scene={scene}
            sceneFrames={lengths[i]}
            frame={frame - starts[i]}
            fps={fps}
            palette={palette}
            motif={motif}
            isMotifScene={motif.scene === i}
            isLastScene={i === n - 1}
            project={project}
            subtitle={subtitle}
            pacing={mood.pacing}
            variant={variant}
            panel={panel}
            fontFamily={fontFamily}
            motion={motion}
            kinetic={kinetic}
            easing={easing}
            logo={logo}
            hasName={name.length > 0}
            sceneMove={sceneMoves[i]}
            prevTransition={i > 0 ? effectiveTransitions[i - 1] : undefined}
            effectiveTransitionOut={effectiveTransitions[i]}
          />
        </Sequence>
      ))}
      {/* Color-motion wash (v2.10): the OKLab grade drifting accent
          -> surface -> accentDeep across the clip, over the scenes. */}
      <ColorMotionWash frame={frame} durationInFrames={durationInFrames} palette={palette} />
      {/* Lower-third overlay (v2.10): a Name: label straps the clip. */}
      {name ? (
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
      ) : null}
      {/* Kinetic variant's gold rule, at clip level OUTSIDE the scene
          cameras: inside a scene the camera push scales it off the
          top edge within frames, so it must live here to stay
          visible (and keep accent present) for the whole clip. */}
      {variant === "kinetic" ? (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 8,
            backgroundColor: palette.accent,
            zIndex: 5,
          }}
        />
      ) : null}
      {/* Transitions ride over each cut: wipe 18f, zoom-cut 14f.
          Registry transitions (mask / match-cut / whip-pan /
          cross-dissolve) are in-scene geometry, and "none" means
          no overlay — the old code rendered a ZoomCut for any
          non-wipe value, including "none". */}
      {scenes.slice(0, -1).map((scene, i) => {
        const cut = starts[i + 1];
        const t = effectiveTransitions[i];
        if (t === "wipe") {
          return (
            <Sequence key={`t${i}`} from={cut - 4} durationInFrames={18} name="Wipe">
              <DiagonalWipe frame={frame - (cut - 4)} palette={palette} />
            </Sequence>
          );
        }
        if (t === "zoom-cut") {
          return (
            <Sequence key={`t${i}`} from={cut - 2} durationInFrames={14} name="ZoomCut">
              <ZoomCut frame={frame - (cut - 2)} palette={palette} />
            </Sequence>
          );
        }
        return null;
      })}
    </AbsoluteFill>
  );
};
