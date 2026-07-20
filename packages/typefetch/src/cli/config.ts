import type { Contracts } from "../types";
import type { TypeFetchCliTestConfig } from "./types";

export function defineTypeFetchTestConfig<C extends Contracts>(
  config: TypeFetchCliTestConfig<C>,
): TypeFetchCliTestConfig<C> {
  return config;
}
