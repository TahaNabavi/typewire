import { documentedPackages } from "@/lib/registry";

/**
 * The retrieval half of "Ask the docs".
 *
 * Every answer this site gives has to be traceable to a page a reader can open,
 * which rules out asking a model what it remembers about TypeWire. So the
 * corpus is the docs themselves — the same markdown the docs pages render,
 * already carried by the registry — split into sections and searched here.
 *
 * The scorer is deliberately plain. An embedding index would need a vector
 * store, an embedding call per section, and a rebuild step on every docs
 * change; for a corpus of a few hundred sections of technical prose, where the
 * words a developer types ("graphql transport", "ErrorKind", "retry") are
 * mostly the exact words in the headings, BM25-style term scoring gets the
 * right section and costs nothing to keep in step.
 */

export interface DocSection {
  packageSlug: string;
  packageName: string;
  pageSlug: string;
  pageTitle: string;
  /** The heading this section sits under, or the page title for the preamble. */
  heading: string;
  anchor: string;
  href: string;
  text: string;
}

function slugify(text: string): string {
  return text
    .replace(/<[^>]+>/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Fenced code is kept — a reader asking "how do I add a GraphQL transport"
 * wants the call, not a paragraph about it — but its fence markers go, so the
 * scorer does not match on backticks.
 */
function clean(markdown: string): string {
  return markdown
    .replace(/```[a-z]*\n/gi, "")
    .replace(/```/g, "")
    .replace(/^\s*\|.*\|\s*$/gm, (row) => row.replace(/\|/g, " "))
    .replace(/[*_>#]/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Split one page into its H2/H3 sections, keeping anything before the first. */
function sectionsOf(markdown: string): Array<{ heading: string | null; body: string }> {
  const lines = markdown.split("\n");
  const out: Array<{ heading: string | null; body: string }> = [];
  let heading: string | null = null;
  let buffer: string[] = [];
  let inFence = false;

  const flush = () => {
    const body = buffer.join("\n").trim();
    if (body || heading) out.push({ heading, body });
    buffer = [];
  };

  for (const line of lines) {
    // A "## " inside a fenced block is shell output or a comment, not a heading.
    if (/^\s*```/.test(line)) inFence = !inFence;

    const match = !inFence && /^(#{2,3})\s+(.*)$/.exec(line);
    if (match) {
      flush();
      heading = match[2]!.trim();
      continue;
    }
    buffer.push(line);
  }
  flush();
  return out;
}

let cache: DocSection[] | null = null;

export function corpus(): DocSection[] {
  if (cache) return cache;

  const sections: DocSection[] = [];
  for (const pkg of documentedPackages) {
    for (const page of pkg.docs.pages) {
      for (const { heading, body } of sectionsOf(page.markdown)) {
        const text = clean(body);
        // Sections that are only a heading carry no answer.
        if (text.length < 40) continue;
        const title = heading ?? page.title;
        const anchor = heading ? slugify(heading) : "";
        sections.push({
          packageSlug: pkg.slug,
          packageName: pkg.short,
          pageSlug: page.slug,
          pageTitle: page.title,
          heading: title,
          anchor,
          href: `/docs/${pkg.slug}/${page.slug}${anchor ? `#${anchor}` : ""}`,
          text: text.slice(0, 2400),
        });
      }
    }
  }

  cache = sections;
  return sections;
}

const STOP = new Set([
  "the", "a", "an", "and", "or", "but", "is", "are", "was", "were", "be", "been",
  "to", "of", "in", "on", "for", "with", "at", "by", "from", "as", "it", "its",
  "this", "that", "these", "those", "i", "you", "how", "do", "does", "can",
  "what", "when", "where", "which", "why", "my", "me", "we", "should", "would",
]);

function terms(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1 && !STOP.has(word));
}

export interface Hit extends DocSection {
  score: number;
}

/**
 * BM25 over the section corpus, with a bonus for terms that appear in the
 * heading — in technical docs the heading is the strongest signal there is
 * that a section is *about* something rather than merely mentioning it.
 */
export function search(question: string, limit = 5): Hit[] {
  const query = terms(question);
  if (query.length === 0) return [];

  const sections = corpus();
  const docs = sections.map((section) => ({
    section,
    tokens: terms(section.text),
    headingTokens: new Set(terms(section.heading)),
  }));

  const avgLen = docs.reduce((sum, d) => sum + d.tokens.length, 0) / (docs.length || 1);

  // Document frequency per query term, computed once.
  const df = new Map<string, number>();
  for (const term of new Set(query)) {
    let n = 0;
    for (const doc of docs) if (doc.tokens.includes(term)) n += 1;
    df.set(term, n);
  }

  const k1 = 1.5;
  const b = 0.75;

  const scored = docs.map(({ section, tokens, headingTokens }) => {
    const len = tokens.length || 1;
    const counts = new Map<string, number>();
    for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);

    let score = 0;
    for (const term of query) {
      const f = counts.get(term) ?? 0;
      if (f === 0) {
        // A heading match still counts even when the body never repeats it.
        if (headingTokens.has(term)) score += 1.2;
        continue;
      }
      const n = df.get(term) ?? 0;
      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * len) / avgLen)));
      if (headingTokens.has(term)) score += 1.6;
    }
    return { ...section, score };
  });

  return scored
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
