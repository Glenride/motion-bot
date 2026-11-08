import React from "react";
import { AbsoluteFill, interpolate } from "remotion";
import { SERIF, type HarnessPalette } from "./primitives";

/**
 * Harness motif library — small code-drawn motifs, no images.
 *
 * Each motif is pure divs / clip-paths in the storyboard palette, so a
 * motif always matches the colors D'Vaughn named in Mission Control.
 * Add a new motif by adding a case to MotifLayer + a keyword to the
 * Director's MOTIF_KEYWORDS (watcher/harness_director.py) — nothing
 * else needs to change.
 *
 * Library: mirror, clock, door, key, fox, tree, flame, wave, star,
 * crown, coin, window, orbit (fallback — drifting orbital rings).
 */

export type HarnessMotif = {
  type: string;
  scene: number;
  reflectionWord?: string;
  tears?: boolean;
  ticking?: boolean;
};

export const MOTIF_TYPES = [
  "mirror",
  "clock",
  "door",
  "key",
  "fox",
  "tree",
  "flame",
  "wave",
  "star",
  "crown",
  "coin",
  "window",
  "orbit",
];

const CenterBox: React.FC<{
  width: number;
  height: number;
  children: React.ReactNode;
}> = ({ width, height, children }) => (
  <AbsoluteFill
    style={{ display: "flex", alignItems: "center", justifyContent: "center" }}
  >
    <div style={{ width, height, position: "relative" }}>{children}</div>
  </AbsoluteFill>
);

/** Mirror — a code-drawn frame with a sweeping sheen and, when the
 *  hook has one, a flipped rippling reflection word (e.g. SMILING).
 *  Wraps the scene's kinetic line so the words sit inside the glass. */
