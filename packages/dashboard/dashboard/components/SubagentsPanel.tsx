import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type Ref, type RefObject } from 'react'
import { ChevronRight, Square, X } from 'lucide-react'
import type { AgentMeta, OpenAgentEvent } from '../../src/index.js'
import { onAgent } from '../rpc/reads.js'
import { panesPage } from '../lib/panes.js'
import { revealSubagent, useRevealedSubagent } from '../lib/reveal-change.js'
import { arrange, failureReasons, subagentRows, subagentTranscript, type ListPart, type SubagentRow } from '../lib/subagents.js'
import { formatElapsed } from '../lib/format-date.js'
import { anyModelName, useModels } from '../lib/models.js'
import { runTone, runWord } from '../lib/run-words.js'
import { usePolled } from '../lib/use-async.js'
import { useStop } from '../lib/use-stop.js'
import { FocusHome } from '../lib/focus-home.js'
import { useHold } from '../lib/hold.js'
import { cn } from '../lib/utils.js'
import { Button } from './ui/button.js'
import { Facts } from './ui/panel.js'
import { SentenceShape, Slot } from './ui/slot.js'
import { navRowClass } from './ui/nav-row.js'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip.js'
import { EventList } from './EventList.js'
import { RunMark } from './RunMark.js'
import { Seconds, tokenWords } from './ToolCalls.js'

// The pane of a run's subagents, beside its chat: a calm list of them, one line each (its state's
// mark, its name, how long it worked), what waits on the person and what failed first; and under
// the list the one a row opened, here or in the chat, as Claude Code on the web shows a subagent:
// the whole prompt it was given, what it runs on, what it said and did, and what that came to. Under
// the pointer a working row's time gives way to its Stop, and a card says it whole. A subagent that
// is a run of its own is read from its own log, can be stopped, and its page is one click away; one
// the coding agent started inside its session is read out of the main agent's log, where its events
// are, and has no page, no branch and no Stop of its own.

/** How often a working subagent's own log is read again: the runs poll's own pace. */
const TRANSCRIPT_EVERY_MS = 2_000
/** How often an ended one's is: it should change no more, and each read is its whole log. */
const ENDED_EVERY_MS = 60_000
const NO_EVENTS: OpenAgentEvent[] = []
/**
 * How far a row's card stands from the row: 6 from the pane's edge, as every card stands from what
 * it points at, the row being 9 inside that edge (the pane's 1 of border and the list's 8).
 */
const CARD_OFFSET = 6 + 1 + 8

export function SubagentsPanel({
  projectId,
  agentId,
  events,
  subagents,
  live,
  onOpenAgent,
}: {
  projectId: string
  /** The main agent. */
  agentId: string
  /** The main agent's log. */
  events: readonly OpenAgentEvent[]
  /** The runs started for the main agent. */
  subagents: readonly AgentMeta[]
  /** Whether the main agent's process is working. */
  live: boolean
  /** Open a run's own page. */
  onOpenAgent?: ((agentId: string) => void) | undefined
}) {
  const page = panesPage(projectId, agentId)
  const asked = useRevealedSubagent(page)
  const rows = useMemo(() => subagentRows(subagents, events, live), [subagents, events, live])
  const reasons = useMemo(() => failureReasons(events, subagents), [events, subagents])
  const shown = rows.find(row => row.key === asked?.key)
  const list = useRef<HTMLDivElement>(null)
  const fold = useRef<HTMLButtonElement>(null)
  // What had the keyboard when the part was asked for: the row that opened it, here or in the chat.
  const opener = useRef<Element | null>(null)
  useLayoutEffect(() => {
    if (asked?.key !== undefined) opener.current = document.activeElement
  }, [asked])
  // The pane is the home of what a press in it takes away. Closed, the part's keyboard goes back to
  // what opened it, if that is still on the page; else to its row in the list; else, with that row
  // inside the closed fold, to the fold's line. A run stopped from its row loses its Stop and moves
  // under Ended, drawn anew: the keyboard goes to its row there.
  const back = useRef<{ opener?: Element | null; key: string } | undefined>(undefined)
  const landing = useMemo<RefObject<HTMLElement | null>>(
    () => ({
      get current() {
        const to = back.current
        if (to === undefined) return null
        if (to.opener instanceof HTMLElement && to.opener.isConnected && to.opener !== document.body) return to.opener
        return rowOf(list.current, to.key) ?? fold.current
      },
    }),
    [],
  )
  return (
    <FocusHome className="flex min-h-0 flex-1 flex-col" landing={landing}>
      <SubagentList
        ref={list}
        fold={fold}
        page={page}
        rows={rows}
        reasons={reasons}
        shown={shown?.key}
        projectId={projectId}
        onPick={key => revealSubagent(page, key === shown?.key ? undefined : key)}
        onStop={key => (back.current = { key })}
        className={shown ? 'max-h-1/2 shrink-0' : 'flex-1'}
      />
      {shown && <Shown key={shown.key} row={shown} projectId={projectId} events={events} onOpenAgent={onOpenAgent} onClose={() => {
            back.current = { opener: opener.current, key: shown.key }
            revealSubagent(page)
          }} />}
    </FocusHome>
  )
}

