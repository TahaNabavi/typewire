import { CodeBlock } from '@/components/ui/code-block'
import { Section } from '@/components/ui/section'
import { DriftCompare } from '@/features/home/drift-compare'

const STEPS = [
  {
    n: '01',
    title: 'Define it once',
    body: 'A plain object with Zod schemas, imported by the frontend and the backend.',
    code: `export const contracts = {
  user: {
    getUser: {
      method: "GET",
      path: "/users/:id",
      request: z.object({
        path: z.object({ id: z.string() }),
      }),
      response: z.object({
        id: z.string(),
        name: z.string(),
      }),
    },
  },
} as const;`,
  },
  {
    n: '02',
    title: 'Consume it on the client',
    body: 'Input and output are validated with the same schema that types them.',
    code: `const user = await client.modules.user
  .getUser({ path: { id: "123" } });

// user: { id: string; name: string }`,
  },
  {
    n: '03',
    title: 'Implement it on the server',
    body: 'The route is wired from the contract, so it cannot drift from the client.',
    code: `type Input = InferRequest<
  typeof contracts.user.getUser
>;

@TypeFetchEndpoint(contracts.user.getUser)
async getUser(@ContractInput() input: Input) {
  return { id: input.path.id, name: "Taha" };
}`,
  },
]

export function WhatIs() {
  return (
    <Section
      id="what-is"
      kicker="// WHAT IS TYPEWIRE"
      title="One contract. Client, server, cache and devtools all read it."
      lede="You describe an endpoint once — method, path, request, response. Every package in the family consumes that same object."
    >
      <div className="enter-group grid grid-cols-1 gap-6 lg:grid-cols-3">
        {STEPS.map((step) => (
          <div key={step.n} className="min-w-0">
            <div className="flex items-baseline gap-3">
              <span className="font-mono text-sm text-blue">{step.n}</span>
              <h3 className="text-lg font-bold text-fg">{step.title}</h3>
            </div>
            <p className="mt-2 mb-4 text-sm leading-relaxed text-muted-foreground">
              {step.body}
            </p>
            <CodeBlock code={step.code} />
          </div>
        ))}
      </div>

      {/* Reveal instance 1 of 2 on this page — three claims, in sequence. */}
      <p className="reveal-sweep mx-auto mt-14 max-w-4xl text-center text-xl font-semibold leading-relaxed text-fg md:text-2xl">
        <span>The route can&apos;t drift from the client.</span>{' '}
        <span>The client can&apos;t drift from the types.</span>{' '}
        <span>
          The types can&apos;t drift from what&apos;s validated at runtime.
        </span>
      </p>

      {/* The same rename, twice — the thing the three laws above are for. */}
      <div className="enter-up mx-auto mt-12 max-w-3xl">
        <h3 className="mb-4 text-center font-mono text-xs uppercase tracking-[0.18em] text-dim">
          The server renames a field
        </h3>
        <DriftCompare />
      </div>
    </Section>
  )
}
