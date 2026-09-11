import { Chip } from '@/components/ui/chip'
import { Panel } from '@/components/ui/panel'
import { Section } from '@/components/ui/section'
import { site } from '@/config/site'
import { getGoodFirstIssues } from '@/features/project-status/github'

const FLOW = ['fork', 'branch', 'change + test', 'changeset', 'PR']

const GATES = [
  {
    title: 'Breakage alert',
    body: "Every PR runs build → typecheck → test in topological order. Dependents typecheck against their dependency's freshly built types, so a breaking change in one package reddens the check for the packages that use it.",
  },
  {
    title: 'No broken publish',
    body: 'Release re-runs the same gate before changeset publish, and Changesets bumps every internal dependent — so npm consumers always resolve compatible versions.',
  },
]

export async function Collaborate() {
  const issues = await getGoodFirstIssues()

  return (
    <Section
      id="collaborate"
      kicker="// COLLABORATE"
      title="A change that breaks another package cannot merge quietly"
      lede="Contributing is a five-step flow with two gates behind it."
    >
      <ol className="enter-group flex flex-wrap items-center gap-2">
        {FLOW.map((step, i) => (
          <li key={step} className="flex items-center gap-2">
            {i > 0 && (
              <span aria-hidden className="text-dim">
                →
              </span>
            )}
            <span className="rounded-lg border border-hair bg-panel/60 px-3 py-1.5 font-mono text-xs text-fg">
              {step}
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-sm text-muted-foreground">
        Every PR that changes a package&apos;s source must include a changeset.
      </p>

      <div className="enter-group mt-10 grid grid-cols-1 gap-5 md:grid-cols-2">
        {GATES.map((gate) => (
          <Panel key={gate.title}>
            <h3 className="text-lg font-bold text-fg">{gate.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {gate.body}
            </p>
          </Panel>
        ))}
      </div>

      <div className="enter-group mt-10 grid grid-cols-1 gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Panel>
          <h3 className="text-sm font-bold text-fg">Good first issues</h3>
          {issues.data.length > 0 ? (
            <ul className="mt-4 space-y-3">
              {issues.data.map((issue) => (
                <li key={issue.number} className="flex items-start gap-3">
                  <span className="font-mono text-xs text-dim">
                    #{issue.number}
                  </span>
                  <a
                    href={issue.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1 text-sm text-muted-foreground hover:text-fg"
                  >
                    {issue.title}
                  </a>
                  <span className="flex gap-1">
                    {issue.labels.slice(0, 2).map((label) => (
                      <Chip key={label}>{label}</Chip>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-dim">
              None open right now —{' '}
              <a
                href={`${site.repo.url}/issues`}
                target="_blank"
                rel="noreferrer"
                className="text-blue hover:underline"
              >
                browse all issues ↗
              </a>
            </p>
          )}
        </Panel>

        <Panel>
          <h3 className="text-sm font-bold text-fg">Prerequisites</h3>
          <dl className="mt-4 space-y-2 font-mono text-xs">
            <div className="flex justify-between gap-3">
              <dt className="text-dim">Node.js</dt>
              <dd className="text-fg">≥ 22.13</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-dim">pnpm</dt>
              <dd className="text-fg">11.6.0</dd>
            </div>
          </dl>
          <ul className="mt-5 space-y-2 text-sm">
            {[
              [
                'Contributing guide',
                `${site.repo.url}/blob/main/CONTRIBUTING.md`,
              ],
              [
                'Code of Conduct',
                `${site.repo.url}/blob/main/CODE_OF_CONDUCT.md`,
              ],
              [
                'Architecture',
                `${site.repo.url}/blob/main/docs/ARCHITECTURE.md`,
              ],
            ].map(([label, href]) => (
              <li key={label}>
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue hover:underline"
                >
                  {label} ↗
                </a>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </Section>
  )
}
