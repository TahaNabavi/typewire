import { PACKAGES, type FeatureId } from './features'
import { envAccessor, type ProjectInfo } from './detect'

export type TemplateContext = {
  project: ProjectInfo
  features: Set<FeatureId>
  /** Module specifier the config uses to reach the contracts. */
  contractsModule: string
  /** Module specifier the config uses to reach the client factory. */
  clientModule: string
  /** True when the wizard is generating the contracts file itself. */
  ownsContracts: boolean
  ts: boolean
}

/** Extra transport adapters, in the order they are registered. */
function transportCalls(context: TemplateContext): string[] {
  const calls: string[] = []
  // No `url` for graphql: it defaults to `${baseUrl}/graphql`, so the adapter
  // needs no configuration and stays a module-level constant.
  if (has(context, 'graphql')) calls.push('graphqlTransport()')
  if (has(context, 'grpc')) calls.push('grpcTransport()')
  return calls
}

const has = (context: TemplateContext, id: FeatureId) =>
  context.features.has(id)

/**
 * Next.js App Router renders every module on the server unless told otherwise.
 * A provider and a devtools panel are both context and hooks, so without this
 * directive they fail at build time — in the framework most likely to be
 * detected here.
 */
function clientDirective(context: TemplateContext): string {
  return context.project.framework === 'next' ? `"use client";\n\n` : ''
}

/* ── typewire.config ───────────────────────────────────────────────────────── */

export function configTemplate(context: TemplateContext): string {
  const { project } = context
  const env = envAccessor(project)
  const hasTransports = transportCalls(context).length > 0

  const transportsEntry = hasTransports
    ? `

    // The same adapters the client registers. \`list\` — and later \`lint\`,
    // \`diff\` and \`explain\` — need them to describe a route, and none of
    // those build a client, so they are declared separately from it.
    transports,`
    : ''

  const sections = [
    `  typefetch: {
    contracts,

    // The factory the app itself uses, not a second client built here. A
    // second one drifts the moment a middleware, a transport or an auth
    // header is added to one of them — and then \`typewire test\` is testing
    // a client you do not ship.
    //
    // Only the commands that make real requests call it. \`list\` runs on the
    // contracts alone, so this is never invoked for it.
    createClient,${transportsEntry}

    test: {
      options: { mode: "full", timeout: 10_000 },
      report: {
        output: "./typewire-report/report",
        formats: ["markdown", "json"],
      },
    },
  },`,
  ]

  if (has(context, 'typesocket')) {
    sections.push(`  typesocket: {
    events: socketContracts,
  },`)
  }

  if (has(context, 'permission')) {
    sections.push(`  permission: {
    flags: permissions,
  },`)
  }

  const imports = [
    `import { defineConfig } from "${PACKAGES.cli}";`,
    `import { createClient${hasTransports ? ', transports' : ''} } from "${context.clientModule}";`,
    `import { contracts${has(context, 'typesocket') ? ', socketContracts' : ''} } from "${context.contractsModule}";`,
  ]

  if (has(context, 'permission')) {
    imports.push(`import { permissions } from "${permissionsModule(context)}";`)
  }

  return `${imports.join('\n')}

/**
 * One config for every TypeWire package.
 *
 * Discovery walks up from the working directory, so a package inside a
 * monorepo inherits this file without a --config flag in every script.
 *${
   env.variable === 'API_BASE_URL'
     ? `
 * The CLI passes --base-url (or API_BASE_URL) into \`createClient\`, so one
 * definition of the client serves local, staging and CI.`
     : `
 * The CLI passes --base-url (or API_BASE_URL) into \`createClient\`, so it never
 * reads ${env.variable} — that one belongs to the browser bundle and lives in
 * ${env.file}.`
 }
 */
