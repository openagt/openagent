import { useEffect, useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { callsSummary, summaryWords, toolCall } from '../lib/tool-calls.js'
import type { FileEdit } from '../lib/turn-changes.js'
import { LinesChanged } from './ChangedFiles.js'
import { cn } from '../lib/utils.js'
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
  const seconds = Math.max(0, Math.floor((now - Date.parse(since)) / 1000))
  return <span className="shrink-0 tabular-nums">{seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`}</span>
}

// Three dots moving from one shape to the next: the agent is at it.
export function Dots() {
  return (
    <span className="dot-shapes shrink-0" aria-hidden>
      <span />
      <span />
      <span />
    </span>
  )
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
      {call.size !== undefined && <LinesChanged {...call.size} />}
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
function ThoughtLine({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="min-w-0">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="flex items-center gap-1.5 hover:text-foreground">
        <span>Thought</span>
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
// ("Running pnpm test 9s"), or, between calls, a word saying it is at it ("Working…"). Moving dots
// in front, the text shimmering, the seconds counting from the start of the turn (`since`), so the
// count goes on from one step to the next. When the line names a new step, its words come in out
// of a light blur instead of swapping at once.
export function LiveLine({ call, word, since }: { call?: Call | undefined; word: string; since?: string | undefined }) {
  return (
    <div role="status" className="flex min-w-0 flex-1 items-center gap-2 font-sans text-sm text-muted-foreground">
      <Dots />
      <span key={call ? (call.id ?? `${call.label} ${call.detail ?? ''}`) : word} className="morph-in flex min-w-0 items-center gap-2">
        {call ? (
          <CallLine {...call} live={{ since }} />
        ) : (
          <>
            <span className="text-shimmer">{word}</span>
            {since !== undefined && <Seconds since={since} />}
          </>
        )}
      </span>
    </div>
  )
}

// The agent's steps between two messages, as Claude Code on the web draws them: one grey line for
// the whole run ("Ran 2 commands"), opening to one bordered panel with a row per step, a line
// between two rows, each row opening further. `lead` is a row the panel opens with: the session's
// set-up, before the first turn's steps. A lone call with nothing to lead it is its own line
// ("Read AGENTS.md"). A run with no call in it draws nothing.
export function ToolCalls({ steps, lead }: { steps: readonly ToolStep[]; lead?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const calls = steps.flatMap(step => (step.type === 'action' ? [toolCall(step.label, step.detail, step.output?.changed)] : []))
  if (calls.length === 0) return null
  const summary = callsSummary(calls)
  const only = steps.length === 1 ? steps[0] : undefined
  if (only?.type === 'action' && !lead) {
    return (
      <div className="min-w-0 flex-1 font-sans text-sm text-muted-foreground">
        <CallLine {...only} />
      </div>
    )
  }
  return (
    <div className="min-w-0 flex-1 font-sans text-sm text-muted-foreground">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-label={summaryWords(summary)} className="flex items-center gap-1.5 hover:text-foreground">
        {/* The run in words, part by part, each with the size of its edits when that is known. */}
        <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-left">
          {summary.map((part, at, parts) => (
            <span key={at} className="flex items-center gap-1.5">
              <span>{part.text}</span>
              {part.size !== undefined && <LinesChanged {...part.size} />}
              {at < parts.length - 1 && <span className="-ml-1.5">,</span>}
            </span>
          ))}
        </span>
        <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-90')} aria-hidden />
      </button>
      {open && (
        <div className="mt-1.5 flex flex-col divide-y divide-border rounded-lg border border-border">
          {lead && <div className="px-3 py-2">{lead}</div>}
          {steps.map((step, at) => (
            <div key={at} className="px-3 py-2">
              {step.type === 'action' ? <CallLine {...step} /> : <ThoughtLine text={step.text} />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
