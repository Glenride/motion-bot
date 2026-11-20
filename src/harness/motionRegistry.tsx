import React from "react";
import { interpolate, spring, useVideoConfig } from "remotion";
import {
  KineticLine,
  KineticReveal,
  MaskRevealLine,
  type HarnessPalette,
} from "./primitives";
import { applyEasing } from "./motionDesign";

/**
 * Motion Prompt registry — v2.11, pack 13 (motion-prompt).
 *
 * The upstream catalog is a NAMING dictionary of 192 moves in 8
 * packs, not a renderer. This module is the translation: a registry
 * mapping move names to real Remotion primitives with their spec
 * duration / strength, wired so the director can request a move by
 * name with a `Move:` / `Moves:` label. A move is SHIPPED only when
 * it is in MOVE_REGISTRY below and changes a render; everything
 * else is listed in NOT_IMPLEMENTED_MOVES.
 *
 * A move has one kind, and Vertical dispatches on it:
 *  - reveal: how the scene's words enter (replaces the v2.6 motion
 *    / v2.10 kinetic choice for that scene).
 *  - camera: the scene's camera params (pan / dolly / zoom).
 *  - effect: a frame-level wrapper around the scene body.
 *  - cut: a mid-scene jump (jump cut) inside the scene body.
 *  - transition: the cut AFTER the scene (transitionOut). Mask,
 *    match-cut, whip-pan, and cross-dissolve are implemented as
 *    in-scene work (clip-path / opacity / sweep on the two scenes
 *    either side of the cut), not overlays — a true dissolve needs
 *    both scenes' pixels, which an overlay never has.
 *
 * Attribution (the skill's rule): every ported move carries its
 * catalog number below. // Motion Prompt #ID · MIT License
 * https://github.com/showheyohtaki/motion-prompt
 */

export type MoveKind = "reveal" | "camera" | "effect" | "cut" | "transition";

export type MoveSpec = {
  /** Motion Prompt catalog number, e.g. "#001". */
  id: string;
  /** Kebab name, e.g. "pop-in" — the `Move:` label value. */
  name: string;
  kind: MoveKind;
  /** Spec duration in milliseconds. */
  durationMs: number;
  /** Spec strength, e.g. "10% overshoot", when the spec gives one. */
  strength?: string;
  note: string;
};

// Motion Prompt #001 · MIT License — pop-in, 0.4 s, slight overshoot.
export const MOVE_REGISTRY: Record<string, MoveSpec> = {
  // Reveals.
  "pop-in": { id: "#001", name: "pop-in", kind: "reveal", durationMs: 400, strength: "slight overshoot", note: "Pops into view with a small bounce." },
  stagger: { id: "#002", name: "stagger", kind: "reveal", durationMs: 80, strength: "0.08 s apart", note: "Items appear one after another, left to right." },
  "mask-reveal": { id: "#005", name: "mask-reveal", kind: "reveal", durationMs: 600, note: "Text rises into view from behind an invisible edge." },
  typewriter: { id: "#006", name: "typewriter", kind: "reveal", durationMs: 50, strength: "0.05 s per character", note: "Text appears one character at a time, cursor at the end." },
  "count-up": { id: "#007", name: "count-up", kind: "reveal", durationMs: 1500, note: "A number runs up quickly to its final value, slowing at the end." },
  "kinetic-type": { id: "#008", name: "kinetic-type", kind: "reveal", durationMs: 0, note: "Words move, scale and turn in time with what is said." },
  // Effects.
  "shape-morph": { id: "#012", name: "shape-morph", kind: "effect", durationMs: 800, note: "One shape turns smoothly into another, changing color on the way." },
  "light-sweep": { id: "#022", name: "light-sweep", kind: "effect", durationMs: 900, note: "A band of light crosses a surface, subtle, once." },
  "impact-shake": { id: "#024", name: "impact-shake", kind: "effect", durationMs: 400, note: "The whole frame shakes when something lands; settles within 0.4 s." },
  "rack-focus": { id: "#033", name: "rack-focus", kind: "effect", durationMs: 1000, note: "Shift focus between near and far." },
  // Camera.
  pan: { id: "#025", name: "pan", kind: "camera", durationMs: 5000, note: "Pivot the camera left or right, camera fixed in place." },
  "dolly-in": { id: "#027", name: "dolly-in", kind: "camera", durationMs: 0, note: "Move the camera toward the subject; do not zoom." },
  "zoom-in": { id: "#028", name: "zoom-in", kind: "camera", durationMs: 3000, note: "Magnify with the lens; the camera stays put." },
  // Transitions (the cut AFTER the scene carrying the move).
  "mask-transition": { id: "#017", name: "mask-transition", kind: "transition", durationMs: 700, note: "The next scene appears inside a growing circle, 0.7 s." },
  "jump-cut": { id: "#041", name: "jump-cut", kind: "cut", durationMs: 0, note: "Same framing, skip ahead in time." },
  "match-cut": { id: "#042", name: "match-cut", kind: "transition", durationMs: 0, note: "Cut on a matching shape in the same position." },
  "whip-pan": { id: "#043", name: "whip-pan", kind: "transition", durationMs: 300, note: "Fast pan blur into the next shot." },
  "cross-dissolve": { id: "#044", name: "cross-dissolve", kind: "transition", durationMs: 1000, note: "Blend one shot into the next, 1 second." },
};

