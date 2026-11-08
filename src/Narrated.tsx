import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  Loop,
  OffthreadVideo,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  Easing,
} from "remotion";
import { SubtitleOverlay } from "./narrated/subtitle-overlay";
import type { NarratedStoryboard, NarratedScene } from "./narrated/types";

/**
 * Narrated — the v2 composition: stock footage + Edge-TTS voiceover
 * + burned-in speech-timed captions, 1280×720, 30fps.
 *
 * Props are an ENRICHED storyboard from src/narrated/prepare.ts
 * (scenes carry a downloaded visual, an MP3 voiceover, caption
 * segments, and an audio-driven duration). Scenes split the total
 * duration by their own durations — no even split, the voice sets
 * the pace. A stock video shorter than its scene loops; a longer
 * one is trimmed. A still image gets a slow Ken Burns push-in so no
 * scene sits dead-still.
 *
 * First scene fades in, last scene fades out (12f each); middle
 * scenes cut clean. No music in v2.0.
 */

export type NarratedProps = NarratedStoryboard;

export const NARRATED_DEFAULTS: NarratedStoryboard = {
  version: 1,
  narrated: true,
  hook: "A sample narrated clip to prove the pipeline renders.",
  lengthSeconds: 12,
  scenes: [
    {
      voiceoverText: "A sample narrated clip to prove the pipeline renders.",
      visualKeywords: ["landscape"],
      durationSeconds: 12,
      visual: null,
      audioPath: "",
      captionSegments: [
        { text: "A sample narrated clip to prove the pipeline renders.", startMs: 0, endMs: 12000 },
      ],
    },
  ],
};

const FADE_DURATION = 12; // 0.4s at 30fps
const SAFE_VIDEO_END_BUFFER_FRAMES = 3;

const Scene: React.FC<{
  scene: NarratedScene;
  sceneFrames: number;
  isFirstScene: boolean;
  isLastScene: boolean;
}> = ({ scene, sceneFrames, isFirstScene, isLastScene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const fadeIn = isFirstScene
    ? interpolate(frame, [0, FADE_DURATION], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: Easing.out(Easing.quad),
      })
    : 1;
  const fadeOut = isLastScene
    ? interpolate(frame, [sceneFrames - FADE_DURATION, sceneFrames], [1, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: Easing.in(Easing.quad),
      })
    : 1;
  const opacity = Math.min(fadeIn, fadeOut);

  const visual = scene.visual;
  const videoDurationFrames =
    visual?.type === "video" && visual.videoDuration > 0
      ? Math.floor(visual.videoDuration * fps)
      : sceneFrames;
  const trimAfter = Math.max(
    1,
    Math.min(videoDurationFrames - SAFE_VIDEO_END_BUFFER_FRAMES, sceneFrames),
  );
  const shouldLoopVideo = visual?.type === "video" && trimAfter < sceneFrames;

  // Still images drift slowly (Ken Burns push-in, 1.00 -> 1.06).
  const kenBurns = interpolate(frame, [0, sceneFrames], [1.0, 1.06], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ backgroundColor: "#0a0a0a" }}>
      {visual ? (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            opacity,
          }}
        >
          {visual.type === "video" ? (
            shouldLoopVideo ? (
              <Loop durationInFrames={trimAfter}>
                <OffthreadVideo
                  src={staticFile(visual.localPath)}
                  trimAfter={trimAfter}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  muted
                  pauseWhenBuffering
                />
              </Loop>
            ) : (
              <OffthreadVideo
                src={staticFile(visual.localPath)}
                trimAfter={trimAfter}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                muted
                pauseWhenBuffering
              />
            )
          ) : (
            <Img
              src={staticFile(visual.localPath)}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                transform: `scale(${kenBurns})`,
              }}
            />
          )}
          {/* Dark overlay for caption legibility */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              backgroundColor: "rgba(0,0,0,0.4)",
            }}
          />
        </div>
      ) : (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)",
            opacity,
          }}
        />
      )}

      <SubtitleOverlay
        text={scene.voiceoverText}
        durationInFrames={sceneFrames}
        delayInFrames={FADE_DURATION / 2}
        captionSegments={scene.captionSegments}
        subtitleMode="burned"
      />

      {scene.audioPath ? (
        <Audio src={staticFile(scene.audioPath)} volume={1.0} />
      ) : null}
    </AbsoluteFill>
  );
};

export const Narrated: React.FC<NarratedProps> = (props) => {
  const { durationInFrames } = useVideoConfig();
  const scenes =
    props.scenes && props.scenes.length > 0 ? props.scenes : NARRATED_DEFAULTS.scenes;

  // Scenes take their own audio-driven durations (seconds -> frames);
  // the last scene takes any remainder so the total is exact.
  const totalSeconds = scenes.reduce((a, s) => a + (s.durationSeconds || 3), 0);
  const starts: number[] = [];
  const lengths: number[] = [];
  let at = 0;
  scenes.forEach((s, i) => {
    starts.push(at);
    const len =
      i === scenes.length - 1
        ? durationInFrames - at
        : Math.max(30, Math.round(((s.durationSeconds || 3) / totalSeconds) * durationInFrames));
    lengths.push(len);
    at += len;
  });

  return (
    <AbsoluteFill style={{ backgroundColor: "#0a0a0a" }}>
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
            isFirstScene={i === 0}
            isLastScene={i === scenes.length - 1}
          />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
