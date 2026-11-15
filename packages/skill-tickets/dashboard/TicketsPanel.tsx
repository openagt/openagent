import { useState } from 'react'
import { Plus, RefreshCw } from 'lucide-react'
import {
  Badge,
  Button,
  Checkbox,
  Panel,
  PanelGroup,
  PanelRow,
  StartAgentPress,
  StateCell,
  cn,
  formatAge,
  formatDateTime,
  formatRelative,
  useAction,
  useIsMobile,
  useLoaded,
  useModuleHost,
} from '@openagt/dashboard/module'
import { NEW_TICKET, UPDATE_TICKETS_PROMPT, heldBack, readMeta, type TicketsMeta } from '../src/module.js'
import { TicketStartActions } from './TicketStartActions.js'
import type { WorkspaceTicket } from './lib/types.js'
import { parsePriority } from './lib/ticket-priority.js'
import { STAGE_LABEL, STAGE_ORDER, claimWorking, ticketStage, type TicketStageId } from './lib/ticket-stage.js'

/** Captured once: `useLoaded` treats a fresh `{}` literal as a new value on every render. */
const NO_META: TicketsMeta = {}

/** From how many shown tickets a list is grouped by stage, when they stand in more than one. */
export const GROUP_BY_STAGE_FROM = 13

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
}

/** Tickets as one card, or once the list is long and spans stages, a card per stage in the order agents take them. */
export function TicketRows({ rows, ...props }: RowsProps & { rows: readonly ListedTicket[] }) {
  const priorities = rows.some(row => row.ticket.priority !== undefined)
  const stages = STAGE_ORDER.map(stage => ({ stage, rows: rows.filter(row => ticketStage(row.ticket) === stage) })).filter(part => part.rows.length > 0)
  const row = (listed: ListedTicket, showStage: boolean) => (
    <TicketRow key={`${listed.projectId}/${listed.ticket.file}`} listed={listed} priorities={priorities} showStage={showStage} {...props} />
  )
  if (rows.length < GROUP_BY_STAGE_FROM || stages.length < 2) return <Panel aria-label="Tickets">{rows.map(listed => row(listed, true))}</Panel>
  return (
    <div className="space-y-8">
      {stages.map(part => (
        <PanelGroup key={part.stage} title={STAGE_LABEL[part.stage]}>
          {part.rows.map(listed => row(listed, false))}
        </PanelGroup>
      ))}
    </div>
  )
}

/** One ticket as a row; under the pointer its next step takes its facts' place. */
function TicketRow({ listed, priorities, showStage, busy, starting, isSelected, onToggleSelect, onOpen, onStart, onConfigure }: RowsProps & {
  listed: ListedTicket
  /** Whether some ticket of the list has a priority: the column is kept on every row, or on none. */
  priorities: boolean
  /** Said on the row: not where the row's part is named by its stage. */
  showStage: boolean
}) {
  const host = useModuleHost()
  const phone = useIsMobile()
  const { projectId, projectName, ticket } = listed
  const selected = isSelected?.(listed) ?? false
  // A ticket in review, waiting or claimed is not handed to an agent: its row offers no next step.
  const offered = !heldBack(ticket) && !ticket.locked
  const stage = <StageWord ticket={ticket} />
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
      before={priorities ? <Priority value={ticket.priority} /> : undefined}
      title={ticket.title}
      href={host.pageHref('tickets', [ticket.file], projectId)}
      onClick={() => onOpen(listed)}
      meta={phone ? [...(projectName ? [projectName] : []), ...(showStage ? [stage] : [])] : []}
      fact={
        phone ? undefined : (
          <span className="flex items-center gap-3">
            {projectName && <span className="max-w-32 truncate">{projectName}</span>}
            {ticket.topics && ticket.topics.length > 0 && (
              <span className="flex items-center gap-2 max-lg:hidden">
                {ticket.topics.map(topic => (
                  <Badge key={topic}>{topic}</Badge>
                ))}
              </span>
            )}
            {showStage && <span className="w-26">{stage}</span>}
            <span className="w-9 text-right tabular-nums" title={formatDateTime(ticket.date)}>
              {formatAge(ticket.date).replace(/ ago$/, '')}
            </span>
          </span>
        )
      }
      actions={
        offered && !phone ? (
          <span className="-mr-1.5 flex items-center gap-2">
            <TicketStartActions
              compact
              projectId={projectId}
              ticket={ticket}
              busy={busy}
              starting={starting?.projectId === projectId ? starting.prompt : null}
              onStart={(prompt, failure) => onStart(listed, prompt, failure)}
              onConfigure={prompt => onConfigure(listed, prompt)}
            />
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

/** Where a ticket stands, in a word: an agent's claim with its mark (turning while its run is at it), what it waits on in a tooltip. */
export function StageWord({ ticket }: { ticket: WorkspaceTicket }) {
  const stage: TicketStageId = ticketStage(ticket)
  if (stage === 'claimed') {
    const working = claimWorking(ticket)
    const holder = ticket.lockedByAgent?.name ?? ticket.lockedBy
    return (
      <span className={cn('inline-flex items-center gap-1', working && 'font-medium text-info')} title={holder ? `Claimed by ${holder}` : undefined}>
        <StateCell state={working ? 'working' : 'stopped'} />
        {STAGE_LABEL.claimed}
      </span>
    )
  }
  if (stage === 'waiting')
    return (
      <span className="inline-flex items-center gap-1" title={`Waiting: ${ticket.waiting}`}>
        <StateCell state="waiting" />
        {STAGE_LABEL.waiting}
      </span>
    )
  return <span title={stage === 'in-review' && ticket.pr ? `In review: ${ticket.pr.label}` : undefined}>{STAGE_LABEL[stage]}</span>
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
      <p className="text-sm text-muted-foreground" data-project={projectId}>
        No tickets yet. Update them from the tracker, or write one.
      </p>
    )
  return <TicketRows rows={rows} {...props} />
}

/** When `tickets/` last caught up with the issue tracker, from `tickets meta --local`; nothing is read for no project. */
export function useTicketsMeta(projectId: string | null): TicketsMeta {
  const host = useModuleHost()
  return useLoaded<TicketsMeta>(projectId ? async () => readMeta(await host.runCommand(projectId, ['meta', '--local'])) : null, NO_META, [projectId])
}

/** A project's presses at a head's right: when its tickets were last updated, the update, and a new ticket. */
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
      <span className="flex items-center gap-1 text-sm text-faint-foreground">
        <span title={meta.lastImportedAt ? `Updated from the tracker ${formatDateTime(meta.lastImportedAt)}` : 'No import from the tracker on record'}>
          {meta.lastImportedAt ? `Updated ${formatRelative(meta.lastImportedAt)}` : 'Never updated'}
        </span>
        <StartAgentPress
          variant="ghost"
          size="icon-sm"
          icon={<RefreshCw className="size-3.5" aria-hidden />}
          ariaLabel="Update tickets"
          tooltip={
            meta.lastImportedAt
              ? 'An agent brings tickets/ up to date with the issues and comments changed since the last update.'
              : 'An agent brings tickets/ up to date with the issue tracker. With none on record, everything open comes across.'
          }
          busy={busy}
          starting={starting}
          onStart={() => void update()}
          className="text-muted-foreground"
        />
      </span>
      <Button variant={primary ? 'default' : 'ghost'} className={cn(!primary && '-mr-3')} onClick={() => host.openPage('tickets', [NEW_TICKET], projectId)}>
        <Plus className="size-4" aria-hidden /> New ticket
      </Button>
    </>
  )
}
