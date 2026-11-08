import React from "react";
import {
  AbsoluteFill,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/**
 * MotionTest — a REAL motion-graphics prototype (12s, 360 frames @ 30fps).
 *
 * NOT a slideshow. Everything moves every frame, all in code:
 *  - Kinetic typography: words enter one at a time, each sliding /
 *    scaling / rotating into place with a spring — never one static block.
 *  - Animated background: a two-colour gradient whose angle and hue drift
 *    every frame, plus ~40 drifting particles that never sit still.
 *  - Camera moves: a slow zoom + lateral drift that CHANGES DIRECTION
 *    between scenes (push in, pull back, push in again).
 *  - Real transitions: a diagonal wipe at 4s and a zoom-cut at 8s —
 *    no plain crossfades.
 *  - Mirror motif for the hook: a code-drawn mirror frame with a sheen
 *    sweeping across it, the word SMILING shown as a flipped, rippling
 *    reflection, and falling teardrops in the final scene.
 *
 * No external images, no video files, no project name, no "Motion Bot".
 * Test copy is the task-161 hook.
 */

export type MotionTestProps = {
  hook?: string;
};

const DEFAULT_HOOK =
  "Every mirror in your house shows you smiling, except when you turn your back — that's when it starts to cry.";

const SERIF = "Georgia, 'Times New Roman', serif";

/** Deterministic pseudo-random from a seed — stable across frames. */
const rand = (seed: number) => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** One drifting particle. Position is a pure function of the frame. */
const Particle: React.FC<{ seed: number; frame: number }> = ({ seed, frame }) => {
  const x0 = rand(seed) * 1280;
  const y0 = rand(seed + 50) * 720;
  const size = 2 + rand(seed + 90) * 5;
  const speed = 0.4 + rand(seed + 130) * 1.1;
  const sway = Math.sin(frame * 0.02 + seed * 2.1) * 34;
  const y = (y0 + frame * speed) % 760 - 20;
  const x = x0 + sway;
  const opacity = 0.25 + 0.45 * (0.5 + 0.5 * Math.sin(frame * 0.05 + seed * 3.3));
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: size,
        height: size,
        borderRadius: "50%",
        backgroundColor: "#BFE3FF",
        opacity,
        boxShadow: "0 0 12px rgba(160, 210, 255, 0.9)",
      }}
    />
  );
};