/** The row of `key` in `list`, wherever it stands now. */
function rowOf(list: HTMLElement | null, key: string | undefined): HTMLElement | null {
  return [...(list?.querySelectorAll<HTMLElement>('[data-key]') ?? [])].find(row => row.dataset['key'] === key) ?? null
}

/** Whether `text` is cut where `ref` draws it on one line, read again as its box changes its size. */
function useCut(ref: RefObject<HTMLElement | null>, text: string): boolean {
  const [cut, setCut] = useState(false)
  useLayoutEffect(() => {
    const box = ref.current
    if (!box) return
    const read = () => setCut(box.scrollWidth > box.clientWidth)
    read()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(read)
    observer.observe(box)
    return () => observer.disconnect()
  }, [ref, text])
  return cut
}

/** Whether the person opened the ended ones' fold, by the run's page: theirs once pressed, for the page's life. */
const foldsOpened = new Map<string, boolean>()

/**
 * The run's subagents, by {@link arrange}: what waits on the person, what failed, what works, what
 * ended, those past eight rows folded. While the person is in it, it holds still (`useHold`): a row
 * that ends keeps its place and loses its Stop, so the Stop under the pointer stays its own row's,
 * and the fold neither closes nor opens under the hand; the person's own press on it applies at once.
 */
function SubagentList({ ref, fold, page, rows, reasons, shown, projectId, onPick, onStop, className }: {
  ref: RefObject<HTMLDivElement | null>
  /** The fold's line, while it is drawn. */
  fold: Ref<HTMLButtonElement>
  /** The run's page, which keeps the person's fold. */
  page: string
  rows: readonly SubagentRow[]
  reasons: ReadonlyMap<string, string>
  shown: string | undefined
  projectId: string
  onPick: (key: string) => void
  /** A row's Stop was pressed. */
  onStop: (key: string) => void
  className: string
}) {
  const [endedOpen, setEndedOpen] = useState(() => foldsOpened.get(page) ?? false)
  const pressFold = () => {
    foldsOpened.set(page, !endedOpen)
    setEndedOpen(!endedOpen)
  }
  // Which rows stand in which part, held while the person is in the list; each row drawn from its newest state.
  const held = useHold(ref, useMemo(() => arrange(rows), [rows]))
  const byKey = new Map(rows.map(row => [row.key, row]))
  // Why one failed is said in "Failed" alone: held in another part, a row that failed keeps its one line, so nothing under the hand moves.
  const item = (part: ListPart) => (row: SubagentRow) => (
    <SubagentItem key={row.key} row={row} failed={part === 'Failed'} reason={part === 'Failed' ? reasons.get(row.key) : undefined} open={row.key === shown} projectId={projectId} onPick={onPick} onStop={() => onStop(row.key)} />
  )
  return (
    <div ref={ref} className={cn('min-h-0 overflow-y-auto px-2 pt-2', className)}>
      {held.parts.map(({ name, keys }) => {
        const drawn = keys.flatMap(key => byKey.get(key) ?? [])
        if (drawn.length === 0) return null
        return name === 'Ended' && held.folds ? (
          <section key={name} aria-label="Ended" className={PART_CLASS}>
            {/* A row in the list's place: its words on the names' edge. */}
            <button ref={fold} type="button" aria-expanded={endedOpen} onClick={pressFold} className={cn(navRowClass(false), 'text-muted-foreground')}>
              <span aria-hidden className="w-4 shrink-0" />
              <span className="min-w-0 flex-1 text-start">Ended · {drawn.length}</span>
              <ChevronRight aria-hidden className={cn('transition-transform', endedOpen && 'rotate-90')} />
            </button>
            {endedOpen && <ul>{drawn.map(item(name))}</ul>}
          </section>
        ) : (
          <Part key={name} name={name}>
            {drawn.map(item(name))}
          </Part>
        )
      })}
      {/* The list's foot, 16 under its last row: while more is under it, what is cut there fades out rather than ending on a line. */}
      <div aria-hidden className="pointer-events-none sticky bottom-0 h-4 bg-gradient-to-t from-card to-transparent" />
    </div>
  )
}

