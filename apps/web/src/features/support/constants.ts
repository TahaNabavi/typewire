export interface FaqItem {
  q: string
  a: string
}

export const faq: FaqItem[] = [
  {
    q: 'Does this replace tRPC, React Query or Apollo?',
    a: 'It overlaps with each of them in one dimension and none of them in all three. tRPC infers a client from server code; TypeWire starts from a transport-neutral contract object that both ends import, so the server is not the source of truth — the contract is. The query layer covers the React Query use case for those contracts, and the GraphQL transport generates its selection set from the same Zod schema instead of a separate document.',
  },
  {
    q: 'Why Zod, and not TypeBox or Valibot?',
    a: 'Because the contract has to be validated at runtime on both ends, not just typed at compile time, and Zod is the schema library most teams already have. The contract is a plain object, so nothing structurally prevents another validator later — but shipping one well beats shipping three partially.',
  },
  {
    q: 'Is the core really zero-dependency?',
    a: 'Yes, and it is asserted in CI rather than claimed in a README — scripts/assert-no-deps.mjs fails the build if a dependency appears. Anything that needs a dependency ships as its own package: encryption took crypto-js and node-forge with it, the CLI took jiti.',
  },
  {
    q: 'Can I use it without NestJS?',
    a: 'Yes. The client packages have no server requirement at all — a contract works against any backend that honours it. typewire-nestjs exists so the server can import the same contract file; it is one option, not the path.',
  },
  {
    q: 'What happens when a contract changes?',
    a: "Today: the client's Zod rejects a response that no longer matches, loudly, at the boundary. Next: typewire snapshot writes an API-surface lockfile and typewire diff labels every change breaking or safe against it, so the break is a red CI check instead of a production incident.",
  },
  {
    q: 'Which runtimes are supported?',
    a: 'Node 18+ at runtime, with Node 22/24, Bun and Deno all exercised in CI by a cross-runtime smoke test. To contribute you need Node 22.13+ and pnpm 11.6 (run corepack enable).',
  },
  {
    q: 'Where do I install from?',
    a: 'npm, by default — pnpm add @tahanabavi/typefetch, no setup. The same versions are mirrored to GitHub Packages for teams that prefer it, which needs a personal access token with read:packages and an .npmrc routing the @tahanabavi scope.',
  },
]
