import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { DriverEvent, DriverPromptOptions } from './types.js'

// The pieces every driver session needs but that are not agent-specific: emitting events
// without letting a listener throw into the agent, folding the session + per-call signals and
// framing, the prompt as the agent is sent it, reading a workspace file, and the words an event
// gives a tool call (its argument, what it printed, the lines it changed). The agent-specific
// parts (argv, the output parser, how framing is delivered) stay in each driver; these do not,
// so a second driver reuses them rather than copying them.

/**
 * A {@link DriverStartOptions.onEvent} caller that never lets a listener throw into the
 * driver — a throwing UI handler must not abort the agent. An absent `onEvent`
 * is a no-op. `driver` names it in the swallow log so a thrown handler stays traceable.
 */
export function makeEmit(onEvent: ((event: DriverEvent) => void) | undefined, driver: string): (event: DriverEvent) => void {
  if (!onEvent) return () => {}
  return event => {
    try {
      onEvent(event)
    } catch (err) {
      console.error(`${driver} onEvent threw; ignoring:`, err)
    }
  }
}

/** What a caller says around a prompt ({@link DriverPromptOptions}): the text handed over with it, the sentence added after it. */
export type PromptExtras = Pick<DriverPromptOptions, 'attached' | 'added'>

/** What the agent is sent: the prompt, then the caller's attached text, then its added sentence, each after an empty line when there is one. */
export function promptSent(prompt: string, extras: PromptExtras): string {
  return [prompt, extras.attached, extras.added].filter(part => part !== undefined).join('\n\n')
}

/** The `start` event of a prompt: the prompt as written, the attached text and the added sentence named apart. */
export function startEvent(prompt: string, extras: PromptExtras): Extract<DriverEvent, { type: 'start' }> {
  return { type: 'start', prompt, ...(extras.attached !== undefined ? { attached: extras.attached } : {}), ...(extras.added !== undefined ? { added: extras.added } : {}) }
}

/** The live AbortSignals for a prompt — the session's and the per-call one, minus the absent. */
export function combineSignals(...signals: (AbortSignal | undefined)[]): AbortSignal[] {
  return signals.filter((s): s is AbortSignal => s != null)
}

/** Fold a session's framing and a per-call system prompt into one blank-line-separated block. */
export function combineFraming(...parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join('\n\n')
}

/** Read a workspace file relative to the session cwd — the driver's `readCode`. */
export function readWorkspaceFile(cwd: string, path: string): Promise<string> {
  return readFile(resolve(cwd, path), 'utf8')
}

/** How long a tool call's detail may be: enough for a long command, short enough to keep the diary lean. */
const DETAIL_MAX = 200

/** A tool call's detail as a driver emits it: flattened to one line and cut to 200 characters. */
export function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > DETAIL_MAX ? flat.slice(0, DETAIL_MAX - 1) + '…' : flat
}

/**
 * How many characters of a tool call's output are kept. An output is a diary line, and the diary
 * is copied onto the run's record: the limit keeps a run of many calls a small file.
 */
export const OUTPUT_MAX = 4000

/**
 * What a tool call printed, as a driver emits it: whole when it fits in {@link OUTPUT_MAX}
 * characters, else its first half-limit and its last half-limit, with one line between them saying
 * how many characters were cut. The start says what ran and the end says how it went.
 */
export function cutOutput(text: string): string {
  const whole = text.replace(/\s+$/, '')
  if (whole.length <= OUTPUT_MAX) return whole
  const half = OUTPUT_MAX / 2
  return `${whole.slice(0, half)}\n… ${whole.length - OUTPUT_MAX} characters cut …\n${whole.slice(-half)}`
}

/**
 * The parts of an `action` event that say what the call was given: `detail`, the argument on one
 * line and cut short, and `whole`, the argument as it was given (cut as an output is), only when
 * `detail` is not all of it.
 */
export function callArgument(argument: string | undefined): { detail?: string; whole?: string } {
  if (argument === undefined || argument.trim() === '') return {}
  const detail = oneLine(argument)
  const whole = cutOutput(argument.trim())
  return whole === detail ? { detail } : { detail, whole }
}

/** How many lines a text holds: a last line with no line break counts, an empty text holds none. */
export function lineCount(text: string): number {
  if (text === '') return 0
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
}

/**
 * The lines a patch adds and removes, off the lines of its hunks: one that starts with `+` is
 * added, one with `-` removed, whatever the rest of it is (a removed `-- note` reads `--- note`).
 * The file headers of a unified diff are no hunk's lines: {@link hunkLines} leaves them out.
 */
export function patchSize(lines: readonly string[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const line of lines) {
    if (line.startsWith('+')) added++
    else if (line.startsWith('-')) removed++
  }
  return { added, removed }
}

/**
 * The lines of a unified diff's hunks: all that follows its first `@@` line. What is before it is
 * the diff's file headers (`--- a/x`, `+++ b/x`), which read like a removed and an added line.
 * `undefined` for a text that is no unified diff: one whose first line is neither a hunk's `@@`
 * nor a header.
 */
export function hunkLines(diff: string): string[] | undefined {
  const lines = diff.split('\n')
  if (!/^(@@|--- |\+\+\+ |diff |index )/.test(lines[0] ?? '')) return undefined
  const first = lines.findIndex(line => line.startsWith('@@'))
  return first === -1 ? undefined : lines.slice(first)
}
