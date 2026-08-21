import { configError, describeValue, TypeWireConfigError } from "./errors";
import { mergeConfig } from "./merge";
import {
  DIFF_FAIL_ON,
  LINT_SEVERITIES,
  type LintConfig,
  type ResolvedProject,
  type ResolvedTypeFetchSection,
  type ResolvedTypeWireConfig,
  type TypeFetchSection,
  type TypeWireConfig,
} from "./types";

const SECTIONS = ["typefetch", "typesocket", "permission"] as const;
const TOP_LEVEL_KEYS = new Set<string>([
  ...SECTIONS,
  "extends",
  "lint",
  "diff",
  "projects",
]);

/**
 * The pre-2.0 file put the typefetch section's keys at the top level. Any of
 * these appearing there identifies it — `contracts` alone is not enough, since
 * someone could reasonably write a config that only declares contracts.
 */
const LEGACY_TOP_LEVEL_KEYS = [
  "contracts",
  "client",
  "createClient",
  "options",
  "context",
  "report",
] as const;

export function isLegacyShape(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (SECTIONS.some((section) => section in value)) return false;
  return LEGACY_TOP_LEVEL_KEYS.some((key) => key in value);
}

/** `{ contracts, createClient, … }` → `{ typefetch: { contracts, … } }`. */
export function liftLegacyShape(value: Record<string, unknown>): TypeWireConfig {
  const { extends: extended, lint, diff, ...section } = value;

  return {
    ...(extended !== undefined ? { extends: extended as string | string[] } : {}),
    ...(lint !== undefined ? { lint: lint as LintConfig } : {}),
    ...(diff !== undefined ? { diff: diff as ResolvedTypeWireConfig["diff"] } : {}),
    typefetch: section as unknown as TypeFetchSection,
  };
}

/**
 * Validate and flatten. Every command reads the result of this function, so
 * back-compat lives here and nowhere else.
 */
export function normalizeConfig(
  raw: unknown,
  context: { path: string; sources: string[]; legacy: boolean; onWarn: (message: string) => void },
): ResolvedTypeWireConfig {
  const { path, onWarn } = context;

  if (!isObject(raw)) {
    throw new TypeWireConfigError(
      `Config at ${path} exported ${describeValue(raw)}. ` +
        `Export an object, or a function returning one, as the default export.`,
      { source: path },
    );
  }

  for (const key of Object.keys(raw)) {
    if (!TOP_LEVEL_KEYS.has(key)) {
      onWarn(
        `Unknown top-level key "${key}" in ${path}. ` +
          `Known keys: ${[...TOP_LEVEL_KEYS].sort().join(", ")}.` +
          suggest(key, [...TOP_LEVEL_KEYS]),
      );
    }
  }

  const config = raw as TypeWireConfig;

  const lint = validateLint(config.lint, "lint", path);
  const diff = validateDiff(config.diff, "diff", path);

  const projects = resolveProjects(config, { path, lint, diff, onWarn });

  // The convenience accessors only exist when there is one project — see
  // `ResolvedTypeWireConfig.typefetch`.
  const sole = projects.length === 1 ? projects[0] : undefined;

  return {
    path,
    sources: context.sources,
    legacy: context.legacy,
    lint,
    diff,
    projects,
    ...(sole?.typefetch !== undefined ? { typefetch: sole.typefetch } : {}),
    ...(sole?.typesocket !== undefined ? { typesocket: sole.typesocket } : {}),
    ...(sole?.permission !== undefined ? { permission: sole.permission } : {}),
  };
}

/**
 * Flatten `projects` — or synthesise the single implicit one.
 *
 * Top-level `lint`/`diff` are defaults a project may override, so shared rules
 * are written once. Sections at the top level *and* a `projects` block is
 * ambiguous — which surface do the top-level contracts belong to? — so it is
 * refused rather than guessed.
 */
