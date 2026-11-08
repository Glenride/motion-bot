/**
 * Narrated mode — subtitle overlay.
 *
 * Ported from Automated Video Generator's remotion/SubtitleOverlay.tsx
 * (MIT), adapted for Motion Bot's 1280×720 landscape frame: default
 * font 46px (was 52px at 1080×1350 portrait), bottom position with
 * 64px padding. Renders the speech-timed cue active at the current
 * frame when captionSegments exist, else the whole-scene text.
 */

import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  interpolate,
  Easing,
  useVideoConfig,
} from "remotion";
import { activeSegmentAt, type CaptionSegment } from "./caption-cues";

export interface TextConfig {
  color?: string;
  fontSize?: number;
  position?: "top" | "center" | "bottom";
  animation?: "fade" | "slide" | "zoom" | "typewriter" | "pop";
  background?: "none" | "box" | "glass";
  glow?: boolean;
}

export type SubtitleMode = "off" | "overlay" | "burned";

export type { CaptionSegment };

interface SubtitleOverlayProps {
  /** Whole-scene fallback text used when no speech-timed segments exist. */
  text: string;
  config?: TextConfig;
  durationInFrames: number;
  delayInFrames?: number;
  /** Speech-timed caption cues (relative to scene start, ms). */
  captionSegments?: CaptionSegment[];
  /** 'off' hides captions entirely. Defaults to 'burned'. */
  subtitleMode?: SubtitleMode;
}

class SubtitleErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(" [RENDER-ERROR] SubtitleOverlay failed:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return null;
    }
    return this.props.children;
  }
}

const SubtitleInternal: React.FC<SubtitleOverlayProps> = ({
  text,
  config = {},
  durationInFrames,
  delayInFrames = 12,
  captionSegments,
  subtitleMode = "burned",
}) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();

  if (subtitleMode === "off") return null;

  const segments =
    captionSegments && captionSegments.length > 0 ? captionSegments : undefined;
  const currentTimeMs = Math.round((frame / (fps || 30)) * 1000);
  const activeSeg = segments ? activeSegmentAt(segments, currentTimeMs) : null;
  const displayText = activeSeg ? activeSeg.text : text;

  if (!displayText || typeof displayText !== "string" || displayText.trim().length === 0) {
    return null;
  }

  const {
    color = "#ffffff",
    fontSize = 46,
    position = "bottom",
    animation = "fade",
    background = "none",
    glow = false,
  } = config;

  const safeFontSize = isNaN(fontSize) || !isFinite(fontSize) ? 46 : Math.max(12, fontSize);
  const charsPerLine = 28;
  const padding = 100;

  const safeWidth = isNaN(width) || width <= 0 ? 1280 : width;
  const maxFontSize = (safeWidth - padding) / (Math.max(1, displayText.length) / 1.5);
  const finalFontSize =
    displayText.length > charsPerLine
      ? Math.max(26, Math.min(safeFontSize, maxFontSize))
      : safeFontSize;

  const ANIM_DURATION = 15;
  const outStart = Math.max(ANIM_DURATION + delayInFrames, durationInFrames - ANIM_DURATION);

  const fadeIn = interpolate(frame, [delayInFrames, delayInFrames + ANIM_DURATION], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.quad),
  });

  const fadeOut = interpolate(frame, [outStart, durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.in(Easing.quad),
  });

  const opacity = isNaN(fadeIn) || isNaN(fadeOut) ? 1 : Math.min(fadeIn, fadeOut);

  const justifyMap = {
    top: "flex-start",
    center: "center",
    bottom: "flex-end",
  } as const;

  let transform = "none";
  if (animation === "slide") {
    const slideIn = interpolate(fadeIn, [0, 1], [30, 0]);
    const slideOut = interpolate(fadeOut, [1, 0], [0, -30]);
    transform = `translateY(${slideIn + slideOut}px)`;
  } else if (animation === "zoom") {
    const scaleIn = interpolate(fadeIn, [0, 1], [0.8, 1]);
    const scaleOut = interpolate(fadeOut, [1, 0], [1, 1.1]);
    transform = `scale(${scaleIn * scaleOut})`;
  } else if (animation === "pop") {
    const scaleIn = interpolate(fadeIn, [0, 1], [0.4, 1], {
      easing: Easing.elastic(1.2),
    });
    const scaleOut = interpolate(fadeOut, [1, 0], [1, 0.8]);
    transform = `scale(${scaleIn * scaleOut})`;
  }

  let displayedText = displayText;
  if (animation === "typewriter" && !segments) {
    const charsToDisplay = Math.floor(
      interpolate(frame, [delayInFrames, delayInFrames + displayText.length * 2], [0, displayText.length], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      }),
    );
    displayedText = displayText.substring(0, charsToDisplay);
  }

  const getBackgroundStyle = (): React.CSSProperties => {
    if (background === "box") {
      return {
        backgroundColor: "rgba(0, 0, 0, 0.6)",
        padding: "12px 24px",
        borderRadius: "16px",
      };
    }
    if (background === "glass") {
      return {
        backgroundColor: "rgba(255, 255, 255, 0.15)",
        backdropFilter: "blur(10px) saturate(180%)",
        padding: "16px 32px",
        borderRadius: "24px",
        border: "1px solid rgba(255, 255, 255, 0.3)",
        boxShadow: "0 8px 32px 0 rgba(0, 0, 0, 0.3)",
      };
    }
    return {};
  };

  return (
    <AbsoluteFill
      style={{
        justifyContent: justifyMap[position] || "flex-end",
        alignItems: "center",
        padding: position === "center" ? 40 : "64px 40px",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          textAlign: "center",
          color,
          fontSize: finalFontSize,
          fontWeight: 700,
          maxWidth: "85%",
          opacity,
          transform,
          lineHeight: 1.4,
          textShadow: glow
            ? `0 0 10px ${color}, 0 0 20px ${color}88`
            : "0 2px 20px rgba(0,0,0,0.8), 0 4px 40px rgba(0,0,0,0.5)",
          letterSpacing: "-0.5px",
          fontFamily: "system-ui, -apple-system, sans-serif",
          ...getBackgroundStyle(),
          transition: "font-size 0.2s ease",
        }}
      >
        {displayedText}
      </div>
    </AbsoluteFill>
  );
};

export const SubtitleOverlay: React.FC<SubtitleOverlayProps> = (props) => (
  <SubtitleErrorBoundary>
    <SubtitleInternal {...props} />
  </SubtitleErrorBoundary>
);
