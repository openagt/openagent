import { useState, type ReactNode } from 'react'
import { ExternalLink, ClipboardList, Hammer, Plus } from 'lucide-react'
import { Badge, Button, Checkbox, List, Tooltip, TooltipTrigger, TooltipContent, cn, formatRelative, formatAge, formatDateTime, inPlace, useAction, useLoaded, useModuleHost } from '@openagt/dashboard/module'
import { NEW_TICKET, UPDATE_TICKETS_PROMPT, heldBack, readMeta, type TicketsMeta } from '../src/module.js'
import { TicketStartActions } from './TicketStartActions.js'
import type { WorkspaceTicket } from './lib/types.js'
import { UpdateTicketsButton } from './UpdateTicketsButton.js'
import { priorityTone } from './lib/ticket-priority.js'

/** Captured once: `useLoaded` treats a fresh `{}` literal as a new value on every render. */
const NO_META: TicketsMeta = {}

/**
 * The rows of a tickets list, on the page with no line around them. Laid out by the list's own
 * width (#1144 follow-up): a narrow list puts a row's facts on a second line under its title, so a
 * title is never cut to a word to make room for them.
 */
export function TicketList({ children }: { children: ReactNode }) {
  return <List className="@container">{children}</List>
}

/**
 * One ticket as a row (#697/#1144): the checkbox, the title, then its facts in columns that hold
 * their place from row to row (project in the flat list, topics, claim, effort and uncertainty,
 * priority, age, the plan, the issue), and its next step at the row's right edge.
 *
 * The facts are *siblings* of the title's link, not children: the topic badges and the claim
 * marker filter on click (#1144), and an interactive control nested in a link is invalid HTML.
 */
