import { createRequire } from "node:module";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { exists } from "./fs";
import { mergeConfig } from "./merge";
import { isLegacyShape, liftLegacyShape, normalizeConfig } from "./normalize";
import { readTsconfigAliases } from "./tsconfig-paths";
import { TypeWireConfigError } from "./errors";
import type { ConfigEnv, ResolvedTypeWireConfig } from "./types";

const EXTENSIONS = [".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"] as const;

/** Preferred first. The legacy name still loads, and warns. */
const BASENAMES = ["typewire.config", "typefetch.test.config"] as const;

export const CONFIG_FILE_NAMES: readonly string[] = BASENAMES.flatMap((base) =>
  EXTENSIONS.map((extension) => `${base}${extension}`),
);

/** The name `init` and the wizard write. */
export const PREFERRED_CONFIG_FILE = "typewire.config.ts";

function isLegacyName(path: string): boolean {
  return /typefetch\.test\.config\.[mc]?[jt]s$/.test(path);
}

export type LoadConfigOptions = {
  /** `--config`. Resolved against `cwd`; a miss is an error, never a fallback. */
  configPath?: string;
  cwd?: string;
  /** `--mode`, handed to a function config. */
  mode?: string;
  /** The running command, handed to a function config. */
  command?: string;
  onWarn?: (message: string) => void;
};

/**
 * Find, load, merge and validate `typewire.config.ts`.
 *
 * Discovery walks up from `cwd`, so a package inside a monorepo inherits the
 * root config without a `--config` flag in every script.
 */
export async function loadTypeWireConfig(
  options: LoadConfigOptions = {},
): Promise<ResolvedTypeWireConfig> {
  const cwd = options.cwd ?? process.cwd();
  const onWarn = options.onWarn ?? defaultWarn;

  const path = options.configPath
    ? await resolveExplicitPath(options.configPath, cwd)
    : await findConfigFile(cwd);

  if (!path) {
    throw new TypeWireConfigError(
      `No TypeWire config found. Searched for ${BASENAMES[0]}.{${EXTENSIONS.map((e) => e.slice(1)).join(",")}} ` +
        `in ${cwd} and every parent directory.\n` +
        `Create one with: typewire init`,
    );
  }

  const legacy = isLegacyName(path);
  if (legacy) {
    onWarn(
      `${path} uses the old config name. Rename it to ${PREFERRED_CONFIG_FILE} — ` +
        `the CLI now covers every TypeWire package, not just typefetch, and the ` +
        `old name will stop being read in v3.\n` +
        `Run: typewire codemod config`,
    );
  }

  const env: ConfigEnv = {
    mode: options.mode,
    command: options.command,
    cwd,
    ci: Boolean(process.env.CI),
  };
  const sources: string[] = [];
  const loader = createLoader();

  const raw = await loadWithExtends(path, env, new Set(), sources, loader);

  return normalizeConfig(raw, { path, sources, legacy, onWarn });
}

/**
 * Load one file plus its `extends` chain, base-most first so the file that
 * names the base always wins.
 */
async function loadWithExtends(
  path: string,
  env: ConfigEnv,
  seen: Set<string>,
  sources: string[],
  loader: Loader,
): Promise<unknown> {
  if (seen.has(path)) {
    throw new TypeWireConfigError(
      `Circular "extends" in the TypeWire config: ${[...seen, path].join(" → ")}`,
      { source: path, key: "extends" },
    );
  }
  seen.add(path);

  const loaded = await loader.import(path, env);
  const value = isLegacyShape(loaded)
    ? liftLegacyShape(loaded as Record<string, unknown>)
    : loaded;

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    sources.push(path);
    return value;
  }

  const { extends: extended, ...own } = value as Record<string, unknown> & {
    extends?: string | string[];
  };

  let merged: unknown = {};

  for (const reference of toArray(extended)) {
    const basePath = resolveExtends(reference, path);
    const base = await loadWithExtends(basePath, env, seen, sources, loader);
    merged = mergeConfig(merged, base);
  }

  sources.push(path);
  return mergeConfig(merged, own);
}

