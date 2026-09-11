'use client'

import { useState } from 'react'

export function CopyButton({
  value,
  label = 'Copy',
}: {
  value: string
  label?: string
}) {
  const [copied, setCopied] = useState(false)

  return (
    <button
      type="button"
      aria-label={`${label}: ${value}`}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1600)
        })
      }}
      className="rounded-md border border-hair px-2 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:border-hair-strong hover:text-fg"
    >
      {copied ? 'copied' : label}
    </button>
  )
}
