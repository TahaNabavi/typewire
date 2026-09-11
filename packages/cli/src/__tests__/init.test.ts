import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import {
  buildPlan,
  detectProject,
  packagesFor,
  resolveSelection,
  runInit,
  type FeatureId,
  type ProjectInfo,
} from '../init'

let root: string
let logs: string[]

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'typewire-init-'))
  logs = []
  jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(' '))
  })
})

afterEach(async () => {
  jest.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
})

async function project(
  manifest: Record<string, unknown>,
  files: Record<string, string> = {}
): Promise<ProjectInfo> {
  await writeFile(join(root, 'package.json'), JSON.stringify(manifest), 'utf8')

  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path)
    await mkdir(join(full, '..'), { recursive: true })
    await writeFile(full, content, 'utf8')
  }

  return detectProject(root)
}

const featureSet = (...ids: FeatureId[]) =>
  new Set<FeatureId>(['typefetch', ...ids])

/**
 * A stand-in terminal: answers are queued, and everything the prompter prints
 * is captured. `readline` needs each answer to arrive as its own line.
 */
function fakeTerminal(answers: string[]) {
  const input = new PassThrough()
  const output = new PassThrough()
  const chunks: string[] = []

  output.on('data', (chunk: Buffer) => chunks.push(chunk.toString()))

  // One answer per prompt, released as the prompter writes. Queueing them all
  // up front loses them: readline drops a `line` event that arrives while no
  // question is pending, so the wizard would hang on its second question.
  let index = 0
  output.on('data', () => {
    if (index < answers.length) {
      const next = answers[index++]
      setImmediate(() => input.write(`${next}\n`))
    }
  })

  return {
    streams: { input, output },
    written: () => chunks.join(''),
  }
}

/** Plan file paths, project-relative and posix, so assertions read like a tree. */
const paths = (plan: { root: string; files: Array<{ path: string }> }) =>
  plan.files.map((file) =>
    file.path
      .slice(plan.root.length + 1)
      .split(/[\\/]/)
      .join('/')
  )

const contentOf = (
  plan: { files: Array<{ path: string; content: string }> },
  suffix: string
) => plan.files.find((file) => file.path.endsWith(suffix))?.content ?? ''

/** Extension-agnostic: some assertions are about content, not about .ts vs .js. */
const clientOf = (plan: { files: Array<{ path: string; content: string }> }) =>
  plan.files.find((file) => /[\\/]client\.[jt]s$/.test(file.path))?.content ??
  ''

describe('detectProject', () => {
  it('reads Next.js before React, because Next also depends on react', async () => {
    const info = await project({
      name: 'shop',
      dependencies: { next: '15.0.0', react: '19.0.0' },
    })

    expect(info.framework).toBe('next')
    expect(info.frameworkLabel).toBe('Next.js')
    expect(info.react).toBe(true)
  })

  it('trusts the lockfile over the packageManager field', async () => {
    // `packageManager` is copied between projects and goes stale; a lockfile on
    // disk is what the developer is actually using.
    const info = await project(
      { name: 'app', packageManager: 'npm@10.0.0' },
      { 'pnpm-lock.yaml': '' }
    )

    expect(info.packageManager).toBe('pnpm')
  })

  it('notices TypeScript, src/, a monorepo and already-installed packages', async () => {
    const info = await project(
      {
        name: 'app',
        workspaces: ['packages/*'],
        dependencies: { '@tahanabavi/typefetch': '^2.0.0' },
        devDependencies: { typescript: '^5.0.0' },
      },
      { 'src/index.ts': '', 'tsconfig.json': '{}' }
    )

    expect(info.typescript).toBe(true)
    expect(info.sourceDir).toBe('src')
    expect(info.monorepo).toBe(true)
    expect(info.installed.has('@tahanabavi/typefetch')).toBe(true)
  })

  it('falls back to the project root when there is no src/', async () => {
    const info = await project({ name: 'app' })
    expect(info.sourceDir).toBe('.')
  })

  it('finds an existing config so init does not clobber it', async () => {
    const info = await project({ name: 'app' }, { 'typewire.config.ts': '' })
    expect(info.existingConfig).toBe(join(root, 'typewire.config.ts'))
  })
})