export function TicketRow({
  projectId,
  ticket,
  projectName,
  busy,
  starting,
  selected,
  onToggleSelect,
  onOpen,
  onStart,
  onConfigure,
  onOpenPlan,
  onTopicClick,
  onClaimedClick,
  onOpenAgent,
}: {
  /** The ticket's project: where its next step starts or is queued. */
  projectId: string
  ticket: WorkspaceTicket
  /** Shown on the row in the flat cross-project list, where the section heading no longer says it. */
  projectName?: string | undefined
  /** Disables the session-starting buttons while a session start is in flight. */
  busy: boolean
  /** The prompt of the start in flight, if any: the button that asks it spins. */
  starting: string | null
  /** Whether the row is picked for the surrounding page's bulk actions — the page owns the
   *  selection, the row only shows and toggles it. Without a toggle handler no checkbox
   *  renders, like the click-to-filter handlers: selection is a page feature, not the row's. */
  selected?: boolean | undefined
  onToggleSelect?: (() => void) | undefined
  onOpen: () => void
  /** Spin up an agent with the row's next step — write the ticket's plan, or with one, work on
   *  the ticket — in the ticket's project; `failure` is what to say when it cannot start and says no more. */
  onStart: (prompt: string, failure: string) => void
  /** The start button's chevron (#1507): the ticket's project launcher, prefilled with its ask. */
  onConfigure: (prompt: string) => void
  onOpenPlan?: (() => void) | undefined
  /** Click-to-filter (#1144): a topic badge adds its topic to the page's filter. Without a
   *  handler the topics render as plain badges. */
  onTopicClick?: ((topic: string) => void) | undefined
  /** Click-to-filter for the claim marker: narrows the page to claimed tickets. */
  onClaimedClick?: (() => void) | undefined
  /** Open the page of the agent holding the claim (#1748), when the lock names one of this project's. */
  onOpenAgent?: ((agentId: string) => void) | undefined
}) {
  // The holder as a person reads it: the agent's session name once it has one, else the id the
  // lock names as written (#1748).
  const holder = ticket.lockedByAgent?.name ?? ticket.lockedBy
  const host = useModuleHost()
  // In review or waiting: no agent is started on it nor on its plan, the tickets skill's own rule;
  // claimed: an agent holds it. Either way the row offers no next step.
  const held = heldBack(ticket)
  const offered = !held && !ticket.locked
  return (
    <li
      className={cn(
        'group/row relative flex flex-wrap items-center gap-x-3 rounded-md px-3 text-sm transition-colors hover:bg-accent has-[[data-cover]:active]:bg-foreground/10',
        'py-1.5 @2xl:h-10 @2xl:flex-nowrap @2xl:py-0',
        selected && 'bg-accent',
      )}
    >
      {/* The selection checkbox, the row's left edge — the list idiom of issue trackers: pick some rows and the
          page's bulk actions narrow to them. Never disabled: selecting is page state, not an
          action, so it costs nothing and can be changed any time. Above the title's cover. */}
      {onToggleSelect && <Checkbox checked={selected ?? false} onCheckedChange={() => onToggleSelect()} aria-label={`Select ${ticket.title}`} className="z-10" />}
      {/* The title's link covers the row, so a click anywhere on it opens the ticket; the row's
          other presses stand above that cover. It takes the row's slack and is cut only by it. */}
      <a
        data-cover
        href={host.pageHref('tickets', [ticket.file], projectId)}
        onClick={inPlace(onOpen)}
        className="min-h-8 min-w-0 flex-1 content-center truncate font-medium outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-primary"
      >
        {ticket.title}
      </a>
      {/* The facts: under the title in a narrow list, in columns beside it in a wide one. */}
      <span className={cn('relative order-last flex min-h-6 basis-full items-center gap-x-3 text-xs text-muted-foreground @2xl:order-none @2xl:basis-auto', onToggleSelect && 'pl-7 @2xl:pl-0')}>
        {projectName && <span className="shrink-0">{projectName}</span>}
        {/* The tags, content-sized and packed against the priority column (#1265): their right edge
            is the aligned one, so rows with one tag and rows with four read as one column. */}
        <span className="flex min-w-0 items-center gap-1.5 @max-2xl:empty:hidden @2xl:flex-1 @2xl:justify-end">
          {ticket.topics?.map(topic =>
            onTopicClick ? (
              <button key={topic} type="button" onClick={() => onTopicClick(topic)} title={`Filter by ${topic}`} className="focus-ring shrink-0 rounded-full">
                <Badge className="transition-colors hover:text-foreground">{topic}</Badge>
              </button>
            ) : (
              <Badge key={topic}>{topic}</Badge>
            ),
          )}
          {/* An agent holds this ticket's `.lock.md` (#1420) — it is planning the ticket or
              implementing it directly; the hammer says "being worked" either way. The holder is
              named inline, not only in the tooltip. When the lock names one of this project's
              agents (#1748) the name is the agent's session name and opens its page; any other
              holder is shown as written. Cut to keep the row aligned; the tooltip keeps the whole name. */}
          {ticket.locked && (
            <Tooltip>
              <TooltipTrigger
                render={
                  ticket.lockedByAgent && onOpenAgent ? (
                    <button type="button" onClick={() => onOpenAgent(ticket.lockedByAgent!.id)} className={CLAIM_CLASS} />
                  ) : onClaimedClick ? (
                    <button type="button" onClick={onClaimedClick} className={CLAIM_CLASS} />
                  ) : (
                    <span className={CLAIM_CLASS} />
                  )
                }
              >
                <Hammer className="size-3.5 shrink-0 text-warning" aria-hidden />
                {holder && <span className="min-w-0 max-w-32 truncate">{holder}</span>}
              </TooltipTrigger>
              <TooltipContent>
                {`Claimed${holder ? ` by ${holder}` : ''} — an agent is working on this ticket (planning it or implementing it).`}
                {ticket.lockedByAgent && onOpenAgent ? " Click to open the agent's page." : onClaimedClick ? ' Click to see all claimed tickets.' : ''}
              </TooltipContent>
            </Tooltip>
          )}
          {/* In review: the pull request that closes it, one click away. Waiting: what it waits on,
              in the tooltip. Either one is why the row offers no start and no plan. */}
          {held === 'in-review' && ticket.pr && (
            <a href={ticket.pr.url} target="_blank" rel="noreferrer" title="In review: this pull request closes the ticket once merged" className="focus-ring shrink-0 rounded-sm hover:underline">
              <Badge tone="info">In review {ticket.pr.label}</Badge>
            </a>
          )}
          {held === 'waiting' && (
            <Badge tone="warning" title={`Waiting: ${ticket.waiting}`}>
              Waiting
            </Badge>
          )}
          {ticket.effort !== undefined && <Badge>Effort: {ticket.effort}</Badge>}
          {ticket.uncertainty !== undefined && <Badge>Uncertainty: {ticket.uncertainty}</Badge>}
        </span>
        {/* Priority and age: fixed widths, kept (and drawn even when empty) so the columns line up
            row to row. The priority is in the text's colour; only a critical one is red, its words saying it too. */}
        <span className={cn('shrink-0 tabular-nums @max-2xl:empty:hidden @2xl:w-16 @2xl:text-right', priorityTone(ticket.priority))}>
          {ticket.priority ? `Priority ${ticket.priority}` : ''}
        </span>
        <span className="shrink-0 tabular-nums @2xl:w-14 @2xl:text-right" title={formatDateTime(ticket.date)}>
          {formatAge(ticket.date)}
        </span>
        {/* The plan, when there is one to read. The same width with no plan keeps the columns lined up. */}
        <span className="flex shrink-0 justify-center @max-2xl:empty:hidden @2xl:w-7">
          {ticket.planned && (
            <Tooltip>
              <TooltipTrigger
                render={<Button variant="ghost" size="icon-sm" onClick={() => onOpenPlan?.()} disabled={!onOpenPlan} aria-label={`View the plan for ${ticket.title}`} className="text-info" />}
              >
                <ClipboardList className="size-4" aria-hidden />
              </TooltipTrigger>
              <TooltipContent>View the plan</TooltipContent>
            </Tooltip>
          )}
        </span>
        <span className="flex shrink-0 justify-end @max-2xl:empty:hidden @2xl:w-16">
          {ticket.issue && (
            <a href={ticket.issue.url} target="_blank" rel="noreferrer" className="focus-ring inline-flex items-center gap-1 rounded-sm hover:text-foreground hover:underline">
              <ExternalLink className="size-3.5" aria-hidden />
              {ticket.issue.label}
            </a>
          )}
        </span>
      </span>
      {/* The next step (TicketStartActions): Plan with no plan, Start with one; queueing it and
          setting it up first are in its menu. On the row's right edge, shown under the pointer and
          the keyboard (and while its menu is open), always on touch; a fixed width keeps the columns lined up. */}
      <span className="relative flex w-28 shrink-0 items-center justify-end gap-1.5 pointer-fine:opacity-0 pointer-fine:group-hover/row:opacity-100 pointer-fine:group-focus-within/row:opacity-100 pointer-fine:has-[[data-popup-open]]:opacity-100">
        {offered && <TicketStartActions compact projectId={projectId} ticket={ticket} busy={busy} starting={starting} onStart={onStart} onConfigure={onConfigure} />}
      </span>
    </li>
  )
}

