/**
 * Where this site lives.
 *
 * Every canonical URL, every `og:url`, every schema.org `@id` and the sitemap
 * are built from this one string, so it is read from the environment rather
 * than written here: moving the site to another domain is a deployment change,
 * not a code change. The literal is the production default so a clone with no
 * `.env` still builds and still emits absolute URLs.
 *
 * `NEXT_PUBLIC_` because the header and footer render it on the client too. It
 * is inlined at build time, which is also why it cannot be changed by restarting
 * the server — a new domain needs a new build.
 */
import { PATHS } from '@/routes/paths'

const url = (
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://typewire.tahanabavi.ir'
).replace(/\/+$/, '')

export const site = {
  name: 'TypeWire',
  tagline: 'Typed contracts. Any transport.',
  description:
    'One Zod contract, validated end-to-end — across HTTP, WebSocket, and the server.',
  url,
  /** The bare host, for places that print the address rather than link it. */
  domain: url.replace(/^https?:\/\//, ''),
  scope: '@tahanabavi',
  // The install command is NOT a constant — see `install` in lib/registry.ts.
  // It is derived from what is actually published, so the site never prints a
  // command that fails on a clean machine.
  repo: {
    owner: 'TahaNabavi',
    name: 'typewire',
    url: 'https://github.com/TahaNabavi/typewire',
    branch: 'main',
  },
  author: {
    name: 'Taha Nabavi',
    url: 'https://www.tahanabavi.ir',
  },
  license: 'MIT',
  /**
   * The one-line elevator pitch, written to survive being read on its own — in
   * a search result, a Slack unfurl, or a schema.org description field, with no
   * page around it to give it context.
   */
  summary:
    'TypeWire is a TypeScript contract layer for APIs. One Zod contract object is imported by the client, the server and the cache, so HTTP, GraphQL, gRPC and WebSocket calls are typed at compile time and validated at runtime from the same source.',
  /**
   * What a search result shows. Google renders about 155 characters of a
   * description and truncates the rest mid-word, so this is written to end
   * before that rather than to be cut there.
   */
  metaDescription:
    'One Zod contract, imported by the client, the server and the cache \u2014 typed at compile time and validated at runtime across HTTP, GraphQL, gRPC and WebSocket.',
  /**
   * What someone types into a search box when they have the problem TypeWire
   * solves — not a keyword-stuffing list. `keywords` carries little weight with
   * Google now; it is here because it also feeds the manifest and package
   * metadata, where it is read by humans.
   */
  keywords: [
    'TypeWire',
    'typed API contracts',
    'TypeScript API client',
    'Zod contract',
    'end-to-end type safety',
    'runtime validation',
    'tRPC alternative',
    'GraphQL without codegen',
    'gRPC TypeScript',
    'typed WebSocket',
    'NestJS contracts',
    'React Query contracts',
  ],
  /** No X account for the project yet — the author's is what a card can credit. */
  twitter: { creator: '@tahanabavi' },
  locale: 'en_US',
} as const

export const nav = [
  { label: 'Docs', href: PATHS.DOCS },
  { label: 'Playground', href: PATHS.PLAYGROUND },
  { label: 'Packages', href: PATHS.PACKAGES },
  { label: 'Examples', href: PATHS.EXAMPLES },
  { label: 'Roadmap', href: PATHS.ROADMAP },
] as const

export const footerNav = [
  {
    title: 'Product',
    links: [
      { label: 'Docs', href: PATHS.DOCS },
      { label: 'Playground', href: PATHS.PLAYGROUND },
      { label: 'Packages', href: PATHS.PACKAGES },
      { label: 'Examples', href: PATHS.EXAMPLES },
      { label: 'Roadmap', href: PATHS.ROADMAP },
    ],
  },
  {
    title: 'Community',
    links: [
      { label: 'GitHub', href: site.repo.url },
      { label: 'Discussions', href: `${site.repo.url}/discussions` },
      { label: 'Issues', href: `${site.repo.url}/issues` },
      {
        label: 'Contributing',
        href: `${site.repo.url}/blob/main/CONTRIBUTING.md`,
      },
      {
        label: 'Code of Conduct',
        href: `${site.repo.url}/blob/main/CODE_OF_CONDUCT.md`,
      },
    ],
  },
  {
    title: 'Resources',
    links: [
      {
        label: 'Architecture',
        href: `${site.repo.url}/blob/main/docs/ARCHITECTURE.md`,
      },
      { label: 'CLI', href: `${site.repo.url}/blob/main/docs/CLI.md` },
      { label: 'Security', href: `${site.repo.url}/blob/main/SECURITY.md` },
      { label: 'npm scope', href: 'https://www.npmjs.com/org/tahanabavi' },
      { label: 'GitHub Packages', href: `${site.repo.url}/packages` },
    ],
  },
  {
    title: 'About',
    links: [
      { label: 'Author', href: site.author.url },
      { label: 'License', href: `${site.repo.url}/blob/main/LICENSE` },
    ],
  },
] as const
