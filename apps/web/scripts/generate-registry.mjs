/**
 * Derive the website's package registry from the monorepo itself.
 *
 * Nothing about a package is retyped here. Everything comes from files the
 * package already owns:
 *
 *   packages/<dir>/package.json     name, version, description, keywords,
 *                                   dependencies, peers, exports, repository
 *   packages/<dir>/README.md        tagline, feature bullets, install command,
 *                                   banner image
 *   packages/<dir>/docs/releases/   the release-note history
 *   size-budget.json (repo root)    the gzipped CI ceiling
 *   README.md (repo root)           the roadmap checklist
 *
 * Category and transports are *derived* from keywords and export subpaths. When
 * derivation cannot know (the devtools packages are transport-agnostic by
 * design, so they name no wire), a package may override it by declaring a
 * "typewire" block in its own package.json:
 *
 *   "typewire": { "category": "devtools", "transports": ["http","graphql","grpc","ws"] }
 *
 * Output: src/generated/registry.json (gitignored — always regenerated).
 * Run by the dev, build and typecheck scripts, so it can never go stale.
 */

import {
  readFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  statSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = resolve(HERE, '..')

/** Walk up until the file that marks the monorepo root. */
function findRepoRoot(from) {
  let dir = from
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error(
    'Could not locate the monorepo root (no pnpm-workspace.yaml found above ' +
      from +
      ')'
  )
}

const REPO_ROOT = findRepoRoot(WEB_ROOT)
const PACKAGES_DIR = join(REPO_ROOT, 'packages')

// Some files in this repo carry a UTF-8 BOM, and most are CRLF. Both break
// naive parsing — a `$` anchor does not match before a `\r` — so normalize once
// at the read, rather than defending against it in every regex below.
const normalize = (text) =>
  (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).replace(/\r\n/g, '\n')
const readJson = (path) => JSON.parse(normalize(readFileSync(path, 'utf8')))
const readText = (path) =>
  existsSync(path) ? normalize(readFileSync(path, 'utf8')) : ''

// ---------------------------------------------------------------------------
// derivation rules
// ---------------------------------------------------------------------------

/**
 * Categories, in decision order. The first rule that matches wins, which is why
 * the client rule runs before the tooling rule: typefetch carries a "cli"
 * keyword from the days the CLI lived inside it.
 */
function deriveCategory(pkg) {
  const kw = new Set(pkg.keywords ?? [])
  const isTransport = kw.has('transport')

  if (
    !isTransport &&
    (kw.has('api-client') ||
      kw.has('http') ||
      kw.has('socket') ||
      kw.has('websocket'))
  ) {
    return 'core'
  }
  if (kw.has('cli')) return 'tooling'
  if (kw.has('devtools') || kw.has('inspector')) return 'devtools'
  if (kw.has('nestjs') || kw.has('backend')) return 'server'
  if (isTransport || kw.has('encryption') || kw.has('middleware'))
    return 'transport'
  if (kw.has('react') || kw.has('query') || kw.has('cache') || kw.has('hooks'))
    return 'state'
  return 'core'
}

/** Which wires a package speaks, from its keywords and its export subpaths. */
function deriveTransports(pkg) {
  const kw = new Set(pkg.keywords ?? [])
  const subpaths = Object.keys(pkg.exports ?? {})
  const found = new Set()

  if (kw.has('graphql') || subpaths.includes('./graphql')) found.add('graphql')
  if (
    kw.has('grpc') ||
    kw.has('grpc-web') ||
    kw.has('connect') ||
    kw.has('connect-rpc') ||
    subpaths.includes('./grpc')
  ) {
    found.add('grpc')
  }
  if (
    kw.has('websocket') ||
    kw.has('socket.io') ||
    kw.has('socket') ||
    subpaths.includes('./socket')
  )
    found.add('ws')
  if (kw.has('http') || kw.has('rest') || kw.has('fetch')) found.add('http')

  // A server that serves any non-http wire also serves http.
  if (found.size > 0 && (kw.has('nestjs') || kw.has('backend')))
    found.add('http')

  return ['http', 'graphql', 'grpc', 'ws'].filter((t) => found.has(t))
}

// ---------------------------------------------------------------------------
// README mining
// ---------------------------------------------------------------------------

/** Strip the markdown a card cannot render: links, emphasis, code ticks. */
function plain(md) {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The first real paragraph — the package's own one-liner, in its own words. */
function readmeTagline(md) {
  const body = md
    .split('\n')
    .filter((l) => !l.startsWith('#') && !l.trim().startsWith('>'))
    .join('\n')
  for (const block of body.split(/\n\s*\n/)) {
    const text = plain(block)
    if (
      text.length > 40 &&
      !block.trim().startsWith('```') &&
      !block.trim().startsWith('|')
    ) {
      return text.length > 260 ? text.slice(0, 257).trimEnd() + '…' : text
    }
  }
  return ''
}

/** Bullets under the first "## Features" heading. */
function readmeFeatures(md, limit = 8) {
  const match = md.match(/^##+\s+Features\s*$([\s\S]*?)(?=^##\s|\Z)/m)
  if (!match) return []
  return (match[1] ?? '')
    .split('\n')
    .filter((l) => /^\s*[-*]\s+/.test(l))
    .map((l) => plain(l.replace(/^\s*[-*]\s+/, '')))
    .filter(Boolean)
    .slice(0, limit)
}

/** The install line the package documents for itself. */
function readmeInstall(md, npmName) {
  const blocks = md.match(/```(?:bash|sh|shell)\n([\s\S]*?)```/g) ?? []
  for (const block of blocks) {
    const line = block
      .split('\n')
      .find((l) => /\b(add|install)\b/.test(l) && l.includes(npmName))
    if (line) return line.trim()
  }
  return `pnpm add ${npmName}`
}

/** The first image in the README is the package banner, by repo convention. */
function readmeBanner(md) {
  const match = md.match(/!\[[^\]]*\]\((\.\/[^)]+\.(?:png|svg|jpg))\)/)
  return match ? match[1].replace(/^\.\//, '') : null
}

// ---------------------------------------------------------------------------
// release history
// ---------------------------------------------------------------------------

function compareVersionsDesc(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const diff = (pb[i] ?? 0) - (pa[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

function readReleases(pkgDir, relPath) {
  const dir = join(pkgDir, 'docs', 'releases')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => /^v\d+\.\d+\.\d+\.md$/.test(f))
    .map((file) => {
      const version = file.slice(1, -3)
      const md = readText(join(dir, file))
      const heading = md.split('\n').find((l) => l.startsWith('# '))
      return {
        version,
        title: heading ? plain(heading.replace(/^#\s+/, '')) : `v${version}`,
        path: `${relPath}/docs/releases/${file}`,
      }
    })
    .sort((a, b) => compareVersionsDesc(a.version, b.version))
}

/**
 * The package's docs manifest, with each page's markdown inlined.
 *
 * Inlining is what lets the website render docs without reading outside its own
 * app directory at request time — the generated registry is the whole input, so
 * the site builds identically on Vercel as it does here.
 *
 * A package with no manifest yields `null`, and the website says so rather than
 * rendering an empty shell. scripts/check-docs.mjs is what makes that state a
 * CI failure; this generator only reports it.
 */
function readDocs(pkgDir, relPath) {
  const manifestPath = join(pkgDir, 'docs', 'docs.json')
  if (!existsSync(manifestPath)) return null

  let manifest
  try {
    manifest = JSON.parse(readText(manifestPath))
  } catch {
    return null
  }

  const pages = (manifest.pages ?? [])
    .map((page) => {
      const source =
        page.readme === true
          ? join(pkgDir, 'README.md')
          : join(pkgDir, 'docs', page.file ?? '')
      if (!existsSync(source)) return null

      const full = readText(source)
      const body = page.sections
        ? sliceSections(full, page.sections, page.intro === true)
        : full
      return {
        slug: page.slug,
        title: page.title,
        /** Repo-relative, so the page can link to its own source. */
        path:
          page.readme === true
            ? `${relPath}/README.md`
            : `${relPath}/docs/${page.file}`,
        isReadme: page.readme === true,
        /** True when this page is one slice of a longer file. */
        isSlice: Array.isArray(page.sections),
        markdown: body,
        headings: readHeadings(body),
      }
    })
    .filter(Boolean)

  return {
    documentsVersion: manifest.documentsVersion ?? null,
    summary: manifest.summary ?? null,
    pages,
  }
}

/**
 * Split a markdown file into `## Heading` → body, keeping the preamble under
 * the key `null`.
 *
 * A "## " inside a fenced block is shell output or a code comment, not a
 * heading — several of these READMEs print `## ` in example terminal output.
 */
function splitByHeading(md) {
  const out = new Map()
  const order = []
  let current = null
  let buffer = []
  let fenced = false

  const flush = () => {
    const text = buffer.join('\n').replace(/\s+$/, '')
    if (current !== null || text.trim()) {
      out.set(current, text)
      order.push(current)
    }
    buffer = []
  }

  for (const line of md.split('\n')) {
    if (line.startsWith('```')) fenced = !fenced
    const match = !fenced && /^##\s+(.+?)\s*$/.exec(line)
    if (match) {
      flush()
      current = plain(match[1])
      buffer = [line]
      continue
    }
    buffer.push(line)
  }
  flush()

  return { sections: out, order }
}

/**
 * Render only the named sections of a file, in the order the manifest lists
 * them.
 *
 * This is what lets one README be several pages on the site without a second
 * copy of a single byte. The README stays the whole story — it is what npm and
 * GitHub show — and the manifest decides how the website paginates it. A name
 * that is not in the file is left out rather than guessed at; check-docs.mjs is
 * what turns that into a failed build.
 */
function sliceSections(md, names, includeIntro) {
  const { sections } = splitByHeading(md)
  const parts = []

  if (includeIntro) {
    const intro = sections.get(null)
    if (intro && intro.trim()) parts.push(intro.trim())
  }

  for (const name of names) {
    const body = sections.get(name)
    if (body) parts.push(body.trim())
  }

  return parts.join('\n\n')
}

/**
 * `## Heading` lines, for the on-page table of contents.
 *
 * Repeated heading text is numbered — "Installation" twice on a page gives
 * `installation` then `installation-2`. src/features/docs/markdown.ts applies the same
 * rule when it renders the ids, and the two must agree or every contents link
 * below a repeat points at the wrong section.
 *
 * Only depth 2 and 3 are counted, on both sides: a README's title heading is
 * stripped before rendering, so counting depth 1 here would shift the numbers.
 */
function readHeadings(md) {
  const out = []
  const seen = new Map()
  let fenced = false
  for (const line of md.split('\n')) {
    if (line.startsWith('```')) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    const match = /^(#{2,3})\s+(.+?)\s*$/.exec(line)
    if (!match) continue
    const text = plain(match[2])
    const base = text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
    const count = (seen.get(base) ?? 0) + 1
    seen.set(base, count)
    out.push({
      depth: match[1].length,
      text,
      id: count === 1 ? base : `${base}-${count}`,
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// npm — the only authority on what is actually published
// ---------------------------------------------------------------------------

/**
 * A local version number says nothing about the registry: several packages here
 * sit at a non-zero version and have never been published, and at least one is
 * further ahead on npm than in the workspace. So ask npm.
 *
 * `checked: false` means the question could not be answered (offline, rate
 * limited) — the caller falls back to the local heuristic and flags the result
 * stale rather than asserting something it does not know.
 */
async function fetchNpmVersion(name) {
  if (process.env.TYPEWIRE_OFFLINE === '1')
    return { version: null, checked: false }
  try {
    const res = await fetch(
      `https://registry.npmjs.org/${name.replaceAll('/', '%2f')}/latest`,
      {
        signal: AbortSignal.timeout(10_000),
        headers: { Accept: 'application/json' },
      }
    )
    if (res.status === 404) return { version: null, checked: true } // never published
    if (!res.ok) return { version: null, checked: false }
    const json = await res.json()
    return {
      version: typeof json.version === 'string' ? json.version : null,
      checked: true,
    }
  } catch {
    return { version: null, checked: false }
  }
}

// ---------------------------------------------------------------------------
// roadmap, from the root README checklist
// ---------------------------------------------------------------------------

function readRoadmap(rootReadme) {
  const section = rootReadme.match(/^##\s+Roadmap\s*$([\s\S]*?)(?=^##\s)/m)
  const shipped = []
  const next = []
  if (!section) return { shipped, next }

  for (const line of (section[1] ?? '').split('\n')) {
    const match = line.match(/^-\s+\[([ xX])\]\s+(.*)$/)
    if (!match) continue
    const done = match[1].toLowerCase() === 'x'
    const text = plain(match[2] ?? '')
    if (!text) continue
    // "Title — detail" is the convention used throughout the README.
    const [title, ...rest] = text.split(/\s+—\s+/)
    const item = {
      title: title.trim(),
      detail: rest.join(' — ').trim() || null,
    }
    ;(done ? shipped : next).push(item)
  }
  return { shipped, next }
}

// ---------------------------------------------------------------------------
// build the registry
// ---------------------------------------------------------------------------

const sizeBudgets = new Map(
  (readJson(join(REPO_ROOT, 'size-budget.json')).budgets ?? []).map((b) => [
    b.package,
    b,
  ])
)

const rootReadme = readText(join(REPO_ROOT, 'README.md'))
const bannerOutDir = join(WEB_ROOT, 'public', 'banners')
mkdirSync(bannerOutDir, { recursive: true })

const packageDirs = readdirSync(PACKAGES_DIR)
  .filter((dir) => statSync(join(PACKAGES_DIR, dir)).isDirectory())
  .filter((dir) => existsSync(join(PACKAGES_DIR, dir, 'package.json')))

const packages = (
  await Promise.all(
    packageDirs.map(async (dir) => {
      const pkgDir = join(PACKAGES_DIR, dir)
      const pkg = readJson(join(pkgDir, 'package.json'))
      if (pkg.private) return null

      const readme = readText(join(pkgDir, 'README.md'))
      const overrides = pkg.typewire ?? {}
      const runtimeDeps = Object.keys(pkg.dependencies ?? {})
      const budget = sizeBudgets.get(dir)
      const relPath = `packages/${dir}`
      const npm = await fetchNpmVersion(pkg.name)

      // npm is the authority. The local version is the fallback used only when
      // the registry could not be reached.
      const published = npm.checked
        ? npm.version !== null
        : pkg.version !== '0.0.0'
      const pending =
        npm.version && compareVersionsDesc(pkg.version, npm.version) < 0
          ? pkg.version
          : null

      // Copy the package's own banner into the site's public dir so the page
      // can render it without reaching outside the app.
      let banner = null
      const bannerRel = readmeBanner(readme)
      if (bannerRel) {
        const source = join(pkgDir, bannerRel)
        if (existsSync(source)) {
          const ext = bannerRel.slice(bannerRel.lastIndexOf('.'))
          const fileName = `${dir}${ext}`
          copyFileSync(source, join(bannerOutDir, fileName))
          banner = `/banners/${fileName}`
        }
      }

      return {
        slug: pkg.name.replace(/^@[^/]+\//, ''),
        npm: pkg.name,
        short: pkg.name.replace(/^@[^/]+\//, ''),
        dir,
        path: relPath,
        localVersion: pkg.version,
        npmVersion: npm.version,
        /** False means npm did not answer — treat the flags below as a guess. */
        registryChecked: npm.checked,
        published,
        /** Workspace is ahead of npm; the README calls this "vX pending". */
        pendingVersion: pending,
        /** What the site shows as "the version": npm's, or nothing. */
        version: npm.version ?? (published ? pkg.version : null),
        description: pkg.description ?? '',
        tagline: overrides.tagline ?? readmeTagline(readme),
        keywords: pkg.keywords ?? [],
        category: overrides.category ?? deriveCategory(pkg),
        transports: overrides.transports ?? deriveTransports(pkg),
        runtimeDeps,
        zeroDeps: runtimeDeps.length === 0,
        peerDeps: Object.keys(pkg.peerDependencies ?? {}),
        exports: Object.keys(pkg.exports ?? {}).filter(
          (e) => e !== './package.json'
        ),
        sizeCeilingGzip: budget ? budget.maxGzip : null,
        sizeEntry: budget ? budget.entry : null,
        features: readmeFeatures(readme),
        install: readmeInstall(readme, pkg.name),
        banner,
        hasReadme: readme.length > 0,
        releases: readReleases(pkgDir, relPath),
        docs: readDocs(pkgDir, relPath),
      }
    })
  )
)
  .filter(Boolean)
  .sort((a, b) => {
    // Published first, then by category, then alphabetically — a stable order
    // the UI can rely on without re-sorting.
    if (a.published !== b.published) return a.published ? -1 : 1
    if (a.category !== b.category) return a.category.localeCompare(b.category)
    return a.slug.localeCompare(b.slug)
  })

// ---------------------------------------------------------------------------
// examples — same principle: read them, do not retype them
// ---------------------------------------------------------------------------

const EXAMPLES_DIR = join(REPO_ROOT, 'examples')

const examples = !existsSync(EXAMPLES_DIR)
  ? []
  : readdirSync(EXAMPLES_DIR)
      .filter((dir) => existsSync(join(EXAMPLES_DIR, dir, 'package.json')))
      .map((dir) => {
        const pkg = readJson(join(EXAMPLES_DIR, dir, 'package.json'))
        const readme = readText(join(EXAMPLES_DIR, dir, 'README.md'))
        const scripts = pkg.scripts ?? {}
        return {
          slug: dir,
          name: pkg.name,
          description: pkg.description ?? '',
          tagline: readmeTagline(readme),
          path: `examples/${dir}`,
          // The commands the example documents for itself.
          commands: ['dev', 'start', 'test']
            .filter((s) => scripts[s])
            .map((s) => `pnpm --filter ${pkg.name} ${s}`),
          uses: Object.keys(pkg.dependencies ?? {}).filter((d) =>
            d.startsWith('@tahanabavi/')
          ),
        }
      })
      .sort((a, b) => a.slug.localeCompare(b.slug))

const unchecked = packages.filter((p) => !p.registryChecked)

const registry = {
  generatedAt: new Date().toISOString(),
  source:
    'derived from packages/*/package.json, their READMEs, size-budget.json and the root README',
  /** True when every package's published state came from npm, not a guess. */
  registryComplete: unchecked.length === 0,
  packages,
  examples,
  roadmap: readRoadmap(rootReadme),
}

const outDir = join(WEB_ROOT, 'src', 'generated')
mkdirSync(outDir, { recursive: true })
writeFileSync(
  join(outDir, 'registry.json'),
  JSON.stringify(registry, null, 2) + '\n',
  'utf8'
)

const counts = packages.reduce((acc, p) => {
  acc[p.category] = (acc[p.category] ?? 0) + 1
  return acc
}, {})
console.log(
  `registry: ${packages.length} packages ` +
    `(${packages.filter((p) => p.published).length} published) ` +
    `· ${Object.entries(counts)
      .map(([k, v]) => `${k}:${v}`)
      .join(' ')} ` +
    `· ${examples.length} examples ` +
    `· roadmap ${registry.roadmap.shipped.length} shipped / ${registry.roadmap.next.length} next`
)

const pending = packages.filter((p) => p.pendingVersion)
if (pending.length > 0) {
  console.log(
    `  ahead of npm: ${pending.map((p) => `${p.short} ${p.npmVersion} → ${p.pendingVersion}`).join(', ')}`
  )
}
if (unchecked.length > 0) {
  console.warn(
    `  warning: npm did not answer for ${unchecked.map((p) => p.short).join(', ')} — ` +
      `published state fell back to the local version number`
  )
}
