import type { AgentDoing, AgentMeta, ChoiceRequest, OpenAgentEvent } from '../../src/index.js'
import { foldScreenRows, formatOpenAgentEvent } from '../../src/client.js'
import { parseQuestion, QUESTION_TAG } from '@openagt/agent-driver/question'
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Check, ChevronRight, Copy, PencilLine } from 'lucide-react'
import { pendingChoices } from '../lib/live-state.js'
import { callRow, callSubagents, isAgentsOwn, runRow, endMessage, subagentEnd, subagentEvents, subagentReport, subagentSteps, subagentWait, type SubagentEnd } from '../lib/subagents.js'
import { answeredQuestion } from '../lib/answered-question.js'
import { rowWords, type RowWords } from '../lib/row-words.js'
import { formatAge } from '../lib/format-date.js'
import { AnsweredChoice } from './AnsweredChoice.js'
import { QuestionPanel } from './QuestionPanel.js'
import { Markdown } from './Markdown.js'
import { SessionLine, sessionLineEmpty, type SessionSetup } from './SessionLine.js'
import { ChangedFiles } from './ChangedFiles.js'
import { turnChanges, type ChangedFile } from '../lib/turn-changes.js'
import { SubagentMessage, SubagentSteps } from './SubagentLine.js'
import { useSteadyText, useStillWriting } from '../lib/use-steady-text.js'
import { Caret, LiveLine, ToolCalls, type CallOutput, type ToolStep } from './ToolCalls.js'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip.js'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from './ui/message-scroller.js'

// Presentational event log, shared by the live stream and past-run replay. Most events render as
// their human-readable line (the same formatter the terminal uses, so a `driver` turn reads
// "· Read  src/app.ts" rather than raw JSON). Some things get special rows:
//   - The message text: the user's prompt (`driver` `start`) and the agent's reply (`driver` `text`)
//     render their raw text inline, truncated to one line when long and expanding in place on click
//     (#476/#520). The user's own prompt is a grey box on the right, as in a chat.
//   - The agent's steps between two messages (`driver` `action` and `thought`): one folded line
//     for the whole run of them (ToolCalls), opening to one line per step.
//   - Choice gates, when the log knows its project: an open gate is the question's card, answered
//     in place (QuestionPanel), when the log knows its agent too; a resolved one collapses to the
//     AnsweredChoice ✓ card and hides its "✓ chose" line.
//   - Screens: the newest open `screen` line at an address, before the run's end, is live: its
//     line opens the pane that shows the screen. An earlier one stays its one
//     line of text, and an `ended` one is hidden.
//   - A turn's end and the spend so far are not rows, and neither is a clean end or an end waiting
//     on an answer: the agent's last message, or its question, is how such a turn ends. A stopped
//     or failed end is a row.
//   - The reply a question follows is shown whole: it is what the question asks about.
//   - Subagents, of both kinds: the runs started for this one, read off their cards, and the ones
//     the coding agent started inside its session, read off the log's `subagent` events. The ones
//     started together are one group where the first was started, each a row that opens the
//     subagent beside the chat; the call that started one, and everything it said and did, are its
//     own and no row here. The prompt that told the run a subagent ended is a subagent's row too,
//     not a message of the user's.
// The rows sit in one centered column, as a chat's do, with no label saying each row's kind: the
// user's turn is a box on the right, and every other row says what it is. The first of a run of
// same-kind rows carries the time its diary line was written, shown while the pointer is on the
// row, the same live, reloaded or replayed; a line written with no time shows none. Scrolling
// rides shadcn's Base UI message-scroller (#712): live follows the edge (`autoScroll`) but yields
// the moment the reader scrolls up, replay renders static from the top, and the "Jump to latest"
// chip is the scroller's own inert-when-not-scrollable button.

// The conversation text — the user's prompt and the agent's reply. Both are rendered as Markdown:
// the agent writes in Markdown, and a prompt may too.
function messageText(e: OpenAgentEvent): string | null {
  if (e.kind !== 'driver') return null
  if (e.event.type === 'start') return e.event.prompt
  if (e.event.type === 'text') return e.event.text
  return null
}

/** Grouping key for a run of same-kind rows: the user's prompt stands apart from the agent's work. */
function rowGroup(e: OpenAgentEvent): string {
  if (e.kind === 'driver') return e.event.type === 'start' || e.event.type === 'steered' ? 'you' : 'agent'
  return e.kind
}

/** A message the person sent while the agent worked, as it landed between two of its steps: theirs, in the turn. */
function steeredText(e: OpenAgentEvent): string | undefined {
  return e.kind === 'driver' && e.event.type === 'steered' ? e.event.text : undefined
}

/** The later of two times, either one absent. */
function later(a: string | undefined, b: string | undefined): string | undefined {
  if (a === undefined || b === undefined) return a ?? b
  return Date.parse(a) >= Date.parse(b) ? a : b
}

/** A driver `start` opens a fresh prompt turn. */
function isTurnBoundary(e: OpenAgentEvent): boolean {
  return e.kind === 'driver' && e.event.type === 'start'
}

/**
 * Whether a row reports a failure, which reads in red (#1199). Two shapes say it: the agent (or
 * its transport) erroring mid-run, and the agent settling badly. A *stopped* run is neither, since
 * the user asked for that, and neither is a run *waiting* on the question it ended on (#1774): both
 * stay neutral rather than being coloured like a fault.
 */
function isFailure(e: OpenAgentEvent): boolean {
  if (e.kind === 'driver') return e.event.type === 'error'
  // An error the agent reported itself (#1500) is a failure like any other: the log already has
  // one red lane, and a second vocabulary for the same thing would only make both quieter.
  if (e.kind === 'error') return true
  return e.kind === 'end' && !e.ok && !e.stopped && !e.waiting
}

/** The row's colour: a failure is red (#1199), and everything else keeps the muted log tone. */
function rowTone(e: OpenAgentEvent): string {
  return isFailure(e) ? 'text-danger' : ''
}

/**
 * The row's BACKGROUND wash (#1508): a tint across the whole line, findable from the scrollbar's
 * distance.
 * Only the rows the eye actually hunts for get one — failures (the reader's own turns are boxes
 * already) — and at a whisper of alpha, so the
 * text keeps the contrast and the bulk of the log stays plain canvas.
 */
function rowWash(e: OpenAgentEvent): string {
  return isFailure(e) ? 'bg-danger/10' : ''
}

/**
 * Hoist the agent's first prompt to the top of the log (#1170).
 *
 * It is emitted after the `session` event, so the one line the reader wrote themselves opened
 * under a row they did not write.
 * Only the *first* prompt moves: a later turn is part of the conversation and belongs where it
 * happened. The rows it jumps keep their order, so the log reads as "what I asked, then
 * everything that followed".
 */
function promptFirst(events: OpenAgentEvent[]): OpenAgentEvent[] {
  const at = events.findIndex(isTurnBoundary)
  if (at <= 0) return events
  return [events[at]!, ...events.slice(0, at), ...events.slice(at + 1)]
}

