/**
 * The argument of the whole project, as one comparison.
 *
 * Left is what a hand-kept client looks like when the server moves underneath
 * it; right is the same change with one contract.
 *
 * This used to be a draggable reveal — one panel clipped over the other. It
 * looked clever and read as nothing: both panels start their text at the same
 * left edge, so sliding the divider to the middle showed the left half of one
 * and the *empty right margin* of the other. A before/after wipe works for
 * photographs, where every pixel carries information; for two code listings
 * the only thing a reader wants is to see both at once and compare line for
 * line. So they sit side by side, and the component needs no state, no pointer
 * handling and no client bundle at all.
 */

interface Line {
  text: string;
  tone?: "bad" | "good" | "dim";
}

const WITHOUT: Line[] = [
  { text: "// server, last Tuesday", tone: "dim" },
  { text: "res.json({ id, fullName })" },
  { text: "" },
  { text: "// client, still says", tone: "dim" },
  { text: "type User = { id: string; name: string }" },
  { text: "const { name } = await getUser(id)" },
  { text: "" },
  { text: "→ undefined, at 2am, in production", tone: "bad" },
  { text: "→ typecheck passed. tests passed.", tone: "bad" },
];

const WITH: Line[] = [
  { text: "// contracts.ts — the only edit", tone: "dim" },
  { text: "response: z.object({" },
  { text: "  id: z.string()," },
  { text: "  fullName: z.string(),", tone: "good" },
  { text: "})" },
  { text: "" },
  { text: "// client, next typecheck", tone: "dim" },
  { text: "→ Property 'name' does not exist", tone: "good" },
  { text: "→ caught before it ran", tone: "good" },
];

const TONE: Record<string, string> = {
  bad: "text-red",
  good: "text-green",
  dim: "text-dim",
};

function Panel({ title, lines, tone }: { title: string; lines: Line[]; tone: "red" | "green" }) {
  return (
    <div className="code-surface flex h-full flex-col overflow-hidden rounded-xl border border-hair">
      <div
        className="flex items-center gap-2 border-b px-4 py-2.5"
        style={{
          borderColor: `color-mix(in oklab, var(--${tone}) 25%, transparent)`,
          background: `color-mix(in oklab, var(--${tone}) 8%, transparent)`,
        }}
      >
        <span aria-hidden className="size-1.5 rounded-full" style={{ background: `var(--${tone})` }} />
        <span
          className="font-mono text-[10.5px] font-bold tracking-[0.14em]"
          style={{ color: `var(--${tone})` }}
        >
          {title}
        </span>
      </div>
      <pre className="flex-1 overflow-x-auto p-4 font-mono text-[12px] leading-[1.9]">
        {lines.map((line, i) => (
          <div key={i} className={line.tone ? TONE[line.tone] : "text-code-fg"}>
            {line.text || " "}
          </div>
        ))}
      </pre>
    </div>
  );
}

export function DriftCompare() {
  return (
    <div className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-2">
      <Panel title="WITHOUT TYPEWIRE" lines={WITHOUT} tone="red" />
      <Panel title="WITH TYPEWIRE" lines={WITH} tone="green" />
    </div>
  );
}
