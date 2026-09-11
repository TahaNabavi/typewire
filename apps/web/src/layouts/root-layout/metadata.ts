import type { Metadata, Viewport } from 'next'

import { env } from '@/config/env'
import { site } from '@/config/site'

/**
 * The defaults every route inherits.
 *
 * A page that sets nothing still resolves a title, a description, a canonical
 * URL, a card and an image — the root `opengraph-image.tsx` — so a route added
 * later is never unindexable by omission. Sections override the parts that are
 * theirs via `pageMetadata()` in lib/seo.ts.
 */
export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: `${site.name} — ${site.tagline}`,
    template: `%s · ${site.name}`,
  },
  description: site.metaDescription,
  applicationName: site.name,
  keywords: [...site.keywords],
  authors: [{ name: site.author.name, url: site.author.url }],
  creator: site.author.name,
  publisher: site.author.name,
  category: 'technology',
  // No `alternates` here on purpose. A canonical inherited by a page that
  // forgot to set its own would announce that page as a duplicate of the home
  // page; a missing canonical only means the crawler uses the URL it fetched.
  // Every page sets its own through pageMetadata() in lib/seo.ts.
  openGraph: {
    type: 'website',
    title: `${site.name} — ${site.tagline}`,
    description: site.description,
    url: site.url,
    siteName: site.name,
    locale: site.locale,
  },
  twitter: {
    card: 'summary_large_image',
    title: `${site.name} — ${site.tagline}`,
    description: site.description,
    creator: site.twitter.creator,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      // Let Google show the full snippet and a large image. The defaults are
      // conservative and cost a documentation site the preview that makes a
      // result worth clicking.
      'max-snippet': -1,
      'max-image-preview': 'large',
      'max-video-preview': -1,
    },
  },
  // Phone numbers and addresses do not appear here, but version strings and
  // ids do — and iOS will happily turn `1.10.0` into a dial link.
  formatDetection: { telephone: false, address: false, email: false },
  // No `manifest` or `icons` here on purpose: app/manifest.ts, app/icon.svg and
  // app/apple-icon.tsx are file conventions, and Next emits their <link> tags
  // already. Declaring them again is how a page ends up with two of each.
  ...verification(),
}

/**
 * Ownership proof for the webmaster consoles, from the environment.
 *
 * Both are optional and neither is a secret — they are public meta tags — but
 * they belong to whoever runs the deployment rather than to the repository, so
 * they are read rather than hardcoded. An unset variable contributes no tag at
 * all; an empty `content=""` would be read as a failed verification.
 */
function verification(): Pick<Metadata, 'verification'> {
  const google = env.GOOGLE_SITE_VERIFICATION
  const bing = env.BING_SITE_VERIFICATION
  if (!google && !bing) return {}
  return {
    verification: {
      ...(google ? { google } : {}),
      ...(bing ? { other: { 'msvalidate.01': bing } } : {}),
    },
  }
}

/**
 * The browser chrome follows the page. Light is the default and dark is a
 * stored choice, so both are declared and the media query decides — the same
 * split `themeScript` below applies to the document itself.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f9fc' },
    { media: '(prefers-color-scheme: dark)', color: '#060a14' },
  ],
}
