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

/**
 * Generic — a brief-driven composition for ANY project.
 *
 * Props come from a brief JSON (see briefs/README.md):
 *   project, hook, subtitle, lengthSeconds,
 *   colors { background, accent, text }, images [paths under public/].
 * Every field is optional — sensible defaults fill anything missing.
 *
 * Structure (fractions of the total duration, so any length works):
 *   Scene 1 (0–25%):  project name, big, on the background colour —
 *                      ONLY when a project is supplied. With no project
 *                      the hook scene runs 0–70% instead.
 *   Scene 2 (25–70%, or 0–70% with no project): hook text over an
 *                      optional image (slow Ken Burns zoom) or a plain
 *                      accent glow when no image is given.
 *   Scene 3 (70–100%): end card — project name + subtitle; with no
 *                      project, the subtitle alone, or nothing at all.
 * 1280×720, 30 fps. No price, no URL, no traffic promises.
 *
 * Motion Bot never names itself: a missing, empty, "Untitled Project",
 * or "Motion Bot" project is treated as NO project — no name is ever
 * rendered in scene 1 or on the end card.
 */

export type GenericColors = {
  background?: string;
  accent?: string;
  text?: string;
};

export type GenericProps = {
  project?: string;
  hook?: string;
  subtitle?: string;
  lengthSeconds?: number;
  colors?: GenericColors;
  images?: string[];
};

export const GENERIC_DEFAULTS: Required<
  Omit<GenericProps, "subtitle" | "images">
> & { subtitle: string; images: string[] } = {
  // No project default: an omitted project means NO project name on
  // screen (see resolveProps). Never "Untitled Project", never the
  // renderer's own name.
  project: "",
  hook: "Something worth seeing.",
  subtitle: "",
  lengthSeconds: 12,
  colors: {
    background: "#111827",
    accent: "#FFB02E",
    text: "#FFFFFF",
  },
  images: [],
};

const SERIF = "Georgia, 'Times New Roman', serif";

const resolveProps = (props: GenericProps) => {
  const colors = { ...GENERIC_DEFAULTS.colors, ...(props.colors ?? {}) };
  // Project: a missing/empty name, the old "Untitled Project" fallback,
  // or the renderer's own name ("Motion Bot", any case) all mean NO
  // project — nothing is rendered in its place.
  const rawProject = (props.project ?? "").trim();
  const projectName =
    rawProject &&
    rawProject.toLowerCase() !== "untitled project" &&
    rawProject.toLowerCase() !== "motion bot"
      ? rawProject
      : "";
  return {
    project: projectName,
    hook: props.hook ?? GENERIC_DEFAULTS.hook,
    subtitle: props.subtitle ?? "",
    lengthSeconds: props.lengthSeconds ?? GENERIC_DEFAULTS.lengthSeconds,
    colors,
    images: props.images ?? [],
  };
};

/** Soft radial accent glow that breathes. */
const Glow: React.FC<{
  opacity: number;
  color: string;
  size?: string;
  left?: string;
  top?: string;
}> = ({ opacity, color, size = "70%", left = "50%", top = "50%" }) => (
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

const CenteredText: React.FC<{
  children: React.ReactNode;
  opacity: number;
  fontSize?: number;
  color?: string;
  letterSpacing?: string;
  bottom?: number;
  maxWidth?: number;
}> = ({
  children,
  opacity,
  fontSize = 64,
  color = "#FFFFFF",
  letterSpacing,
  bottom,
  maxWidth = 1000,
}) => (
  <div
    style={{
      position: "absolute",
      left: 0,
      right: 0,
      bottom,
      display: "flex",
      justifyContent: "center",
      textAlign: "center",
      fontFamily: SERIF,
      fontSize,
      fontWeight: 700,
      color,
      letterSpacing,
      opacity,
      textShadow: "0 2px 24px rgba(0, 0, 0, 0.75)",
      padding: "0 40px",
    }}
  >
    <div style={{ maxWidth }}>{children}</div>
  </div>
);

/** Scene 1 — project name, big, fading in over the background colour. */
const SceneProject: React.FC<{
  project: string;
  colors: Required<GenericColors>;
  sceneFrames: number;
}> = ({ project, colors, sceneFrames }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [10, Math.min(40, sceneFrames - 10)], [0, 1], {
    extrapolateRight: "clamp",
  });
  const glowOpacity = interpolate(frame, [5, 40], [0, 0.3], {
    extrapolateRight: "clamp",
  });
  const barWidth = interpolate(frame, [20, 60], [0, 320], {
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ backgroundColor: colors.background }}>
      <Glow opacity={glowOpacity} color={colors.accent} size="90%" top="78%" />
      <CenteredText
        opacity={opacity}
        fontSize={96}
        color={colors.text}
        letterSpacing="0.12em"
        bottom={300}
      >
        {project.toUpperCase()}
      </CenteredText>
      {/* Accent rule under the name. */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          bottom: 270,
          width: barWidth,
          height: 6,
          transform: "translateX(-50%)",
          backgroundColor: colors.accent,
          opacity,
        }}
      />
    </AbsoluteFill>
  );
};

