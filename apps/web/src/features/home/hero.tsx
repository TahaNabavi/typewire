import Link from 'next/link'

import { CodeBlock } from '@/components/ui/code-block'
import { Container } from '@/components/ui/container'
import { site } from '@/config/site'
import { RUNTIME_ICONS } from '@/features/home/constants'
import { SignalField } from '@/features/home/signal-field'
import {
  InstallTerminal,
  type TerminalLine,
} from '@/features/home/install-terminal'
import { WireFan, type Consumer } from '@/features/transports/wire-fan'
import { install, packages, publishedPackages } from '@/lib/registry'

const CONTRACT = `// contracts.ts
export const contracts = {
  user: {
    getUser: {
      method: "GET",
      path: "/users/:id",
      request:  z.object({ path: z.object({ id: z.string() }) }),
      response: z.object({ id: z.string(), name: z.string() }),
    },
  },
} as const;`

/** What `typewire init` prints: it reads the project before it asks anything. */
const SCAFFOLD_OUTPUT: TerminalLine[] = [
  {
    text: '✓ detected  Next 16 · React 19 · pnpm workspace',
    tone: 'text-green',
  },
  { text: '? packages  › typefetch, typefetch-react, type-devtools' },
  { text: '? transport › http (in core) + graphql' },
  { text: '✓ wrote     src/contracts.ts', tone: 'text-green' },
  { text: '✓ wrote     src/lib/client.ts', tone: 'text-green' },
  { text: '✓ wrote     typewire.config.ts', tone: 'text-green' },
  { text: '→ next      pnpm dev', tone: 'text-cyan' },
]

/** The four consumers of that one object — the argument of the whole site. */
const CONSUMERS: Consumer[] = [
  {
    name: 'typefetch',
    role: 'client',
    transport: 'http',
    snippet: 'await client.modules.user.getUser({ path: { id } })',
  },
  {
    name: 'typewire-nestjs',
    role: 'server',
    transport: 'grpc',
    snippet: '@TypeFetchEndpoint(contracts.user.getUser)',
  },
  {
    name: 'query-core',
    role: 'cache',
    transport: 'graphql',
    snippet: 'useQuery(contracts.user.getUser, { path: { id } })',
  },
  {
    name: 'type-devtools',
    role: 'inspector',
    transport: 'ws',
    snippet: 'one timeline, every wire',
  },
]

export function Hero() {
  const zeroDep = packages.filter((p) => p.zeroDeps).length

  return (
    <section className="relative overflow-hidden pt-16 pb-20 md:pt-24 md:pb-28">
      {/* The glyph field replaces the page grid here and at the CTA — nowhere else. */}
      <SignalField />
      <Container className="relative">
        <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-[52fr_48fr]">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-2.5 rounded-full border border-blue/35 bg-blue/10 px-3 py-1.5 font-mono text-[11px] font-bold tracking-[0.14em] text-blue">
              <span
                aria-hidden
                className="h-3.5 w-1 rounded-sm bg-linear-to-b from-cyan to-purple"
              />
              THE {site.scope}/* ECOSYSTEM
            </span>

            <h1 className="mt-6 text-5xl font-extrabold leading-[1.05] tracking-tight md:text-6xl">
              <span className="text-fg">Typed contracts.</span>
              <br />
              <span className="bg-linear-to-r from-blue to-cyan bg-clip-text text-transparent">
                Any transport.
              </span>
            </h1>

            <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
              Define your API once as a{' '}
              <code className="font-mono text-fg">Zod</code> contract — then
              validate it end-to-end across HTTP, WebSocket, and the server. One
              source of truth, wired to everything.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/docs"
                className="rounded-lg bg-linear-to-r from-blue-strong to-purple-strong px-5 py-2.5 text-sm font-semibold text-white"
              >
                Get started
              </Link>
              <Link
                href="/packages"
                className="rounded-lg border border-hair-strong px-5 py-2.5 text-sm font-semibold text-fg transition-colors hover:bg-panel"
              >
                Browse packages
              </Link>
              <a
                href={site.repo.url}
                target="_blank"
                rel="noreferrer"
                className="px-2 py-2.5 text-sm text-muted-foreground transition-colors hover:text-fg"
              >
                View on GitHub ↗
              </a>
            </div>

            <InstallTerminal
              command={install.primary}
              output={SCAFFOLD_OUTPUT}
              className="mt-7 max-w-md"
            />
            <p className="mt-2 font-mono text-xs leading-relaxed text-muted-foreground">
              {install.available ? (
                'Reads your project, asks what it needs, wires it up.'
              ) : (
                <>
                  Reads your project, asks what it needs, wires it up. The CLI
                  is built and tested in the repo but not published yet — until
                  it is, <code className="text-fg">{install.today}</code> is the
                  line that runs today.
                </>
              )}
            </p>

            <ul className="mt-10 flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-xs text-dim">
              {[
                `${packages.length} packages`,
                `${publishedPackages.length} on npm`,
                `${zeroDep} with zero runtime deps`,
                'Zod 4',
                'MIT',
              ].map((fact, i) => (
                <li key={fact} className="flex items-center gap-3">
                  {i > 0 && <span aria-hidden>·</span>}
                  {fact}
                </li>
              ))}

              {/* The runtimes earn marks rather than words: four glyphs read
                  faster than "Node · Bun · Deno", and say the same thing. */}
              <li className="flex items-center gap-3">
                <span aria-hidden>·</span>
                <span className="flex items-center gap-2.5">
                  {RUNTIME_ICONS.map(({ label, Icon }) => (
                    <span
                      key={label}
                      className="group/rt relative flex items-center"
                    >
                      <Icon className="size-4 opacity-70 transition-opacity group-hover/rt:opacity-100" />
                      <span className="sr-only">{label}</span>
                      <span
                        aria-hidden
                        className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 rounded border border-hair bg-panel px-1.5 py-0.5 text-[10px] whitespace-nowrap opacity-0 transition-opacity group-hover/rt:opacity-100"
                      >
                        {label}
                      </span>
                    </span>
                  ))}
                </span>
              </li>
            </ul>
          </div>

          <div>
            <CodeBlock code={CONTRACT} filename="contracts.ts" />

            {/* One object, four consumers — the argument, drawn and cycling. */}
            <WireFan consumers={CONSUMERS} />

            <p className="mt-4 text-center font-mono text-xs uppercase tracking-[0.18em] text-dim">
              one object · four consumers
            </p>
          </div>
        </div>
      </Container>
    </section>
  )
}
