import Link from "next/link";

import { CopyButton } from "@/components/ui/copy-button";
import { MobileNav } from "@/components/layouts/mobile-nav";
import { nav, site } from "@/config/site";
import { ThemeToggle } from "@/components/layouts/theme-toggle";
import { install } from "@/lib/registry";

function Wordmark() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <svg viewBox="0 0 512 512" aria-hidden className="h-8 w-8">
        <defs>
          <linearGradient id="tw-tile" x1="70" y1="52" x2="452" y2="470" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#22d3ee" />
            <stop offset="0.5" stopColor="#3b82f6" />
            <stop offset="1" stopColor="#8b5cf6" />
          </linearGradient>
        </defs>
        <rect x="40" y="40" width="432" height="432" rx="128" fill="url(#tw-tile)" />
        <path
          d="M150 316 C 200 210, 236 210, 256 256 C 276 302, 312 302, 362 196"
          stroke="#fff"
          strokeWidth="30"
          strokeLinecap="round"
          fill="none"
        />
        <circle cx="150" cy="316" r="30" fill="#fff" />
        <circle cx="150" cy="316" r="14" fill="#3b82f6" />
        <circle cx="362" cy="196" r="30" fill="#fff" />
        <circle cx="362" cy="196" r="14" fill="#8b5cf6" />
        <circle cx="256" cy="256" r="15" fill="#fff" />
        <circle cx="256" cy="256" r="6.5" fill="#22d3ee" />
      </svg>
      <span className="text-lg font-extrabold tracking-tight">
        <span className="text-fg">Type</span>
        <span className="bg-linear-to-r from-blue to-purple bg-clip-text text-transparent">Wire</span>
      </span>
    </Link>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-hair bg-canvas/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-6 px-6">
        <Wordmark />

        <nav className="hidden items-center gap-5 text-sm text-muted-foreground md:flex">
          {nav.map((item) => (
            <Link key={item.href} href={item.href} className="transition-colors hover:text-fg">
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <span className="hidden items-center gap-2 rounded-lg border border-hair px-3 py-1.5 lg:inline-flex">
            <code className="font-mono text-xs text-muted-foreground">{install.primary}</code>
            <CopyButton value={install.primary} label="copy" />
          </span>
          <ThemeToggle />
          <a
            href={site.repo.url}
            target="_blank"
            rel="noreferrer"
            className="hidden rounded-lg border border-hair px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-hair-strong hover:text-fg sm:inline-block"
          >
            GitHub
          </a>
          <MobileNav />
        </div>
      </div>
    </header>
  );
}
