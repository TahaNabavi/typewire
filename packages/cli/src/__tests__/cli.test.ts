import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseCliArgs } from '../parse-args'
import { runReleaseDocCommand } from '../release-doc'
import { UsageError } from '../errors'

describe('TypeFetch CLI', () => {
  describe('parseCliArgs', () => {
    it('uses test as the default command', () => {
      expect(parseCliArgs([])).toEqual({
        command: 'test',
        flags: {},
        positionals: [],
        raw: [],
      })
    })

    it('parses the test command with common flags', () => {
      const parsed = parseCliArgs([
        'test',
        '--config',
        './typefetch.test.config.ts',
        '--mode',
        'full',
        '--include-tags',
        'smoke,user',
        '--exclude-tags=danger',
        '--include-destructive',
        '--no-stop-on-fail',
        '--format',
        'markdown,json,html',
        '--output',
        './typefetch-report/report',
      ])

      expect(parsed.command).toBe('test')
      expect(parsed.flags).toMatchObject({
        config: './typefetch.test.config.ts',
        mode: 'full',
        includeTags: 'smoke,user',
        excludeTags: 'danger',
        includeDestructive: true,
        stopOnFail: false,
        format: 'markdown,json,html',
        output: './typefetch-report/report',
      })
    })

    it('parses short aliases', () => {
      const parsed = parseCliArgs([
        'test',
        '-c',
        './config.ts',
        '-m',
        'live',
        '-f',
        'json',
        '-o',
        './report',
      ])

      expect(parsed.flags).toMatchObject({
        config: './config.ts',
        mode: 'live',
        format: 'json',
        output: './report',
      })
    })

    it('switches to help and version commands from flags', () => {
      expect(parseCliArgs(['--help']).command).toBe('help')
      expect(parseCliArgs(['--version']).command).toBe('version')
    })

    it('parses release-doc positional version', () => {
      const parsed = parseCliArgs([
        'release-doc',
        'v1.6.0',
        '--title',
        'Testing Feature',
      ])

      expect(parsed.command).toBe('release-doc')
      expect(parsed.positionals).toEqual(['v1.6.0'])
      expect(parsed.flags.title).toBe('Testing Feature')
    })
  })
})

describe('release-doc', () => {
  let root: string
  let cwd: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'typewire-release-'))
    cwd = process.cwd()
    process.chdir(root)
  })

  afterEach(async () => {
    process.chdir(cwd)
    await rm(root, { recursive: true, force: true })
  })

  it('writes docs/releases/<version>.md', async () => {
    const result = await runReleaseDocCommand({
      version: 'v2.0.0',
      title: 'Pluggable transports',
    })

    expect(result.created).toBe(true)
    expect(result.path).toBe(join(root, 'docs', 'releases', 'v2.0.0.md'))
    await expect(readFile(result.path, 'utf8')).resolves.toContain(
      '# v2.0.0 — Pluggable transports'
    )
  })

  it('accepts a version with or without the v', async () => {
    const result = await runReleaseDocCommand({ version: '2.1.0' })
    expect(result.path.endsWith('v2.1.0.md')).toBe(true)
  })

  it('never overwrites an existing note without --force', async () => {
    await runReleaseDocCommand({ version: 'v2.0.0' })
    await writeFile(
      join(root, 'docs', 'releases', 'v2.0.0.md'),
      'written',
      'utf8'
    )

    // A release note is hand-written after scaffolding. Silently replacing one
    // destroys the only copy of work the tool cannot regenerate.
    expect((await runReleaseDocCommand({ version: 'v2.0.0' })).created).toBe(
      false
    )
    await expect(
      readFile(join(root, 'docs', 'releases', 'v2.0.0.md'), 'utf8')
    ).resolves.toBe('written')

    expect(
      (await runReleaseDocCommand({ version: 'v2.0.0', force: true })).created
    ).toBe(true)
  })

  it('asks for a version instead of guessing one', async () => {
    await expect(runReleaseDocCommand({})).rejects.toThrow(
      /release-doc needs a version[\s\S]*typewire release-doc v2\.0\.0/
    )
  })

  it('rejects something that is not a version', async () => {
    await expect(runReleaseDocCommand({ version: 'next' })).rejects.toThrow(
      /"next" is not a version/
    )
  })

  it('exits 2 on bad usage, not 1', async () => {
    // 1 is reserved for findings — the code a CI gate is allowed to expect.
    // "you called this wrong" has to be distinguishable from "your tests failed".
    const error = await runReleaseDocCommand({ version: 'next' }).catch(
      (e: unknown) => e
    )

    expect(error).toBeInstanceOf(UsageError)
    expect((error as UsageError).exitCode).toBe(2)
  })

  it('honours --output-dir', async () => {
    const result = await runReleaseDocCommand({
      version: 'v3.0.0',
      outputDir: './notes',
    })
    expect(result.path).toBe(join(root, 'notes', 'v3.0.0.md'))
  })
})
