import Link from "next/link";

import { Panel } from "@/components/ui/panel";
import { Section } from "@/components/ui/section";
import { ArchDiagram } from "@/features/packages/arch-diagram";
import { PackageFilter } from "@/features/packages/package-filter";
import { packages, publishedPackages, unpublishedPackages } from "@/lib/registry";

export function PackagesSection() {
  return (
    <Section
      id="packages"
      kicker="// PACKAGES"
      title={`${packages.length} packages, one contract`}
      lede={`${publishedPackages.length} published on npm, ${unpublishedPackages.length} built and tested here awaiting a first publish. Everything below is read from each package's own manifest and README.`}
    >
      {/* Twelve is past the point where a grid is scanned rather than searched. */}
      <PackageFilter packages={packages} />

      <p className="mt-10 rounded-xl border border-hair bg-panel/50 p-5 text-sm leading-relaxed text-muted-foreground">
        <strong className="text-fg">Published</strong> is the version on npm right now — this page
        asks the registry, it does not repeat a number written by hand.{" "}
        <strong className="text-fg">Unpublished</strong> means built and tested in the repo, awaiting
        its first publish: not an unfinished package, one that has not been given a version number
        yet.
      </p>

      <Panel className="mt-14">
        <h3 className="pb-1 text-lg font-bold text-fg">How the monorepo fits together</h3>
        <p className="pb-5 text-sm text-muted-foreground">
          Every one of these keys on the same{" "}
          <code className="text-cyan">&quot;module.member&quot;</code> id — which is why adding a
          transport needed no change to query-core, devtools or the React adapter.
        </p>
        <ArchDiagram />
      </Panel>

      <Link href="/packages" className="mt-6 inline-block text-sm text-blue hover:underline">
        Compare all packages →
      </Link>
    </Section>
  );
}
