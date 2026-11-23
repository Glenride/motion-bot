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
  ScaleLine,
  SlideLines,
  StackLine,
  ZoomCut,
  rand,
  resolveFont,
  resolveKinetic,
  type HarnessPalette,
} from "./harness/primitives";
import {
  ColorMotionWash,
  ConstellationLines,
  LogoReveal,
  MeshGradient,
  ParallaxChip,
  personalityForTone,
  sceneStarts,
  tintedBackground,
} from "./harness/motionDesign";
import { LowerThirdOverlay } from "./LowerThird";
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
import {
  DuetSplit,
  PunchIn,
  fastCutStarts,
  hookFirstStarts,
  resolveTikTokFormat,
} from "./TikTokFormats";
import {
  HARNESS_DEFAULTS,
  sceneWeightsFor,
  type HarnessProps,
  type HarnessScene,
} from "./Harness";

/**
 * Vertical — the 9:16 short-form composition (720x1280), v2.5.
 *
 * Same storyboard JSON as Harness (palette, mood, scenes, project,
 * subtitle) but framed for Reels / Shorts / TikTok per the
 * tiktok-video-skills short-form grammar:
 *  - hook lands in the first scene, words big and centered;
 *  - 120px safe area top, 160px bottom (captions + UI chrome);
 *  - scenes split the duration evenly, wipe / zoom-cut between them;
 *  - no fixed-width motifs: the portrait background is its own
 *    drifting-dot field sized for 720x1280, so nothing clips.
 *
 * It deliberately does NOT reuse MovingBackground / MotifLayer: both
 * are sized for the 1280x720 landscape canvas and would clip or
 * leave dead space in portrait.
 *
 * Variant (v2.5): Vertical honors props.variant like Harness —
 * orbit keeps the drifting-dot field, kinetic is a flat field with
 * bigger/faster type, sweep gets swaying accent bands, rise drops
 * the dots and lifts the words from below. The accent carrier
 * (AccentMark) varies by variant too. No look is the default: the
 * palette follows the brief, and the variant rotates by task id
 * unless a Variant:/Motion: label overrides it.
 *
 * Panel / font / motion (v2.6): the 2026-11-20 correction — the
 * variants above only changed background + type size, so every clip
 * still read as the same centered serif paragraph. props.panel
 * changes the composition of the words themselves (centered | split
 * | card | lower-third | word-stack), props.font changes the
 * typeface (serif | sans | mono — stacks that resolve on the iMac,
 * see FONTS in harness/primitives), props.motion changes how words
 * enter (kinetic | slide | scale | rise). All three rotate by task
 * id unless a Panel: / Font: / Motion: (or Move:) label overrides
 * them. Defaults (centered / serif / kinetic) render exactly the
 * pre-v2.6 look, so in-flight work is unchanged.
 *
 * Named moves / TikTok formats (v2.11): props.move / props.moves
 * name Motion Prompt registry moves per scene (reveal / camera /
 * effect / cut / transition — see harness/motionRegistry); props.
 * tiktokFormat selects a short-form format (hook-first | fast-cut
 * | duet — see TikTokFormats). Neither is set without a label, so
 * a clip with no Move: / TikTok: label renders exactly as v2.10.
 */

const VERTICAL_DEFAULTS = {
  ...HARNESS_DEFAULTS,
  lengthSeconds: 12,
};

const VARIANTS = ["orbit", "kinetic", "sweep", "rise"] as const;

const resolveVariant = (v?: string) =>
  VARIANTS.includes((v ?? "") as (typeof VARIANTS)[number])
    ? (v as (typeof VARIANTS)[number])
    : "orbit";

/** Panel layouts (v2.6). Each is a different composition of the same
 *  scene words — not a background swap. */
const PANELS = ["centered", "split", "card", "lower-third", "word-stack"] as const;

const resolvePanel = (p?: string) =>
  PANELS.includes((p ?? "") as (typeof PANELS)[number])
    ? (p as (typeof PANELS)[number])
    : "centered";

/** Word-entry motions (v2.6). */
const MOTIONS = ["kinetic", "slide", "scale", "rise"] as const;

const resolveMotion = (m?: string) =>
  MOTIONS.includes((m ?? "") as (typeof MOTIONS)[number])
    ? (m as (typeof MOTIONS)[number])
    : "kinetic";