/** Background that changes every frame: rotating gradient + particles. */
const MovingBackground: React.FC<{
  frame: number;
  hueA: number;
  hueB: number;
}> = ({ frame, hueA, hueB }) => {
  const angle = 115 + frame * 0.35; // gradient rotates ~126deg over the clip
  const shift = Math.sin(frame * 0.015) * 18; // hue/position breathing
  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(${angle}deg, hsl(${hueA + shift}, 55%, 12%) 0%, hsl(${hueB - shift}, 60%, 24%) 55%, hsl(${hueA}, 50%, 8%) 100%)`,
      }}
    >
      {Array.from({ length: 42 }, (_, i) => (
        <Particle key={i} seed={i + 1} frame={frame} />
      ))}
    </AbsoluteFill>
  );
};

/** A word that springs into place with slide + scale + rotation. */
const KineticWord: React.FC<{
  word: string;
  startFrame: number;
  frame: number;
  fps: number;
  fontSize: number;
  color: string;
  fromX: number;
  rotate: number;
}> = ({ word, startFrame, frame, fps, fontSize, color, fromX, rotate }) => {
  const progress = spring({
    frame: frame - startFrame,
    fps,
    config: { damping: 14, stiffness: 180 },
  });
  const opacity = interpolate(frame - startFrame, [0, 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const x = interpolate(progress, [0, 1], [fromX, 0]);
  const scale = interpolate(progress, [0, 1], [0.7, 1]);
  const rot = interpolate(progress, [0, 1], [rotate, 0]);
  return (
    <span
      style={{
        display: "inline-block",
        opacity,
        transform: `translateX(${x}px) scale(${scale}) rotate(${rot}deg)`,
        fontSize,
        fontWeight: 700,
        color,
        textShadow: "0 4px 28px rgba(0,0,0,0.8)",
        margin: "0 10px",
        whiteSpace: "nowrap",
      }}
    >
      {word}
    </span>
  );
};

/** A line of kinetic words, staggered, wrapping naturally. */
const KineticLine: React.FC<{
  words: string[];
  firstFrame: number;
  frame: number;
  fps: number;
  fontSize: number;
  color?: string;
  gapFrames?: number;
}> = ({ words, firstFrame, frame, fps, fontSize, color = "#FFFFFF", gapFrames = 7 }) => (
  <div
    style={{
      display: "flex",
      flexWrap: "wrap",
      justifyContent: "center",
      alignItems: "center",
      fontFamily: SERIF,
      lineHeight: 1.25,
      textAlign: "center",
      padding: "0 70px",
    }}
  >
    {words.map((w, i) => (
      <KineticWord
        key={`${w}-${i}`}
        word={w}
        startFrame={firstFrame + i * gapFrames}
        frame={frame}
        fps={fps}
        fontSize={fontSize}
        color={color}
        fromX={i % 2 === 0 ? -90 : 90}
        rotate={i % 2 === 0 ? -7 : 7}
      />
    ))}
  </div>
);

/** Camera wrapper: scale + lateral drift driven by the local frame. */
const Camera: React.FC<{
  localFrame: number;
  sceneFrames: number;
  fromScale: number;
  toScale: number;
  fromX: number;
  toX: number;
  children: React.ReactNode;
}> = ({ localFrame, sceneFrames, fromScale, toScale, fromX, toX, children }) => {
  const progress = interpolate(localFrame, [0, sceneFrames - 1], [0, 1]);
  const scale = interpolate(progress, [0, 1], [fromScale, toScale]);
  const x = interpolate(progress, [0, 1], [fromX, toX]);
  return (
    <AbsoluteFill style={{ transform: `scale(${scale}) translateX(${x}px)` }}>
      {children}
    </AbsoluteFill>
  );
};

/** Scene 1 (0–4s): "Every mirror in your house" — push in, words cascade. */
const SceneMirror: React.FC<{ frame: number; fps: number }> = ({ frame, fps }) => (
  <Camera
    localFrame={frame}
    sceneFrames={120}
    fromScale={1}
    toScale={1.08}
    fromX={0}
    toX={-26}
  >
    <MovingBackground frame={frame} hueA={222} hueB={262} />
    <AbsoluteFill
      style={{ display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <KineticLine
        words={["Every", "mirror", "in", "your", "house"]}
        firstFrame={8}
        frame={frame}
        fps={fps}
        fontSize={84}
      />
    </AbsoluteFill>
  </Camera>
);

/** Scene 2 (4–8s): the mirror — sheen sweeps, SMILING as a rippling reflection. */
const SceneReflection: React.FC<{ frame: number; fps: number }> = ({ frame, fps }) => {
  // Sheen band sweeps left → right across the mirror, every frame a new x.
  const sheenX = interpolate(frame, [0, 119], [-320, 1280]);
  // The reflection ripples: vertical wobble + slight skew, always moving.
  const ripple = Math.sin(frame * 0.22) * 4;
  const skew = Math.sin(frame * 0.13) * 3;
  return (
    <Camera
      localFrame={frame}
      sceneFrames={120}
      fromScale={1.08}
      toScale={1.0}
      fromX={-26}
      toX={22}
    >
      <MovingBackground frame={frame + 120} hueA={200} hueB={240} />
      {/* Code-drawn mirror frame */}
      <AbsoluteFill
        style={{ display: "flex", alignItems: "center", justifyContent: "center" }}
      >
        <div
          style={{
            width: 1020,
            height: 460,
            borderRadius: 28,
            border: "10px solid rgba(200, 225, 255, 0.85)",
            boxShadow:
              "0 0 60px rgba(140, 190, 255, 0.55), inset 0 0 80px rgba(120, 170, 255, 0.35)",
            background:
              "linear-gradient(160deg, rgba(90,140,200,0.35) 0%, rgba(20,40,80,0.55) 100%)",
            overflow: "hidden",
            position: "relative",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {/* Sweeping sheen */}
          <div
            style={{
              position: "absolute",
              top: -40,
              left: sheenX,
              width: 180,
              height: 560,
              background:
                "linear-gradient(90deg, transparent, rgba(255,255,255,0.45), transparent)",
              transform: "skewX(-18deg)",
              pointerEvents: "none",
            }}
          />
          <KineticLine
            words={["shows", "you", "smiling,"]}
            firstFrame={6}
            frame={frame}
            fps={fps}
            fontSize={76}
          />
          {/* Flipped, rippling reflection of SMILING */}
          <div
            style={{
              marginTop: 6,
              fontFamily: SERIF,
              fontSize: 64,
              fontWeight: 700,
              color: "rgba(190, 220, 255, 0.55)",
              transform: `scaleY(-1) translateY(${ripple}px) skewX(${skew}deg)`,
              textShadow: "0 2px 18px rgba(0,0,0,0.6)",
              letterSpacing: "0.08em",
            }}
          >
            SMILING
          </div>
          <div
            style={{
              marginTop: 18,
              fontFamily: SERIF,
              fontSize: 34,
              color: "#DCEEFF",
              opacity: interpolate(frame, [55, 75], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
            }}
          >
            except when you turn your back
          </div>
        </div>
      </AbsoluteFill>
    </Camera>
  );
};

/** One falling teardrop — y and opacity are pure functions of the frame. */
const Teardrop: React.FC<{ seed: number; frame: number }> = ({ seed, frame }) => {
  const x = 140 + rand(seed) * 1000;
  const speed = 2.2 + rand(seed + 40) * 2.4;
  const size = 10 + rand(seed + 80) * 14;
  const delay = rand(seed + 120) * 60;
  const local = frame - delay;
  if (local < 0) return null;
  const y = (local * speed) % 760 - 30;
  const opacity = interpolate(local % 120, [0, 15, 100, 119], [0, 0.9, 0.9, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: size,
        height: size * 1.5,
        borderRadius: "50% 50% 50% 50% / 60% 60% 40% 40%",
        background:
          "radial-gradient(circle at 35% 30%, #CFE8FF 0%, #5EA8E8 55%, #2A6DB0 100%)",
        opacity,
        transform: `rotate(${Math.sin(frame * 0.05 + seed) * 8}deg)`,
        boxShadow: "0 0 14px rgba(120, 180, 255, 0.8)",
      }}
    />
  );
};

/** Scene 3 (8–12s): "that's when it starts to cry." — zoom in, tears fall. */
const SceneCry: React.FC<{ frame: number; fps: number }> = ({ frame, fps }) => {
  // Expanding ripple rings from the centre, one every 30 frames.
  const rings = [0, 1, 2].map((i) => {
    const local = (frame + i * 40) % 120;
    const r = interpolate(local, [0, 119], [40, 620]);
    const opacity = interpolate(local, [0, 119], [0.55, 0]);
    return (
      <div
        key={i}
        style={{
          position: "absolute",
          left: "50%",
          top: "52%",
          width: r,
          height: r * 0.55,
          transform: "translate(-50%, -50%)",
          borderRadius: "50%",
          border: "2px solid rgba(150, 200, 255, 0.8)",
          opacity,
        }}
      />
    );
  });
  return (
    <Camera
      localFrame={frame}
      sceneFrames={120}
      fromScale={1.0}
      toScale={1.14}
      fromX={22}
      toX={0}
    >
      <MovingBackground frame={frame + 240} hueA={212} hueB={228} />
      {rings}
      {Array.from({ length: 14 }, (_, i) => (
        <Teardrop key={i} seed={i + 1} frame={frame} />
      ))}
      <AbsoluteFill
        style={{ display: "flex", alignItems: "center", justifyContent: "center" }}
      >
        <KineticLine
          words={["that's", "when", "it", "starts", "to", "cry."]}
          firstFrame={2}
          frame={frame}
          fps={fps}
          fontSize={80}
          color="#EAF4FF"
          gapFrames={8}
        />
      </AbsoluteFill>
    </Camera>
  );
};

/** Diagonal wipe transition overlay (scene 2 entry). */
const DiagonalWipe: React.FC<{ frame: number }> = ({ frame }) => {
  // A dark panel with a bright edge sweeps diagonally across in ~14 frames.
  const x = interpolate(frame, [0, 14], [-900, 1400], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ overflow: "hidden", pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          top: -200,
          left: x,
          width: 700,
          height: 1120,
          background: "#0A1428",
          transform: "skewX(-24deg)",
          boxShadow: "12px 0 40px rgba(120, 180, 255, 0.7)",
        }}
      />
    </AbsoluteFill>
  );
};

/** Zoom-cut transition overlay (scene 3 entry): a fast scale punch.
 *  Kept short and translucent so the cut never lands on a dead frame. */
const ZoomCut: React.FC<{ frame: number }> = ({ frame }) => {
  const scale = interpolate(frame, [0, 5, 10], [1.3, 1.05, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const opacity = interpolate(frame, [0, 10], [0.45, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#04070F",
        opacity,
        transform: `scale(${scale})`,
        pointerEvents: "none",
      }}
    />
  );
};

export const MotionTest: React.FC<MotionTestProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const hook = props.hook ?? DEFAULT_HOOK;
  void hook; // scenes carry the copy verbatim; hook prop kept for brief parity

  return (
    <AbsoluteFill style={{ backgroundColor: "#0A1428" }}>
      <Sequence from={0} durationInFrames={120} name="Mirror">
        <SceneMirror frame={frame} fps={fps} />
      </Sequence>
      <Sequence from={120} durationInFrames={120} name="Reflection">
        <SceneReflection frame={frame - 120} fps={fps} />
      </Sequence>
      {/* Diagonal wipe rides over the 4s cut */}
      <Sequence from={116} durationInFrames={18} name="Wipe">
        <DiagonalWipe frame={frame - 116} />
      </Sequence>
      <Sequence from={240} durationInFrames={120} name="Cry">
        <SceneCry frame={frame - 240} fps={fps} />
      </Sequence>
      {/* Zoom-cut punch over the 8s cut */}
      <Sequence from={238} durationInFrames={14} name="ZoomCut">
        <ZoomCut frame={frame - 238} />
      </Sequence>
    </AbsoluteFill>
  );
};
