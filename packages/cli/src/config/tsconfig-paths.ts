import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseJsonc } from './jsonc'
import { exists } from './fs'

/**
 * Turn a project's `tsconfig.json` path aliases into jiti aliases.
 *
 * A user's contract file that imports `@/schemas` is completely normal — it is
 * what every Next.js and Vite scaffold sets up — and it fails to load under
 * jiti unless the loader resolves the alias. `docs/CLI.md` §2 flags this as a
 * guaranteed day-one support ticket otherwise.
 *
 * Failure here is never fatal: a missing or malformed tsconfig means no
 * aliases, and the import either works without them or fails with its own
 * error, which is more useful than one about tsconfig.
 */
export async function readTsconfigAliases(
  fromDir: string
): Promise<Record<string, string>> {
  const tsconfigPath = await findTsconfig(fromDir)
  if (!tsconfigPath) return {}

  try {
    const { baseUrl, paths } = await readTsconfigChain(tsconfigPath)
    if (!paths) return {}
    return toJitiAliases(paths, baseUrl ?? dirname(tsconfigPath))
  } catch {
    return {}
  }
}

type CompilerPaths = Record<string, string[]>

/**
 * Walk the `extends` chain. Monorepos put `paths` in the shared base far more
 * often than in the leaf, so reading only the nearest file would miss them in
 * exactly the repos most likely to use aliases.
 */
async function readTsconfigChain(
  tsconfigPath: string,
  seen = new Set<string>()
): Promise<{ baseUrl?: string; paths?: CompilerPaths }> {
  if (seen.has(tsconfigPath)) return {}
  seen.add(tsconfigPath)

  const raw = parseJsonc(await readFile(tsconfigPath, 'utf8')) as {
    extends?: string | string[]
    compilerOptions?: { baseUrl?: string; paths?: CompilerPaths }
  }

  const dir = dirname(tsconfigPath)
  let baseUrl: string | undefined
  let paths: CompilerPaths | undefined

  // Bases first, so the leaf's own values win.
  const bases = raw.extends
    ? Array.isArray(raw.extends)
      ? raw.extends
      : [raw.extends]
    : []

  for (const base of bases) {
    const basePath = resolveTsconfigRef(base, dir)
    if (!basePath) continue

    const inherited = await readTsconfigChain(basePath, seen)
    if (inherited.baseUrl) baseUrl = inherited.baseUrl
    if (inherited.paths) paths = { ...paths, ...inherited.paths }
  }

  // `baseUrl` and relative `paths` resolve against the file that declared them.
  if (raw.compilerOptions?.baseUrl) {
    baseUrl = resolve(dir, raw.compilerOptions.baseUrl)
  }
  if (raw.compilerOptions?.paths) {
    paths = { ...paths, ...raw.compilerOptions.paths }
    baseUrl ??= dir
  }

  return { baseUrl, paths }
}

function resolveTsconfigRef(ref: string, fromDir: string): string | undefined {
  if (ref.startsWith('.') || isAbsolute(ref)) {
    const full = resolve(fromDir, ref)
    return /\.json$/.test(full) ? full : `${full}.json`
  }

  // `extends: "@tsconfig/node20/tsconfig.json"` and friends.
  try {
    const require = createRequire(pathToFileURL(resolve(fromDir, 'noop.js')))
    return require.resolve(ref)
  } catch {
    return undefined
  }
}

/**
 * jiti matches aliases by prefix, so `"@/*": ["./src/*"]` becomes `"@" →
 * <base>/src`. Multi-target entries take the first: jiti resolves one path, and
 * the first entry is the one TypeScript tries first too.
 */
function toJitiAliases(
  paths: CompilerPaths,
  baseUrl: string
): Record<string, string> {
  const aliases: Record<string, string> = {}

  for (const [pattern, targets] of Object.entries(paths)) {
    const target = targets?.[0]
    if (!target) continue

    const from = pattern.replace(/\/?\*$/, '')
    const to = resolve(baseUrl, target.replace(/\/?\*$/, ''))
    if (!from) continue

    aliases[from] = to
  }

  return aliases
}

async function findTsconfig(fromDir: string): Promise<string | undefined> {
  let dir = resolve(fromDir)

  for (;;) {
    const candidate = resolve(dir, 'tsconfig.json')
    if (await exists(candidate)) return candidate

    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}
