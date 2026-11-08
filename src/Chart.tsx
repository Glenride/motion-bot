import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { SERIF, type HarnessPalette } from "./harness/primitives";
import { HARNESS_DEFAULTS } from "./Harness";

/**
 * Chart — the data rung (v2.3, data-animation-skills).
 *
 * Props are a storyboard JSON: hook (chart title), palette, bars
 * [{label, value}], lengthSeconds. Bars grow from the baseline with
 * a spring, the value counts up alongside, and the largest bar is
 * the accent color — the chart-animation rule: animate the value,
 * never the axis away from the data. Numbers come only from the
 * task's data rows; nothing is invented or rounded away (values
 * display as given, integers without decimals).
 */

export type ChartBar = { label: string; value: number };

export type ChartProps = {
  hook?: string;
  lengthSeconds?: number;
  palette?: HarnessPalette;
  bars?: ChartBar[];
  project?: string;
};

const fmt = (v: number) =>
  Number.isInteger(v) ? v.toLocaleString("en-US") : v.toLocaleString("en-US");

export const Chart: React.FC<ChartProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const palette = { ...HARNESS_DEFAULTS.palette, ...(props.palette ?? {}) };
  const bars = props.bars && props.bars.length > 0 ? props.bars : [{ label: "—", value: 1 }];
  const max = Math.max(...bars.map((b) => b.value), 1);
  const title = props.hook ?? "";
  const n = bars.length;
  // Bars stagger in over the first half; values count up with them.
  const barAreaHeight = 460;
  const chartWidth = 1040;
  const gap = 28;
  const barWidth = Math.min(140, (chartWidth - gap * (n - 1)) / n);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: palette.background,
        padding: "70px 120px 90px 120px",
        fontFamily: SERIF,
      }}
    >
      {title ? (
        <div
          style={{
            fontSize: 52,
            fontWeight: 700,
            color: palette.text,
            textAlign: "center",
            marginBottom: 20,
          }}
        >
          {title}
        </div>
      ) : null}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "center",
          gap,
          height: barAreaHeight,
          marginTop: "auto",
        }}
      >
        {bars.map((bar, i) => {
          const start = 10 + i * 12;
          const progress = spring({ frame: frame - start, fps, config: { damping: 16, stiffness: 120 } });
          const clamped = Math.max(0, Math.min(1, progress));
          const height = (bar.value / max) * barAreaHeight * clamped;
          const shown = Math.round(bar.value * clamped);
          const isMax = bar.value === max;
          return (
            <div key={bar.label} style={{ display: "flex", flexDirection: "column", alignItems: "center", width: barWidth }}>
              <div
                style={{
                  fontSize: 34,
                  fontWeight: 700,
                  color: isMax ? palette.accent : palette.text,
                  marginBottom: 10,
                  opacity: clamped > 0 ? 1 : 0,
                }}
              >
                {fmt(shown)}
              </div>
              <div
                style={{
                  width: barWidth,
                  height,
                  backgroundColor: isMax ? palette.accent : palette.accentDeep,
                  borderRadius: "10px 10px 0 0",
                }}
              />
              <div
                style={{
                  fontSize: 24,
                  color: palette.text,
                  marginTop: 12,
                  textAlign: "center",
                  lineHeight: 1.2,
                }}
              >
                {bar.label}
              </div>
            </div>
          );
        })}
      </div>
      <div
        style={{
          height: 3,
          backgroundColor: palette.text,
          opacity: 0.7,
          marginTop: 0,
        }}
      />
      {props.project ? (
        <div style={{ fontSize: 26, color: palette.accent, textAlign: "center", marginTop: 24 }}>
          {props.project}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

export const CHART_DEFAULTS = {
  lengthSeconds: 12,
  palette: HARNESS_DEFAULTS.palette,
  bars: [] as ChartBar[],
};
