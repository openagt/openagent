import { useState } from 'react'
import { Plus } from 'lucide-react'
import {
  Badge,
  Button,
  Checkbox,
  Empty,
  Panel,
  PanelGroup,
  PanelRow,
  RunMark,
  StateCell,
  UpdateTicketsButton,
  cn,
  formatDateTime,
  formatRelative,
  useAction,
  useIsMobile,
  rpcClient,
  useLoaded,
  useModuleHost,
} from '@openagt/ui/module'
import { NEW_TICKET, UPDATE_TICKETS_PROMPT, heldBack, type TicketsMeta } from '../src/module.js'
import { QueuedMark, TicketStartActions, useQueuedAsk } from './TicketStartActions.js'
import type { WorkspaceTicket } from './lib/types.js'
import { parsePriority } from './lib/ticket-priority.js'
import { STAGE_LABEL, STAGE_ORDER, claimStanding, claimWorking, ticketStage, type TicketStageId } from './lib/ticket-stage.js'
import { ticketAge, ticketDay } from './lib/ticket-date.js'

/** Captured once: `useLoaded` treats a fresh `{}` literal as a new value on every render. */
const NO_META: TicketsMeta = {}

/** From how many shown tickets a list is grouped by stage, when they stand in more than one. */
export const GROUP_BY_STAGE_FROM = 13

/** The stages whose word carries a mark: inside their own group the row keeps both, the mark never without its word. */
const MARKED: readonly TicketStageId[] = ['claimed', 'waiting']

/** A ticket of a list, with the project it is in: where its next step starts and where it opens. */
export interface ListedTicket {
  projectId: string
  /** Said on its row where the list spans projects. */
  projectName?: string | undefined
  ticket: WorkspaceTicket
}

/** What every row of a list shares: the selection, the start in flight, and where a row goes. */
export interface RowsProps {
  busy: boolean
  /** The start in flight, by its project and prompt: only that row's press spins. */
  starting: { projectId: string; prompt: string } | null
  /** Whether a row is ticked; none where the page has no selection. */
  isSelected?: ((row: ListedTicket) => boolean) | undefined
  onToggleSelect?: ((row: ListedTicket) => void) | undefined
  onOpen: (row: ListedTicket) => void
  onStart: (row: ListedTicket, prompt: string, failure: string) => void
  onConfigure: (row: ListedTicket, prompt: string) => void
  /** Adds a row's topic to the filters (#1144). */
  onTopic?: ((topic: string) => void) | undefined
  /** Narrows the list to claimed tickets: a claim by none of the project's runs (#1144). */
  onClaimed?: (() => void) | undefined
}

/** Tickets as one card, or once the list is long and spans stages, a card per stage in the order agents take them. */
export function TicketRows({ rows, ...props }: RowsProps & { rows: readonly ListedTicket[] }) {
  const stages = STAGE_ORDER.map(stage => ({ stage, rows: rows.filter(row => ticketStage(row.ticket) === stage) })).filter(part => part.rows.length > 0)
  const row = (listed: ListedTicket, showStage: boolean) => (
    <TicketRow key={`${listed.projectId}/${listed.ticket.file}`} listed={listed} showStage={showStage} {...props} />
  )
  if (rows.length < GROUP_BY_STAGE_FROM || stages.length < 2) return <Panel aria-label="Tickets">{rows.map(listed => row(listed, true))}</Panel>
  return (
    <div className="space-y-8">
      {stages.map(part => (
        <PanelGroup key={part.stage} title={STAGE_LABEL[part.stage]}>
          {part.rows.map(listed => row(listed, MARKED.includes(part.stage)))}
        </PanelGroup>
      ))}
    </div>
  )
}

