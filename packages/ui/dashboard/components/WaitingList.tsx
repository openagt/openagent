import { useContext, useState, type ComponentType, type ReactNode } from 'react'
import { ArrowRight, CircleDot, CircleHelp, FilePen, GitBranch, GitPullRequest } from 'lucide-react'
import type { Waiting } from '../../src/index.js'
import { waitingKey } from '../../src/client.js'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip.js'
import { cn } from '../lib/utils.js'
import { inPlace } from '../lib/in-place.js'
import { formatRelative } from '../lib/format-date.js'
import { HostServicesContext, INERT_HOST_SERVICES } from '../lib/host-services.js'

/** How many rows show before the list offers the rest. */
const SHOWN_AT_FIRST = 5

/** Each mark's icon and colour: what is needed reads at a glance. */
const MARKS: Record<NonNullable<Waiting['mark']>, { Icon: ComponentType<{ className?: string }>; tone: string }> = {
  question: { Icon: CircleHelp, tone: 'text-warning' },
  changes: { Icon: FilePen, tone: 'text-info' },
  branch: { Icon: GitBranch, tone: 'text-info' },
  'pull-request': { Icon: GitPullRequest, tone: 'text-success' },
}

/** An item that names no mark: a plain dot, quiet. */
const PLAIN = { Icon: CircleDot, tone: 'text-muted-foreground' }

/** What an item needs, as its colour says it, the same in every list of what waits: an answer yellow, a merge green, work left blue. */
export function waitingTone(item: Waiting): string {
  return item.mark ? MARKS[item.mark].tone : 'text-warning'
}

/** Where a click on the row takes the person, said on its hover: the session it is about, else the page that fixes it. */
function hoverOf(item: Waiting): string {
  if (item.run !== undefined) return 'Open the session'
  return item.fix !== undefined && 'href' in item.fix ? item.fix.label : 'Open the project'
}

/** The page a row's item opens when it is about no run: a page on the web that fixes it. */
function pageOf(item: Waiting): string | undefined {
  return item.fix !== undefined && 'href' in item.fix ? item.fix.href : undefined
}

/** One row of what waits on the person, as every list of them says it and opens it. */
interface WaitingRow {
  key: string
  item: Waiting
  /** Where a click takes the person, said under the pointer. */
  hint: string
  /** How long ago, "2d ago"; empty when not known. */
  since: string
  /** The address a click opens: the session, else the page that fixes it. */
  href: string | undefined
  /** A plain click: the session, else the page, else the project; nothing for a row that has nowhere to go. */
  open: (() => void) | undefined
}

/**
 * What waits on the person, row by row, as every list of it says it (the Human Queue, the launcher's
 * "Waiting on you"): the first few, the press that shows the rest, and whether the rows are of
 * several projects, which only then name theirs. Every row about a run opens it; a request
 * opened anywhere else, by hand or by a session this dashboard never ran, opens on the git host.
 */
function useWaitingRows(items: readonly Waiting[], onOpenAgent: (projectId: string, agentId: string) => void, onOpenProject?: (projectId: string) => void) {
  const services = useContext(HostServicesContext) ?? INERT_HOST_SERVICES
  const [all, setAll] = useState(false)
  // A line that would offer one more row costs as much room as that row: the list shows whole then.
  const hidden = holdsBack(items) ? items.length - SHOWN_AT_FIRST : 0
  const shown = all || hidden === 0 ? items : items.slice(0, SHOWN_AT_FIRST)
  const rows: WaitingRow[] = shown.map(item => {
    const run = item.run
    const page = pageOf(item)
    return {
      key: waitingKey(item),
      item,
      hint: hoverOf(item),
      since: formatRelative(item.since, ''),
      href: run !== undefined ? services.agentHref(item.projectId, run) : page,
      open: run !== undefined ? () => onOpenAgent(item.projectId, run) : page !== undefined ? () => window.open(page, '_blank', 'noreferrer') : onOpenProject && (() => onOpenProject(item.projectId)),
    }
  })
  return {
    rows,
    /** The press under the rows, while some are held back or all are shown: its words and what it does. */
    more: hidden > 0 ? { words: all ? 'Show fewer' : `Show ${hidden} more`, toggle: () => setAll(!all) } : undefined,
    /** The rows are of several projects: each names its own. */
    projects: new Set(items.map(item => item.projectId)).size > 1,
  }
}

