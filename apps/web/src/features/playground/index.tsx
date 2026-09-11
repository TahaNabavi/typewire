import Link from 'next/link'

import { CodeBlock } from '@/components/ui/code-block'
import { Container } from '@/components/ui/container'
import { Panel } from '@/components/ui/panel'
import { JsonLd } from '@/components/shared/json-ld'
import { site } from '@/config/site'
import { PlaygroundConsole } from '@/features/playground/console'
import { CONTRACT_SOURCE, SERVER_SOURCE } from '@/features/playground/contracts'
import { breadcrumbSchema, graph } from '@/lib/seo'
import { PATHS } from '@/routes/paths'

const FILES = [
  {
    path: 'src/features/playground/contracts.ts',
    role: 'the contract',
    note: 'Imported by both sides. Nothing else is shared.',
    tone: 'var(--cyan)',
  },
  {
    path: 'src/features/playground/console.tsx',
    role: 'the client',
    note: 'Builds an ApiClient from that object and calls it.',
    tone: 'var(--wire-http)',
  },
  {
    path: 'src/app/api/playground/[...path]/route.ts',
    role: 'the server',
    note: 'Implements the same endpoints and validates its own answers.',
    tone: 'var(--wire-grpc)',
  },
]

export function PlaygroundPage() {
  return (
    <Container className="py-16">
      <JsonLd
        data={graph(
          breadcrumbSchema([
            { name: 'TypeWire', path: '/' },
            { name: 'Playground', path: '/playground' },
          ])
        )}
      />

      <header className="max-w-3xl">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-blue">
          // PLAYGROUND
        </p>
        <h1 className="mt-3 text-4xl font-extrabold tracking-tight">
          A real project, running on this page
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
          This is not a diagram of TypeWire. It is{' '}
          <code className="font-mono text-fg">@tahanabavi/typefetch</code> in
          your browser, talking to route handlers on this site, both built from
          one contract object — and a switch that breaks the server so you can
          watch validation catch it.
        </p>
      </header>

      {/* The layout of the thing being demonstrated, before the demonstration. */}
      <div className="enter-group mt-10 grid grid-cols-1 gap-4 md:grid-cols-3">
        {FILES.map((file) => (
          <div
            key={file.path}
            className="rounded-xl border border-hair bg-linear-to-b from-panel to-panel-2 p-4"
            style={{ borderTopColor: file.tone, borderTopWidth: 2 }}
          >
            <p
              className="font-mono text-[11px] uppercase tracking-[0.14em]"
              style={{ color: file.tone }}
            >
              {file.role}
            </p>
            <p
              className="mt-1.5 truncate font-mono text-xs text-fg"
              title={file.path}
            >
              {file.path}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {file.note}
            </p>
          </div>
        ))}
      </div>

      <div className="enter-up mt-10">
        <PlaygroundConsole />
      </div>

      <div className="enter-group mt-10 grid grid-cols-1 gap-5 lg:grid-cols-[1.2fr_1fr]">
        <div className="min-w-0">
          <h2 className="mb-3 font-mono text-xs uppercase tracking-[0.18em] text-dim">
            The contract, in full
          </h2>
          <CodeBlock
            code={CONTRACT_SOURCE}
            filename="src/features/playground/contracts.ts"
          />
        </div>

        <div className="min-w-0 space-y-5">
          <div className="min-w-0">
            <h2 className="mb-3 font-mono text-xs uppercase tracking-[0.18em] text-dim">
              How the server uses it
            </h2>
            <CodeBlock code={SERVER_SOURCE} filename="route.ts" />
          </div>

          <Panel>
            <h3 className="text-base font-bold text-fg">
              What this page is honest about
            </h3>
            <ul className="mt-3 space-y-2.5 text-sm leading-relaxed text-muted-foreground">
              <li className="flex gap-2.5">
                <span
                  aria-hidden
                  className="mt-1.5 size-1.5 flex-none rounded-full bg-dim"
                />
                The fixture is a module-level array, shared by everyone and
                reset whenever the serverless instance recycles. A user you
                create may be visible to the next visitor, and may vanish a
                minute later.
              </li>
              <li className="flex gap-2.5">
                <span
                  aria-hidden
                  className="mt-1.5 size-1.5 flex-none rounded-full bg-dim"
                />
                Only the HTTP transport runs here. GraphQL, gRPC and WebSocket
                use the same contract object, but their packages are not
                published yet.
              </li>
              <li className="flex gap-2.5">
                <span
                  aria-hidden
                  className="mt-1.5 size-1.5 flex-none rounded-full bg-dim"
                />
                You cannot edit the contract from the page. Doing that honestly
                needs a type-checking compiler in the browser, and a version
                that only pretends to typecheck would undercut the one claim
                this project makes.
              </li>
            </ul>
          </Panel>
        </div>
      </div>

      <div className="mt-12 flex flex-wrap items-center gap-4">
        <Link
          href={PATHS.EXAMPLES}
          className="rounded-lg border border-hair-strong px-5 py-2.5 text-sm font-semibold text-fg transition-colors duration-(--motion-ui) hover:bg-panel"
        >
          Runnable examples in the repo
        </Link>
        <a
          href={`${site.repo.url}/tree/${site.repo.branch}/apps/web/src/features/playground`}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-blue hover:underline"
        >
          This page&apos;s source ↗
        </a>
      </div>
    </Container>
  )
}
