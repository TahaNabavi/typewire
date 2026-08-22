import { ACCENT, OG_CONTENT_TYPE, OG_SIZE, ogImage } from "@/lib/og";
import { roadmap } from "@/lib/registry";

export const alt = "The TypeWire roadmap — what has shipped and what is next";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return ogImage({
    eyebrow: "roadmap",
    title: "Shipped, and next",
    description:
      "Read from the repository README, so the plan on this page is the plan in the repo rather than a copy of it.",
    accent: ACCENT.green,
    chips: [`${roadmap.shipped.length} shipped`, `${roadmap.next.length} next`, "from README.md"],
  });
}
