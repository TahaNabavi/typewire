import Link from "next/link";

import { Chip } from "@/components/ui/chip";
import { Panel } from "@/components/ui/panel";
import { JsonLd } from "@/components/shared/json-ld";
import { site } from "@/config/site";
import { DocsShell } from "@/features/docs/shell";
import {
  CATEGORY_LABEL,
  docsBehind,
  documentedPackages,
  packages,
  type PackageCategory,
} from "@/lib/registry";
import { breadcrumbSchema, collectionSchema, graph } from "@/lib/seo";
import { PATHS } from "@/routes/paths";

export const DOCS_DESCRIPTION =
  "Reference for every TypeWire package, rendered from the package's own markdown and version-checked in CI \u2014 so no page quietly describes an older release.";

const REPO_DOCS = [
  { label: "Architecture", path: "docs/ARCHITECTURE.md", note: "The three design laws." },
  { label: "CLI", path: "docs/CLI.md", note: "typewire.config.ts and the command surface." },
  { label: "Roadmap", path: "docs/ROADMAP.md", note: "Sequencing, and the gaps still open." },
  { label: "Contributing", path: "CONTRIBUTING.md", note: "Setup, flow, changesets." },
  { label: "Agents", path: "AGENTS.md", note: "The definition of done, for humans and agents." },
  { label: "Security", path: "SECURITY.md", note: "Private disclosure." },
];

export function DocsHub() {
  const undocumented = packages.filter((p) => !p.docs || p.docs.pages.length === 0);

  const byCategory = new Map<PackageCategory, typeof documentedPackages>();
  for (const pkg of documentedPackages) {
    const list = byCategory.get(pkg.category) ?? [];
    list.push(pkg);
    byCategory.set(pkg.category, list);
  }

  return (
    <DocsShell>
      {/* Every documented package as one list, so a crawler sees the shape of
          the reference without walking it link by link. */}
      <JsonLd
        data={graph(
          collectionSchema(
            "TypeWire documentation",
            DOCS_DESCRIPTION,
            PATHS.DOCS,
            documentedPackages.map((pkg) => ({
              name: pkg.short,
              path: `/docs/${pkg.slug}/${pkg.docs.pages[0]?.slug ?? ""}`,
            })),
          ),
          breadcrumbSchema([
            { name: "TypeWire", path: "/" },
            { name: "Docs", path: "/docs" },
          ]),
        )}
      />

      <header className="max-w-3xl">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-blue">// DOCS</p>
        <h1 className="mt-3 text-4xl font-extrabold tracking-tight">Reference</h1>
        <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
          Every page here is rendered from the package it documents — its own markdown, in its own
          directory, in this repository. Each package declares which version its docs describe, and
          CI fails a release whose docs were never reviewed against it.
        </p>
      </header>

      <div className="enter-group mt-12 space-y-10">
        {[...byCategory.entries()].map(([category, list]) => (
          <section key={category}>
            <h2 className="mb-4 font-mono text-xs uppercase tracking-[0.18em] text-dim">
              {CATEGORY_LABEL[category]}
            </h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {list.map((pkg) => (
                <Panel key={pkg.slug} className="transition-colors duration-(--motion-ui) hover:border-hair-strong">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link
                      href={`/docs/${pkg.slug}`}
                      className="font-mono text-sm font-semibold text-fg hover:text-blue"
                    >
                      {pkg.short}
                    </Link>
                    {docsBehind(pkg) ? (
                      <Chip tone="var(--amber)" dashed>
                        documents v{pkg.docs.documentsVersion}
                      </Chip>
                    ) : (
                      <Chip tone="var(--green)">v{pkg.docs.documentsVersion}</Chip>
                    )}
                  </div>

                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {pkg.docs.summary ?? pkg.description}
                  </p>

                  <ul className="mt-4 flex flex-wrap gap-1.5">
                    {pkg.docs.pages.map((page) => (
                      <li key={page.slug}>
                        <Link
                          href={`/docs/${pkg.slug}/${page.slug}`}
                          className="inline-block rounded-full border border-hair px-2.5 py-1 font-mono text-[11px] text-muted-foreground transition-colors duration-(--motion-ui) hover:border-hair-strong hover:text-fg"
                        >
                          {page.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Panel>
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* If the gate is doing its job this list is empty — but a docs index that
          silently omits a package is worse than one that admits the hole. */}
      {undocumented.length > 0 && (
        <div className="mt-12 rounded-xl border border-dashed border-amber/40 p-5">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-amber">
            Not documented yet
          </p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {undocumented.map((p) => p.short).join(", ")} — these ship no docs manifest, which is a
            CI failure rather than a state this site is happy with.
          </p>
        </div>
      )}

      <section className="mt-14">
        <h2 className="mb-4 font-mono text-xs uppercase tracking-[0.18em] text-dim">Repository</h2>
        <div className="enter-group grid grid-cols-1 gap-4 md:grid-cols-3">
          {REPO_DOCS.map((doc) => (
            <a
              key={doc.path}
              href={`${site.repo.url}/blob/${site.repo.branch}/${doc.path}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-xl border border-hair p-4 transition-colors duration-(--motion-ui) hover:border-hair-strong"
            >
              <p className="text-sm font-semibold text-fg">{doc.label} ↗</p>
              <p className="mt-1 text-xs text-muted-foreground">{doc.note}</p>
            </a>
          ))}
        </div>
      </section>
    </DocsShell>
  );
}