function resolveProjects(
  config: TypeWireConfig,
  context: {
    path: string;
    lint: LintConfig;
    diff: ResolvedTypeWireConfig["diff"];
    onWarn: (message: string) => void;
  },
): ResolvedProject[] {
  const { path, onWarn } = context;
  const topLevelSections = SECTIONS.filter(
    (section) => config[section] !== undefined,
  );

  if (config.projects === undefined) {
    if (!topLevelSections.length) {
      throw new TypeWireConfigError(
        `Config at ${path} declares no package sections. ` +
          `Add at least one of: ${SECTIONS.join(", ")} — or a "projects" block ` +
          `if this repo has several API surfaces.`,
        { source: path },
      );
    }

    return [
      buildProject("default", config, { ...context, implicit: true, key: "" }),
    ];
  }

  if (!isObject(config.projects)) {
    throw configError(
      "projects",
      `expected an object of name → project, received ${describeValue(config.projects)}`,
      path,
    );
  }

  if (topLevelSections.length) {
    throw new TypeWireConfigError(
      `Config at ${path} declares "projects" and also a top-level ` +
        `${topLevelSections.map((s) => `"${s}"`).join(", ")} section.\n` +
        `Which project do those contracts belong to? Move them into a project. ` +
        `Only "lint" and "diff" belong at the top level, as defaults every ` +
        `project inherits.`,
      { source: path, key: topLevelSections[0] },
    );
  }

  const names = Object.keys(config.projects);
  if (!names.length) {
    throw configError("projects", `is empty — declare at least one`, path);
  }

  return names.map((name) => {
    const project = (config.projects as Record<string, unknown>)[name];

    if (!isObject(project)) {
      throw configError(
        `projects.${name}`,
        `expected an object, received ${describeValue(project)}`,
        path,
      );
    }

    if ("projects" in project) {
      throw configError(
        `projects.${name}.projects`,
        `projects cannot nest — add another entry beside "${name}" instead`,
        path,
      );
    }

    if (!SECTIONS.some((section) => (project as TypeWireConfig)[section])) {
      throw configError(
        `projects.${name}`,
        `declares no package sections. Add at least one of: ${SECTIONS.join(", ")}`,
        path,
      );
    }

    return buildProject(name, project as TypeWireConfig, {
      ...context,
      implicit: false,
      key: `projects.${name}.`,
    });
  });
}

function buildProject(
  name: string,
  source: TypeWireConfig,
  context: {
    path: string;
    lint: LintConfig;
    diff: ResolvedTypeWireConfig["diff"];
    implicit: boolean;
    key: string;
    onWarn: (message: string) => void;
  },
): ResolvedProject {
  const { path, key, onWarn } = context;

  // A project's own lint/diff override the shared ones key by key, so
  // `rules: { "duplicate-id": "off" }` in one project keeps the rest.
  const lint = source.lint
    ? mergeConfig(context.lint, validateLint(source.lint, `${key}lint`, path))
    : context.lint;
  const diff = source.diff
    ? mergeConfig(context.diff, validateDiff(source.diff, `${key}diff`, path))
    : context.diff;

  return {
    name,
    implicit: context.implicit,
    lint,
    diff,
    ...(source.typefetch !== undefined
      ? { typefetch: validateTypeFetch(source.typefetch, path, onWarn, key) }
      : {}),
    ...(source.typesocket !== undefined ? { typesocket: source.typesocket } : {}),
    ...(source.permission !== undefined ? { permission: source.permission } : {}),
  };
}

