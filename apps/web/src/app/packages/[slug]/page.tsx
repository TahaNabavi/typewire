import type { Metadata } from "next";

import { PackageDetail } from "@/features/packages/detail";
import { clampDescription, pageMetadata } from "@/lib/seo";
import { getPackage, packages } from "@/lib/registry";

export function generateStaticParams() {
  return packages.map((pkg) => ({ slug: pkg.slug }));
}

/**
 * The description a result snippet shows is the package's own — the one in its
 * package.json, which npm shows too. A reader who meets the package in both
 * places should not meet two different summaries of it.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const pkg = getPackage(slug);
  if (!pkg) return {};

  return pageMetadata({
    title: pkg.short,
    // The package's own words, cut to what a snippet shows. Several of these run
    // past 240 characters, which Google truncates mid-word.
    description: clampDescription(pkg.description || pkg.tagline),
    path: `/packages/${pkg.slug}`,
    keywords: [pkg.npm, pkg.short, ...pkg.keywords],
    // An unpublished package has a page so the ecosystem reads whole, but it is
    // not a thing anyone can install yet — keeping it out of the index means no
    // one arrives from a search at a package that does not exist on npm.
    noIndex: !pkg.published,
  });
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <PackageDetail slug={slug} />;
}
