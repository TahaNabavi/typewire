import { Fragment } from 'react'

/**
 * Colouring for the one place on the site where code is not known at build
 * time: the playground's payload viewer, which shows whatever the request
 * actually returned.
 *
 * Shiki is not an option here — it runs on the server, and this text only
 * exists after a click. JSON is small enough to tokenise with one regex, and
 * the output is built as React nodes rather than an HTML string, so a payload
 * can never inject markup into the page.
 *
 * The colours match `lib/highlight.ts`, so a response body reads the same as
 * the contract that declared it.
 */

const TOKEN =
  /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g

export function JsonView({
  text,
  className,
}: {
  text: string
  className?: string
}) {
  // Not JSON — an error message, or a plain string payload. Leave it alone.
  if (!text.trimStart().startsWith('{') && !text.trimStart().startsWith('[')) {
    return <span className={className}>{text}</span>
  }

  const parts: React.ReactNode[] = []
  let last = 0
  let match: RegExpExecArray | null

  TOKEN.lastIndex = 0
  while ((match = TOKEN.exec(text)) !== null) {
    const [raw, string, colon, literal, number] = match

    if (match.index > last) {
      parts.push(
        <Fragment key={`t${last}`}>{text.slice(last, match.index)}</Fragment>
      )
    }

    if (string !== undefined && colon !== undefined) {
      // A string in key position is a property name, not a value.
      parts.push(
        <Fragment key={match.index}>
          <span className="text-[#cbd5e1]">{string}</span>
          <span className="text-dim">{colon}</span>
        </Fragment>
      )
    } else if (string !== undefined) {
      parts.push(
        <span key={match.index} className="text-green">
          {string}
        </span>
      )
    } else {
      parts.push(
        <span key={match.index} className="text-amber">
          {literal ?? number}
        </span>
      )
    }

    last = match.index + raw.length
  }

  if (last < text.length)
    parts.push(<Fragment key="tail">{text.slice(last)}</Fragment>)

  return <span className={className}>{parts}</span>
}