/** HH:MM:SS in the reader's locale, for the column that says when each line was written. */
function formatTime(at: string): string {
  return new Date(at).toLocaleTimeString()
}

/**
 * A question the person did not answer in its card but wrote a message instead of: one grey line,
 * as Claude Code on the web folds it, `Asked "Background"  Replied in chat`, opening to the question.
 * Named by its header, else by the question itself.
 */
function PassedChoice({ choice, footer }: { choice: ChoiceRequest; footer?: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="min-w-0 flex-1 font-sans text-sm text-muted-foreground">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="flex max-w-full min-w-0 items-center gap-1.5 py-0.5 text-left hover:text-foreground">
        <span className="truncate">Asked “{choice.header ?? choice.title}”</span>
        <span className="shrink-0">Replied in chat</span>
        <Caret open={open} />
      </button>
      {open && (
        <div className="mt-1.5 flex flex-col gap-1.5">
          <div>{choice.title}</div>
          {footer}
        </div>
      )}
    </div>
  )
}

/** A question's row: answered through its gate (`pick`), passed by with a message instead (`passed`), or still waiting for its answer. */
type ChoiceRow = { choice: ChoiceRequest; pick?: string | readonly string[]; passed?: true }

/**
 * Fold the log's choice traffic: which gates are a ✓ card, and which lines are no row.
 *
 * Only the LAST firing of a gate id is special — `pendingChoices` replaces a re-fired gate in
 * place, so an earlier firing is history and keeps its text. An open gate (no resolution, no
 * `end` after it) is the question's card, asked in the flow. A resolved one collapses to the ✓ card, and the
 * `choice-resolved` line that told its story is hidden — the card says it better. One answered by
 * the prompt that resumed the agent is no row: that prompt is drawn as the question and its answer. A gate closed by `end` without an answer (#1359: its audience is gone) stays text —
 * a control nobody reads must not look answerable. Earlier firings' "✓ chose" lines stay put:
 * they are the only record of a superseded decision.
 */
function foldChoiceRows(events: OpenAgentEvent[]): {
  rows: Map<OpenAgentEvent, ChoiceRow>
  hidden: Set<OpenAgentEvent>
} {
  const rows = new Map<OpenAgentEvent, ChoiceRow>()
  const hidden = new Set<OpenAgentEvent>()
  const lastFiring = new Map<string, { e: OpenAgentEvent; at: number }>()
  const lastResolved = new Map<string, { e: Extract<OpenAgentEvent, { kind: 'choice-resolved' }>; at: number }>()
  events.forEach((e, at) => {
    if (e.kind === 'choice') lastFiring.set(e.id, { e, at })
    else if (e.kind === 'choice-resolved') lastResolved.set(e.id, { e, at })
  })
  // A question answered in its card: every firing of it, not only the last. A local agent's
  // questions all share one id, so an earlier question is an earlier firing.
  const answered = new Set(events.flatMap(e => (isTurnBoundary(e) ? [answeredQuestion((e as { event: { prompt: string } }).event.prompt)?.question] : [])))
  for (const e of events) if (e.kind === 'choice' && answered.has(e.title)) hidden.add(e)
  const open = new Set(pendingChoices(events).map(c => c.id))
  for (const [id, firing] of lastFiring) {
    if (hidden.has(firing.e)) continue
    const { kind: _kind, ...choice } = firing.e as { kind: 'choice' } & ChoiceRequest
    const resolved = lastResolved.get(id)
    if (open.has(id)) {
      rows.set(firing.e, { choice })
    } else if (resolved && resolved.at > firing.at) {
      // A resolution from BEFORE this firing answered an earlier gate, not this one — a gate
      // re-fired and then closed by `end` must not wear a pick it never received.
      rows.set(firing.e, { choice, pick: resolved.e.picked })
      hidden.add(resolved.e)
    } else if (events.slice(firing.at + 1).some(isTurnBoundary)) {
      // Not answered in its card: the person wrote a message instead.
      rows.set(firing.e, { choice, passed: true })
    }
  }
  return { rows, hidden }
}

/**
 * The question a turn ends on, the moment its message is written. The run says it only when the
 * agent's process is done, about a second later, and until then the message would show its block
 * as raw JSON. Read with the run's own parser, so it is the same question under the same id, and
 * the run's own line of it takes its place without a change. Only a turn's last message, with
 * nothing after it: a block the agent went on from is not what the run will ask.
 */
export function withEarlyQuestion(events: OpenAgentEvent[]): OpenAgentEvent[] {
  for (let at = events.length - 1; at >= 0; at--) {
    const e = events[at]!
    if (e.kind === 'choice' || e.kind === 'end' || isTurnBoundary(e)) return events
    if (e.kind !== 'driver' || ('subagent' in e.event && e.event.subagent !== undefined)) continue
    if (e.event.type === 'action') return events
    // A message with no words (Codex ends some turns with one) is not the turn's last word.
    if (e.event.type !== 'text' || e.event.text.trim() === '') continue
    const question = parseQuestion(e.event.text)
    if (question === undefined) return events
    const asked: OpenAgentEvent = { kind: 'choice', id: QUESTION_TAG, ...question }
    return [...events.slice(0, at + 1), asked, ...events.slice(at + 1)]
  }
  return events
}

/**
 * The ends that are no row: a clean one, one waiting on an answer, and one the person stopped. The
 * agent's last message is how a clean turn ends, and the question's card is how a waiting one does;
 * a line under them said it twice. A stopped one just ends where the person stopped it, as Claude
 * Code's chat shows it, with nothing after. A failed end is a row where it happened: it says why
 * the agent is not going on, and why the next prompt was needed.
 */
export function quietEnds(events: readonly OpenAgentEvent[]): Set<OpenAgentEvent> {
  return new Set(events.filter(e => e.kind === 'end' && (e.ok || e.waiting || e.stopped)))
}

/**
 * The replies a question follows: the agent's last message before each question it stopped on.
 * It is what the question is about (a plan to approve), so it is shown whole, not folded.
 */
export function askedReplies(events: readonly OpenAgentEvent[]): Set<OpenAgentEvent> {
  const asked = new Set<OpenAgentEvent>()
  let reply: OpenAgentEvent | undefined
  for (const e of events) {
    if (isTurnBoundary(e)) reply = undefined
    else if (e.kind === 'driver' && e.event.type === 'text') reply = e
    else if (e.kind === 'choice' && reply) asked.add(reply)
  }
  return asked
}

/**
 * A reply without the block its question is written in (the fenced `await-choices` block, JSON):
 * the question's card, the row under the reply, shows the question. A block still being written
 * has no closing fence yet and goes too, so the JSON never scrolls by while the agent types it.
 */
export function withoutQuestionBlock(text: string): string {
  return text.replace(/```await-choices\b[\s\S]*?(```|$)/g, '').trim()
}