export default defineConfig({
${sections.join('\n\n')}
});
`
}

/* ── contracts ─────────────────────────────────────────────────────────────── */

export function contractsTemplate(context: TemplateContext): string {
  const socket = has(context, 'typesocket')
  const graphql = has(context, 'graphql')
  const grpc = has(context, 'grpc')

  const extras: string[] = []

  if (graphql) {
    extras.push(`
  /**
   * A GraphQL route. No document is written here: the selection set is
   * generated from the zod response schema below, so the query and the type
   * can never drift apart. Pass \`document\` explicitly when you need
   * fragments, aliases or unions.
   */
  profile: {
    transport: "graphql",
    operation: "query",
    root: "user",
    request: z.object({ id: z.string() }),
    response: z.object({ id: z.string(), name: z.string() }),
  },`)
  }

  if (grpc) {
    extras.push(`
  /** A gRPC route, spoken as Connect unary JSON — curl-able, no protobuf runtime. */
  syncUser: {
    transport: "grpc",
    service: "user.v1.UserService",
    rpc: "SyncUser",
    request: z.object({ id: z.string() }),
    response: z.object({ id: z.string(), name: z.string() }),
  },`)
  }

  const socketBlock = socket
    ? `

/**
 * WebSocket events, in the same shape. Each event declares the direction it
 * travels, so this one object reads correctly from both ends.
 */
export const socketContracts = defineSocketContracts({
  chat: {
    sendMessage: {
      direction: "client->server",
      request: z.object({ text: z.string().min(1) }),
      ack: z.object({ id: z.string() }),
    },
    messageReceived: {
      direction: "server->client",
      payload: z.object({ id: z.string(), text: z.string(), at: z.number() }),
    },
  },
});`
    : ''

  return `import { z } from "zod";${
    socket
      ? `\nimport { defineSocketContracts } from "${PACKAGES.typesocket}";`
      : ''
  }

/**
 * The single source of truth.
 *
 * Everything downstream — the client, the query cache, the devtools panel, the
 * CLI — reads this file. Nothing here mentions caching, keys or transports
 * beyond naming one, which is the first design law: higher layers read the
 * contract, they never add to it.
 */
export const contracts = {
  user: {
    getUser: {
      method: "GET",
      path: "/users/:id",
      request: z.object({ path: z.object({ id: z.string() }) }),
      response: z.object({
        id: z.string(),
        name: z.string(),
        email: z.string(),
      }),
      errors: {
        404: z.object({ message: z.string() }),
      },
    },

    updateUser: {
      method: "POST",
      path: "/users/:id",
      request: z.object({
        path: z.object({ id: z.string() }),
        body: z.object({ name: z.string().min(1) }),
      }),
      response: z.object({ ok: z.boolean() }),
    },${extras.join('')}
  },
}${context.ts ? ' as const' : ''};${socketBlock}
`
}

/* ── client ────────────────────────────────────────────────────────────────── */

export function clientTemplate(context: TemplateContext): string {
  const { ts } = context
  const calls = transportCalls(context)

  const imports = [`import { ApiClient } from "${PACKAGES.typefetch}";`]
  if (has(context, 'graphql')) {
    imports.push(`import { graphqlTransport } from "${PACKAGES.graphql}";`)
  }
  if (has(context, 'grpc')) {
    imports.push(`import { grpcTransport } from "${PACKAGES.grpc}";`)
  }
  if (has(context, 'encryption')) {
    imports.push(
      `import { encryptionMiddleware } from "${PACKAGES.encryption}";`
    )
  }
  imports.push(`import { contracts } from "${relativeContracts(context)}";`)

  const transportsExport = calls.length
    ? `
/**
 * Registered here and imported by \`typewire.config.ts\`, so the CLI describes
 * routes with the same adapters the app talks through.
 */
export const transports = [${calls.join(', ')}];
`
    : ''

  const encryptionNote = has(context, 'encryption')
    ? `
  // Encrypts only the fields you name, in both directions.
  // client.use(encryptionMiddleware({ method: "aes", secret: "…" }));
`
    : ''

  const options = ts
    ? `options: { baseUrl?: string; token?: string } = {}`
    : `options = {}`

  return `${imports.join('\n')}
