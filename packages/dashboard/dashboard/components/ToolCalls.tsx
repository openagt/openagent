import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { callsSummary, doingOf, summaryWords, toolCall } from '../lib/tool-calls.js'
import { usePreferences } from '../lib/preferences.js'
import type { FileEdit } from '../lib/turn-changes.js'
import { LinesPill } from './ChangedFiles.js'
import { cn } from '../lib/utils.js'
import { formatElapsed } from '../lib/format-date.js'
import { Markdown } from './Markdown.js'
import { CrossFade } from './CrossFade.js'

/** What a tool call gave back: what it printed, cut by the driver, whether it failed, and the files it changed. */
export interface CallOutput {
  text: string
  failed?: true
  exitCode?: number
  changed?: readonly FileEdit[]
}

/**
 * A tool call: its name, what it was given on one line (`detail`) and whole (`whole`), the coding
 * agent's own few words for it (`summary`), what it gave back.
 */
export interface Call {
  label: string
  detail?: string
  whole?: string
  summary?: string
  id?: string
  output?: CallOutput
}

/** One step of the coding agent between two messages: a tool call, or what it thought. */
export type ToolStep = ({ type: 'action' } & Call) | { type: 'thought'; text: string }

// How long ago `since` was, counted up every second: "9s", then "1m 5s".
export function Seconds({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [])
  const ms = now - Date.parse(since)
  // The first second says nothing, as Claude Code on the web's counter does: "0s", "1s" and then "2s" is a line that has just begun, said as a count.
  if (ms < 2000) return null
  return <span className="shrink-0 tabular-nums">{formatElapsed(ms)}</span>
}

// Three dots moving in a wave: the agent is at it.
export function Dots() {
  return (
    <span className="dot-wave shrink-0" aria-hidden>
      <span />
      <span />
      <span />
    </span>
  )
}

/** A thought's opening line, for the one row the panel gives it: its first sentence, cut short. */
function firstWords(text: string): string {
  const line = text.trim().split('\n').find(part => part.trim() !== '')?.trim() ?? 'Thought'
  return line.length > 90 ? `${line.slice(0, 90).trimEnd()}…` : line
}

// A box of an opened call: the page's code font, and it scrolls once it is taller than its limit.
const BOX = 'max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md px-2.5 py-1.5 font-mono text-xs text-foreground'

// One tool call: the verb in grey, what it was done to in dark, on one line. A command the coding
// agent said in a few words of its own reads as those words ("List project files"), the command
// itself one click further. With a detail or an output it opens, on a click: the detail whole in a
// box (a command with "$" in front) and, under it, what the call printed, in a box that scrolls; a
// call that failed says so, with its exit code when it has one. A call still going on (`live`)
// reads in the present ("Running"), shimmers, and counts the seconds when it says since when.
/** The calls that start a subagent: their detail is the task the agent wrote for it. */
const SUBAGENT_CALLS = new Set(['Agent', 'Task'])

function CallLine(call: Call) {
  const [open, setOpen] = useState(false)
  const { words, label, opens } = callWords(call, false)
  if (!opens) return <div className="flex min-w-0 items-center gap-1.5">{words}</div>
  return (
    <div className="min-w-0">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-label={label} className="flex max-w-full min-w-0 items-center gap-1.5 text-left hover:text-foreground">
        {words}
        <Caret open={open} />
      </button>
      {open && <CallDetail {...call} />}
    </div>
  )
}

/**
 * A call's words on its line: what the agent wrote about it, else the verb and what it was done to,
 * with the lines its edits changed; going on (`live`) in the present ("Running", "Finding all
 * markdown files"), and shimmering, else in the past. `opens` when there is more to see on a click.
 */
function callWords({ label, detail, whole, summary, output }: Call, live: boolean): { words: ReactNode; label: string; opens: boolean } {
  const call = toolCall(label, detail, output?.changed)
  // What the agent wrote about the call: a command's description, a subagent's task. While it goes
  // on, said as going on ("Finding all markdown files", "Summarizing README"), as Claude Code on the
  // web's live line says what is being done; a subagent's task the agent wrote only as a noun keeps
  // the line's own words ("Starting agent …").
  const written = call.kind === 'command' ? summary : SUBAGENT_CALLS.has(label) && live ? (detail !== undefined ? doingOf(detail) : undefined) : undefined
  const said = written !== undefined && live ? (doingOf(written) ?? written) : written
  const words = (
    <>
      {said !== undefined ? (
        <span className={cn('truncate', live && 'text-shimmer')}>{said}</span>
      ) : (
        <>
          <span className={cn('shrink-0', live && 'text-shimmer')}>{live ? call.doing : call.verb}</span>
          {call.target !== undefined && <span className={cn('truncate', live ? 'text-shimmer' : !call.plain && 'text-foreground')}>{call.target}</span>}
        </>
      )}
      {call.size !== undefined && <LinesPill {...call.size} />}
    </>
  )
  return { words, label: said ?? [live ? call.doing : call.verb, call.target].filter(Boolean).join(' '), opens: (whole ?? call.detail) !== undefined || output !== undefined }
}