const fontSizeFor = (wordCount: number) =>
  wordCount <= 4 ? 72 : wordCount <= 6 ? 62 : wordCount <= 9 ? 52 : 44;

const gapFor = (pacing: string) =>
  pacing === "slow" ? 9 : pacing === "fast" ? 5 : 7;

const PortraitDots: React.FC<{ frame: number; palette: HarnessPalette }> = ({
  frame,
  palette,
}) => {
  const dots = Array.from({ length: 42 }, (_, i) => {
    const x0 = rand(i) * 720;
    const y0 = rand(i + 50) * 1280;
    const size = 2 + rand(i + 90) * 5;
    const speed = 0.4 + rand(i + 130) * 1.1;
    const sway = Math.sin(frame * 0.02 + i * 2.1) * 30;
    return {
      left: x0 + sway,
      top: (y0 + frame * speed) % 1300 - 20,
      size,
      opacity: 0.25 + 0.45 * (0.5 + 0.5 * Math.sin(frame * 0.05 + i * 3.3)),
    };
  });
  return (
    <AbsoluteFill>
      {dots.map((d, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: d.left,
            top: d.top,
            width: d.size,
            height: d.size,
            borderRadius: "50%",
            backgroundColor: palette.particle,
            opacity: d.opacity,
          }}
        />
      ))}
    </AbsoluteFill>
  );
};

/** Swaying accent bands, sized for the 720x1280 portrait canvas —
 *  the sweep variant's background (mirrors Harness DiagonalBands).
 *  Bands use palette.accent / palette.accentDeep, never a fixed
 *  color. */
const PortraitBands: React.FC<{ frame: number; palette: HarnessPalette }> = ({
  frame,
  palette,
}) => {
  const sway = Math.sin(frame * 0.02) * 42;
  const bands = [
    { top: "14%", color: palette.accent, opacity: 0.55 },
    { top: "44%", color: palette.accentDeep, opacity: 0.4 },
    { top: "74%", color: palette.accent, opacity: 0.3 },
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
            height: 120,
            backgroundColor: b.color,
            opacity: b.opacity,
            transform: `translateX(${sway * (i % 2 === 0 ? 1 : -1)}px) rotate(-14deg)`,
          }}
        />
      ))}
    </AbsoluteFill>
  );
};

/** Clip-level accent carrier, OUTSIDE the scene cameras (an accent
 *  element inside a camera scales off-frame under the camera push).
 *  Full-opacity palette.accent — it follows the brief's palette,
 *  never a hardcoded color. Geometry varies by variant so the
 *  carrier itself is not a second fixed look: top bar for orbit /
 *  kinetic (kinetic mirrors Harness), bottom bar for sweep, left
 *  rail for rise. PortraitDots alone cannot carry the accent: dots
 *  at 0.25-0.70 opacity blend away from the accent and read 0
 *  pixels in the critic (task 369). */
const AccentMark: React.FC<{ variant: string; palette: HarnessPalette }> = ({
  variant,
  palette,
}) => {
  if (variant === "rise") {
    return (
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: 0,
          width: 8,
          backgroundColor: palette.accent,
          zIndex: 5,
        }}
      />
    );
  }
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        height: 8,
        backgroundColor: palette.accent,
        zIndex: 5,
        ...(variant === "sweep" ? { bottom: 0 } : { top: 0 }),
      }}
    />
  );
};