${transportsExport}
/**
 * One definition of the client.
 *
 * Exported as a factory because \`typewire.config.ts\` imports *this* function:
 * a second client built inside the config drifts the moment a middleware, a
 * transport or an auth header is added to one of them, and then \`typewire
 * test\` is exercising a client you do not ship.
 *
 * \`init()\` is what turns the contract object into callable modules; calling it
 * twice is harmless, never calling it is the usual first bug.
 */
export function createClient(${options}) {
  const client = new ApiClient(
    {
      baseUrl: options.baseUrl ?? envBaseUrl() ?? "http://localhost:3000",${
        calls.length ? `\n      transports,` : ''
      }
      ...(options.token ? { token: options.token } : {}),
    },
    contracts,
  );
${encryptionNote}
  client.init();
  return client;
}

/** The instance your app uses. The CLI calls the factory above with its own options. */
export const api = createClient();
${
  context.ownsContracts
    ? `
// Endpoints are reached through \`modules\`, keyed exactly as the contract is.
export const { user } = api.modules;
`
    : `
// Endpoints are reached through \`api.modules\`, keyed exactly as your contract
// is — re-export the modules you use, e.g. \`export const { user } = api.modules;\`
`
}
${envBaseUrlFn(context)}`
}

/**
 * Read the framework's env var, in a way that survives being loaded by the CLI.
 *
 * The generated client is imported by `typewire.config.ts` and therefore
 * executed under Node — where `import.meta.env` does not exist. Reading it
 * unguarded is a `TypeError` the moment the CLI touches a Vite project's
 * client, which is exactly the file it needs most.
 */
function envBaseUrlFn(context: TemplateContext): string {
  const { ts, project } = context
  const env = envAccessor(project)
  const signature = `function envBaseUrl()${ts ? ': string | undefined' : ''} {`

  if (
    project.vite &&
    project.framework !== 'next' &&
    project.framework !== 'nuxt'
  ) {
    const cast = ts
      ? `(import.meta as { env?: Record<string, string | undefined> }).env`
      : `import.meta.env`

    return `${signature}
  // Vite injects \`import.meta.env\`; Node does not, and typewire.config.ts
  // loads this file under Node. The CLI passes --base-url (or API_BASE_URL)
  // explicitly, so the guard is all that is needed here.
  return ${cast}?.${env.variable};
}
`
  }

  return `${signature}
  return ${env.expression};
}
`
}

/* ── query layer ───────────────────────────────────────────────────────────── */

export function queryTemplate(_context: TemplateContext): string {
  return `import { QueryClient } from "${PACKAGES.queryCore}";

/**
 * Invalidation is declared once, here.
 *
 * \`"user.updateUser" → ["user.getUser"]\` means a successful update refetches
 * whatever is watching the user — no call site ever names a cache key, and no
 * component wires an \`onSuccess\` refetch.
 */
export const queryClient = new QueryClient({
  relations: {
    "user.updateUser": ["user.getUser"],
  },
});
`
}

/* ── socket ────────────────────────────────────────────────────────────────── */

export function socketTemplate(context: TemplateContext): string {
  const env = envAccessor(context.project)

  return `import { createSocketClient } from "${PACKAGES.typesocket}";
import { socketContracts } from "${relativeContracts(context)}";

export const socket = createSocketClient(
  {
    url: ${env.expression} ?? "http://localhost:3000",
    autoConnect: true,
  },
  socketContracts,
);
`
}

/* ── devtools ──────────────────────────────────────────────────────────────── */

export function devtoolsTemplate(context: TemplateContext): string {
  const withQuery = has(context, 'query')
  const withSocket = has(context, 'typesocket')

  const connects = [`connectTypeFetch(api, bridge);`]
  if (withSocket) connects.push(`connectTypeSocket(socket, bridge);`)

  const imports = [
    `import {\n  InspectorBridge,\n  connectTypeFetch,${
      withSocket ? '\n  connectTypeSocket,' : ''
    }${withQuery ? '\n  connectQueryClient,' : ''}\n} from "${PACKAGES.devtoolsCore}";`,
    `import { TypeDevtools } from "${PACKAGES.devtools}";`,
    `import { api } from "./client";`,
  ]

  if (withSocket) imports.push(`import { socket } from "./socket";`)
  if (withQuery) imports.push(`import { queryClient } from "./query";`)

  return `${clientDirective(context)}${imports.join('\n')}

