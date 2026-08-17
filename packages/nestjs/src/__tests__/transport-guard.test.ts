import "reflect-metadata";
import type { Contracts } from "@tahanabavi/typefetch";
import "@tahanabavi/typefetch-graphql";
import "@tahanabavi/typefetch-grpc";
import { z } from "zod";
import { GraphQLEndpoint } from "../graphql";
import { GrpcEndpoint } from "../grpc";
import { TypeFetchEndpoint, transportOf, isHttpEndpoint } from "../index";

// One contract file, three wires — the shape this whole release exists for.
const contracts = {
  user: {
    getUser: {
      method: "GET",
      path: "/users/:id",
      request: z.object({ path: z.object({ id: z.string() }) }),
      response: z.object({ id: z.string() }),
    },
    fetchUser: {
      transport: "grpc",
      service: "user.v1.UserService",
      rpc: "GetUser",
      request: z.object({ id: z.string() }),
      response: z.object({ id: z.string() }),
    },
    queryUser: {
      transport: "graphql",
      operation: "query",
      root: "user",
      request: z.object({ id: z.string() }),
      response: z.object({ id: z.string() }),
    },
  },
} as const satisfies Contracts;

describe("transport dispatch", () => {
  it("reads the transport, defaulting an absent one to http", () => {
    expect(transportOf(contracts.user.getUser)).toBe("http");
    expect(transportOf(contracts.user.fetchUser)).toBe("grpc");
    expect(transportOf(contracts.user.queryUser)).toBe("graphql");

    expect(isHttpEndpoint(contracts.user.getUser)).toBe(true);
    expect(isHttpEndpoint(contracts.user.fetchUser)).toBe(false);
  });
});

describe("@TypeFetchEndpoint() on a non-http contract", () => {
  // Before transports, this threw `Unsupported HTTP method "undefined"` — the
  // symptom, not the cause. The route was silently unmounted either way.
  it("refuses a gRPC endpoint and names the decorator that serves it", () => {
    expect(() => TypeFetchEndpoint(contracts.user.fetchUser as never)).toThrow(
      /@GrpcEndpoint\(\).*typewire-nestjs\/grpc/s,
    );
  });

  it("refuses a GraphQL endpoint and names the decorator that serves it", () => {
    expect(() => TypeFetchEndpoint(contracts.user.queryUser as never)).toThrow(
      /@GraphQLEndpoint\(\).*typewire-nestjs\/graphql/s,
    );
  });

  it("identifies the offending route without reading a field it may not have", () => {
    expect(() => TypeFetchEndpoint(contracts.user.fetchUser as never)).toThrow(
      /user\.v1\.UserService\/GetUser/,
    );
  });
});

describe("@GrpcEndpoint() / @GraphQLEndpoint() guard rails", () => {
  it("refuses an http endpoint", () => {
    expect(() => GrpcEndpoint(contracts.user.getUser as never)).toThrow(
      /serves "grpc" endpoints.*GET \/users\/:id.*"http"/s,
    );
  });

  it("refuses a gRPC endpoint declared without a service", () => {
    expect(() =>
      GrpcEndpoint({
        transport: "grpc",
        rpc: "GetUser",
        request: z.object({}),
        response: z.object({}),
      } as never),
    ).toThrow(/needs both `service` and `rpc`/);
  });

  it("refuses a binary codec rather than serving JSON to a protobuf client", () => {
    expect(() =>
      GrpcEndpoint({
        ...contracts.user.fetchUser,
        codec: { encode: () => new Uint8Array(), decode: () => ({}) },
      } as never),
    ).toThrow(/binary grpc-web.*Connect's JSON protocol only/s);
  });

  it("refuses a GraphQL endpoint with no operation", () => {
    expect(() =>
      GraphQLEndpoint({
        transport: "graphql",
        request: z.object({}),
        response: z.object({}),
      } as never),
    ).toThrow(/operation: "query" \| "mutation"/);
  });
});