/** What a call was given and what it gave back, opened under its line. */
function CallDetail({ label, detail, whole, output }: Call) {
  const call = toolCall(label, detail, output?.changed)
  const given = whole ?? call.detail
  return (
    <div className="mt-1 flex flex-col gap-1">
      {given !== undefined && (
        <pre aria-label={call.kind === 'command' ? 'Command' : 'Detail'} className={cn(BOX, 'bg-muted')}>
          {call.kind === 'command' && <span className="select-none text-muted-foreground">$ </span>}
          {given}
        </pre>
      )}
      {output !== undefined && output.text !== '' && (
        <pre aria-label="Output" className={cn(BOX, 'border border-border')}>
          {output.text}
        </pre>
      )}
      {output?.failed && <div className="text-xs text-danger">{output.exitCode !== undefined ? `Failed: exit code ${output.exitCode}` : 'Failed'}</div>}
    </div>
  )
}

/** The small filled arrow at the end of a line that opens, turned down when it is open, as Claude Code on the web's. */
export function Caret({ open = false }: { open?: boolean }) {
  return (
    <svg viewBox="0 0 6 8" aria-hidden className={cn('h-2 w-1.5 shrink-0 fill-current opacity-70 transition-transform', open && 'rotate-90')}>
      <path d="M0 0L6 4L0 8Z" />
    </svg>
  )
}

/**
 * The moving dots in front of what is going on now. From a width where the chat has room on its
 * left they hang there, in front of the words' column, so the words stand where the line's words
 * will stand once it is done; on a phone they come first on the line. They are level with the
 * middle of the words' small letters, a pixel and a half under the middle of the line (measured on
 * the page's 14px font), not with the line's middle, which reads as above the words.
 */
export function LiveDots() {
  return (
    <span className="flex shrink-0 items-center max-sm:relative max-sm:top-[1.5px] sm:absolute sm:top-[calc(50%+1.5px)] sm:right-full sm:mr-2 sm:-translate-y-1/2">
      <Dots />
    </span>
  )
}

// What the agent thought between two calls: no row of the chat, one line inside an opened group.
// The line is the thought's own first words rather than the word "Thought", which said nothing and
// made half the panel's rows read the same; the thought whole is one click further.
function ThoughtLine({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="min-w-0">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-label="Thought" className="flex min-w-0 max-w-full items-center gap-1.5 hover:text-foreground">
        <span className="truncate italic">{firstWords(text)}</span>
        <Caret open={open} />
      </button>
      {open && (
        <div className="mt-1 italic">
          <Markdown text={text} compact />
        </div>
      )}
    </div>
  )
}

// The last line of the chat while the agent works and no step of it is going on: while it thinks,
// while its reply streams, while it starts. Moving dots, and the seconds counting from the start of
// the turn (`since`), so the count goes on from one step to the next. No word stands for what the
// agent does then, as Claude Code on the web has none ("Thinking" said no more than the dots do);
// a step going on is said on its own steps row instead (`ToolCalls`), with the seconds after it.
// The tokens come once the turn has answered something (`tokens`, the caller's to give or not).
// `word` is for a line that is about something else: waiting on subagents.
export function LiveLine({ word, since, tokens }: { word?: string | undefined; since?: string | undefined; tokens?: number | undefined }) {
  return (
    <div role="status" className="relative flex min-w-0 flex-1 items-center gap-2 font-sans text-sm text-muted-foreground">
      <LiveDots />
      {word !== undefined && <span className="text-shimmer">{word}</span>}
      {since !== undefined && <Seconds since={since} />}
      {tokens !== undefined && <TokenCount tokens={tokens} />}
    </div>
  )
}

/** How long a token count takes to count up to its new value. */
const COUNT_MS = 360

