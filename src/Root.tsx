import React from "react";
import { Composition } from "remotion";
import { Signalwood } from "./Signalwood";
import { Generic, GENERIC_DEFAULTS, type GenericProps } from "./Generic";
import { Harness, HARNESS_DEFAULTS, type HarnessProps } from "./Harness";
import { MotionTest } from "./MotionTest";
import { Narrated, NARRATED_DEFAULTS, type NarratedProps } from "./Narrated";
import { Vertical, VERTICAL_DEFAULTS_EXPORT } from "./Vertical";
import { Chart, CHART_DEFAULTS } from "./Chart";
import { D3Chart, D3CHART_DEFAULTS } from "./D3Chart";
import { LowerThird, LOWER_THIRD_DEFAULTS } from "./LowerThird";
import { Synthwave, SYNTHWAVE_DEFAULTS } from "./Synthwave";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="Signalwood"
        component={Signalwood}
        durationInFrames={360}
        fps={30}
        width={1280}
        height={720}
      />
      <Composition
        id="Generic"
        component={Generic}
        durationInFrames={GENERIC_DEFAULTS.lengthSeconds * 30}
        fps={30}
        width={1280}
        height={720}
        defaultProps={GENERIC_DEFAULTS as GenericProps}
        calculateMetadata={async ({ props }) => {
          // A brief's lengthSeconds drives the clip length.
          const lengthSeconds = props.lengthSeconds ?? GENERIC_DEFAULTS.lengthSeconds;
          return {
            durationInFrames: Math.max(
              30,
              Math.round(lengthSeconds * 30),
            ),
          };
        }}
      />
      <Composition
        id="Harness"
        component={Harness}
        durationInFrames={HARNESS_DEFAULTS.lengthSeconds * 30}
        fps={30}
        width={1280}
        height={720}
        defaultProps={HARNESS_DEFAULTS as HarnessProps}
        calculateMetadata={async ({ props }) => {
          // A storyboard's lengthSeconds drives the clip length.
          const lengthSeconds = props.lengthSeconds ?? HARNESS_DEFAULTS.lengthSeconds;
          return {
            durationInFrames: Math.max(
              90,
              Math.round(lengthSeconds * 30),
            ),
          };
        }}
      />
      <Composition
        id="Vertical"
        component={Vertical}
        durationInFrames={VERTICAL_DEFAULTS_EXPORT.lengthSeconds * 30}
        fps={30}
        width={720}
        height={1280}
        defaultProps={VERTICAL_DEFAULTS_EXPORT as any}
        calculateMetadata={async ({ props }) => {
          const lengthSeconds = props.lengthSeconds ?? VERTICAL_DEFAULTS_EXPORT.lengthSeconds;
          return {
            durationInFrames: Math.max(
              90,
              Math.round(lengthSeconds * 30),
            ),
          };
        }}
      />
      <Composition
        id="Chart"
        component={Chart}
        durationInFrames={CHART_DEFAULTS.lengthSeconds * 30}
        fps={30}
        width={1280}
        height={720}
        defaultProps={CHART_DEFAULTS as any}
        calculateMetadata={async ({ props }) => {
          const lengthSeconds = props.lengthSeconds ?? CHART_DEFAULTS.lengthSeconds;
          return { durationInFrames: Math.max(90, Math.round(lengthSeconds * 30)) };
        }}
      />
      <Composition
        id="D3Chart"
        component={D3Chart}
        durationInFrames={D3CHART_DEFAULTS.lengthSeconds * 30}
        fps={30}
        width={1280}
        height={720}
        defaultProps={D3CHART_DEFAULTS as any}
        calculateMetadata={async ({ props }) => {
          const lengthSeconds = props.lengthSeconds ?? D3CHART_DEFAULTS.lengthSeconds;
          return { durationInFrames: Math.max(90, Math.round(lengthSeconds * 30)) };
        }}
      />
      <Composition
        id="LowerThird"
        component={LowerThird}
        durationInFrames={LOWER_THIRD_DEFAULTS.lengthSeconds * 30}
        fps={30}
        width={1280}
        height={720}
        defaultProps={LOWER_THIRD_DEFAULTS as any}
        calculateMetadata={async ({ props }) => {
          const lengthSeconds = props.lengthSeconds ?? LOWER_THIRD_DEFAULTS.lengthSeconds;
          return { durationInFrames: Math.max(30, Math.round(lengthSeconds * 30)) };
        }}
      />
      <Composition
        id="Synthwave"
        component={Synthwave}
        durationInFrames={SYNTHWAVE_DEFAULTS.lengthSeconds * 30}
        fps={30}
        width={1280}
        height={720}
        defaultProps={SYNTHWAVE_DEFAULTS as any}
        calculateMetadata={async ({ props }) => {
          const lengthSeconds = props.lengthSeconds ?? SYNTHWAVE_DEFAULTS.lengthSeconds;
          return { durationInFrames: Math.max(90, Math.round(lengthSeconds * 30)) };
        }}
      />
      <Composition
        id="MotionTest"
        component={MotionTest}
        durationInFrames={360}
        fps={30}
        width={1280}
        height={720}
        defaultProps={{
          hook: "Every mirror in your house shows you smiling, except when you turn your back — that's when it starts to cry.",
        }}
      />
      <Composition
        id="Narrated"
        component={Narrated}
        durationInFrames={NARRATED_DEFAULTS.lengthSeconds * 30}
        fps={30}
        width={1280}
        height={720}
        defaultProps={NARRATED_DEFAULTS as NarratedProps}
        calculateMetadata={async ({ props }) => {
          // An enriched storyboard's lengthSeconds is audio-driven
          // (prepare.ts sums the real voiceover durations).
          const lengthSeconds = props.lengthSeconds ?? NARRATED_DEFAULTS.lengthSeconds;
          return {
            durationInFrames: Math.max(
              90,
              Math.round(lengthSeconds * 30),
            ),
          };
        }}
      />
    </>
  );
};