const VScene: React.FC<{
  scene: HarnessScene;
  sceneFrames: number;
  frame: number;
  fps: number;
  palette: HarnessPalette;
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
  /** v2.11: the registry move for this scene (Move:/Moves: label). */
  sceneMove: MoveSpec | null;
  /** v2.11: the transitionOut of the previous scene (incoming cut). */
  prevTransition?: string;
  /** v2.11: this scene's cut, after the registry move overrides it. */
  effectiveTransitionOut: string;
  /** v2.11: hook-first scene 0 — 1 s punch, biggest type, frame 0. */
  hookPunch?: boolean;
  /** v2.11: fast-cut — punch-in zoom interrupt at the scene start. */
  fastCut?: boolean;
}> = ({ scene, sceneFrames, frame, fps, palette, isLastScene, project, subtitle, pacing, variant, panel, fontFamily, motion, kinetic, easing, logo, sceneMove, prevTransition, effectiveTransitionOut, hookPunch = false, fastCut = false }) => {
  const endOpacity =
    isLastScene && (logo || project || subtitle)
      ? interpolate(frame, [sceneFrames * 0.7, sceneFrames * 0.85], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 0;
  const baseSize =
    (variant === "kinetic"
      ? fontSizeFor(scene.words.length) + 14
      : fontSizeFor(scene.words.length)) + (hookPunch ? 40 : 0);
  const gap = hookPunch ? 2 : variant === "kinetic" ? 4 : gapFor(pacing);
  // Rise stays on for the rise variant (pre-v2.6 behavior) and for
  // the rise motion; every other motion keeps its own entry.
  const rise = motion === "rise" || variant === "rise";
  // Hook-first: the hook is on screen at frame 1 — no fade-up.
  const firstFrame = hookPunch ? 0 : 8;

  // Headline/support (Writer stage — mirrors Harness): when the
  // scene carries a headline it is the big line, at
  // fontSizeFor(headline.length) (+ hook punch), and the support
  // line follows smaller (headline size minus 22, floor 32),
  // muted, entering at ~45% of the scene's frames. Without a
  // headline, headSize IS baseSize and support is null, so every
  // branch below reduces to the old slices of scene.words.
  const hasHeadline = !!scene.headline && scene.headline.length > 0;
  const headline = hasHeadline ? (scene.headline as string[]) : scene.words;
  const support = hasHeadline ? (scene.support ?? null) : null;
  const headSize = hasHeadline
    ? (variant === "kinetic"
        ? fontSizeFor(headline.length) + 14
        : fontSizeFor(headline.length)) + (hookPunch ? 40 : 0)
    : baseSize;
  const supportSize = Math.max(32, headSize - 22);
  const supportFirstFrame = Math.round(sceneFrames * 0.45);

  /** Render words with the clip's motion language. A registry
   *  reveal (v2.11) IS the entry for its scene — it replaces the
   *  v2.6 motion choice and the v2.10 kinetic reveal alike. A
   *  Kinetic: reveal (v2.10) IS the entry — it replaces the v2.6
   *  motion choice for that clip; `word` keeps the motion dispatch
   *  below exactly as before. `startFrame` overrides the scene's
   *  default first frame (0 for a hook punch, else 8); callers pass
   *  a later frame only for a delayed support line. */
  const renderWords = (
    ws: string[],
    size: number,
    color: string,
    align: "center" | "left" = "center",
    startFrame?: number,
  ) => {
    const ff = startFrame ?? firstFrame;
    if (sceneMove && sceneMove.kind === "reveal") {
      return (
        <MoveReveal
          move={sceneMove}
          words={ws}
          firstFrame={ff}
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
          firstFrame={ff}
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
          firstFrame={ff}
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
          firstFrame={ff}
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
        firstFrame={ff}
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

  /** A line with the scene's emphasis word in the accent color.
   *  No headline (old-style scene), no emphasis, or an emphasis
   *  word not found in the line: exactly one renderWords call, as
   *  today. Otherwise the line splits into before / emphasis /
   *  after runs, each through the same dispatch, laid out inline
   *  with wrapping. */
  const renderLine = (
    ws: string[],
    size: number,
    color: string,
    align: "center" | "left" = "center",
    startFrame?: number,
  ) => {
    const em = hasHeadline ? (scene.emphasis ?? null) : null;
    if (!em) return renderWords(ws, size, color, align, startFrame);
    const idx = ws.indexOf(em);
    if (idx === -1) return renderWords(ws, size, color, align, startFrame);
    const runs: { words: string[]; color: string }[] = [];
    if (idx > 0) runs.push({ words: ws.slice(0, idx), color });
    runs.push({ words: [em], color: palette.accent });
    if (idx < ws.length - 1) runs.push({ words: ws.slice(idx + 1), color });
    return (
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: align === "left" ? "flex-start" : "center",
          alignItems: "center",
        }}
      >
        {runs.map((r, i) => (
          <React.Fragment key={i}>
            {renderWords(r.words, size, r.color, align, startFrame)}
          </React.Fragment>
        ))}
      </div>
    );
  };

  /** The support line: smaller, muted (no muted treatment exists
   *  in these files — palette text at reduced opacity), entering
   *  at ~45% of the scene, after the headline. */
  const renderSupport = (ws: string[], align: "center" | "left" = "center") => (
    <div style={{ opacity: 0.75 }}>
      {renderLine(ws, supportSize, palette.text, align, supportFirstFrame)}
    </div>
  );

  /** Word-stack runs: the stack is one word per line, so an
   *  emphasis split is one StackLine per run, stacked in the same
   *  column — the column reads unchanged. */
  const renderStackRuns = (ws: string[], size: number, stackFirstFrame: number) => {
    const em = hasHeadline ? (scene.emphasis ?? null) : null;
    const idx = em ? ws.indexOf(em) : -1;
    if (idx === -1 || !em) {
      return (
        <StackLine
          words={ws}
          firstFrame={stackFirstFrame}
          frame={frame}
          fps={fps}
          fontSize={size}
          color={palette.text}
          fontFamily={fontFamily}
        />
      );
    }
    const runs: { words: string[]; color: string }[] = [];
    if (idx > 0) runs.push({ words: ws.slice(0, idx), color: palette.text });
    runs.push({ words: [em], color: palette.accent });
    if (idx < ws.length - 1) runs.push({ words: ws.slice(idx + 1), color: palette.text });
    return (
      <>
        {runs.map((r, i) => (
          <StackLine
            key={i}
            words={r.words}
            firstFrame={stackFirstFrame}
            frame={frame}
            fps={fps}
            fontSize={size}
            color={r.color}
            fontFamily={fontFamily}
          />
        ))}
      </>
    );
  };

  /** End card — only on panels with room below the words (centered,
   *  card). Split / lower-third / word-stack leave it off rather
   *  than colliding with the layout. With a Logo: label (v2.10) the
   *  end card is the code-drawn mark + wordmark, with the subtitle
   *  below it; otherwise the plain project / subtitle lines. */
  const endCard =
    isLastScene && (logo || project || subtitle) && (panel === "centered" || panel === "card") ? (
      <div style={{ opacity: endOpacity, textAlign: "center", marginTop: 40 }}>
        {logo ? (
          <LogoReveal wordmark={logo} palette={palette} frame={frame} fps={fps} fontFamily={fontFamily} size={360} />
        ) : project ? (
          <div
            style={{
              fontFamily,
              fontSize: 40,
              fontWeight: 700,
              color: palette.accent,
            }}
          >
            {project}
          </div>
        ) : null}
        {subtitle ? (
          <div style={{ fontFamily, fontSize: 28, color: palette.text }}>
            {subtitle}
          </div>
        ) : null}
      </div>
    ) : null;

  const words = scene.words;
  const half = Math.max(1, Math.ceil(words.length / 2));
  const head = words.slice(0, half);
  const tail = words.slice(half);

  let body: React.ReactNode;
  if (panel === "split") {
    // Hook words huge in the accent at the top, an accent rule, then
    // the supporting line at the bottom. Top/bottom, not centered.
    // With a headline, the headline is the top half and the support
    // line is the bottom half; without one, the old 2-word hook + rest.
    const hook = hasHeadline ? headline : words.slice(0, 2);
    const rest = hasHeadline ? (support ?? []) : words.slice(2);
    body = (
      <AbsoluteFill
        style={{
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "154px 48px 230px 48px",
        }}
      >
        <div>{renderLine(hook, headSize + 26, palette.accent, "left")}</div>
        <div style={{ width: 140, height: 6, backgroundColor: palette.accent }} />
        {rest.length > 0 ? (
          <div style={hasHeadline ? { opacity: 0.75 } : undefined}>
            {renderLine(
              rest,
              hasHeadline ? supportSize : Math.max(34, baseSize - 10),
              palette.text,
              "left",
              hasHeadline ? supportFirstFrame : undefined,
            )}
          </div>
        ) : null}
      </AbsoluteFill>
    );
  } else if (panel === "card") {
    // Words inside a bordered card on the brief's surface, offset
    // up-left from center, with the first word as a small-caps
    // kicker in the accent. The card is surface, the words are text:
    // contrast is unchanged from the centered panel. With a
    // headline, the headline is the big line and the support line
    // sits below it, smaller and muted; without one, the old
    // kicker + rest.
    const kicker = words[0];
    const rest = words.slice(1);
    body = (
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          padding: "154px 48px 230px 48px",
        }}
      >
        <div
          style={{
            backgroundColor: palette.surface,
            border: `3px solid ${palette.accent}`,
            borderRadius: 6,
            padding: "36px 28px",
            maxWidth: 620,
            transform: "translate(-28px, -48px)",
          }}
        >
          {hasHeadline ? (
            <>
              {renderLine(headline, headSize, palette.text)}
              {support && support.length > 0 ? (
                <div style={{ marginTop: 18 }}>{renderSupport(support)}</div>
              ) : null}
            </>
          ) : rest.length > 0 ? (
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
              {renderWords(rest, Math.max(36, baseSize - 8), palette.text)}
            </>
          ) : (
            renderWords(words, baseSize, palette.text)
          )}
          {endCard}
        </div>
      </AbsoluteFill>
    );
  } else if (panel === "lower-third") {
    // Headline + subhead anchored low, with an accent bar above the
    // headline. The top ~60% of the frame is deliberate negative
    // space — the opposite of the centered panel. With a headline,
    // it is the hook line and the support line is the rest; without
    // one, the old half/half split.
    const ltHead = hasHeadline ? headline : head;
    const ltTail = hasHeadline ? (support ?? []) : tail;
    body = (
      <AbsoluteFill
        style={{
          justifyContent: "flex-end",
          alignItems: "flex-start",
          padding: "0 48px 230px 48px",
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
        {renderLine(ltHead, headSize + 8, palette.text, "left")}
        {ltTail.length > 0 ? (
          <div style={hasHeadline ? { marginTop: 14, opacity: 0.75 } : { marginTop: 14 }}>
            {renderLine(
              ltTail,
              hasHeadline ? supportSize : 34,
              palette.text,
              "left",
              hasHeadline ? supportFirstFrame : undefined,
            )}
          </div>
        ) : null}
      </AbsoluteFill>
    );
  } else if (panel === "word-stack") {
    // One word per line, huge, staggered rise. The stack's motion is
    // inherent: it always uses StackLine, whatever the motion prop
    // says — the layout and the entry are the same move here. With
    // a headline, its first word is the kicker and the remaining
    // headline words + support are the stack; without one, the whole
    // word list, as before.
    const stackSize =
      words.length <= 4 ? 96 : words.length <= 6 ? 80 : 64;
    if (hasHeadline) {
      const stackKicker = headline[0];
      const stackRest = headline.slice(1);
      const stackRestSize =
        (stackRest.length + (support?.length ?? 0)) <= 4
          ? 96
          : (stackRest.length + (support?.length ?? 0)) <= 6
            ? 80
            : 64;
      body = (
        <AbsoluteFill
          style={{
            justifyContent: "center",
            alignItems: "flex-start",
            padding: "154px 48px 230px 64px",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
            }}
          >
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
              {stackKicker}
            </div>
            {stackRest.length > 0 ? renderStackRuns(stackRest, stackRestSize, 8) : null}
            {support && support.length > 0 ? (
              <div style={{ opacity: 0.75 }}>
                {renderStackRuns(support, stackRestSize, supportFirstFrame)}
              </div>
            ) : null}
          </div>
        </AbsoluteFill>
      );
    } else {
      body = (
        <AbsoluteFill
          style={{
            justifyContent: "center",
            alignItems: "flex-start",
            padding: "154px 48px 230px 64px",
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
    }
  } else {
    // centered — the pre-v2.6 layout, unchanged (v2.10: padding is
    // the 9:16 safe area — top 12% / bottom 18% / sides 6% — per the
    // shot-composition skill, not the old 120/160px). With a
    // headline, the headline is the big line and the support line
    // sits below it, smaller and muted; without one, the full word
    // list.
    body = (
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          padding: "154px 48px 230px 48px",
        }}
      >
        {hasHeadline ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 20,
            }}
          >
            {renderLine(headline, headSize, palette.text)}
            {support && support.length > 0 ? renderSupport(support) : null}
          </div>
        ) : (
          renderWords(words, baseSize, palette.text)
        )}
        {endCard}
      </AbsoluteFill>
    );
  }

  // v2.11: a registry camera move overrides the scene's camera
  // plan; a registry effect / cut move wraps the body; a registry
  // transition is in-scene geometry on the two scenes either side
  // of the cut (see motionRegistry). The outgoing geometry applies
  // only inside its window at the end of the scene; the incoming
  // geometry clamps harmlessly after its window.
  const camera =
    sceneMove && sceneMove.kind === "camera"
      ? moveCamera(sceneMove, scene.camera)
      : scene.camera;
  const inStyle = incomingTransitionStyle(prevTransition, frame, fps);
  const inDisc = incomingTransitionDisc(prevTransition, frame, palette);
  const out = outgoingTransition(effectiveTransitionOut, frame, sceneFrames, fps, palette);
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
  if (fastCut || hookPunch) {
    content = <PunchIn frame={frame}>{content}</PunchIn>;
  }

  return (
    <Camera
      localFrame={frame}
      sceneFrames={sceneFrames}
      fromScale={camera.fromScale}
      toScale={camera.toScale}
      fromX={camera.fromX}
      toX={camera.toX}
    >
      <div style={{ position: "relative", width: "100%", height: "100%", ...wrapStyle }}>
        {content}
        {inDisc}
        {outActive ? out.disc : null}
      </div>
    </Camera>
  );
};

