import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";

import { SiteFooter } from "@/components/layouts/site-footer";
import { SiteHeader } from "@/components/layouts/site-header";
import { JsonLd } from "@/components/shared/json-ld";
import { THEME_SCRIPT } from "@/layouts/root-layout/theme-script";
import { packages } from "@/lib/registry";
import { graph, organizationSchema, softwareSchema, websiteSchema } from "@/lib/seo";

/**
 * Geist for both roles: a grotesque drawn for interfaces, and its monospace
 * companion. Mono does a lot of work on this site — every version, package
 * name, path, size and command is set in it — so the pair needs to be one
 * family rather than two that merely coexist.
 */
const sans = Geist({ subsets: ["latin"], variable: "--font-geist-sans", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export function RootLayout({ children }: { children: ReactNode }) {
  // Three nodes that describe the project rather than any one page, emitted
  // once at the root so every page carries them and every page's own schema can
  // reference them by @id instead of repeating them.
  const latest = packages.find((p) => p.npm === "@tahanabavi/typefetch")?.version ?? null;
  const siteSchema = graph(organizationSchema(), websiteSchema(), softwareSchema(packages.length, latest));

  return (
    <html
      lang="en"
      data-theme="light"
      suppressHydrationWarning
      className={`${sans.variable} ${mono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <JsonLd data={siteSchema} />
      </head>
      <body className="font-sans antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:px-4 focus:py-2"
        >
          Skip to content
        </a>
        <SiteHeader />
        <main id="main">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
