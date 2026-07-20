import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: {
      index: "src/index.ts",
    },
    format: ["cjs", "esm"],
    dts: true,
    sourcemap: true,
    clean: true,
    target: "es2020",
  },
  {
    entry: {
      "cli/index": "src/cli/index.ts",
    },
    format: ["cjs"],
    dts: false,
    sourcemap: true,
    clean: false,
    platform: "node",
    target: "node18",
    banner: {
      js: "#!/usr/bin/env node",
    },
  },
]);