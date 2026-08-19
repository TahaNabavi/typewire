import type { Contracts } from "@tahanabavi/typefetch";
import type { TypeFetchCliTestConfig } from "../types";
import type { ConfigEnv, TypeWireConfig } from "./types";

/**
 * Identity at runtime, inference at author time.
 *
 * Declaring the contracts generic here is what makes `contracts` keep its
 * literal type through the config file, so a future `typewire explain
 * user.getUser` can be checked against the real endpoint ids rather than
 * `string`.
 */
export function defineConfig<C extends Contracts>(
  config: TypeWireConfig<C>,
): TypeWireConfig<C>;
export function defineConfig<C extends Contracts>(
  config: (env: ConfigEnv) => TypeWireConfig<C> | Promise<TypeWireConfig<C>>,
): (env: ConfigEnv) => TypeWireConfig<C> | Promise<TypeWireConfig<C>>;
export function defineConfig(config: unknown): unknown {
  return config;
}

/**
 * The pre-2.0 helper.
 *
 * Kept working so an existing `typefetch.test.config.ts` still loads untouched:
 * the loader lifts its flat shape into the `typefetch` section. New configs
 * should use {@link defineConfig}.
 *
 * @deprecated Use `defineConfig({ typefetch: { … } })`.
 */
export function defineTypeFetchTestConfig<C extends Contracts>(
  config: TypeFetchCliTestConfig<C>,
): TypeFetchCliTestConfig<C> {
  return config;
}
