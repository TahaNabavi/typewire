import type { ProjectInfo } from './detect'

export type FeatureId =
  | 'typefetch'
  | 'graphql'
  | 'grpc'
  | 'encryption'
  | 'typesocket'
  | 'query'
  | 'devtools'
  | 'permission'
  | 'nestjs'

/**
 * The one place a package name appears.
 *
 * Five of these are still at `0.0.0` and are scheduled to be renamed off their
 * stray `type-` / `typefetch-` prefixes (ROADMAP step 7) while that is still
 * free. Keeping every name here means that rename is one edit to this map
 * rather than a hunt through template strings.
 */
export const PACKAGES = {
  typefetch: '@tahanabavi/typefetch',
  graphql: '@tahanabavi/typefetch-graphql',
  grpc: '@tahanabavi/typefetch-grpc',
  encryption: '@tahanabavi/typefetch-encryption',
  typesocket: '@tahanabavi/typesocket',
  queryCore: '@tahanabavi/typefetch-query-core',
  react: '@tahanabavi/typefetch-react',
  devtoolsCore: '@tahanabavi/type-devtools-core',
  devtools: '@tahanabavi/type-devtools',
  permission: '@tahanabavi/type-permission',
  nestjs: '@tahanabavi/typewire-nestjs',
  cli: '@tahanabavi/typewire-cli',
} as const

export type Feature = {
  id: FeatureId
  label: string
  hint: string
  /** Runtime packages this feature adds. */
  packages: string[]
  /** Devtools is a development install; shipping it to production is the bug. */
  dev?: boolean
  /** Offer it only where it makes sense — a gRPC transport in a Vue app is noise. */
  applies?: (project: ProjectInfo) => boolean
  /** Preselected, because the project shape already implies it. */
  suggested?: (project: ProjectInfo) => boolean
  /** Cannot be turned off. */
  locked?: boolean
}

export const FEATURES: Feature[] = [
  {
    id: 'typefetch',
    label: 'typefetch — typed HTTP client',
    hint: 'the runtime everything else plugs into',
    packages: [PACKAGES.typefetch],
    locked: true,
  },
  {
    id: 'query',
    label: 'Query layer — caching, dedup, declared invalidation',
    hint: 'adds React hooks when React is present',
    packages: [PACKAGES.queryCore],
    suggested: (project) => project.react,
  },
  {
    id: 'typesocket',
    label: 'typesocket — typed WebSocket contracts',
    hint: 'same contract style, both directions',
    packages: [PACKAGES.typesocket],
  },
  {
    id: 'devtools',
    label: 'Devtools panel — request timeline and cache inspector',
    hint: 'React only, dev dependency',
    packages: [PACKAGES.devtoolsCore, PACKAGES.devtools],
    dev: true,
    applies: (project) => project.react,
    suggested: (project) => project.react,
  },
  {
    id: 'graphql',
    label: 'GraphQL transport',
    hint: 'selection sets generated from your zod response schemas',
    packages: [PACKAGES.graphql],
  },
  {
    id: 'grpc',
    label: 'gRPC transport',
    hint: 'Connect JSON by default, no protobuf runtime',
    packages: [PACKAGES.grpc],
  },
  {
    id: 'permission',
    label: 'Permissions — one bit map, client and server',
    hint: 'guards linked to the contract',
    packages: [PACKAGES.permission],
  },
  {
    id: 'encryption',
    label: 'Payload encryption middleware',
    hint: 'AES / RSA over selected fields',
    packages: [PACKAGES.encryption],
  },
  {
    id: 'nestjs',
    label: 'NestJS server adapter',
    hint: 'serve the same contracts from the server',
    packages: [PACKAGES.nestjs],
    applies: (project) => project.framework === 'nest',
    suggested: (project) => project.framework === 'nest',
  },
]

export function availableFeatures(project: ProjectInfo): Feature[] {
  return FEATURES.filter((feature) => feature.applies?.(project) ?? true)
}

/**
 * React hooks are not a separate question.
 *
 * "Do you want the query layer?" is a real decision. "Do you want the React
 * binding for the query layer, in your React app?" is not — it is the answer to
 * the first question, restated.
 */
export function packagesFor(
  features: Set<FeatureId>,
  project: ProjectInfo
): { runtime: string[]; dev: string[] } {
  const runtime = new Set<string>()
  const dev = new Set<string>([PACKAGES.cli])

  for (const feature of FEATURES) {
    if (!features.has(feature.id)) continue
    for (const name of feature.packages) {
      ;(feature.dev ? dev : runtime).add(name)
    }
  }

  if (features.has('query') && project.react) runtime.add(PACKAGES.react)

  return {
    runtime: [...runtime].filter((name) => !project.installed.has(name)),
    dev: [...dev].filter((name) => !project.installed.has(name)),
  }
}
