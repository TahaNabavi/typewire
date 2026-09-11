#!/usr/bin/env node
/**
 * Zero-dependency assertion
 * =========================
 * `@tahanabavi/typefetch` claims zero runtime dependencies, and the transport
 * packages claim the same. A claim in a README rots; this one is checked.
 *
 * It exists because the failure mode is so easy: someone adds a small utility
 * to solve a real problem, nothing breaks, and the package's headline property
 * is gone without a single red check. Enterprise audits read `dependencies`
 * before they read anything else.
 *
 * `peerDependencies` are deliberately allowed — a peer is the consumer's
 * install, not ours, and `zod` has to be exactly one instance anyway.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { MUST_BE_CLEAN, ALLOWED_DEP } from '../configs/dep-script.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

let failed = false

for (const [pkg, why] of MUST_BE_CLEAN) {
  const manifest = JSON.parse(
    readFileSync(join(root, 'packages', pkg, 'package.json'), 'utf8')
  )
  const deps = Object.keys(manifest.dependencies ?? {})

  if (deps.length) {
    failed = true
    console.error(
      `✗ ${manifest.name} declares ${deps.length} runtime ` +
        `dependenc${deps.length === 1 ? 'y' : 'ies'}: ${deps.join(', ')}\n` +
        `  ${why}.\n` +
        `  Move it to its own package, or make it a peer dependency.\n`
    )
  } else {
    console.log(`✓ ${manifest.name} — zero runtime dependencies`)
  }
}

for (const [pkg, allowed] of Object.entries(ALLOWED_DEP)) {
  const manifest = JSON.parse(
    readFileSync(join(root, 'packages', pkg, 'package.json'), 'utf8')
  )
  const deps = Object.keys(manifest.dependencies ?? {})
  const unexpected = deps.filter((d) => !allowed.includes(d))

  if (unexpected.length) {
    failed = true
    console.error(
      `✗ ${manifest.name} declares unexpected dependencies: ` +
        `${unexpected.join(', ')}\n` +
        `  Allowed here: ${allowed.join(', ')}.\n` +
        `  Add it to scripts/assert-no-deps.mjs in the same PR if it is intended.\n`
    )
  } else {
    console.log(`✓ ${manifest.name} — only ${allowed.join(', ')}`)
  }
}

console.log('')
process.exit(failed ? 1 : 0)