function resolveExtends(reference: string, fromFile: string): string {
  const fromDir = dirname(fromFile);

  if (reference.startsWith(".") || isAbsolute(reference)) {
    return resolve(fromDir, reference);
  }

  // A shared config published as a package: `extends: "@acme/typewire-config"`.
  try {
    const require = createRequire(pathToFileURL(fromFile));
    return require.resolve(reference);
  } catch (error) {
    throw new TypeWireConfigError(
      `Could not resolve "${reference}" from ${fromFile}.\n` +
        `Use a relative path, or install the package that provides it.`,
      { source: fromFile, key: "extends", cause: error },
    );
  }
}

async function resolveExplicitPath(
  configPath: string,
  cwd: string,
): Promise<string> {
  const full = resolve(cwd, configPath);
  if (await exists(full)) return full;

  throw new TypeWireConfigError(
    `--config pointed at ${full}, which does not exist.`,
  );
}

async function findConfigFile(cwd: string): Promise<string | undefined> {
  let dir = resolve(cwd);

  for (;;) {
    for (const basename of BASENAMES) {
      for (const extension of EXTENSIONS) {
        const candidate = resolve(dir, `${basename}${extension}`);
        if (await exists(candidate)) return candidate;
      }
    }

    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

type Loader = { import: (path: string, env: ConfigEnv) => Promise<unknown> };

/**
 * One jiti instance per directory, because tsconfig aliases are per project —
 * in a monorepo the root base config and a package's config can legitimately
 * resolve `@/` to different places.
 */
function createLoader(): Loader {
  const instances = new Map<string, Promise<unknown>>();

  return {
    async import(path, env) {
      const module = /\.(ts|tsx|mts|cts)$/.test(path)
        ? await importTypeScript(path, instances)
        : await importJavaScript(path);

      return unwrap(module, env, path);
    },
  };
}

async function importJavaScript(path: string): Promise<unknown> {
  const url = pathToFileURL(path).href;
  // Cache-busted so a long-lived process (`--watch`, the test runner) picks up
  // an edited config instead of the first version it ever saw.
  return import(`${url}?t=${Date.now()}`);
}

async function importTypeScript(
  path: string,
  instances: Map<string, Promise<unknown>>,
): Promise<unknown> {
  const dir = dirname(path);

  let instance = instances.get(dir);
  if (!instance) {
    instance = createJitiFor(dir);
    instances.set(dir, instance);
  }

  const jiti = (await instance) as { import: (p: string, o: object) => Promise<unknown> };

  try {
    return await jiti.import(path, { default: false });
  } catch (error) {
    throw new TypeWireConfigError(
      `Failed to load ${path}.\n${error instanceof Error ? error.message : String(error)}`,
      { source: path, cause: error },
    );
  }
}

async function createJitiFor(dir: string): Promise<unknown> {
  let createJiti: ((dir: string, options?: object) => unknown) | undefined;

  try {
    const jitiModule = (await import("jiti")) as {
      createJiti?: typeof createJiti;
      default?: { createJiti?: typeof createJiti };
    };
    createJiti = jitiModule.createJiti ?? jitiModule.default?.createJiti;
  } catch (error) {
    throw new TypeWireConfigError(
      `jiti is required to read a TypeScript config file.\n` +
        `Install it with: npm i -D jiti\n` +
        `Original error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!createJiti) {
    throw new TypeWireConfigError(
      `The installed jiti does not export createJiti. Upgrade with: npm i -D jiti@latest`,
    );
  }

  const alias = await readTsconfigAliases(dir);
  return createJiti(dir, Object.keys(alias).length ? { alias } : {});
}

/** `export default`, `export const config`, or the module itself. */
async function unwrap(
  module: unknown,
  env: ConfigEnv,
  path: string,
): Promise<unknown> {
  const record = module as Record<string, unknown> | null;
  const value = record?.default ?? record?.config ?? module;

  // A function config is what makes `--mode ci` able to change the baseline or
  // the report format without a second file.
  if (typeof value === "function") {
    try {
      return await (value as (env: ConfigEnv) => unknown)(env);
    } catch (error) {
      throw new TypeWireConfigError(
        `The config function in ${path} threw.\n` +
          `${error instanceof Error ? error.message : String(error)}`,
        { source: path, cause: error },
      );
    }
  }

  return value;
}

function toArray(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function defaultWarn(message: string): void {
  console.warn(`warning  ${message}`);
}