/** A token count that counts up to a new value, fast and then slower, as Claude Code on the web's does. */
function TokenCount({ tokens }: { tokens: number }) {
  const [shown, setShown] = useState(() => (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches ? tokens : 0))
  const from = useRef(shown)
  useEffect(() => {
    const start = Math.max(0, from.current)
    if (start === tokens) return
    let frame = 0
    const began = performance.now()
    const step = (now: number) => {
      // A frame's time may be a moment before the count began.
      const t = Math.min(1, Math.max(0, (now - began) / COUNT_MS))
      const value = Math.round(start + (tokens - start) * (1 - (1 - t) ** 3))
      from.current = value
      setShown(value)
      if (t < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [tokens])
  // Nothing to say until it has counted to something.
  if (shown <= 0) return null
  return (
    <span className="flex shrink-0 items-center gap-2 tabular-nums">
      <span aria-hidden>·</span>
      {tokenWords(shown)} tokens
    </span>
  )
}

/** A count of tokens as it is said: "96.9k", "842". */
export function tokenWords(tokens: number): string {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens)
}

// The agent's steps between two messages, as Claude Code on the web draws them: one grey line
// counting the commands and naming the file the edits changed with how much ("Ran 2 commands,
// edited README.md +12 −54"), opening to one bordered panel with a row per step, a line between
// two rows, each row opening further. `lead` is a row the panel opens with: the session's
// set-up, before the first turn's steps. A lone call with nothing to lead it is its own line
// ("Read AGENTS.md"). A run with no call in it draws nothing.
export function ToolCalls({ steps, lead, live }: { steps: readonly ToolStep[]; lead?: ReactNode; live?: { call: Call; since?: string | undefined } | undefined }) {
  const [open, setOpen] = useState(false)
  // What the agent thought between two calls is not a step it took, and Claude Code on the web's
  // panel has none of it. Shown only to a person who asked for it in Settings.
  const thinking = usePreferences().showThinking === true
  const shown = thinking ? steps : steps.filter(step => step.type === 'action')
  const calls = steps.filter(step => step.type === 'action')
  if (calls.length === 0 && !live) return null
  const summary = callsSummary(calls.map(call => toolCall(call.label, call.detail, call.output?.changed)))
  const only = !live && !lead && shown.length === 1 && shown[0]!.type === 'action' ? shown[0] : undefined
  // The row's words: the call going on now, as going on; once it is done, as Claude Code on the
  // web's row does, the same row says the steps it took ("Ran 2 commands"), the old words fading
  // out as the new come in. A row of one call says that call.
  const going = live ? callWords(live.call, true) : undefined
  const one = only ? callWords(only, false) : undefined
  const words = going?.label ?? one?.label ?? summaryWords(summary)
  const head = going ? (
    <CrossFade id={`live:${live!.call.id ?? `${live!.call.label} ${live!.call.detail ?? ''}`}`}>{going.words}</CrossFade>
  ) : one ? (
    <CrossFade id="one">{one.words}</CrossFade>
  ) : (
    <CrossFade id="steps">
      <span className="min-w-0 truncate text-left">
        {summary.parts.map((part, at) => (
          <Fragment key={at}>
            <span className="group-hover/status:text-foreground/80 group-has-focus-visible/status:text-foreground/80">
              {at > 0 && ', '}
              {part.words}
            </span>
            {part.target !== undefined && <span className="text-foreground/80 group-hover/status:text-foreground group-has-focus-visible/status:text-foreground"> {part.target}</span>}
          </Fragment>
        ))}
      </span>
      {summary.size !== undefined && <LinesPill {...summary.size} />}
    </CrossFade>
  )
  const opens = one ? one.opens : true
  return (
    <div className="min-w-0 flex-1 font-sans text-sm text-muted-foreground">
      {/* The pointer anywhere on the line, as wide as the chat, lights its words a step: the
          grey ones to the file's dimmed white, the file to full white, as Claude Code's do. */}
      <div className="group/status relative flex" {...(live ? { role: 'status' } : {})}>
        {live && <LiveDots />}
        {opens ? (
          <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-label={words} className="flex min-w-0 items-center gap-1.5 py-0.5 text-left hover:text-foreground">
            {head}
            {live?.since !== undefined && <Seconds since={live.since} />}
            <Caret open={open} />
          </button>
        ) : (
          <div className="flex min-w-0 items-center gap-1.5 py-0.5">
            {head}
            {live?.since !== undefined && <Seconds since={live.since} />}
          </div>
        )}
      </div>
      {open &&
        (one && only?.type === 'action' ? (
          <CallDetail {...only} />
        ) : (
          <div className="mt-1.5 flex flex-col divide-y divide-border rounded-lg border border-border">
            {lead && <div className="px-2 py-1.5">{lead}</div>}
            {shown.map((step, at) => (
              <div key={at} className="px-2 py-1.5">
                {step.type === 'action' ? <CallLine {...step} /> : <ThoughtLine text={step.text} />}
              </div>
            ))}
            {live && (
              <div className="px-2 py-1.5">
                <div className="flex min-w-0 items-center gap-1.5">{going!.words}</div>
                <CallDetail {...live.call} />
              </div>
            )}
          </div>
        ))}
    </div>
  )
}
