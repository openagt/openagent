import { ExternalLink, ClipboardPlus, ClipboardList, Hammer, Play } from 'lucide-react'
import { Badge, Button, Checkbox, StartAgentButton, Tooltip, TooltipTrigger, TooltipContent, cn, formatRelative, formatAge, formatDateTime, useAction, useLoaded, useModuleHost } from '@openagt/dashboard/module'
import { UPDATE_TICKETS_PROMPT, heldBack, planTicketPrompt, readMeta, workOnTicketPrompt, type TicketsMeta } from '../src/module.js'
import type { WorkspaceTicket } from './lib/types.js'
import { UpdateTicketsButton } from './UpdateTicketsButton.js'
import { priorityTone } from './lib/ticket-priority.js'

/** Captured once: `useLoaded` treats a fresh `{}` literal as a new value on every render. */
const NO_META: TicketsMeta = {}

/**
 * One ticket as a one-liner row (#697/#1144): the start column, title, project (flat mode only),
 * topics, claim, effort/uncertainty, priority, age, the plan column, and the issue link.
 * Extracted from the panel so the flat cross-project list (#1144's Group: none) renders the same
 * row with per-row project context.
 *
 * The metadata cluster is a *sibling* of the row's open button, not a child — same rule as the
 * plan cell and the issue link (an interactive control nested in a button is invalid HTML), and
 * since the topic badges and the claim marker filter on click (#1144), they are controls now.
 */
