import {
  HttpCode,
  Post,
  UseFilters,
  UseInterceptors,
  applyDecorators,
} from "@nestjs/common";
import { UseContract } from "../decorators/use-contract.decorator";
import { SkipEnvelope } from "../envelope/skip-envelope.decorator";
import { assertTransport } from "../transport";
import { ConnectExceptionFilter } from "./connect-exception.filter";
import { ConnectDeadlineInterceptor } from "./deadline";
import type { GrpcContractEndpoint, GrpcEndpointOptions } from "./types";

/**
 * Bind a handler to a gRPC contract endpoint, served over **Connect's JSON
 * protocol**: `POST /<service>/<rpc>` with the message as the body, real HTTP
 * statuses, and a JSON error body naming a gRPC status code.
 *
 * That is the same wire `@tahanabavi/typefetch-grpc` speaks by default, so a
 * NestJS app serves gRPC contracts with no protobuf runtime, no `.proto` file
 * and no code generation — and every RPC stays curl-able.
 *
 * Everything the HTTP decorator gives you still applies, because underneath it
 * is an HTTP route: guards (including the contract permission guard),
 * interceptors, request validation against `request`, and response validation
 * against `response`.
 *
 * @example
 * ⁣@Controller()
 * class UserRpcController {
 *   ⁣@GrpcEndpoint(contracts.user.getUser)   // transport: "grpc"
 *   getUser(
 *     ⁣@ContractInput() input: InferRequest<typeof contracts.user.getUser>,
 *   ) {
 *     const user = this.users.find(input.id);
 *     if (!user) throw new GrpcException(GrpcCode.NotFound, "No such user");
 *     return user;
 *   }
 * }
 *
 * Mount it on a prefix-less `@Controller()`: the RPC path is fully qualified by
 * the service name, exactly as the client builds it.
 */
export function GrpcEndpoint(
  endpoint: GrpcContractEndpoint,
  options: GrpcEndpointOptions = {},
): MethodDecorator {
  assertTransport(endpoint, "grpc", "@GrpcEndpoint()");

  const service = options.service ?? endpoint.service;

  if (!service || !endpoint.rpc) {
    throw new Error(
      `[typewire-nestjs] A gRPC endpoint needs both \`service\` and \`rpc\` ` +
        `(got ${JSON.stringify(service)} / ${JSON.stringify(endpoint.rpc)}). ` +
        `They are the route: POST /<service>/<rpc>.`,
    );
  }

  if (endpoint.codec) {
    throw new Error(
      `[typewire-nestjs] "${service}/${endpoint.rpc}" declares a \`codec\`, ` +
        `which sends binary grpc-web. This package serves Connect's JSON ` +
        `protocol only — put a grpc-web proxy in front, or drop \`codec\` to ` +
        `use JSON on both ends.`,
    );
  }

  return applyDecorators(
    Post(`${service}/${endpoint.rpc}`),
    // Connect answers a successful unary call with 200. Nest's default for POST
    // is 201, which is still 2xx and still decodes — but a status that says
    // "created" for every read is a lie a proxy or a cache may act on.
    HttpCode(200),
    SkipEnvelope(),
    UseFilters(ConnectExceptionFilter),
    UseInterceptors(ConnectDeadlineInterceptor),
    UseContract(endpoint, options),
  );
}
