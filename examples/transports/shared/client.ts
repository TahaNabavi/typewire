import { ApiClient } from '@tahanabavi/typefetch'
import { graphqlTransport } from '@tahanabavi/typefetch-graphql'
import { grpcTransport } from '@tahanabavi/typefetch-grpc'
import { contracts } from './contracts.js'

/**
 * The adapters, registered once and exported.
 *
 * `typewire.config.ts` imports this exact array. The CLI's contracts-only
 * commands — `list`, and later `lint`, `diff`, `explain` — need adapters to
 * describe a route, and none of them build a client; a second list declared in
 * the config would drift from this one the first time a transport is added.
 *
 * `graphqlTransport()` takes no `url` here on purpose: it defaults to
 * `${baseUrl}/graphql`, so the adapter needs nothing that depends on where the
 * client happens to point, and stays a module-level constant.
 */
export const transports = [graphqlTransport(), grpcTransport()]

/**
 * One client, three wires — and one definition of it.
 *
 * A factory rather than an instance because `typewire.config.ts` imports *this
 * function*: building a second client inside the config means `typewire test`
 * exercises a client the app does not use, and the two drift the moment a
 * middleware or an auth header is added to either.
 *
 * The options match what the CLI passes, so it can be handed over as-is:
 * `--base-url` and `--token` arrive here.
 */
export function createClient(
  options: { baseUrl?: string; token?: string } = {}
) {
  const client = new ApiClient(
    {
      baseUrl:
        options.baseUrl ?? process.env.API_BASE_URL ?? 'http://127.0.0.1:3000',

      // Registered once, here. Everything downstream — auth, retries, timeouts,
      // `onError`, middleware, mock mode, the devtools timeline — is
      // transport-independent and configured exactly once for all three.
      //
      // Registration is explicit rather than magic: an adapter is a value you
      // pass in, so nothing is discovered from the environment and a bundler
      // can see exactly which transports an app actually uses.
      transports,

      ...(options.token ? { token: options.token } : {}),
    },
    contracts
  )

  client.init()
  return client
}
