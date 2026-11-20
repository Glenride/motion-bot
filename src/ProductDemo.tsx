import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { DriftBlobs, resolveFont, type HarnessPalette } from "./harness/primitives";
import { HARNESS_DEFAULTS } from "./Harness";

/**
 * ProductDemo — the ecommerce-video-skills template (v2.8),
 * 1280x720 landscape (browser-frame demos are landscape).
 *
 * One data-driven composition: every word on screen comes from the
 * props, which come only from the task — product name, features,
 * offer, CTA. Nothing is invented: no product, price, or claim the
 * brief did not supply.
 *
 * Demo beats (product-demo-video + promo-video skills), as
 * fractions of the clip so any length keeps the shape:
 *   Product frame 0–15% · Feature beats 15–78% (one per feature,
 *   cursor glides + click ripple + chip highlight + the frame
 *   reacts on the same frame) · End card 78–100% (hold >= 2s at
 *   the 15s default).
 * The demo loop per feature: settle, cursor travels eased
 * (smoothstep) to the chip, click ripple + state change on the
 * same frame, caption holds. One motion at a time — the camera
 * never moves while the cursor does.
 *
 * Promo (promo-video skill): when the offer carries a valid
 * was > now, the end card strikes the old price first, then counts
 * the new price down from was to now (eased, tabular-nums), and
 * the % OFF is COMPUTED from was/now — never typed twice. A bad
 * row (now >= was, missing was) shows no price drop at all: a
 * wrong price is worse than no price. A promo code renders as a
 * mono chip with a dashed border, held still; a deadline renders
 * only when the brief supplies one — never a fake timer.
 *
 * Everything is a pure function of useCurrentFrame(): no CSS
 * transitions, no library timers, no Date.now(), no Math.random().
 * The browser frame is code-drawn (no screenshot, no fake real
 * UI): the product name is the window title, never a fake URL.
 * An accent top bar + a progress hairline keep every frame
 * differing and the accent family visible (critic gates).
 */

export type ProductOffer = {
  /** Old price in dollars; shown struck through. */
  was?: number;
  /** New price in dollars; must be < was to render. */
  now?: number;
  /** Offer text when there is no was/now pair (e.g. "$75/hr for
   *  the first 3 clients") — the brief's own words. */
  text?: string;
  /** Promo code, rendered as a still chip. */
  code?: string;
  /** Real deadline, only when the brief supplies one. */
  deadline?: string;
};

export type ProductDemoProps = {
  product?: string;
  features?: string[];
  offer?: ProductOffer;
  /** CTA line; defaults to the hook (message-matched). */
  cta?: string;
  /** Story hook — the product-frame subline. */
  hook?: string;
  palette?: HarnessPalette;
  lengthSeconds?: number;
};

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export const PRODUCT_DEMO_DEFAULTS: Required<
  Omit<ProductDemoProps, "offer">
> & { offer: ProductOffer } = {
  product: "The First Build",
  features: ["One week", "One workflow", "One working system"],
  offer: { text: "$75/hr for the first 3 clients" },
  cta: "One week. One workflow. One working system.",
  hook: "One week. One workflow. One working system.",
  palette: {
    background: "#F4EEDC",
    surface: "#E5E0CF",
    accent: "#D4AF37",
    accentDeep: "#8A7224",
    text: "#1F1A14",
    glow: "#D4AF37",
    particle: "#D4AF37",
  },
  lengthSeconds: 15,
};

const SERIF = resolveFont("serif");
const SANS = resolveFont("sans");
const MONO = resolveFont("mono");

/** Smoothstep: the cursor accelerates out of rest and decelerates
 *  into its target — a linear cursor reads as robotic. */
const smoothstep = (x: number) => x * x * (3 - 2 * x);

/** Cursor arrow (product-demo skill shape), pure SVG. */
const CursorArrow: React.FC<{ x: number; y: number }> = ({ x, y }) => (
  <svg
    width="30"
    height="30"
    viewBox="0 0 28 28"
    style={{
      position: "absolute",
      left: x,
      top: y,
      filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.4))",
      zIndex: 6,
    }}
  >
    <path
      d="M3 2 L3 21 L9 15 L13 24 L16 23 L12 14 L20 14 Z"
      fill="#fff"
      stroke="#222"
      strokeWidth="1.4"
    />
  </svg>
);

