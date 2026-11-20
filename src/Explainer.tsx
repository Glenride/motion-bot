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

/**
 * Explainer — the explainer-video-skills pack (v2.9), 1280x720 landscape.
 *
 * One core idea per scene, build-and-hold pacing, end-card recap
 * (explainer-video skill): the VO line is the spine, visuals
 * illustrate the line being spoken, never lead it. Each idea scene
 * builds step by step, then holds >= 1s so it lands; the end card
 * holds >= 2s with one CTA.
 *
 * Three code-drawn styles, one `style` prop (Style: label, else
 * "diagram"):
 *   diagram    — diagram-animation: nodes appear first (scale +
 *                opacity, back-out), then edges draw on
 *                (stroke-dashoffset, pathLength=1), then labels.
 *                One node per idea, in idea order; the diagram is
 *                complete only on the last idea scene.
 *   whiteboard — whiteboard-animation: a code-drawn sketch line
 *                reveal. Each idea is one open stroke (circle,
 *                swoosh, arrow) drawn via stroke-dashoffset with a
 *                marker nib riding the exact tip — the tip position
 *                is computed from the same progress value that
 *                drives the dashoffset, so nib and stroke never
 *                drift. The nib lifts (fades out) between strokes
 *                and during holds; there are no fills, so no fill
 *                can precede an outline.
 *   isometric  — isometric-animation: code-drawn 2:1 dimetric
 *                blocks (axes ~26.57deg) stacked bottom-up, one
 *                block per idea, shaded top-light / left-mid /
 *                right-dark from one fixed light. No perspective
 *                shrink, no scaling to fake height — blocks rise
 *                along Y only as they appear.
 *
 * wrapped-video (same pack) is NOT a separate composition: its
 * grammar is the same build-and-hold + big-number + end-card
 * shape, and its data-driven per-row batching belongs to the
 * watcher, not a new renderer — the count-up itself already
 * lives in Chart/D3Chart (v2.8). A Wrapped-style brief (a data
 * row with a hero number) routes to Chart stats mode instead.
 *
 * Every word on screen comes from the props, which come only
 * from the task — idea titles/lines from story beats (or Idea:/
 * Step: labels), the CTA from the Cta: label else the hook.
 * No invented figures, no invented diagram: the diagram IS the
 * brief's own beats, in order. Captions are the VO line itself,
 * driven from the same timing array as the scene cuts, so they
 * never drift (<= 2 lines, on screen for the whole scene).
 *
 * Everything is a pure function of useCurrentFrame(): no CSS
 * transitions, no library timers, no Date.now(), no Math.random().
 * DriftBlobs behind + an accent progress hairline keep every
 * frame differing and the accent family visible (critic gates).
 */

export type ExplainerIdea = {
  /** Short label for the diagram node / iso block / sketch caption. */
  title: string;
  /** The VO line for this idea — one idea per scene. */
  line: string;
};

export type ExplainerStyle = "diagram" | "whiteboard" | "isometric";

export type ExplainerProps = {
  hook?: string;
  ideas?: ExplainerIdea[];
  style?: ExplainerStyle;
  /** CTA line; defaults to the hook (message-matched). */
  cta?: string;
  palette?: HarnessPalette;
  lengthSeconds?: number;
};

const SERIF = resolveFont("serif");
const SANS = resolveFont("sans");
const MONO = resolveFont("mono");

/** Task-391 proof palette — the same story + palette as the v2.8 proofs. */
export const EXPLAINER_DEFAULTS: Required<
  Omit<ExplainerProps, "palette">
> & { palette: HarnessPalette } = {
  hook: "Panels turn to face the morning",
  ideas: [
    { title: "Panels turn", line: "Panels turn to face the morning" },
    { title: "Grid wakes", line: "The grid wakes row by row" },
    { title: "Power reaches", line: "Power reaches the town by noon" },
  ],
  style: "diagram",
  cta: "Panels turn to face the morning",
  palette: {
    background: "#D9C7A7",
    surface: "#4FC3F7",
    accent: "#0F766E",
    accentDeep: "#0A4D48",
    text: "#1F1A14",
    glow: "#0F766E",
    particle: "#0F766E",
  },
  lengthSeconds: 15,
};

const clampIdeas = (ideas: ExplainerIdea[]): ExplainerIdea[] => {
  const list = (ideas ?? []).filter((i) => (i.line ?? "").trim());
  if (list.length === 0) return EXPLAINER_DEFAULTS.ideas;
  return list.slice(0, 4).map((i) => ({
    title: (i.title ?? "").trim() || i.line.trim().split(/\s+/).slice(0, 2).join(" "),
    line: i.line.trim(),
  }));
};

