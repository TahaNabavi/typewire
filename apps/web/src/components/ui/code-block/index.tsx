import { highlight } from '@/lib/highlight'
import { cn } from '@/utils'

import { CopyButton } from '@/components/ui/copy-button'

/**
 * Code blocks stay dark in both themes — a dark editor panel on a light page is
 * correct for a developer tool, and it keeps a snippet looking the same in a
 * screenshot as it does on the site.
 *
 * This is a server component: the colouring happens during the render that
 * produces the HTML, so no highlighter reaches the browser.
 */
export async function CodeBlock({
  code,
  filename,
  lang,
  copy = true,
  className,
}: {
  code: string
  filename?: string
  lang?: string
  copy?: boolean
  className?: string
}) {
  const html = await highlight(code, lang ?? langFromFilename(filename))

  return (
    <figure
      className={cn(
        // min-w-0 matters more than it looks: as a grid or flex child, the
        // default `min-width: auto` sizes this to the longest line of code, so
        // one wide snippet widens its whole track and the page scrolls
        // sideways. Clamping it here makes the inner `overflow-x-auto` real.
        'code-surface group/code relative min-w-0 overflow-hidden rounded-xl border border-hair shadow-[0_30px_70px_-34px_rgba(0,0,0,0.7)]',
        className
      )}
    >
      {filename !== null && filename !== undefined && filename !== '' ? (
        <figcaption className="flex items-center gap-2 border-b border-hair px-4 py-2 font-mono text-xs text-dim">
          <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-red/70" />
          <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-amber/70" />
          <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-green/70" />
          <span className="ml-2 truncate">{filename}</span>
        </figcaption>
      ) : null}
      {copy !== null && copy !== undefined && copy === true ? (
        // Revealed on hover, but always reachable by keyboard.
        <div className="absolute top-2 right-2 rounded-md bg-code/85 opacity-0 backdrop-blur-sm transition-opacity group-hover/code:opacity-100 focus-within:opacity-100">
          <CopyButton value={code} />
        </div>
      ) : null}
      <pre className="overflow-x-auto p-4 text-[13px] leading-relaxed">
        <code
          className="font-mono"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </pre>
    </figure>
  )
}

/** Saves every call site from repeating the language when the name implies it. */
function langFromFilename(filename?: string): string | undefined {
  if (filename === null || filename === undefined || filename === '')
    return undefined
  const ext = filename?.split('.').pop()?.toLowerCase()
  return ext !== null && ext !== undefined && ext !== '' && ext !== filename
    ? ext
    : undefined
}
