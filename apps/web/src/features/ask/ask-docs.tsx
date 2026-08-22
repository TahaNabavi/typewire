"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAsk } from "@/features/ask/store";

/**
 * The docs assistant, in three states: idle, streaming and cited.
 *
 * It talks to /api/ask, which searches the same markdown the docs pages render
 * and then — if an ANTHROPIC_API_KEY is configured — has a model answer from
 * those excerpts. With no key the route still answers by streaming the
 * best-matching section verbatim, and says that is what it did. Either way the
 * answer ends in links to the pages it read, which is the whole point: an
 * answer you can go and check.
 */

interface Citation {
  label: string;
  href: string;
}

const SUGGESTED = [
  "How do I add a GraphQL transport?",
  "What is an ErrorKind?",
  "How does the query cache invalidate?",
];

/** Told to the reader, so a weaker answer is never passed off as a stronger one. */
const MODE_NOTE: Record<string, string> = {
  excerpt: "read straight from the page below — no model in the loop",
  generated: "answered from the cited pages",
  empty: "",
};

export function AskDocs() {
  const ask = useAsk((s) => s.ask);
  const setAsk = useAsk((s) => s.setAsk);
  const question = useAsk((s) => s.question);
  const setQuestion = useAsk((s) => s.setQuestion);

  const [answer, setAnswer] = useState("");
  const [citations, setCitations] = useState<Citation[]>([]);
  const [mode, setMode] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);

  // ⌘K / Ctrl-K focuses the field, which is what a developer will try first.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // A question in flight when the section unmounts is a question nobody will read.
  useEffect(() => () => abort.current?.abort(), []);

  async function run(prompt: string) {
    const trimmed = prompt.trim();
    if (trimmed.length < 3) return;

    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;

    setQuestion(trimmed);
    setAnswer("");
    setCitations([]);
    setMode("");
    setError(null);
    setAsk("streaming");

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const detail = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(detail?.error ?? "The assistant could not be reached.");
        setAsk("done");
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // Server-sent events: frames are separated by a blank line, and a frame
      // can arrive split across reads.
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          const line = frame.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          let event: { type?: string; text?: string; citations?: Citation[]; mode?: string };
          try {
            event = JSON.parse(line.slice(6));
          } catch {
            continue;
          }
          if (event.type === "text" && event.text) {
            setAnswer((current) => current + event.text);
          } else if (event.type === "done") {
            setCitations(event.citations ?? []);
            setMode(event.mode ?? "");
          }
        }
      }
      setAsk("done");
    } catch (cause) {
      if ((cause as Error).name === "AbortError") return;
      setError("The assistant could not be reached.");
      setAsk("done");
    }
  }

  function reset() {
    abort.current?.abort();
    setAsk("idle");
    setQuestion("");
    setAnswer("");
    setCitations([]);
    setError(null);
  }

  return (
    <div className="rounded-xl border border-hair bg-canvas/60 p-4">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void run(question);
        }}
        className="flex items-center gap-2"
      >
        <span aria-hidden className="font-mono text-xs text-dim">
          ⌘K
        </span>
        <Input
          ref={input}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask a question about TypeWire…"
          aria-label="Ask a question about TypeWire"
          className="flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0"
        />
        <Button type="submit" size="sm" variant="outline" disabled={ask === "streaming"}>
          {ask === "streaming" ? "…" : "Ask"}
        </Button>
      </form>

      {ask === "idle" ? (
        <ul className="mt-3 flex flex-wrap gap-2">
          {SUGGESTED.map((prompt) => (
            <li key={prompt}>
              <button
                type="button"
                onClick={() => void run(prompt)}
                className="rounded-full border border-hair px-3 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:border-hair-strong hover:text-fg"
              >
                {prompt}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-4 border-t border-hair pt-4">
          {error ? (
            <p className="text-sm text-red">{error}</p>
          ) : (
            <p
              className="text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground"
              aria-live="polite"
              aria-busy={ask === "streaming"}
            >
              {answer}
              {ask === "streaming" && (
                <span
                  aria-hidden
                  className="ml-0.5 inline-block h-3.5 w-[7px] translate-y-0.5 bg-cyan align-middle"
                  style={{ animation: "caret 1s step-end infinite" }}
                />
              )}
            </p>
          )}

          {/* The point of the whole widget: an answer that ends in its sources. */}
          {ask === "done" && citations.length > 0 && (
            <>
              <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.14em] text-dim">
                cited{MODE_NOTE[mode] ? ` · ${MODE_NOTE[mode]}` : ""}
              </p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {citations.map((citation) => (
                  <li key={citation.href}>
                    <a
                      href={citation.href}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-cyan/35 bg-cyan/10 px-2.5 py-1 font-mono text-[11px] text-cyan hover:border-cyan/60"
                    >
                      {citation.label}
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}

          {ask === "done" && (
            <button
              type="button"
              onClick={reset}
              className="mt-4 font-mono text-[11px] text-dim transition-colors hover:text-fg"
            >
              ← ask something else
            </button>
          )}
        </div>
      )}
    </div>
  );
}