/** Point on a quadratic bezier — the whiteboard swoosh tip. */
const quadPoint = (
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  t: number,
): [number, number] => {
  const u = 1 - t;
  return [
    u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
    u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
  ];
};

const WordLine: React.FC<{
  words: string[];
  frame: number;
  fps: number;
  fontSize: number;
  color: string;
  font: string;
}> = ({ words, frame, fps, fontSize, color, font }) => (
  <div
    style={{
      display: "flex",
      flexWrap: "wrap",
      justifyContent: "center",
      gap: "0.28em",
      fontFamily: font,
      fontSize,
      fontWeight: 700,
      lineHeight: 1.15,
      color,
      textAlign: "center",
      maxWidth: 1080,
    }}
  >
    {words.map((w, i) => {
      const p = spring({
        frame: frame - i * 4,
        fps,
        config: { damping: 200 },
      });
      return (
        <span
          key={i}
          style={{
            display: "inline-block",
            opacity: p,
            transform: `translateY(${interpolate(p, [0, 1], [22, 0])}px)`,
          }}
        >
          {w}
        </span>
      );
    })}
  </div>
);

/**
 * One iso block. baseY is the bottom edge (lowest point of the
 * side faces); the block spans baseY - (h + 2*hh) .. baseY, so a
 * stack of n blocks fits when n * (h + 2*hh) <= the SVG height.
 * Shading: top lightest, left mid, right darkest — one fixed light.
 */
const IsoBlock: React.FC<{
  cx: number;
  baseY: number;
  w: number;
  h: number;
  palette: HarnessPalette;
  appear: number;
}> = ({ cx, baseY, w, h, palette, appear }) => {
  const hw = w / 2;
  const hh = w / 4; // 2:1 dimetric — axes at atan(0.5) ~ 26.57deg
  const y0 = baseY - h - 2 * hh; // top vertex of the top face
  const lift = interpolate(appear, [0, 1], [46, 0]);
  return (
    <g opacity={appear} transform={`translate(0 ${lift})`}>
      {/* top face — lightest */}
      <polygon
        points={`${cx},${y0} ${cx + hw},${y0 + hh} ${cx},${y0 + 2 * hh} ${cx - hw},${y0 + hh}`}
        fill={palette.surface}
        stroke={palette.accentDeep}
        strokeWidth={2}
      />
      {/* left face — mid */}
      <polygon
        points={`${cx - hw},${y0 + hh} ${cx},${y0 + 2 * hh} ${cx},${y0 + 2 * hh + h} ${cx - hw},${y0 + hh + h}`}
        fill={palette.accent}
        stroke={palette.accentDeep}
        strokeWidth={2}
      />
      {/* right face — darkest */}
      <polygon
        points={`${cx + hw},${y0 + hh} ${cx},${y0 + 2 * hh} ${cx},${y0 + 2 * hh + h} ${cx + hw},${y0 + hh + h}`}
        fill={palette.accentDeep}
        stroke={palette.accentDeep}
        strokeWidth={2}
      />
    </g>
  );
};

/** Whiteboard sketch strokes, one per idea, drawn in order. Each
 *  occupies its own region of the 1080x380 board so the board
 *  accumulates without overlap. */
const SKETCH: {
  path: string;
  tip: (t: number) => [number, number];
}[] = [
  {
    // Idea 1: a circle (the morning sun) at the left.
    path: "M 320 110 a 80 80 0 1 1 -0.1 0",
    tip: (t) => {
      const a = -Math.PI / 2 + t * Math.PI * 2;
      return [320 + 80 * Math.cos(a), 190 + 80 * Math.sin(a)];
    },
  },
  {
    // Idea 2: a swoosh underline across the bottom.
    path: "M 240 320 Q 540 380 840 320",
    tip: (t) => quadPoint([240, 320], [540, 380], [840, 320], t),
  },
  {
    // Idea 3: an arrow (power reaching the town) at the right.
    path: "M 620 190 L 960 190 M 960 190 L 890 155 M 960 190 L 890 225",
    tip: (t) => {
      if (t < 0.8) {
        const k = t / 0.8;
        return [620 + 340 * k, 190];
      }
      const k = (t - 0.8) / 0.2;
      return [960 - 70 * k, 190 - 35 * k];
    },
  },
];