function validateTypeFetch(
  section: unknown,
  path: string,
  onWarn: (message: string) => void,
  keyPrefix = "",
): ResolvedTypeFetchSection {
  const at = (suffix: string) => `${keyPrefix}typefetch${suffix}`;

  if (!isObject(section)) {
    throw configError(at(""), `expected an object, received ${describeValue(section)}`, path);
  }

  const value = section as TypeFetchSection;

  if (!isObject(value.contracts)) {
    throw configError(
      at(".contracts"),
      `expected an object of contract modules, received ${describeValue(value.contracts)}`,
      path,
    );
  }

  if (value.createClient !== undefined && typeof value.createClient !== "function") {
    throw configError(
      at(".createClient"),
      `expected a function, received ${describeValue(value.createClient)}`,
      path,
    );
  }

  if (value.client !== undefined && !isObject(value.client)) {
    throw configError(
      at(".client"),
      `expected a client instance, received ${describeValue(value.client)}`,
      path,
    );
  }

  if (value.transports !== undefined) {
    if (!Array.isArray(value.transports)) {
      throw configError(
        at(".transports"),
        `expected an array of transport adapters, received ${describeValue(value.transports)}`,
        path,
      );
    }

    for (const [index, adapter] of value.transports.entries()) {
      // Catching this here beats a `?` in a listing: an adapter passed as the
      // factory rather than its result is the mistake this shape invites.
      if (!isObject(adapter) || typeof adapter.kind !== "string") {
        throw configError(
          at(`.transports[${index}]`),
          typeof adapter === "function"
            ? `received a function — call it, e.g. grpcTransport()`
            : `expected a transport adapter, received ${describeValue(adapter)}`,
          path,
        );
      }
    }
  }

  // Flatten the pre-`test:{}` shape. Explicit `test` wins over the loose keys,
  // so a half-migrated file behaves the way its author most likely meant.
  const loose = {
    ...(value.options !== undefined ? { options: value.options } : {}),
    ...(value.context !== undefined ? { context: value.context } : {}),
    ...(value.report !== undefined ? { report: value.report } : {}),
  };

  if (Object.keys(loose).length) {
    onWarn(
      `${Object.keys(loose).join(", ")} at the top of the typefetch section ` +
        `${Object.keys(loose).length === 1 ? "is" : "are"} deprecated — ` +
        `move ${Object.keys(loose).length === 1 ? "it" : "them"} under "test". ` +
        `Run: typewire codemod config`,
    );
  }

  const test = { ...loose, ...(value.test ?? {}) };

  return {
    contracts: value.contracts,
    ...(value.client !== undefined ? { client: value.client } : {}),
    ...(value.createClient !== undefined ? { createClient: value.createClient } : {}),
    ...(value.transports !== undefined ? { transports: value.transports } : {}),
    ...(value.generate !== undefined ? { generate: value.generate } : {}),
    ...(value.mock !== undefined ? { mock: value.mock } : {}),
    lint: validateLint(value.lint, at(".lint"), path),
    diff: validateDiff(value.diff, at(".diff"), path),
    test,
  };
}

function validateLint(value: unknown, key: string, path: string): LintConfig {
  if (value === undefined) return {};
  if (!isObject(value)) {
    throw configError(key, `expected an object, received ${describeValue(value)}`, path);
  }

  const rules = (value as LintConfig).rules;
  if (rules === undefined) return value as LintConfig;

  if (!isObject(rules)) {
    throw configError(
      `${key}.rules`,
      `expected an object of rule → severity, received ${describeValue(rules)}`,
      path,
    );
  }

  for (const [rule, severity] of Object.entries(rules)) {
    if (!LINT_SEVERITIES.includes(severity)) {
      throw configError(
        `${key}.rules["${rule}"]`,
        `expected one of ${LINT_SEVERITIES.join(" | ")}, received ${describeValue(severity)}`,
        path,
      );
    }
  }

  return value as LintConfig;
}

function validateDiff(
  value: unknown,
  key: string,
  path: string,
): ResolvedTypeWireConfig["diff"] {
  if (value === undefined) return {};
  if (!isObject(value)) {
    throw configError(key, `expected an object, received ${describeValue(value)}`, path);
  }

  const failOn = (value as { failOn?: unknown }).failOn;
  if (failOn !== undefined && !DIFF_FAIL_ON.includes(failOn as never)) {
    throw configError(
      `${key}.failOn`,
      `expected one of ${DIFF_FAIL_ON.join(" | ")}, received ${describeValue(failOn)}`,
      path,
    );
  }

  return value as ResolvedTypeWireConfig["diff"];
}

/** `typeFetch` → `typefetch`. A casing typo is the likeliest unknown key. */
function suggest(key: string, known: string[]): string {
  const lowered = key.toLowerCase().replace(/[-_]/g, "");
  const match = known.find((k) => k.toLowerCase().replace(/[-_]/g, "") === lowered);
  return match ? ` Did you mean "${match}"?` : "";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
