import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { access } from "node:fs/promises";
import type { InitCommandOptions } from "./types";

export type InitFileResult = {
  path: string;
  status: "created" | "skipped" | "overwritten";
};

export async function runInitCommand(
  options: InitCommandOptions = {},
): Promise<InitFileResult[]> {
  const packageName = options.packageName ?? "@tahanabavi/typefetch";
  const contractsPath = options.contractsPath ?? "./src/contracts";
  const root = resolve(process.cwd(), options.output ?? ".");
  const force = Boolean(options.force);

  const files = [
    {
      path: join(root, "typefetch.test.config.ts"),
      content: createConfigTemplate(packageName, contractsPath),
    },
    {
      path: join(root, "typefetch.env.example"),
      content: createEnvTemplate(),
    },
    {
      path: join(root, "typefetch-report", ".gitkeep"),
      content: "",
    },
    {
      path: join(root, "test-fixtures", ".gitkeep"),
      content: "",
    },
  ];

  const results: InitFileResult[] = [];

  for (const file of files) {
    results.push(await writeFileSafe(file.path, file.content, force));
  }

  return results;
}

async function writeFileSafe(
  path: string,
  content: string,
  force: boolean,
): Promise<InitFileResult> {
  const alreadyExists = await exists(path);
  if (alreadyExists && !force) return { path, status: "skipped" };

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");

  return { path, status: alreadyExists ? "overwritten" : "created" };
}

function createConfigTemplate(packageName: string, contractsPath: string): string {
  return `import { ApiClient, defineTypeFetchTestConfig } from "${packageName}";
import { contracts } from "${contractsPath}";

export default defineTypeFetchTestConfig({
  contracts,

  createClient: ({ baseUrl, token }) => {
    const client = new ApiClient(
      {
        baseUrl: baseUrl ?? process.env.API_BASE_URL ?? "http://localhost:3000",
        tokenProvider: async () => token ?? process.env.API_TOKEN ?? "",
      },
      contracts,
    );

    client.init();
    return client;
  },

  options: {
    mode: "full",
    timeout: 10_000,
    includeDestructive: false,
    stopOnFail: false,
  },

  report: {
    output: "./typefetch-report/report",
    formats: ["markdown", "json", "html"],
  },

  context: {},
});
`;
}

function createEnvTemplate(): string {
  return `# TypeFetch API test environment
API_BASE_URL=http://localhost:3000
API_TOKEN=
`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
