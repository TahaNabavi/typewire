#!/usr/bin/env node
/**
 * Minimal CLI example.
 * For production, wire this with cac/commander and dynamically import user config.
 */
import { ApiClient } from "@/client";
import type { Contracts } from "@/types";
import { createApiTestRunner } from "./runner";
import { writeReportFiles } from "./node-reporter";

type TypeFetchTestConfig = {
  contracts: Contracts;
  baseUrl: string;
  token?: string;
  output?: string;
};

async function main() {
  const configPath = process.argv[2] ?? "./typefetch.test.config.ts";
  const imported = (await import(configPath)) as {
    default: TypeFetchTestConfig;
  };
  const config = imported.default;

  const client = new ApiClient(
    {
      baseUrl: config.baseUrl,
      token: config.token,
    },
    config.contracts,
  );
  client.init();

  const report = await createApiTestRunner({
    client,
    contracts: config.contracts,
    options: {
      mode: "full",
    },
  }).run();

  await writeReportFiles(report, config.output ?? "./typefetch-report.md");

  if (report.summary.failed > 0) {
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
