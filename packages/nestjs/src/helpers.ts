import type { ExecutionContext } from "@nestjs/common";
import type { EndpointDefZ } from "@tahanabavi/typefetch";
import { TYPEFETCH_ENDPOINT_METADATA } from "./constants";

/**
 * Read the contract endpoint bound to the current handler — for user-land
 * guards and interceptors. The typical use is an auth guard honoring the
 * contract's `auth` flag:
 *
 * @example
 * ⁣@Injectable()
 * class ContractAuthGuard implements CanActivate {
 *   canActivate(context: ExecutionContext) {
 *     const endpoint = getContractEndpoint(context);
 *     if (!endpoint?.auth) return true; // public per contract
 *     return this.verifyBearerToken(context);
 *   }
 * }
 */
export function getContractEndpoint(
  context: ExecutionContext,
): EndpointDefZ | undefined {
  return Reflect.getMetadata(
    TYPEFETCH_ENDPOINT_METADATA,
    context.getHandler(),
  );
}
