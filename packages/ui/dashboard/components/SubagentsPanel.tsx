import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type Ref, type RefObject } from 'react'
import { ChevronRight, X } from 'lucide-react'
import { useIsMobile } from '../lib/use-mobile.js'
import type { OpenAgentEvent } from '../../src/index.js'
import { panesPage } from '../lib/panes.js'
import { revealSubagent, useRevealedSubagent } from '../lib/reveal-change.js'
import { arrange, subagentRows, subagentTranscript, type SubagentRow } from '../lib/subagents.js'
import { formatElapsed } from '../lib/format-date.js'
import { anyModelName, useAgents } from '../lib/agents.js'
import { runTone, runWord } from '../lib/run-words.js'
import { useCut } from '../lib/use-cut.js'
import { FocusHome } from '../lib/focus-home.js'
import { useHold } from '../lib/hold.js'
import { cn } from '../lib/utils.js'
import { Button } from './ui/button.js'
import { Facts } from './ui/panel.js'
import { navRowClass } from './ui/nav-row.js'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip.js'
import { EventList } from './EventList.js'
import { PaneTitle } from './PaneHeader.js'
import { RunMark } from './RunMark.js'
import { Seconds } from './ToolCalls.js'
import { tokenWords } from './ContextCircle.js'

// The pane of a run's subagents, beside its chat: a calm list of them, one line each (its state's
// mark, its name, how long it worked), what waits on the person and what failed first; and under
// the list the one a row opened, here or in the chat, as Claude Code on the web shows a subagent:
// the whole prompt it was given, what it runs on, what it said and did, and what that came to. A
// card says a row whole. A subagent is one the coding agent started inside its session: it is read
// out of the main agent's log, where its events are, and has no page, no branch and no Stop of its
// own.
/**
 * How far a row's card stands from the row: 6 from the pane's edge, as every card stands from what
 * it points at, the row being 9 inside that edge (the pane's 1 of border and the list's 8).
 */
const CARD_OFFSET = 6 + 1 + 8