export const ProductDemo: React.FC<ProductDemoProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const palette = { ...PRODUCT_DEMO_DEFAULTS.palette, ...(props.palette ?? {}) };
  const product = props.product ?? PRODUCT_DEMO_DEFAULTS.product;
  const features = props.features && props.features.length > 0
    ? props.features.slice(0, 4)
    : [];
  const offer: ProductOffer = { ...(props.offer ?? {}) };
  const cta = props.cta ?? props.hook ?? product;
  const hook = props.hook ?? "";

  // Beat boundaries as fractions of the clip (see header).
  const nF = features.length;
  const productEnd = 0.15;
  const endStart = 0.78;
  const productEndF = Math.floor(productEnd * durationInFrames);
  const endStartF = Math.floor(endStart * durationInFrames);
  const featSpan = endStartF - productEndF;
  const featLen = nF > 0 ? Math.floor(featSpan / nF) : 0;
  const featStart = (i: number) => productEndF + i * featLen;

  // Chips row geometry (deterministic, so the cursor targets are
  // exact): centered row, fixed chip width.
  const chipGap = 24;
  const chipW = nF > 0 ? Math.min(260, (1120 - chipGap * (nF - 1)) / nF) : 0;
  const chipTotalW = nF > 0 ? nF * chipW + (nF - 1) * chipGap : 0;
  const chipRowX = (1280 - chipTotalW) / 2;
  const chipY = 556;
  const chipH = 64;
  const chipCenter = (i: number) => ({
    x: chipRowX + i * (chipW + chipGap) + chipW / 2,
    y: chipY + chipH / 2,
  });

  // Which feature beat is live now (-1 during product / end card).
  const liveFeat =
    nF > 0 && frame >= productEndF && frame < endStartF
      ? Math.min(nF - 1, Math.floor((frame - productEndF) / featLen))
      : -1;
  // Last feature whose CLICK frame has passed (its text is the
  // frame's state — the screen reacts on the click frame, not the
  // beat start).
  const clickAtFrac = 0.45;
  const lastClicked =
    nF > 0 && frame >= productEndF
      ? Math.min(
          nF - 1,
          Math.floor(
            (frame - productEndF - Math.floor(featLen * clickAtFrac)) / featLen,
          ),
        )
      : -1;

  // Cursor: glides during the first 40% of each feature beat from
  // the previous chip (or the frame center for the first), clicks
  // at 45% of the beat. Hidden outside feature beats.
  let cursor: { x: number; y: number } | null = null;
  let ripple: { x: number; y: number; r: number } | null = null;
  if (liveFeat >= 0) {
    const local = frame - featStart(liveFeat);
    const glideLen = Math.floor(featLen * 0.4);
    const clickAt = Math.floor(featLen * 0.45);
    const from =
      liveFeat === 0 ? { x: 640, y: 320 } : chipCenter(liveFeat - 1);
    const to = chipCenter(liveFeat);
    const t = smoothstep(
      interpolate(local, [0, glideLen], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      }),
    );
    cursor = {
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
    };
    const since = local - clickAt;
    if (since >= 0 && since < 18) {
      const r = spring({ frame: since, fps, config: { damping: 18 }, durationInFrames: 18 });
      ripple = { x: to.x, y: to.y, r };
    }
  }

  // Product beat: headline fades out as the feature beats start.
  const productP = interpolate(frame, [0, 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const productOut = interpolate(frame, [productEndF - 8, productEndF], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  // Chips row fades in at the first feature beat.
  const chipsP = interpolate(frame, [productEndF, productEndF + 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  // End card: covers the frame from endStart, fading in over 10f.
  const endP = interpolate(frame, [endStartF, endStartF + 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const endLocal = frame - endStartF;

  // Was -> now (promo skill): strike draws first, then the new
  // price counts down from was. Only when now < was — otherwise
  // no price drop renders at all.
  const priceDrop =
    offer.was !== undefined &&
    offer.now !== undefined &&
    offer.was > 0 &&
    offer.now > 0 &&
    offer.now < offer.was;
  const pctOff = priceDrop
    ? Math.round((1 - (offer.now as number) / (offer.was as number)) * 100)
    : 0;
  const strike = interpolate(endLocal, [12, 24], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const priceT = spring({
    frame: endLocal - 26,
    fps,
    config: { damping: 18, mass: 0.6 },
  });
  const priceShown = priceDrop
    ? (offer.was as number) +
      ((offer.now as number) - (offer.was as number)) *
        Math.max(0, Math.min(1, priceT))
    : 0;
  const pricePop = interpolate(Math.max(0, Math.min(1, priceT)), [0.9, 1], [1.12, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  // CTA shine: sweeps the button every half second, so held end
  // frames still differ.
  const shineX = interpolate(endLocal % 15, [0, 15], [-260, 900], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  // Progress hairline across the whole clip.
  const hairP = interpolate(frame, [0, Math.max(1, durationInFrames - 1)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // The frame's state line: the hook until the first click, then
  // the last clicked feature — the screen reacts on the click frame.
  const frameLine =
    lastClicked >= 0 ? features[lastClicked] : hook || product;

  return (
    <AbsoluteFill style={{ backgroundColor: palette.background, fontFamily: SANS }}>
      <DriftBlobs frame={frame} palette={palette} />
      {/* Product name headline (product beat). */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 56,
          textAlign: "center",
          opacity: productP * productOut,
          zIndex: 3,
        }}
      >
        <div style={{ fontFamily: SERIF, fontSize: 64, fontWeight: 800, color: palette.text }}>
          {product}
        </div>
        {hook ? (
          <div style={{ fontSize: 28, color: palette.accent, marginTop: 10 }}>
            {hook}
          </div>
        ) : null}
      </div>

      {/* Browser frame (code-drawn): title bar + product state line. */}
      <div
        style={{
          position: "absolute",
          left: 190,
          top: 200,
          width: 900,
          borderRadius: 12,
          overflow: "hidden",
          backgroundColor: "#FFFFFF",
          boxShadow: "0 40px 80px rgba(0,0,0,0.35)",
          opacity: productP,
          zIndex: 2,
        }}
      >
        <div
          style={{
            height: 40,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "0 14px",
            backgroundColor: "#1e1e22",
          }}
        >
          {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
            <span key={c} style={{ width: 12, height: 12, borderRadius: "50%", backgroundColor: c }} />
          ))}
          <div
            style={{
              marginLeft: 12,
              flex: 1,
              height: 24,
              borderRadius: 6,
              backgroundColor: "#2b2b30",
              color: "#9aa",
              fontSize: 13,
              display: "flex",
              alignItems: "center",
              padding: "0 10px",
            }}
          >
            {product}
          </div>
        </div>
        <div
          style={{
            minHeight: 200,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "30px 40px",
            backgroundColor: palette.surface,
          }}
        >
          <div style={{ fontFamily: SERIF, fontSize: 44, fontWeight: 700, color: palette.text, textAlign: "center" }}>
            {product}
          </div>
          <div style={{ fontSize: 30, color: palette.accentDeep, marginTop: 14, textAlign: "center" }}>
            {frameLine}
          </div>
        </div>
      </div>

      {/* Feature callout chips (one per feature, ticking done). */}
      {nF > 0 ? (
        <div
          style={{
            position: "absolute",
            left: chipRowX,
            top: chipY,
            display: "flex",
            gap: chipGap,
            opacity: chipsP,
            zIndex: 3,
          }}
        >
          {features.map((f, i) => {
            const isClicked = lastClicked >= i;
            const isLive = liveFeat === i;
            return (
              <div
                key={`${f}-${i}`}
                style={{
                  width: chipW,
                  height: chipH,
                  borderRadius: 32,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  textAlign: "center",
                  padding: "0 14px",
                  fontSize: 24,
                  fontWeight: isClicked ? 800 : 600,
                  color: isClicked ? "#FFFFFF" : palette.text,
                  backgroundColor: isClicked ? palette.accent : palette.surface,
                  border: `3px solid ${isLive || isClicked ? palette.accent : palette.accentDeep}`,
                  boxSizing: "border-box",
                }}
              >
                {f}
              </div>
            );
          })}
        </div>
      ) : null}

      {/* Cursor + click ripple (feature beats only). */}
      {cursor ? <CursorArrow x={cursor.x} y={cursor.y} /> : null}
      {ripple ? (
        <div
          style={{
            position: "absolute",
            left: ripple.x,
            top: ripple.y,
            transform: "translate(-50%,-50%)",
            width: 12 + ripple.r * 60,
            height: 12 + ripple.r * 60,
            borderRadius: "50%",
            border: "2px solid rgba(80,140,255,.9)",
            opacity: 1 - ripple.r,
            zIndex: 6,
          }}
        />
      ) : null}

      {/* End card (last 22%, hold >= 2s): product + offer + CTA. */}
      <AbsoluteFill
        style={{
          backgroundColor: palette.background,
          opacity: endP,
          zIndex: 8,
        }}
      >
        <DriftBlobs frame={frame} palette={palette} />
        <div
          style={{
            position: "relative",
            zIndex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            flex: 1,
          }}
        >
        <div style={{ fontFamily: SERIF, fontSize: 56, fontWeight: 800, color: palette.text, textAlign: "center" }}>
          {product}
        </div>
        {priceDrop ? (
          <div style={{ textAlign: "center", marginTop: 18, fontVariantNumeric: "tabular-nums" }}>
            <div style={{ fontSize: 40, color: palette.text, opacity: 0.6, position: "relative", display: "inline-block" }}>
              {usd.format(offer.was as number)}
              <span
                style={{
                  position: "absolute",
                  left: 0,
                  top: "50%",
                  height: 4,
                  backgroundColor: "#ff3b3b",
                  width: `${strike}%`,
                }}
              />
            </div>
            <div
              style={{
                fontSize: 96,
                fontWeight: 800,
                color: palette.accentDeep,
                transform: `scale(${pricePop})`,
                lineHeight: 1.05,
              }}
            >
              {usd.format(priceShown)}
            </div>
            <div
              style={{
                display: "inline-block",
                marginTop: 10,
                backgroundColor: palette.accent,
                color: "#FFFFFF",
                fontSize: 34,
                fontWeight: 800,
                padding: "8px 22px",
                borderRadius: 8,
              }}
            >
              {pctOff}% OFF
            </div>
          </div>
        ) : offer.text ? (
          <div style={{ fontSize: 44, fontWeight: 700, color: palette.accentDeep, marginTop: 22, textAlign: "center" }}>
            {offer.text}
          </div>
        ) : null}
        {offer.code ? (
          <div
            style={{
              fontFamily: MONO,
              fontSize: 36,
              fontWeight: 700,
              color: palette.text,
              backgroundColor: palette.surface,
              border: `3px dashed ${palette.accent}`,
              borderRadius: 8,
              padding: "12px 26px",
              marginTop: 26,
              letterSpacing: 2,
            }}
          >
            {offer.code}
          </div>
        ) : null}
        {offer.deadline ? (
          <div style={{ fontSize: 28, color: palette.text, marginTop: 16 }}>
            {offer.deadline}
          </div>
        ) : null}
        <div
          style={{
            position: "relative",
            overflow: "hidden",
            backgroundColor: palette.accent,
            borderRadius: 8,
            padding: "26px 44px",
            marginTop: 30,
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: shineX,
              width: 90,
              backgroundColor: "rgba(255,255,255,0.35)",
              transform: "skewX(-20deg)",
            }}
          />
          <span style={{ fontFamily: SERIF, fontSize: 40, fontWeight: 800, color: "#FFFFFF", textAlign: "center" }}>
            {cta}
          </span>
        </div>
        </div>
      </AbsoluteFill>

      {/* Clip-level accent bar + progress hairline. */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 10, backgroundColor: palette.accent, zIndex: 9 }} />
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 6, backgroundColor: palette.surface, zIndex: 9 }}>
        <div style={{ width: `${hairP * 100}%`, height: "100%", backgroundColor: palette.accent }} />
      </div>
    </AbsoluteFill>
  );
};
