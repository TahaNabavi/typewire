import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { exists } from './config/fs'
import { UsageError } from './errors'
import type { ReleaseDocCommandOptions } from './types'

export type ReleaseDocResult = {
  path: string
  created: boolean
}

/**
 * Scaffold `docs/releases/<version>.md`.
 *
 * The headings are not decoration: they are the questions a reader of a release
 * note actually has, in the order they ask them — what changed, what breaks,
 * and what to do about it. A blank file gets a changelog; a prompted one gets
 * a migration guide.
 */
export async function runReleaseDocCommand(
  options: ReleaseDocCommandOptions = {}
): Promise<ReleaseDocResult> {
  const version = normalizeVersion(options.version)
  const outputDir = resolve(
    process.cwd(),
    options.outputDir ?? './docs/releases'
  )
  const path = join(outputDir, `${version}.md`)

  if ((await exists(path)) && !options.force) {
    return { path, created: false }
  }

  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, template(version, options.title), 'utf8')

  return { path, created: true }
}

/** `2.0.0` and `v2.0.0` both name the same release; the file is `v2.0.0.md`. */
function normalizeVersion(version: string | undefined): string {
  const value = version?.trim()

  if (!value) {
    throw new UsageError(
      `release-doc needs a version.\n` +
        `  typewire release-doc v2.0.0\n` +
        `  typewire release-doc --version 2.0.0 --title "Pluggable transports"`
    )
  }

  if (!/^v?\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(value)) {
    throw new UsageError(
      `"${value}" is not a version. Expected something like v2.0.0 or 2.1.0-rc.1.`
    )
  }

  return value.startsWith('v') ? value : `v${value}`
}

function template(version: string, title: string | undefined): string {
  const heading = title ? `${version} — ${title}` : version

  return `# ${heading}

<!-- One paragraph: what a reader gets from this release that they did not have
     before. Not a list of commits — the reason to upgrade. -->

---

## 1. What changed

<!-- The headline change, explained by what it makes possible. -->

## 2. New API

| Export | Purpose |
| --- | --- |
|  |  |

## 3. Behaviour changes

<!-- Changes that are not new API: different defaults, different error shapes,
     different timing. These are what break people quietly. -->

| Before | After | Why |
| --- | --- | --- |
|  |  |  |

## 4. Breaking changes

<!-- Delete this section if there are none. Do not soften it if there are. -->

| Change | Migration |
| --- | --- |
|  |  |

## 5. Migration

\`\`\`diff
- // before
+ // after
\`\`\`

## 6. Backward compatibility

<!-- What still works untouched. As important as the breakage: it is what tells
     a reader how large the upgrade actually is. -->

## 7. Deliberately out of scope

<!-- What this release does not do, and why. Prevents the same issue being
     filed three times. -->
`
}
