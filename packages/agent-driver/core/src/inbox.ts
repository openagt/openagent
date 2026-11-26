import { appendFile, mkdir, readFile, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { continuationPrompt } from '@openagt/hooks'
import { promptSent } from './session-support.js'
import { isImageName } from './images.js'
import type { DriverPromptOptions, DriverSession, DriverTurn, InboxLine, PromptLine, Question } from '@openagt/hooks'

/**
 * The inbox: what reaches a running agent from outside, a file at a path the caller gives, one
 * JSON line per message or answer. Whoever shows the agent (a dashboard) appends lines. While a
 * turn runs, the driver reads them as they come (`cli-session.ts`) and hands each message to
 * the agent at once, which reads it between two of its steps, as Claude Code's own chat does; a
 * message sent for later, or one the agent could not take, waits for the turn's end. When a turn
 * ends, the driver sends what waits as the next prompts of the same session, in order, until the
 * file is empty. Then the prompt returns and the run ends: no process waits for a line that may
 * never come. A line written later is for a new run that resumes the session by its id.
 *
 * Taking the lines is rename-then-read: the file is moved aside in one step, so a line appended
 * meanwhile lands in a fresh file for the next take and none is lost or read twice.
 */


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
  if (v['kind'] === 'message') return typeof v['text'] === 'string' && v['text'].trim().length > 0 && (v['publish'] === undefined || typeof v['publish'] === 'string') && (v['id'] === undefined || typeof v['id'] === 'string') && (v['images'] === undefined || (Array.isArray(v['images']) && v['images'].every(isImageName))) && (v['options'] === undefined || (typeof v['options'] === 'object' && v['options'] !== null && !Array.isArray(v['options'])))
  if (v['kind'] === 'answer') return typeof v['question'] === 'string' && typeof v['answer'] === 'string'
  if (v['kind'] === 'cancel') return typeof v['id'] === 'string'
  return v['kind'] === 'now'
}

/**
 * The prompts lines make once no turn runs: messages and answers, in order, less every message a
 * later line took back. Taking back and hurrying act on a turn that runs; with none, they are done.
 */
export function promptLines(lines: readonly InboxLine[]): PromptLine[] {
  const cancelled = new Set(lines.flatMap(line => (line.kind === 'cancel' ? [line.id] : [])))
  return lines.filter((line): line is PromptLine => line.kind === 'answer' || (line.kind === 'message' && (line.id === undefined || !cancelled.has(line.id))))
}

/**
 * What a message the person sent while a turn runs is sent as: their words and the sentence after
 * them the caller says it goes with ({@link DriverPromptOptions.onInboxLine}), as the same message
 * sent after the turn would be.
 */
export async function steeredWords(line: Extract<InboxLine, { kind: 'message' }>, sent: DriverPromptOptions): Promise<string> {
  const { attached: _attached, images: _images, ...rest } = sent
  const further = sent.onInboxLine ? await sent.onInboxLine(line, rest) : rest
  return promptSent(line.text, further)
}

/** The images an inbox line goes with, as a prompt's options name them: none for a line without. */
export function imagesOf(line: PromptLine): Pick<DriverPromptOptions, 'images'> {
  return line.kind === 'message' && line.images !== undefined && line.images.length > 0 ? { images: line.images } : {}
}

/** The prompt one inbox line becomes. */
export function promptOf(line: PromptLine): string {
  return line.kind === 'message' ? line.text : continuationPrompt(line.question, line.answer)
}

/**
 * The end of a turn, for every driver: the question the turn ended on, asked with the agent's own
 * tool or written in its message as the caller reads one (`questionIn`), is reported as an event,
 * and the inbox, when the prompt names one, is drained into further turns of the same session.
 * Resolves with the last turn.
 */
export async function finishTurn(
  session: DriverSession,
  turn: DriverTurn,
  opts: DriverPromptOptions,
  emit: (event: { type: 'question'; question: Question }) => void,
): Promise<DriverTurn> {
  const question = turn.question ?? opts.questionIn?.(turn.text)
  if (question) emit({ type: 'question', question })
  // A turn stopped on purpose goes no further: what reached it meanwhile is the person's to send again.
  if (!opts.inbox || turn.stopped) return turn
  let last = turn
  // What was handed over with the prompt went with it alone: a line from the inbox carries none of it, but its own images.
  const { attached: _attached, images: _images, ...rest } = opts
  let further: DriverPromptOptions = rest
  for (const line of promptLines([...(turn.held ?? []), ...(await takeInbox(opts.inbox))])) {
    // The caller says what the line changes, for it and the lines after it, and what it hands over with this one line alone.
    const { attached, ...carried } = opts.onInboxLine ? await opts.onInboxLine(line, further) : further
    further = carried
    last = await session.prompt(promptOf(line), { ...further, ...(attached !== undefined ? { attached } : {}), resume: true, ...imagesOf(line) })
  }
  return last
}

/**
 * The repos a message gives the session, by their folders: the ones its options name (the session
 * box's Repos), which the run copies into the session's folder; the ones it has already add nothing.
 */
export function givenRepos(line: PromptLine): string[] {
  if (line.kind !== 'message') return []
  const repos = line.options?.['git-branches']?.repos
  return Array.isArray(repos) ? repos.flatMap(repo => (typeof repo?.from === 'string' && repo.from.trim() !== '' ? [repo.from] : [])) : []
}