/** The claim marker: a quiet fact, its hammer the one colour on it. */
const CLAIM_CLASS = 'focus-ring flex min-w-0 shrink-0 items-center gap-1 rounded-sm hover:text-foreground'

// The tickets list (#697/#1144): the project's `tickets/*.md` as one-liners — priority, topics,
// what the agent already did to it, and how recently, all on the row — so the backlog is scannable
// without opening one. A row opens its detail page (#1144), which is where Queue and the summary
// live, and carries the ticket's next step, now or queued: its plan, or with one, its work (#685). An empty `tickets/` offers to import the project's
// issues instead of just saying "nothing here"; a filled one offers to update it (#1208)
// instead of a re-import re-walking the whole backlog.
export function TicketsPanel({
  projectId,
  tickets,
  hiddenByFilter = 0,
  isSelected,
  onToggleSelect,
  onOpen,
  onOpenPlan,
  onTopicClick,
  onClaimedClick,
  onOpenAgent,
  onClearFilters,
  lead = false,
}: {
  projectId: string | null
  tickets: WorkspaceTicket[]
  /** Whether a row's ticket is picked for the surrounding page's bulk actions — the selection
   *  lives on the page (it spans projects), the panel only threads it to its rows by file.
   *  Absent on a page with nothing to scope to a selection, and the rows then carry no
   *  checkbox, like the click-to-filter handlers. */
  isSelected?: ((file: string) => boolean) | undefined
  onToggleSelect?: ((file: string) => void) | undefined
  /** How many of this project's tickets the caller's filters hid (#1144/#1230). An empty
   *  `tickets` with some hidden reads as "filtered", not as "nothing here" — the import prompt
   *  offers work that has already been done. */
  hiddenByFilter?: number
  /** Open one ticket's detail page (#1144), by its file — the same slug the route uses. */
  onOpen: (file: string) => void
  /** Open one ticket's plan view (#685), by its file — the plan column's link when a `.plan.md`
   *  already exists. Absent when the caller has no plan route to send the reader to. */
  onOpenPlan?: ((file: string) => void) | undefined
  /** Click-to-filter (#1144), threaded to every row; absent on a page with no filters. */
  onTopicClick?: ((topic: string) => void) | undefined
  onClaimedClick?: (() => void) | undefined
  /** Open the page of the agent holding a ticket's claim (#1748), when the lock names one of this project's. */
  onOpenAgent?: ((agentId: string) => void) | undefined
  /** Lets the "N hidden by filters" state clear them right there instead of pointing back up
   *  at the toolbar. */
  onClearFilters?: (() => void) | undefined
  /** The page shows this project alone: its New ticket is the page's one primary press. */
  lead?: boolean | undefined
}) {
  const { busy, error, run } = useAction()
  // Which start is in flight, by its prompt: one `busy` holds every start back, and only this one spins.
  const [starting, setStarting] = useState<string | null>(null)
  const host = useModuleHost()
  // When `tickets/` last caught up with the issue tracker, from `tickets meta --local`. Read here rather than
  // passed down: the cross-project page reads one ticket list per project, and this is the one
  // extra read a section adds.
  const meta = useLoaded<TicketsMeta>(projectId ? async () => readMeta(await host.runCommand(projectId, ['meta', '--local'])) : null, NO_META, [projectId])

  if (!projectId) return null

  // Every "Configure first, then run" on the panel lands in the same place: this project's own
  // launcher, with the button's prompt drafted in, where the model, the run target and the prompt
  // itself can all be changed.
  const configure = (prompt: string) => host.configureRun(projectId, prompt)

  // The dashboard starts the run with the person's own picks and lands on it, so its progress
  // is watchable instead of the panel sitting on stale rows until files land.
  const startSession = async (prompt: string, failure: string) => {
    setStarting(prompt)
    await run(() => host.startRun(projectId, prompt), failure)
    setStarting(null)
  }

  const updateTickets = () => startSession(UPDATE_TICKETS_PROMPT, 'The update could not be started.')
  const newTicket = () => host.openPage('tickets', [NEW_TICKET], projectId)

  if (tickets.length === 0 && hiddenByFilter > 0) {
    // Filtered to nothing, not genuinely empty (#1144/#1230): offering an import here would ask
    // for work already done.
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        <p className="text-muted-foreground">
          {hiddenByFilter} ticket{hiddenByFilter === 1 ? '' : 's'} hidden by the current filters.
        </p>
        {onClearFilters && (
          <Button variant="secondary" onClick={onClearFilters}>
            Clear filters
          </Button>
        )}
      </div>
    )
  }

  if (tickets.length === 0) {
    return (
      <div className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          No tickets yet. Tickets live in <code className="rounded-sm bg-muted px-1 font-mono text-xs">tickets/</code> and are what the agent
          plans from.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <UpdateTicketsButton busy={busy} starting={starting === UPDATE_TICKETS_PROMPT} onStart={() => void updateTickets()} onConfigure={() => configure(UPDATE_TICKETS_PROMPT)} />
          <NewTicketButton onClick={newTicket} primary={lead} />
        </div>
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {/* The same update as the empty state's button (#1501): one command covers both, its empty
          branch being the first import. Here it sits beside the stamp it acts on (#1265), and the
          ticket written by hand is the list's one primary press. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 basis-full text-xs text-muted-foreground sm:flex-1 sm:basis-0 sm:truncate">
          {meta.lastImportedAt
            ? `Updated from the tracker ${formatRelative(meta.lastImportedAt)}`
            : 'No record of an import yet'}
        </span>
        <UpdateTicketsButton
          busy={busy}
          starting={starting === UPDATE_TICKETS_PROMPT}
          onStart={() => void updateTickets()}
          onConfigure={() => configure(UPDATE_TICKETS_PROMPT)}
          lastImportedAt={meta.lastImportedAt}
        />
        <NewTicketButton onClick={newTicket} primary={lead} />
        {error && <p role="alert" className="basis-full text-xs text-danger">{error}</p>}
      </div>
      <TicketList>
        {tickets.map(ticket => (
          <TicketRow
            key={ticket.file}
            projectId={projectId}
            ticket={ticket}
            busy={busy}
            starting={starting}
            selected={isSelected?.(ticket.file) ?? false}
            onToggleSelect={onToggleSelect ? () => onToggleSelect(ticket.file) : undefined}
            onOpen={() => onOpen(ticket.file)}
            onStart={(prompt, failure) => void startSession(prompt, failure)}
            onConfigure={configure}
            onOpenPlan={onOpenPlan ? () => onOpenPlan(ticket.file) : undefined}
            onTopicClick={onTopicClick}
            onClaimedClick={onClaimedClick}
            onOpenAgent={onOpenAgent}
          />
        ))}
      </TicketList>
    </div>
  )
}

/** A ticket written by hand, beside the ones imported from the tracker. */
function NewTicketButton({ onClick, primary = false }: { onClick: () => void; primary?: boolean }) {
  return (
    <Button variant={primary ? 'default' : 'secondary'} onClick={onClick}>
      <Plus className="size-4" aria-hidden /> New ticket
    </Button>
  )
}
