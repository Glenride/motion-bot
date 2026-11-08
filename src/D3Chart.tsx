import React from "react";
import {
  AbsoluteFill,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { scaleBand, scaleLinear, max } from "d3";
import { SERIF, type HarnessPalette } from "./harness/primitives";
import { HARNESS_DEFAULTS } from "./Harness";

/**
 * D3Chart — the d3 chart rung (opt-in only, Nov 3 2026).
 *
 * Same props and same story as the v2.3 Chart composition, but bar
 * layout is computed with d3 scales instead of hand arithmetic:
 * scaleBand for bar x/width, scaleLinear for bar heights, and the
 * linear scale's ticks for the faint gridlines. It does NOT replace
 * Chart — the watcher renders D3Chart only when a task's details
 * carry the explicit label `Chart: d3`; the default chart rung is
 * unchanged. Numbers come only from the task's data rows; nothing
 * is invented or rounded away (values display as given).
 */

export type D3ChartBar = { label: string; value: number };

export type D3ChartProps = {
  hook?: string;
  lengthSeconds?: number;
  palette?: HarnessPalette;
  bars?: D3ChartBar[];
  project?: string;
};

const fmt = (v: number) =>
  Number.isInteger(v) ? v.toLocaleString("en-US") : v.toLocaleString("en-US");

export const D3Chart: React.FC<D3ChartProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const palette = { ...HARNESS_DEFAULTS.palette, ...(props.palette ?? {}) };
  const bars = props.bars && props.bars.length > 0 ? props.bars : [{ label: "—", value: 1 }];
  const maxValue = max(bars, (b) => b.value) ?? 1;
  const title = props.hook ?? "";
  const barAreaHeight = 460;
  const chartWidth = 1040;

  // d3 scales own the layout: band positions/widths, linear heights.
  const xScale = scaleBand<string>()
    .domain(bars.map((b) => b.label))
    .range([0, chartWidth])
    .padding(0.25);
  const yScale = scaleLinear().domain([0, maxValue]).range([0, barAreaHeight]);
  const ticks = yScale.ticks(4).filter((t) => t > 0);

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
      <div style={{ position: "relative", height: barAreaHeight, marginTop: "auto" }}>
        {/* Faint gridlines from the d3 linear scale's ticks. */}
        {ticks.map((t) => (
          <div
            key={t}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: yScale(t),
              borderTop: `1px solid ${palette.text}`,
              opacity: 0.15,
            }}
          >
            <span
              style={{
                position: "absolute",
                right: "100%",
                top: -12,
                marginRight: 10,
                fontSize: 20,
                color: palette.text,
                opacity: 0.7,
              }}
            >
              {fmt(t)}
            </span>
          </div>
        ))}
        {/* Bars, value labels, and category labels are all positioned
            from the d3 band scale — no hand-computed widths or gaps. */}
        {bars.map((bar, i) => {
          const start = 10 + i * 12;
          const progress = spring({ frame: frame - start, fps, config: { damping: 16, stiffness: 120 } });
          const clamped = Math.max(0, Math.min(1, progress));
          const height = yScale(bar.value) * clamped;
          const shown = Math.round(bar.value * clamped);
          const isMax = bar.value === maxValue;
          const x = xScale(bar.label) ?? 0;
          const barWidth = xScale.bandwidth();
          return (
            <React.Fragment key={bar.label}>
              <div
                style={{
                  position: "absolute",
                  left: x,
                  bottom: 0,
                  width: barWidth,
                  height,
                  backgroundColor: isMax ? palette.accent : palette.accentDeep,
                  borderRadius: "10px 10px 0 0",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  left: x,
                  bottom: height + 10,
                  width: barWidth,
                  textAlign: "center",
                  fontSize: 34,
                  fontWeight: 700,
                  color: isMax ? palette.accent : palette.text,
                  opacity: clamped > 0 ? 1 : 0,
                }}
              >
                {fmt(shown)}
              </div>
            </React.Fragment>
          );
        })}
      </div>
      <div
        style={{
          position: "relative",
          height: 40,
          marginTop: 12,
        }}
      >
        {bars.map((bar) => (
          <div
            key={bar.label}
            style={{
              position: "absolute",
              left: xScale(bar.label) ?? 0,
              width: xScale.bandwidth(),
              fontSize: 24,
              color: palette.text,
              textAlign: "center",
              lineHeight: 1.2,
            }}
          >
            {bar.label}
          </div>
        ))}
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

export const D3CHART_DEFAULTS = {
  lengthSeconds: 12,
  palette: HARNESS_DEFAULTS.palette,
  bars: [] as D3ChartBar[],
};