export const MirrorMotif: React.FC<{
  frame: number;
  palette: HarnessPalette;
  reflectionWord?: string;
  children: React.ReactNode;
}> = ({ frame, palette, reflectionWord, children }) => {
  const sheenX = interpolate(frame, [0, 119], [-320, 1280]);
  const ripple = Math.sin(frame * 0.22) * 4;
  const skew = Math.sin(frame * 0.13) * 3;
  return (
    <AbsoluteFill
      style={{ display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <div
        style={{
          width: 1060,
          height: 480,
          borderRadius: 28,
          border: `10px solid ${palette.accent}`,
          boxShadow: `0 0 60px ${palette.accent}, inset 0 0 80px ${palette.surface}`,
          background: `linear-gradient(160deg, ${palette.surface} 0%, ${palette.background} 100%)`,
          overflow: "hidden",
          position: "relative",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
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
        {children}
        {reflectionWord ? (
          <div
            style={{
              marginTop: 10,
              fontFamily: SERIF,
              fontSize: 58,
              fontWeight: 700,
              color: palette.accentDeep,
              transform: `scaleY(-1) translateY(${ripple}px) skewX(${skew}deg)`,
              textShadow: "0 2px 18px rgba(0,0,0,0.25)",
              letterSpacing: "0.08em",
              opacity: 0.75,
            }}
          >
            {reflectionWord}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

/** Clock — a face with tick marks and hands that actually turn. */
const ClockMotif: React.FC<{ frame: number; palette: HarnessPalette; ticking?: boolean }> = ({
  frame,
  palette,
  ticking,
}) => {
  const minuteAngle = (frame * (ticking ? 2.4 : 0.6)) % 360;
  const hourAngle = (frame * 0.2) % 360;
  return (
    <CenterBox width={440} height={440}>
      <div
        style={{
          width: 440,
          height: 440,
          borderRadius: "50%",
          border: `10px solid ${palette.accent}`,
          background: `radial-gradient(circle, ${palette.background} 0%, ${palette.surface} 100%)`,
          boxShadow: `0 0 60px ${palette.accent}`,
          position: "relative",
        }}
      >
        {Array.from({ length: 12 }, (_, i) => {
          const a = (i * 30 * Math.PI) / 180;
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: 220 + Math.sin(a) * 190 - 3,
                top: 220 - Math.cos(a) * 190 - 14,
                width: 6,
                height: 28,
                backgroundColor: palette.accentDeep,
                transform: `rotate(${i * 30}deg)`,
                transformOrigin: "3px 14px",
                borderRadius: 3,
              }}
            />
          );
        })}
        <div
          style={{
            position: "absolute",
            left: 214,
            top: 60,
            width: 12,
            height: 165,
            backgroundColor: palette.text,
            transformOrigin: "6px 160px",
            transform: `rotate(${minuteAngle}deg)`,
            borderRadius: 6,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 214,
            top: 110,
            width: 12,
            height: 115,
            backgroundColor: palette.accentDeep,
            transformOrigin: "6px 110px",
            transform: `rotate(${hourAngle}deg)`,
            borderRadius: 6,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 206,
            top: 206,
            width: 28,
            height: 28,
            borderRadius: "50%",
            backgroundColor: palette.accent,
          }}
        />
      </div>
    </CenterBox>
  );
};

/** Door — a frame, a panel, a knob, and a sliver of light. */
const DoorMotif: React.FC<{ frame: number; palette: HarnessPalette }> = ({
  frame,
  palette,
}) => {
  const gap = 6 + 4 * Math.sin(frame * 0.05);
  return (
    <CenterBox width={400} height={540}>
      <div
        style={{
          width: 400,
          height: 540,
          border: `10px solid ${palette.accent}`,
          background: `linear-gradient(180deg, ${palette.surface} 0%, ${palette.background} 100%)`,
          position: "relative",
          boxShadow: `0 0 50px ${palette.accent}`,
        }}
      >
        <div
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            width: gap,
            height: "100%",
            background: palette.accent,
            opacity: 0.85,
          }}
        />
        <div
          style={{
            position: "absolute",
            right: 26,
            top: 270,
            width: 26,
            height: 26,
            borderRadius: "50%",
            backgroundColor: palette.accentDeep,
          }}
        />
      </div>
    </CenterBox>
  );
};

/** Key — bow, shaft, teeth, gently bobbing. */
const KeyMotif: React.FC<{ frame: number; palette: HarnessPalette }> = ({
  frame,
  palette,
}) => {
  const bob = Math.sin(frame * 0.06) * 10;
  return (
    <CenterBox width={560} height={220}>
      <div style={{ position: "relative", transform: `translateY(${bob}px) rotate(-12deg)` }}>
        <div
          style={{
            width: 150,
            height: 150,
            borderRadius: "50%",
            border: `16px solid ${palette.accent}`,
            display: "inline-block",
            verticalAlign: "middle",
          }}
        />
        <div
          style={{
            width: 340,
            height: 26,
            backgroundColor: palette.accent,
            display: "inline-block",
            verticalAlign: "middle",
            marginLeft: -6,
          }}
        />
        <div
          style={{
            position: "absolute",
            right: 60,
            top: 88,
            width: 26,
            height: 60,
            backgroundColor: palette.accent,
          }}
        />
        <div
          style={{
            position: "absolute",
            right: 10,
            top: 88,
            width: 26,
            height: 44,
            backgroundColor: palette.accent,
          }}
        />
      </div>
    </CenterBox>
  );
};

/** Fox — geometric face: two ears + angular muzzle, palette-driven. */
const FoxMotif: React.FC<{ frame: number; palette: HarnessPalette }> = ({
  frame,
  palette,
}) => {
  const tilt = Math.sin(frame * 0.04) * 3;
  return (
    <CenterBox width={480} height={420}>
      <div style={{ position: "relative", transform: `rotate(${tilt}deg)` }}>
        <div
          style={{
            position: "absolute",
            left: 20,
            top: 0,
            width: 0,
            height: 0,
            borderLeft: "70px solid transparent",
            borderRight: "70px solid transparent",
            borderBottom: `150px solid ${palette.accentDeep}`,
          }}
        />
        <div
          style={{
            position: "absolute",
            right: 20,
            top: 0,
            width: 0,
            height: 0,
            borderLeft: "70px solid transparent",
            borderRight: "70px solid transparent",
            borderBottom: `150px solid ${palette.accentDeep}`,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 60,
            top: 110,
            width: 360,
            height: 300,
            background: palette.accent,
            clipPath: "polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 205,
            top: 330,
            width: 70,
            height: 56,
            background: palette.surface,
            clipPath: "polygon(50% 100%, 0% 0%, 100% 0%)",
          }}
        />
      </div>
    </CenterBox>
  );
};

/** Tree — trunk + three layered canopies, swaying. */
const TreeMotif: React.FC<{ frame: number; palette: HarnessPalette }> = ({
  frame,
  palette,
}) => {
  const sway = Math.sin(frame * 0.03) * 6;
  return (
    <CenterBox width={420} height={540}>
      <div style={{ position: "relative", transform: `translateX(${sway}px)` }}>
        <div
          style={{
            position: "absolute",
            left: 190,
            top: 340,
            width: 40,
            height: 200,
            backgroundColor: palette.accentDeep,
          }}
        />
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: 60 + i * 30,
              top: 40 + i * 110,
              width: 300 - i * 60,
              height: 160,
              background: palette.accent,
              opacity: 1 - i * 0.18,
              clipPath: "polygon(50% 0%, 100% 100%, 0% 100%)",
            }}
          />
        ))}
      </div>
    </CenterBox>
  );
};

