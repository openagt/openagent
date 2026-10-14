import type { AgentMeta, ChoiceRequest, OpenAgentEvent } from '../../src/index.js'
import { foldScreenRows, formatOpenAgentEvent } from '../../src/client.js'
import { Fragment, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { ChevronRight } from 'lucide-react'
import { pendingChoices } from '../lib/live-state.js'
import { startedBefore, subagentEnd, subagentStartedAt, type SubagentEnd } from '../lib/subagents.js'
import { answeredQuestion } from '../lib/answered-question.js'
import { AnsweredChoice } from './AnsweredChoice.js'
import { Markdown } from './Markdown.js'
import { SessionLine, sessionLineEmpty, type SessionSetup } from './SessionLine.js'
import { ChangedFiles } from './ChangedFiles.js'
import { turnChanges } from '../lib/turn-changes.js'
import { SubagentLine } from './SubagentLine.js'
import { LiveLine, ToolCalls, type CallOutput, type ToolStep } from './ToolCalls.js'
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
//   - Choice gates, when the log knows its project: an open gate is one "Asking" line (the agent's page
//     asks it above the message box); a resolved one collapses to the AnsweredChoice ✓ card and hides
//     its "✓ chose" line.
//   - Screens: the newest open `screen` line at an address, before the run's end, is live: its
//     line opens the pane that shows the screen. An earlier one stays its one
//     line of text, and an `ended` one is hidden.
//   - A turn's end and the spend so far are not rows, and neither is a clean end or an end waiting
//     on an answer: the agent's last message, or its question, is how such a turn ends. A stopped
//     or failed end is a row.
//   - The reply a question follows is shown whole: it is what the question asks about.
//   - Subagents, when the log is given the run's: each has a row where it was started, read off
//     its card, so the row of a working one says what it is doing now; and the prompt that told
//     the run a subagent ended is a subagent's row too, not a message of the user's.
// The rows sit in one centered column, as a chat's do, with no label saying each row's kind: the
// user's turn is a box on the right, and every other row says what it is. The first of a run of
// same-kind rows carries the time its diary line was written, shown while the pointer is on the
// row, the same live, reloaded or replayed; a line written with no time shows none. Scrolling
// rides shadcn's Base UI message-scroller (#712): live follows the edge (`autoScroll`) but yields
// the moment the reader scrolls up, replay renders static from the top, and the "Jump to latest"
// chip is the scroller's own inert-when-not-scrollable button.

// The conversation text — the user's prompt and the agent's reply (AGENT). Both are rendered
// as Markdown: the agent writes in Markdown, and a prompt may too.
function messageText(e: OpenAgentEvent): string | null {
  if (e.kind !== 'driver') return null
  if (e.event.type === 'start') return e.event.prompt
  if (e.event.type === 'text') return e.event.text
  return null
}

// Long enough that an inline row truncates to one line and offers to expand. Mirrors terminal.ts's
// `truncate`: collapse whitespace, trim, compare to 100.
function isLong(text: string): boolean {
  return text.replace(/\s+/g, ' ').trim().length > 100
}

/** Grouping key for a run of same-kind rows: the user's prompt stands apart from the agent's work. */
function rowGroup(e: OpenAgentEvent): string {
  if (e.kind === 'driver') return e.event.type === 'start' ? 'you' : 'agent'
  return e.kind
}

// A driver `start` opens a fresh prompt turn.
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

/** A question's row: answered through its gate (`pick`), or still waiting for its answer. */
type ChoiceRow = { choice: ChoiceRequest; pick?: string | readonly string[] }

/**
 * Fold the log's choice traffic: which gates are a ✓ card, and which lines are no row.
 *
 * Only the LAST firing of a gate id is special — `pendingChoices` replaces a re-fired gate in
 * place, so an earlier firing is history and keeps its text. An open gate (no resolution, no
 * `end` after it) is one grey line, "Asking <title>": the question itself is asked above the
 * message box (QuestionPanel), not in the flow. A resolved one collapses to the ✓ card, and the
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
  // A question answered in the panel: every firing of it, not only the last. A local agent's
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
    }
  }
  return { rows, hidden }
}

/**
 * The ends that are no row: a clean one, and one waiting on an answer. The agent's last message
 * is how a clean turn ends, and the question above the message box is how a waiting one does; a
 * line under them said it twice. A failed or stopped end is a row where it happened: it says why
 * the agent is not going on, and why the next prompt was needed.
 */
export function quietEnds(events: readonly OpenAgentEvent[]): Set<OpenAgentEvent> {
  return new Set(events.filter(e => e.kind === 'end' && (e.ok || e.waiting)))
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
function Reply({ text }: { text: string }) {
  return (
    <div className="min-w-0 flex-1 font-sans text-foreground">
      <Markdown text={text} />
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

// A question the agent waits on, in the flow: one grey line, as Claude Code on the web says
// "Asking …" while its question is open. It opens to the choices; the answer is given in the panel
// above the message box.
function Asking({ choice }: { choice: ChoiceRequest }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="min-w-0 flex-1 font-sans text-sm text-muted-foreground">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-label={`Asking ${choice.title}`} className="flex max-w-full items-center gap-1.5 hover:text-foreground">
        <span className="shrink-0">Asking</span>
        <span className="truncate text-foreground">{choice.title}</span>
        <ChevronRight className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden />
      </button>
      {open && (
        <ul className="mt-1.5 flex flex-col gap-1 rounded-lg border border-border px-3 py-2">
          {choice.options.map(option => (
            <li key={option.id} className="text-foreground">
              {option.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// A question and the answer the person gave it: a small box on the left, the question in grey and
// the answer under it, in place of the sentence the agent was resumed with.
function Answer({ question, answer }: { question: string; answer: string }) {
  return (
    <div role="group" aria-label="Your answer" className="max-w-[85%] min-w-0 rounded-lg border border-border px-3.5 py-2 font-sans text-sm">
      <div className="text-muted-foreground">{question}</div>
      <div className="text-foreground">{answer}</div>
    </div>
  )
}

// The user's own message: a grey box on the right, as Markdown in the page's font. No label says
// whose it is; the place and the box do. A long one is cut short with "Show more" under it. The
// time it was sent sits under the box and shows while the pointer is on the message; its line is
// always there, so nothing moves when it shows.
// `queued`: a message the working agent has not read yet. Dimmed, with the word under it where a
// read message's time shows on hover.
// `attached`: what the run handed the agent with this message, folded under the box.
// `fresh`: a message just sent, which slides in where it lands, as Claude Code on the web's does.
function Prompt({ text, at, queued = false, attached, fresh = false }: { text: string; at?: string | undefined; queued?: boolean; attached?: string | undefined; fresh?: boolean }) {
  const [open, setOpen] = useState(false)
  const tall = isTall(text)
  return (
    <div className={`group/prompt flex min-w-0 flex-1 flex-col items-end font-sans text-foreground ${fresh ? 'bubble-in' : ''}`}>
      <div role="group" aria-label={queued ? 'Your message, queued' : 'Your message'} className={`max-w-[85%] min-w-0 rounded-xl bg-muted px-3.5 py-2 ${queued ? 'opacity-60' : ''}`}>
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
      {queued ? (
        <span className="h-4 pr-1 text-[10px] text-muted-foreground">Queued</span>
      ) : (
      <time
        dateTime={at}
        title={at === undefined ? undefined : new Date(at).toLocaleString()}
        className="h-4 pr-1 text-[10px] tabular-nums text-muted-foreground opacity-0 transition-opacity group-hover/prompt:opacity-100"
      >
        {at === undefined ? '' : formatTime(at)}
      </time>
      )}
    </div>
  )
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

// What a run was told about a subagent's end, rendered as compact Markdown. A short one renders as-is. A long one clamps to its
// first line with a chevron beside it and expands in place on click — the chevron stays on that
// first line (never a lone chevron on its own row), and the same rendered Markdown just unclamps,
// so the opening is never shown twice.
function Message({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  if (!isLong(text)) {
    return (
      <div className="min-w-0 flex-1">
        <Markdown text={text} compact />
      </div>
    )
  }
  return (
    <div className="flex min-w-0 flex-1 items-start gap-1.5">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={open ? 'Collapse message' : 'Expand message'}
        className={`shrink-0 select-none text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`}
      >
        ›
      </button>
      <div
        className={open ? 'min-w-0 flex-1' : 'max-h-[1.35rem] min-w-0 flex-1 cursor-pointer overflow-hidden'}
        onClick={open ? undefined : () => setOpen(true)}
      >
        <Markdown text={text} compact />
      </div>
    </div>
  )
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
export function foldSteps(
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

// A row's time: small, at the row's right edge, shown while the pointer is on the row. Its place
// is always there, so nothing moves when it shows.
const TIME = 'ml-auto shrink-0 pt-0.5 text-[10px] tabular-nums text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100'

/** The grouping key of a row about one of the run's subagents. */

const SUBAGENT = 'subagent'
/** How near its end a chat counts as being at it, in pixels: the scroller's own measure. */
const AT_END = 8
const NO_SUBAGENTS: readonly AgentMeta[] = []
const NONE_QUEUED: readonly string[] = []
const NOTHING_DOING: Record<string, string> = {}

/**
 * Whether an event is a row at all. The agent's session id is plumbing, not conversation: the
 * session's menu reads it from the events. A turn's end and what the run has spent are not rows
 * either: the run's details count the turns and total the spend. A quota reading is worth a row
 * only when the quota is running low or used up; the agent reports it after every turn,
 * "allowed" included.
 */
function shownAsRow(e: OpenAgentEvent): boolean {
  if (e.kind === 'session-update' || e.kind === 'usage') return false
  if (e.kind === 'driver' && e.event.type === 'result') return false
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
  events,
  writing = '',
  sending,
  working = false,
  queued = NONE_QUEUED,
  waitingOn = 0,
  stick = true,
  openAt,
  tail,
  projectId,
  subagents = NO_SUBAGENTS,
  doing = NOTHING_DOING,
  setup,
  onOpenAgent,
  onOpenChange,
  onOpenScreen,
}: {
  events: OpenAgentEvent[]
  /** The message the agent is writing, as far as it has got: an AGENT row after the last, drawn
   *  as a finished reply is. Never an event: its whole message's row replaces it. */
  writing?: string
  /** A message just sent to an ended agent: the last prompt row, until the prompt's own line
   *  arrives and takes the same row. Being a prompt, the scroller brings it into view. */
  sending?: string | undefined
  /** The agent is working: while it writes nothing, a moving line closes the feed: the call going
   *  on now, else "Starting…" when the last row is a prompt and "Working…" after, so a quiet agent
   *  never looks stalled. */
  working?: boolean
  /** Messages sent while the agent works, which it reads when its turn ends: each the last row of
   *  the feed, dimmed, with "Queued" under it, until the agent's next turn shows them as read. */
  queued?: readonly string[]
  /** How many subagents an agent that ended its turn still waits on: a moving last line says so. */
  waitingOn?: number
  stick?: boolean
  /** Where a non-following log opens; a replay opens at the outcome (#948), not page one. */
  openAt?: 'start' | 'end'
  /** Pinned after the last row, inside the scroller (#1265): the log's "and then…" — a web agent's
   *  live mirror box — that must scroll (and stick) with the log rather than float over it. */
  tail?: ReactNode
  /** The log's own project: with it, an open gate is one "Asking" line (its page asks the question above
   *  the message box) and a resolved one is the collapsed ✓ card. Without it, every `choice` row
   *  keeps the formatter's text. */
  projectId?: string | undefined
  /** The runs started for this run, oldest first: each gets a row where it was started. */
  subagents?: readonly AgentMeta[]
  /** What each working subagent is doing now, by id. */
  doing?: Record<string, string>
  /** What was set up for the agent before it began: the "Initialized session" line under the first
   *  prompt (the first row when the log has no prompt). Without it, no such line. */
  setup?: SessionSetup | undefined
  /** Open another run's page: what a subagent's row does on a click. */
  onOpenAgent?: ((agentId: string) => void) | undefined
  /** Show a changed file's change: what the row of a file at the end of a turn does on a click.
   *  Without it, the rows are no buttons. */
  onOpenChange?: ((path: string) => void) | undefined
  /** Show the run's live screen: what the row of a live screen does on a click. Without it, the
   *  row is a line of text. */
  onOpenScreen?: (() => void) | undefined
}) {
  const choiceRows = useMemo(() => (projectId ? foldChoiceRows(events) : undefined), [projectId, events])
  const screenRows = useMemo(() => foldScreenRows(events), [events])
  const passed = useMemo(() => quietEnds(events), [events])
  // The files each turn's edits changed: a row for each at the end of the turn, once it has ended.
  const workspace = setup?.workspace
  const changes = useMemo(() => turnChanges(events, workspace), [events, workspace])
  const rowIds = useMemo(() => new Map(events.map((e, at) => [e, String(at)])), [events])
  const asked = useMemo(() => askedReplies(events), [events])
  const logged = promptFirst(events).filter(e => shownAsRow(e) && !choiceRows?.hidden.has(e) && !screenRows.hidden.has(e))
  // Every row and every passed end, in order, a message just sent last; `shown` is the rows alone.
  const kept: OpenAgentEvent[] = sending === undefined ? logged : [...logged, { kind: 'driver', event: { type: 'start', prompt: sending } }]
  // The text of a row's message: the reply a question follows, without the question's block.
  const textOf = (e: OpenAgentEvent): string | null => {
    const text = messageText(e)
    return text !== null && asked.has(e) ? withoutQuestionBlock(text) : text
  }
  // A reply that was only its question's block is no row: the card under it is the question.
  // A run of the agent's steps is one row, its first.
  const written = withoutQuestionBlock(writing)
  const unfolded = kept.filter(e => !passed.has(e) && textOf(e) !== '')
  const { rows: shown, steps, current } = foldSteps(unfolded, working && !written)
  // Nothing has come since the prompt, not even a thought that is no row: the agent is starting.
  const starting = unfolded.length > 0 && isTurnBoundary(unfolded[unfolded.length - 1]!)
  // When the turn going on began: the live line counts from there, whatever step it names.
  const turnStart = [...unfolded].reverse().find(isTurnBoundary)?.at ?? unfolded[unfolded.length - 1]?.at
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
  const started = startedBefore(shown, subagents)
  const startedRows = (at: number): ReactNode =>
    started.get(at)?.map(agent => (
      <MessageScrollerItem key={`subagent-${agent.id}`} messageId={`subagent-${agent.id}`} className="group/row -mx-1.5 flex items-start gap-2 rounded-sm px-1.5">
        <SubagentLine agent={agent} doing={doing[agent.id]} onOpen={onOpenAgent} />
        <Tooltip>
          <TooltipTrigger render={<span className={TIME} />}>{formatTime(subagentStartedAt(agent))}</TooltipTrigger>
          <TooltipContent>{new Date(subagentStartedAt(agent)).toLocaleString()}</TooltipContent>
        </Tooltip>
      </MessageScrollerItem>
    ))
  // The "Initialized session" line: under the first prompt, which opens the log; above everything when
  // the log has no prompt. It breaks the run of rows like a subagent's row: the row after it
  // shows its badge.
  const setupAt = setup === undefined ? -1 : shown.length > 0 && isTurnBoundary(shown[0]!) ? 1 : 0
  // The session is being set up: the agent works and its first prompt is all there is. The line
  // then names the step going on now, and is the one moving line: the "Starting…" line under it
  // is not drawn.
  const settingUp = setup !== undefined && working && !written && starting && unfolded.filter(isTurnBoundary).length === 1
  // What the run adds after each message is the same for all of them: read off the first.
  const firstPrompt = events.find(isTurnBoundary)
  const added = firstPrompt?.kind === 'driver' && firstPrompt.event.type === 'start' ? firstPrompt.event.added : undefined
  const setupLine = setup !== undefined && <SessionLine setup={setup} working={working} added={added} {...(settingUp ? { live: { since: turnStart } } : {})} />
  // Once set up, the line is the first row of the first turn's work, when that turn has some, as
  // Claude Code on the web opens its first "Ran 2 commands" with "Initialized session".
  const setupInSteps = setupLine !== false && !sessionLineEmpty(setup, working) && !settingUp && setupAt >= 0 && shown[setupAt] !== undefined && steps.has(shown[setupAt]!)
  const setupRow = setupLine && !setupInSteps && (
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
  return (
    <MessageScrollerProvider autoScroll={stick} defaultScrollPosition={openAt ?? (stick ? 'end' : 'start')}>
      <FollowSent sent={(sending === undefined ? 0 : 1) + queued.length} />
      {/* A layer of its own: "Jump to latest" stays under the message box's bar. */}
      <MessageScroller className="isolate flex-1">
        <MessageScrollerViewport ref={viewport} aria-label="Agent output" className="scroll-pb-(--chat-bottom)">
          <MessageScrollerContent spacerClassName="order-last" className="mx-auto w-full max-w-3xl gap-2 px-4 pt-4 font-mono text-xs">
            <div ref={endRoom} data-testid="log-end-room" className="order-9998 h-[calc(var(--chat-bottom,0px)+0.5rem)] shrink-0" aria-hidden />
            {shown.map((e, i, rows) => {
              const message = textOf(e)
              const choiceRow = choiceRows?.rows.get(e)
              const prev = i > 0 ? rows[i - 1] : undefined
              const end = ends.get(e)
              // The first of a run of same-kind rows carries the run's time. A subagent's row above
              // this one breaks the run; the row of a subagent's end goes on that run of subagent rows.
              const chunkHead = !prev || (started.has(i) ? !end : groupOf(prev) !== groupOf(e))
              const at = e.at
              // The user's own message: a prompt that is not a subagent's end.
              const own = isTurnBoundary(e) && !end
              // The prompt the agent was resumed with after an answer in the panel: a box, not a message.
              const answer = own && message !== null ? answeredQuestion(message) : undefined
              return (
                <Fragment key={idOf(e)}>
                {changes.ended.has(e) && (
                  <MessageScrollerItem messageId={`changes-${idOf(e)}`} className="-mx-1.5 flex items-start gap-2 rounded-sm px-1.5">
                    <ChangedFiles files={changes.ended.get(e)!} onOpen={onOpenChange} />
                  </MessageScrollerItem>
                )}
                {/* A message just sent ends the last turn as its own prompt line will: the turn's
                    files stay above it, where they were, and do not go and come back. */}
                {idOf(e) === 'sending' && changes.last.length > 0 && (
                  <MessageScrollerItem messageId="changes-last" className="-mx-1.5 flex items-start gap-2 rounded-sm px-1.5">
                    <ChangedFiles files={changes.last} onOpen={onOpenChange} />
                  </MessageScrollerItem>
                )}
                {i === setupAt && setupRow}
                {startedRows(i)}
                {/* Every row carries the same -mx/px pair so a washed row's band and a plain row's
                    text share the exact same columns; only the background differs. */}
                <MessageScrollerItem messageId={idOf(e)} className={`group/row -mx-1.5 flex items-start gap-2 rounded-sm px-1.5 ${end ? '' : rowWash(e)}`}>
                  {answer ? (
                    <Answer {...answer} />
                  ) : own && message !== null ? (
                    <Prompt text={message} at={at} attached={e.kind === 'driver' && e.event.type === 'start' ? e.event.attached : undefined} fresh={idOf(e) === 'sending'} />
                  ) : end ? (
                    // A subagent ended: which one and how, then what the run was told about it.
                    <div className="flex min-w-0 flex-1 flex-col">
                      <SubagentLine agent={end.agent} end={end} onOpen={onOpenAgent} />
                      {end.rest && <Message text={end.rest} />}
                    </div>
                  ) : message !== null ? (
                    // The agent's reply, shown whole.
                    <Reply text={message} />
                  ) : steps.has(e) ? (
                    <ToolCalls steps={steps.get(e)!} lead={setupInSteps && i === setupAt ? setupLine : undefined} />
                  ) : choiceRow && choiceRow.pick === undefined ? (
                    <Asking choice={choiceRow.choice} />
                  ) : choiceRow?.pick !== undefined ? (
                    // What was asked and what was picked. font-sans: a card, not log text.
                    <div className="min-w-0 flex-1 font-sans">
                      <AnsweredChoice choice={choiceRow.choice} pick={choiceRow.pick} />
                    </div>
                  ) : e.kind === 'screen' && onOpenScreen && screenRows.live.has(e) ? (
                    <button type="button" onClick={onOpenScreen} className="group/screen flex min-w-0 flex-1 items-center gap-1 text-left text-foreground">
                      <span className="min-w-0 truncate group-hover/screen:underline">{(formatOpenAgentEvent(e) ?? '').trim()}</span>
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    </button>
                  ) : (
                    <span className={`min-w-0 flex-1 whitespace-pre-wrap break-words ${rowTone(e) || 'text-foreground'}`}>
                      {(formatOpenAgentEvent(e) ?? '').trim()}
                    </span>
                  )}
                  {!own && chunkHead && at !== undefined && (
                    <Tooltip>
                      <TooltipTrigger
                        render={<span className={TIME} />}
                      >
                        {formatTime(at)}
                      </TooltipTrigger>
                      <TooltipContent>{new Date(at).toLocaleString()}</TooltipContent>
                    </Tooltip>
                  )}
                </MessageScrollerItem>
                </Fragment>
              )
            })}
            {shown.length === setupAt && setupRow}
            {startedRows(shown.length)}
            {written && (
              <MessageScrollerItem messageId="writing" className="-mx-1.5 flex items-start gap-2 rounded-sm px-1.5">
                <Reply text={written} />
              </MessageScrollerItem>
            )}
            {/* The last turn's files, once it has ended: while the agent works the list still grows.
                With a message just sent they are above that message, in the rows. */}
            {!working && sending === undefined && changes.last.length > 0 && (
              <MessageScrollerItem messageId="changes-last" className="-mx-1.5 flex items-start gap-2 rounded-sm px-1.5">
                <ChangedFiles files={changes.last} onOpen={onOpenChange} />
              </MessageScrollerItem>
            )}
            {/* The live line's place is kept when it has nothing to say (a message being written,
                the agent's turn over): nothing under it moves up when it goes, nor down when it comes. */}
            {shown.length > 0 && (
              <div data-testid="live-line" className="-mx-1.5 flex min-h-5 shrink-0 items-center gap-2 rounded-sm px-1.5">
                {working && !written && !settingUp && <LiveLine call={current} word={starting ? 'Starting…' : 'Working…'} since={turnStart} />}
              </div>
            )}
            {!working && waitingOn > 0 && (
              <MessageScrollerItem messageId="waiting-on" className="-mx-1.5 flex items-center gap-2 rounded-sm px-1.5">
                <LiveLine word={`Waiting for ${waitingOn} ${waitingOn === 1 ? 'subagent' : 'subagents'}`} />
              </MessageScrollerItem>
            )}
            {queued.map((text, at) => (
              <MessageScrollerItem key={`queued-${at}`} messageId={`queued-${at}`} className="-mx-1.5 flex items-start gap-2 rounded-sm px-1.5">
                <Prompt text={text} queued fresh />
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
