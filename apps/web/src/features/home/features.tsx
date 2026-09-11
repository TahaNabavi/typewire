import { Panel } from '@/components/ui/panel'
import { Section } from '@/components/ui/section'
import { DevtoolsPanel } from '@/features/devtools'

const FEATURES = [
  {
    title: 'One source of truth',
    body: 'The contract is a plain object. Client, server, cache and devtools all read the same one — nothing to keep in sync.',
    span: 'md:col-span-2',
  },
  {
    title: 'Runtime-validated, not just typed',
    body: 'Every request and response is checked with Zod, so a wrong shape fails loudly instead of corrupting state silently.',
  },
  {
    title: 'Framework-agnostic core',
    body: 'The query engine is pure logic behind a subscribe/getSnapshot contract — React today; Vue, Angular and Svelte by design.',
  },
  {
    title: 'Zero-cost when unused',
    body: 'Instrumentation, overrides and every advanced feature are additive — the base clients behave exactly as before without them.',
  },
  {
    title: 'Zero runtime dependencies, asserted',
    body: 'Not claimed in a README: scripts/assert-no-deps.mjs fails CI the moment a dependency appears in the core.',
  },
]

export function Features() {
  return (
    <Section
      id="features"
      alt
      kicker="// WHY TYPEWIRE"
      title="Built so the pieces cannot drift apart"
    >
      {/* The headline feature gets the whole width: one timeline, four wires. */}
      <Panel className="enter-up mb-5">
        <div className="flex flex-wrap items-start justify-between gap-4 pb-5">
          <div className="max-w-xl">
            <h3 className="text-lg font-bold text-fg">
              Transport-agnostic devtools
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              REST, GraphQL, gRPC and WebSocket traffic land in one live
              timeline — each row badged by the wire it used, each failure named
              by the same taxonomy. Hover a wire to isolate it.
            </p>
          </div>
        </div>
        <DevtoolsPanel />
      </Panel>

      <div className="enter-group grid grid-cols-1 gap-5 md:grid-cols-3">
        {FEATURES.map((feature) => (
          <Panel key={feature.title} className={feature.span}>
            <h3 className="text-lg font-bold text-fg">{feature.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {feature.body}
            </p>
          </Panel>
        ))}
      </div>
    </Section>
  )
}
