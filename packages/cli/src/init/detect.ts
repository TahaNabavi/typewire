import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { exists } from "../config/fs";
import { CONFIG_FILE_NAMES } from "../config";

export type PackageManager = "pnpm" | "yarn" | "bun" | "npm";

export type Framework =
  | "next"
  | "remix"
  | "react"
  | "vue"
  | "nuxt"
  | "svelte"
  | "solid"
  | "astro"
  | "nest"
  | "express"
  | "node"
  | "unknown";

export type ProjectInfo = {
  /** Where the wizard writes — the nearest directory with a package.json. */
  root: string;
  name: string | undefined;
  framework: Framework;
  frameworkLabel: string;
  typescript: boolean;
  /** React-flavoured: hooks and the devtools panel are worth offering. */
  react: boolean;
  /** Server-side: a NestJS or Express project wants the server adapters. */
  server: boolean;
  /** Built by Vite, which changes how env vars are read in client code. */
  vite: boolean;
  packageManager: PackageManager;
  monorepo: boolean;
  /** `"src"` when it exists, otherwise `"."`. */
  sourceDir: string;
  /** An existing TypeWire config, if the project already has one. */
  existingConfig: string | undefined;
  /** `@tahanabavi/*` packages already in the manifest. */
  installed: Set<string>;
};

type Manifest = {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: unknown;
};

/**
 * Read the project rather than asking about it.
 *
 * Everything here is a *default* for a question the user can still answer
 * differently — detection that silently decides is worse than no detection,
 * because a wrong guess is invisible.
 */
export async function detectProject(cwd: string): Promise<ProjectInfo> {
  const root = (await findUp(cwd, "package.json")) ?? resolve(cwd);
  const manifest = await readManifest(join(root, "package.json"));

  const deps = {
    ...(manifest?.dependencies ?? {}),
    ...(manifest?.devDependencies ?? {}),
  };
  const has = (name: string) => name in deps;

  const framework = detectFramework(has);
  const vite = has("vite") || (await hasAnyFile(root, ["vite.config.ts", "vite.config.js"]));

  return {
    root,
    name: manifest?.name,
    framework,
    frameworkLabel: FRAMEWORK_LABELS[framework],
    typescript:
      has("typescript") || (await hasAnyFile(root, ["tsconfig.json"])),
    react: ["next", "remix", "react"].includes(framework) || has("react"),
    server: ["nest", "express"].includes(framework),
    vite,
    packageManager: await detectPackageManager(root),
    monorepo:
      manifest?.workspaces !== undefined ||
      (await hasAnyFile(root, ["pnpm-workspace.yaml", "lerna.json", "turbo.json"])),
    sourceDir: (await exists(join(root, "src"))) ? "src" : ".",
    existingConfig: await findExistingConfig(root),
    installed: new Set(
      Object.keys(deps).filter((name) => name.startsWith("@tahanabavi/")),
    ),
  };
}

const FRAMEWORK_LABELS: Record<Framework, string> = {
  next: "Next.js",
  remix: "Remix",
  react: "React",
  vue: "Vue",
  nuxt: "Nuxt",
  svelte: "Svelte",
  solid: "Solid",
  astro: "Astro",
  nest: "NestJS",
  express: "Express",
  node: "Node",
  unknown: "an unrecognised project",
};

/** Order matters: a Next.js project also depends on `react`. */
function detectFramework(has: (name: string) => boolean): Framework {
  if (has("next")) return "next";
  if (has("@remix-run/react") || has("@react-router/dev")) return "remix";
  if (has("nuxt")) return "nuxt";
  if (has("astro")) return "astro";
  if (has("@nestjs/core")) return "nest";
  if (has("svelte")) return "svelte";
  if (has("solid-js")) return "solid";
  if (has("vue")) return "vue";
  if (has("react")) return "react";
  if (has("express")) return "express";
  return "unknown";
}

/** The lockfile is the only honest answer; `packageManager` is often stale. */
async function detectPackageManager(root: string): Promise<PackageManager> {
  if (await exists(join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (await exists(join(root, "yarn.lock"))) return "yarn";
  if (await exists(join(root, "bun.lockb"))) return "bun";
  if (await exists(join(root, "package-lock.json"))) return "npm";

  const manifest = await readManifest(join(root, "package.json"));
  const declared = (manifest as { packageManager?: string })?.packageManager;
  if (declared?.startsWith("pnpm")) return "pnpm";
  if (declared?.startsWith("yarn")) return "yarn";
  if (declared?.startsWith("bun")) return "bun";

  return "npm";
}

export function installCommand(
  manager: PackageManager,
  packages: string[],
  dev: boolean,
): string {
  const list = packages.join(" ");
  switch (manager) {
    case "pnpm":
      return `pnpm add ${dev ? "-D " : ""}${list}`;
    case "yarn":
      return `yarn add ${dev ? "-D " : ""}${list}`;
    case "bun":
      return `bun add ${dev ? "-d " : ""}${list}`;
    case "npm":
      return `npm i ${dev ? "-D " : ""}${list}`;
  }
}

/**
 * How client code reads an API URL differs per framework, and getting it wrong
 * produces a file that looks right and is `undefined` at runtime.
 */
export function envAccessor(project: ProjectInfo): {
  expression: string;
  variable: string;
  file: string;
} {
  if (project.framework === "next") {
    return {
      expression: "process.env.NEXT_PUBLIC_API_URL",
      variable: "NEXT_PUBLIC_API_URL",
      file: ".env.local",
    };
  }

  if (project.framework === "nuxt") {
    return {
      expression: "process.env.NUXT_PUBLIC_API_URL",
      variable: "NUXT_PUBLIC_API_URL",
      file: ".env",
    };
  }

  if (project.vite) {
    return {
      expression: "import.meta.env.VITE_API_URL",
      variable: "VITE_API_URL",
      file: ".env",
    };
  }

  return {
    expression: "process.env.API_BASE_URL",
    variable: "API_BASE_URL",
    file: ".env",
  };
}

async function findExistingConfig(root: string): Promise<string | undefined> {
  for (const name of CONFIG_FILE_NAMES) {
    if (await exists(join(root, name))) return join(root, name);
  }
  return undefined;
}

async function readManifest(path: string): Promise<Manifest | undefined> {
  try {
    return JSON.parse(stripBom(await readFile(path, "utf8"))) as Manifest;
  } catch {
    return undefined;
  }
}

/**
 * Windows editors and PowerShell's `Out-File -Encoding utf8` write a UTF-8 BOM,
 * and `JSON.parse` throws on it. Without this, a BOM'd package.json makes every
 * detection silently fall back to "an unrecognised project" — and the wizard
 * scaffolds the wrong thing while reporting that it found nothing.
 */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

async function hasAnyFile(root: string, names: string[]): Promise<boolean> {
  for (const name of names) {
    if (await exists(join(root, name))) return true;
  }
  return false;
}

async function findUp(from: string, name: string): Promise<string | undefined> {
  let dir = resolve(from);

  for (;;) {
    if (await exists(join(dir, name))) return dir;

    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}
