/**
 * One drawing for every Open Graph image on this site.
 *
 * A section's card is not a different design — it is this one with a different
 * accent, eyebrow and title. That is deliberate: a link to /docs and a link to
 * /packages should look like they came from the same project when they land in
 * the same Slack channel.
 *
 * Constraints worth knowing before editing:
 *   - satori supports flexbox and a subset of CSS. No grid, no `gap` shorthand
 *     surprises, and any element with more than one child needs `display:flex`.
 *   - the whole route — JSX, CSS, fonts, images — must stay under 500 KB.
 *   - fonts are read from disk rather than fetched, so a build with no network
 *     still renders the real typeface. See src/assets/fonts/README.md.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

import { site } from "@/config/site";
import { MARK_SVG, svgDataUri } from "@/lib/brand";

/** The Open Graph consensus size: 1.91:1, and what every network crops to. */
export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = "image/png";

/* -------------------------------------------------------------------------
   Palette — the dark theme's tokens, inlined. globals.css cannot be read from
   here (satori resolves no custom properties), so these are copies. They are
   the *dark* values because every social card is dark, whatever theme the
   reader has chosen on the site itself.
   ------------------------------------------------------------------------- */

const INK = "#060a14";
const INK_2 = "#0a1120";
const FG = "#e8eef8";
const MUTED = "#94a3b8";
const DIM = "#5a6b83";
const HAIR = "rgba(148, 163, 184, 0.14)";

/** The one hard visual rule — a wire always gets the same colour. */
export const WIRE = {
  http: "#3b82f6",
  graphql: "#8b5cf6",
  grpc: "#22d3ee",
  ws: "#4ade80",
} as const;

export const ACCENT = {
  blue: "#60a5fa",
  purple: "#a78bfa",
  cyan: "#22d3ee",
  green: "#4ade80",
  amber: "#fbbf24",
} as const;

export type Accent = (typeof ACCENT)[keyof typeof ACCENT];

/* -------------------------------------------------------------------------
   Fonts
   ------------------------------------------------------------------------- */

const FONT_DIR = join(process.cwd(), "src/assets/fonts");

const [sansRegular, sansBold, monoSemiBold] = await Promise.all([
  readFile(join(FONT_DIR, "Geist-Regular.ttf")),
  readFile(join(FONT_DIR, "Geist-Bold.ttf")),
  readFile(join(FONT_DIR, "GeistMono-SemiBold.ttf")),
]);

const fonts = [
  { name: "Geist", data: sansRegular, weight: 400 as const, style: "normal" as const },
  { name: "Geist", data: sansBold, weight: 700 as const, style: "normal" as const },
  { name: "Geist Mono", data: monoSemiBold, weight: 600 as const, style: "normal" as const },
];

/* -------------------------------------------------------------------------
   Decoration — drawn as SVG data URIs rather than CSS. Repeating backgrounds
   and multi-layer gradients are the shakiest corner of satori's CSS support;
   an <img> goes through resvg, which draws exactly what it is given.
   ------------------------------------------------------------------------- */

const dataUri = svgDataUri;