/**
 * A part after another stands 32 from the rows above it to its name, which stands 8 over its own
 * rows (ui/look/spacing.md 8: a part's name to its card 8, a card to the next part's name 32): the
 * name's line is 32 high, its words in its middle, 8 from either side.
 */
const PART_CLASS = 'not-first:mt-6'

/** A part of the list: its name in the quiet part-name text, over its rows. */
function Part({ name, children }: { name: string; children: ReactNode }) {
  const heading = useId()
  return (
    <section aria-labelledby={heading} className={PART_CLASS}>
      <h3 id={heading} className="flex h-8 items-center px-2 text-xs font-medium text-muted-foreground">
        {name}
      </h3>
      <ul>{children}</ul>
    </section>
  )
}

/**
 * How long a subagent has worked, in the chat's form ("43s", "1m 12s"): counted every second while it
 * works, by the chat's own counter; none for one that is not at work and has no end known.
 */
function Span({ row }: { row: SubagentRow }): ReactNode {
  if (row.working) return <Seconds since={row.startedAt} />
  return row.endedAt !== undefined ? formatElapsed(Date.parse(row.endedAt) - Date.parse(row.startedAt)) : null
}

const capital = (words: string): string => words.charAt(0).toUpperCase() + words.slice(1)

/**
 * One subagent, one line: its state's mark, its name and how long it worked, the compact row of the
 * pane's lists (ui/look/spacing.md 3). A run that failed says why under its name, two lines from its
 * first frame so it does not grow when it is told; a failed call is one line, since nothing says why.
 * Under a fine pointer a working run's time gives way to its Stop; on a phone its Stop is in its open part.
 */