export function TicketRow({
  ticket,
  projectName,
  busy,
  selected,
  onToggleSelect,
  onOpen,
  onStartWork,
  onConfigureWork,
  onOpenPlan,
  onStartPlan,
  onConfigurePlan,
  onTopicClick,
  onClaimedClick,
  onOpenAgent,
}: {
  ticket: WorkspaceTicket
  /** Shown on the row in the flat cross-project list, where the section heading no longer says it. */
  projectName?: string | undefined
  /** Disables the session-starting buttons while a session start is in flight. */
  busy: boolean
  /** Whether the row is picked for the surrounding page's bulk actions — the page owns the
   *  selection, the row only shows and toggles it. Without a toggle handler no checkbox
   *  renders, like the click-to-filter handlers: selection is a page feature, not the row's. */
  selected?: boolean | undefined
  onToggleSelect?: (() => void) | undefined
  onOpen: () => void
  /** The start column: spin up an agent implementing this one ticket. */
  onStartWork: () => void
  /** Its chevron (#1507): open this ticket's project launcher, prefilled with the same ask. */
  onConfigureWork: () => void
  onOpenPlan?: (() => void) | undefined
  onStartPlan: () => void
  /** The plan column's chevron (#1507): the launcher, prefilled with the plan ask. */
  onConfigurePlan: () => void
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
  // In review or waiting: no agent is started on it nor on its plan, the tickets skill's own rule.
  const held = heldBack(ticket)
  return (
    // On a phone the title is the row's first line, across the whole width, and every control and
    // fact is under it. A class that holds on a phone only is never laid over a plain one
    // of the same kind: the `.flex-1` of a stylesheet loaded later would win over it.
    <li className="flex items-stretch transition-colors hover:bg-accent/60 max-md:flex-wrap max-md:pb-1">
      {/* The selection checkbox, the row's left edge — the list idiom of issue trackers: pick some rows and the
          page's bulk actions narrow to them. Never disabled: selecting is page state, not an
          action, so it costs nothing and can be changed any time. A sibling of the open button
          like every control on the row. */}
      {onToggleSelect && (
        <div className="flex w-8 shrink-0 items-center justify-center">
          <Checkbox checked={selected ?? false} onCheckedChange={() => onToggleSelect()} aria-label={`Select ${ticket.title}`} />
        </div>
      )}
      {/* The start column: one click spins up an agent implementing this
          ticket — the AI Queue card's play button (#855), offered where the backlog is read
          instead of only after queueing. A sibling of the open button like every control on the
          row (an interactive control nested in a button is invalid HTML): starting is not opening.
          Its chevron opens the launcher with the same ask (#1507), since the model and where the
          agent runs are nowhere on this row. */}
      <div className="flex w-16 shrink-0 items-center justify-center">
        {!held && (
          <StartAgentButton
            variant="ghost"
            size="icon-sm"
            icon={<Play className="h-4 w-4" aria-hidden />}
            ariaLabel={`Start work on ${ticket.title}`}
            menuAriaLabel={`Other ways to work on ${ticket.title}`}
            tooltip="Spin up an agent working on this ticket"
            busy={busy}
            onStart={onStartWork}
            onConfigure={onConfigureWork}
            prompt={workOnTicketPrompt(ticket.file)}
            configureDescription="Opens the launcher with this ticket's prompt, so you can set the model and where it runs."
            // Quiet like the plan column's create button: an available action, not a state.
            className="text-muted-foreground/50 hover:text-foreground"
          />
        )}
      </div>
      <button type="button" onClick={onOpen} className="flex min-w-0 items-center gap-2 py-2 pr-3 text-left text-sm md:flex-1 md:pl-0 max-md:order-first max-md:basis-full max-md:pl-3">
        {/* The title is the row's one flexible column: it truncates when long and stretches
            when short, so the whole of a row's slack lands here — the way a table's wide
            first column carries the blank — instead of pooling mid-row between columns. */}
        <span className="min-w-0 flex-1 truncate font-medium">{ticket.title}</span>
      </button>
      {projectName && <span className="flex shrink-0 items-center pr-2 text-xs text-muted-foreground">{projectName}</span>}
      {/* The tags, content-sized and packed against the priority column (#1265): their right edge
          is the aligned one, so rows with one tag and rows with four read as the same
          right-aligned column. Folded away below sm with screen-size classes alone: a bare
          `hidden` undone at a width loses to the `.hidden` of a stylesheet loaded later. */}
      <span className="shrink-0 items-center gap-1.5 max-sm:hidden sm:flex">
        {ticket.topics?.map(topic =>
          onTopicClick ? (
            <button
              key={topic}
              type="button"
              onClick={() => onTopicClick(topic)}
              title={`Filter by ${topic}`}
              className="shrink-0 rounded-full border border-border px-1.5 text-[10px] text-muted-foreground hover:border-foreground/40 hover:text-foreground"
            >
              {topic}
            </button>
          ) : (
            <Badge key={topic} className="shrink-0 border-border px-1.5 text-[10px] text-muted-foreground">
              {topic}
            </Badge>
          ),
        )}
        {/* An agent holds this ticket's `.lock.md` (#1420) — it is planning the ticket or
            implementing it directly; the hammer says "being worked" either way. The holder is
            named inline, not only in the tooltip — a still 1-2s hover is how nobody discovers
            anything. When the lock names one of this project's agents (#1748) the name is the
            agent's session name and opens its page; any other holder is shown as written.
            Truncated to keep the dense row aligned; the tooltip keeps the full name. */}
        {ticket.locked && (
          <Tooltip>
            <TooltipTrigger
              render={
                ticket.lockedByAgent && onOpenAgent ? (
                  <button
                    type="button"
                    onClick={() => onOpenAgent(ticket.lockedByAgent!.id)}
                    className="flex shrink-0 items-center gap-1 text-[10px] text-warning hover:opacity-80"
                  />
                ) : onClaimedClick ? (
                  <button
                    type="button"
                    onClick={onClaimedClick}
                    className="flex shrink-0 items-center gap-1 text-[10px] text-warning hover:opacity-80"
                  />
                ) : (
                  <span className="flex shrink-0 items-center gap-1 text-[10px] text-warning" />
                )
              }
            >
              <Hammer className="h-3.5 w-3.5" aria-hidden />
              {holder && <span className="inline-block max-w-[8rem] truncate">{holder}</span>}
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
          <a
            href={ticket.pr.url}
            target="_blank"
            rel="noreferrer"
            title="In review: this pull request closes the ticket once merged"
            className="shrink-0 rounded-full border border-info/40 px-1.5 text-[10px] text-info hover:opacity-80"
          >
            In review {ticket.pr.label}
          </a>
        )}
        {held === 'waiting' && (
          <span title={`Waiting: ${ticket.waiting}`} className="shrink-0 rounded-full border border-warning/40 px-1.5 text-[10px] text-warning">
            Waiting
          </span>
        )}
        {ticket.effort !== undefined && (
          <Badge className="shrink-0 border-transparent px-1 text-[10px] text-muted-foreground">Effort: {ticket.effort}</Badge>
        )}
        {ticket.uncertainty !== undefined && (
          <Badge className="shrink-0 border-transparent px-1 text-[10px] text-muted-foreground">Uncertainty: {ticket.uncertainty}</Badge>
        )}
      </span>
      {/* Priority and date: snug fixed widths — barely wider than their content, kept fixed (and
          rendered even when empty) so the columns still line up down the table row to row. */}
      <span className={cn('flex shrink-0 items-center justify-end text-[10px] md:w-16 max-md:px-1', priorityTone(ticket.priority))}>
        {ticket.priority ? `Priority: ${ticket.priority}` : ''}
      </span>
      <span
        className="flex w-14 shrink-0 items-center justify-end text-[10px] text-muted-foreground/70 max-md:ml-auto"
        title={formatDateTime(ticket.date)}
      >
        {formatAge(ticket.date)}
      </span>
      {/* The plan column (#685): a `.plan.md` is either there to read or waiting to be written.
          Planned → a link to the rendered plan; not planned → a button that starts a session to
          write one. A sibling of the row's button, not a child, for the same reason the issue
          link is: an interactive control nested in a button is invalid HTML, and the two go
          different places. */}
      <div className="flex w-16 shrink-0 items-center justify-center">
        {ticket.planned ? (
          // A plan that exists is a link, not a start — so no chevron: there is nothing to
          // configure about reading a file.
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onClick={() => onOpenPlan?.()}
                  disabled={!onOpenPlan}
                  aria-label={`View the plan for ${ticket.title}`}
                  // Strong blue for a plan that exists, thicker-stroked (2.5) so it reads
                  // bolder still against the light-grey create button below — colour and
                  // weight together tell the two near-identical clipboards apart and make the
                  // planned rows scannable. `info` is the theme's only blue (`primary` is
                  // defined as `success`'s green), and it renders at full strength here.
                  className="text-info hover:text-info/80 disabled:pointer-events-none disabled:opacity-50"
                />
              }
            >
              <ClipboardList className="h-4 w-4" strokeWidth={2.5} aria-hidden />
            </TooltipTrigger>
            <TooltipContent>View the plan</TooltipContent>
          </Tooltip>
        ) : held ? null : (
          <StartAgentButton
            variant="ghost"
            size="icon-sm"
            icon={<ClipboardPlus className="h-4 w-4" aria-hidden />}
            ariaLabel={`Create a plan for ${ticket.title}`}
            menuAriaLabel={`Other ways to plan ${ticket.title}`}
            tooltip="Plan this ticket — starts an agent to write its plan"
            busy={busy}
            onStart={onStartPlan}
            onConfigure={onConfigurePlan}
            prompt={planTicketPrompt(ticket.file)}
            configureDescription="Opens the launcher with the plan prompt, so you can set the model and where it runs."
            // Light grey, lighter than the row's "4d ago" date, against the view
            // button's bold blue: a plan yet to be written is the quiet state, an
            // available action rather than something already there.
            className="text-muted-foreground/50 hover:text-foreground"
          />
        )}
      </div>
      {ticket.issue ? (
        <a
          href={ticket.issue.url}
          target="_blank"
          rel="noreferrer"
          className="flex shrink-0 items-center justify-end gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline md:w-20 md:px-3 max-md:px-2"
        >
          <ExternalLink className="h-4 w-4" aria-hidden />
          {ticket.issue.label}
        </a>
      ) : (
        // Same width as the link so the row's right edge — and with it the priority and date
        // columns inside — stays put on a row with no issue to link.
        <span className="w-20 shrink-0 max-md:hidden" aria-hidden />
      )}
    </li>
  )
}

