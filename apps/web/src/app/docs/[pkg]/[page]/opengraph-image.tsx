import { notFound } from "next/navigation";

import { excerpt } from "@/features/docs/markdown";
import { ACCENT, OG_CONTENT_TYPE, OG_SIZE, ogImage } from "@/lib/og";
import { documentedPackages, getDocPage, getPackage } from "@/lib/registry";

export const alt = "TypeWire documentation";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export function generateStaticParams() {
  return documentedPackages.flatMap((pkg) =>
    pkg.docs.pages.map((page) => ({ pkg: pkg.slug, page: page.slug })),
  );
}

export const dynamicParams = false;

export default async function Image({
  params,
}: {
  params: Promise<{ pkg: string; page: string }>;
}) {
  const { pkg: pkgSlug, page: pageSlug } = await params;
  const pkg = getPackage(pkgSlug);
  const page = pkg && getDocPage(pkg, pageSlug);
  if (!pkg || !page) notFound();

  // The page's own H2s are its outline, and a truer summary of what is on it
  // than the package description every page of the package would otherwise
  // repeat.
  const sections = page.headings.filter((h) => h.depth === 2).map((h) => h.text);
  const short = sections.filter((text) => text.length <= 22);

  return ogImage({
    eyebrow: pkg.short,
    title: page.title,
    // Two lines at the card's body size is about 120 characters; past that the
    // description pushes the chips off the bottom edge.
    description: excerpt(page.markdown, 120) ?? pkg.description,
    accent: ACCENT.blue,
    kicker: pkg.docs?.documentsVersion ? `docs · v${pkg.docs.documentsVersion}` : "docs",
    // Long headings are dropped by the card anyway; deciding here means the
    // fallback fires when nothing short enough survives, rather than showing a
    // card with an empty chip row.
    chips: short.length > 0 ? short.slice(0, 3) : ["reference"],
  });
}