/** The blueprint grid the whole brand sits on: 48px, barely there. */
const GRID = dataUri(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">${[
    ...Array.from(
      { length: 25 },
      (_, i) =>
        `<line x1="${i * 48}" y1="0" x2="${i * 48}" y2="630" stroke="#94a3b8" stroke-opacity="0.05" stroke-width="1"/>`,
    ),
    ...Array.from(
      { length: 14 },
      (_, i) =>
        `<line x1="0" y1="${i * 48}" x2="1200" y2="${i * 48}" stroke="#94a3b8" stroke-opacity="0.05" stroke-width="1"/>`,
    ),
  ].join("")}</svg>`,
);

/**
 * The signal: one line entering, forking, leaving. It is the argument of the
 * whole project reduced to a gesture — the same shape the wordmark carries and
 * the hero animates.
 */
const SIGNAL = dataUri(`
<svg xmlns="http://www.w3.org/2000/svg" width="640" height="630" viewBox="0 0 640 630">
  <defs>
    <linearGradient id="fade" x1="0" y1="0" x2="640" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#22d3ee" stop-opacity="0"/>
      <stop offset="0.45" stop-color="#3b82f6" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#8b5cf6" stop-opacity="0.15"/>
    </linearGradient>
  </defs>
  <path d="M-20 315 C 180 315, 220 315, 300 315" stroke="url(#fade)" stroke-width="2" fill="none"/>
  <path d="M300 315 C 380 315, 400 120, 598 120" stroke="${WIRE.http}" stroke-opacity="0.5" stroke-width="2" fill="none"/>
  <path d="M300 315 C 380 315, 400 250, 598 250" stroke="${WIRE.graphql}" stroke-opacity="0.42" stroke-width="2" fill="none"/>
  <path d="M300 315 C 380 315, 400 400, 598 400" stroke="${WIRE.grpc}" stroke-opacity="0.42" stroke-width="2" fill="none"/>
  <path d="M300 315 C 380 315, 400 520, 598 520" stroke="${WIRE.ws}" stroke-opacity="0.35" stroke-width="2" fill="none"/>
  <circle cx="300" cy="315" r="7" fill="#22d3ee" fill-opacity="0.9"/>
  <circle cx="300" cy="315" r="16" fill="none" stroke="#22d3ee" stroke-opacity="0.28" stroke-width="2"/>
  <circle cx="598" cy="120" r="5" fill="${WIRE.http}" fill-opacity="0.8"/>
  <circle cx="598" cy="250" r="5" fill="${WIRE.graphql}" fill-opacity="0.7"/>
  <circle cx="598" cy="400" r="5" fill="${WIRE.grpc}" fill-opacity="0.7"/>
  <circle cx="598" cy="520" r="5" fill="${WIRE.ws}" fill-opacity="0.6"/>
