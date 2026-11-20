import React from "react";
import {
  AbsoluteFill,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  KineticLine,
  resolveFont,
  type HarnessPalette,
} from "./harness/primitives";
import {
  CrosshatchField,
  CutPaperBackdrop,
  MorphBridge,
  SketchUnderline,
  TornSheet,
} from "./harness/canvasStyles";
import { HARNESS_DEFAULTS, type HarnessScene } from "./Harness";

/**
 * CanvasStyles — the animate-canvas pack as Remotion code (v2.7),
 * 9:16 vertical. One style per piece, selected by props.style:
 *
 *   cut-paper: torn-edge layered paper sheets with offset shadows;
 *     the scene's words sit on a torn surface card.
 *   crosshatch (alias crosshatch-ink): warm-paper background, SVG
 *     hatch strokes that boil on 2s, one accent sun, sketchy
 *     underline under the words.
 *
 * The other five upstream styles (riso, sketchbook, math, pixel,
 * isometric) are NOT implemented — they are named in the router only
 * as craft notes, never as a style value. A Style: label naming one
 * of them does not route here (see watcher/harness_director).
 *
 * Story grammar from the skill: shape-morph bridges between beats
 * (MorphBridge, ~1.2s at each boundary, 3 or fewer in a short
 * piece), something new every 2–4s (each scene is its own beat),
 * colour means one thing (accent only). Words come only from the
 * storyboard scenes; the style supplies the drawing kit.
 */

export const CANVAS_STYLES = ["cut-paper", "crosshatch"] as const;
export type CanvasStyleName = (typeof CANVAS_STYLES)[number];

export const resolveCanvasStyle = (s?: string): CanvasStyleName => {
  const v = (s ?? "").toLowerCase();
  if (v === "crosshatch" || v === "crosshatch-ink" || v === "crosshatch ink") {
    return "crosshatch";
  }
  return "cut-paper";
};

export type CanvasStylesProps = {
  style?: string;
  scenes?: HarnessScene[];
  palette?: HarnessPalette;
  lengthSeconds?: number;
  project?: string;
  subtitle?: string;
};

export const CANVAS_DEFAULTS = {
  style: "cut-paper" as CanvasStyleName,
  scenes: HARNESS_DEFAULTS.scenes,
  palette: {
    background: "#D9C7A7",
    surface: "#4FC3F7",
    accent: "#0F766E",
    accentDeep: "#0A4D48",
    text: "#1F1A14",
    glow: "#0F766E",
    particle: "#0F766E",
  } as HarnessPalette,
  lengthSeconds: 12,
  project: "",
  subtitle: "",
};

const FONT = resolveFont("serif");

const CScene: React.FC<{
  scene: HarnessScene;
  frame: number;
  fps: number;
  palette: HarnessPalette;
  style: CanvasStyleName;
}> = ({ scene, frame, fps, palette, style }) => {
  const size =
    scene.words.length <= 4 ? 76 : scene.words.length <= 6 ? 64 : 54;
  if (style === "crosshatch") {
    return (
      <AbsoluteFill
        style={{
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          padding: "120px 48px 160px 48px",
        }}
      >
        <KineticLine
          words={scene.words}
          firstFrame={8}
          frame={frame}
          fps={fps}
          fontSize={size}
          color={palette.text}
          gapFrames={7}
          fontFamily={FONT}
        />
        <div style={{ marginTop: 26 }}>
          <SketchUnderline width={220} color={palette.accent} />
        </div>
      </AbsoluteFill>
    );
  }
  // cut-paper: words on a torn surface card, offset up-left, with a
  // small accent sheet peeking behind it.
  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        padding: "120px 48px 160px 48px",
      }}
    >
      <div style={{ position: "relative", width: 600, height: 460 }}>
        <TornSheet seed={61} x={26} y={18} w={560} h={420} rotate={2} fill={palette.accent} shadow={palette.accentDeep} />
        <TornSheet seed={73} x={0} y={0} w={560} h={420} rotate={-2} fill={palette.surface} shadow={palette.accentDeep} />
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: 560,
            height: 420,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            padding: 28,
            transform: "rotate(-2deg)",
          }}
        >
          <KineticLine
            words={scene.words}
            firstFrame={8}
            frame={frame}
            fps={fps}
            fontSize={Math.max(40, size - 6)}
            color={palette.text}
            gapFrames={7}
            fontFamily={FONT}
          />
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const CanvasStyles: React.FC<CanvasStylesProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const palette = { ...CANVAS_DEFAULTS.palette, ...(props.palette ?? {}) };
  const scenes =
    props.scenes && props.scenes.length > 0
      ? props.scenes
      : CANVAS_DEFAULTS.scenes;
  const style = resolveCanvasStyle(props.style);

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
      {style === "crosshatch" ? (
        <CrosshatchField frame={frame} palette={palette} />
      ) : (
        <CutPaperBackdrop frame={frame} palette={palette} />
      )}
      {scenes.map((scene, i) => (
        <Sequence
          key={i}
          from={starts[i]}
          durationInFrames={lengths[i]}
          name={`Scene ${i + 1}`}
        >
          <CScene
            scene={scene}
            frame={frame - starts[i]}
            fps={fps}
            palette={palette}
            style={style}
          />
        </Sequence>
      ))}
      {/* Shape-morph bridges at each boundary, ~1.2s (36 frames),
          centred on the cut. At most 3 in a 12s / 3-scene piece. */}
      {scenes.slice(0, -1).map((_, i) => {
        const cut = starts[i + 1];
        return (
          <Sequence
            key={`bridge${i}`}
            from={Math.max(0, cut - 18)}
            durationInFrames={36}
            name="MorphBridge"
          >
            <MorphBridge frame={frame - Math.max(0, cut - 18)} palette={palette} />
          </Sequence>
        );
      })}
      {/* Clip-level accent bar — the accent family must read in
          every sampled frame (critic palette gate). */}
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