/** Flame — a flickering teardrop flame. */
const FlameMotif: React.FC<{ frame: number; palette: HarnessPalette }> = ({
  frame,
  palette,
}) => {
  const flicker = 1 + 0.12 * Math.sin(frame * 0.35) + 0.06 * Math.sin(frame * 0.9);
  return (
    <CenterBox width={300} height={420}>
      <div
        style={{
          width: 260,
          height: 380,
          margin: "0 auto",
          background: `radial-gradient(circle at 50% 70%, ${palette.accent} 0%, ${palette.accentDeep} 70%, ${palette.text} 100%)`,
          borderRadius: "50% 50% 50% 50% / 62% 62% 38% 38%",
          transform: `scaleY(${flicker})`,
          boxShadow: `0 0 80px ${palette.accent}`,
        }}
      />
    </CenterBox>
  );
};

/** Wave — three arcs rolling across the bottom of the frame. */
const WaveMotif: React.FC<{ frame: number; palette: HarnessPalette }> = ({
  frame,
  palette,
}) => (
  <AbsoluteFill style={{ overflow: "hidden", pointerEvents: "none" }}>
    {[0, 1, 2].map((i) => (
      <div
        key={i}
        style={{
          position: "absolute",
          left: -200 + Math.sin(frame * 0.02 + i * 2.1) * 60,
          bottom: 40 + i * 70,
          width: 1700,
          height: 120,
          borderRadius: "50%",
          borderTop: `8px solid ${palette.accent}`,
          opacity: 0.9 - i * 0.25,
        }}
      />
    ))}
  </AbsoluteFill>
);

/** Star — a five-point star, slowly turning, with a glow. */
const StarMotif: React.FC<{ frame: number; palette: HarnessPalette }> = ({
  frame,
  palette,
}) => (
  <CenterBox width={420} height={420}>
    <div
      style={{
        width: 400,
        height: 400,
        background: palette.accent,
        clipPath:
          "polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)",
        transform: `rotate(${Math.sin(frame * 0.02) * 12}deg)`,
        boxShadow: `0 0 60px ${palette.accent}`,
      }}
    />
  </CenterBox>
);

/** Crown — three points, palette gold by default. */
const CrownMotif: React.FC<{ frame: number; palette: HarnessPalette }> = ({
  frame,
  palette,
}) => {
  const bob = Math.sin(frame * 0.05) * 8;
  return (
    <CenterBox width={520} height={320}>
      <div
        style={{
          width: 500,
          height: 300,
          background: palette.accent,
          clipPath: "polygon(0% 100%, 0% 35%, 25% 65%, 50% 0%, 75% 65%, 100% 35%, 100% 100%)",
          transform: `translateY(${bob}px)`,
          boxShadow: `0 0 50px ${palette.accent}`,
        }}
      />
    </CenterBox>
  );
};

/** Coin — a gold disc with an inner ring and a sweeping shine. */
const CoinMotif: React.FC<{ frame: number; palette: HarnessPalette }> = ({
  frame,
  palette,
}) => {
  const shineX = interpolate(frame, [0, 119], [-200, 400]);
  return (
    <CenterBox width={380} height={380}>
      <div
        style={{
          width: 360,
          height: 360,
          borderRadius: "50%",
          border: `10px solid ${palette.accentDeep}`,
          background: `radial-gradient(circle at 35% 30%, ${palette.surface} 0%, ${palette.accent} 60%, ${palette.accentDeep} 100%)`,
          position: "relative",
          overflow: "hidden",
          boxShadow: `0 0 60px ${palette.accent}`,
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 60,
            top: 60,
            width: 240,
            height: 240,
            borderRadius: "50%",
            border: `4px solid ${palette.accentDeep}`,
            opacity: 0.7,
          }}
        />
        <div
          style={{
            position: "absolute",
            top: -20,
            left: shineX,
            width: 90,
            height: 400,
            background:
              "linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent)",
            transform: "skewX(-18deg)",
          }}
        />
      </div>
    </CenterBox>
  );
};

