import { defineConfig } from "tsup";

// One entry, one bundle. The CLI used to be a second `node`-platform entry here;
// it now ships as `@tahanabavi/typewire-cli` so the core has no bin and no
// runtime dependencies.
export default defineConfig({
  entry: {
    index: "src/index.ts",
  },
  format: ["cjs", "esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2020",
});