</svg>`);

/** The wordmark tile, identical to the one in the site header. */
const MARK = dataUri(MARK_SVG);

/* -------------------------------------------------------------------------
   The card
   ------------------------------------------------------------------------- */

export interface OgCard {
  /** Small mono label above the title — the section, in the site's own voice. */
  eyebrow: string;
  /** The headline. Keep it under ~48 characters or it wraps to three lines. */
  title: string;
  /** One sentence. Long enough to say something, short enough to be read. */
  description: string;
  /** Up to four short facts, set in mono along the bottom. */
  chips?: string[];
  /** Colours the eyebrow, the rule under the title, and the chip borders. */
  accent?: Accent;
  /** Replaces the URL in the top-right corner — a package name, usually. */
  kicker?: string;
}

/**
 * Title sizes step down as the string grows so a long package name and a short
 * section name both fill the same optical box. satori has no `clamp()`, so the
 * measurement has to happen here.
 */
function titleSize(title: string) {
  if (title.length > 46) return 54;
  if (title.length > 32) return 64;
  if (title.length > 22) return 76;
  return 86;
}

/**
 * A card has a fixed height and no scrollbar, so text that does not fit does
 * not wrap — it pushes the chips off the bottom edge and out of the image.
 *
 * The callers here are the registry and the docs markdown, both of which
 * contain strings written for a page rather than for a 1200×630 box: package
 * taglines run to 258 characters and an H2 to 62. Rather than ask each caller
 * to remember a limit, the card enforces its own.
 */
const DESCRIPTION_LIMIT = 150;
/** A chip is one short fact. Longer than this and four of them overrun the row. */
const CHIP_LIMIT = 22;

function clamp(text: string, limit: number) {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const space = cut.lastIndexOf(" ");
  return `${(space > limit * 0.6 ? cut.slice(0, space) : cut).replace(/[,;:.\s]+$/, "")}…`;
}

export function ogImage({ eyebrow, title, description, chips = [], accent = ACCENT.blue, kicker }: OgCard) {
  // Chips that do not fit are dropped rather than truncated: "Framework-less
  // by de…" reads as a bug, where a missing chip reads as nothing at all.
  const fitted = chips.filter((chip) => chip.length <= CHIP_LIMIT).slice(0, 4);
  const body = clamp(description, DESCRIPTION_LIMIT);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          position: "relative",
          backgroundColor: INK,
          backgroundImage: `radial-gradient(900px 500px at 88% 8%, ${INK_2} 0%, ${INK} 62%)`,
          fontFamily: "Geist",
          color: FG,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={GRID} width={1200} height={630} style={{ position: "absolute", top: 0, left: 0 }} alt="" />
        <img src={SIGNAL} width={640} height={630} style={{ position: "absolute", top: 0, right: 0 }} alt="" />

        {/* A single accent wash behind the copy, so the text never fights the
            signal drawing for the same pixels. */}
        <div
          style={{
            position: "absolute",
            top: -160,
            left: -120,
            width: 700,
            height: 700,
            borderRadius: 350,
            backgroundImage: `radial-gradient(circle, ${accent}1f 0%, ${accent}00 70%)`,
          }}
        />

        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "44px 64px 0 64px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center" }}>
            <img src={MARK} width={52} height={52} alt="" />
            <div style={{ display: "flex", marginLeft: 14, fontSize: 30, fontWeight: 700, letterSpacing: -0.6 }}>
              <span style={{ color: FG }}>Type</span>
              <span style={{ color: ACCENT.blue }}>Wire</span>
            </div>
          </div>
          <div
            style={{
              display: "flex",
              fontFamily: "Geist Mono",
              fontSize: 20,
              color: kicker ? MUTED : DIM,
            }}
          >
            {kicker ?? site.domain}
          </div>
        </div>

        {/* Body */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flexGrow: 1,
            justifyContent: "center",
            padding: "0 64px",
            maxWidth: 880,
          }}
        >
          <div
            style={{
              display: "flex",
              fontFamily: "Geist Mono",
              fontSize: 21,
              letterSpacing: 3,
              color: accent,
            }}
          >
            {eyebrow.toUpperCase()}
          </div>

          <div
            style={{
              display: "flex",
              marginTop: 18,
              fontSize: titleSize(title),
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: -2,
              color: FG,
            }}
          >
            {title}
          </div>

          <div style={{ display: "flex", width: 132, height: 4, marginTop: 26, borderRadius: 2, backgroundColor: accent }} />

          <div
            style={{
              display: "flex",
              marginTop: 26,
              fontSize: 28,
              lineHeight: 1.4,
              color: MUTED,
            }}
          >
            {body}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 64px 46px 64px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center" }}>
            {fitted.map((chip) => (
              <div
                key={chip}
                style={{
                  display: "flex",
                  marginRight: 12,
                  padding: "9px 16px",
                  borderRadius: 9,
                  border: `1px solid ${HAIR}`,
                  backgroundColor: "rgba(148, 163, 184, 0.06)",
                  fontFamily: "Geist Mono",
                  fontSize: 19,
                  color: MUTED,
                }}
              >
                {chip}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", fontFamily: "Geist Mono", fontSize: 19, color: DIM }}>
            {site.scope}
          </div>
        </div>

        {/* Every card is closed by the four wires, always in this order. */}
        <div style={{ display: "flex", position: "absolute", bottom: 0, left: 0, width: 1200, height: 6 }}>
          <div style={{ display: "flex", width: 300, height: 6, backgroundColor: WIRE.http }} />
          <div style={{ display: "flex", width: 300, height: 6, backgroundColor: WIRE.graphql }} />
          <div style={{ display: "flex", width: 300, height: 6, backgroundColor: WIRE.grpc }} />
          <div style={{ display: "flex", width: 300, height: 6, backgroundColor: WIRE.ws }} />
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts },
  );
}
