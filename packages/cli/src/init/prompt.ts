import { createInterface, type Interface } from 'node:readline/promises'

export type Choice<T> = {
  value: T
  label: string
  hint?: string
  /** Preselected in a multi-select, and the default in a single select. */
  selected?: boolean
  /** Shown, but cannot be turned off — a hard dependency of another answer. */
  locked?: boolean
}

export type Prompter = {
  interactive: boolean
  text(question: string, initial: string): Promise<string>
  confirm(question: string, initial: boolean): Promise<boolean>
  multiselect<T>(question: string, choices: Choice<T>[]): Promise<T[]>
  note(message: string): void
  close(): void
}

/**
 * A prompt layer with no dependencies and no raw-mode cursor handling.
 *
 * Multi-select is numbered input rather than a space-bar checklist. That is a
 * deliberate trade: an arrow-key UI needs raw mode, ANSI redraws and a
 * TTY-resize handler, and it degrades badly over SSH, inside CI shells and in
 * editor-embedded terminals. Typing `1,3` works everywhere, including places a
 * checklist silently eats input.
 */
export type PromptStreams = {
  input: NodeJS.ReadableStream
  output: NodeJS.WritableStream
}

/**
 * Streams are injectable so the interactive path can be driven in a test.
 * Without that seam the only tested prompter is the one that never asks
 * anything, which is the half that cannot go wrong.
 */
export function createPrompter(
  interactive: boolean,
  streams?: PromptStreams
): Prompter {
  if (!interactive) return nonInteractivePrompter()

  const rl = createInterface({
    input: streams?.input ?? process.stdin,
    output: streams?.output ?? process.stdout,
  })

  // Everything the prompter prints goes to the same place its questions do.
  const write = streams
    ? (line: string) => void streams.output.write(`${line}\n`)
    : (line: string) => console.log(line)

  return interactivePrompter(rl, write)
}

function interactivePrompter(
  rl: Interface,
  write: (line: string) => void
): Prompter {
  return {
    interactive: true,

    async text(question, initial) {
      const answer = (
        await rl.question(`${question} ${dim(`(${initial})`)} `)
      ).trim()
      return answer || initial
    },

    async confirm(question, initial) {
      const hint = initial ? 'Y/n' : 'y/N'
      const answer = (await rl.question(`${question} ${dim(`(${hint})`)} `))
        .trim()
        .toLowerCase()

      if (!answer) return initial
      return answer.startsWith('y')
    },

    async multiselect(question, choices) {
      write(`\n${bold(question)}`)
      choices.forEach((choice, index) => {
        const mark = choice.locked ? '•' : choice.selected ? '✓' : ' '
        const number = choice.locked ? '  ' : String(index + 1).padStart(2)
        write(
          `  ${number} [${mark}] ${choice.label}${choice.hint ? ` ${dim(choice.hint)}` : ''}`
        )
      })

      const preselected = choices
        .map((choice, index) =>
          choice.selected && !choice.locked ? index + 1 : 0
        )
        .filter(Boolean)
        .join(',')

      const answer = (
        await rl.question(
          `  ${dim(`numbers, comma-separated · "all" · "none" · enter for [${preselected || 'none'}]`)}\n  > `
        )
      ).trim()

      return resolveSelection(choices, answer)
    },

    note(message) {
      write(message)
    },

    close() {
      rl.close()
    },
  }
}

/**
 * Used for `--yes`, and whenever stdin is not a TTY.
 *
 * It answers with the defaults and *prints what it chose*. A wizard that
 * silently picks for you in CI is how a scaffold ends up wrong in a way nobody
 * notices until the build.
 */
function nonInteractivePrompter(): Prompter {
  return {
    interactive: false,

    async text(question, initial) {
      console.log(`${question} ${dim(`→ ${initial}`)}`)
      return initial
    },

    async confirm(question, initial) {
      console.log(`${question} ${dim(`→ ${initial ? 'yes' : 'no'}`)}`)
      return initial
    },

    async multiselect(question, choices) {
      const chosen = choices.filter(
        (choice) => choice.selected || choice.locked
      )
      console.log(
        `${question} ${dim(`→ ${chosen.map((c) => c.label).join(', ') || 'none'}`)}`
      )
      return chosen.map((choice) => choice.value)
    },

    note(message) {
      console.log(message)
    },

    close() {},
  }
}

/** Exported for its own test: the parsing is where this would go wrong. */
export function resolveSelection<T>(choices: Choice<T>[], answer: string): T[] {
  const locked = choices.filter((choice) => choice.locked).map((c) => c.value)
  const normalized = answer.trim().toLowerCase()

  if (!normalized) {
    return [
      ...locked,
      ...choices
        .filter((choice) => choice.selected && !choice.locked)
        .map((choice) => choice.value),
    ]
  }

  if (normalized === 'all') {
    return choices.map((choice) => choice.value)
  }

  if (normalized === 'none') return locked

  const picked = new Set<number>()
  for (const part of normalized.split(/[\s,]+/)) {
    const index = Number(part)
    // Out-of-range and non-numeric entries are ignored rather than fatal: the
    // confirmation step shows exactly what was understood, so a typo costs one
    // "n" instead of restarting the wizard.
    if (Number.isInteger(index) && index >= 1 && index <= choices.length) {
      picked.add(index - 1)
    }
  }

  return [
    ...locked,
    ...choices
      .filter((choice, index) => picked.has(index) && !choice.locked)
      .map((choice) => choice.value),
  ]
}

const isTty = () => Boolean(process.stdin.isTTY && process.stdout.isTTY)
const noColor = () => Boolean(process.env.NO_COLOR) || Boolean(process.env.CI)

export function shouldPromptInteractively(): boolean {
  return isTty() && !process.env.CI
}

export function bold(text: string): string {
  return noColor() ? text : `\x1b[1m${text}\x1b[0m`
}

export function dim(text: string): string {
  return noColor() ? text : `\x1b[2m${text}\x1b[0m`
}

export function cyan(text: string): string {
  return noColor() ? text : `\x1b[36m${text}\x1b[0m`
}

export function green(text: string): string {
  return noColor() ? text : `\x1b[32m${text}\x1b[0m`
}

export function yellow(text: string): string {
  return noColor() ? text : `\x1b[33m${text}\x1b[0m`
}