/** One ticket as a row; under the pointer its next step takes its facts' place. */
function TicketRow({ listed, showStage, busy, starting, isSelected, onToggleSelect, onOpen, onStart, onConfigure, onTopic, onClaimed }: RowsProps & {
  listed: ListedTicket
  /** Said on the row: not where the row's part is named by its stage, unless its word carries a mark. */
  showStage: boolean
}) {
  const host = useModuleHost()
  const phone = useIsMobile()
  const { projectId, projectName, ticket } = listed
  const selected = isSelected?.(listed) ?? false
  // A ticket in review, waiting or claimed is not handed to an agent: its row offers no next step, only what is queued for it.
  const offered = !heldBack(ticket) && !ticket.locked
  const stage = <StageWord ticket={ticket} standing />
  const holder = ticket.lockedByAgent?.name ?? ticket.lockedBy
  // Its next step on the queue: said beside a held row's stage, and on a phone, where no row offers its menu, on every row.
  const queued = useQueuedAsk(projectId, ticket)
  const said = claimSaid(ticket)
  // A claim by one of the project's runs opens that run (#1748); any other narrows the list to claimed (#1144).
  const run = ticket.lockedByAgent
  const claimPress = ticket.locked ? (run ? () => host.openAgent(projectId, run.id) : onClaimed) : undefined
  const startProps = {
    projectId,
    ticket,
    busy,
    starting: starting?.projectId === projectId ? starting.prompt : null,
    onStart: (prompt: string, failure: string) => onStart(listed, prompt, failure),
    onConfigure: (prompt: string) => onConfigure(listed, prompt),
  }
  return (
    <PanelRow
      className={cn(selected && 'bg-foreground/6 before:opacity-0 [&+li]:before:opacity-0')}
      state={
        onToggleSelect && (
          <Checkbox
            checked={selected}
            onCheckedChange={() => onToggleSelect(listed)}
            aria-label={`Select ${ticket.title}`}
            className="z-10"
          />
        )
      }
      // Every row holds the priority's column, one with none too, so the titles are one column in
      // every list, as the rows that wait for the read hold it.
      before={<Priority value={ticket.priority} />}
      title={ticket.title}
      href={host.pageHref('tickets', [ticket.file], projectId)}
      onClick={() => onOpen(listed)}
      meta={phone ? [...(projectName ? [projectName] : []), ...(showStage ? [stage] : []), ...(queued ? [<QueuedMark />] : [])] : []}
      fact={
        phone ? undefined : (
          <span className="flex items-center gap-3">
            {projectName && <span className="max-w-32 truncate">{projectName}</span>}
            {ticket.topics && ticket.topics.length > 0 && (
              <span className="flex items-center gap-2 max-lg:hidden">
                {ticket.topics.map(topic =>
                  onTopic ? (
                    <button key={topic} type="button" title={`Filter by ${topic}`} onClick={() => onTopic(topic)} className={cn(QUIET_PRESS, 'rounded-full')}>
                      <Badge className="transition-colors">{topic}</Badge>
                    </button>
                  ) : (
                    <Badge key={topic}>{topic}</Badge>
                  ),
                )}
              </span>
            )}
            {/* A ticket no agent is handed now offers no next step, only what is queued for it. */}
            {!offered && queued && <QueuedMark />}
            {showStage && (
              <span className="flex w-36">
                {claimPress ? (
                  <button
                    type="button"
                    aria-label={holder ? `Claimed by ${holder}${said !== holder ? `: ${said.toLowerCase()}` : ''}` : 'Claimed'}
                    title={run ? `Claimed by ${holder}: open its run` : `Claimed${holder ? ` by ${holder}` : ''}: show the claimed tickets`}
                    onClick={claimPress}
                    className={cn(QUIET_PRESS, '-mx-1 px-1')}
                  >
                    {stage}
                  </button>
                ) : (
                  stage
                )}
              </span>
            )}
            <span className="w-16 text-right tabular-nums" title={ticketDay(ticket)}>
              {ticketAge(ticket).replace(/ ago$/, '')}
            </span>
          </span>
        )
      }
      actions={
        offered && !phone ? (
          <span className="-mr-1.5 flex items-center gap-2">
            <TicketStartActions compact {...startProps} />
          </span>
        ) : undefined
      }
    />
  )
}

/** A ticket's priority as a list says it, "P8": stronger from 7, red at 10, the act-now end of the scale. */
function Priority({ value }: { value: string | undefined }) {
  const priority = parsePriority(value)
  return (
    <span
      title={priority === undefined ? undefined : `Priority ${priority}`}
      className={cn('w-6 text-right text-xs font-medium tabular-nums', priority === 10 ? 'text-danger' : priority !== undefined && priority >= 7 ? 'text-muted-foreground' : 'text-faint-foreground')}
    >
      {priority === undefined ? '' : `P${priority}`}
    </span>
  )
}

/** A press inside a row: above its link, quiet until a fine pointer is on it. */
const QUIET_PRESS = 'focus-ring relative z-10 rounded-sm pointer-fine:hover:*:text-foreground'

/**
 * Where a ticket stands, in a word of one size, what it waits on in a tooltip. A claim's mark is
 * its run's, and with `standing` (a list's row, where "Claimed" is the group's name or the filter's)
 * its word says how the claim stands too, never by the mark's colour alone ({@link claimSaid}).
 */
export function StageWord({ ticket, standing = false }: { ticket: WorkspaceTicket; standing?: boolean }) {
  const stage: TicketStageId = ticketStage(ticket)
  const holder = ticket.lockedByAgent?.name ?? ticket.lockedBy
  const title = stage === 'claimed' ? (holder ? `Claimed by ${holder}` : undefined) : stage === 'waiting' ? `Waiting: ${ticket.waiting}` : stage === 'in-review' && ticket.pr ? `In review: ${ticket.pr.label}` : undefined
  return (
    <span className={cn('flex min-w-0 items-center gap-1', stage === 'claimed' && claimWorking(ticket) && 'text-info')} title={title}>
      {stage === 'claimed' && <ClaimMark ticket={ticket} />}
      {stage === 'waiting' && <StateCell state="waiting" className="size-3" />}
      <span className="min-w-0 truncate">{stage === 'claimed' && standing ? claimSaid(ticket) : STAGE_LABEL[stage]}</span>
    </span>
  )
}

