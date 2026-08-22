"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Panel } from "@/components/ui/panel";
import { Section } from "@/components/ui/section";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { site } from "@/config/site";
import { cn } from "@/utils";

const REACTIONS = [
  { emoji: "👍", label: "works well" },
  { emoji: "🤔", label: "confusing" },
  { emoji: "🐛", label: "something broke" },
];

/** Just enough of a package to fill the select — the full registry stays server-side. */
export interface FeedbackOption {
  npm: string;
  short: string;
}

export function Feedback({ options }: { options: FeedbackOption[] }) {
  const [pkg, setPkg] = useState(options[0]?.npm ?? "");
  const [reaction, setReaction] = useState(REACTIONS[0]!.label);
  const [message, setMessage] = useState("");
  const [handle, setHandle] = useState("");
  const [sent, setSent] = useState(false);

  const issueUrl = (() => {
    const params = new URLSearchParams({
      title: `feedback: ${pkg.replace("@tahanabavi/", "")} — ${reaction}`,
      body: `**Package:** \`${pkg}\`\n**Reaction:** ${reaction}\n\n${message}`,
      labels: "feedback",
    });
    return `${site.repo.url}/issues/new?${params.toString()}`;
  })();

  /**
   * Store first, then hand off to GitHub. The issue is the public, traceable
   * record; the stored copy is what survives someone closing that tab without
   * pressing submit.
   */
  async function send() {
    if (message.trim().length < 3) return;
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ package: pkg, reaction, message, handle: handle || null }),
      });
    } catch {
      /* the GitHub hand-off still works without the database */
    }
    setSent(true);
    window.open(issueUrl, "_blank", "noopener");
  }

  return (
    <Section
      id="feedback"
      alt
      kicker="// FEEDBACK"
      title="The project is young. Tell us what breaks."
      lede="No testimonial wall yet — these slots hold real quotes when there are real quotes."
    >
      <div className="enter-group grid grid-cols-1 gap-5 lg:grid-cols-[1fr_1.2fr]">
        <Panel dashed className="items-center justify-center py-12 text-center">
          <p className="font-mono text-sm text-muted-foreground">No quotes yet — be the first.</p>
          <p className="mt-2 text-sm text-dim">
            If TypeWire is running in something real, say so and it goes here.
          </p>
        </Panel>

        {sent ? (
          <Panel className="items-center justify-center py-12 text-center">
            <span className="mx-auto flex size-11 items-center justify-center rounded-full border border-green/45 bg-green/10 text-lg text-green">
              ✓
            </span>
            <h3 className="mt-3 text-lg font-bold text-fg">Issue drafted</h3>
            <p className="mx-auto mt-2 max-w-xs text-sm text-muted-foreground">
              We opened a prefilled issue in a new tab — review it and submit there. Your message is
              already saved either way.
            </p>
            <Button variant="outline" className="mt-5" onClick={() => setSent(false)}>
              Send another
            </Button>
          </Panel>
        ) : (
          <Panel>
            <div className="grid grid-cols-1 gap-4 pb-4 sm:grid-cols-2">
              <label className="block">
                <span className="font-mono text-[11px] uppercase tracking-wider text-dim">
                  Package
                </span>
                <Select value={pkg} onValueChange={(value) => setPkg(String(value))}>
                  <SelectTrigger className="mt-1.5 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((option) => (
                      <SelectItem key={option.npm} value={option.npm}>
                        {option.short}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>

              <fieldset>
                <legend className="font-mono text-[11px] uppercase tracking-wider text-dim">
                  Reaction
                </legend>
                <div className="mt-1.5 flex gap-2">
                  {REACTIONS.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => setReaction(item.label)}
                      aria-pressed={reaction === item.label}
                      title={item.label}
                      className={cn(
                        "h-9 rounded-lg border px-3 text-lg transition-colors",
                        reaction === item.label
                          ? "border-ring bg-accent"
                          : "border-hair hover:border-hair-strong",
                      )}
                    >
                      {item.emoji}
                    </button>
                  ))}
                </div>
              </fieldset>
            </div>

            <label className="block pb-4">
              <span className="font-mono text-[11px] uppercase tracking-wider text-dim">
                What happened
              </span>
              <Textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                rows={4}
                placeholder="Steps, expected, actual."
                className="mt-1.5"
              />
            </label>

            <label className="block pb-5">
              <span className="font-mono text-[11px] uppercase tracking-wider text-dim">
                GitHub handle · optional
              </span>
              <Input
                value={handle}
                onChange={(event) => setHandle(event.target.value)}
                placeholder="@you"
                className="mt-1.5 font-mono"
              />
            </label>

            <Button
              onClick={() => void send()}
              disabled={message.trim().length < 3}
              className="w-full bg-linear-to-r from-blue-strong to-purple-strong text-white"
            >
              Send feedback
            </Button>
            <p className="mt-2 font-mono text-[11px] text-dim">
              → opens a prefilled issue on github.com/{site.repo.owner}/{site.repo.name}
            </p>
          </Panel>
        )}
      </div>
    </Section>
  );
}
