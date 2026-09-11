export { defineConfig, defineTypeFetchTestConfig } from './define'
export {
  CONFIG_FILE_NAMES,
  PREFERRED_CONFIG_FILE,
  loadTypeWireConfig,
} from './load'
export type { LoadConfigOptions } from './load'
export {
  requireProjectTypeFetch,
  requireTypeFetch,
  resolveTypeFetchClient,
  selectProjects,
} from './require'
export { TypeWireConfigError } from './errors'
export { mergeConfig } from './merge'
export { isLegacyShape, liftLegacyShape, normalizeConfig } from './normalize'
export { parseJsonc } from './jsonc'
export { readTsconfigAliases } from './tsconfig-paths'
export type {
  ConfigEnv,
  DiffConfig,
  DiffFailOn,
  GenerateConfig,
  LintConfig,
  LintSeverity,
  MockConfig,
  PermissionSection,
  ProjectConfig,
  ResolvedProject,
  ResolvedTypeFetchSection,
  ResolvedTypeWireConfig,
  TestConfig,
  TypeFetchSection,
  TypeSocketSection,
  TypeWireConfig,
  TypeWireConfigInput,
} from './types'