export const Explainer: React.FC<ExplainerProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const palette = { ...HARNESS_DEFAULTS.palette, ...(props.palette ?? {}) };
  const ideas = clampIdeas(props.ideas);
  const style: ExplainerStyle =
    props.style === "whiteboard" || props.style === "isometric"
      ? props.style
      : "diagram";
  const hook = (props.hook ?? "").trim() || EXPLAINER_DEFAULTS.hook;
  const cta = (props.cta ?? "").trim() || hook;

  // Timing: end card holds >= 2s; each idea builds, then holds >= 1s.
  const endFrames = Math.max(60, Math.round(durationInFrames * 0.2));
  const ideaFrames = Math.max(
    60,
    Math.floor((durationInFrames - endFrames) / ideas.length),
  );
  const endStart = ideaFrames * ideas.length;
  const sceneIdx = Math.min(ideas.length, Math.floor(frame / ideaFrames));
  const inEndCard = frame >= endStart;
  const sceneFrame = inEndCard ? frame - endStart : frame - sceneIdx * ideaFrames;
  const idea = ideas[Math.min(sceneIdx, ideas.length - 1)];

  // Build progress within the current idea scene: 0 -> 1 over the
  // first half, then the hold. Words stagger across the first frames.
  const build = interpolate(sceneFrame, [0, ideaFrames * 0.5], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const progress = interpolate(frame, [0, durationInFrames - 1], [0, 1]);

  return (
    <AbsoluteFill
      style={{
        // Solid background, not a gradient: a bg->surface gradient
        // spends most of its pixels blended within tolerance of
        // neither color and drops the light field to 42-52% (critic
        // FAIL, measured on the first v2.9 proof renders). Solid
        // background + solid-surface DriftBlobs is the v2.8 pattern
        // (Chart/ProductDemo) and holds the light field >90%.
        backgroundColor: palette.background,
        fontFamily: SANS,
        color: palette.text,
        overflow: "hidden",
      }}
    >
      <DriftBlobs frame={frame} palette={palette} />
      {/* Accent progress hairline — accent present at clip level in every style. */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          height: 10,
          width: `${progress * 100}%`,
          backgroundColor: palette.accent,
          zIndex: 3,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 26,
          left: 0,
          right: 0,
          textAlign: "center",
          fontFamily: MONO,
          fontSize: 24,
          letterSpacing: 3,
          color: palette.accentDeep,
          zIndex: 2,
        }}
      >
        {inEndCard ? "RECAP" : `IDEA ${sceneIdx + 1} OF ${ideas.length}`}
      </div>

      {inEndCard ? (
        /* End-card recap: every idea restated + one CTA, held still. */
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 2,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 18,
          }}
        >
          <div
            style={{
              fontFamily: SERIF,
              fontSize: 54,
              fontWeight: 700,
              color: palette.text,
              textAlign: "center",
            }}
          >
            {hook}
          </div>
          {ideas.map((it, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                fontFamily: SANS,
                fontSize: 30,
                color: palette.text,
              }}
            >
              <span
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: "50%",
                  backgroundColor: palette.accent,
                  color: palette.background,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 20,
                  fontWeight: 700,
                }}
              >
                {i + 1}
              </span>
              {it.line}
            </div>
          ))}
          <div
            style={{
              marginTop: 12,
              fontFamily: MONO,
              fontSize: 28,
              color: palette.accent,
              border: `3px solid ${palette.accent}`,
              borderRadius: 8,
              padding: "10px 22px",
            }}
          >
            {cta}
          </div>
        </div>
      ) : (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 2,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "flex-start",
            paddingTop: 78,
          }}
        >
          <WordLine
            words={idea.line.split(/\s+/)}
            frame={sceneFrame}
            fps={fps}
            fontSize={52}
            color={palette.text}
            font={SERIF}
          />
          <div
            style={{
              marginTop: 14,
              fontFamily: MONO,
              fontSize: 22,
              color: palette.accentDeep,
            }}
          >
            {idea.title}
          </div>

          {style === "diagram" && (
            <svg
              width={1080}
              height={380}
              viewBox="0 0 1080 380"
              style={{ marginTop: 18 }}
            >
              {/* Edges draw during the scene of their far node, after
                  that node appears (nodes -> edges -> labels). */}
              {ideas.slice(0, ideas.length - 1).map((_, e) => {
                const p =
                  sceneIdx > e + 1 ? 1 : sceneIdx === e + 1 ? build : 0;
                const x1 = (1080 * (e + 0.5)) / ideas.length;
                const x2 = (1080 * (e + 1.5)) / ideas.length;
                return (
                  <line
                    key={e}
                    x1={x1 + 62}
                    y1={150}
                    x2={x2 - 62}
                    y2={150}
                    stroke={palette.accentDeep}
                    strokeWidth={6}
                    pathLength={1}
                    strokeDasharray={1}
                    strokeDashoffset={1 - p}
                  />
                );
              })}
              {ideas.map((it, i) => {
                const cx = (1080 * (i + 0.5)) / ideas.length;
                const nodeFrame = i < sceneIdx ? 1000 : i === sceneIdx ? sceneFrame : -100;
                const shown = Math.max(
                  0,
                  Math.min(
                    1,
                    spring({ frame: nodeFrame, fps, config: { damping: 200 } }),
                  ),
                );
                const active = i === sceneIdx;
                return (
                  <g
                    key={i}
                    opacity={active ? shown : shown * 0.55}
                    transform={`translate(${cx} 150) scale(${interpolate(shown, [0, 1], [0.8, 1])})`}
                  >
                    <circle r={62} fill={palette.accent} stroke={palette.accentDeep} strokeWidth={3} />
                    <text
                      y={12}
                      textAnchor="middle"
                      fontSize={44}
                      fontWeight={700}
                      fill={palette.background}
                      fontFamily={SANS}
                    >
                      {i + 1}
                    </text>
                    <text
                      y={108}
                      textAnchor="middle"
                      fontSize={26}
                      fontWeight={700}
                      fill={palette.text}
                      fontFamily={SANS}
                    >
                      {it.title}
                    </text>
                  </g>
                );
              })}
            </svg>
          )}

          {style === "whiteboard" && (
            <svg
              width={1080}
              height={380}
              viewBox="0 0 1080 380"
              style={{ marginTop: 6 }}
            >
              {SKETCH.slice(0, ideas.length).map((s, i) => {
                const isCurrent = i === sceneIdx;
                const done = i < sceneIdx;
                // This stroke draws across the build half of its scene;
                // earlier strokes stay complete, later ones invisible.
                const p = done ? 1 : isCurrent ? build : 0;
                const [tx, ty] = s.tip(p);
                const nibVisible = isCurrent && p > 0 && p < 1;
                return (
                  <g key={i}>
                    <path
                      d={s.path}
                      fill="none"
                      stroke={palette.accentDeep}
                      strokeWidth={7}
                      strokeLinecap="round"
                      pathLength={1}
                      strokeDasharray={1}
                      strokeDashoffset={1 - p}
                    />
                    {nibVisible && (
                      <g transform={`translate(${tx} ${ty})`}>
                        <polygon points="0,-26 14,4 -14,4" fill={palette.accent} />
                        <circle r={9} fill={palette.accent} />
                      </g>
                    )}
                  </g>
                );
              })}
            </svg>
          )}

          {style === "isometric" && (
            <svg
              width={1080}
              height={380}
              viewBox="0 0 1080 380"
              style={{ marginTop: 18 }}
            >
              {ideas.map((it, i) => {
                // Stack bottom-up: idea 1 is the base; each later block
                // sits on the previous block's top. Unit height
                // h + 2*hh = 116 at full size; scaled down so 4 ideas
                // still fit the 380px board (4 * 87 = 348 <= 380).
                const scale = Math.min(1, 348 / (ideas.length * 116));
                const unit = 116 * scale;
                const baseY = 360 - i * unit;
                const appear = spring({
                  frame: i < sceneIdx ? 1000 : i === sceneIdx ? sceneFrame : -100,
                  fps,
                  config: { damping: 200 },
                });
                const shown = Math.max(0, Math.min(1, appear));
                return (
                  <g key={i}>
                    <IsoBlock
                      cx={430}
                      baseY={baseY}
                      w={160 * scale}
                      h={36 * scale}
                      palette={palette}
                      appear={shown}
                    />
                    <text
                      x={540}
                      y={baseY - unit / 2 + 9}
                      fontSize={26}
                      fontWeight={700}
                      fill={palette.text}
                      fontFamily={SANS}
                      opacity={shown}
                    >
                      {i + 1}. {it.title}
                    </text>
                  </g>
                );
              })}
            </svg>
          )}
        </div>
      )}

      {/* Caption strip: the VO line, from the same timing array as the
          scene cuts — <= 2 lines, on screen for the whole scene. */}
      <div
        style={{
          position: "absolute",
          bottom: 26,
          left: 0,
          right: 0,
          textAlign: "center",
          fontFamily: SANS,
          fontSize: 26,
          color: palette.text,
          zIndex: 2,
        }}
      >
        {inEndCard ? cta : idea.line}
      </div>
    </AbsoluteFill>
  );
};
