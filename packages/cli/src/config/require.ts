import { TypeWireConfigError } from './errors'
import type {
  ResolvedProject,
  ResolvedTypeFetchSection,
  ResolvedTypeWireConfig,
} from './types'
import type {
  TypeFetchClientLike,
  TypeFetchCreateClientOptions,
} from '../types'

/**
 * The projects a command should operate on.
 *
 * With no `--project`, every project runs. That is the right default for a
 * repo with `dashboard`, `admin` and `landing`: a CI gate that quietly checked
 * only one of three API surfaces is worse than no gate, because it reports
 * green.
 */
export function selectProjects(
  config: ResolvedTypeWireConfig,
  filter?: string[]
): ResolvedProject[] {
  if (!filter?.length) return config.projects

  const available = config.projects.map((project) => project.name)
  const unknown = filter.filter((name) => !available.includes(name))

  if (unknown.length) {
    throw new TypeWireConfigError(
      `No project named ${unknown.map((n) => `"${n}"`).join(', ')} in ${config.path}.\n` +
        `Available: ${available.join(', ')}`,
      { source: config.path, key: 'projects' }
    )
  }

  return config.projects.filter((project) => filter.includes(project.name))
}

/**
 * The typefetch section of a project, or an error naming what is missing.
 *
 * A project that declares only `typesocket` is legitimate — it just cannot be
 * the target of a typefetch command, and saying so beats an empty result.
 */
export function requireProjectTypeFetch(
  project: ResolvedProject,
  command: string,
  source: string
): ResolvedTypeFetchSection {
  if (project.typefetch) return project.typefetch

  throw new TypeWireConfigError(
    project.implicit
      ? `"${command}" needs a "typefetch" section, and ${source} does not declare one.`
      : `"${command}" needs a "typefetch" section, and project "${project.name}" ` +
          `in ${source} does not declare one.`,
    {
      source,
      key: project.implicit
        ? 'typefetch'
        : `projects.${project.name}.typefetch`,
    }
  )
}

/**
 * Per-command requirements, checked where they are actually needed.
 *
 * The old loader demanded `client` or `createClient` from every config, which
 * meant `lint` could not run without a live API client — see `docs/CLI.md` §2.
 * The rule now: the *file* requires `contracts`; the *command* requires whatever
 * it uses, and says which command is asking.
 */
export function requireTypeFetch(
  config: ResolvedTypeWireConfig,
  command: string
): ResolvedTypeFetchSection {
  if (config.projects.length > 1) {
    throw new TypeWireConfigError(
      `${config.path} declares ${config.projects.length} projects ` +
        `(${config.projects.map((p) => p.name).join(', ')}), so "${command}" ` +
        `cannot pick one for you.\n` +
        `Run it against all of them, or name one with --project <name>.`,
      { source: config.path, key: 'projects' }
    )
  }

  return requireProjectTypeFetch(config.projects[0]!, command, config.path)
}

export async function resolveTypeFetchClient(
  section: ResolvedTypeFetchSection,
  command: string,
  options: TypeFetchCreateClientOptions,
  source: string,
  project?: ResolvedProject
): Promise<TypeFetchClientLike> {
  if (section.createClient) return section.createClient(options)
  if (section.client) return section.client

  const where =
    project && !project.implicit
      ? `the typefetch section of project "${project.name}" in ${source}`
      : `the typefetch section of ${source}`

  throw new TypeWireConfigError(
    `"${command}" makes real requests, so it needs a client.\n` +
      `Add "createClient" to ${where} ` +
      `(preferred — it receives --base-url and --token), or "client" for a fixed one.`,
    {
      source,
      key:
        project && !project.implicit
          ? `projects.${project.name}.typefetch.createClient`
          : 'typefetch.createClient',
    }
  )
}
