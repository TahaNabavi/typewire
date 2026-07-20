import {
  applyDecorators,
  Delete,
  Get,
  Patch,
  Post,
  Put,
} from "@nestjs/common";
import type { EndpointDefZ, Method } from "@tahanabavi/typefetch";
import type { ContractEndpointOptions } from "../types";
import { UseContract } from "./use-contract.decorator";

const METHOD_DECORATORS: Record<
  Method,
  (path?: string | string[]) => MethodDecorator
> = {
  GET: Get,
  POST: Post,
  PUT: Put,
  PATCH: Patch,
  DELETE: Delete,
};

/**
 * Bind a handler to a contract endpoint: the HTTP method and path are taken
 * from the contract (`/users/:id` — the same param syntax NestJS uses), and
 * request/response validation is wired via `@UseContract()`. The route can
 * never drift from what the frontend client calls.
 *
 * Contract paths are absolute, so use it on a prefix-less `@Controller()`
 * (or make sure the controller prefix + contract path compose correctly).
 *
 * @example
 * ⁣@Controller()
 * class UserController {
 *   ⁣@TypeFetchEndpoint(contracts.user.getUser)
 *   async getUser(
 *     ⁣@ContractInput() input: InferRequest<typeof contracts.user.getUser>,
 *   ): Promise<InferResponse<typeof contracts.user.getUser>> {
 *     return { id: input.path.id, name: "Taha" };
 *   }
 * }
 */
export function TypeFetchEndpoint(
  endpoint: EndpointDefZ,
  options: ContractEndpointOptions = {},
): MethodDecorator {
  const routeDecorator = METHOD_DECORATORS[endpoint.method];
  if (!routeDecorator) {
    throw new Error(
      `[typefetch-nestjs] Unsupported HTTP method "${endpoint.method}" on contract path "${endpoint.path}"`,
    );
  }

  return applyDecorators(
    routeDecorator(endpoint.path),
    UseContract(endpoint, options),
  );
}