export const MOVE_NAMES = Object.keys(MOVE_REGISTRY);

/** Spoken / spaced spellings the director may send; all resolve to
 *  one registry name. The registry name itself always works. */
const MOVE_ALIASES: Record<string, string> = {
  "mask reveal": "mask-reveal",
  mask: "mask-reveal",
  "count up": "count-up",
  "shape morph": "shape-morph",
  "light sweep": "light-sweep",
  "impact shake": "impact-shake",
  "rack focus": "rack-focus",
  "dolly in": "dolly-in",
  "slow dolly in": "dolly-in",
  "zoom in": "zoom-in",
  "mask transition": "mask-transition",
  "jump cut": "jump-cut",
  "match cut": "match-cut",
  "whip pan": "whip-pan",
  "cross dissolve": "cross-dissolve",
  "kinetic typography": "kinetic-type",
  "kinetic": "kinetic-type",
};

/** Normalize a label value to a registry name, or null. */
export const resolveMove = (name?: string): MoveSpec | null => {
  if (!name) {
    return null;
  }
  const key = name.trim().toLowerCase().replace(/\s+/g, " ");
  if (MOVE_REGISTRY[key]) {
    return MOVE_REGISTRY[key];
  }
  const aliased = MOVE_ALIASES[key];
  if (aliased && MOVE_REGISTRY[aliased]) {
    return MOVE_REGISTRY[aliased];
  }
  return null;
};

/** Per-scene move: the `Moves:` list wins per index, else the
 *  clip-level `Move:` applies to every scene. */
export const sceneMoveFor = (
  moves: (string | undefined)[],
  move: string | undefined,
  index: number,
): MoveSpec | null =>
  resolveMove(moves?.[index]) ?? resolveMove(move);

/** The 174 catalog names NOT yet implemented (192 − 18 shipped).
 *  The SKILL.md-named ones are listed individually; the rest are
 *  catalog IDs never named in the skill file. The photo pack
 *  (#097–#120) is looks, not code — lighting / lens / tone words
 *  for a look description, never a primitive. */
