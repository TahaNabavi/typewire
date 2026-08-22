/**
 * The mark, drawn once.
 *
 * It appears in the header as JSX, in the favicon as a file, on the apple touch
 * icon as a raster, and on every Open Graph card as an embedded image. Those are
 * four rasterisers with four different subsets of SVG, so the drawing is kept
 * here as a string that all of them can be handed, rather than as a component
 * only React can render.
 *
 * What it draws: a signal entering low on the left, crossing a node in the
 * middle, and leaving high on the right — one wire, one contract, three points
 * that agree about it. The gradient runs cyan → blue → violet, which is the
 * transport order the whole site uses.
 */

/** Square, 512×512, no <defs> ids that could collide when inlined. */
export const MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="tw-mark-tile" x1="70" y1="52" x2="452" y2="470" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#22d3ee"/>
      <stop offset="0.5" stop-color="#3b82f6"/>
      <stop offset="1" stop-color="#8b5cf6"/>
    </linearGradient>
  </defs>
  <rect x="40" y="40" width="432" height="432" rx="128" fill="url(#tw-mark-tile)"/>
  <path d="M150 316 C 200 210, 236 210, 256 256 C 276 302, 312 302, 362 196" stroke="#fff" stroke-width="30" stroke-linecap="round" fill="none"/>
  <circle cx="150" cy="316" r="30" fill="#fff"/><circle cx="150" cy="316" r="14" fill="#3b82f6"/>
  <circle cx="362" cy="196" r="30" fill="#fff"/><circle cx="362" cy="196" r="14" fill="#8b5cf6"/>
  <circle cx="256" cy="256" r="15" fill="#fff"/><circle cx="256" cy="256" r="6.5" fill="#22d3ee"/>
</svg>`;

/**
 * The same drawing with the tile removed and the wire scaled up, for surfaces
 * that supply their own background — an apple touch icon, where iOS already
 * rounds and shadows whatever it is given.
 */
export const MARK_GLYPH_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <path d="M150 316 C 200 210, 236 210, 256 256 C 276 302, 312 302, 362 196" stroke="#fff" stroke-width="30" stroke-linecap="round" fill="none"/>
  <circle cx="150" cy="316" r="30" fill="#fff"/><circle cx="150" cy="316" r="14" fill="#3b82f6"/>
  <circle cx="362" cy="196" r="30" fill="#fff"/><circle cx="362" cy="196" r="14" fill="#8b5cf6"/>
  <circle cx="256" cy="256" r="15" fill="#fff"/><circle cx="256" cy="256" r="6.5" fill="#22d3ee"/>
</svg>`;

/** Base64 rather than percent-encoding: satori and resvg both take it, and it
 *  survives being pasted into a CSS `url()` without escaping surprises. */
export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
