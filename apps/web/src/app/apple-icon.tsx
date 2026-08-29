import { ImageResponse } from "next/og";

import { MARK_GLYPH_SVG, svgDataUri } from "@/lib/brand";

/**
 * iOS ignores `app/icon.svg` — a home-screen shortcut needs a raster, at the
 * one size Apple asks for. It also applies its own rounded mask and shadow, so
 * this draws the gradient edge to edge and lets the system do the corners,
 * rather than nesting a rounded tile inside a rounded mask.
 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";
export const alt = "TypeWire";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundImage: "linear-gradient(135deg, #22d3ee 0%, #3b82f6 50%, #8b5cf6 100%)",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={svgDataUri(MARK_GLYPH_SVG)} width={140} height={140} alt="" />
      </div>
    ),
    size,
  );
}