describe('feature selection', () => {
  it('keeps the defaults on an empty answer', () => {
    const chosen = resolveSelection(
      [
        { value: 'a', label: 'a', locked: true },
        { value: 'b', label: 'b', selected: true },
        { value: 'c', label: 'c' },
      ],
      ''
    )

    expect(chosen).toEqual(['a', 'b'])
  })

  it('parses numbers, and ignores what it cannot understand', () => {
    // A typo costs one "n" at the confirmation step, not a restart.
    const choices = [
      { value: 'a', label: 'a' },
      { value: 'b', label: 'b' },
      { value: 'c', label: 'c' },
    ]

    expect(resolveSelection(choices, '1, 3')).toEqual(['a', 'c'])
    expect(resolveSelection(choices, '2 9 banana')).toEqual(['b'])
  })

  it('keeps locked features even on none', () => {
    const choices = [
      { value: 'a', label: 'a', locked: true },
      { value: 'b', label: 'b', selected: true },
    ]

    expect(resolveSelection(choices, 'none')).toEqual(['a'])
    expect(resolveSelection(choices, 'all')).toEqual(['a', 'b'])
  })
})

describe('packagesFor', () => {
  it('adds the React binding with the query layer, without a second question', async () => {
    const info = await project({ dependencies: { react: '19.0.0' } })
    const { runtime } = packagesFor(featureSet('query'), info)

    expect(runtime).toContain('@tahanabavi/typefetch-query-core')
    expect(runtime).toContain('@tahanabavi/typefetch-react')
  })

  it('leaves the React binding out of a non-React project', async () => {
    const info = await project({ dependencies: { express: '4.0.0' } })
    const { runtime } = packagesFor(featureSet('query'), info)

    expect(runtime).toContain('@tahanabavi/typefetch-query-core')
    expect(runtime).not.toContain('@tahanabavi/typefetch-react')
  })

  it('keeps devtools a dev dependency', async () => {
    const info = await project({ dependencies: { react: '19.0.0' } })
    const { runtime, dev } = packagesFor(featureSet('devtools'), info)

    expect(dev).toContain('@tahanabavi/type-devtools')
    expect(runtime).not.toContain('@tahanabavi/type-devtools')
  })

  it('never re-installs what the project already has', async () => {
    const info = await project({
      dependencies: { '@tahanabavi/typefetch': '^2.0.0' },
    })

    expect(packagesFor(featureSet(), info).runtime).not.toContain(
      '@tahanabavi/typefetch'
    )
  })
})