// The tickets list (#697/#1144): the project's `tickets/*.md` as one-liners — priority, topics,
// what the agent already did to it, and how recently, all on the row — so the backlog is scannable
// without opening one. A row opens its detail page (#1144), which is where Queue and the summary
// live, and carries two direct starts: the start column (an agent implementing the ticket) and the
// plan column (an agent writing its plan, #685). An empty `tickets/` offers to import the project's
// issues instead of just saying "nothing here"; a filled one offers to update it (#1208)
// instead of a re-import re-walking the whole backlog.
export function TicketsPanel({
  projectId,
  tickets,
  loaded,
  hiddenByFilter = 0,
  isSelected,
  onToggleSelect,
  onOpen,
  onOpenPlan,
  onTopicClick,
  onClaimedClick,
  onOpenAgent,
  onClearFilters,
}: {
  projectId: string | null
  tickets: WorkspaceTicket[]
  loaded: boolean
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
}) {
  const { busy, error, run } = useAction()
  const host = useModuleHost()
  // When `tickets/` last caught up with the issue tracker, from `tickets meta --local`. Read here rather than
  // passed down: the cross-project page reads one ticket list per project, and this is the one
  // extra read a section adds.
  const meta = useLoaded<TicketsMeta>(projectId ? async () => readMeta(await host.runCommand(projectId, ['meta', '--local'])) : null, NO_META, [projectId])

  if (!projectId) return null
  if (!loaded) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>

  // Every "Configure first, then run" on the panel lands in the same place: this project's own
  // launcher, with the button's prompt drafted in, where the model, the run target and the prompt
  // itself can all be changed.
  const configure = (prompt: string) => () => host.configureRun(projectId, prompt)

  // The dashboard starts the run with the person's own picks and lands on it, so its progress
  // is watchable instead of the panel sitting on stale rows until files land.
  const startSession = async (prompt: string, failure: string) => {
    await run(() => host.startRun(projectId, prompt), failure)
  }

  const updateTickets = () => startSession(UPDATE_TICKETS_PROMPT, 'The update could not be started.')
  // A plan is written per-ticket for a human to read: the reader reviews the result through the
  // plan column's link.
  const startPlan = (file: string) => startSession(planTicketPrompt(file), 'The planning agent could not be started.')
  // The start column (#855's play button, on the backlog): one agent on this one ticket.
  const startWork = (file: string) => startSession(workOnTicketPrompt(file), 'The work agent could not be started.')

  if (tickets.length === 0 && hiddenByFilter > 0) {
    // Filtered to nothing, not genuinely empty (#1144/#1230): offering an import here would ask
    // for work already done.
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border p-4 text-sm">
        <p className="text-muted-foreground">
          {hiddenByFilter} ticket{hiddenByFilter === 1 ? '' : 's'} hidden by the current filters.
        </p>
        {onClearFilters && (
          <Button variant="outline" size="xs" onClick={onClearFilters}>
            Clear filters
          </Button>
        )}
      </div>
    )
  }

  if (tickets.length === 0) {
    return (
      <div className="space-y-3 rounded-lg border border-border p-4 text-sm">
        <p className="text-muted-foreground">
          No tickets yet. Tickets live in <code className="rounded bg-muted px-1">tickets/</code> and are what the agent
          plans from.
        </p>
        {error && <p className="text-xs text-danger">{error}</p>}
        <UpdateTicketsButton busy={busy} onStart={() => void updateTickets()} onConfigure={configure(UPDATE_TICKETS_PROMPT)} />
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      {error && <p className="border-b border-border p-2 text-xs text-danger">{error}</p>}
      {/* The same update as the empty state's button (#1501): one command covers both, its empty
          branch being the first import. Here it sits beside the stamp it acts on. */}
      <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-2 py-1.5">
        {/* The stamp and its action side by side (#1265) — the button used to sit flush right,
            a whole panel-width away from the line it acts on. */}
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {meta.lastImportedAt
            ? `Updated from the tracker ${formatRelative(meta.lastImportedAt)}`
            : 'No record of an import yet'}
        </span>
        <UpdateTicketsButton
          busy={busy}
          onStart={() => void updateTickets()}
          onConfigure={configure(UPDATE_TICKETS_PROMPT)}
          lastImportedAt={meta.lastImportedAt}
          className="h-6 gap-1 px-2 text-xs"
        />
      </div>
      <ul className="divide-y divide-border">
        {tickets.map(ticket => (
          <TicketRow
            key={ticket.file}
            ticket={ticket}
            busy={busy}
            selected={isSelected?.(ticket.file) ?? false}
            onToggleSelect={onToggleSelect ? () => onToggleSelect(ticket.file) : undefined}
            onOpen={() => onOpen(ticket.file)}
            onStartWork={() => void startWork(ticket.file)}
            onConfigureWork={configure(workOnTicketPrompt(ticket.file))}
            onOpenPlan={onOpenPlan ? () => onOpenPlan(ticket.file) : undefined}
            onStartPlan={() => void startPlan(ticket.file)}
            onConfigurePlan={configure(planTicketPrompt(ticket.file))}
            onTopicClick={onTopicClick}
            onClaimedClick={onClaimedClick}
            onOpenAgent={onOpenAgent}
          />
        ))}
      </ul>
    </div>
  )
}
