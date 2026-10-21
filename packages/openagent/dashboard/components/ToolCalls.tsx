import { useEffect, useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { callsSummary, summaryWords, toolCall } from '../lib/tool-calls.js'
import { usePreferences } from '../lib/preferences.js'
import type { FileEdit } from '../lib/turn-changes.js'
import { LinesPill } from './ChangedFiles.js'
import { cn } from '../lib/utils.js'
import { formatElapsed } from '../lib/format-date.js'
import { Markdown } from './Markdown.js'

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
  return <span className="shrink-0 tabular-nums">{formatElapsed(now - Date.parse(since))}</span>
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
function CallLine({ label, detail, whole, summary, output, live }: Call & { live?: { since: string | undefined } }) {
  const [open, setOpen] = useState(false)
  const call = toolCall(label, detail, output?.changed)
  const given = whole ?? call.detail
  const said = call.kind === 'command' ? summary : undefined
  const words = (
    <>
      {said !== undefined ? (
        <span className={cn('truncate', live && 'text-shimmer')}>{said}</span>
      ) : (
        <>
          <span className={cn('shrink-0', live && 'text-shimmer')}>{live ? call.doing : call.verb}</span>
          {call.target !== undefined && <span className={cn('truncate', live ? 'text-shimmer' : 'text-foreground')}>{call.target}</span>}
        </>
      )}
      {call.size !== undefined && <LinesPill {...call.size} />}
      {live?.since !== undefined && <Seconds since={live.since} />}
    </>
  )
  if (given === undefined && output === undefined) return <div className="flex min-w-0 items-center gap-1.5">{words}</div>
  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-label={said ?? [live ? call.doing : call.verb, call.target].filter(Boolean).join(' ')}
        className="flex max-w-full min-w-0 items-center gap-1.5 text-left hover:text-foreground"
      >
        {words}
        <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-90')} aria-hidden />
      </button>
      {open && (
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
      )}
    </div>
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
        <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-90')} aria-hidden />
      </button>
      {open && (
        <div className="mt-1 italic">
          <Markdown text={text} compact />
        </div>
      )}
    </div>
  )
}

// The last line of the chat while the agent works, in place of a spinner: the call going on now
// ("Running pnpm test 9s"). Moving dots in front, the text shimmering, the seconds counting from
// the start of the turn (`since`), so the count goes on from one step to the next. When the line
// names a new step, its words come in out of a light blur instead of swapping at once.
//
// Between two calls — while it thinks, while its reply streams — there is no step to name, and the
// line is the dots and the seconds, as Claude Code on the web's is. A word standing in for the step
// ("Working…") said no more than the dots already do, and read as a step that was not one.
// `word` is for a line that is about something else: waiting on subagents.
export function LiveLine({ call, word, since }: { call?: Call | undefined; word?: string | undefined; since?: string | undefined }) {
  return (
    <div role="status" className="flex min-w-0 flex-1 items-center gap-2 font-sans text-sm text-muted-foreground">
      <Dots />
      <span key={call ? (call.id ?? `${call.label} ${call.detail ?? ''}`) : word} className="morph-in flex min-w-0 items-center gap-2">
        {call ? (
          <CallLine {...call} live={{ since }} />
        ) : (
          <>
            {word !== undefined && <span className="text-shimmer">{word}</span>}
            {since !== undefined && <Seconds since={since} />}
          </>
        )}
      </span>
    </div>
  )
}

// The agent's steps between two messages, as Claude Code on the web draws them: one grey line
// counting the commands and naming the file the edits changed with how much ("Ran 2 commands,
// edited README.md +12 −54"), opening to one bordered panel with a row per step, a line between
// two rows, each row opening further. `lead` is a row the panel opens with: the session's
// set-up, before the first turn's steps. A lone call with nothing to lead it is its own line
// ("Read AGENTS.md"). A run with no call in it draws nothing.
export function ToolCalls({ steps, lead }: { steps: readonly ToolStep[]; lead?: ReactNode }) {
  const [open, setOpen] = useState(false)
  // What the agent thought between two calls is not a step it took, and Claude Code on the web's
  // panel has none of it. Shown only to a person who asked for it in Settings.
  const thinking = usePreferences().showThinking === true
  const shown = thinking ? steps : steps.filter(step => step.type === 'action')
  const calls = steps.filter(step => step.type === 'action')
  if (calls.length === 0) return null
  const summary = callsSummary(calls.map(call => toolCall(call.label, call.detail, call.output?.changed)))
  const words = summaryWords(summary)
  const only = shown.length === 1 ? shown[0] : undefined
  if (only?.type === 'action' && !lead) {
    return (
      <div className="min-w-0 flex-1 font-sans text-sm text-muted-foreground">
        <CallLine {...only} />
      </div>
    )
  }
  return (
    <div className="min-w-0 flex-1 font-sans text-sm text-muted-foreground">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-label={words} className="flex items-center gap-1.5 py-0.5 hover:text-foreground">
        <span className="shrink-0 text-left">{summary.words}</span>
        {summary.target !== undefined && <span className="min-w-0 truncate text-foreground">{summary.target}</span>}
        {summary.size !== undefined && <LinesPill {...summary.size} />}
        <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-90')} aria-hidden />
      </button>
      {open && (
        <div className="mt-1.5 flex flex-col divide-y divide-border rounded-lg border border-border">
          {lead && <div className="px-2 py-1.5">{lead}</div>}
          {shown.map((step, at) => (
            <div key={at} className="px-2 py-1.5">
              {step.type === 'action' ? <CallLine {...step} /> : <ThoughtLine text={step.text} />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