export function SubagentsPanel({
  projectId,
  agentId,
  events,
  live,
}: {
  projectId: string
  /** The main agent. */
  agentId: string
  /** The main agent's log. */
  events: readonly OpenAgentEvent[]
  /** Whether the main agent's process is working. */
  live: boolean
}) {
  const page = panesPage(projectId, agentId)
  const asked = useRevealedSubagent(page)
  const rows = useMemo(() => subagentRows(events, live), [events, live])
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
  // inside the closed fold, to the fold's line.
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
        shown={shown?.key}
        onPick={key => revealSubagent(page, key === shown?.key ? undefined : key)}
        // On a phone an opened subagent takes the pane in the list's place, "Subagents" in the pane's head back to the list; beside it the list would be cut.
        className={shown ? 'max-md:hidden md:max-h-1/2 md:shrink-0' : 'flex-1'}
      />
      {shown && <Shown key={shown.key} row={shown} events={events} onClose={() => {
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

/** Whether the person opened the ended ones' fold, by the run's page: theirs once pressed, for the page's life. */
const foldsOpened = new Map<string, boolean>()

/**
 * The run's subagents, by {@link arrange}: what waits on the person, what failed, what works, what
 * ended, those past eight rows folded. While the person is in it, it holds still (`useHold`): a row
 * that ends keeps its place, so the row under the pointer stays the one it was, and the fold neither
 * closes nor opens under the hand; the person's own press on it applies at once.
 */
function SubagentList({ ref, fold, page, rows, shown, onPick, className }: {
  ref: RefObject<HTMLDivElement | null>
  /** The fold's line, while it is drawn. */
  fold: Ref<HTMLButtonElement>
  /** The run's page, which keeps the person's fold. */
  page: string
  rows: readonly SubagentRow[]
  shown: string | undefined
  onPick: (key: string) => void
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
  const item = (row: SubagentRow) => <SubagentItem key={row.key} row={row} open={row.key === shown} onPick={onPick} />
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
            {endedOpen && <ul>{drawn.map(item)}</ul>}
          </section>
        ) : (
          <Part key={name} name={name}>
            {drawn.map(item)}
          </Part>
        )
      })}
      {/* The list's foot, 16 under its last row: while more is under it, what is cut there fades into the pane's ground (flush, the page's) rather than ending on a line.
          On a phone 32: its rows are 44, and a cut between two would leave 16 of fade over the gap alone, with nothing to
          say the list goes on; 32 lays the fade over the next row's name. */}
      <div aria-hidden className="pointer-events-none sticky bottom-0 h-4 bg-gradient-to-t from-background to-transparent max-md:h-8" />
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
 * pane's lists (ui/look/spacing.md 3). One that failed is one line too: nothing says why.
 */
function SubagentItem({ row, open, onPick }: { row: SubagentRow; open: boolean; onPick: (key: string) => void }) {
  const models = useAgents()
  const timed = row.working || row.endedAt !== undefined
  const time = useId()
  const model = row.model !== undefined ? `Model ${anyModelName(models, row.model)}` : undefined
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
              aria-label={[row.name, runWord(row.status)].join(' · ')}
              aria-describedby={timed ? time : undefined}
              onClick={() => onPick(row.key)}
              className={navRowClass(open)}
            />
          }
        >
          <span className="flex h-5 w-4 shrink-0 items-center justify-center">
            <RunMark status={row.status} />
          </span>
          <span ref={name} className="min-w-0 flex-1 truncate text-start">
            {row.name}
          </span>
          {timed && (
            <span id={time} className="shrink-0 text-xs leading-5 text-faint-foreground tabular-nums">
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
    </li>
  )
}

/** The subagent a row opened, under the list: its name over its prompt and what it said and did. */
function Shown({ row, events, onClose }: { row: SubagentRow; events: readonly OpenAgentEvent[]; onClose: () => void }) {
  const phone = useIsMobile()
  // Its transcript is the main agent's events that are its own, shown as plain steps here.
  const callId = row.call.id
  const transcript = useMemo(() => subagentTranscript(events, callId).map(untagged), [callId, events])
  const calls = transcript.filter(e => e.kind === 'driver' && e.event.type === 'action').length
  // Under the prompt, in the log: a note beside it took half the room, and on a phone the prompt's top scrolled away.
  const ending = row.working ? null : transcript.length > 0 ? <PaneFoot row={row} calls={calls} /> : <p className="py-1 font-sans text-sm text-muted-foreground">It left nothing to show.</p>
  return (
    <FocusHome as="section" aria-label={row.name} className="flex min-h-0 flex-1 flex-col md:border-t md:border-hairline">
      {phone ? (
        // On a phone, where it takes the list's place, it is named in the pane's own head, one row of
        // ways back: the pane's arrow to the chat, "Subagents" to all of them.
        <PaneTitle>
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="sm" className="shrink-0 px-2 text-muted-foreground" aria-label="Back to all subagents" onClick={onClose} />}>
              Subagents
            </TooltipTrigger>
            <TooltipContent>All subagents</TooltipContent>
          </Tooltip>
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <h3 className="min-w-0 flex-1 truncate pl-1 text-sm font-medium">{row.name}</h3>
        </PaneTitle>
      ) : (
        // As the pane's own head: its name and its last glyph 16 in.
        <header className="flex h-11 shrink-0 items-center gap-1 pr-2 pl-4">
          <h3 className="min-w-0 flex-1 truncate text-sm font-medium">{row.name}</h3>
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon-sm" className="mr-0.5 text-muted-foreground" aria-label={`Close ${row.name}`} onClick={onClose} />}>
              <X className="size-4" />
            </TooltipTrigger>
            <TooltipContent>Close</TooltipContent>
          </Tooltip>
        </header>
      )}
      <div className="flex min-h-0 flex-1 flex-col">
        <EventList
          events={transcript}
          working={row.working}
          stick={row.working}
          openAt="start"
          startedAt={row.startedAt}
          evenEdges
          head={<PaneHead row={row} />}
          tail={ending}
        />
      </div>
    </FocusHome>
  )
}

/**
 * What the subagent was told, as a message, and what it runs on ("Model …", as its card says it). One
 * that did not end well says how.
 * How long it has worked is the log's own moving line at its end, as the chat says it.
 */
function PaneHead({ row }: { row: SubagentRow }) {
  const models = useAgents()
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
        <Facts facts={[row.model !== undefined && `Model ${anyModelName(models, row.model)}`, ended && <span className={runTone(row.status)}>{runWord(row.status)}</span>]} className="text-muted-foreground" />
      )}
    </div>
  )
}

/** What it came to, under what it said: "2 tool calls · 50.7k tokens · 4s". */
function PaneFoot({ row, calls }: { row: SubagentRow; calls: number }) {
  const tools = row.toolUses ?? calls
  const parts = [
    tools > 0 ? `${tools} tool ${tools === 1 ? 'call' : 'calls'}` : undefined,
    row.tokens !== undefined ? `${tokenWords(row.tokens)} tokens` : undefined,
    row.endedAt !== undefined ? formatElapsed(Date.parse(row.endedAt) - Date.parse(row.startedAt)) : undefined,
  ]
  return (
    <p className="py-1 font-sans text-sm text-muted-foreground">
      <Facts facts={parts} />
    </p>
  )
}

/** One of a call's own events without the mark that makes the main agent's chat pass it over. */
function untagged(e: OpenAgentEvent): OpenAgentEvent {
  if (e.kind !== 'driver' || !('subagent' in e.event)) return e
  const { subagent: _subagent, ...event } = e.event
  return { ...e, event } as OpenAgentEvent
}
