import { ACCENT, OG_CONTENT_TYPE, OG_SIZE, ogImage } from "@/lib/og";

export const alt = "The TypeWire playground — a real client and server running in the browser";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return ogImage({
    eyebrow: "playground",
    title: "A real project, on this page",
    description:
      "typefetch in your browser, talking to route handlers on this site — and a switch that breaks the server so you can watch validation catch it.",
    accent: ACCENT.cyan,
    chips: ["one contract", "real client", "real server", "breakable"],
  });
}
