import { defineConfig } from '@tahanabavi/typewire-cli'
import { createClient, transports } from './shared/client.js'
import { contracts } from './shared/contracts.js'

/**
 * The CLI reads the same contracts — and the same client — the app does.
 *
 * Try it. The server does not need to be running:
 *
 *     pnpm --filter @typewire-examples/transports list
 *
 * `list` prints each route through its own adapter's `describe()`, so the gRPC
 * row shows `unary user.v1.UserService/GetUser` rather than an empty
 * method/path.
 *
 * A repo with several API surfaces — dashboard, admin, landing — wraps these
 * sections in a `projects` block instead, one entry per surface, each with its
 * own contracts and client. This example has one API, so it declares one
 * section and the CLI treats it as a single implicit project.
 */
export default defineConfig({
  typefetch: {
    contracts,

    /**
     * Imported, not rebuilt. A client constructed here would drift from the one
     * `main.ts` uses, and then `typewire test` would be testing something the
     * example does not run.
     */
    createClient,

    /**
     * The same adapters the client registers, for the commands that never build
     * one. Without these, `list` prints `?` for the gRPC and GraphQL rows:
     * `method` and `path` do not exist on those endpoints, and there is no
     * client to ask.
     */
    transports,

    test: {
      report: {
        output: './typewire-report/report',
        formats: ['markdown'],
      },
    },
  },
})