// The agent's reply: whole, as Markdown, in the page's own font rather than the log's. The message
// being written is drawn the same way, so the finished message takes its place without a jump: a
// reply used to grow tall as it was written and fold to one line the moment it was done.
/**
 * The message being written, word by word at a steady pace, as Claude Code on the web writes one:
 * what the agent sends comes in chunks, and a chunk dropped in at once reads as a jolt. It stays close
 * behind, so the whole message that takes its place at the end changes nothing to speak of.
 */
function Writing({ text }: { text: string }) {
  const { shown } = useSteadyText(text, true, false)
  return (
    <div className="min-w-0 flex-1 font-sans text-foreground">
      <Markdown text={shown} fade />
    </div>
  )
}

/** A message whole; one that was being written goes on at the same pace until it is all there. One that came whole is shown whole, as Claude Code on the web shows one. */
function Reply({ text }: { text: string }) {
  const { shown, done } = useSteadyText(text, false)
  return (
    <div className="min-w-0 flex-1 font-sans text-foreground">
      <Markdown text={shown} fade={!done} />
    </div>
  )
}

/** A button that copies a message, as Claude Code on the web has one under each message: a check for a beat once copied, then the copy icon again. */
function CopyMessage({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <button
      type="button"
      aria-label={copied ? 'Copied' : 'Copy this message'}
      title={copied ? 'Copied' : 'Copy this message'}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(
          () => {
            setCopied(true)
            clearTimeout(timer.current)
            timer.current = setTimeout(() => setCopied(false), 1500)
          },
          () => undefined,
        )
      }}
      className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground"
    >
      {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
    </button>
  )
}

/** How long ago a message was said, small and grey, the whole time on hover. */
function Age({ at }: { at: string }) {
  return (
    <time dateTime={at} title={new Date(at).toLocaleString()} className="px-1 text-[11px]">
      {formatAge(at)}
    </time>
  )
}

/**
 * Under the agent's last message of a turn it finished: a button that copies it, and how long ago
 * it was said, as Claude Code on the web puts them under its messages. Shown while the pointer is
 * anywhere on the turn (`.turn-footer` in tailwind.css), or a key is in the footer; its line is
 * always there, so nothing moves when it shows.
 */
function ReplyFooter({ text, at }: { text: string; at?: string | undefined }) {
  return (
    <div className="turn-footer flex h-6 items-center gap-1 font-sans text-muted-foreground opacity-0 transition-opacity focus-within:opacity-100">
      <CopyMessage text={text} />
      {at !== undefined && <Age at={at} />}
    </div>
  )
}

// More than this many lines, or this many characters, and the user's own message is cut short
// behind "Show more".
const PROMPT_LINES = 8
const PROMPT_CHARS = 600

function isTall(text: string): boolean {
  return text.length > PROMPT_CHARS || text.trim().split('\n').length > PROMPT_LINES
}

// A question and the answer the person gave it, in place of the sentence the agent was resumed
// with: a box as wide as the question's card was, the question and the answer under it in grey, as
// Claude Code on the web keeps an answered question. A skipped one says so where the answer would be.
function Answer({ question, answer }: { question: string; answer?: string | undefined }) {
  return (
    <div role="group" aria-label="Your answer" className="flex w-full max-w-[480px] flex-col gap-0.5 rounded-lg px-3 py-2 font-sans text-sm ring-1 ring-border">
      <div className="font-medium text-foreground">{question}</div>
      {answer !== undefined ? <div className="text-muted-foreground">{answer}</div> : <div className="italic text-muted-foreground">Skipped</div>}
    </div>
  )
}

// The row of a turn's files: 20px under what the agent said, as Claude Code puts its card of them.
const FILES_ROW = 'group/row -mx-1.5 mt-2 flex items-start gap-2 rounded-sm px-1.5'

// A turn's files, and under them the turn's copy and time when the turn ended on them.
function TurnFiles({ files, onOpen, footer }: { files: readonly ChangedFile[]; onOpen?: ((path?: string) => void) | undefined; footer?: { text: string; at: string | undefined } | undefined }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <ChangedFiles files={files} onOpen={onOpen} />
      {footer && <ReplyFooter text={footer.text} at={footer.at} />}
    </div>
  )
}

