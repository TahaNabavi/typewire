/**
 * Typed access to the generated package registry.
 *
 * The data behind this module is derived from the monorepo itself by
 * `scripts/generate-registry.mjs` — package manifests, READMEs, release-note
 * directories, size-budget.json, the root README's roadmap, and npm. Nothing
 * about a package is maintained by hand on the website side, so publishing a
 * package or editing its README is all it takes to update this site.
 */

import registry from "@/generated/registry.json";

export type PackageCategory = "core" | "transport" | "server" | "state" | "devtools" | "tooling";
export type Transport = "http" | "graphql" | "grpc" | "ws";

export interface Release {
  version: string;
  title: string;
  /** Repo-relative path, e.g. packages/typefetch/docs/releases/v2.0.0.md */
  path: string;
}

export interface PackageEntry {
  slug: string;
  npm: string;
  short: string;
  dir: string;
  path: string;
  localVersion: string;
  npmVersion: string | null;
  registryChecked: boolean;
  published: boolean;
  pendingVersion: string | null;
  version: string | null;
  description: string;
  tagline: string;
  keywords: string[];
  category: PackageCategory;
  transports: Transport[];
  runtimeDeps: string[];
  zeroDeps: boolean;
  peerDeps: string[];
  exports: string[];
  /** Gzipped ESM-entry ceiling from size-budget.json — a CI limit, not a measurement. */
  sizeCeilingGzip: number | null;
  sizeEntry: string | null;
  features: string[];
  install: string;
  banner: string | null;
  hasReadme: boolean;
  releases: Release[];
  /** null when the package ships no docs manifest — a CI failure, not a state. */
  docs: PackageDocs | null;
}

export interface DocHeading {
  depth: number;
  text: string;
  id: string;
}

export interface DocPage {
  slug: string;
  title: string;
  /** Repo-relative path to the source file, so a page can link to itself. */
  path: string;
  isReadme: boolean;
  markdown: string;
  headings: DocHeading[];
}

export interface PackageDocs {
  /** The package version these pages were reviewed against. */
  documentsVersion: string | null;
  summary: string | null;
  pages: DocPage[];
}

export interface RoadmapItem {
  title: string;
  detail: string | null;
}

export interface ExampleEntry {
  slug: string;
  name: string;
  description: string;
  tagline: string;
  path: string;
  commands: string[];
  /** The @tahanabavi/* packages the example builds against. */
  uses: string[];
}

interface Registry {
  generatedAt: string;
  source: string;
  registryComplete: boolean;
  packages: PackageEntry[];
  examples: ExampleEntry[];
  roadmap: { shipped: RoadmapItem[]; next: RoadmapItem[] };
}

const data = registry as unknown as Registry;

export const packages: PackageEntry[] = data.packages;
export const examples: ExampleEntry[] = data.examples;
export const roadmap = data.roadmap;
export const generatedAt = data.generatedAt;
/** False when npm could not be reached at build time — published flags are guesses. */
export const registryComplete = data.registryComplete;

export const publishedPackages = packages.filter((p) => p.published);
export const unpublishedPackages = packages.filter((p) => !p.published);

export function getPackage(slug: string): PackageEntry | undefined {
  return packages.find((p) => p.slug === slug);
}

export const CATEGORY_ORDER: PackageCategory[] = [
  "core",
  "transport",
  "server",
  "state",
  "devtools",
  "tooling",
];

export const CATEGORY_LABEL: Record<PackageCategory, string> = {
  core: "Core",
  transport: "Transports",
  server: "Server",
  state: "State",
  devtools: "Devtools",
  tooling: "Tooling",
};

export const TRANSPORT_LABEL: Record<Transport, string> = {
  http: "HTTP",
  graphql: "GraphQL",
  grpc: "gRPC",
  ws: "WebSocket",
};

/** The one hard visual rule — a wire always gets the same colour. */
export const TRANSPORT_TOKEN: Record<Transport, string> = {
  http: "var(--wire-http)",
  graphql: "var(--wire-graphql)",
  grpc: "var(--wire-grpc)",
  ws: "var(--wire-ws)",
};

export function packagesByCategory(): Array<{ category: PackageCategory; items: PackageEntry[] }> {
  return CATEGORY_ORDER.map((category) => ({
    category,
    items: packages.filter((p) => p.category === category),
  })).filter((group) => group.items.length > 0);
}

/** GitHub links derived from the package's location in the repo. */
export function repoUrls(pkg: PackageEntry, repoUrl: string, branch = "main") {
  return {
    source: `${repoUrl}/tree/${branch}/${pkg.path}`,
    readme: `${repoUrl}/blob/${branch}/${pkg.path}/README.md`,
    release: (r: Release) => `${repoUrl}/blob/${branch}/${r.path}`,
    npm: `https://www.npmjs.com/package/${pkg.npm}`,
  };
}

/**
 * The install command the site puts in front of a reader.
 *
 * `npx typewire init` is the front door — it is what the CLI's own docs
 * describe, and what the project wants people to type. So it is the headline
 * everywhere, unconditionally.
 *
 * What is conditional is the promise around it: @tahanabavi/typewire-cli is
 * not on npm yet, and a command that fails on a clean machine has to say so
 * rather than let a reader discover it in a terminal. `available` carries that,
 * and flips on its own the moment the CLI publishes, because `published` comes
 * from the registry rather than from a constant here.
 */
const CLI = "@tahanabavi/typewire-cli";
const CORE = "@tahanabavi/typefetch";

export const cliPublished = packages.some((p) => p.npm === CLI && p.published);

export const install = {
  /**
   * The base command. It reads the project — framework, package manager,
   * TypeScript, which `@tahanabavi/*` packages are already there — then asks
   * what the project needs and wires it up.
   */
  primary: "npx typewire init",
  /** True once the CLI is on npm, so that line runs on a clean machine. */
  available: cliPublished,
  /** What to type meanwhile: the published core, added by hand. */
  today: `pnpm add ${CORE}`,
} as const;

/** Packages that ship a docs manifest, in the registry's stable order. */
export const documentedPackages = packages.filter(
  (p): p is PackageEntry & { docs: PackageDocs } => p.docs !== null && p.docs.pages.length > 0,
);

export function getDocPage(pkg: PackageEntry, slug: string): DocPage | undefined {
  return pkg.docs?.pages.find((page) => page.slug === slug);
}

/**
 * True when the docs were last reviewed against an older minor or major of the
 * package — the same rule scripts/check-docs.mjs enforces in CI. The site shows
 * it as a badge rather than hiding it: a reader deserves to know a page may
 * describe an older release.
 */
export function docsBehind(pkg: PackageEntry): boolean {
  const documented = pkg.docs?.documentsVersion;
  const current = pkg.version ?? pkg.localVersion;
  if (!documented || !current) return false;
  const [dMajor, dMinor] = documented.split(".").map(Number);
  const [cMajor, cMinor] = current.split(".").map(Number);
  return cMajor !== dMajor || cMinor !== dMinor;
}
