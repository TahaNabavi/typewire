import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["cjs", "esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  // ES2020 is the floor for BigInt literals (`1n`), which the whole engine uses.
  target: "es2020",
});
