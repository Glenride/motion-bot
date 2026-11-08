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
  ZoomCut,
  rand,
  SERIF,
  type HarnessPalette,
} from "./harness/primitives";
import {
  HARNESS_DEFAULTS,
  type HarnessProps,
  type HarnessScene,
} from "./Harness";

/**
 * Vertical — the 9:16 short-form composition (720x1280), v2.2.
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
 */

const VERTICAL_DEFAULTS = {
  ...HARNESS_DEFAULTS,
  lengthSeconds: 12,
};

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
}> = ({ scene, sceneFrames, frame, fps, palette, isLastScene, project, subtitle, pacing }) => {
  const endOpacity =
    isLastScene && (project || subtitle)
      ? interpolate(frame, [sceneFrames * 0.7, sceneFrames * 0.85], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 0;
  return (
    <Camera
      localFrame={frame}
      sceneFrames={sceneFrames}
      fromScale={scene.camera.fromScale}
      toScale={scene.camera.toScale}
      fromX={scene.camera.fromX}
      toX={scene.camera.toX}
    >
      <AbsoluteFill
        style={{
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
          fontSize={fontSizeFor(scene.words.length)}
          color={palette.text}
          gapFrames={gapFor(pacing)}
        />
        {isLastScene && (project || subtitle) ? (
          <div style={{ opacity: endOpacity, textAlign: "center", marginTop: 40 }}>
            {project ? (
              <div
                style={{
                  fontFamily: SERIF,
                  fontSize: 40,
                  fontWeight: 700,
                  color: palette.accent,
                }}
              >
                {project}
              </div>
            ) : null}
            {subtitle ? (
              <div style={{ fontFamily: SERIF, fontSize: 28, color: palette.text }}>
                {subtitle}
              </div>
            ) : null}
          </div>
        ) : null}
      </AbsoluteFill>
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
      <PortraitDots frame={frame} palette={palette} />
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
    </AbsoluteFill>
  );
};

export const VERTICAL_DEFAULTS_EXPORT = VERTICAL_DEFAULTS;
