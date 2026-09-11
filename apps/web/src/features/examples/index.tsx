import { Chip } from '@/components/ui/chip'
import { CommandBar } from '@/components/ui/command-bar'
import { Container } from '@/components/ui/container'
import { Panel } from '@/components/ui/panel'
import { JsonLd } from '@/components/shared/json-ld'
import { site } from '@/config/site'
import { examples } from '@/lib/registry'
import { breadcrumbSchema, collectionSchema, graph } from '@/lib/seo'
import { PATHS } from '@/routes/paths'

export const EXAMPLES_DESCRIPTION =
  'Runnable demos that build against the packages in this repository rather than a published version, so they cannot drift \u2014 several are headless and run in CI.'

export function ExamplesPage() {
  return (
    <Container className="py-16">
      <JsonLd
        data={graph(
          collectionSchema(
            'TypeWire examples',
            EXAMPLES_DESCRIPTION,
            PATHS.EXAMPLES,
            // Each example is a card on this page rather than a page of its
            // own, so the list points at the anchors it actually renders.
            examples.map((example) => ({
              name: example.slug,
              path: `/examples#${example.slug}`,
            }))
          ),
          breadcrumbSchema([
            { name: 'TypeWire', path: '/' },
            { name: 'Examples', path: '/examples' },
          ])
        )}
      />

      <header className="max-w-3xl">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-blue">
          // EXAMPLES
        </p>
        <h1 className="mt-3 text-4xl font-extrabold tracking-tight">
          Runnable, and self-asserting
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Every example builds against the packages in this repo rather than a
          published version, so it cannot drift from the source. Several are
          headless: they assert and exit, which is why they run in CI.
        </p>
      </header>

      <div className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-2">
        {examples.map((example) => {
          const command = example.commands[0]
          return (
            <Panel key={example.slug}>
              <div className="flex items-baseline justify-between gap-3">
                {/* The id is the anchor the page's ItemList points each example
                  at — a link to one example has to land on that example. */}
                <h2
                  id={example.slug}
                  className="scroll-mt-24 font-mono text-lg font-bold text-fg"
                >
                  {example.slug}
                </h2>
                <a
                  href={`${site.repo.url}/tree/${site.repo.branch}/${example.path}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-xs text-blue hover:underline"
                >
                  source ↗
                </a>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {example.description || example.tagline}
              </p>

              {example.uses.length > 0 && (
                <ul className="mt-4 flex flex-wrap gap-1.5">
                  {example.uses.map((dep) => (
                    <li key={dep}>
                      <Chip>{dep.replace('@tahanabavi/', '')}</Chip>
                    </li>
                  ))}
                </ul>
              )}

              {command && <CommandBar command={command} className="mt-5" />}
            </Panel>
          )
        })}
      </div>

      {examples.length === 0 && (
        <p className="mt-12 text-muted-foreground">
          No examples found in the workspace.
        </p>
      )}
    </Container>
  )
}
