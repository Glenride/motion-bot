import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { scaleBand, scaleLinear, max } from "d3";
import { SERIF, DriftBlobs, type HarnessPalette } from "./harness/primitives";
import { HARNESS_DEFAULTS } from "./Harness";
import {
  CHART_GROW_FRAMES,
  CHART_INTRO_FRAMES,
  CHART_STAGGER_FRAMES,
  countUp,
} from "./Chart";

/**
 * D3Chart — the d3 chart rung (opt-in only, Nov 3 2026; v2.8: same
 * count-up / build-and-hold rules as Chart).
 *
 * Same props and same story as the v2.3 Chart composition, but bar
 * layout is computed with d3 scales instead of hand arithmetic:
 * scaleBand for bar x/width, scaleLinear for bar heights, and the
 * linear scale's ticks for the faint gridlines. It does NOT replace
 * Chart — the watcher renders D3Chart only when a task's details
 * carry the explicit label `Chart: d3`; the default chart rung is
 * unchanged. Numbers come only from the task's data rows; nothing
 * is invented or rounded away (values display as given).
 *
 * v2.8: the displayed number counts up with easeOutCubic (see
 * Chart.countUp — never a spring on a headline number), bars start
 * after a 1s intro hold, the axis/gridlines are static from frame 0,
 * and a progress hairline keeps hold frames differing.
 */

export type D3ChartBar = { label: string; value: number };

export type D3ChartProps = {
  hook?: string;
  lengthSeconds?: number;
  palette?: HarnessPalette;
  bars?: D3ChartBar[];
  project?: string;
  /** Axis units, shown once — from the brief only. */
  unit?: string;
};

const fmt = (v: number) =>
  Number.isInteger(v) ? v.toLocaleString("en-US") : v.toLocaleString("en-US");

export const D3Chart: React.FC<D3ChartProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const palette = { ...HARNESS_DEFAULTS.palette, ...(props.palette ?? {}) };
  const bars = props.bars && props.bars.length > 0 ? props.bars : [{ label: "—", value: 1 }];
  const maxValue = max(bars, (b) => b.value) ?? 1;
  const title = props.hook ?? "";
  const unit = props.unit ?? "";
  const barAreaHeight = 460;
  const chartWidth = 1040;

  // d3 scales own the layout: band positions/widths, linear heights.
  const xScale = scaleBand<string>()
    .domain(bars.map((b) => b.label))
    .range([0, chartWidth])
    .padding(0.25);
  const yScale = scaleLinear().domain([0, maxValue]).range([0, barAreaHeight]);
  const ticks = yScale.ticks(4).filter((t) => t > 0);
  // Progress hairline: 0 -> 100% across the whole clip, so the final
  // hold frames still differ from each other.
  const hairP = interpolate(frame, [0, Math.max(1, durationInFrames - 1)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: palette.background,
        fontFamily: SERIF,
      }}
    >
      <DriftBlobs frame={frame} palette={palette} />
      <div
        style={{
          position: "relative",
          zIndex: 1,
          display: "flex",
          flexDirection: "column",
          flex: 1,
          padding: "70px 120px 90px 120px",
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
      {unit ? (
        <div style={{ fontSize: 24, color: palette.accent, textAlign: "center", marginBottom: 12 }}>
          {unit}
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
          // Intro hold (30f), then one bar at a time. Height springs;
          // the NUMBER counts up eased (countUp — never a spring on
          // a headline number). The gridlines + axis above are static
          // from frame 0: the axis never animates away from the data.
          const start = CHART_INTRO_FRAMES + i * CHART_STAGGER_FRAMES;
          const progress = spring({ frame: frame - start, fps, config: { damping: 16, stiffness: 120 } });
          const clamped = Math.max(0, Math.min(1, progress));
          const height = yScale(bar.value) * clamped;
          const shown = countUp(frame, start, CHART_GROW_FRAMES, bar.value);
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
                  fontVariantNumeric: "tabular-nums",
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
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 10, backgroundColor: palette.accent, zIndex: 2 }} />
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 6, backgroundColor: palette.surface, zIndex: 2 }}>
        <div style={{ width: `${hairP * 100}%`, height: "100%", backgroundColor: palette.accent }} />
      </div>
    </AbsoluteFill>
  );
};

export const D3CHART_DEFAULTS = {
  lengthSeconds: 12,
  palette: HARNESS_DEFAULTS.palette,
  bars: [] as D3ChartBar[],
};