/**
 * One bridge, every transport.
 *
 * Adding a second source is one more \`connect*\` call, not a second inspector —
 * every row is tagged by where it came from. Render <AppDevtools /> once, near
 * the root, and only outside production.
 */
const bridge = new InspectorBridge();
${connects.join('\n')}
${withQuery ? 'const queries = connectQueryClient(queryClient);\n' : ''}
export function AppDevtools() {
  return <TypeDevtools bridge={bridge}${withQuery ? ' queries={queries}' : ''} />;
}
`
}

/* ── React provider ────────────────────────────────────────────────────────── */

export function providerTemplate(context: TemplateContext): string {
  const signature = context.ts
    ? `{ children }: { children: ReactNode }`
    : `{ children }`

  return `${clientDirective(context)}import { TypeFetchProvider } from "${PACKAGES.react}";${
    context.ts ? `\nimport type { ReactNode } from "react";` : ''
  }
import { queryClient } from "./query";

/**
 * Wrap your app once, at the root. Every \`useQuery\`/\`useMutation\` below it
 * reads this client — the hooks never take a client argument, so a component
 * cannot accidentally talk to a second cache.
 */
export function TypeWireProvider(${signature}) {
  return <TypeFetchProvider client={queryClient}>{children}</TypeFetchProvider>;
}
`
}

/* ── barrel ────────────────────────────────────────────────────────────────── */

export function indexTemplate(context: TemplateContext): string {
  const lines = [`export { api, user } from "./client";`]

  if (context.ownsContracts) {
    lines.push(
      `export { contracts${has(context, 'typesocket') ? ', socketContracts' : ''} } from "./contracts";`
    )
  }

  if (has(context, 'query'))
    lines.push(`export { queryClient } from "./query";`)
  if (has(context, 'query') && context.project.react) {
    lines.push(`export { TypeWireProvider } from "./provider";`)
  }
  if (has(context, 'typesocket'))
    lines.push(`export { socket } from "./socket";`)
  if (has(context, 'permission')) {
    lines.push(`export { permissions } from "./permissions";`)
  }
  if (has(context, 'devtools'))
    lines.push(`export { AppDevtools } from "./devtools";`)

  return `${lines.join('\n')}\n`
}

/* ── permissions ───────────────────────────────────────────────────────────── */

export function permissionsTemplate(): string {
  return `import { definePermissions } from "${PACKAGES.permission}";

/**
 * One bit map, evaluated identically on the client and the server.
 *
 * Endpoints reference these by the same "module.member" id every TypeWire
 * package keys on, so a guard and a contract can never point at different
 * things.
 */
export const permissions = definePermissions({
  user: {
    read: {},
    write: { implies: ["user.read"] },
  },
});
`
}

/* ── env ───────────────────────────────────────────────────────────────────── */

export function envTemplate(context: TemplateContext): string {
  const env = envAccessor(context.project)

  return `# TypeWire — copy to ${env.file}
${env.variable}=http://localhost:3000

# Used by \`typewire test\`
API_BASE_URL=http://localhost:3000
API_TOKEN=
`
}

/* ── helpers ───────────────────────────────────────────────────────────────── */

/** Sibling files inside the generated folder import contracts relatively. */
function relativeContracts(context: TemplateContext): string {
  return context.ownsContracts ? './contracts' : context.contractsModule
}

function permissionsModule(context: TemplateContext): string {
  return context.ownsContracts
    ? context.contractsModule.replace(/contracts$/, 'permissions')
    : './permissions'
}