/**
 * How a claim stands, as the ticket's page says it: its run at work or waiting on the person, or
 * the run ended ("Run done"); a claim held by anything but one of the project's runs, a person or
 * another machine, by its holder's name.
 */
function claimSaid(ticket: WorkspaceTicket): string {
  const holder = ticket.lockedByAgent?.name ?? ticket.lockedBy
  if (!ticket.lockedByAgent || ticket.holderStatus === undefined) return holder ?? STAGE_LABEL.claimed
  const said = claimStanding(ticket.holderStatus)
  return said.charAt(0).toUpperCase() + said.slice(1)
}

/**
 * A claim's mark, of the stage marks' one size: the holding run's own while one of the project's
 * runs holds it (pulsing while it works or waits), a still one for any other holder.
 */
function ClaimMark({ ticket }: { ticket: WorkspaceTicket }) {
  if (!ticket.lockedByAgent || ticket.holderStatus === undefined) return <StateCell state="stopped" className="size-3" />
  return <RunMark status={ticket.holderStatus} className="size-3" />
}

/** One project's tickets on the list: its rows, or why there are none. */
export function TicketsPanel({
  projectId,
  rows,
  error,
  hiddenByFilter = 0,
  onClearFilters,
  ...props
}: RowsProps & {
  projectId: string
  rows: readonly ListedTicket[]
  /** Why the project's tickets could not be read. */
  error?: string | undefined
  /** How many of the project's tickets the filters hide: none shown then reads as filtered, not as an empty backlog. */
  hiddenByFilter?: number
  onClearFilters?: (() => void) | undefined
}) {
  if (error !== undefined)
    return (
      <p role="alert" className="text-sm text-danger">
        Could not read the tickets: {error}
      </p>
    )
  if (rows.length === 0 && hiddenByFilter > 0)
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        <p className="text-muted-foreground">
          {hiddenByFilter} ticket{hiddenByFilter === 1 ? '' : 's'} hidden by the filters.
        </p>
        {onClearFilters && (
          <Button variant="ghost" className="-ml-3" onClick={onClearFilters}>
            Clear filters
          </Button>
        )}
      </div>
    )
  if (rows.length === 0)
    return (
      <Empty title="No tickets yet.">Update them from the tracker, or write one.</Empty>
    )
  return <TicketRows rows={rows} {...props} />
}

/** When `tickets/` last caught up with the issue tracker, from the server part's `meta`, nothing known when it cannot be read; nothing is read for no project. */
export function useTicketsMeta(projectId: string | null): TicketsMeta {
  const host = useModuleHost()
  const server = rpcClient<typeof import('../src/server.js')>(host)
  return useLoaded<TicketsMeta>(projectId ? () => server.meta(projectId, {}).catch((): TicketsMeta => ({})) : null, NO_META, [projectId])
}

/**
 * A project's presses at a head's right: when its tickets were last updated, then "Update tickets", the one
 * button every surface that offers the update draws, its menu setting the run up before it starts; then a
 * new ticket.
 */
export function ProjectTicketsPresses({ projectId, primary = true }: { projectId: string; /** New ticket is the head's primary. */ primary?: boolean }) {
  const host = useModuleHost()
  const meta = useTicketsMeta(projectId)
  const { busy, error, run } = useAction()
  const [starting, setStarting] = useState(false)
  const update = async () => {
    setStarting(true)
    await run(() => host.startRun(projectId, UPDATE_TICKETS_PROMPT), 'The update could not be started.')
    setStarting(false)
  }
  return (
    <>
      {error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
      {/* On a phone the stamp gives way, so the update and New ticket keep one line. */}
      <span title={meta.lastImportedAt ? `Updated from the tracker ${formatDateTime(meta.lastImportedAt)}` : 'No import from the tracker on record'} className="text-sm text-faint-foreground max-md:hidden">
        {meta.lastImportedAt ? `Updated ${formatRelative(meta.lastImportedAt)}` : 'Never updated'}
      </span>
      <UpdateTicketsButton
        variant="secondary"
        busy={busy || starting}
        onStart={() => void update()}
        onConfigure={() => host.configureRun(projectId, UPDATE_TICKETS_PROMPT)}
        lastImportedAt={meta.lastImportedAt}
      />
      <Button variant={primary ? 'default' : 'ghost'} className={cn(!primary && '-mr-3')} onClick={() => host.openPage('tickets', [NEW_TICKET], projectId)}>
        <Plus className="size-4" aria-hidden /> New ticket
      </Button>
    </>
  )
}
