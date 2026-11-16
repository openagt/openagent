import { useContext, useState, type ReactNode } from 'react'
import type { Intervention } from '../../src/index.js'
import { interventionKey } from '../../src/client.js'
import { Row } from './ui/list.js'
import { RunMark } from './RunMark.js'
import { formatRelative } from '../lib/format-date.js'
import { OnComputer } from './MachineMark.js'
import { HostServicesContext, INERT_HOST_SERVICES } from '../lib/host-services.js'

/**
 * What a person does next for one kind of row, said the same wherever the row is: the Human Queue,
 * the launcher's "Waiting on you", a run's row in the sidebar. "Needs …" rather than a verb, so the
 * word reads as what waits, not as a button that would do it. Work never pushed asks for a pull
 * request where the project can open one, else for a push.
 */
export function needsWord(kind: Intervention['kind'], gitHost = true): string {
  if (kind === 'awaiting') return 'Needs answer'
  if (kind === 'uncommitted') return 'Needs commit'
  if (kind === 'unpushed') return gitHost ? 'Needs PR' : 'Needs push'
  return 'Needs merge'
}

/** How many rows show before the list offers the rest. */
const SHOWN_AT_FIRST = 5

/** What the row adds after the run's name: the question, how much work waits, or the request's number. */
function detailOf(item: Intervention): string | undefined {
  if (item.kind === 'awaiting') return item.question
  if (item.kind === 'uncommitted') return item.files ? (item.files === 1 ? '1 file' : `${item.files} files`) : undefined
  // An unknown count says nothing rather than the contradictory "0 commits".
  if (item.kind === 'unpushed') return item.commits ? (item.commits === 1 ? '1 commit' : `${item.commits} commits`) : undefined
  return `#${item.number}`
}

/** Where a click on the row takes the person, said on its hover. */
function hoverOf(item: Intervention): string {
  if (item.kind === 'awaiting') return 'Open the session to answer'
  if (item.kind === 'uncommitted') return 'Open the session: it left files uncommitted'
  if (item.kind === 'unpushed') return `Open the session: work on ${item.branch ?? ''} is not published`
  return item.agentId ? `Open the session of PR #${item.number}` : `Open PR #${item.number}`
}

/** One row of what waits on the person, as every list of them says it and opens it. */
interface WaitingRow {
  key: string
  item: Intervention
  /** What is needed, in two words: {@link needsWord}. */
  needs: string
  /** What it adds after the run's name: the question, how much work waits, the request's number. */
  detail: string | undefined
  /** Where a click takes the person, and the computer it runs on, said under the pointer. */
  hint: string
  /** How long ago, "2d ago"; empty when not known. */
  since: string
  /** The address a click opens: the session, else the request on the git host. */
  href: string | undefined
  /** A plain click: the session, else the request, else the project. */
  open: () => void
}

/**
 * What waits on the person, row by row, as every list of it says it (the Human Queue, the launcher's
 * "Waiting on you"): the first few, the press that shows the rest, and whether the rows are of
 * several projects, which only then name theirs. Every row opens the session it is about; a request
 * opened anywhere else, by hand or by a session this dashboard never ran, opens on the git host.
 */
function useWaitingRows(items: Intervention[], onOpenAgent: (projectId: string, agentId: string) => void, onOpenProject?: (projectId: string) => void) {
  const services = useContext(HostServicesContext) ?? INERT_HOST_SERVICES
  const [all, setAll] = useState(false)
  // A line that would offer one more row costs as much room as that row: the list shows whole then.
  const hidden = holdsBack(items) ? items.length - SHOWN_AT_FIRST : 0
  const shown = all || hidden === 0 ? items : items.slice(0, SHOWN_AT_FIRST)
  const rows: WaitingRow[] = shown.map(item => {
    const href = item.agentId ? services.agentHref(item.projectId, item.agentId) : item.kind === 'pr' ? item.url : undefined
    return {
      key: interventionKey(item),
      item,
      needs: needsWord(item.kind, item.gitHost),
      detail: detailOf(item),
      hint: item.computer ? `${hoverOf(item)} · runs on ${item.computer.name}` : hoverOf(item),
      since: formatRelative(item.createdAt, ''),
      href,
      open: item.agentId ? () => onOpenAgent(item.projectId, item.agentId!) : item.kind === 'pr' ? () => window.open(item.url, '_blank', 'noreferrer') : () => onOpenProject?.(item.projectId),
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
export function holdsBack(items: readonly Intervention[]): boolean {
  return items.length - SHOWN_AT_FIRST > 1
}

/**
 * The things only a person can clear (#632/#1139), one row each, as the Human Queue and the
 * launcher's "Waiting on you" both list them: the waiting mark and what is needed, in the waiting
 * colour, the run's name as the sidebar says it, then what it is about, its project and how long ago,
 * on the list's right edge: the row's fill under the pointer, its cursor and its focus say it opens.
 * A row is one line, with no rule between rows and no panel around them (his picks). The rows read as
 * columns: what is needed takes the width of the widest word, so every name starts at one place, and
 * the time is set right. The project is named only when the rows are of several: on one project's page
 * every row would say the same word. The first few show, and a line offers the rest, so a long queue
 * does not push everything under it off the page. `empty`: the sentence where the rows would be when
 * nothing waits; without one there is nothing.
 */
export function HumanQueueList({
  items,
  onOpenAgent,
  onOpenProject,
  empty,
}: {
  items: Intervention[]
  onOpenAgent: (projectId: string, agentId: string) => void
  /** For a row that somehow names no run: its project, rather than nothing. */
  onOpenProject?: ((projectId: string) => void) | undefined
  empty?: ReactNode
}) {
  const { rows, more, projects } = useWaitingRows(items, onOpenAgent, onOpenProject)
  if (rows.length === 0) return empty === undefined ? null : <p className="text-sm text-muted-foreground">{empty}</p>
  return (
    // Pulled out by the rows' own inset, so their marks start where the heading does.
    <div className="-mx-3">
      <ul>
        {rows.map(({ key, item, needs, detail, hint, since, href, open }) => (
          <Row
            key={key}
            // The words keep 4.5:1 on the hover's fill: what is quiet at rest is the text's own colour under the pointer.
            className="text-muted-foreground"
            // What is needed is said in the link's own name too, so the keyboard and a screen reader meet it there, once.
            leading={
              <span aria-hidden className="flex items-center gap-2 font-medium text-warning md:w-32">
                <RunMark status="waiting" />
                {needs}
              </span>
            }
            title={
              // Where a click takes the person, on a hover that waits, with the computer it runs on.
              <span title={hint} className="text-foreground">
                <span className="sr-only">{`${needs}: `}</span>
                {item.title}
                {detail !== undefined && <span className="ml-3 font-normal text-muted-foreground group-hover/row:text-foreground">{detail}</span>}
              </span>
            }
            meta={
              <span className="flex items-center gap-2 group-hover/row:text-foreground">
                {/* A run on another of the person's computers is marked by its kind's icon before the
                    project, as the list of runs marks it: a row has no room for its name too. */}
                {item.computer && <OnComputer computer={item.computer} named={false} />}
                {projects && <span>{item.projectName}</span>}
                <span className="min-w-14 text-right tabular-nums">{since}</span>
              </span>
            }
            {...(href !== undefined ? { href } : {})}
            onClick={open}
          />
        ))}
      </ul>
      {more && (
        <button type="button" onClick={more.toggle} className="focus-ring mt-1 rounded-md px-3 py-1 text-sm text-muted-foreground hover:text-foreground">
          {more.words}
        </button>
      )}
    </div>
  )
}
