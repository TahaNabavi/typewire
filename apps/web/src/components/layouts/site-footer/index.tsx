import Link from "next/link";

import { footerNav, site } from "@/config/site";
import { generatedAt } from "@/lib/registry";

export function SiteFooter() {
  return (
    <footer className="border-t border-hair py-14">
      <div className="mx-auto max-w-[1200px] px-6">
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4">
          {footerNav.map((column) => (
            <div key={column.title}>
              <h3 className="font-mono text-xs uppercase tracking-[0.18em] text-dim">{column.title}</h3>
              <ul className="mt-4 space-y-2.5 text-sm">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-muted-foreground transition-colors hover:text-fg"
                      {...(link.href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-hair pt-6 font-mono text-xs text-dim">
          <span>
            {site.license} © {site.author.name}
          </span>
          <span aria-hidden>·</span>
          <span>{site.scope}</span>
          <span className="ml-auto" title="Package data derived from the monorepo at build time">
            registry built {new Date(generatedAt).toISOString().slice(0, 16).replace("T", " ")}Z
          </span>
        </div>
      </div>
    </footer>
  );
}
