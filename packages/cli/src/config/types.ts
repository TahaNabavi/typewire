import type {
  ApiTestRunnerOptions,
  Contracts,
  TransportAdapter,
} from '@tahanabavi/typefetch'
import type {
  TypeFetchClientLike,
  TypeFetchCreateClientOptions,
  TypeFetchReportConfig,
} from '../types'

/** Severity for a single lint rule. */
export type LintSeverity = 'off' | 'warn' | 'error'

export const LINT_SEVERITIES: readonly LintSeverity[] = ['off', 'warn', 'error']

/** Shared by every section; a section may override it. */
export type LintConfig = {
  rules?: Record<string, LintSeverity>
}

export type DiffFailOn = 'none' | 'breaking' | 'any'

export const DIFF_FAIL_ON: readonly DiffFailOn[] = ['none', 'breaking', 'any']

export type DiffConfig = {
  /** Path to the committed API-surface snapshot. */
  baseline?: string
  failOn?: DiffFailOn
}

export type GenerateConfig = {
  openapi?: { out?: string; title?: string; version?: string }
}

export type MockConfig = {
  port?: number
  /** Makes generated data deterministic, which is what makes it usable in e2e runs. */
  seed?: number
}

/** The `test` command's own options — today's config, one level down. */
export type TestConfig = {
  options?: ApiTestRunnerOptions
  context?: Record<string, unknown>
  report?: TypeFetchReportConfig
}

/**
 * The `typefetch` section.
 *
 * `contracts` is the only always-required key. `client`/`createClient` are
 * required *by the commands that make requests*, not by the file — see
 * `requireClient`. `docs/CLI.md` §2: requiring a live client in order to lint a
 * contract file is the difference between a check that runs on every commit and
 * one that never gets wired up.
 */
export type TypeFetchSection<C extends Contracts = Contracts> = {
  contracts: C

  /** Use `client` for simple projects. */
  client?: TypeFetchClientLike

  /** Prefer `createClient` so `--base-url` and `--token` reach the client. */
  createClient?: (
    options: TypeFetchCreateClientOptions
  ) => TypeFetchClientLike | Promise<TypeFetchClientLike>

  /**
   * Transport adapters, for the commands that never build a client.
   *
   * `method` and `path` exist only on http endpoints, so anything that prints a
   * route has to ask the adapter — and a command like `list` has no client to
   * ask. Declaring them here is what lets a gRPC route print
   * `unary user.v1.UserService/GetUser` instead of `?`, without giving up the
   * property that `list` runs against an unreachable API.
   *
   * The built-in http adapter is always present; only add the extras.
   */
  transports?: TransportAdapter[]

  test?: TestConfig
  generate?: GenerateConfig
  mock?: MockConfig
  lint?: LintConfig
  diff?: DiffConfig

  /**
   * Accepted at the section level for the pre-`test:{}` shape. Normalised into
   * `test` at load time, so commands only ever read one place.
   *
   * @deprecated Move these under `test`.
   */
  options?: ApiTestRunnerOptions
  /** @deprecated Move this under `test`. */
  context?: Record<string, unknown>
  /** @deprecated Move this under `test`. */
  report?: TypeFetchReportConfig
}

/** Placeholder shapes: the sections exist so the file never needs renaming. */
export type TypeSocketSection = {
  events?: unknown
  lint?: LintConfig
  diff?: DiffConfig
}

export type PermissionSection = {
  /** A flag map, or a path to the module exporting one. */
  flags?: unknown
  lint?: LintConfig
  diff?: DiffConfig
}

/**
 * One API surface: its sections, plus any shared settings it overrides.
 *
 * A project cannot itself contain `projects` — one level only. Nesting buys
 * nothing an extra named project does not, and every command would have to
 * flatten it anyway.
 */
export type ProjectConfig<C extends Contracts = Contracts> = {
  lint?: LintConfig
  diff?: DiffConfig

  typefetch?: TypeFetchSection<C>
  typesocket?: TypeSocketSection
  permission?: PermissionSection
}

/** What the user writes in `typewire.config.ts`. */
export type TypeWireConfig<C extends Contracts = Contracts> =
  ProjectConfig<C> & {
    /**
     * A base config to inherit from — a path, or a package name resolvable from
     * this file. Large orgs are monorepos; a shared base with per-package
     * overrides is table stakes.
     */
    extends?: string | string[]

    /**
     * Several API surfaces in one project — `dashboard`, `admin`, `landing` —
     * each with its own contracts, client, middleware and base URL.
     *
     * One config rather than three, because the alternative is three files,
     * three `--config` flags in every script, and three CI steps that drift.
     * Keys at the top level are defaults each project may override, so shared
     * lint rules are written once.
     *
     * Omit it entirely for the single-API case: nothing about one API should
     * cost the ceremony of naming it.
     */
    projects?: Record<string, ProjectConfig>
  }

/** What a function config receives, so one file can cover several environments. */
export type ConfigEnv = {
  /**
   * `--mode`, verbatim. For `test` this is also the runner's mode
   * (`schema|mock|live|full`); for every other command it is yours to name.
   */
  mode: string | undefined
  /** The command being run, e.g. `test`. */
  command: string | undefined
  cwd: string
  /** `CI` is set in the environment — usually what `--mode ci` was standing in for. */
  ci: boolean
}

/** A config file may export the object, or a function returning it. */
export type TypeWireConfigInput<C extends Contracts = Contracts> =
  | TypeWireConfig<C>
  | ((env: ConfigEnv) => TypeWireConfig<C> | Promise<TypeWireConfig<C>>)

/** The `typefetch` section after normalisation — `test` is always present. */
export type ResolvedTypeFetchSection = Omit<
  TypeFetchSection,
  'options' | 'context' | 'report' | 'test'
> & { test: TestConfig }

/** One resolved API surface. */
export type ResolvedProject = {
  /**
   * The project's key, or `"default"` for a config that declares no `projects`.
   * Commands print it, so it is always a real name.
   */
  name: string
  /** True when the config never declared `projects` — used to keep output quiet. */
  implicit: boolean

  lint: LintConfig
  diff: DiffConfig

  typefetch?: ResolvedTypeFetchSection
  typesocket?: TypeSocketSection
  permission?: PermissionSection
}

/**
 * What every command consumes. The loader owns all back-compat, so a command
 * never asks "was this the old shape or the new one".
 */
export type ResolvedTypeWireConfig = {
  /** Absolute path of the file the config was loaded from. */
  path: string
  /** Every file that contributed, base-most first — the `extends` chain, then this file. */
  sources: string[]
  /** True when loaded from a legacy `typefetch.test.config.*` filename. */
  legacy: boolean

  lint: LintConfig
  diff: DiffConfig

  /**
   * Always at least one entry.
   *
   * A single-API config resolves to one implicit project, so no command has to
   * branch on whether `projects` was used — the multi-API case is the only
   * shape, and the single one is a length-1 instance of it.
   */
  projects: ResolvedProject[]

  /**
   * The sole project's typefetch section, when there is exactly one project.
   *
   * A convenience for the common case *and* for back-compat. Deliberately
   * `undefined` when several projects exist rather than silently picking the
   * first: guessing which API the user meant is how the wrong one gets tested.
   */
  typefetch?: ResolvedTypeFetchSection
  typesocket?: TypeSocketSection
  permission?: PermissionSection
}
