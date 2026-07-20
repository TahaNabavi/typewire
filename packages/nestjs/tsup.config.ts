import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
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
    "@tahanabavi/typefetch",
    "crypto-js",
    "node-forge",
    "reflect-metadata",
    "rxjs",
    "zod",
  ],
});
