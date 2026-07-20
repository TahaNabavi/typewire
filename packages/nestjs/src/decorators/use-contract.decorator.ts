import {
  applyDecorators,
  HttpCode,
  SetMetadata,
  UseInterceptors,
} from "@nestjs/common";
import type { EndpointDefZ } from "@tahanabavi/typefetch";
import {
  TYPEFETCH_ENDPOINT_METADATA,
  TYPEFETCH_OPTIONS_METADATA,
} from "../constants";
import { ContractValidationInterceptor } from "../interceptors/contract-validation.interceptor";
import type { ContractEndpointOptions } from "../types";

/**
 * Attach contract validation to a route you declare yourself — for
 * retrofitting existing controllers where `@Get()/@Post()` stay in place.
 * Input is validated against `endpoint.request`, the return value against
 * `endpoint.response`.
 *
 * Prefer `@TypeFetchEndpoint()` for new code: it also derives the route
 * from the contract, so method/path can never drift.
 *
 * @example
 * ⁣@Controller("users")
 * class UserController {
 *   ⁣@Get(":id")
 *   ⁣@UseContract(contracts.user.getUser)
 *   getUser(@ContractInput() input: InferRequest<typeof contracts.user.getUser>) { ... }
 * }
 */
export function UseContract(
  endpoint: EndpointDefZ,
  options: ContractEndpointOptions = {},
): MethodDecorator {
  const decorators: MethodDecorator[] = [
    SetMetadata(TYPEFETCH_ENDPOINT_METADATA, endpoint),
    SetMetadata(TYPEFETCH_OPTIONS_METADATA, options),
    UseInterceptors(ContractValidationInterceptor),
  ];

  if (options.httpCode !== undefined) {
    decorators.push(HttpCode(options.httpCode));
  }

  return applyDecorators(...decorators);
}
