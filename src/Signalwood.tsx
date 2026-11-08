import React from "react";
import {
  AbsoluteFill,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const AMBER_CLAIMED = "#FFB02E";
const AMBER_UNCLAIMED = "#D97E1F";
const SERIF = "Georgia, 'Times New Roman', serif";

/**
 * Signalwood — 12 second proof clip (360 frames @ 30fps).
 * Three scenes, one still each, slow Ken Burns zoom + pulsing amber glow.
 * No price, no URL, no traffic promises.
 */

const KenBurnsImage: React.FC<{
  src: string;
  fromScale: number;
  toScale: number;
  /** Length of the scene this still plays in (frames) — drives the zoom. */
  sceneFrames: number;
  panX?: number;
  panY?: number;
}> = ({ src, fromScale, toScale, sceneFrames, panX = 0, panY = 0 }) => {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [0, sceneFrames - 1], [0, 1]);
  const scale = interpolate(progress, [0, 1], [fromScale, toScale]);
  return (
    <Img
      src={src}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "cover",
        transform: `scale(${scale}) translate(${panX * progress}%, ${
          panY * progress
        }%)`,
      }}
    />
  );
};

/** Soft radial amber glow that breathes. */
const AmberGlow: React.FC<{
  opacity: number;
  size?: string;
  left?: string;
  top?: string;
  color?: string;
}> = ({ opacity, size = "70%", left = "50%", top = "50%", color = AMBER_CLAIMED }) => {
  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        width: size,
        height: size,
        transform: "translate(-50%, -50%)",
        borderRadius: "50%",
        background: `radial-gradient(circle, ${color} 0%, transparent 65%)`,
        opacity,
        pointerEvents: "none",
      }}
    />
  );
};

const Title: React.FC<{
  children: React.ReactNode;
  opacity: number;
  fontSize?: number;
  bottom?: number;
  color?: string;
  letterSpacing?: string;
}> = ({
  children,
  opacity,
  fontSize = 64,
  bottom = 90,
  color = "#FFFFFF",
  letterSpacing,
}) => {
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom,
        textAlign: "center",
        fontFamily: SERIF,
        fontSize,
        fontWeight: 700,
        color,
        letterSpacing,
        opacity,
        textShadow: "0 2px 24px rgba(0, 0, 0, 0.75)",
      }}
    >
      {children}
    </div>
  );
};

/** Scene 1 — 0–3s: forest still, slow zoom in, title fades in. */
const SceneForest: React.FC = () => {
  const frame = useCurrentFrame();
  const titleOpacity = interpolate(frame, [15, 45], [0, 1], {
    extrapolateRight: "clamp",
  });
  const glowOpacity = interpolate(frame, [10, 50], [0, 0.35], {
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill>
      <KenBurnsImage
        src={staticFile("forest.jpg")}
        fromScale={1}
        toScale={1.12}
        sceneFrames={90}
        panY={-2}
      />
      <AmberGlow opacity={glowOpacity} size="90%" top="78%" />
      <Title opacity={titleOpacity} fontSize={96} letterSpacing="0.18em">
        SIGNALWOOD
      </Title>
    </AbsoluteFill>
  );
};

/** Scene 2 — 3–8s: cap still, pulsing amber window glow. */
const SceneCap: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // Gentle breathing pulse, one full cycle every ~2 seconds.
  const pulse = 0.45 + 0.35 * Math.sin((frame / fps) * Math.PI);
  const textOpacity = interpolate(frame, [12, 36], [0, 1], {
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill>
      <KenBurnsImage
        src={staticFile("cap.jpg")}
        fromScale={1.1}
        toScale={1}
        sceneFrames={150}
        panX={2}
      />
      {/* Amber window glow, centred where the cap's door/window sits. */}
      <AmberGlow opacity={pulse} size="42%" left="50%" top="46%" />
      <AmberGlow opacity={pulse * 0.5} size="80%" top="60%" />
      <Title opacity={textOpacity} fontSize={58} bottom={80}>
        Buy a mushroom house in a forest
      </Title>
    </AbsoluteFill>
  );
};

/** Amber node positions (percent of frame) for the network scene. */
const NODES: { left: string; top: string; claimed?: boolean }[] = [
  { left: "18%", top: "30%", claimed: true },
  { left: "32%", top: "58%" },
  { left: "45%", top: "26%" },
  { left: "55%", top: "62%" },
  { left: "66%", top: "34%" },
  { left: "78%", top: "58%" },
  { left: "86%", top: "28%" },
  { left: "50%", top: "78%" },
];

/** Scene 3 — 8–12s: network still, nodes light in sequence, end card. */
const SceneNetwork: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const textOpacity = interpolate(frame, [10, 34], [0, 1], {
    extrapolateRight: "clamp",
  });
  // End card: fades in over the last ~1.5s.
  const endCardOpacity = interpolate(frame, [72, 100], [0, 1], {
    extrapolateRight: "clamp",
  });
  const endCardScale = spring({
    frame: frame - 72,
    fps,
    config: { damping: 100 },
  });
  return (
    <AbsoluteFill>
      <KenBurnsImage
        src={staticFile("network.jpg")}
        fromScale={1}
        toScale={1.08}
        sceneFrames={120}
        panY={1}
      />
      {/* Nodes light in sequence, staggered 10 frames apart. */}
      {NODES.map((node, i) => {
        const start = 8 + i * 10;
        const opacity = interpolate(frame, [start, start + 18], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        const color = node.claimed ? AMBER_CLAIMED : AMBER_UNCLAIMED;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: node.left,
              top: node.top,
              width: 46,
              height: 46,
              transform: "translate(-50%, -50%)",
              borderRadius: "50%",
              background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
              opacity,
              pointerEvents: "none",
            }}
          />
        );
      })}
      <Title opacity={textOpacity} fontSize={54} bottom={96}>
        with a glowing network underneath.
      </Title>
      {/* Final beat — end card. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 150,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background:
            "linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 100%)",
          opacity: endCardOpacity,
          transform: `scale(${endCardScale})`,
          fontFamily: SERIF,
          fontSize: 44,
          fontWeight: 700,
          color: AMBER_CLAIMED,
          textShadow: "0 2px 18px rgba(0, 0, 0, 0.8)",
        }}
      >
        Signalwood — Claim your cap.
      </div>
    </AbsoluteFill>
  );
};

export const Signalwood: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#000000" }}>
      <Sequence from={0} durationInFrames={90} name="Forest">
        <SceneForest />
      </Sequence>
      <Sequence from={90} durationInFrames={150} name="Cap">
        <SceneCap />
      </Sequence>
      <Sequence from={240} durationInFrames={120} name="Network">
        <SceneNetwork />
      </Sequence>
    </AbsoluteFill>
  );
};