export const NOT_IMPLEMENTED_MOVES: { id: string; name: string; reason: string }[] = [
  { id: "#004", name: "line draw", reason: "needs a path-draw primitive per chart line; not built" },
  { id: "#010", name: "overshoot", reason: "overshoot easing exists (motionDesign overshoot); no standalone gauge-needle move built" },
  { id: "#016", name: "parallax", reason: "parallax layers exist (ParallaxChip, motionDesign PARALLAX); no named multi-layer scene move built" },
  { id: "#018", name: "shape transition", reason: "four diagonal bands sweep; DiagonalWipe is one band — the four-band variant is not built" },
  { id: "#020", name: "zoom through", reason: "accelerating zoom into an object and through it; needs a through-object scale pass, not built" },
  { id: "#030", name: "orbit (arc shot)", reason: "circle around the subject; needs a 3D orbit rig, not built" },
  { id: "#037", name: "slow motion", reason: "retiming real action; code-drawn type has no action to slow" },
  { id: "#038", name: "speed ramp", reason: "mid-shot speed change; same retiming limit as slow motion" },
  { id: "#040", name: "freeze frame", reason: "pausing real action; code-drawn type has no action to freeze" },
  { id: "#046", name: "smash cut", reason: "abrupt cut to a contrasting scene; a cut needs a second scene's content, not a move" },
  { id: "#177", name: "low angle", reason: "camera angle; code-drawn scenes have no camera height" },
  { id: "#178", name: "high angle", reason: "camera angle; same limit as low angle" },
  { id: "#180", name: "over-the-shoulder", reason: "framing with two people; no cast in code-drawn scenes" },
  { id: "#183", name: "establishing shot", reason: "a wide opening shot of a place; needs a place to show" },
  { id: "#184", name: "extreme close-up", reason: "fill the frame with one detail; needs a detail subject" },
  { id: "#185", name: "insert shot", reason: "cut in to a detail, then back; needs a detail subject" },
  { id: "#187", name: "fade to black", reason: "1 s fade to black then in; not built — the dip is trivial but unproven, so it stays unshipped" },
  { id: "#192", name: "montage", reason: "a run of short shots condensing time; a sequence, not one move" },
  { id: "#049", name: "modal dialog", reason: "UI pack: a product-UI scene needs the brief's own screen" },
  { id: "#056", name: "toast notification", reason: "UI pack: same limit as modal dialog" },
  { id: "#058", name: "carousel", reason: "UI pack: same limit as modal dialog" },
  { id: "#060", name: "segmented control", reason: "UI pack: same limit as modal dialog" },
  { id: "#061", name: "filter chips", reason: "UI pack: same limit as modal dialog" },
  { id: "#069", name: "skeleton screen", reason: "UI pack: same limit as modal dialog" },
  { id: "#070", name: "spinner", reason: "UI pack: same limit as modal dialog" },
  { id: "#071", name: "badge", reason: "UI pack: same limit as modal dialog" },
  { id: "#097–#120", name: "photo pack (24 looks)", reason: "lighting / lens / tone looks — words for a look description, never code" },
  { id: "other", name: "remaining catalog IDs", reason: "149 further IDs across the 8 packs are never named in the skill file; unimplemented" },
];

/* ------------------------------------------------------------------ */
/* Reveal primitives                                                   */
/* ------------------------------------------------------------------ */

/** Motion Prompt #001 · MIT License — pop-in: words pop in with a
 *  small bounce, 0.4 s each, staggered. Spring overshoot is the
 *  bounce (damping 12, mass 0.6 — the caption skill's pop). */
export const PopInLine: React.FC<{
  words: string[];
  firstFrame: number;
  frame: number;
  fontSize: number;
  color?: string;
  gapFrames?: number;
  fontFamily?: string;
  align?: "center" | "left";
}> = ({ words, firstFrame, frame, fontSize, color, gapFrames = 3, fontFamily, align = "center" }) => {
  const { fps } = useVideoConfig();
  return (
    <div style={{ fontFamily, fontSize, color, textAlign: align, lineHeight: 1.15 }} aria-label={words.join(" ")}>
      {words.map((w, i) => {
        const p = spring({ frame: frame - firstFrame - i * gapFrames, fps, config: { damping: 12, mass: 0.6 } });
        const scale = interpolate(p, [0, 1], [0.6, 1]);
        return (
          <span key={i} aria-hidden style={{ display: "inline-block", transform: `scale(${scale})`, opacity: interpolate(p, [0, 1], [0, 1]) }}>
            {w}
            {i < words.length - 1 ? " " : ""}
          </span>
        );
      })}
    </div>
  );
};

