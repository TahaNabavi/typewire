import type { MetadataRoute } from "next";

import { absoluteUrl } from "@/lib/seo";
import { documentedPackages, generatedAt, packages } from "@/lib/registry";

/**
 * The whole site, enumerated from the registry rather than listed by hand — a
 * package that publishes, or a docs page that is added to a package, appears
 * here on the next build without anyone remembering to add it.
 *
 * `lastModified` is the registry's generation stamp for every URL, and that is
 * the honest answer: each page is rendered from the monorepo at build time, so
 * the build is when its content last changed. Per-page git timestamps would be
 * more precise for docs, but they are not available to a Vercel build with a
 * shallow clone, and a made-up date is worse than a coarse true one.
 *
 * Priority is relative within this site only — it tells a crawler where to
 * spend its budget, not how important the site is.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date(generatedAt);

  const landing: MetadataRoute.Sitemap = [
    { url: absoluteUrl("/"), lastModified, changeFrequency: "weekly", priority: 1 },
    { url: absoluteUrl("/docs"), lastModified, changeFrequency: "weekly", priority: 0.9 },
    { url: absoluteUrl("/packages"), lastModified, changeFrequency: "weekly", priority: 0.9 },
    { url: absoluteUrl("/playground"), lastModified, changeFrequency: "monthly", priority: 0.8 },
    { url: absoluteUrl("/examples"), lastModified, changeFrequency: "monthly", priority: 0.6 },
    { url: absoluteUrl("/roadmap"), lastModified, changeFrequency: "weekly", priority: 0.6 },
  ];

  // A package page carries the banner the package's own README opens with, so
  // the image is discoverable in image search alongside the page it belongs to.
  const packagePages: MetadataRoute.Sitemap = packages.map((pkg) => ({
    url: absoluteUrl(`/packages/${pkg.slug}`),
    lastModified,
    changeFrequency: "weekly",
    priority: pkg.published ? 0.8 : 0.5,
    ...(pkg.banner ? { images: [absoluteUrl(pkg.banner)] } : {}),
  }));

  // /docs/<pkg> is a redirect to the first page, not a document — only the
  // pages themselves belong in a sitemap.
  const docPages: MetadataRoute.Sitemap = documentedPackages.flatMap((pkg) =>
    pkg.docs.pages.map((page, index) => ({
      url: absoluteUrl(`/docs/${pkg.slug}/${page.slug}`),
      lastModified,
      changeFrequency: "weekly" as const,
      // A package's first page is its overview and the one worth ranking.
      priority: index === 0 ? 0.8 : 0.7,
    })),
  );

  // Examples are all on one page rather than one page each, so /examples is
  // already in `landing` and there is nothing per-example to add.
  return [...landing, ...packagePages, ...docPages];
}
