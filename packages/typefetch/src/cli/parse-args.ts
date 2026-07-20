import type { ParsedCliArgs, TypeFetchCliCommand } from "./types";

const KNOWN_COMMANDS = new Set<TypeFetchCliCommand>([
  "test",
  "list",
  "init",
  "release-doc",
  "help",
  "version",
]);

const BOOLEAN_FLAGS = new Set([
  "help",
  "version",
  "include-destructive",
  "stop-on-fail",
  "force",
  "yes",
  "dry-run",
]);

const ALIASES: Record<string, string> = {
  c: "config",
  m: "mode",
  o: "output",
  f: "format",
  h: "help",
  v: "version",
};

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const raw = [...argv];
  const flags: ParsedCliArgs["flags"] = {};
  const positionals: string[] = [];

  let command: TypeFetchCliCommand = "test";
  let index = 0;

  if (argv[0] && !argv[0].startsWith("-")) {
    const maybeCommand = argv[0] as TypeFetchCliCommand;
    if (KNOWN_COMMANDS.has(maybeCommand)) {
      command = maybeCommand;
      index = 1;
    } else {
      positionals.push(argv[0]);
      index = 1;
    }
  }

  while (index < argv.length) {
    const arg = argv[index];

    if (arg === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }

    if (arg.startsWith("--no-")) {
      flags[toCamelCase(arg.slice(5))] = false;
      index++;
      continue;
    }

    if (arg.startsWith("--")) {
      const body = arg.slice(2);
      const [rawKey, inlineValue] = splitOnce(body, "=");
      const key = toCamelCase(rawKey);

      if (inlineValue !== undefined) {
        addFlagValue(flags, key, inlineValue);
        index++;
        continue;
      }

      const next = argv[index + 1];
      if (BOOLEAN_FLAGS.has(rawKey) || next === undefined || next.startsWith("-")) {
        addFlagValue(flags, key, true);
        index++;
        continue;
      }

      addFlagValue(flags, key, next);
      index += 2;
      continue;
    }

    if (arg.startsWith("-") && arg.length > 1) {
      const short = arg.slice(1);
      const alias = ALIASES[short];
      if (!alias) {
        throw new Error(`Unknown short flag: -${short}`);
      }

      const key = toCamelCase(alias);
      const next = argv[index + 1];
      if (BOOLEAN_FLAGS.has(alias) || next === undefined || next.startsWith("-")) {
        addFlagValue(flags, key, true);
        index++;
      } else {
        addFlagValue(flags, key, next);
        index += 2;
      }
      continue;
    }

    positionals.push(arg);
    index++;
  }

  if (flags.help === true) command = "help";
  if (flags.version === true) command = "version";

  return { command, flags, positionals, raw };
}

function addFlagValue(
  flags: ParsedCliArgs["flags"],
  key: string,
  value: string | boolean,
) {
  const current = flags[key];
  if (current === undefined) {
    flags[key] = value;
    return;
  }

  if (Array.isArray(current)) {
    current.push(String(value));
    return;
  }

  flags[key] = [String(current), String(value)];
}

function splitOnce(value: string, delimiter: string): [string, string | undefined] {
  const index = value.indexOf(delimiter);
  if (index === -1) return [value, undefined];
  return [value.slice(0, index), value.slice(index + delimiter.length)];
}

function toCamelCase(value: string): string {
  return value.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
}