/** Motion Prompt #006 · MIT License — typewriter: one character at
 *  a time, 0.05 s per character, with a blinking cursor at the end.
 *  0.05 s is 1.5 frames at 30fps, so 2 frames per character. */
export const TypewriterLine: React.FC<{
  words: string[];
  firstFrame: number;
  frame: number;
  fontSize: number;
  color?: string;
  fontFamily?: string;
  align?: "center" | "left";
}> = ({ words, firstFrame, frame, fontSize, color, fontFamily, align = "center" }) => {
  const text = words.join(" ");
  const framesPerChar = 2;
  const shown = Math.max(0, Math.min(text.length, Math.floor((frame - firstFrame) / framesPerChar) + 1));
  const cursorOn = frame % 20 < 12;
  return (
    <div style={{ fontFamily, fontSize, color, textAlign: align, lineHeight: 1.15 }} aria-label={text}>
      <span aria-hidden>{text.slice(0, shown)}</span>
      <span aria-hidden style={{ opacity: cursorOn ? 1 : 0, color }}>▌</span>
    </div>
  );
};

/** Motion Prompt #007 · MIT License — count-up: the scene's numeric
 *  word runs 0 to its final value in 1.5 s, slowing at the end
 *  (easeOutCubic). The target comes only from the brief's own scene
 *  words; with no numeric word the move falls back to a mask
 *  reveal and says so in the code — never a hardcoded target. */
