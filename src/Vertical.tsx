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
  ScaleLine,
  SlideLines,
  StackLine,
  ZoomCut,
  rand,
  resolveFont,
  type HarnessPalette,
} from "./harness/primitives";
import {
  HARNESS_DEFAULTS,
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
}> = ({ scene, sceneFrames, frame, fps, palette, isLastScene, project, subtitle, pacing, variant, panel, fontFamily, motion }) => {
  const endOpacity =
    isLastScene && (project || subtitle)
      ? interpolate(frame, [sceneFrames * 0.7, sceneFrames * 0.85], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 0;
  const baseSize =
    variant === "kinetic"
      ? fontSizeFor(scene.words.length) + 14
      : fontSizeFor(scene.words.length);
  const gap = variant === "kinetic" ? 4 : gapFor(pacing);
  // Rise stays on for the rise variant (pre-v2.6 behavior) and for
  // the rise motion; every other motion keeps its own entry.
  const rise = motion === "rise" || variant === "rise";

  /** Render words with the clip's motion language. */
  const renderWords = (
    ws: string[],
    size: number,
    color: string,
    align: "center" | "left" = "center",
  ) => {
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

  /** End card — only on panels with room below the words (centered,
   *  card). Split / lower-third / word-stack leave it off rather
   *  than colliding with the layout. */
  const endCard =
    isLastScene && (project || subtitle) && (panel === "centered" || panel === "card") ? (
      <div style={{ opacity: endOpacity, textAlign: "center", marginTop: 40 }}>
        {project ? (
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
    const hook = words.slice(0, 2);
    const rest = words.slice(2);
    body = (
      <AbsoluteFill
        style={{
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "150px 48px 210px 48px",
        }}
      >
        <div>{renderWords(hook, baseSize + 26, palette.accent, "left")}</div>
        <div style={{ width: 140, height: 6, backgroundColor: palette.accent }} />
        {rest.length > 0 ? (
          <div>{renderWords(rest, Math.max(34, baseSize - 10), palette.text, "left")}</div>
        ) : null}
      </AbsoluteFill>
    );
  } else if (panel === "card") {
    // Words inside a bordered card on the brief's surface, offset
    // up-left from center, with the first word as a small-caps
    // kicker in the accent. The card is surface, the words are text:
    // contrast is unchanged from the centered panel.
    const kicker = words[0];
    const rest = words.slice(1);
    body = (
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          padding: "120px 48px 160px 48px",
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
    // space — the opposite of the centered panel.
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
        {renderWords(head, baseSize + 8, palette.text, "left")}
        {tail.length > 0 ? (
          <div style={{ marginTop: 14 }}>
            {renderWords(tail, 34, palette.text, "left")}
          </div>
        ) : null}
      </AbsoluteFill>
    );
  } else if (panel === "word-stack") {
    // One word per line, huge, staggered rise. The stack's motion is
    // inherent: it always uses StackLine, whatever the motion prop
    // says — the layout and the entry are the same move here.
    const stackSize =
      words.length <= 4 ? 96 : words.length <= 6 ? 80 : 64;
    body = (
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "flex-start",
          padding: "120px 48px 160px 64px",
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
    // centered — the pre-v2.6 layout, unchanged.
    body = (
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          padding: "120px 48px 160px 48px",
        }}
      >
        {renderWords(words, baseSize, palette.text)}
        {endCard}
      </AbsoluteFill>
    );
  }

  return (
    <Camera
      localFrame={frame}
      sceneFrames={sceneFrames}
      fromScale={scene.camera.fromScale}
      toScale={scene.camera.toScale}
      fromX={scene.camera.fromX}
      toX={scene.camera.toX}
    >
      {body}
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
  const variant = resolveVariant(props.variant);
  // Defaults reproduce the pre-v2.6 look exactly: centered panel,
  // serif type, kinetic words. A storyboard that sets none of these
  // renders as it did before v2.6.
  const panel = resolvePanel(props.panel);
  const fontFamily = resolveFont(props.font);
  const motion = resolveMotion(props.motion);

  const n = scenes.length;
  const base = Math.floor(durationInFrames / n);
  const starts: number[] = [];
  let at = 0;
  for (let i = 0; i < n; i++) {
    starts.push(at);
    at += i === n - 1 ? durationInFrames - at : base;
  }
  const lengths = starts.map((s, i) =>
    i === n - 1 ? durationInFrames - s : starts[i + 1] - s,
  );

  return (
    <AbsoluteFill style={{ backgroundColor: palette.background }}>
      {variant === "sweep" ? (
        <PortraitBands frame={frame} palette={palette} />
      ) : variant === "kinetic" ? (
        <AbsoluteFill style={{ backgroundColor: palette.surface }} />
      ) : variant === "rise" ? null : (
        <PortraitDots frame={frame} palette={palette} />
      )}
      {scenes.map((scene, i) => (
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
          />
        </Sequence>
      ))}
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
      <AccentMark variant={variant} palette={palette} />
    </AbsoluteFill>
  );
};

export const VERTICAL_DEFAULTS_EXPORT = VERTICAL_DEFAULTS;
