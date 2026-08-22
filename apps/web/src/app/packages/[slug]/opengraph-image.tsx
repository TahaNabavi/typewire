import { notFound } from "next/navigation";

import { ACCENT, type Accent, OG_CONTENT_TYPE, OG_SIZE, ogImage } from "@/lib/og";
import { gzipSize } from "@/utils/format";
import { CATEGORY_LABEL, TRANSPORT_LABEL, getPackage, packages } from "@/lib/registry";

export const alt = "A TypeWire package";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

/** The registry is the whole input, so every card is drawn once at build time. */
export function generateStaticParams() {
  return packages.map((pkg) => ({ slug: pkg.slug }));
}

/** A slug that is not in the registry has no page either — nothing to draw. */
export const dynamicParams = false;

/**
 * Category picks the accent, so a link to a transport package and a link to a
 * devtools package are distinguishable in a feed before either title is read.
 */
const ACCENT_BY_CATEGORY: Record<string, Accent> = {
  core: ACCENT.cyan,
  transport: ACCENT.purple,
  server: ACCENT.blue,
  state: ACCENT.green,
  devtools: ACCENT.amber,
  tooling: ACCENT.blue,
};

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const pkg = getPackage(slug);
  if (!pkg) notFound();

  const chips = [
    ...pkg.transports.map((t) => TRANSPORT_LABEL[t]),
    ...(pkg.zeroDeps ? ["0 deps"] : []),
    ...(pkg.sizeCeilingGzip !== null ? [`≤ ${gzipSize(pkg.sizeCeilingGzip)} gz`] : []),
  ];

  return ogImage({
    eyebrow: CATEGORY_LABEL[pkg.category],
    // The scope is on every package and says nothing about this one; the
    // unscoped name is what a reader recognises and what they type.
    title: pkg.short,
    // package.json's description, not the README tagline: it is what npm shows
    // for the same package, and it is written short.
    description: pkg.description || pkg.tagline,
    accent: ACCENT_BY_CATEGORY[pkg.category] ?? ACCENT.blue,
    kicker: pkg.version ? `v${pkg.version}` : "unpublished",
    chips,
  });
}