export const CountUpLine: React.FC<{
  words: string[];
  firstFrame: number;
  frame: number;
  fps: number;
  fontSize: number;
  color?: string;
  gapFrames?: number;
  fontFamily?: string;
  align?: "center" | "left";
}> = ({ words, firstFrame, frame, fps, fontSize, color, gapFrames = 7, fontFamily, align = "center" }) => {
  const numIndex = words.findIndex((w) => /^-?[\d,]+(\.\d+)?$/.test(w.replace(/[.,!?;:]$/, "")));
  if (numIndex === -1) {
    return (
      <MaskRevealLine words={words} firstFrame={firstFrame} frame={frame} fontSize={fontSize} color={color} fontFamily={fontFamily} align={align} />
    );
  }
  const raw = words[numIndex].replace(/,$/, "");
  const target = Number(raw.replace(/,/g, ""));
  const durationFrames = Math.round(1.5 * fps);
  const progress = applyEasing("easeOut", interpolate(frame - firstFrame, [0, durationFrames], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const value = Math.round(target * progress).toLocaleString("en-US");
  const shown = words.map((w, i) => (i === numIndex ? value : w));
  return (
    <div style={{ fontFamily, fontSize, color, textAlign: align, lineHeight: 1.15, fontVariantNumeric: "tabular-nums" }} aria-label={words.join(" ")}>
      {shown.map((w, i) => (
        <span key={i} aria-hidden>
          {w}
          {i < shown.length - 1 ? " " : ""}
        </span>
      ))}
    </div>
  );
};

/** Dispatcher: a registry reveal renders the scene's words. Any
 *  non-registry reveal name falls back to the v2.10 KineticReveal. */
export const MoveReveal: React.FC<{
  move: MoveSpec;
  words: string[];
  firstFrame: number;
  frame: number;
  fps: number;
  fontSize: number;
  color?: string;
  gapFrames?: number;
  rise?: boolean;
  fontFamily?: string;
  align?: "center" | "left";
}> = ({ move, words, firstFrame, frame, fps, fontSize, color, gapFrames = 7, rise = false, fontFamily, align = "center" }) => {
  if (move.name === "pop-in") {
    return <PopInLine words={words} firstFrame={firstFrame} frame={frame} fontSize={fontSize} color={color} gapFrames={3} fontFamily={fontFamily} align={align} />;
  }
  if (move.name === "typewriter") {
    return <TypewriterLine words={words} firstFrame={firstFrame} frame={frame} fontSize={fontSize} color={color} fontFamily={fontFamily} align={align} />;
  }
  if (move.name === "count-up") {
    return <CountUpLine words={words} firstFrame={firstFrame} frame={frame} fps={fps} fontSize={fontSize} color={color} gapFrames={gapFrames} fontFamily={fontFamily} align={align} />;
  }
  if (move.name === "stagger") {
    // #002: 0.08 s apart — 2.4 frames at 30fps, so 2 frames.
    return <KineticLine words={words} firstFrame={firstFrame} frame={frame} fps={fps} fontSize={fontSize} color={color} gapFrames={2} rise={rise} fontFamily={fontFamily} align={align} />;
  }
  if (move.name === "mask-reveal") {
    return <KineticReveal reveal="mask" words={words} firstFrame={firstFrame} frame={frame} fps={fps} fontSize={fontSize} color={color} gapFrames={gapFrames} rise={rise} fontFamily={fontFamily} align={align} />;
  }
  return <KineticLine words={words} firstFrame={firstFrame} frame={frame} fps={fps} fontSize={fontSize} color={color} gapFrames={gapFrames} rise={rise} fontFamily={fontFamily} align={align} />;
};

/* ------------------------------------------------------------------ */
/* Camera overrides                                                    */
/* ------------------------------------------------------------------ */

/** A registry camera move overrides the scene's camera plan. Pan
 *  and dolly-in run the whole scene; zoom-in runs its 3 s spec
 *  from the scene start (the Camera primitive eases over the full
 *  scene, so the zoom is the scene-length ease of a 1 → 1.15 push
 *  — the lens move, not a dolly). */
export const moveCamera = (
  move: MoveSpec,
  sceneCamera: { fromScale: number; toScale: number; fromX: number; toX: number },
): { fromScale: number; toScale: number; fromX: number; toX: number } => {
  if (move.name === "pan") {
    return { fromScale: sceneCamera.fromScale, toScale: sceneCamera.toScale, fromX: -40, toX: 40 };
  }
  if (move.name === "dolly-in") {
    return { fromScale: 1, toScale: 1.12, fromX: 0, toX: 0 };
  }
  if (move.name === "zoom-in") {
    return { fromScale: 1, toScale: 1.15, fromX: 0, toX: 0 };
  }
  return sceneCamera;
};

/* ------------------------------------------------------------------ */
/* Effect / cut wrappers                                               */
/* ------------------------------------------------------------------ */

/** Motion Prompt #012 · MIT License — shape morph: a 10-point
 *  polygon interpolates circle → star over 0.8 s, color accent →
 *  surface on the way. The morph is a real vertex interpolation:
 *  each vertex radius moves from the circle radius to the star's
 *  outer/inner radius. Drawn top-right of the scene so the words
 *  keep the frame. */
export const ShapeMorphMark: React.FC<{
  frame: number;
  fps: number;
  palette: HarnessPalette;
}> = ({ frame, fps, palette }) => {
  const progress = applyEasing("easeInOut", interpolate(frame, [0, Math.round(0.8 * fps)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const cx = 60;
  const cy = 60;
  const points: string[] = [];
  for (let i = 0; i < 10; i++) {
    const angle = (i * 36 - 90) * (Math.PI / 180);
    const starR = i % 2 === 0 ? 52 : 24;
    const r = interpolate(progress, [0, 1], [52, starR]);
    points.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
  }
  const fill = progress < 0.5 ? palette.accent : palette.surface;
  return (
    <div style={{ position: "absolute", top: 170, right: 48, width: 120, height: 120, zIndex: 4 }}>
      <svg width="120" height="120" viewBox="0 0 120 120">
        <polygon points={points.join(" ")} fill={fill} stroke={palette.accent} strokeWidth="3" />
      </svg>
    </div>
  );
};

/** Motion Prompt #022 · MIT License — light sweep: one band of
 *  light crosses the frame once, subtle, over ~0.9 s. */
export const LightSweep: React.FC<{
  frame: number;
  fps: number;
}> = ({ frame, fps }) => {
  const durationFrames = Math.round(0.9 * fps);
  const x = interpolate(frame, [0, durationFrames], [-220, 940], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const opacity = interpolate(frame, [0, 6, durationFrames - 6, durationFrames], [0, 0.28, 0.28, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", top: 0, bottom: 0, left: x, width: 140, backgroundColor: "#FFFFFF", opacity, transform: "skewX(-18deg)", zIndex: 4, pointerEvents: "none" }} />
  );
};

/** Motion Prompt #024 · MIT License — impact shake: the frame
 *  shakes on landing and settles within 0.4 s (12 frames). The
 *  offsets are deterministic sine decays — no randomness, so the
 *  frame rule holds. */
export const ImpactShake: React.FC<{
  frame: number;
  children: React.ReactNode;
}> = ({ frame, children }) => {
  const settle = Math.max(0, 1 - frame / 12);
  const dx = Math.sin(frame * 2.1) * 9 * settle;
  const dy = Math.cos(frame * 1.7) * 7 * settle;
  return (
    <div style={{ width: "100%", height: "100%", transform: `translate(${dx}px, ${dy}px)` }}>
      {children}
    </div>
  );
};

/** Motion Prompt #033 · MIT License — rack focus: over 1 s the
 *  foreground disc blurs out while the words sharpen in. The
 *  words start at blur(6px) and land sharp; the near disc starts
 *  sharp and blurs to 8px. */
export const RackFocus: React.FC<{
  frame: number;
  fps: number;
  palette: HarnessPalette;
  children: React.ReactNode;
}> = ({ frame, fps, palette, children }) => {
  const durationFrames = Math.round(1.0 * fps);
  const p = interpolate(frame, [0, durationFrames], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const wordsBlur = interpolate(p, [0, 1], [6, 0]);
  const discBlur = interpolate(p, [0, 1], [0, 8]);
  const discOpacity = interpolate(p, [0, 1], [0.3, 0.08]);
  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <div
        style={{
          position: "absolute",
          left: 90,
          top: 180,
          width: 150,
          height: 150,
          borderRadius: "50%",
          backgroundColor: palette.accent,
          filter: `blur(${discBlur}px)`,
          opacity: discOpacity,
          zIndex: 3,
        }}
      />
      <div style={{ width: "100%", height: "100%", filter: `blur(${wordsBlur}px)` }}>{children}</div>
    </div>
  );
};

/** Motion Prompt #041 · MIT License — jump cut: same framing, skip
 *  ahead in time. At 40% of the scene the framing jumps 1 → 1.06
 *  in one frame — the visible skip. */
export const JumpCutWrap: React.FC<{
  frame: number;
  sceneFrames: number;
  children: React.ReactNode;
}> = ({ frame, sceneFrames, children }) => {
  const scale = frame < Math.round(sceneFrames * 0.4) ? 1 : 1.06;
  return (
    <div style={{ width: "100%", height: "100%", transform: `scale(${scale})`, transformOrigin: "50% 45%" }}>
      {children}
    </div>
  );
};

/** Dispatcher: a registry effect / cut move wraps the scene body.
 *  Returns the body unchanged for moves of other kinds. */
export const MoveEffect: React.FC<{
  move: MoveSpec;
  frame: number;
  fps: number;
  sceneFrames: number;
  palette: HarnessPalette;
  children: React.ReactNode;
}> = ({ move, frame, fps, sceneFrames, palette, children }) => {
  if (move.name === "shape-morph") {
    return (
      <div style={{ width: "100%", height: "100%", position: "relative" }}>
        {children}
        <ShapeMorphMark frame={frame} fps={fps} palette={palette} />
      </div>
    );
  }
  if (move.name === "light-sweep") {
    return (
      <div style={{ width: "100%", height: "100%", position: "relative" }}>
        {children}
        <LightSweep frame={frame} fps={fps} />
      </div>
    );
  }
  if (move.name === "impact-shake") {
    return <ImpactShake frame={frame}>{children}</ImpactShake>;
  }
  if (move.name === "rack-focus") {
    return <RackFocus frame={frame} fps={fps} palette={palette}>{children}</RackFocus>;
  }
  if (move.name === "jump-cut") {
    return <JumpCutWrap frame={frame} sceneFrames={sceneFrames}>{children}</JumpCutWrap>;
  }
  return <>{children}</>;
};

/* ------------------------------------------------------------------ */
/* Transition geometry (the cut AFTER a scene)                         */
/* ------------------------------------------------------------------ */

/** A registry transition move names the cut after its scene.
 *  Returns the transitionOut string Vertical/Harness store on the
 *  scene, or null when the move is not a transition. */
export const transitionForMove = (move: MoveSpec | null): string | null =>
  move && move.kind === "transition" ? move.name : null;

/** Incoming-scene geometry for a transition cut, as a style the
 *  scene body wraps in. prevTransition is the transitionOut of the
 *  scene before this one. Mask: the new scene appears inside a
 *  circle growing from the center, 0.7 s. Match cut: the shared
 *  shape (accent disc) shrinks away over the first 6 frames.
 *  Whip pan: the scene sweeps in from the right with blur.
 *  Cross dissolve: the scene fades in over 1 s. */
export const incomingTransitionStyle = (
  prevTransition: string | undefined,
  frame: number,
  fps: number,
): React.CSSProperties => {
  if (prevTransition === "mask-transition") {
    const r = interpolate(frame, [0, Math.round(0.7 * fps)], [0, 900], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    return { clipPath: `circle(${r}px at 50% 50%)` };
  }
  if (prevTransition === "cross-dissolve") {
    return { opacity: interpolate(frame, [0, fps], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) };
  }
  if (prevTransition === "whip-pan") {
    const x = interpolate(frame, [0, 9], [720, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    const blur = interpolate(frame, [0, 9], [8, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    return { transform: `translateX(${x}px)`, filter: `blur(${blur}px)` };
  }
  return {};
};

/** Incoming-side disc for a match cut: the shared accent disc the
 *  outgoing scene grew shrinks away over the first 6 frames. */
export const incomingTransitionDisc = (
  prevTransition: string | undefined,
  frame: number,
  palette: HarnessPalette,
): React.ReactNode => {
  if (prevTransition !== "match-cut") {
    return null;
  }
  const r = interpolate(frame, [0, 6], [160, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        width: r * 2,
        height: r * 2,
        marginLeft: -r,
        marginTop: -r,
        borderRadius: "50%",
        backgroundColor: palette.accent,
        zIndex: 6,
      }}
    />
  );
};

/** Outgoing-scene geometry for a transition cut. Match cut: the
 *  shared accent disc grows at the center over the last 6 frames.
 *  Whip pan: the scene sweeps out to the left with blur over the
 *  last 9 frames. Cross dissolve: the scene fades out over its
 *  last 1 s. Mask transition needs no outgoing work — the incoming
 *  circle does it. Returns { style, disc } — the disc is an extra
 *  element the scene renders when set. */
export const outgoingTransition = (
  transitionOut: string | undefined,
  frame: number,
  sceneFrames: number,
  fps: number,
  palette: HarnessPalette,
): { style: React.CSSProperties; disc: React.ReactNode } => {
  if (transitionOut === "cross-dissolve") {
    const start = Math.max(0, sceneFrames - fps);
    return {
      style: { opacity: interpolate(frame, [start, sceneFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) },
      disc: null,
    };
  }
  if (transitionOut === "whip-pan") {
    const start = Math.max(0, sceneFrames - 9);
    const x = interpolate(frame, [start, sceneFrames], [0, -720], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    const blur = interpolate(frame, [start, sceneFrames], [0, 8], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    return { style: { transform: `translateX(${x}px)`, filter: `blur(${blur}px)` }, disc: null };
  }
  if (transitionOut === "match-cut") {
    const start = Math.max(0, sceneFrames - 6);
    const r = interpolate(frame, [start, sceneFrames], [0, 160], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    return {
      style: {},
      disc: (
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: r * 2,
            height: r * 2,
            marginLeft: -r,
            marginTop: -r,
            borderRadius: "50%",
            backgroundColor: palette.accent,
            zIndex: 6,
          }}
        />
      ),
    };
  }
  return { style: {}, disc: null };
};
