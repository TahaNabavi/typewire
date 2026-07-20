import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { TypeFetchCliTestConfig } from "./types";

const DEFAULT_CONFIG_FILES = [
  "typefetch.test.config.ts",
  "typefetch.test.config.mts",
  "typefetch.test.config.cts",
  "typefetch.test.config.js",
  "typefetch.test.config.mjs",
  "typefetch.test.config.cjs",
];

export async function loadCliConfig(
  configPath?: string,
): Promise<TypeFetchCliTestConfig> {
  const resolvedPath = configPath
    ? resolve(process.cwd(), configPath)
    : await findDefaultConfigPath();

  if (!resolvedPath) {
    throw new Error(
      `TypeFetch config was not found. Create one with: typefetch init`,
    );
  }

  const moduleValue = await importConfigModule(resolvedPath);
  const config = moduleValue.default ?? moduleValue.config ?? moduleValue;

  if (!config || typeof config !== "object") {
    throw new Error(`Invalid TypeFetch config at ${resolvedPath}`);
  }

  if (!config.contracts) {
    throw new Error(`TypeFetch config is missing "contracts" at ${resolvedPath}`);
  }

  if (!config.client && !config.createClient) {
    throw new Error(
      `TypeFetch config must provide either "client" or "createClient" at ${resolvedPath}`,
    );
  }

  return config as TypeFetchCliTestConfig;
}

async function findDefaultConfigPath(): Promise<string | undefined> {
  for (const fileName of DEFAULT_CONFIG_FILES) {
    const fullPath = resolve(process.cwd(), fileName);
    if (await exists(fullPath)) return fullPath;
  }

  return undefined;
}

async function importConfigModule(fullPath: string): Promise<any> {
  if (/\.(ts|tsx|mts|cts)$/.test(fullPath)) {
    return importTypeScriptConfig(fullPath);
  }

  const url = pathToFileURL(fullPath).href;
  return import(`${url}?t=${Date.now()}`);
}

async function importTypeScriptConfig(fullPath: string): Promise<any> {
  try {
    const jitiModule = (await import("jiti")) as any;
    const createJiti = jitiModule.createJiti ?? jitiModule.default?.createJiti;
    if (!createJiti) throw new Error("createJiti export was not found");

    const jiti = createJiti(process.cwd());
    return jiti.import(fullPath, { default: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not load TypeScript config: ${fullPath}\n` +
        `Install jiti to use .ts config files: npm i -D jiti\n` +
        `Original error: ${message}`,
    );
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
