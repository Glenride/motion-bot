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
  Teardrops,
  ZoomCut,
  resolveFont,
  DEFAULT_PALETTE,
  SERIF,
  type HarnessPalette,
} from "./harness/primitives";
import { ColorMotionWash, LogoReveal, sceneStarts } from "./harness/motionDesign";
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
  /** Panel layout (v2.6, Vertical only for now): centered | split |
   *  card | lower-third | word-stack. Changes the composition of the
   *  scene's words, not the background. Defaults to centered. */
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
  /** Named motion (v2.11, motion-prompt registry): one `Move:`
   *  label value naming a registry move (e.g. pop-in, typewriter,
   *  dolly-in, mask-transition) applied to every scene, or a
   *  `Moves:` list naming one move per scene. Consumed by
   *  Vertical; Harness (landscape) does not yet read the registry
   *  — its kinetic reveals already cover the mask/blur/wipe/char
   *  names. Defaults to none — no label, no change. */
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
    kinetic: props.kinetic ?? "word",
    bpm: props.bpm ?? 0,
    name: (props.name ?? "").trim(),
    role: (props.role ?? "").trim(),
    pills: props.pills ?? [],
    source: (props.source ?? "").trim(),
    logo: (props.logo ?? "").trim(),
    fontFamily: resolveFont(props.font),
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
  kinetic: string;
  fontFamily: string;
  logo: string;
  hasName: boolean;
}> = ({ scene, sceneFrames, frame, fps, palette, motif, isMotifScene, isLastScene, project, subtitle, pacing, variant, kinetic, fontFamily, logo, hasName }) => {
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
  const line =
    kinetic !== "word" ? (
      <KineticReveal
        reveal={kinetic}
        words={scene.words}
        firstFrame={8}
        frame={frame}
        fps={fps}
        fontSize={fontSize}
        color={palette.text}
        gapFrames={variant === "kinetic" ? 4 : gapFrames}
        rise={variant === "rise"}
        fontFamily={fontFamily}
      />
    ) : (
      <KineticLine
        words={scene.words}
        firstFrame={8}
        frame={frame}
        fps={fps}
        fontSize={fontSize}
        color={palette.text}
        gapFrames={variant === "kinetic" ? 4 : gapFrames}
        rise={variant === "rise"}
        fontFamily={fontFamily}
      />
    );
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
  const camera =
    variant === "kinetic"
      ? { fromScale: 1, toScale: 1.04, fromX: 0, toX: 0 }
      : scene.camera;
  // End-card line fades in over the last 30% of the final scene.
  const endOpacity =
    logo || project || subtitle
      ? interpolate(frame, [sceneFrames * 0.7, sceneFrames * 0.85], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 0;
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
      {showMotif && motif.type === "mirror" ? (
        <MotifLayer frame={frame} palette={palette} motif={motif}>
          {line}
        </MotifLayer>
      ) : (
        <>
          {showMotif ? (
            <MotifLayer frame={frame} palette={palette} motif={motif} />
          ) : null}
          <AbsoluteFill
            style={{ display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            {line}
          </AbsoluteFill>
        </>
      )}
      {isLastScene && motif.tears && variant === "orbit" ? (
        <Teardrops frame={frame} palette={palette} />
      ) : null}
      {/* End card: suppressed when a name strap overlays the clip
          (the strap IS the identification). With a Logo: label the
          end card is the code-drawn mark + wordmark; otherwise the
          plain project / subtitle lines, as before. */}
      {isLastScene && !hasName && (logo || project || subtitle) ? (
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
  const { palette, mood, motif, scenes, project, subtitle, variant, kinetic, bpm, name, role, pills, source, logo, fontFamily } = resolveProps(props);

  // Scenes split the duration evenly (v2.10: or snap to the beat grid
  // when a BPM is set — sceneStarts keeps the even split when bpm
  // is 0, so no-BPM storyboards render exactly as before).
  const n = scenes.length;
  const { starts, lengths } = sceneStarts(durationInFrames, n, bpm > 0 ? bpm : undefined, fps);

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
            kinetic={kinetic}
            fontFamily={fontFamily}
            logo={logo}
            hasName={name.length > 0}
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
      {/* Transitions ride over each cut: wipe 18f, zoom-cut 14f. */}
      {scenes.slice(0, -1).map((scene, i) => {
        const cut = starts[i + 1];
        if (scene.transitionOut === "wipe") {
          return (
            <Sequence key={`t${i}`} from={cut - 4} durationInFrames={18} name="Wipe">
              <DiagonalWipe frame={frame - (cut - 4)} palette={palette} />
            </Sequence>
          );
        }
        return (
          <Sequence key={`t${i}`} from={cut - 2} durationInFrames={14} name="ZoomCut">
            <ZoomCut frame={frame - (cut - 2)} palette={palette} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
