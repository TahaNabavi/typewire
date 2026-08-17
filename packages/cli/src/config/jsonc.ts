/**
 * A tolerant JSON reader for `tsconfig.json`.
 *
 * tsconfig files are JSONC: TypeScript accepts comments and trailing commas,
 * and the ones people actually write are full of both. `JSON.parse` refuses
 * them, and pulling in a JSONC dependency to read one file would put a
 * dependency in the CLI for something a 40-line scanner does.
 *
 * Deliberately not a full parser — it strips what tsconfig allows and hands the
 * rest to `JSON.parse`, so malformed input still fails in `JSON.parse` with a
 * position rather than being silently mis-read here.
 */
export function parseJsonc(text: string): unknown {
  // The BOM goes first: Windows editors write one, and `JSON.parse` throws on
  // it, which would silently cost the project its tsconfig path aliases.
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return JSON.parse(stripTrailingCommas(stripComments(body)));
}

function stripComments(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i] as string;
    const next = text[i + 1];

    if (inString) {
      out += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }

    if (char === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
      continue;
    }

    if (char === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++; // land on the "/" so the loop's i++ steps past it
      continue;
    }

    out += char;
  }

  return out;
}

/** `[1, 2, ]` → `[1, 2 ]`. String contents are left alone. */
function stripTrailingCommas(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i] as string;

    if (inString) {
      out += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }

    if (char === ",") {
      const rest = text.slice(i + 1);
      const nextMeaningful = rest.match(/^\s*([\]}])/);
      if (nextMeaningful) continue;
    }

    out += char;
  }

  return out;
}