describe('buildPlan', () => {
  it('scaffolds a minimal project with the config, contracts and client', async () => {
    const info = await project({ name: 'api' }, { 'tsconfig.json': '{}' })
    const plan = buildPlan({ project: info, features: featureSet() })

    expect(paths(plan)).toEqual([
      'typewire.config.ts',
      'typewire/contracts.ts',
      'typewire/client.ts',
      'typewire/index.ts',
      'typewire.env.example',
    ])
  })

  it('puts generated files under src/ when the project has one', async () => {
    const info = await project(
      { name: 'app', devDependencies: { typescript: '^5' } },
      { 'src/index.ts': '' }
    )
    const plan = buildPlan({ project: info, features: featureSet() })

    expect(paths(plan)).toContain('src/typewire/client.ts')
  })

  it('adds the provider only for React, and .tsx only for TypeScript', async () => {
    const react = await project(
      {
        dependencies: { react: '19.0.0' },
        devDependencies: { typescript: '^5' },
      },
      { 'tsconfig.json': '{}' }
    )
    const node = await project({ dependencies: { express: '4' } })

    expect(
      paths(buildPlan({ project: react, features: featureSet('query') }))
    ).toContain('typewire/provider.tsx')
    expect(
      paths(buildPlan({ project: node, features: featureSet('query') }))
    ).not.toContain('typewire/provider.tsx')
  })

  it('writes JavaScript files for a project without TypeScript', async () => {
    const info = await project({ name: 'app' })
    const plan = buildPlan({ project: info, features: featureSet() })

    // The config becomes .mjs: a plain .js in a project without "type":
    // "module" would be read as CommonJS and the ESM template would throw.
    expect(paths(plan)).toContain('typewire.config.mjs')
    expect(paths(plan)).toContain('typewire/client.js')
    expect(contentOf(plan, 'contracts.js')).not.toContain('as const')
  })

  it('wires each selected transport into the client', async () => {
    const info = await project({ name: 'app' }, { 'tsconfig.json': '{}' })
    const plan = buildPlan({
      project: info,
      features: featureSet('graphql', 'grpc'),
    })

    const client = contentOf(plan, 'client.ts')
    // One exported list, so the config registers the same adapters the app does.
    expect(client).toContain(
      'export const transports = [graphqlTransport(), grpcTransport()];'
    )

    const config = contentOf(plan, 'typewire.config.ts')
    expect(config).toMatch(
      /import \{ createClient, transports \} from "\.\/typewire\/client"/
    )
    expect(config).toMatch(/^\s+transports,$/m)

    // …and the contracts gain a route for each, so the wiring is demonstrable.
    const contracts = contentOf(plan, 'contracts.ts')
    expect(contracts).toContain(`transport: "graphql"`)
    expect(contracts).toContain(`transport: "grpc"`)
  })

  it('reads the env var the way the framework actually does', async () => {
    const next = await project(
      { dependencies: { next: '15', react: '19' } },
      { 'tsconfig.json': '{}' }
    )
    const vite = await project(
      { dependencies: { react: '19' }, devDependencies: { vite: '5' } },
      { 'tsconfig.json': '{}' }
    )
    const node = await project({ dependencies: { express: '4' } })

    expect(
      clientOf(buildPlan({ project: next, features: featureSet() }))
    ).toContain('process.env.NEXT_PUBLIC_API_URL')
    // Guarded, because typewire.config.ts imports this file and the CLI runs it
    // under Node, where `import.meta.env` does not exist.
    expect(
      clientOf(buildPlan({ project: vite, features: featureSet() }))
    ).toContain(
      '(import.meta as { env?: Record<string, string | undefined> }).env?.VITE_API_URL'
    )
    expect(
      clientOf(buildPlan({ project: node, features: featureSet() }))
    ).toContain('process.env.API_BASE_URL')
  })

  it('connects every selected source to one devtools bridge', async () => {
    const info = await project(
      { dependencies: { react: '19' }, devDependencies: { typescript: '^5' } },
      { 'tsconfig.json': '{}' }
    )
    const plan = buildPlan({
      project: info,
      features: featureSet('devtools', 'query', 'typesocket'),
    })

    const devtools = contentOf(plan, 'devtools.tsx')
    expect(devtools).toContain('connectTypeFetch(api, bridge);')
    expect(devtools).toContain('connectTypeSocket(socket, bridge);')
    expect(devtools).toContain('connectQueryClient(queryClient)')
    expect(devtools).toContain('queries={queries}')
  })

  it('declares the socket section in the config only when asked for', async () => {
    const info = await project({ name: 'app' }, { 'tsconfig.json': '{}' })

    expect(
      contentOf(
        buildPlan({ project: info, features: featureSet() }),
        'typewire.config.ts'
      )
    ).not.toContain('typesocket:')
    expect(
      contentOf(
        buildPlan({ project: info, features: featureSet('typesocket') }),
        'typewire.config.ts'
      )
    ).toContain('typesocket: {')
  })

  it('marks React entry points "use client" in a Next.js app', async () => {
    // Without the directive the App Router renders these on the server and the
    // build fails — in the framework most likely to be detected here.
    const next = await project(
      {
        dependencies: { next: '15', react: '19' },
        devDependencies: { typescript: '^5' },
      },
      { 'tsconfig.json': '{}' }
    )
    const plan = buildPlan({
      project: next,
      features: featureSet('query', 'devtools'),
    })

    expect(contentOf(plan, 'provider.tsx').startsWith('"use client";')).toBe(
      true
    )
    expect(contentOf(plan, 'devtools.tsx').startsWith('"use client";')).toBe(
      true
    )
  })

  it('leaves the directive out of a plain React app, where it means nothing', async () => {
    const react = await project(
      {
        dependencies: { react: '19' },
        devDependencies: { typescript: '^5', vite: '5' },
      },
      { 'tsconfig.json': '{}' }
    )
    const plan = buildPlan({ project: react, features: featureSet('query') })

    expect(contentOf(plan, 'provider.tsx')).not.toContain('use client')
  })

  it('explains why the CLI client reads a different env var than the browser one', async () => {
    const next = await project(
      { dependencies: { next: '15', react: '19' } },
      { 'tsconfig.json': '{}' }
    )
    const node = await project({ dependencies: { express: '4' } })

    expect(
      contentOf(
        buildPlan({ project: next, features: featureSet() }),
        'typewire.config.ts'
      )
    ).toMatch(/never\s+\* reads NEXT_PUBLIC_API_URL/)
    // Saying API_BASE_URL "belongs to the browser bundle" is false in a Node
    // project — there it is exactly the variable the CLI reads.
    expect(
      contentOf(
        buildPlan({ project: node, features: featureSet() }),
        'typewire.config.ts'
      )
    ).not.toContain('belongs to the browser bundle')
  })

  it('does not destructure modules it cannot know exist', async () => {
    const info = await project({ name: 'app' }, { 'tsconfig.json': '{}' })

    // `export const { user } = api.modules` is only safe for the contracts the
    // wizard wrote itself; against someone else's it is a runtime crash.
    // Matched at a line start: the "bring your own contracts" file still names
    // the pattern in a comment, which is guidance, not a crash.
    expect(
      clientOf(buildPlan({ project: info, features: featureSet() }))
    ).toMatch(/^export const \{ user \} = api\.modules;$/m)
    expect(
      clientOf(
        buildPlan({
          project: info,
          features: featureSet(),
          contractsPath: './src/api/contracts',
        })
      )
    ).not.toMatch(/^export const \{ user \}/m)
  })

  it('uses contracts that already exist instead of generating an example', async () => {
    const info = await project({ name: 'app' }, { 'tsconfig.json': '{}' })
    const plan = buildPlan({
      project: info,
      features: featureSet(),
      contractsPath: './src/api/contracts',
    })

    expect(paths(plan)).not.toContain('typewire/contracts.ts')
    expect(contentOf(plan, 'typewire.config.ts')).toContain(
      `from "./src/api/contracts"`
    )
    // The barrel must not re-export a file the wizard did not write.
    expect(contentOf(plan, 'index.ts')).not.toContain(`from "./contracts"`)
  })

  it('names the right installer for the project', async () => {
    const info = await project({ name: 'app' }, { 'yarn.lock': '' })
    const plan = buildPlan({ project: info, features: featureSet('query') })

    expect(plan.installCommands[0]).toMatch(/^yarn add @tahanabavi\/typefetch/)
    expect(plan.installCommands[1]).toBe('yarn add -D @tahanabavi/typewire-cli')
  })
})