/** Whether the list holds rows back, so its heading says how many there are in all. */
export function holdsBack(items: readonly Waiting[]): boolean {
  return items.length - SHOWN_AT_FIRST > 1
}

/**
 * The things only a person can clear (#632/#1139), one row each, as the Human Queue and the
 * launcher's "Waiting on you" both list them: what is needed, with its mark and colour, the
 * run's name as the sidebar says it, then what it is about, its project, how long ago, and an arrow
 * to where the row goes. A row is one line that lights up under the pointer, with no rule between
 * rows and no panel around them (his picks). The rows read as columns: what is needed takes one
 * width, so every name starts at one place, and the time is set right. The project is named only
 * when the rows are of several: on one project's page every row would say the same word. The first
 * few show, and a line offers the rest, so a long queue does not push everything under it off the
 * page. `empty`: the sentence where the rows would be when nothing waits; without one there is nothing.
 */
export function WaitingList({
  items,
  onOpenAgent,
  onOpenProject,
  empty,
}: {
  items: readonly Waiting[]
  onOpenAgent: (projectId: string, agentId: string) => void
  /** For a row that names no run and no page: its project, rather than nothing. */
  onOpenProject?: ((projectId: string) => void) | undefined
  empty?: ReactNode
}) {
  const { rows, more, projects } = useWaitingRows(items, onOpenAgent, onOpenProject)
  if (rows.length === 0) return empty === undefined ? null : <p className="text-sm text-muted-foreground">{empty}</p>
  const rowClass =
    'focus-ring flex w-full items-center overflow-hidden whitespace-nowrap rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent/40 md:gap-3 max-md:flex-wrap max-md:gap-x-3 max-md:gap-y-0.5'
  return (
    // Pulled out by the rows' own inset, so their marks start where the heading does.
    <div className="-mx-2">
      <ul>
        {rows.map(({ key, item, hint, since, href, open }) => {
          const { Icon, tone } = item.mark ? MARKS[item.mark] : PLAIN
          const row = (
            <>
              <span className={cn('flex w-28 shrink-0 items-center gap-1.5 text-xs max-md:w-auto max-md:flex-1', tone)}>
                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {item.words}
              </span>
              {/* The name and what it is about give up width, each cut short with an ellipsis: in a
                  narrow column the row still fits, and nothing scrolls sideways. On a phone each
                  has a line of its own under what is needed, where, and since when. */}
              <span className="min-w-0 shrink truncate text-foreground md:max-w-[50%] max-md:order-1 max-md:basis-full">{item.title}</span>
              {/* A count is never cut; a question keeps room for its first words. */}
              <span className={cn('truncate text-muted-foreground md:grow max-md:order-2 max-md:basis-full', item.mark === 'question' ? 'max-md:min-w-0 md:min-w-24' : 'min-w-0 shrink-0')}>{item.detail}</span>
              {projects && <span className="shrink-0 text-xs text-muted-foreground">{item.projectName}</span>}
              <span className="min-w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{since}</span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            </>
          )
          // A row with nowhere to go is no press: it only says what waits.
          if (open === undefined) {
            return (
              <li key={key}>
                <div className={cn(rowClass, 'hover:bg-transparent')}>{row}</div>
              </li>
            )
          }
          return (
            <li key={key}>
              <Tooltip>
                <TooltipTrigger
                  render={
                    href !== undefined ? (
                      <a href={href} {...(item.run !== undefined ? { onClick: inPlace(open) } : { target: '_blank', rel: 'noreferrer' })} className={rowClass} />
                    ) : (
                      <button type="button" onClick={open} className={rowClass} />
                    )
                  }
                >
                  {row}
                </TooltipTrigger>
                <TooltipContent>{hint}</TooltipContent>
              </Tooltip>
            </li>
          )
        })}
      </ul>
      {more && (
        <button type="button" onClick={more.toggle} className="focus-ring mt-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
          {more.words}
        </button>
      )}
    </div>
  )
}
