"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/utils";

/**
 * The install command, typed out, then its output.
 *
 * From the design: the hero should show what the command *does*, not just what
 * to paste. Skip jumps to the finished state, and reduced-motion users get that
 * state immediately — the content is never gated behind an animation.
 *
 * Which command it types is decided by the caller from the registry, not by
 * this component: `npx typewire init` is the intended front door but the CLI is
 * not on npm yet, and a hero that prints a command which fails on a clean
 * machine is the worst thing this page could do.
 */

export interface TerminalLine {
  text: string;
  tone?: string;
}

export function InstallTerminal({
  command,
  output,
  className,
}: {
  command: string;
  output: TerminalLine[];
  className?: string;
}) {
  const [typed, setTyped] = useState(0);
  const [lines, setLines] = useState(0);
  const done = typed >= command.length && lines >= output.length;
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  function skip() {
    if (timer.current) clearInterval(timer.current);
    setTyped(command.length);
    setLines(output.length);
  }

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setTyped(command.length);
      setLines(output.length);
      return;
    }

    let tick = 0;
    timer.current = setInterval(() => {
      tick += 1;
      if (tick <= command.length) {
        setTyped(tick);
        return;
      }
      const line = Math.floor((tick - command.length - 8) / 5);
      if (line >= 0) setLines(Math.min(line, output.length));
      if (line > output.length && timer.current) clearInterval(timer.current);
    }, 38);

    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [command, output.length]);

  return (
    <div
      className={cn(
        "code-surface overflow-hidden rounded-xl border border-hair shadow-[0_30px_70px_-34px_rgba(0,0,0,0.7)]",
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b border-hair px-3 py-2.5">
        <span aria-hidden className="size-2 rounded-full bg-red/70" />
        <span aria-hidden className="size-2 rounded-full bg-amber/70" />
        <span aria-hidden className="size-2 rounded-full bg-green/70" />
        <span className="ml-1 font-mono text-[11px] text-dim">zsh · ~/app</span>
        {done ? (
          <span className="ml-auto font-mono text-[10px] tracking-[0.08em] text-dim">DONE</span>
        ) : (
          <button
            type="button"
            onClick={skip}
            className="ml-auto rounded font-mono text-[10px] tracking-[0.08em] text-dim transition-colors hover:text-fg"
          >
            SKIP
          </button>
        )}
      </div>

      <div className="p-3.5 font-mono text-[13px] leading-[1.85]">
        <div>
          <span className="text-green">$ </span>
          <span className="text-fg">{command.slice(0, typed)}</span>
          {typed < command.length && (
            <span
              aria-hidden
              className="ml-0.5 inline-block h-3.5 w-[7px] translate-y-0.5 bg-cyan"
              style={{ animation: "caret 1s step-end infinite" }}
            />
          )}
        </div>
        {output.slice(0, lines).map((line) => (
          <div key={line.text} className={cn("text-xs", line.tone ?? "text-fg")}>
            {line.text}
          </div>
        ))}
      </div>
    </div>
  );
}
