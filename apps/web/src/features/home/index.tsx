import { Cta } from "@/features/home/cta";
import { Features } from "@/features/home/features";
import { Hero } from "@/features/home/hero";
import { WhatIs } from "@/features/home/what-is";
import { AiSupport } from "@/features/ask";
import { Feedback } from "@/features/feedback";
import { PackagesSection } from "@/features/packages/section";
import { GithubStatus } from "@/features/project-status";
import { Collaborate } from "@/features/project-status/collaborate";
import { RoadmapSection } from "@/features/roadmap";
import { Support } from "@/features/support";
import { Transports } from "@/features/transports";
import { packages } from "@/lib/registry";

/** Section order follows docs/website/DESIGN-PROMPT.md §4. */
export function HomePage() {
  // Only the select options cross to the client — not the whole registry.
  const feedbackOptions = packages.map((p) => ({ npm: p.npm, short: p.short }));

  return (
    <>
      <Hero />
      <WhatIs />
      <Features />
      <PackagesSection />
      <Transports />
      <GithubStatus />
      <Support />
      <AiSupport />
      <Feedback options={feedbackOptions} />
      <Collaborate />
      <RoadmapSection />
      <Cta />
    </>
  );
}
