import { Panel } from "@/components/ui/panel";
import { CodeBlock } from "@/components/ui/code-block";
import { Section } from "@/components/ui/section";
import type { TransportTab } from "@/features/transports/store";
import { WireLink } from "@/features/transports/wire-fan";
import { highlight } from "@/lib/highlight";
import type { Transport } from "@/lib/registry";

import { TransportTabs, type Wire } from "@/features/transports/tabs";

const CONTRACT = `// contracts.ts — fixed
export const contracts = {
  user: {
    getUser: {
      method: "GET",
      path: "/users/:id",
      request:  z.object({ path: z.object({ id: z.string() }) }),
      response: z.object({ id: z.string(), name: z.string() }),
    },
  },
} as const;`;

const WIRES: Array<Omit<Wire, "html"> & { tab: TransportTab; transport: Transport; code: string }> = [
  {
    tab: "REST",
    transport: "http",
    via: "in the core",
    note: "The http adapter ships inside typefetch — nothing extra to install.",
    code: `const client = createClient({ contracts, transport: "http" });

const user = await client.modules.user.getUser({
  path: { id: "123" },
});
// GET /users/123 — validated against response`,
  },
  {
    tab: "GraphQL",
    transport: "graphql",
    via: "typefetch-graphql",
    note: "The selection set is generated from the Zod response schema, so it cannot drift.",
    code: `const client = createClient({
  contracts,
  transport: graphqlTransport({ url: "/graphql" }),
});

const user = await client.modules.user.getUser({
  path: { id: "123" },
});`,
  },
  {
    tab: "gRPC",
    transport: "grpc",
    via: "typefetch-grpc",
    note: "Connect unary JSON by default — curl-able, and no protobuf runtime.",
    code: `const client = createClient({
  contracts,
  transport: grpcTransport({ baseUrl: "/connect" }),
});

const user = await client.modules.user.getUser({
  path: { id: "123" },
});`,
  },
  {
    tab: "WebSocket",
    transport: "ws",
    via: "typesocket",
    note: "Direction-tagged events, and the ack is validated before the promise resolves.",
    code: `const socket = createSocket({ contracts: socketContracts });

const ack = await socket.modules.chat.sendMessage({
  roomId: "a", body: "hello",
});
// ack validated before it resolves`,
  },
];

const ZOD_SIDE = `response: z.object({
  id: z.string(),
  name: z.string(),
})`;

const GQL_SIDE = `query getUser($id: ID!) {
  user(id: $id) {
    id
    name
  }
}`;

export async function Transports() {
  const [wires, zod, gql] = await Promise.all([
    Promise.all(
      WIRES.map(async ({ code, ...wire }): Promise<Wire> => ({
        ...wire,
        html: await highlight(code, "ts"),
      })),
    ),
    highlight(ZOD_SIDE, "ts"),
    highlight(GQL_SIDE, "graphql"),
  ]);

  return (
    <Section
      id="transports"
      alt
      kicker="// TRANSPORTS"
      title="The contract stays. Only the wire changes."
      lede="Same object, four call sites. The tab below switches the transport, not the source of truth."
    >
      <TransportTabs
        wires={wires}
        contract={<CodeBlock code={CONTRACT} filename="contracts.ts" className="h-full" />}
      />

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[1.15fr_1fr]">
        <Panel>
          <h3 className="pb-1 text-lg font-bold text-fg">
            The GraphQL document is generated from the Zod schema
          </h3>
          <p className="pb-5 text-sm text-muted-foreground">
            So the selection set cannot drift from the response type — the one thing no other GraphQL
            client can do.
          </p>
          <div className="grid grid-cols-[1fr_44px_1fr] items-center gap-2">
            <pre className="code-surface min-w-0 overflow-x-auto rounded-lg border border-hair p-3 font-mono text-[11.5px] leading-relaxed">
              <code dangerouslySetInnerHTML={{ __html: zod }} />
            </pre>
            <WireLink color="var(--wire-graphql)" />
            <pre className="code-surface min-w-0 overflow-x-auto rounded-lg border border-wire-graphql/30 p-3 font-mono text-[11.5px] leading-relaxed">
              <code dangerouslySetInnerHTML={{ __html: gql }} />
            </pre>
          </div>
        </Panel>

        <Panel>
          <h3 className="pb-1 text-lg font-bold text-fg">
            Three failure shapes, one <code className="text-cyan">error.kind</code>
          </h3>
          <p className="pb-5 text-sm text-muted-foreground">
            Handle failures once, whatever the wire produced.
          </p>
          <ul className="space-y-2">
            {[
              ["HTTP", "AbortError: signal timed out", "var(--wire-http)"],
              ["gRPC", "code: DEADLINE_EXCEEDED", "var(--wire-grpc)"],
              ["GQL", "errors[0].extensions.code", "var(--wire-graphql)"],
            ].map(([label, detail, tone]) => (
              <li
                key={label}
                className="flex items-center gap-3 rounded-lg border border-hair px-3 py-2 font-mono text-[11.5px]"
              >
                <span className="w-10" style={{ color: tone }}>
                  {label}
                </span>
                <span className="text-muted-foreground">{detail}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex items-center gap-3">
            <WireLink color="var(--red)" />
            <span className="rounded-full border border-red/45 bg-red/10 px-3.5 py-1.5 font-mono text-[12.5px] font-bold text-red">
              kind: &quot;timeout&quot;
            </span>
          </div>
        </Panel>
      </div>
    </Section>
  );
}