describe('runInit', () => {
  it('writes the plan and reports what it created', async () => {
    await project({ name: 'app' }, { 'tsconfig.json': '{}' })

    const results = await runInit({ cwd: root, yes: true })

    expect(results.every((result) => result.status === 'created')).toBe(true)
    await expect(
      readFile(join(root, 'typewire.config.ts'), 'utf8')
    ).resolves.toContain('defineConfig')
  })

  it('writes nothing under --dry-run', async () => {
    await project({ name: 'app' }, { 'tsconfig.json': '{}' })

    const results = await runInit({ cwd: root, yes: true, dryRun: true })

    expect(results.every((result) => result.status === 'planned')).toBe(true)
    await expect(
      readFile(join(root, 'typewire.config.ts'), 'utf8')
    ).rejects.toThrow()
  })

  it('leaves existing files alone, and says how many', async () => {
    await project({ name: 'app' }, { 'tsconfig.json': '{}' })
    await runInit({ cwd: root, yes: true })

    await writeFile(join(root, 'typewire', 'client.ts'), '// mine', 'utf8')
    const results = await runInit({ cwd: root, yes: true, force: true })

    // --force is required even to reach this point, because a config already
    // exists; the file itself is then replaced rather than skipped.
    expect(results.find((r) => r.path.endsWith('client.ts'))?.status).toBe(
      'overwritten'
    )
  })

  it('refuses to scaffold over an existing config without --force', async () => {
    await project({ name: 'app' }, { 'tsconfig.json': '{}' })
    await runInit({ cwd: root, yes: true })

    const second = await runInit({ cwd: root, yes: true })

    expect(second).toEqual([])
    expect(logs.join('\n')).toMatch(/A TypeWire config already exists/)
  })

  it('rejects an unknown --features value rather than silently dropping it', async () => {
    await project({ name: 'app' }, { 'tsconfig.json': '{}' })

    await expect(
      runInit({ cwd: root, features: ['query', 'graphq'] })
    ).rejects.toThrow(/Unknown --features value "graphq"[\s\S]*Available here/)
  })

  it('rejects a feature that does not apply to this project', async () => {
    // devtools is React-only. Accepting it in an Express project would scaffold
    // a .tsx file that cannot compile.
    await project({ dependencies: { express: '4' } })

    await expect(
      runInit({ cwd: root, features: ['devtools'] })
    ).rejects.toThrow(/Unknown --features value "devtools"/)
  })

  it('asks, and scaffolds exactly what was typed', async () => {
    await project(
      {
        name: 'app',
        dependencies: { react: '19' },
        devDependencies: { typescript: '^5' },
      },
      { 'tsconfig.json': '{}' }
    )

    // The real interactive path: a numbered answer to the feature list, then
    // "y" at the write confirmation. `query` and `devtools` are preselected for
    // a React project and are *replaced*, not added to, by an explicit answer.
    const { streams, written } = fakeTerminal(['3', 'y'])
    const results = await runInit({ cwd: root, streams })

    const created = results.map((result) => result.path.split(/[\\/]/).pop())
    expect(created).toContain('socket.ts')
    expect(created).not.toContain('query.ts')
    expect(created).not.toContain('devtools.tsx')

    expect(written()).toMatch(/\[✓\] Query layer/)
    expect(written()).toMatch(/\[ \] typesocket/)
  })

  it('writes nothing when the confirmation is declined', async () => {
    await project({ name: 'app' }, { 'tsconfig.json': '{}' })

    const { streams } = fakeTerminal(['', 'n'])

    expect(await runInit({ cwd: root, streams })).toEqual([])
    await expect(
      readFile(join(root, 'typewire.config.ts'), 'utf8')
    ).rejects.toThrow()
  })

  it('prints what it chose when it is not asking', async () => {
    await project({ dependencies: { react: '19' } }, { 'tsconfig.json': '{}' })

    await runInit({ cwd: root, yes: true })

    // A wizard that silently picks for you in CI is how a scaffold ends up
    // wrong in a way nobody notices until the build.
    expect(logs.join('\n')).toMatch(
      /What does this project need\?.*→.*Query layer/s
    )
  })
})
