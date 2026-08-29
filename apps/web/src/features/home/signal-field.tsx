"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/utils";

/**
 * The glyph background: a grid of monospace characters that mutate slowly in
 * place, fading out toward the bottom.
 *
 * It replaces the page's hairline grid in exactly two places — behind the hero
 * and behind the CTA band. Everywhere else the plain grid stays, because this
 * one is texture with a heartbeat and a page with several of those is a page
 * that never settles.
 *
 * Drawn on a canvas rather than in the DOM: a 14px cell over a 1440×700 hero is
 * roughly seven thousand glyphs, and seven thousand spans that each mutate on a
 * timer is a layout thrash, not a background.
 *
 * The opacity ceiling is 6%. Nothing here may ever compete with body copy — the
 * contrast floor wins over this every time.
 */

const CHARS = "01·•+*/\\<>=";
const CELL = 14;
const TICK = 110;
const MUTATION_RATE = 0.03;

export function SignalField({ className }: { className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const node = canvas.current;
    if (!node) return;
    const ctx = node.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let cols = 0;
    let rows = 0;
    let glyphs: string[] = [];
    let raf = 0;
    let timer: ReturnType<typeof setInterval> | null = null;

    // The field reads the theme rather than assuming dark, so the light page
    // gets ink on paper instead of a white-on-white ghost.
    const ink = () =>
      document.documentElement.getAttribute("data-theme") === "light"
        ? "rgba(15, 23, 42, 0.05)"
        : "rgba(90, 107, 131, 0.06)";

    function paint() {
      if (!node || !ctx) return;
      ctx.clearRect(0, 0, node.width, node.height);
      ctx.font = `${CELL - 3}px ui-monospace, monospace`;
      ctx.textBaseline = "top";
      ctx.fillStyle = ink();

      for (let y = 0; y < rows; y += 1) {
        // Fade toward the bottom so the field never fights the content below it.
        const falloff = 1 - (y / rows) * 0.6;
        ctx.globalAlpha = falloff;
        for (let x = 0; x < cols; x += 1) {
          const glyph = glyphs[y * cols + x];
          if (glyph) ctx.fillText(glyph, x * CELL, y * CELL);
        }
      }
      ctx.globalAlpha = 1;
    }

    function resize() {
      if (!node) return;
      const box = node.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      node.width = Math.max(1, Math.floor(box.width * dpr));
      node.height = Math.max(1, Math.floor(box.height * dpr));
      ctx?.scale(dpr, dpr);

      cols = Math.ceil(box.width / CELL);
      rows = Math.ceil(box.height / CELL);
      glyphs = Array.from(
        { length: cols * rows },
        () => CHARS[Math.floor(Math.random() * CHARS.length)]!,
      );
      paint();
    }

    function mutate() {
      const count = Math.max(1, Math.floor(glyphs.length * MUTATION_RATE));
      for (let i = 0; i < count; i += 1) {
        const at = Math.floor(Math.random() * glyphs.length);
        glyphs[at] = CHARS[Math.floor(Math.random() * CHARS.length)]!;
      }
      raf = requestAnimationFrame(paint);
    }

    function start() {
      if (timer) clearInterval(timer);
      // Reduced motion gets one static frame — the texture, without the pulse.
      if (!reduced.matches) timer = setInterval(mutate, TICK);
    }

    const observer = new ResizeObserver(resize);
    observer.observe(node);
    resize();
    start();

    reduced.addEventListener("change", start);
    return () => {
      observer.disconnect();
      reduced.removeEventListener("change", start);
      if (timer) clearInterval(timer);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <canvas
      ref={canvas}
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 h-full w-full", className)}
    />
  );
}