function SubagentItem({ row, failed, reason, open, projectId, onPick, onStop }: {
  row: SubagentRow
  /** Drawn under "Failed". */
  failed: boolean
  reason: string | undefined
  open: boolean
  projectId: string
  onPick: (key: string) => void
  onStop: () => void
}) {
  const models = useModels()
  const runId = row.agent?.id
  const { stopping, error, stop } = useStop(projectId, runId, row.working)
  const stoppable = row.working && runId !== undefined
  const timed = row.working || row.endedAt !== undefined
  const time = useId()
  // Under its name, why it failed; or, on a working one, why its Stop was refused, in the daemon's
  // words and not in a failure's colour: a refusal says nothing of how the subagent stands.
  const second = reason ?? error ?? undefined
  // A run's failure is told it by a line its end sends: its row keeps the room for it from its first frame.
  const twoLines = second !== undefined || (runId !== undefined && failed)
  const model = row.model !== undefined ? <Facts facts={[anyModelName(models, row.model), row.agent?.effort]} className="min-w-0 truncate" /> : undefined
  const name = useRef<HTMLSpanElement>(null)
  // The card says what the row does not: the whole name where the row cuts it, or what it runs on.
  const tells = useCut(name, row.name) || model !== undefined
  return (
    <li className="group/row relative">
      <Tooltip disabled={!tells}>
        <TooltipTrigger
          render={
            <button
              type="button"
              data-key={row.key}
              aria-expanded={open}
              // Its time is what describes it, not its name: a name said again every second floods the ear.
              aria-label={[row.name, runWord(row.status), second].filter(Boolean).join(' · ')}
              aria-describedby={timed ? time : undefined}
              onClick={() => onPick(row.key)}
              className={cn(navRowClass(open), twoLines && 'items-start md:h-12 md:py-1.5 max-md:h-16 max-md:py-3')}
            />
          }
        >
          <span className="flex h-5 w-4 shrink-0 items-center justify-center">
            <RunMark status={row.status} />
          </span>
          <span className="min-w-0 flex-1 text-start">
            <span ref={name} className="block truncate">
              {row.name}
            </span>
            {second !== undefined && <span className={cn('block truncate text-xs max-md:leading-5', reason !== undefined ? runTone('failed') : 'text-muted-foreground')}>{second}</span>}
          </span>
          {timed && (
            <span id={time} className={cn('shrink-0 text-xs leading-5 text-faint-foreground tabular-nums', stoppable && 'pointer-fine:group-hover/row:invisible pointer-fine:group-has-focus-visible/row:invisible')}>
              <Span row={row} />
            </span>
          )}
        </TooltipTrigger>
        {/* The whole name, what it runs on, and how it stands, as T3 Code's card says them; with no model known, its state at the card's left. */}
        <TooltipContent side="left" align="start" sideOffset={CARD_OFFSET} className="grid max-w-72 gap-1 px-4 py-3 text-sm">
          <span className="font-medium break-words">{row.name}</span>
          <span className="flex items-center justify-between gap-4 text-xs text-muted-foreground">
            {model}
            <span className="flex shrink-0 items-center gap-1.5">
              <RunMark status={row.status} className="size-3" />
              {capital(runWord(row.status))}
              {/* Its dot stands with its time: the chat's counter says nothing in a run's first two seconds. */}
              {timed && (
                <span className="tabular-nums empty:hidden before:me-1.5 before:content-['·']">
                  {!row.working && 'ran '}
                  <Span row={row} />
                </span>
              )}
            </span>
          </span>
        </TooltipContent>
      </Tooltip>
      {stoppable && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Stop ${row.name}`}
          loading={stopping}
          onClick={() => {
            onStop()
            stop()
          }}
          className="absolute top-1/2 right-0 -translate-y-1/2 text-danger not-pointer-fine:hidden pointer-fine:opacity-0 pointer-fine:group-hover/row:opacity-100 pointer-fine:group-has-focus-visible/row:opacity-100"
        >
          <Square className="size-3 fill-current" />
        </Button>
      )}
    </li>
  )
}

/** The subagent a row opened, under the list: its name and what can be done with it, over its prompt and what it said and did. */
function Shown({ row, projectId, events, onOpenAgent, onClose }: { row: SubagentRow; projectId: string; events: readonly OpenAgentEvent[]; onOpenAgent?: ((agentId: string) => void) | undefined; onClose: () => void }) {
  const runId = row.agent?.id
  const { stopping, error, stop } = useStop(projectId, runId, row.working)
  // A run's own log, read often while it works. Remembered by the run, so the pane opened again,
  // and the read that goes on when the subagent ends, show what was read from the first frame:
  // without that the pane said it had nothing to show until the read answered.
  const read = usePolled<OpenAgentEvent[]>(
    runId ? () => onAgent(projectId, runId) : null,
    NO_EVENTS,
    row.working ? TRANSCRIPT_EVERY_MS : ENDED_EVERY_MS,
    [projectId, runId, row.working],
    runId ? { remember: `subagent-log:${projectId}:${runId}` } : undefined,
  )
  // A call's transcript is the main agent's events that are its own, shown as plain steps here.
  const callId = row.call?.id
  const ownLog = read.value
  const transcript = useMemo(() => (callId !== undefined ? subagentTranscript(events, callId).map(untagged) : withoutPrompt(ownLog, row.prompt)), [callId, events, ownLog, row.prompt])
  const calls = transcript.filter(e => e.kind === 'driver' && e.event.type === 'action').length
  // Under the prompt, in the log: a note beside it took half the room, and on a phone the prompt's top scrolled away.
  const ending = row.working ? null : transcript.length > 0 ? <PaneFoot row={row} calls={calls} /> : <p className="py-1 font-sans text-sm text-muted-foreground">It left nothing to show.</p>
  return (
    // Its Stop gone once the run stopped, the keyboard stays in it, on its next press.
    <FocusHome as="section" aria-label={row.name} className="flex min-h-0 flex-1 flex-col border-t border-hairline">
      {/* As the pane's own head: its name and its last glyph 16 in. */}
      <header className="flex h-11 shrink-0 items-center gap-1 pr-2 pl-4">
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium">{row.name}</h3>
        {row.working && runId && (
          <Button variant="secondary" size="sm" loading={stopping} onClick={stop}>
            <Square aria-hidden className="size-3 fill-current text-danger" />
            {stopping ? 'Stopping…' : 'Stop'}
          </Button>
        )}
        {runId && onOpenAgent && (
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => onOpenAgent(runId)}>
            Open its page
          </Button>
        )}
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="icon-sm" className="mr-0.5 text-muted-foreground" aria-label={`Close ${row.name}`} onClick={onClose} />}>
            <X className="size-4" />
          </TooltipTrigger>
          <TooltipContent>Close</TooltipContent>
        </Tooltip>
      </header>
      {/* A Stop the daemon refused, in its words, on a line of its own under the head. */}
      {error !== null && <p className="shrink-0 px-4 pb-2 text-sm text-muted-foreground">{error}</p>}
      <div className="flex min-h-0 flex-1 flex-col">
        <EventList
          events={transcript}
          working={row.working}
          stick={row.working}
          openAt="start"
          startedAt={row.startedAt}
          evenEdges
          head={<PaneHead row={row} />}
          tail={runId ? (
            // A run's own log is a read: its room held while unknown, and said to be behind when a read fails.
            <Slot of={read} shape={<SentenceShape />}>
              {() => ending}
            </Slot>
          ) : (
            ending
          )}
        />
      </div>
    </FocusHome>
  )
}

/**
 * What the subagent was told, as a message, and what it runs on ("model · effort", as its card says
 * it). One that did not end well says how.
 * How long it has worked is the log's own moving line at its end, as the chat says it.
 */
function PaneHead({ row }: { row: SubagentRow }) {
  const models = useModels()
  const ended = !row.working && row.status !== 'done'
  return (
    <div className="flex flex-col gap-4 pb-3 font-sans text-sm">
      {row.prompt && (
        // A painted block of the chat's column: its words on the column, its box pulled out to the pane's 16 inset.
        <section aria-label="Its prompt" className="max-h-64 overflow-auto rounded-lg bg-muted px-4 py-3 break-words whitespace-pre-wrap text-foreground md:-mx-4">
          {row.prompt}
        </section>
      )}
      {(row.model !== undefined || ended) && (
        <Facts facts={[row.model !== undefined && anyModelName(models, row.model), row.model !== undefined && row.agent?.effort, ended && <span className={runTone(row.status)}>{runWord(row.status)}</span>]} className="text-muted-foreground" />
      )}
    </div>
  )
}

/** What it came to, under what it said: "2 tool calls · 50.7k tokens · 4s", what it cost and where its work is when it has those. */
function PaneFoot({ row, calls }: { row: SubagentRow; calls: number }) {
  const tools = row.toolUses ?? calls
  const parts = [
    tools > 0 ? `${tools} tool ${tools === 1 ? 'call' : 'calls'}` : undefined,
    row.tokens !== undefined ? `${tokenWords(row.tokens)} tokens` : undefined,
    row.endedAt !== undefined ? formatElapsed(Date.parse(row.endedAt) - Date.parse(row.startedAt)) : undefined,
    row.cost !== undefined ? `$${row.cost.toFixed(2)}` : undefined,
    row.agent?.branch ? `on ${row.agent.branch}` : row.agent?.landed ? 'landed' : undefined,
  ]
  return (
    <p className="py-1 font-sans text-sm text-muted-foreground">
      <Facts facts={parts} />
    </p>
  )
}

/** A run's log without its first prompt when that is the prompt the pane already shows above it. */
function withoutPrompt(events: OpenAgentEvent[], prompt: string | undefined): OpenAgentEvent[] {
  const at = events.findIndex(e => e.kind === 'driver' && e.event.type === 'start')
  const first = events[at]
  return first?.kind === 'driver' && first.event.type === 'start' && first.event.prompt === prompt ? events.filter((_, i) => i !== at) : events
}

/** One of a call's own events without the mark that makes the main agent's chat pass it over. */
function untagged(e: OpenAgentEvent): OpenAgentEvent {
  if (e.kind !== 'driver' || !('subagent' in e.event)) return e
  const { subagent: _subagent, ...event } = e.event
  return { ...e, event } as OpenAgentEvent
}
