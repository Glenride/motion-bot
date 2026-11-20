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
import { AdTemplate, AD_DEFAULTS } from "./AdTemplate";
import { CanvasStyles, CANVAS_DEFAULTS } from "./CanvasStyles";
import { BRoll, BROLL_DEFAULTS } from "./BRoll";
import { ProductDemo, PRODUCT_DEMO_DEFAULTS } from "./ProductDemo";
import { EverestPanels, EVEREST_DEFAULTS } from "./EverestPanels";
import { Explainer, EXPLAINER_DEFAULTS } from "./Explainer";

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
      {/* v2.7: packs 1–3 translated to code. AdTemplate is the
          ad-video-skills data-driven template (variant prop, 5-beat
          hook→CTA); CanvasStyles is animate-canvas (cut-paper /
          crosshatch, shape-morph bridges); BRoll is b-roll-skills
          (cuts on the noun from local pool clips, panel fallback). */}
      <Composition
        id="AdTemplate"
        component={AdTemplate}
        durationInFrames={AD_DEFAULTS.lengthSeconds * 30}
        fps={30}
        width={720}
        height={1280}
        defaultProps={AD_DEFAULTS as any}
        calculateMetadata={async ({ props }) => {
          const lengthSeconds = props.lengthSeconds ?? AD_DEFAULTS.lengthSeconds;
          return {
            durationInFrames: Math.max(
              450,
              Math.round(lengthSeconds * 30),
            ),
          };
        }}
      />
      <Composition
        id="CanvasStyles"
        component={CanvasStyles}
        durationInFrames={CANVAS_DEFAULTS.lengthSeconds * 30}
        fps={30}
        width={720}
        height={1280}
        defaultProps={CANVAS_DEFAULTS as any}
        calculateMetadata={async ({ props }) => {
          const lengthSeconds = props.lengthSeconds ?? CANVAS_DEFAULTS.lengthSeconds;
          return {
            durationInFrames: Math.max(
              90,
              Math.round(lengthSeconds * 30),
            ),
          };
        }}
      />
      <Composition
        id="BRoll"
        component={BRoll}
        durationInFrames={BROLL_DEFAULTS.lengthSeconds * 30}
        fps={30}
        width={1280}
        height={720}
        defaultProps={BROLL_DEFAULTS as any}
        calculateMetadata={async ({ props }) => {
          const lengthSeconds = props.lengthSeconds ?? BROLL_DEFAULTS.lengthSeconds;
          return {
            durationInFrames: Math.max(
              90,
              Math.round(lengthSeconds * 30),
            ),
          };
        }}
      />
      {/* v2.8: packs 4–6 translated to code. ProductDemo is the
          ecommerce-video-skills template (product frame, cursor +
          click ripple per feature, end card with the offer);
          EverestPanels is everest-components (ten code-drawn
          panels, one category prop; broll-frames dropped — it
          needs real footage). Chart/D3Chart carry the
          data-animation count-up / build-and-hold rules. */}
      <Composition
        id="ProductDemo"
        component={ProductDemo}
        durationInFrames={PRODUCT_DEMO_DEFAULTS.lengthSeconds * 30}
        fps={30}
        width={1280}
        height={720}
        defaultProps={PRODUCT_DEMO_DEFAULTS as any}
        calculateMetadata={async ({ props }) => {
          const lengthSeconds = props.lengthSeconds ?? PRODUCT_DEMO_DEFAULTS.lengthSeconds;
          return {
            durationInFrames: Math.max(
              90,
              Math.round(lengthSeconds * 30),
            ),
          };
        }}
      />
      <Composition
        id="EverestPanels"
        component={EverestPanels}
        durationInFrames={EVEREST_DEFAULTS.lengthSeconds * 30}
        fps={30}
        width={1280}
        height={720}
        defaultProps={EVEREST_DEFAULTS as any}
        calculateMetadata={async ({ props }) => {
          const lengthSeconds = props.lengthSeconds ?? EVEREST_DEFAULTS.lengthSeconds;
          return {
            durationInFrames: Math.max(
              90,
              Math.round(lengthSeconds * 30),
            ),
          };
        }}
      />
      {/* v2.9: pack 7 translated to code. Explainer is the
          explainer-video-skills composition (one idea per scene,
          build-and-hold, diagram / whiteboard / isometric styles,
          end-card recap); wrapped-video routes to Chart stats mode
          (same grammar, count-up already in Chart/D3Chart). */}
      <Composition
        id="Explainer"
        component={Explainer}
        durationInFrames={EXPLAINER_DEFAULTS.lengthSeconds * 30}
        fps={30}
        width={1280}
        height={720}
        defaultProps={EXPLAINER_DEFAULTS as any}
        calculateMetadata={async ({ props }) => {
          const lengthSeconds = props.lengthSeconds ?? EXPLAINER_DEFAULTS.lengthSeconds;
          return {
            durationInFrames: Math.max(
              90,
              Math.round(lengthSeconds * 30),
            ),
          };
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
