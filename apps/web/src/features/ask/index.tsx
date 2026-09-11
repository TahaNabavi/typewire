import { Panel } from '@/components/ui/panel'
import { Section } from '@/components/ui/section'
import { site } from '@/config/site'
import { AskDocs } from '@/features/ask/ask-docs'

const AGENT_POINTS = [
  'The contract is a plain object — an agent can read it, diff it and generate against it with no codegen step.',
  'AGENTS.md ships in the repo: layout, a per-change definition of done, and the docs conventions an agent must follow.',
  'Runtime validation means a hallucinated field fails loudly at the boundary instead of shipping.',
  'npx typewire init detects the project and scaffolds a working setup in one command.',
]

export function AiSupport() {
  return (
    <Section
      id="ai"
      kicker="// BUILT FOR AGENTS"
      title="A contract is the best possible input for an AI agent"
      lede="Machine-readable by construction, validated at runtime, and documented for agents in the repo itself."
    >
      <div className="enter-group grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel>
          <h3 className="text-lg font-bold text-fg">
            Your agent already understands TypeWire
          </h3>
          <ul className="mt-4 space-y-3">
            {AGENT_POINTS.map((point) => (
              <li
                key={point}
                className="flex gap-3 text-sm leading-relaxed text-muted-foreground"
              >
                <span
                  aria-hidden
                  className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-cyan"
                />
                {point}
              </li>
            ))}
          </ul>
          <a
            href={`${site.repo.url}/blob/main/AGENTS.md`}
            target="_blank"
            rel="noreferrer"
            className="mt-5 inline-block text-sm text-blue hover:underline"
          >
            Read AGENTS.md ↗
          </a>
        </Panel>

        <Panel>
          <h3 className="text-lg font-bold text-fg">Ask the docs</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            A docs assistant that answers from these pages and cites them.
          </p>
          <div className="mt-5">
            <AskDocs />
          </div>
          <p className="mt-4 font-mono text-xs leading-relaxed text-muted-foreground">
            It searches the same markdown these docs pages render, so every
            answer ends in the pages it read — and it will say it does not know
            rather than invent an option.
          </p>
        </Panel>
      </div>
    </Section>
  )
}
