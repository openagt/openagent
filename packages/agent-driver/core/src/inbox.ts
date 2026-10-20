import { appendFile, mkdir, readFile, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { DriverPromptOptions, DriverSession, DriverTurn } from './types.js'
import { continuationPrompt, parseQuestion } from './question.js'

/**
 * The inbox: what reaches a running agent from outside, a file at a path the caller gives, one
 * JSON line per message or answer. Whoever shows the agent (a dashboard) appends lines; the
 * driver reads them when a turn ends and sends each as the next prompt of the same session, in
 * order, until the file is empty. Then the prompt returns and the run ends: no process waits
 * for a line that may never come. A line written later is for a new run that resumes the
 * session by its id.
 *
 * Taking the lines is rename-then-read: the file is moved aside in one step, so a line appended
 * meanwhile lands in a fresh file for the next take and none is lost or read twice.
 */

/** One line of the inbox. */
export type InboxLine =
  /**
   * The user's own words to the agent. `publish` is how far the run takes its work from this
   * message on, in the words of the tool that runs it, which reads it (`agent-runner`'s levels, or
   * `nothing`): a driver sends the words alone.
   */
  | { kind: 'message'; text: string; publish?: string }
  /** The user's answer to the question the agent stopped on: the question's title and the chosen label or labels. */
  | { kind: 'answer'; question: string; answer: string }

/** Append one line to an inbox, creating the file and its directory as needed. */
export async function appendInbox(path: string, line: InboxLine): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await appendFile(path, JSON.stringify(line) + '\n')
}

/** Take every line waiting in the inbox, in order, leaving the inbox empty; none when there is no inbox. */
export async function takeInbox(path: string): Promise<InboxLine[]> {
  const taking = `${path}.taking-${process.pid}-${Date.now()}`
  try {
    await rename(path, taking)
  } catch {
    return []
  }
  const raw = await readFile(taking, 'utf8').catch(() => '')
  await rm(taking, { force: true }).catch(() => {})
  const lines: InboxLine[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line) as InboxLine
      if (isInboxLine(parsed)) lines.push(parsed)
    } catch {
      // A torn line is skipped: a bad write must never end a run.
    }
  }
  return lines
}

function isInboxLine(value: unknown): value is InboxLine {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (v['kind'] === 'message') return typeof v['text'] === 'string' && v['text'].trim().length > 0 && (v['publish'] === undefined || typeof v['publish'] === 'string')
  if (v['kind'] === 'answer') return typeof v['question'] === 'string' && typeof v['answer'] === 'string'
  return false
}

/** The prompt one inbox line becomes. */
export function promptOf(line: InboxLine): string {
  return line.kind === 'message' ? line.text : continuationPrompt(line.question, line.answer)
}

/**
 * The end of a turn, for every driver: the question the turn ended on is reported as an event,
 * and the inbox, when the prompt names one, is drained into further turns of the same session.
 * Resolves with the last turn.
 */
export async function finishTurn(
  session: DriverSession,
  turn: DriverTurn,
  opts: DriverPromptOptions,
  emit: (event: { type: 'question'; question: NonNullable<ReturnType<typeof parseQuestion>> }) => void,
): Promise<DriverTurn> {
  const question = parseQuestion(turn.text)
  if (question) emit({ type: 'question', question })
  if (!opts.inbox) return turn
  let last = turn
  // What was handed over with the prompt went with it alone: a line from the inbox carries none of it.
  const { attached: _attached, ...rest } = opts
  let further: DriverPromptOptions = rest
  for (const line of await takeInbox(opts.inbox)) {
    // The caller says what the line changes, for it and the lines after it.
    if (opts.onInboxLine) further = await opts.onInboxLine(line, further)
    last = await session.prompt(promptOf(line), { ...further, resume: true })
  }
  return last
}
