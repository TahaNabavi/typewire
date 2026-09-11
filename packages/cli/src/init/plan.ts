import { join, relative, resolve } from 'node:path'
import { installCommand, envAccessor, type ProjectInfo } from './detect'
import { packagesFor, type FeatureId } from './features'
import {
  clientTemplate,
  configTemplate,
  contractsTemplate,
  devtoolsTemplate,
  envTemplate,
  indexTemplate,
  permissionsTemplate,
  providerTemplate,
  queryTemplate,
  socketTemplate,
  type TemplateContext,
} from './templates'

export type PlannedFile = {
  /** Absolute. */
  path: string
  content: string
  /** Why this file exists, shown in the confirmation. */
  purpose: string
}

export type InitPlan = {
  root: string
  files: PlannedFile[]
  runtime: string[]
  dev: string[]
  installCommands: string[]
  nextSteps: string[]
}

export type PlanOptions = {
  project: ProjectInfo
  features: Set<FeatureId>
  /** `--contracts-path`: point at contracts that already exist. */
  contractsPath?: string
  /** `--output`: scaffold somewhere other than the detected root. */
  output?: string
}

/**
 * Answers in, files out — with no filesystem access and no prompting.
 *
 * Keeping this pure is what makes the wizard testable: every combination of
 * framework and feature set can be asserted as file paths and contents without
 * driving a terminal.
 */
export function buildPlan(options: PlanOptions): InitPlan {
  const { project, features } = options
  const root = resolve(project.root, options.output ?? '.')
  const ts = project.typescript

  const ownsContracts = !options.contractsPath

  // Its own folder rather than loose files: a project already has an `api/` or
  // `lib/`, and scattering seven files into it is how a scaffold gets resented.
  const folder =
    project.sourceDir === '.'
      ? join(root, 'typewire')
      : join(root, project.sourceDir, 'typewire')

  const context: TemplateContext = {
    project,
    features,
    ts,
    ownsContracts,
    contractsModule:
      options.contractsPath ??
      `./${toPosix(relative(root, join(folder, 'contracts')))}`,
    clientModule: `./${toPosix(relative(root, join(folder, 'client')))}`,
  }

  const files: PlannedFile[] = []
  const file = (path: string, content: string, purpose: string) =>
    files.push({ path, content, purpose })

  file(
    join(root, ts ? 'typewire.config.ts' : 'typewire.config.mjs'),
    configTemplate(context),
    "the CLI's config — contracts, client, test and report settings"
  )

  if (ownsContracts) {
    file(
      join(folder, `contracts.${ts ? 'ts' : 'js'}`),
      contractsTemplate(context),
      'the single source of truth every other file reads'
    )
  }

  file(
    join(folder, `client.${ts ? 'ts' : 'js'}`),
    clientTemplate(context),
    'the client, built once'
  )

  if (features.has('query')) {
    file(
      join(folder, `query.${ts ? 'ts' : 'js'}`),
      queryTemplate(context),
      'the query cache, with invalidation declared at the setup site'
    )

    if (project.react) {
      file(
        join(folder, `provider.${ts ? 'tsx' : 'jsx'}`),
        providerTemplate(context),
        'the provider to wrap your app root with'
      )
    }
  }

  if (features.has('typesocket')) {
    file(
      join(folder, `socket.${ts ? 'ts' : 'js'}`),
      socketTemplate(context),
      'the WebSocket client'
    )
  }

  if (features.has('permission')) {
    file(
      join(folder, `permissions.${ts ? 'ts' : 'js'}`),
      permissionsTemplate(),
      'the permission bit map, shared by client and server'
    )
  }

  if (features.has('devtools')) {
    file(
      join(folder, `devtools.${ts ? 'tsx' : 'jsx'}`),
      devtoolsTemplate(context),
      'one bridge, every transport, rendered as a panel'
    )
  }

  file(
    join(folder, `index.${ts ? 'ts' : 'js'}`),
    indexTemplate(context),
    'a barrel, so the rest of your app imports one path'
  )

  file(
    join(root, 'typewire.env.example'),
    envTemplate(context),
    'the environment variables the generated files read'
  )

  const { runtime, dev } = packagesFor(features, project)
  const installCommands = [
    ...(runtime.length
      ? [installCommand(project.packageManager, runtime, false)]
      : []),
    ...(dev.length ? [installCommand(project.packageManager, dev, true)] : []),
  ]

  return {
    root,
    files,
    runtime,
    dev,
    installCommands,
    nextSteps: buildNextSteps(context, folder, root),
  }
}

function buildNextSteps(
  context: TemplateContext,
  folder: string,
  root: string
): string[] {
  const { project, features } = context
  const env = envAccessor(project)
  const folderPath = toPosix(relative(root, folder))
  const steps: string[] = []

  steps.push(`Set ${env.variable} in ${env.file} (see typewire.env.example).`)

  if (context.ownsContracts) {
    steps.push(
      `Replace the example endpoints in ${folderPath}/contracts with your real API.`
    )
  }

  if (features.has('query') && project.react) {
    steps.push(
      `Wrap your app root in <TypeWireProvider> (${folderPath}/provider), ` +
        `then call useQuery(user.getUser, …) anywhere below it.`
    )
  } else if (features.has('query')) {
    steps.push(`Drive the cache through queryClient in ${folderPath}/query.`)
  }

  if (features.has('devtools')) {
    steps.push(
      `Render <AppDevtools /> near your app root — outside production builds.`
    )
  }

  if (features.has('nestjs')) {
    steps.push(
      `Register TypeWireModule with the same contracts so one file describes both ends.`
    )
  }

  steps.push(
    `Run \`npx typewire list\` to see every route the contract declares.`
  )

  return steps
}

function toPosix(path: string): string {
  return path.split(/[\\/]/).join('/')
}
