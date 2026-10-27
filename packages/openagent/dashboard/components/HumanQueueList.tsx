import { useState, type ComponentType } from 'react'
import { ArrowRight, CircleHelp, FilePen, GitBranch, GitPullRequest } from 'lucide-react'
import type { Intervention } from '../../src/index.js'
import { interventionKey } from '../../src/client.js'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip.js'
import { cn } from '../lib/utils.js'
import { formatRelative } from '../lib/format-date.js'
import { OnComputer } from './MachineMark.js'

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
export const SHOWN_AT_FIRST = 5

const MARKS: Record<Intervention['kind'], { Icon: ComponentType<{ className?: string }>; tone: string }> = {
  awaiting: { Icon: CircleHelp, tone: 'text-warning' },
  uncommitted: { Icon: FilePen, tone: 'text-info' },
  unpushed: { Icon: GitBranch, tone: 'text-info' },
  pr: { Icon: GitPullRequest, tone: 'text-success' },
}

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
  if (item.kind === 'awaiting') return 'Open the agent to answer'
  if (item.kind === 'uncommitted') return 'Open the session: it left files uncommitted'
  if (item.kind === 'unpushed') return `Open the session: work on ${item.branch ?? ''} is not published`
  return item.agentId ? `Open the session of PR #${item.number}` : `Open PR #${item.number}`
}

/**
 * The things only a person can clear (#632/#1139), one row each, as the Human Queue and the
 * launcher's "Waiting on you" both list them: what is needed, the run's name as the sidebar says it,
 * then what it is about, its project, how long ago, and an arrow to where the row goes. A row is
 * one line that lights up under the pointer, with no rule between rows and no panel around them
 * (his picks). The rows read as columns: what is needed takes the width of the widest word, so
 * every name starts at one place, and the time is set right. The project is named only when the
 * rows are of several: on one project's page every row would say the same word. Every row opens the session it is about; a request opened anywhere else, by
 * hand or by a session this dashboard never ran, opens on the git host. The first few show, and a
 * line offers the rest, so a long queue does not push everything under it off the page.
 */
export function HumanQueueList({
  items,
  onOpenAgent,
  onOpenProject,
  grouped = false,
}: {
  items: Intervention[]
  /** The rows sit under a heading that says their kind (the Overview's card): each says it with its icon alone, on hover in words. */
  grouped?: boolean
  onOpenAgent: (projectId: string, agentId: string) => void
  /** For a row that somehow names no run: its project, rather than nothing. */
  onOpenProject?: ((projectId: string) => void) | undefined
}) {
  const [all, setAll] = useState(false)
  const shown = all ? items : items.slice(0, SHOWN_AT_FIRST)
  const hidden = items.length - SHOWN_AT_FIRST
  const projects = new Set(items.map(item => item.projectId)).size > 1
  return (
    <>
      <ul>
        {shown.map(item => {
          const { Icon, tone } = MARKS[item.kind]
          const detail = detailOf(item)
          const since = formatRelative(item.createdAt, '')
          const row = (
            <>
              {grouped ? (
                <span title={needsWord(item.kind, item.gitHost)} className={cn('flex size-4 shrink-0 items-center justify-center', tone)}>
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                </span>
              ) : (
                <span className={cn('flex w-28 shrink-0 items-center gap-1.5 text-xs max-md:w-auto max-md:flex-1', tone)}>
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  {needsWord(item.kind, item.gitHost)}
                </span>
              )}
              {/* The name and what it is about give up width, each cut short with an ellipsis: in a
                  narrow column the row still fits, and nothing scrolls sideways. On a phone each
                  has a line of its own under what is needed, where, and since when. */}
              <span className={cn('min-w-0 shrink truncate text-foreground md:max-w-[50%]', grouped ? 'max-md:flex-1' : 'max-md:order-1 max-md:basis-full')}>{item.title}</span>
              <span className="min-w-0 truncate text-muted-foreground md:flex-auto max-md:order-2 max-md:basis-full">{detail}</span>
              {/* A run on another of the person's computers is marked by its kind's icon before the
                  project, as the list of runs marks it: a row has no room for its name too. */}
              {item.computer && <OnComputer computer={item.computer} named={false} />}
              {projects && <span className="shrink-0 text-xs text-muted-foreground">{item.projectName}</span>}
              <span className="min-w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{since}</span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            </>
          )
          const rowClass =
            'flex w-full items-center overflow-hidden whitespace-nowrap rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent/40 md:gap-3 max-md:flex-wrap max-md:gap-x-3 max-md:gap-y-0.5'
          return (
            <li key={interventionKey(item)}>
              <Tooltip>
                <TooltipTrigger
                  render={
                    item.kind === 'pr' && !item.agentId ? (
                      <a href={item.url} target="_blank" rel="noreferrer" className={rowClass} />
                    ) : (
                      <button
                        type="button"
                        onClick={() => (item.agentId ? onOpenAgent(item.projectId, item.agentId) : onOpenProject?.(item.projectId))}
                        className={rowClass}
                      />
                    )
                  }
                >
                  {row}
                </TooltipTrigger>
                <TooltipContent>{item.computer ? `${hoverOf(item)} · runs on ${item.computer.name}` : hoverOf(item)}</TooltipContent>
              </Tooltip>
            </li>
          )
        })}
      </ul>
      {hidden > 0 && (
        <button type="button" onClick={() => setAll(!all)} className="mt-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
          {all ? 'Show fewer' : `Show ${hidden} more`}
        </button>
      )}
    </>
  )
}
