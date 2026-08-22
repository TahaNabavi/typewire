import type { MetadataRoute } from "next";

import { site } from "@/config/site";

/**
 * Not a PWA — there is no offline story here and no reason to invent one for a
 * documentation site. The manifest is what makes an installed shortcut, a
 * Chrome "Add to home screen" entry and an Android search result carry the
 * project's name, icon and colour instead of a screenshot of the tab bar.
 *
 * `background_color` and `theme_color` are the light theme's, because light is
 * this site's default; a reader who chose dark gets it from their stored
 * preference on first paint, which a manifest cannot know about.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${site.name} — ${site.tagline}`,
    short_name: site.name,
    description: site.description,
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#f7f9fc",
    theme_color: "#f7f9fc",
    categories: ["developer", "productivity", "utilities"],
    lang: "en",
    dir: "ltr",
    // The mark is vector, and every browser that reads a manifest has read SVG
    // icons for years — so there is one drawing here rather than a ladder of
    // rasterised sizes that would each have to be regenerated when it changes.
    // The Apple icon is the exception, because iOS does not read this file at
    // all; it reads the <link rel="apple-touch-icon"> that app/apple-icon.tsx
    // emits, and that one has to be a PNG.
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png", purpose: "any" },
    ],
    shortcuts: [
      { name: "Docs", short_name: "Docs", url: "/docs" },
      { name: "Packages", short_name: "Packages", url: "/packages" },
      { name: "Playground", short_name: "Playground", url: "/playground" },
    ],
  };
}