/** Scene 2 — hook text, over an optional image with a slow Ken Burns zoom. */
const SceneHook: React.FC<{
  hook: string;
  colors: Required<GenericColors>;
  image?: string;
  sceneFrames: number;
}> = ({ hook, colors, image, sceneFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = interpolate(frame, [0, sceneFrames - 1], [0, 1]);
  const scale = interpolate(progress, [0, 1], [1, 1.12]);
  const textOpacity = interpolate(frame, [12, 36], [0, 1], {
    extrapolateRight: "clamp",
  });
  const pulse = 0.25 + 0.15 * Math.sin((frame / fps) * Math.PI);
  return (
    <AbsoluteFill style={{ backgroundColor: colors.background }}>
      {image ? (
        <Img
          src={staticFile(image)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `scale(${scale})`,
          }}
        />
      ) : (
        <Glow opacity={pulse} color={colors.accent} size="80%" top="55%" />
      )}
      {/* Darken the image slightly so the text stays readable. */}
      {image ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(to top, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.15) 55%, transparent 100%)",
          }}
        />
      ) : null}
      <CenteredText opacity={textOpacity} fontSize={58} color={colors.text} bottom={90}>
        {hook}
      </CenteredText>
    </AbsoluteFill>
  );
};

/** Scene 3 — end card: project name + subtitle, or subtitle alone,
 *  or no text at all when neither is supplied. */
const SceneEndCard: React.FC<{
  project: string;
  subtitle: string;
  colors: Required<GenericColors>;
  sceneFrames: number;
}> = ({ project, subtitle, colors, sceneFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = interpolate(frame, [8, Math.min(32, sceneFrames - 8)], [0, 1], {
    extrapolateRight: "clamp",
  });
  const scale = spring({
    frame: frame - 8,
    fps,
    config: { damping: 100 },
  });
  return (
    <AbsoluteFill style={{ backgroundColor: colors.background }}>
      <Glow opacity={0.3} color={colors.accent} size="70%" top="50%" />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 24,
          opacity,
          transform: `scale(${scale})`,
          fontFamily: SERIF,
          textAlign: "center",
          padding: "0 60px",
        }}
      >
        {project ? (
          <div
            style={{
              fontSize: 56,
              fontWeight: 700,
              color: colors.accent,
              textShadow: "0 2px 18px rgba(0, 0, 0, 0.8)",
            }}
          >
            {project}
          </div>
        ) : null}
        {subtitle ? (
          <div
            style={{
              fontSize: 36,
              fontWeight: 400,
              color: colors.text,
              textShadow: "0 2px 18px rgba(0, 0, 0, 0.8)",
            }}
          >
            {subtitle}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

export const Generic: React.FC<GenericProps> = (props) => {
  const { durationInFrames } = useVideoConfig();
  const { project, hook, subtitle, colors, images } = resolveProps(props);
  const hasProject = project.length > 0;

  // Scene boundaries as fractions of the total duration. With no
  // project, scene 1 is skipped and the hook scene takes its time.
  const scene1Frames = hasProject ? Math.round(durationInFrames * 0.25) : 0;
  const scene2Frames = Math.round(
    durationInFrames * (hasProject ? 0.45 : 0.7),
  );
  const scene3Frames = durationInFrames - scene1Frames - scene2Frames;

  return (
    <AbsoluteFill style={{ backgroundColor: colors.background }}>
      {hasProject ? (
        <Sequence from={0} durationInFrames={scene1Frames} name="Project">
          <SceneProject project={project} colors={colors} sceneFrames={scene1Frames} />
        </Sequence>
      ) : null}
      <Sequence from={scene1Frames} durationInFrames={scene2Frames} name="Hook">
        <SceneHook
          hook={hook}
          colors={colors}
          image={images[0]}
          sceneFrames={scene2Frames}
        />
      </Sequence>
      <Sequence
        from={scene1Frames + scene2Frames}
        durationInFrames={scene3Frames}
        name="EndCard"
      >
        <SceneEndCard
          project={project}
          subtitle={subtitle}
          colors={colors}
          sceneFrames={scene3Frames}
        />
      </Sequence>
    </AbsoluteFill>
  );
};
