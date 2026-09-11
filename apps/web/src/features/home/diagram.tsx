import { ArchDiagram } from '@/components/shared/arch-diagram'
import { Panel, Section } from '@/components/ui'

export function Diagram() {
  return (
    <Section
      id="features"
      alt
      kicker="// DIAGRAM"
      title="How the monorepo fits together"
    >
      <Panel className="mt-14">
        <p className="pb-5 text-sm text-muted-foreground">
          Every one of these keys on the same{' '}
          <code className="text-cyan">&quot;module.member&quot;</code> id —
          which is why adding a transport needed no change to query-core,
          devtools or the React adapter.
        </p>
        <ArchDiagram />
      </Panel>
    </Section>
  )
}
