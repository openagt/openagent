import { useContext, useState, type ReactNode } from 'react'
import type { Intervention } from '../../src/index.js'
import { interventionKey } from '../../src/client.js'
import { Button } from './ui/button.js'
import { Panel, PanelMore, PanelNote, PanelRow } from './ui/panel.js'
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
  /** It opens on the git host, in a new tab. */
  external: boolean
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
      external: !item.agentId && item.kind === 'pr',
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

/** The press on a row, by its kind: each opens where it is done, the session (its question, its changes and their Publish) or the request. */
const PRESSES: Record<Intervention['kind'], string> = { awaiting: 'Answer', pr: 'Review', unpushed: 'Review', uncommitted: 'Review' }

/**
 * What waits on the person (#632/#1139), one panel of rows, as every list of it draws them (the
 * Overview's Human Queue, the launcher's "Waiting on you"): the waiting mark, the run's name as the
 * sidebar says it, under it what is needed in the waiting colour and what it is about (a question is
 * read whole: two lines before it is cut), its project only when the rows are of several, and at its
 * right how long ago and the press that does what it needs, at rest as under the pointer; on a phone
 * the age gives way to the press. The first few show, and a line offers the rest. `empty`: the
 * sentence where the rows would be when nothing waits; without one there is no panel.
 */
export function WaitingPanel({
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
  if (rows.length === 0 && empty === undefined) return null
  return (
    <Panel>
      {rows.length === 0 && <PanelNote>{empty}</PanelNote>}
      {rows.map(({ key, item, needs, detail, hint, since, href, external, open }) => (
        <PanelRow
          key={key}
          state={<RunMark status="waiting" />}
          title={item.title}
          titleHint={hint}
          meta={[<span className="font-medium text-warning">{needs}</span>, detail, projects && item.projectName, item.computer && <OnComputer computer={item.computer} />]}
          metaLines={2}
          href={href}
          external={external}
          onClick={open}
          fact={since}
          actions={
            <Button variant={item.kind === 'awaiting' ? 'default' : 'secondary'} size="sm" aria-label={`${PRESSES[item.kind]}: ${item.title}`} onClick={open} className="relative">
              {PRESSES[item.kind]}
            </Button>
          }
          actionsAtRest
        />
      ))}
      {more && <PanelMore onClick={more.toggle}>{more.words}</PanelMore>}
    </Panel>
  )
}
