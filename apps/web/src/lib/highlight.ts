import type { BundledLanguage } from "shiki";
import { createHighlighter, type Highlighter, type ThemeRegistration } from "shiki";

/**
 * Build-time syntax highlighting.
 *
 * Shiki runs on the server only — every call site is a server component or the
 * markdown renderer — so the browser receives coloured markup and no
 * highlighter. That matters on a page whose whole argument is that the runtime
 * cost of a feature should be zero when you are not using it.
 *
 * The theme below is not a stock one. Code sits next to the transport legend,
 * the devtools timeline and the architecture diagram, all of which already
 * assign meaning to these colours; borrowing a theme would put a second,
 * unrelated palette on the same screen. So the tokens map onto the site's own:
 * cyan for types, blue for calls, purple for keywords, green for strings.
 */

/** Kept in step with `--code-*` and the accents in globals.css. */
const BG = "#0b1322";
const FG = "#cdd8e8";
const DIM = "#5a6b83";
const BLUE = "#60a5fa";
const PURPLE = "#a78bfa";
const CYAN = "#22d3ee";
const GREEN = "#4ade80";
const AMBER = "#fbbf24";
const SLATE = "#94a3b8";

const theme: ThemeRegistration = {
  name: "typewire",
  type: "dark",
  colors: { "editor.background": BG, "editor.foreground": FG },
  settings: [
    { settings: { background: BG, foreground: FG } },

    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: DIM, fontStyle: "italic" } },

    {
      scope: [
        "keyword",
        "storage",
        "storage.type",
        "storage.modifier",
        "keyword.control",
        "keyword.operator.new",
        "keyword.operator.expression",
        "variable.language.this",
        "variable.language.super",
      ],
      settings: { foreground: PURPLE },
    },

    {
      scope: ["string", "string.quoted", "string.template", "constant.other.symbol"],
      settings: { foreground: GREEN },
    },
    // The `${}` inside a template literal is code, not string.
    { scope: ["punctuation.definition.template-expression", "meta.template.expression"], settings: { foreground: PURPLE } },

    {
      scope: ["constant.numeric", "constant.language", "constant.language.boolean", "constant.language.null", "constant.language.undefined"],
      settings: { foreground: AMBER },
    },

    {
      scope: [
        "entity.name.function",
        "support.function",
        "meta.function-call.generic",
        "variable.function",
      ],
      settings: { foreground: BLUE },
    },

    {
      scope: [
        "entity.name.type",
        "entity.name.class",
        "entity.name.interface",
        "support.type",
        "support.class",
        "entity.other.inherited-class",
        "entity.name.type.module",
      ],
      settings: { foreground: CYAN },
    },

    // JSX/TSX: the tag is structure, the attribute is a knob.
    { scope: ["entity.name.tag", "support.class.component"], settings: { foreground: CYAN } },
    { scope: ["entity.other.attribute-name"], settings: { foreground: BLUE } },

    { scope: ["variable", "variable.other", "meta.definition.variable"], settings: { foreground: FG } },
    { scope: ["variable.parameter"], settings: { foreground: SLATE } },
    {
      scope: ["variable.other.property", "meta.object-literal.key", "support.type.property-name"],
      settings: { foreground: "#cbd5e1" },
    },

    { scope: ["punctuation", "meta.brace", "keyword.operator"], settings: { foreground: "#64748b" } },

    // Decorators read as annotations, so they take the keyword colour.
    { scope: ["meta.decorator", "entity.name.function.decorator", "punctuation.decorator"], settings: { foreground: PURPLE } },

    // Shell: the command itself is the subject of an install snippet.
    { scope: ["source.shell", "meta.function-call.shell"], settings: { foreground: FG } },
    { scope: ["support.function.builtin.shell", "entity.name.command"], settings: { foreground: BLUE } },
    { scope: ["variable.parameter.option", "constant.other.option"], settings: { foreground: AMBER } },
  ],
};

/**
 * Languages are declared up front rather than loaded on demand: the set is
 * small and fixed, and a lazy load would make the first render of a docs page
 * pay for a grammar fetch.
 */
const LANGS = ["ts", "tsx", "js", "jsx", "json", "bash", "graphql", "yaml", "sql", "prisma"] as const;

type Lang = (typeof LANGS)[number];

const ALIAS: Record<string, Lang> = {
  typescript: "ts",
  typescriptreact: "tsx",
  javascript: "js",
  javascriptreact: "jsx",
  sh: "bash",
  shell: "bash",
  console: "bash",
  zsh: "bash",
  gql: "graphql",
  yml: "yaml",
  jsonc: "json",
  json5: "json",
};

function resolveLang(lang: string | undefined): Lang {
  if (!lang) return "ts";
  const key = lang.toLowerCase().trim();
  if ((LANGS as readonly string[]).includes(key)) return key as Lang;
  return ALIAS[key] ?? "ts";
}

/**
 * One highlighter per process. `createHighlighter` loads WASM and every
 * grammar, which is far too expensive to repeat per code block — a docs page
 * renders a dozen.
 */
let instance: Promise<Highlighter> | null = null;

function highlighter(): Promise<Highlighter> {
  instance ??= createHighlighter({
    themes: [theme],
    langs: LANGS as unknown as BundledLanguage[],
  });
  return instance;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Returns the inner markup for a `<code>` element — coloured `<span>`s, no
 * `<pre>` wrapper — so each call site keeps control of its own container,
 * padding and border. The surface colour comes from `.code-surface`, not from
 * the theme, so a highlighted block and a hand-coloured one (the diff terminal,
 * the drift comparison) sit on exactly the same background.
 */
export async function highlight(code: string, lang?: string): Promise<string> {
  const source = code.replace(/\n+$/, "");
  try {
    const shiki = await highlighter();
    const html = shiki.codeToHtml(source, {
      lang: resolveLang(lang),
      theme: "typewire",
      structure: "inline",
    });
    return html;
  } catch {
    // A grammar we do not carry should degrade to plain text, never to a
    // build failure — the docs are read from the packages and can name
    // anything in a fence.
    return escapeHtml(source);
  }
}
