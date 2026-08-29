import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Panel } from "@/components/ui/panel";
import { Section } from "@/components/ui/section";
import { site } from "@/config/site";
import { faq } from "@/features/support/constants";

const CHANNELS = [
  {
    title: "GitHub Issues",
    when: "A bug, or a feature you want.",
    body: "For anything non-trivial, open an issue first so the approach is agreed before you invest time in a PR.",
    href: `${site.repo.url}/issues/new/choose`,
    cta: "Open an issue",
    tone: "var(--blue)",
  },
  {
    title: "GitHub Discussions",
    when: "A question, a pattern, or something you built.",
    body: "Usage questions and design discussion live here rather than in the issue tracker.",
    href: `${site.repo.url}/discussions`,
    cta: "Start a discussion",
    tone: "var(--cyan)",
  },
  {
    title: "Security advisories",
    when: "A vulnerability.",
    body: "Please do not report security vulnerabilities through public issues, discussions, or pull requests. Use GitHub's private reporting flow.",
    href: `${site.repo.url}/security/advisories/new`,
    cta: "Report a vulnerability",
    tone: "var(--amber)",
  },
];

export function Support() {
  return (
    <Section
      id="support"
      alt
      kicker="// SUPPORT"
      title="Where to take a problem"
      lede="Three routes, each with a different front door."
    >
      <div className="enter-group grid grid-cols-1 gap-5 lg:grid-cols-3">
        {CHANNELS.map((channel) => (
          <Panel key={channel.title} className="flex flex-col">
            <div
              aria-hidden
              className="mb-4 h-1 w-10 rounded-full"
              style={{ background: channel.tone }}
            />
            <h3 className="text-lg font-bold text-fg">{channel.title}</h3>
            <p className="mt-1 font-mono text-xs text-dim">{channel.when}</p>
            <p className="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground">{channel.body}</p>
            <a
              href={channel.href}
              target="_blank"
              rel="noreferrer"
              className="mt-5 text-sm font-semibold hover:underline"
              style={{ color: channel.tone }}
            >
              {channel.cta} ↗
            </a>
          </Panel>
        ))}
      </div>

      <div className="enter-up mt-14">
        <h3 className="mb-5 font-mono text-xs uppercase tracking-[0.18em] text-dim">
          Frequently asked
        </h3>
        {/* One answer open at a time — the list is long enough that several
            open at once buries the questions. */}
        <Accordion multiple={false} className="border-y border-hair">
          {faq.map((item) => (
            <AccordionItem key={item.q} value={item.q} className="border-hair">
              <AccordionTrigger className="text-left text-base font-semibold text-fg">
                {item.q}
              </AccordionTrigger>
              <AccordionContent className="text-sm leading-relaxed text-muted-foreground">
                {item.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </Section>
  );
}
