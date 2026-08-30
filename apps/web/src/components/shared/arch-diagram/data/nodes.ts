import { NodeSpec } from "../types";

export const NODES = {
  cli: {
    x: 50,
    y: 1,

    label: "CLI",
    description: "TypeWire developer tooling",

    color: "var(--amber)",
    section: "tooling",

    variant: "package",

    width: 118,
    height: 30,
    radius: 8,
  },

  contract: {
    x: 50,
    y: 7,

    label: "CONTRACTS",
    description: "Shared source of truth",

    color: "var(--cyan)",
    section: "core",

    variant: "primary",

    width: 118,
    height: 30,
    radius: 8,
  },

  transports: {
    x: 20.5,
    y: 15,

    label: "TRANSPORTS",
    description: "Transport abstraction layer",

    color: "var(--cyan)",
    section: "core",

    variant: "group",

    width: 118,
    height: 30,
    radius: 8,
  },

  client: {
    x: 50,
    y: 15,

    label: "CLIENT",
    description: "Client-side runtime",

    color: "var(--cyan)",
    section: "core",

    variant: "primary",

    width: 118,
    height: 30,
    radius: 8,
  },

  server: {
    x: 82.5,
    y: 15,

    label: "SERVER",
    description: "Server-side runtime",

    color: "var(--cyan)",
    section: "core",

    variant: "primary",

    width: 118,
    height: 30,
    radius: 8,
  },

  graphql: {
    x: 8,
    y: 25,

    label: "GRAPHQL",
    description: "GraphQL transport",

    color: "var(--wire-graphql)",
    section: "transport",

    variant: "integration",

    width: 104,
    height: 30,
    radius: 8,
  },

  http: {
    x: 20.5,
    y: 25,

    label: "HTTP",
    description: "HTTP transport",

    color: "var(--wire-http)",
    section: "transport",

    variant: "integration",

    width: 104,
    height: 30,
    radius: 8,
  },

  grpc: {
    x: 33,
    y: 25,

    label: "GRPC",
    description: "gRPC transport",

    color: "var(--wire-grpc)",
    section: "transport",

    variant: "integration",

    width: 104,
    height: 30,
    radius: 8,
  },

  typefetch: {
    x: 43,
    y: 30,

    label: "TYPEFETCH",
    description: "Type-safe HTTP client",

    color: "var(--wire-http)",
    section: "transport",

    variant: "package",

    width: 104,
    height: 30,
    radius: 8,
  },

  typesocket: {
    x: 57,
    y: 30,

    label: "TYPESCOKET",
    description: "Type-safe WebSocket client",

    color: "var(--wire-ws)",
    section: "transport",

    variant: "package",

    width: 104,
    height: 30,
    radius: 8,
  },

  nestjs: {
    x: 82.5,
    y: 25,

    label: "NEST JS",
    description: "NestJS integration",

    color: "var(--wire-ws)",
    section: "server",

    variant: "integration",

    width: 118,
    height: 30,
    radius: 8,
  },

  querycore: {
    x: 50,
    y: 46,

    label: "QUERY CORE",
    description: "Runtime query layer",

    color: "var(--purple)",
    section: "runtime",

    variant: "primary",

    width: 108,
    height: 30,
    radius: 8,
  },

  devtools: {
    x: 50,
    y: 55,

    label: "DEVTOOLS",
    description: "TypeWire developer tools",

    color: "var(--purple)",
    section: "runtime",

    variant: "package",

    width: 104,
    height: 30,
    radius: 8,
  },

  frameworks: {
    x: 16,
    y: 46,

    label: "FRAMEWORKS",
    description: "Framework integration layer",

    color: "var(--purple)",
    section: "framework",

    variant: "group",

    width: 118,
    height: 30,
    radius: 8,
  },

  react: {
    x: 20.5,
    y: 55,

    label: "REACT",
    description: "React integration",

    color: "var(--purple)",
    section: "framework",

    variant: "integration",

    width: 104,
    height: 30,
    radius: 8,
  },

  permission: {
    x: 74,
    y: 46,

    label: "PERMISSION",
    description: "Permission and access control",

    color: "var(--cyan)",
    section: "security",

    variant: "package",

    width: 118,
    height: 30,
    radius: 8,

    muted: true,
  },

  encryption: {
    x: 90,
    y: 46,

    label: "ENCRYPTION",
    description: "Encryption middleware for TypeFetch contracts",

    color: "var(--cyan)",
    section: "security",

    variant: "package",

    width: 118,
    height: 30,
    radius: 8,

    muted: true,
  },
} satisfies Record<string, NodeSpec>;
