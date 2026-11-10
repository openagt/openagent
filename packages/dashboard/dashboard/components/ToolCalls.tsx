import { createContext, Fragment, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { callsSummary, doingOf, doneOf, summaryWords, toolCall, type ToolCall } from '../lib/tool-calls.js'
import { usePreferences } from '../lib/preferences.js'
import type { FileEdit } from '../lib/turn-changes.js'
import { LinesPill } from './ChangedFiles.js'
import { cn } from '../lib/utils.js'
import { formatElapsed } from '../lib/format-date.js'
import { Markdown } from './Markdown.js'
import { CROSS_FADE_MS, CrossFade } from './CrossFade.js'
import { CopyButton } from './ui/copy-button.js'
import { ColouredLines, languageOf, Pieces, useHighlightedIn, type Piece } from '../lib/highlight.js'

/**
 * What a file named in a step does on a click: opens the pane that shows the run's files, on it.
 * Given by the agent's page when a module of its project has such a pane; without it the name is text.
 */
export const OpenFile = createContext<((path: string) => void) | undefined>(undefined)

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

// What an opened call shows, in the page's code font: what it was given scrolls, as does what it
// printed, once taller than their limit.
const CODE = 'max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono text-[13px] leading-[19px]'

/** The calls that start a subagent: their detail is the task the agent wrote for it. */
const SUBAGENT_CALLS = new Set(['Agent', 'Task'])

// One tool call: the verb in grey, what it was done to in dark, on one line. A command the coding
// agent said in a few words of its own reads as those words ("List project files"), the command
// itself one click further. With a detail or an output it opens, on a click: the detail whole in a
// box (a command with "$" in front) and, under it, what the call printed, in a box that scrolls; a
// call that failed says so, with its exit code when it has one. A call still going on (`live`)
// reads in the present ("Running"), shimmers, and counts the seconds when it says since when.
function CallLine(call: Call) {
  const [open, setOpen] = useState(false)
  const openFile = useContext(OpenFile)
  const { words, label, opens } = callWords(call, false, openFile)
  if (!opens) return <div className="flex min-w-0 items-center gap-1.5">{words}</div>
  return (
    <div className="min-w-0">
      <Opens open={open} label={label} onToggle={() => setOpen(o => !o)} className="max-w-full gap-1.5 hover:text-foreground">
        {words}
      </Opens>
      {open && <CallDetail {...call} />}
    </div>
  )
}

/**
 * A line that opens on a click anywhere on it, its caret the button a keyboard opens it with, so
 * a button inside its words, a file's name, is a button of its own: a name opens the file, the
 * rest of the line opens the step, as Claude Code on the web's rows do.
 */
function Opens({ open, label, onToggle, className, children }: { open: boolean; label: string; onToggle: () => void; className?: string; children: ReactNode }) {
  return (
    <div onClick={onToggle} className={cn('flex min-w-0 cursor-pointer items-center text-left select-none', className)}>
      {children}
      <button type="button" aria-expanded={open} aria-label={label} className="flex shrink-0 items-center self-stretch rounded-sm">
        <Caret open={open} />
      </button>
    </div>
  )
}

/** A file's name in a step's words: a click opens the file in the pane beside the chat, and opens nothing else. */
function FileName({ name, path, openFile }: { name: string; path: string; openFile: (path: string) => void }) {
  return (
    <button
      type="button"
      title={`Open ${path}`}
      onClick={event => {
        event.stopPropagation()
        openFile(path)
      }}
      className="min-w-0 truncate rounded-sm text-foreground hover:underline hover:underline-offset-2"
    >
      {name}
    </button>
  )
}

/**
 * A call's words on its line: what the agent wrote about it, else the verb and what it was done to,
 * with the lines its edits changed; going on (`live`) in the present ("Running", "Finding all
 * markdown files"), and shimmering, else in the past. `opens` when there is more to see on a click.
 */
function callWords({ label, detail, whole, summary, output }: Call, live: boolean, openFile?: (path: string) => void): { words: ReactNode; label: string; opens: boolean } {
  const call = toolCall(label, detail, output?.changed)
  // What the agent wrote about the call: a command's description, a subagent's task. While it goes
  // on, said as going on ("Finding all markdown files", "Summarizing README"), as Claude Code on the
  // web's live line says what is being done; a subagent's task the agent wrote only as a noun keeps
  // the line's own words ("Starting agent …"). Once done, said as done ("Waited 10 seconds then
  // listed files"), as Claude Code on the web's row says it.
  const written = call.kind === 'command' ? summary : SUBAGENT_CALLS.has(label) && live ? (detail !== undefined ? doingOf(detail) : undefined) : undefined
  const said = written === undefined ? undefined : live ? (doingOf(written) ?? written) : (doneOf(written) ?? written)
  const words = (
    <>
      {said !== undefined ? (
        <span className={cn('truncate', live && 'text-shimmer')}>{said}</span>
      ) : (
        <>
          <span className={cn('shrink-0', live && 'text-shimmer')}>{live ? call.doing : call.verb}</span>
          {call.target !== undefined &&
            (call.path !== undefined && openFile && !live ? (
              <FileName name={call.target} path={call.path} openFile={openFile} />
            ) : (
              <span className={cn('truncate', live ? 'text-shimmer' : !call.plain && 'text-foreground')}>{call.target}</span>
            ))}
        </>
      )}
      {call.size !== undefined && <LinesPill {...call.size} />}
      {/* A call that failed says so on its row, in red, as Claude Code on the web's does. */}
      {output?.failed && !live && <span className="shrink-0 text-danger">Failed</span>}
    </>
  )
  const named = said ?? [live ? call.doing : call.verb, call.target].filter(Boolean).join(' ')
  return { words, label: output?.failed && !live ? `${named}, failed` : named, opens: (whole ?? call.detail) !== undefined || output !== undefined }
}

/**
 * What a call was given and what it gave back, opened under its line, as Claude Code on the web
 * opens one: on a line of its own, a card naming the tool ("Bash"); in a box of steps, which is
 * the card already, no second one. What it was given is in a box of its own (a command
 * with "$" in front, in the chat's code colours, with a button to copy it), and under it what the
 * call printed, grey and with no box; a call that failed says its exit code when it has one.
 */
function CallDetail({ label, detail, whole, output, card = false }: Call & { card?: boolean }) {
  const call = toolCall(label, detail, output?.changed)
  const read = call.kind === 'read' && call.path !== undefined && output !== undefined ? fileLines(output.text) : undefined
  if (read) return <ReadDetail path={call.path!} read={read} />
  return <GivenDetail label={label} call={call} whole={whole} output={output} card={card} />
}

/** A file's lines as a read gave them back, each after its number ("12\t…"), and what came after them. */
interface FileLines {
  lines: { number: number; text: string }[]
  rest: string
}

/**
 * The numbered lines a read gave back, from the first: Claude Code's Read says each as its number,
 * a tab and the line ("1\t<!DOCTYPE html>"), an empty line as its number alone. A text that does
 * not open with them is no file's lines.
 */
function fileLines(text: string): FileLines | undefined {
  const all = text.split('\n')
  const lines: FileLines['lines'] = []
  let at = 0
  for (; at < all.length; at++) {
    const line = /^\s*(\d+)(?:\t|→|$)(.*)$/.exec(all[at]!)
    if (!line || (lines.length > 0 && Number(line[1]) !== lines.at(-1)!.number + 1)) break
    lines.push({ number: Number(line[1]), text: line[2]! })
  }
  if (lines.length === 0) return undefined
  // The empty line after a file's last newline is no line of it.
  if (lines.length > 1 && lines.at(-1)!.text === '' && at === all.length) lines.pop()
  return { lines, rest: all.slice(at).join('\n').trim() }
}

/**
 * A read, opened as Claude Code on the web opens one: the file's path on a line of its own (a
 * click opens the file beside the chat), and under it the lines it read, numbered and in the
 * chat's code colours, in a box that scrolls once taller than 400px.
 */
function ReadDetail({ path, read }: { path: string; read: FileLines }) {
  const openFile = useContext(OpenFile)
  const coloured = useHighlightedIn(read.lines.map(line => line.text).join('\n'), languageOf(path))
  // The widest number, and the room after it.
  const width = `${String(read.lines.at(-1)!.number).length}ch`
  return (
    <div className="mt-1.5 flex flex-col gap-2.5">
      {openFile ? (
        <button type="button" title={`Open ${path}`} onClick={() => openFile(path)} className="min-w-0 truncate text-left text-[13px] text-foreground hover:underline hover:underline-offset-2">
          {path}
        </button>
      ) : (
        <div className="min-w-0 truncate text-[13px] text-foreground">{path}</div>
      )}
      <div aria-label="File" className="max-h-[400px] overflow-auto rounded-lg border border-border py-1.5 font-mono text-[13px] leading-[19px]">
        {read.lines.map((line, i) => (
          <div key={line.number} className="flex w-max min-w-full whitespace-pre text-foreground">
            <span className="shrink-0 select-none pr-4 pl-3 text-right tabular-nums text-muted-foreground/60" style={{ width: `calc(${width} + 1.75rem)` }}>
              {line.number}
            </span>
            <span className="pr-3">{coloured?.[i] ? <ColouredLine pieces={coloured[i]} /> : line.text || ' '}</span>
          </div>
        ))}
      </div>
      {read.rest !== '' && <pre className={cn(CODE, 'text-muted-foreground')}>{read.rest}</pre>}
    </div>
  )
}

function ColouredLine({ pieces }: { pieces: Piece[] }) {
  return pieces.length === 0 ? ' ' : <Pieces pieces={pieces} />
}

/** What any other call was given, and what it printed. */
function GivenDetail({ label, call, whole, output, card }: { label: string; call: ToolCall; whole: string | undefined; output: CallOutput | undefined; card: boolean }) {
  const given = whole ?? call.detail
  const command = call.kind === 'command' && given !== undefined
  const coloured = useHighlightedIn(command ? given : '', command ? 'shellscript' : undefined)
  return (
    <div className={cn('mt-1.5 flex flex-col gap-1.5', card && 'rounded-xl border border-border px-3 py-3')}>
      {card && <div className="text-sm text-muted-foreground">{label}</div>}
      {given !== undefined && (
        <div className="relative rounded-lg border border-border">
          <pre aria-label={command ? 'Command' : 'Detail'} className={cn(CODE, 'py-1.5 pl-3 pr-10 text-foreground')}>
            {command && <span className="select-none text-muted-foreground">$ </span>}
            {coloured ? <ColouredLines lines={coloured} /> : given}
          </pre>
          <CopyButton text={given} label={command ? 'Copy the command' : 'Copy'} className="absolute top-[7px] right-2" />
        </div>
      )}
      {output !== undefined && output.text !== '' && (
        <pre aria-label="Output" className={cn(CODE, 'mt-1.5 text-muted-foreground')}>
          {output.text}
        </pre>
      )}
      {/* That it failed is on its row; here, the exit code when it has one. */}
      {output?.failed && output.exitCode !== undefined && <div className="text-xs text-danger">Exit code {output.exitCode}</div>}
    </div>
  )
}

/** The small filled arrow at the end of a line that opens, turned down when it is open, as Claude Code on the web's. */
export function Caret({ open = false }: { open?: boolean }) {
  return (
    <svg viewBox="0 0 6 8" aria-hidden className={cn('h-1.5 w-[4.5px] shrink-0 fill-current opacity-70 transition-transform', open && 'rotate-90')}>
      <path d="M0 0L6 4L0 8Z" />
    </svg>
  )
}

/**
 * The moving dots in front of what is going on now, at the start of the words' own column, where
 * the line's words start, with the words after them. They are level with the middle of the words'
 * small letters, a pixel and a half under the middle of the line (measured on the page's 14px
 * font), not with the line's middle, which reads as above the words.
 */
function LiveDots({ leaving = false }: { leaving?: boolean }) {
  return (
    <span className={cn('relative top-[1.5px] flex w-[18px] shrink-0 items-center', leaving && 'dots-leave')}>
      <Dots />
    </span>
  )
}

/**
 * The dots of a line that stops going on (`live` turning false) on the same row: they shrink away
 * while its words cross-fade, so the words glide left into the dots' place rather than jump there,
 * as Claude Code on the web's do (measured: about 30px in 0.2s, with the fade).
 */
export function LeavingDots({ live }: { live: boolean }) {
  const [was, setWas] = useState(live)
  const [leaving, setLeaving] = useState(false)
  if (was !== live) {
    setWas(live)
    setLeaving(!live)
  }
  useEffect(() => {
    if (!leaving) return
    const timer = setTimeout(() => setLeaving(false), CROSS_FADE_MS + 40)
    return () => clearTimeout(timer)
  }, [leaving])
  if (!live && !leaving) return null
  return <LiveDots leaving={leaving} />
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
  const openFile = useContext(OpenFile)
  // What the agent thought between two calls is not a step it took, and Claude Code on the web's
  // panel has none of it. Shown only to a person who asked for it in Settings.
  const thinking = usePreferences().showThinking === true
  const shown = thinking ? steps : steps.filter(step => step.type === 'action')
  const calls = steps.filter(step => step.type === 'action')
  if (calls.length === 0 && !live) return null
  const summary = callsSummary(calls.map(call => ({ ...toolCall(call.label, call.detail, call.output?.changed), ...(call.output?.failed ? { failed: true as const } : {}) })))
  const only = !live && !lead && shown.length === 1 && shown[0]!.type === 'action' ? shown[0] : undefined
  // The row's words: the call going on now, as going on; once it is done, as Claude Code on the
  // web's row does, the same row says the steps it took ("Ran 2 commands"), the old words fading
  // out as the new come in. A row of one call says that call.
  const going = live ? callWords(live.call, true) : undefined
  const one = only ? callWords(only, false, openFile) : undefined
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
      <div className="group/status relative flex items-center gap-2" {...(live ? { role: 'status' } : {})}>
        <LeavingDots live={live !== undefined} />
        {opens ? (
          <Opens open={open} label={words} onToggle={() => setOpen(o => !o)} className="gap-1.5 py-0.5 hover:text-foreground">
            {head}
            {live?.since !== undefined && <Seconds since={live.since} />}
          </Opens>
        ) : (
          <div className="flex min-w-0 items-center gap-1.5 py-0.5">
            {head}
            {live?.since !== undefined && <Seconds since={live.since} />}
          </div>
        )}
      </div>
      {open &&
        (one && only?.type === 'action' ? (
          <CallDetail {...only} card />
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