/** Window — four panes, light coming through. */
const WindowMotif: React.FC<{ frame: number; palette: HarnessPalette }> = ({
  frame,
  palette,
}) => {
  const glowPulse = 0.5 + 0.3 * Math.sin(frame * 0.04);
  return (
    <CenterBox width={440} height={520}>
      <div
        style={{
          width: 420,
          height: 500,
          border: `12px solid ${palette.accentDeep}`,
          background: `linear-gradient(180deg, ${palette.surface} 0%, ${palette.background} 100%)`,
          position: "relative",
          boxShadow: `0 0 50px ${palette.accent}`,
        }}
      >
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: 0,
            width: 12,
            height: "100%",
            backgroundColor: palette.accentDeep,
            transform: "translateX(-50%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: 0,
            width: "100%",
            height: 12,
            backgroundColor: palette.accentDeep,
            transform: "translateY(-50%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 30,
            background: `radial-gradient(circle at 50% 40%, ${palette.accent} 0%, transparent 70%)`,
            opacity: glowPulse,
          }}
        />
      </div>
    </CenterBox>
  );
};

/** Orbit — fallback motif: drifting orbital rings with a travelling dot. */
const OrbitMotif: React.FC<{ frame: number; palette: HarnessPalette }> = ({
  frame,
  palette,
}) => (
  <CenterBox width={560} height={560}>
    {[0, 1].map((i) => {
      const angle = frame * (0.015 + i * 0.008) + i * 2.4;
      const rx = 260 - i * 70;
      const ry = 110 - i * 28;
      return (
        <div key={i}>
          <div
            style={{
              position: "absolute",
              left: 280 - rx,
              top: 280 - ry,
              width: rx * 2,
              height: ry * 2,
              borderRadius: "50%",
              border: `3px solid ${palette.accent}`,
              opacity: 0.85 - i * 0.3,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 280 + Math.cos(angle) * rx - 10,
              top: 280 + Math.sin(angle) * ry - 10,
              width: 20,
              height: 20,
              borderRadius: "50%",
              backgroundColor: palette.accent,
              boxShadow: `0 0 16px ${palette.accent}`,
            }}
          />
        </div>
      );
    })}
  </CenterBox>
);

/** Render the motif for a scene. Mirror is special: it wraps the
 *  scene's kinetic line (the words sit inside the glass). Every other
 *  motif renders behind the line. Returns null for type "none". */
export const MotifLayer: React.FC<{
  frame: number;
  palette: HarnessPalette;
  motif: HarnessMotif;
  children?: React.ReactNode;
}> = ({ frame, palette, motif, children }) => {
  switch (motif.type) {
    case "mirror":
      return (
        <MirrorMotif frame={frame} palette={palette} reflectionWord={motif.reflectionWord}>
          {children}
        </MirrorMotif>
      );
    case "clock":
      return <ClockMotif frame={frame} palette={palette} ticking={motif.ticking} />;
    case "door":
      return <DoorMotif frame={frame} palette={palette} />;
    case "key":
      return <KeyMotif frame={frame} palette={palette} />;
    case "fox":
      return <FoxMotif frame={frame} palette={palette} />;
    case "tree":
      return <TreeMotif frame={frame} palette={palette} />;
    case "flame":
      return <FlameMotif frame={frame} palette={palette} />;
    case "wave":
      return <WaveMotif frame={frame} palette={palette} />;
    case "star":
      return <StarMotif frame={frame} palette={palette} />;
    case "crown":
      return <CrownMotif frame={frame} palette={palette} />;
    case "coin":
      return <CoinMotif frame={frame} palette={palette} />;
    case "window":
      return <WindowMotif frame={frame} palette={palette} />;
    case "orbit":
      return <OrbitMotif frame={frame} palette={palette} />;
    case "none":
      return null;
    default:
      return <OrbitMotif frame={frame} palette={palette} />;
  }
};