export const Vertical: React.FC<HarnessProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const palette = { ...VERTICAL_DEFAULTS.palette, ...(props.palette ?? {}) };
  const rawProject = (props.project ?? "").trim();
  const project =
    rawProject &&
    rawProject.toLowerCase() !== "untitled project" &&
    rawProject.toLowerCase() !== "motion bot"
      ? rawProject
      : "";
  const subtitle = props.subtitle ?? "";
  const scenes =
    props.scenes && props.scenes.length > 0
      ? props.scenes
      : VERTICAL_DEFAULTS.scenes;
  const pacing = props.mood?.pacing ?? "medium";
  const tone = props.mood?.tone ?? "neutral";
  const variant = resolveVariant(props.variant);
  // Defaults reproduce the pre-v2.6 look exactly: centered panel,
  // serif type, kinetic words. A storyboard that sets none of these
  // renders as it did before v2.6.
  const panel = resolvePanel(props.panel);
  const fontFamily = resolveFont(props.font);
  const motion = resolveMotion(props.motion);
  // v2.10: kinetic reveal (default `word` = the v2.6 line), beat
  // grid BPM (0 = even split), lower-third strap, logo wordmark.
  const kinetic = resolveKinetic(props.kinetic);
  const bpm = props.bpm ?? 0;
  const name = (props.name ?? "").trim();
  const role = (props.role ?? "").trim();
  const pills = props.pills ?? [];
  const source = (props.source ?? "").trim();
  const logo = (props.logo ?? "").trim();
  // The motion personality for this clip's tone picks the easing
  // the kinetic reveals settle with (premium -> easeOut, playful /
  // energetic -> overshoot, corporate -> easeInOut).
  const easing = personalityForTone(tone).easing;

  const n = scenes.length;
  // v2.11: the registry move per scene (Move: / Moves: labels) and
  // the TikTok format (TikTok: label). A transition-kind move
  // overrides the scene's transitionOut for the cut after it.
  const tiktokFormat = resolveTikTokFormat(props.tiktokFormat);
  const sceneMoves = scenes.map((_, i) => sceneMoveFor(props.moves ?? [], props.move, i));
  const effectiveTransitions = scenes.map(
    (scene, i) => transitionForMove(sceneMoves[i]) ?? scene.transitionOut,
  );
  // Scene timing: hook-first fixes scene 0 at exactly 1 s; fast-cut
  // uses the uneven schedule; otherwise the beat grid / even split.
  // Weighted split (Writer stage): sceneWeightsFor returns weights
  // only when every scene carries a positive durationSec; otherwise
  // the even split, exactly as before.
  const { starts, lengths } =
    tiktokFormat === "hook-first"
      ? hookFirstStarts(durationInFrames, n, fps)
      : tiktokFormat === "fast-cut"
        ? fastCutStarts(durationInFrames, n)
        : sceneStarts(durationInFrames, n, bpm > 0 ? bpm : undefined, fps, sceneWeightsFor(scenes));
  // Duet: scenes 0+1 share the first 60% as the split; the rest
  // split the remaining 40% (hard cut at the format boundary). The
  // tail's weights follow the same rule, over the tail scenes only.
  const isDuet = tiktokFormat === "duet" && n >= 2;
  const duetFrames = Math.round(durationInFrames * 0.6);
  const tailScenes = isDuet && n > 2 ? scenes.slice(2) : [];
  const tail = tailScenes.length > 0 ? sceneStarts(durationInFrames - duetFrames, n - 2, bpm > 0 ? bpm : undefined, fps, sceneWeightsFor(tailScenes)) : { starts: [], lengths: [] };
  const tailStarts = tail.starts.map((s) => s + duetFrames);
  const tailLengths = tail.lengths;
  // Color-motion (v2.10): the frame background drifts in OKLab from
  // background toward surface across the clip (capped inside the
  // critic's palette tolerance — see tintedBackground).
  const backgroundColor = tintedBackground(palette, durationInFrames > 1 ? frame / (durationInFrames - 1) : 0);

  return (
    <AbsoluteFill style={{ backgroundColor }}>
      {/* Foreground parallax chip (v2.10, shot-composition): one
          out-of-focus chip drifting past at 1.2x, below the text. */}
      <ParallaxChip frame={frame} durationInFrames={durationInFrames} palette={palette} width={720} />
      {variant === "sweep" ? (
        <PortraitBands frame={frame} palette={palette} />
      ) : variant === "kinetic" ? (
        <MeshGradient frame={frame} palette={palette} width={720} height={1280} />
      ) : variant === "rise" ? null : (
        <>
          <PortraitDots frame={frame} palette={palette} />
          <ConstellationLines frame={frame} palette={palette} width={720} height={1280} />
        </>
      )}
      {isDuet ? (
        <>
          <Sequence from={0} durationInFrames={duetFrames} name="Duet">
            <DuetSplit
              originalWords={scenes[0].words}
              reactionWords={scenes[1].words}
              frame={frame}
              durationInFrames={duetFrames}
              fps={fps}
              palette={palette}
              fontFamily={fontFamily}
            />
          </Sequence>
          {scenes.slice(2).map((scene, j) => {
            const i = j + 2;
            return (
              <Sequence key={i} from={tailStarts[j]} durationInFrames={tailLengths[j]} name={`Scene ${i + 1}`}>
                <VScene
                  scene={scene}
                  sceneFrames={tailLengths[j]}
                  frame={frame - tailStarts[j]}
                  fps={fps}
                  palette={palette}
                  isLastScene={i === n - 1}
                  project={project}
                  subtitle={subtitle}
                  pacing={pacing}
                  variant={variant}
                  panel={panel}
                  fontFamily={fontFamily}
                  motion={motion}
                  kinetic={kinetic}
                  easing={easing}
                  logo={logo}
                  sceneMove={sceneMoves[i]}
                  prevTransition={undefined}
                  effectiveTransitionOut={effectiveTransitions[i]}
                  hookPunch={false}
                  fastCut={false}
                />
              </Sequence>
            );
          })}
        </>
      ) : (
        scenes.map((scene, i) => (
          <Sequence
            key={i}
            from={starts[i]}
            durationInFrames={lengths[i]}
            name={`Scene ${i + 1}`}
          >
            <VScene
              scene={scene}
              sceneFrames={lengths[i]}
              frame={frame - starts[i]}
              fps={fps}
              palette={palette}
              isLastScene={i === n - 1}
              project={project}
              subtitle={subtitle}
              pacing={pacing}
              variant={variant}
              panel={panel}
              fontFamily={fontFamily}
              motion={motion}
              kinetic={kinetic}
              easing={easing}
              logo={logo}
              sceneMove={sceneMoves[i]}
              prevTransition={i > 0 ? effectiveTransitions[i - 1] : undefined}
              effectiveTransitionOut={effectiveTransitions[i]}
              hookPunch={tiktokFormat === "hook-first" && i === 0}
              fastCut={tiktokFormat === "fast-cut"}
            />
          </Sequence>
        ))
      )}
      {/* Transition overlays: only wipe / zoom-cut live here now.
          Registry transitions (mask / match-cut / whip-pan /
          cross-dissolve) are in-scene geometry, and the duet
          boundary is a hard cut. */}
      {!isDuet &&
        scenes.slice(0, -1).map((scene, i) => {
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
      {/* Color-motion wash (v2.10): the OKLab grade over the scenes. */}
      <ColorMotionWash frame={frame} durationInFrames={durationInFrames} palette={palette} />
      {/* Lower-third overlay (v2.10): a Name: label straps the short. */}
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
          layout="vertical"
        />
      ) : null}
      <AccentMark variant={variant} palette={palette} />
    </AbsoluteFill>
  );
};

export const VERTICAL_DEFAULTS_EXPORT = VERTICAL_DEFAULTS;
