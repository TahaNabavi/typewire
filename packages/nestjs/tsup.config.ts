import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    // One entry per transport, so an HTTP-only app never loads — or installs —
    // the peer dependency another wire needs.
    "grpc/index": "src/grpc/index.ts",
    "graphql/index": "src/graphql/index.ts",
    "socket/index": "src/socket/index.ts",
  },
  format: ["cjs", "esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2020",
  external: [
    "@nestjs/common",
    "@nestjs/core",
    "@nestjs/swagger",
    "@nestjs/websockets",
    "@tahanabavi/typefetch",
    "@tahanabavi/typefetch-graphql",
    "@tahanabavi/typefetch-grpc",
    "@tahanabavi/typesocket",
    "crypto-js",
    "node-forge",
    "reflect-metadata",
    "rxjs",
    "zod",
  ],
});
