import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative } from "node:path";
import { exists } from "../config/fs";
import { UsageError } from "../errors";
import { detectProject, type ProjectInfo } from "./detect";
import { availableFeatures, type FeatureId } from "./features";
import { buildPlan, type InitPlan } from "./plan";
import {
  bold,
  createPrompter,
  cyan,
  dim,
  green,
  shouldPromptInteractively,
  yellow,
  type Choice,
  type PromptStreams,
} from "./prompt";

export type InitOptions = {
  cwd?: string;
  force?: boolean;
  /** `--yes`: take every default, ask nothing. */
  yes?: boolean;
  /** `--features typefetch,query`: skip the question entirely. */
  features?: string[];
  contractsPath?: string;
  output?: string;
  dryRun?: boolean;
  /** Drive the questions from somewhere other than the terminal — used in tests. */
  streams?: PromptStreams;
};

export type InitFileResult = {
  path: string;
  status: "created" | "skipped" | "overwritten" | "planned";
};

/**
 * `typewire init` — read the project, ask what it needs, wire it up.
 *
 * The shape of the questions matters more than the number of them: everything
 * asked here is something the project genuinely cannot imply, and everything it
 * can imply is a *default*, shown and overridable, never a silent decision.
 */
export async function runInit(options: InitOptions = {}): Promise<InitFileResult[]> {
  const cwd = options.cwd ?? process.cwd();
  const project = await detectProject(cwd);

  const interactive =
    !options.yes &&
    !options.features &&
    (Boolean(options.streams) || shouldPromptInteractively());
  const prompter = createPrompter(interactive, options.streams);

  try {
    printDetection(project);

    if (project.existingConfig && !options.force) {
      console.log(
        `\n${yellow("A TypeWire config already exists")} at ${relative(cwd, project.existingConfig) || project.existingConfig}.`,
      );
      const proceed = await prompter.confirm(
        "  Scaffold anyway? Existing files are skipped unless --force.",
        false,
      );
      if (!proceed) return [];
    }

    const features = options.features
      ? parseFeatures(options.features, project)
      : new Set(
          await prompter.multiselect(
            "What does this project need?",
            featureChoices(project),
          ),
        );
    features.add("typefetch");

    const plan = buildPlan({
      project,
      features,
      ...(options.contractsPath !== undefined
        ? { contractsPath: options.contractsPath }
        : {}),
      ...(options.output !== undefined ? { output: options.output } : {}),
    });

    printPlan(plan, cwd);

    if (options.dryRun) {
      console.log(`\n${dim("--dry-run: nothing was written.")}`);
      return plan.files.map((file) => ({ path: file.path, status: "planned" }));
    }

    const confirmed = await prompter.confirm(
      `\nWrite ${plan.files.length} file${plan.files.length === 1 ? "" : "s"}?`,
      true,
    );
    if (!confirmed) {
      console.log(dim("Nothing was written."));
      return [];
    }

    const results = await writePlan(plan, Boolean(options.force));
    printResults(results, plan, cwd);

    return results;
  } finally {
    prompter.close();
  }
}

function featureChoices(project: ProjectInfo): Choice<FeatureId>[] {
  return availableFeatures(project).map((feature) => ({
    value: feature.id,
    label: feature.label,
    hint: feature.hint,
    ...(feature.locked ? { locked: true } : {}),
    ...(feature.suggested?.(project) ? { selected: true } : {}),
  }));
}

/**
 * An unknown `--features` value is an error, not a silent no-op: the whole
 * point of the flag is a reproducible scaffold in CI, and quietly dropping a
 * typo'd feature produces a project missing exactly what was asked for.
 */
function parseFeatures(values: string[], project: ProjectInfo): Set<FeatureId> {
  const known = new Map(
    availableFeatures(project).map((feature) => [feature.id as string, feature.id]),
  );
  const chosen = new Set<FeatureId>();

  for (const value of values) {
    const id = known.get(value.trim());
    if (!id) {
      throw new UsageError(
        `Unknown --features value "${value.trim()}".\n` +
          `Available here: ${[...known.keys()].join(", ")}`,
      );
    }
    chosen.add(id);
  }

  return chosen;
}

async function writePlan(
  plan: InitPlan,
  force: boolean,
): Promise<InitFileResult[]> {
  const results: InitFileResult[] = [];

  for (const file of plan.files) {
    const alreadyExists = await exists(file.path);

    if (alreadyExists && !force) {
      results.push({ path: file.path, status: "skipped" });
      continue;
    }

    await mkdir(dirname(file.path), { recursive: true });
    await writeFile(file.path, file.content, "utf8");
    results.push({
      path: file.path,
      status: alreadyExists ? "overwritten" : "created",
    });
  }

  return results;
}

function printDetection(project: ProjectInfo): void {
  console.log(`\n${bold("TypeWire")}\n`);
  console.log(`  project    ${project.name ?? dim("unnamed")}`);
  console.log(
    `  framework  ${project.frameworkLabel}${project.vite ? dim(" · vite") : ""}${
      project.monorepo ? dim(" · monorepo") : ""
    }`,
  );
  console.log(
    `  language   ${project.typescript ? "TypeScript" : "JavaScript"}${
      project.typescript ? "" : dim(" — contracts still work, without inference")
    }`,
  );
  console.log(`  installer  ${project.packageManager}`);
  console.log(
    `  source     ${project.sourceDir === "." ? dim("project root") : `${project.sourceDir}/`}`,
  );

  if (project.installed.size) {
    console.log(`  installed  ${[...project.installed].join(", ")}`);
  }
}

function printPlan(plan: InitPlan, cwd: string): void {
  console.log(`\n${bold("Files")}`);
  for (const file of plan.files) {
    const path = relative(cwd, file.path) || file.path;
    console.log(`  ${cyan(toPosix(path))}\n    ${dim(file.purpose)}`);
  }

  if (plan.installCommands.length) {
    console.log(`\n${bold("Packages")}`);
    for (const command of plan.installCommands) console.log(`  ${command}`);
  } else {
    console.log(`\n${bold("Packages")}\n  ${dim("everything needed is already installed")}`);
  }
}

function printResults(
  results: InitFileResult[],
  plan: InitPlan,
  cwd: string,
): void {
  console.log("");
  for (const result of results) {
    const path = toPosix(relative(cwd, result.path) || result.path);
    const label =
      result.status === "created"
        ? green("created")
        : result.status === "skipped"
          ? yellow("skipped")
          : yellow(result.status);
    console.log(`  ${label} ${path}`);
  }

  const skipped = results.filter((result) => result.status === "skipped");
  if (skipped.length) {
    console.log(
      `\n  ${dim(`${skipped.length} file(s) already existed and were left alone. Re-run with --force to replace them.`)}`,
    );
  }

  if (plan.installCommands.length) {
    console.log(`\n${bold("Install")}`);
    for (const command of plan.installCommands) console.log(`  ${command}`);
  }

  console.log(`\n${bold("Next")}`);
  plan.nextSteps.forEach((step, index) => {
    console.log(`  ${index + 1}. ${step}`);
  });
  console.log("");
}

function toPosix(path: string): string {
  return path.split(/[\\/]/).join("/");
}
