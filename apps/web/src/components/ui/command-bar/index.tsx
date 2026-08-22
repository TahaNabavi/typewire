import { CopyButton } from "@/components/ui/copy-button";
import { cn } from "@/utils";

/** The install bar: a green prompt, a mono command, a copy button. */
export function CommandBar({ command, className }: { command: string; className?: string }) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border border-hair bg-panel/60 px-4 py-3",
        className,
      )}
    >
      <span aria-hidden className="font-mono text-sm font-bold text-green">
        $
      </span>
      <code className="flex-1 truncate font-mono text-sm text-fg">{command}</code>
      <CopyButton value={command} />
    </div>
  );
}
