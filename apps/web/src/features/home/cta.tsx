import { CommandBar } from '@/components/ui/command-bar'
import { Container } from '@/components/ui/container'
import { site } from '@/config/site'
import { SignalField } from '@/features/home/signal-field'
import { install } from '@/lib/registry'

export function Cta() {
  return (
    <section className="relative overflow-hidden border-t border-hair py-24">
      {/* The second and last place the glyph field appears. */}
      <SignalField />
      <Container className="relative">
        <div className="mx-auto max-w-2xl text-center">
          {/* Reveal instance 2 of 2 — the budget is spent here. */}
          <h2 className="reveal-sweep text-3xl font-extrabold tracking-tight text-fg md:text-4xl">
            <span>Define it once.</span>
            <span>Wire it everywhere.</span>
          </h2>
          <div className="enter-up">
            <CommandBar
              command={install.primary}
              className="mx-auto mt-8 max-w-md"
            />
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <a
                href={site.repo.url}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-hair-strong px-5 py-2.5 text-sm font-semibold text-fg transition-colors duration-(--motion-ui) hover:bg-panel"
              >
                Star on GitHub
              </a>
            </div>
          </div>
        </div>
      </Container>
    </section>
  )
}