// The user's own message: a grey box on the right, as Markdown in the page's font. No label says
// whose it is; the place and the box do. A long one is cut short with "Show more" under it. The
// time it was sent sits under the box and shows while the pointer is on the message; its line is
// always there, so nothing moves when it shows.
// `waiting`: a message the working agent has not read yet, as Claude Code on the web shows one:
// under it, Send now, or "Queued" for one sent for after the turn, and on hover the copy and
// Cancel and edit, which takes it back into the box.
// `attached`: what the run handed the agent with this message, folded under the box.
// `fresh`: a message just sent, which slides in where it lands, as Claude Code on the web's does.
function Prompt({ text, at, waiting, attached, fresh = false }: { text: string; at?: string | undefined; waiting?: Waiting | undefined; attached?: string | undefined; fresh?: boolean }) {
  const [open, setOpen] = useState(false)
  const tall = isTall(text)
  return (
    <div className={`group/prompt flex min-w-0 flex-1 flex-col items-end font-sans text-foreground ${fresh ? 'bubble-in' : ''}`}>
      <div role="group" aria-label={waiting ? 'Your message, waiting' : 'Your message'} className="max-w-[85%] min-w-0 rounded-xl bg-muted px-3.5 py-2">
        <div className={tall && !open ? 'max-h-40 overflow-hidden' : ''}>
          <Markdown text={text} />
        </div>
        {tall && (
          <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="mt-1 text-xs text-muted-foreground hover:text-foreground">
            {open ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
      {attached !== undefined && <Attached text={attached} />}
      {/* When it was sent and a copy of it, as Claude Code on the web shows under a message, 6px
          below the box so a button's hover does not touch it. A waiting one says so instead of its time. */}
      <div className="mt-1.5 flex h-6 items-center gap-1 text-muted-foreground">
        <div className="flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover/prompt:opacity-100">
          {!waiting && at !== undefined && <Age at={at} />}
          <CopyMessage text={text} />
          {waiting?.onEdit && (
            <button type="button" aria-label="Cancel and edit message" title="Cancel and edit message" onClick={waiting.onEdit} className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground">
              <PencilLine className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </div>
        {waiting &&
          (waiting.later || !waiting.onSendNow ? (
            <span className="pr-1 text-[11px] leading-6">Queued</span>
          ) : (
            <button type="button" onClick={waiting.onSendNow} className="rounded-md px-1.5 text-[11px] leading-6 hover:bg-accent hover:text-accent-foreground">
              Send now
            </button>
          ))}
      </div>
    </div>
  )
}

/** A message the working agent has not read yet, and what can be done with it. */
export interface Waiting {
  /** Sent for after the turn (⌘Enter): "Queued", no Send now. */
  later: boolean
  /** Send now: the agent reads it at once. */
  onSendNow?: (() => void) | undefined
  /** Cancel and edit: it goes back into the box. */
  onEdit?: (() => void) | undefined
}

/** A waiting message, as the feed is given it. */
export interface WaitingMessage extends Waiting {
  id: string
  text: string
}

// What the run handed the agent with a message, after it: a scheduled run carries what its
// command's check printed. Folded, since it can be long; opened, the text shows as it was sent.
function Attached({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-1 flex max-w-[85%] min-w-0 flex-col items-end text-xs text-muted-foreground">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="flex items-center gap-1 hover:text-foreground">
        <span>Sent with this message</span>
        <ChevronRight className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden />
      </button>
      {open && <pre className="mt-1 max-h-80 w-full overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border px-3 py-2 text-left font-mono text-foreground">{text}</pre>}
    </div>
  )
}

/**
 * How far the turn going on has got, what the live line says beside its seconds: the tokens it went
 * through, said once it has answered something, as Claude Code on the web says them; before that,
 * the line is the dots and the seconds.
 */
function turnTokens(told: readonly OpenAgentEvent[]): number | undefined {
  let start = told.length
  while (start > 0 && !isTurnBoundary(told[start - 1]!)) start--
  const turn = told.slice(start)
  const said = turn.some(e => e.kind === 'driver' && e.event.type === 'text' && e.event.subagent === undefined)
  return said ? turn.flatMap(e => (e.kind === 'driver' && e.event.type === 'tokens' ? [e.event.tokens] : [])).at(-1) : undefined
}

/** A tool call or a thought of the coding agent: a step between two of its messages. */
function stepOf(e: OpenAgentEvent): ToolStep | undefined {
  return e.kind === 'driver' && (e.event.type === 'action' || e.event.type === 'thought') ? { ...e.event } : undefined
}

/** What a tool call gave back: no row and no step of its own, a part of its call. */
function outputOf(e: OpenAgentEvent): (CallOutput & { id: string }) | undefined {
  return e.kind === 'driver' && e.event.type === 'output' ? e.event : undefined
}

/**
 * Fold each run of the agent's steps (tool calls and thoughts with no other row between them)
 * into its first row, which stands for the whole run. A run with no call in it, thoughts alone,
 * is no row at all: the chat has no thinking row. What a call gave back (its `output` event, by
 * the call's id) is put on its call, wherever the call is. While the agent works (`live`), a call that is
 * the last event is the call going on now (`current`): it is not in its run yet, the chat's last
 * line says it.
 */
function foldSteps(
  events: readonly OpenAgentEvent[],
  live = false,
): { rows: OpenAgentEvent[]; steps: Map<OpenAgentEvent, ToolStep[]>; current?: Extract<ToolStep, { type: 'action' }> } {
  const last = events[events.length - 1]
  const going = live && last !== undefined ? stepOf(last) : undefined
  if (going?.type === 'action') return { ...foldSteps(events.slice(0, -1)), current: going }
  const rows: OpenAgentEvent[] = []
  const steps = new Map<OpenAgentEvent, ToolStep[]>()
  let run: { head: OpenAgentEvent; steps: ToolStep[] } | undefined
  const calls = new Map<string, Extract<ToolStep, { type: 'action' }>>()
  const close = (): void => {
    if (run?.steps.some(step => step.type === 'action')) {
      rows.push(run.head)
      steps.set(run.head, run.steps)
    }
    run = undefined
  }
  for (const e of events) {
    const output = outputOf(e)
    if (output) {
      const call = calls.get(output.id)
      if (call) call.output = { text: output.text, ...(output.failed ? { failed: true } : {}), ...(output.exitCode !== undefined ? { exitCode: output.exitCode } : {}), ...(output.changed ? { changed: output.changed } : {}) }
      continue
    }
    const step = stepOf(e)
    if (step?.type === 'action' && step.id !== undefined) calls.set(step.id, step)
    if (step === undefined) {
      close()
      rows.push(e)
    } else if (run) run.steps.push(step)
    else run = { head: e, steps: [step] }
  }
  close()
  return { rows, steps }
}

/**
 * A row the chat says in its own words (row-words.ts): what happened in grey, and the thing it
 * happened to beside it, in the page's own colour — a branch, a pull request's number, when a
 * quota comes back. The first half wraps, since a log line is a sentence; the second is one line,
 * since it is a name. A failure paints the whole row, so the thing beside it is not lit against
 * the red.
 */
function RowLine({ words, tone }: { words: RowWords; tone: string }) {
  const { said, thing, href, detail } = words
  const lit = tone === '' ? 'text-foreground' : tone
  return (
    <div className="min-w-0 flex-1 font-sans text-sm">
      <div className="flex min-w-0 items-baseline gap-1.5">
        <span className={`min-w-0 whitespace-pre-wrap break-words ${tone || 'text-muted-foreground'}`}>{said}</span>
        {thing !== undefined &&
          (href !== undefined ? (
            <a href={href} target="_blank" rel="noreferrer" className={`min-w-0 shrink-0 truncate hover:underline ${lit}`}>
              {thing}
            </a>
          ) : (
            <span className={`min-w-0 truncate ${lit}`}>{thing}</span>
          ))}
      </div>
      {detail !== undefined && <div className={`mt-0.5 whitespace-pre-wrap break-words opacity-80 ${tone || 'text-muted-foreground'}`}>{detail}</div>}
    </div>
  )
}

/**
 * A screen's row: the one line the package wrote, whole, in the chat's own words rather than the
 * log's — it is a thing to press, not a line of output, and the chat knows nothing of what the
 * screen is beyond that line. Live, it opens the pane that shows the screen. Once the screen has
 * gone the same line stays, unpressable and quiet, saying where the agent had been looking. It is
 * one line whatever it says: an address can be three hundred characters, and the row is read at a
 * glance.
 */
function ScreenRow({ label, onOpen }: { label: string; onOpen?: (() => void) | undefined }) {
  if (!onOpen) return <div className="min-w-0 flex-1 truncate font-sans text-sm text-muted-foreground">{label}</div>
  return (
    <button type="button" onClick={onOpen} className="group/screen flex min-w-0 flex-1 items-center gap-1.5 text-left font-sans text-sm text-foreground">
      <span className="min-w-0 truncate group-hover/screen:underline">{label}</span>
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  )
}

// A row's time: small, at the row's right edge, shown while the pointer is on the row. Its place
// is always there, so nothing moves when it shows.
const TIME = 'ml-auto shrink-0 pt-0.5 text-[10px] tabular-nums text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100'

/** The grouping key of a row about one of the run's subagents. */
const SUBAGENT = 'subagent'
/** How near its end a chat counts as being at it, in pixels: the scroller's own measure. */
const AT_END = 8
const NO_SUBAGENTS: readonly AgentMeta[] = []
const NONE_QUEUED: readonly WaitingMessage[] = []
const NOTHING_DOING: Record<string, AgentDoing> = {}

/**
 * Whether an event is a row at all. The agent's session id is plumbing, not conversation: the
 * session's menu reads it from the events. A turn's end and what the run has spent are not rows
 * either: the run's details count the turns and total the spend. A quota reading is worth a row
 * only when the quota is running low or used up; the agent reports it after every turn,
 * "allowed" included. The name the session was given is not a row: it is the name, written where
 * a name goes — the top bar and the rail — and a line announcing it read as a step the agent took.
 */
function shownAsRow(e: OpenAgentEvent): boolean {
  if (e.kind === 'session-update' || e.kind === 'usage' || e.kind === 'title') return false
  if (e.kind === 'driver' && (e.event.type === 'result' || e.event.type === 'tokens' || e.event.type === 'thinking')) return false
  if (e.kind === 'driver' && e.event.type === 'rate-limit') return e.event.limit.status !== 'allowed'
  return true
}

// The room the log's rows have got smaller: the message box's bar grew over the log's end (a
// question opened over it, the agent's work came in), or the view itself got shorter (the top
// bar's details opened, a notice came under it). A log that was at its end stays at it. The
// scroller does this itself only for a log that follows its end, and a frame late. A log left at
// its end, an ended agent's, it leaves where it was, its last rows under the bar. Done as the room
// at the list's end or the view changes its size, before the frame is drawn.
function useEndKept(viewport: RefObject<HTMLDivElement | null>, endRoom: RefObject<HTMLDivElement | null>): void {
  useLayoutEffect(() => {
    const view = viewport.current
    const room = endRoom.current
    if (!view || !room || typeof ResizeObserver === 'undefined') return
    // What the rows have of the view: its height, less the room the bar takes at the end.
    const left = () => view.clientHeight - room.getBoundingClientRect().height
    let was = left()
    const observer = new ResizeObserver(() => {
      const lost = was - left()
      was -= lost
      // A bar that got shorter, a view that got taller: nothing to keep.
      if (lost <= 0) return
      if (view.scrollHeight - view.scrollTop - view.clientHeight - lost <= AT_END) view.scrollTop = view.scrollHeight
    })
    observer.observe(room)
    observer.observe(view)
    return () => observer.disconnect()
  }, [viewport, endRoom])
}

// A message sent lands at the log's end: the log goes there, also from a reader who had scrolled
// up, and follows its end from then on. `sent` counts the messages sent and not yet read back as
// their own prompt lines; it going up is a message just sent.
function FollowSent({ sent }: { sent: number }) {
  const { scrollToEnd } = useMessageScroller()
  const was = useRef(sent)
  useLayoutEffect(() => {
    if (sent > was.current) scrollToEnd({ behavior: 'smooth' })
    was.current = sent
  }, [sent, scrollToEnd])
  return null
}

export function EventList({
  events: given,
  writing = '',
  sending,
  working = false,
  queued = NONE_QUEUED,
  waitingOn = 0,
  stick = true,
  openAt,
  head,
  tail,
  projectId,
  agentId,
  onSaid,
  subagents = NO_SUBAGENTS,
  doing = NOTHING_DOING,
  setup,
  onOpenSubagent,
  onOpenChange,
  onOpenScreen,
}: {
  events: OpenAgentEvent[]
  /** The message the agent is writing, as far as it has got: the agent's row after the last, drawn
   *  as a finished reply is. Never an event: its whole message's row replaces it. */
  writing?: string
  /** A message just sent to an ended agent: the last prompt row, until the prompt's own line
   *  arrives and takes the same row. Being a prompt, the scroller brings it into view. */
  sending?: string | undefined
  /** The agent is working: while it writes nothing, a moving line closes the feed: the call going
   *  on now, else "Starting…" when the last row is a prompt and "Working…" after, so a quiet agent
   *  never looks stalled. */
  working?: boolean
  /** Messages sent while the agent works that it has not read yet: each a last row of the feed,
   *  with Send now or "Queued" under it, until the agent reads it and it shows where it landed. */
  queued?: readonly WaitingMessage[]
  /** How many subagents an agent that ended its turn still waits on: a moving last line says so. */
  waitingOn?: number
  stick?: boolean
  /** Where a non-following log opens; a replay opens at the outcome (#948), not page one. */
  openAt?: 'start' | 'end'
  /** Before the first row, inside the scroller. */
  head?: ReactNode
  /** Pinned after the last row, inside the scroller (#1265): the log's "and then…" — a web agent's
   *  live mirror box — that must scroll (and stick) with the log rather than float over it. */
  tail?: ReactNode
  /** The log's own project: with it, a resolved gate is the collapsed ✓ card, and an open one is
   *  the question's card when the log knows its agent too. Without it, every `choice` row keeps the
   *  formatter's text. */
  projectId?: string | undefined
  /** The log's own agent, which an open question's card answers. */
  agentId?: string | undefined
  /** Told what an answer said to the agent, so the chat can show it at once. */
  onSaid?: ((text: string) => void) | undefined
  /** The runs started for this run, oldest first: each gets a row where it was started. */
  subagents?: readonly AgentMeta[]
  /** What each working subagent is doing now, by id. */
  doing?: Record<string, AgentDoing>
  /** What was set up for the agent before it began: the "Initialized session" line under the first
   *  prompt (the first row when the log has no prompt). Without it, no such line. */
  setup?: SessionSetup | undefined
  /** Open a subagent beside the chat, by its row's key: what a subagent's row does on a click. */
  onOpenSubagent?: ((key: string) => void) | undefined
  /** Show a changed file's change: what the row of a file at the end of a turn does on a click;
   *  with no path, all of them ("See all"). Without it, the rows are no buttons. */
  onOpenChange?: ((path?: string) => void) | undefined
  /** Show the run's live screen: what the row of a live screen does on a click. Without it, the
   *  row is a line of text. */
  onOpenScreen?: (() => void) | undefined
}) {
  const events = useMemo(() => withEarlyQuestion(given), [given])
  const choiceRows = useMemo(() => (projectId ? foldChoiceRows(events) : undefined), [projectId, events])
  const screenRows = useMemo(() => foldScreenRows(events), [events])
  const passed = useMemo(() => quietEnds(events), [events])
  // The files each turn's edits changed: a row for each at the end of the turn, once it has ended.
  const workspace = setup?.workspace
  const changes = useMemo(() => turnChanges(events, workspace), [events, workspace])
  const rowIds = useMemo(() => new Map(events.map((e, at) => [e, String(at)])), [events])
  const asked = useMemo(() => askedReplies(events), [events])
  // The coding agent's own subagents, and what of the log their rows say instead.
  const calls = useMemo(() => callSubagents(events), [events])
  const theirs = useMemo(() => subagentEvents(events), [events])
  const logged = promptFirst(events).filter(e => shownAsRow(e) && !choiceRows?.hidden.has(e) && !screenRows.hidden.has(e) && !theirs.has(e))
  // Every row and every passed end, in order, a message just sent last; `shown` is the rows alone.
  // An answer just given to the question the chat asks: it stands where the card was until the
  // agent's own line of it arrives in that same place, as Claude Code on the web answers in place.
  // It is no message at the end, which came and then went back up.
  const sentAnswer = sending !== undefined ? answeredQuestion(sending) : undefined
  const answeredInPlace = sentAnswer && choiceRows ? [...choiceRows.rows].find(([, row]) => row.pick === undefined && row.choice.title === sentAnswer.question)?.[0] : undefined
  // The message just sent, as the prompt line its run is about to write: dated when it was sent, so
  // the live line comes and counts from then, as Claude Code on the web's does the moment a message
  // is sent, not seconds later when the run writes its first line.
  const sentAt = useMemo(() => (sending !== undefined ? new Date().toISOString() : undefined), [sending])
  // Its row holds no time, as one being sent shows none.
  const sent: OpenAgentEvent | undefined = sending !== undefined ? { kind: 'driver', event: { type: 'start', prompt: sending } } : undefined
  const kept: OpenAgentEvent[] = sent === undefined || answeredInPlace ? logged : [...logged, sent]
  // Every event and the message just sent: what the turn going on is read off.
  const told = sent === undefined ? events : [...events, sent]
  // The text of a row's message: the reply a question follows, without the question's block.
  const textOf = (e: OpenAgentEvent): string | null => {
    const text = messageText(e)
    return text !== null && asked.has(e) ? withoutQuestionBlock(text) : text
  }
  // A reply that was only its question's block is no row: the card under it is the question.
  // A run of the agent's steps is one row, its first.
  const written = withoutQuestionBlock(writing)
  // The question's card comes after the words above it, not while they are still being typed.
  const typing = useStillWriting() || written !== ''
  const unfolded = kept.filter(e => !passed.has(e) && textOf(e) !== '')
  const { rows: shown, steps, current } = foldSteps(unfolded, working && !written)
  // Nothing has come since the prompt, not even a thought that is no row: the agent is starting.
  const starting = unfolded.length > 0 && isTurnBoundary(unfolded[unfolded.length - 1]!)
  // When the turn going on began: the live line counts from there, whatever step it names.
  // The agent's turn can end while subagents of its own still work in the background: it waits,
  // as Claude Code on the web's does, with no moving line, until a subagent's message wakes it and
  // the line counts again from then.
  let turnOverAt = -1
  let wokeAt: string | undefined
  told.forEach((e, at) => {
    if (e.kind !== 'driver') return
    if (e.event.type === 'result') {
      turnOverAt = at
      wokeAt = undefined
    } else if (isTurnBoundary(e)) {
      // A new prompt starts a turn of its own, counted from that prompt.
      turnOverAt = -1
      wokeAt = undefined
    } else if (turnOverAt >= 0 && wokeAt === undefined && isAgentsOwn(e)) wokeAt = e.at
  })
  // Or the turn stays open with the main agent blocked on its subagents' calls, idle all the same:
  // read off its own steps (`subagentWait`), with the same blank line and the same count from its wake.
  const blocked = subagentWait(events)
  const waitsOnItsOwn = (turnOverAt >= 0 && wokeAt === undefined && turnOverAt > told.findIndex(isTurnBoundary) && !told.slice(turnOverAt + 1).some(isTurnBoundary)) || blocked.waiting
  // A turn the person began by sending a message counts from the send, not from its prompt line,
  // which its run writes seconds later: the count would go back to nothing when that line came.
  const lastSent = useRef<string | undefined>(undefined)
  if (sentAt !== undefined) lastSent.current = sentAt
  const turnBoundary = [...unfolded].reverse().find(isTurnBoundary)
  const sentTurn = lastSent.current !== undefined && turnBoundary !== undefined && turnBoundary !== sent && told.find(e => isTurnBoundary(e) && e !== sent && e.at !== undefined && e.at > lastSent.current!) === turnBoundary
  const turnStart = later(wokeAt, blocked.wokeAt) ?? (sentTurn || (sent !== undefined && turnBoundary === sent) ? lastSent.current : turnBoundary?.at) ?? unfolded[unfolded.length - 1]?.at
  // The prompts that told this run one of its subagents ended: SUBAGENT rows, not the reader's own.
  const ends = new Map<OpenAgentEvent, SubagentEnd>()
  for (const e of shown) {
    const end = e.kind === 'driver' && e.event.type === 'start' ? subagentEnd(e.event.prompt, subagents) : undefined
    if (end) ends.set(e, end)
  }
  // A row is known by its event's place in the whole log, not among the rows shown: a row that
  // stops being shown (an end the run went on after) then changes no other row's identity, and
  // the scroller keeps its place. A message just sent has no place yet.
  const idOf = (e: OpenAgentEvent): string => rowIds.get(e) ?? 'sending'
  const groupOf = (e: OpenAgentEvent): string => (ends.has(e) ? SUBAGENT : rowGroup(e))
  const rows = [...subagents.map(agent => runRow(agent, doing[agent.id])), ...calls.map(call => callRow(call, working, events[0]?.at ?? new Date(0).toISOString()))]
  // A prompt or the agent's own words part them: what it started after saying something comes after those words.
  const reports = new Map(calls.flatMap(call => {
    const report = subagentReport(events, call.id)
    return report !== undefined ? [[`call:${call.id}`, report] as const] : []
  }))
  const tokens = turnTokens(told)
  // Once the coding agent said its session began, it is set up: what goes on is its own thinking.
  const begun = events.some(e => e.kind === 'session-update')
  // The call going on now is its steps row's, as Claude Code on the web's is: the row it continues,
  // or a row of its own when it starts one. The row stays the same row once the call is done, so
  // its words change in place to the steps it took.
  const currentEvent = current !== undefined ? unfolded[unfolded.length - 1] : undefined
  const lastRow = shown[shown.length - 1]
  const liveHead = currentEvent === undefined ? undefined : lastRow !== undefined && steps.has(lastRow) ? lastRow : currentEvent
  const listed = currentEvent !== undefined && liveHead === currentEvent ? [...shown, currentEvent] : shown
  if (currentEvent !== undefined && liveHead === currentEvent) steps.set(currentEvent, [])
  const started = subagentSteps(shown, rows, reports, e => isTurnBoundary(e) || (e.kind === 'driver' && e.event.type === 'text'))
  const startedRows = (at: number): ReactNode => {
    const steps = started.get(at)
    if (!steps) return null
    const first = steps[0]!
    return (
      <MessageScrollerItem key={`subagent-${first.kind}-${first.row.key}`} messageId={`subagent-${first.kind}-${first.row.key}`} className="group/row -mx-1.5 flex items-start gap-2 rounded-sm px-1.5">
        <SubagentSteps steps={steps} lead={setupInSubagents && at === setupAt ? setupLead : undefined} onOpen={onOpenSubagent} />
      </MessageScrollerItem>
    )
  }
  // The "Initialized session" line: under the first prompt, which opens the log; above everything when
  // the log has no prompt. It breaks the run of rows like a subagent's row: the row after it
  // shows its badge.
  const setupAt = setup === undefined ? -1 : shown.length > 0 && isTurnBoundary(shown[0]!) ? 1 : 0
  // The session is being set up: the agent works and its first prompt is all there is. The line
  // then names the step going on now, and is the one moving line: the "Starting…" line under it
  // is not drawn.
  const settingUp = setup !== undefined && working && !written && starting && !begun && unfolded.filter(isTurnBoundary).length === 1
  // What the run adds after each message is the same for all of them: read off the first.
  const firstPrompt = events.find(isTurnBoundary)
  const added = firstPrompt?.kind === 'driver' && firstPrompt.event.type === 'start' ? firstPrompt.event.added : undefined
  const setupLine = setup !== undefined && <SessionLine setup={setup} working={working} added={added} {...(settingUp ? { live: { since: turnStart } } : {})} />
  const setupLead = setup !== undefined && <SessionLine setup={setup} working={working} added={added} nested />
  // Once set up, the line is the first row of the first turn's work, when that turn has some, as
  // Claude Code on the web opens its first "Ran 2 commands" with "Initialized session".
  const setupFolds = setupLine !== false && !sessionLineEmpty(setup, working) && !settingUp && setupAt >= 0
  // Or of its subagents, when they come first.
  const setupInSubagents = setupFolds && started.has(setupAt)
  const setupInSteps = setupFolds && !setupInSubagents && shown[setupAt] !== undefined && steps.has(shown[setupAt]!)
  const setupRow = setupLine && !setupInSteps && !setupInSubagents && (
    <MessageScrollerItem key="setup" messageId="setup" className="-mx-1.5 flex items-start gap-2 rounded-sm px-1.5 empty:hidden">
      {setupLine}
    </MessageScrollerItem>
  )
  // The page's message box lies over the log's end (ChatPane says how much of it, `--chat-bottom`;
  // with no bar there is none): the rows end above it.
  //
  // That room is an element and no padding: the scroller acts on its content growing (it stays at
  // the end), and padding is no part of that. It is the list's first element and is drawn last.
  //
  // No row is the scroller's anchor: a message sent lands under the last answer, where it is
  // written, as Claude Code on the web shows it, and the log follows its end. An anchor brought
  // each new prompt to the top of the view, a jump of the whole page, and the room the scroller
  // kept under it was measured a frame late, so the chat shook as the answer grew.
  //
  // The viewport's scroll padding is for the browser: a page down moves by what is seen, and a row
  // brought into view lands clear of the bar.
  const viewport = useRef<HTMLDivElement>(null)
  const endRoom = useRef<HTMLDivElement>(null)
  useEndKept(viewport, endRoom)
  // The last row of each turn the agent finished, with what its footer copies: everything the
  // agent said since the person's last message, its messages one paragraph apart, as Claude Code on
  // the web's copy takes them; a turn that said nothing but a question, the question. Claude Code
  // puts the pair under the question the turn ended on too, open or answered, shown while the
  // pointer is on the turn. An answer to the agent's question goes on the same turn, as it does there. The turn going on has none until it ends: the agent has not
  // finished saying it. A turn that changed files ends on their card: the pair goes under it, as
  // Claude Code puts it under its card of the turn's files. Keyed by the prompt the turn ended at;
  // the last turn's by `null`.
  const footers = new Map<OpenAgentEvent, string>()
  const filesFooters = new Map<OpenAgentEvent | null, { text: string; at: string | undefined }>()
  let last: { row: OpenAgentEvent; text: string } | undefined
  let said: string[] = []
  for (const e of shown) {
    const message = textOf(e)
    const choiceRow = choiceRows?.rows.get(e)
    if (isTurnBoundary(e)) {
      if (ends.has(e) || (message !== null && answeredQuestion(message))) continue
      if (last) {
        if (changes.ended.has(e)) filesFooters.set(e, { text: last.text, at: last.row.at })
        else footers.set(last.row, last.text)
      }
      last = undefined
      said = []
    } else if (message !== null) {
      said.push(message)
      last = { row: e, text: said.join('\n\n') }
    } else if (choiceRow) last = { row: e, text: said.length > 0 ? said.join('\n\n') : choiceRow.choice.title }
  }
  if (last && !working && sending === undefined) {
    if (changes.last.length > 0) filesFooters.set(null, { text: last.text, at: last.row.at })
    else footers.set(last.row, last.text)
  }
  // The open question the keys answer: the newest.
  const asking = [...shown].reverse().find(e => choiceRows?.rows.has(e) && choiceRows.rows.get(e)?.pick === undefined && !choiceRows.rows.get(e)?.passed)

  return (
    <MessageScrollerProvider autoScroll={stick} defaultScrollPosition={openAt ?? (stick ? 'end' : 'start')}>
      <FollowSent sent={(sending === undefined || answeredInPlace ? 0 : 1) + queued.length} />
      {/* A layer of its own: "Jump to latest" stays under the message box's bar. */}
      <MessageScroller className="isolate flex-1">
        <MessageScrollerViewport ref={viewport} aria-label="Agent output" className="scroll-pb-(--chat-bottom)">
          <MessageScrollerContent spacerClassName="order-last" className="mx-auto w-full max-w-3xl gap-3 px-4 pt-4 font-mono text-xs">
            {/* First in the page, so never the row the browser keeps in place when a row above
                it grows: a steps line opened at the log's end opens under the line, the line
                where it was, as Claude Code's does, not pushed up by the room held still. */}
            <div ref={endRoom} data-testid="log-end-room" className="order-9998 h-[calc(var(--chat-bottom,0px)+0.5rem)] shrink-0 [overflow-anchor:none]" aria-hidden />
            {head && (
              <MessageScrollerItem messageId="head" className="-mx-1.5 rounded-sm px-1.5">
                {head}
              </MessageScrollerItem>
            )}
            {listed.map((e, i, rows) => {
              const steered = steeredText(e)
              const message = steered ?? textOf(e)
              const choiceRow = choiceRows?.rows.get(e)
              const prev = i > 0 ? rows[i - 1] : undefined
              const end = ends.get(e)
              // The first of a run of same-kind rows carries the run's time. A subagent's row above
              // this one breaks the run; the row of a subagent's end goes on that run of subagent rows.
              const chunkHead = !prev || (started.has(i) ? !end : groupOf(prev) !== groupOf(e))
              const at = e.at
              // The user's own message: a prompt that is not a subagent's end, or one the agent read as it worked.
              const own = (isTurnBoundary(e) && !end) || steered !== undefined
              // What the chat says for a row that is none of the above; nothing when the
              // terminal's own line is what it says (row-words.ts).
              const words = rowWords(e)
              // The prompt the agent was resumed with after an answer in its card: a box, not a message.
              const answer = own && message !== null ? answeredQuestion(message) : undefined
              const inPlace = e === answeredInPlace
              // The last row of a turn the agent finished: its copy and its time under it.
              const footer = footers.has(e) ? <ReplyFooter text={footers.get(e)!} at={at} /> : undefined
              return (
                <Fragment key={idOf(e)}>
                {changes.ended.has(e) && (
                  <MessageScrollerItem messageId={`changes-${idOf(e)}`} className={FILES_ROW}>
                    <TurnFiles files={changes.ended.get(e)!} onOpen={onOpenChange} footer={filesFooters.get(e)} />
                  </MessageScrollerItem>
                )}
                {/* A message just sent ends the last turn as its own prompt line will: the turn's
                    files stay above it, where they were, and do not go and come back. */}
                {idOf(e) === 'sending' && changes.last.length > 0 && (
                  <MessageScrollerItem messageId="changes-last" className={FILES_ROW}>
                    <TurnFiles files={changes.last} onOpen={onOpenChange} />
                  </MessageScrollerItem>
                )}
                {i === setupAt && setupRow}
                {startedRows(i)}
                {/* Every row carries the same -mx/px pair so a washed row's band and a plain row's
                    text share the exact same columns; only the background differs. */}
                <MessageScrollerItem messageId={idOf(e)} data-prompt={(own && !answer) || undefined} className={`group/row relative -mx-1.5 flex items-start gap-2 rounded-sm px-1.5 ${answer || inPlace ? 'mt-1 mb-3.5' : own ? '-mb-2.5 mt-4 first:mt-0' : ''} ${end ? '' : rowWash(e)}`}>
                  {answer ? (
                    <Answer {...answer} />
                  ) : inPlace && sentAnswer ? (
                    <Answer {...sentAnswer} />
                  ) : own && message !== null ? (
                    <Prompt text={message} at={at} attached={e.kind === 'driver' && e.event.type === 'start' ? e.event.attached : undefined} fresh={idOf(e) === 'sending'} />
                  ) : end ? (
                    // A subagent ended: what the run was told about it, folded.
                    <SubagentMessage name={runRow(end.agent, undefined).name} text={endMessage(end.rest)} status={end.status} detail={end.detail} />
                  ) : message !== null ? (
                    // The agent's reply, shown whole, and the last of a finished turn with its footer.
                    footer ? (
                      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <Reply text={message} />
                        {footer}
                      </div>
                    ) : (
                      <Reply text={message} />
                    )
                  ) : steps.has(e) ? (
                    <ToolCalls steps={steps.get(e)!} lead={setupInSteps && i === setupAt ? setupLead : undefined} live={e === liveHead && current !== undefined ? { call: current, since: turnStart } : undefined} />
                  ) : choiceRow?.passed ? (
                    <PassedChoice choice={choiceRow.choice} footer={footer} />
                  ) : choiceRow && choiceRow.pick === undefined && projectId !== undefined && agentId !== undefined ? (
                    // The question the agent waits on, answered here, under what it said.
                    typing ? null : <div className="mt-1 flex min-w-0 flex-1 flex-col gap-1.5">
                      <QuestionPanel key={`${agentId}:${choiceRow.choice.id}`} projectId={projectId} agentId={agentId} choice={choiceRow.choice} active={e === asking} onSaid={onSaid} />
                      {footer}
                    </div>
                  ) : choiceRow?.pick !== undefined ? (
                    // What was asked and what was picked. font-sans: a card, not log text.
                    <div className="flex min-w-0 flex-1 flex-col gap-1 font-sans">
                      <AnsweredChoice choice={choiceRow.choice} pick={choiceRow.pick} />
                      {footer}
                    </div>
                  ) : words ? (
                    <RowLine words={words} tone={rowTone(e)} />
                  ) : e.kind === 'screen' ? (
                    <ScreenRow label={e.label} onOpen={onOpenScreen && screenRows.live.has(e) ? onOpenScreen : undefined} />
                  ) : (
                    <span className={`min-w-0 flex-1 whitespace-pre-wrap break-words ${rowTone(e) || 'text-foreground'}`}>
                      {(formatOpenAgentEvent(e) ?? '').trim()}
                    </span>
                  )}
                  {/* A line of steps, a message or a subagent's message has no time at its end, as Claude
                      Code's has none: the column it takes would narrow a message being written as it lands. */}
                  {!own && !end && message === null && chunkHead && at !== undefined && footer === undefined && !steps.has(e) && (
                    <Tooltip>
                      <TooltipTrigger render={<span className={TIME} />}>
                        {formatTime(at)}
                      </TooltipTrigger>
                      <TooltipContent>{new Date(at).toLocaleString()}</TooltipContent>
                    </Tooltip>
                  )}
                </MessageScrollerItem>
                </Fragment>
              )
            })}
            {listed.length === setupAt && setupRow}
            {startedRows(listed.length)}
            {written && (
              <MessageScrollerItem messageId="writing" className="-mx-1.5 flex items-start gap-2 rounded-sm px-1.5">
                <Writing text={written} />
              </MessageScrollerItem>
            )}
            {/* The last turn's files, once it has ended: while the agent works the list still grows.
                With a message just sent they are above that message, in the rows. */}
            {!working && sending === undefined && changes.last.length > 0 && (
              <MessageScrollerItem messageId="changes-last" className={FILES_ROW}>
                <TurnFiles files={changes.last} onOpen={onOpenChange} footer={filesFooters.get(null)} />
              </MessageScrollerItem>
            )}
            {/* The live line's place is kept when it has nothing to say (a message being written,
                the agent's turn over): nothing under it moves up when it goes, nor down when it comes. */}
            {shown.length > 0 && (
              <div data-testid="live-line" className="-mx-1.5 flex min-h-5 shrink-0 items-center gap-2 rounded-sm px-1.5">
                {/* Under the reply as it streams, too: the agent is still at it, and Claude Code on
                    the web keeps its dots and its count there. The line said a word before, which
                    under a streaming reply read as a second thing going on. */}
                {working && !settingUp && !waitsOnItsOwn && current === undefined && <LiveLine since={turnStart} tokens={tokens} />}
              </div>
            )}
            {!working && waitingOn > 0 && (
              <MessageScrollerItem messageId="waiting-on" className="-mx-1.5 flex items-center gap-2 rounded-sm px-1.5">
                <LiveLine word={`Waiting for ${waitingOn} ${waitingOn === 1 ? 'subagent' : 'subagents'}`} />
              </MessageScrollerItem>
            )}
            {queued.map(({ id, text, ...waiting }) => (
              <MessageScrollerItem key={`queued-${id}`} messageId={`queued-${id}`} className="-mx-1.5 flex items-start gap-2 rounded-sm px-1.5">
                <Prompt text={text} waiting={waiting} fresh />
              </MessageScrollerItem>
            ))}
            {tail}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton className="data-[direction=end]:bottom-[calc(var(--chat-bottom,0px)+1.25rem)]" />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}
