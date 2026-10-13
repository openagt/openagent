import { useMemo, useState } from 'react'
import { Button, LinkActions, ScrollArea, usePolled, useAction, useModuleHost, type ProjectLinks, type ModuleLink, type ModuleProject } from '@openagt/dashboard/module'
import { heldBack, holderAgent, planLink, planTicketPrompt, readListed, ticketLink, workOnTicketPrompt } from '../src/module.js'
import type { ProjectTickets, WorkspaceTicket } from './lib/types.js'
import {
  defaultView,
  filterRows,
  flattenTickets,
  formatTicketsView,
  hasAnyFilter,
  parseTicketsView,
  sortRows,
  type TicketsView,
} from './lib/ticket-filter.js'
import { TicketFilterBar } from './TicketFilterBar.js'
import { TicketsPanel, TicketRow } from './TicketsPanel.js'

/** Stable initial for the cross-project tickets poll, so it does not churn on every render. */
const EMPTY_GROUPS: ProjectTickets[] = []

/** One project's tickets as read: its rows with their holders resolved, or why the command failed. */
interface ProjectRead extends ProjectTickets {
  error?: string
}

/** The view the page opens with: whatever the URL says (#784's doctrine — the URL is the
 *  selection, filters included), or the defaults where there is no URL to read. */
function initialView(): TicketsView {
  return typeof window === 'undefined' ? defaultView() : parseTicketsView(window.location.search)
}

// The Tickets view (#1144): every registered project's `tickets/*.md`, one section per project —
// its own full page rather than a tab squeezed into the 22rem right rail, and cross-project rather
// than scoped to whichever project happened to be selected, since the backlog is worth seeing
// whole. Filtering/sorting/grouping (#1144) all live in one URL-carried TicketsView: search,
// faceted filters (priority/topics/stage/effort/uncertainty/project/unlinked), sort with
// direction, and Group by project (each section its own poll-independent TicketsPanel) vs a flat
// cross-project list — the one view that can answer "what is the single highest-priority ticket
// anywhere". Rows are selectable (the list idiom of issue trackers): while any shown row is ticked, the
// heading's queue buttons narrow from the whole shown set to just the selected tickets.
export function TicketsPage({ projects }: { projects: ModuleProject[] }) {
  const host = useModuleHost()
  const key = projects.map(p => p.id).join(',')
  // Every project's tickets from `tickets list --local` in each, with each claim's holder looked up
  // among the project's runs: a lock names a run's id, so a claim a run made links to its page
  // and reads as its session name. A project whose command fails is named with the command's own
  // reason, and the other projects still show. A local read, no fetch: cheap enough to poll.
  const { value: groups, loaded } = usePolled<ProjectRead[]>(
    () =>
      Promise.all(
        projects.map(async (project): Promise<ProjectRead> => {
          const [listed, agents] = await Promise.all([host.runCommand(project.id, ['list', '--local']).then(readListed), host.agents(project.id).catch(() => [])])
          if ('error' in listed) return { projectId: project.id, projectName: project.name, tickets: [], error: listed.error }
          const tickets: WorkspaceTicket[] = listed.tickets.map(ticket => {
            const agent = holderAgent(agents, ticket.lockedBy)
            return agent ? { ...ticket, lockedByAgent: { id: agent.id, ...(agent.name ? { name: agent.name } : {}) } } : ticket
          })
          return { projectId: project.id, projectName: project.name, tickets }
        }),
      ),
    EMPTY_GROUPS,
    10_000,
    [key],
  )
  const [view, setViewState] = useState<TicketsView>(initialView)
  const onOpenTicket = (projectId: string, file: string) => host.openPage('tickets', [projectId, file])
  const onOpenTicketPlan = (projectId: string, file: string) => host.openPage('tickets', [projectId, file, 'plan'])
  const onOpenAgent = (projectId: string, agentId: string) => host.openAgent(projectId, agentId)

  // Every view change mirrors into the query string — replaceState, not a navigation: filters are
  // page state the Back button should step over, not through, and the address stays shareable.
  const setView = (next: TicketsView) => {
    setViewState(next)
    if (typeof window !== 'undefined') {
      const qs = formatTicketsView(next, window.location.search)
      window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''))
    }
  }
  const clearFilters = () => setView({ ...view, filters: defaultView().filters })
  // Click-to-filter (#1144): a row's topic badge adds its topic, the claim marker narrows to
  // claimed — additive, so clicking a second topic widens the OR instead of replacing it.
  // Lowercased on the way in, the one casing the filters hold (the query-string parser does the
  // same): matching lowercases the ticket's own topics, so a badge reading `UX` filtered nothing.
  const addTopic = (raw: string) => {
    const topic = raw.toLowerCase()
    if (!view.filters.topics.includes(topic)) setView({ ...view, filters: { ...view.filters, topics: [...view.filters.topics, topic] } })
  }
  const filterClaimed = () => {
    if (!view.filters.stage.includes('claimed'))
      setView({ ...view, filters: { ...view.filters, stage: [...view.filters.stage, 'claimed'] } })
  }

  const rows = useMemo(() => flattenTickets(groups), [groups])
  const visible = filterRows(rows, view.filters)
  const filtered = hasAnyFilter(view.filters)

  // Flat mode renders rows outside any TicketsPanel, so the plan and start columns need their own
  // actions with the row's own project (a panel binds one projectId; the flat list has one per row).
  // The dashboard starts the run with the person's own picks and lands on it.
  const { busy, error, run } = useAction()
  const startPlan = async (projectId: string, file: string) => {
    await run(() => host.startRun(projectId, planTicketPrompt(file)), 'The planning agent could not be started.')
  }
  const startWork = async (projectId: string, file: string) => {
    await run(() => host.startRun(projectId, workOnTicketPrompt(file)), 'The work agent could not be started.')
  }
  // The page-wide adds: every unclaimed shown ticket handed, as a link, to the actions the
  // installed modules offer on links — "Add to queue" when a project has a queue package — as the
  // ticket itself, or as the ask for its plan. Both walk the shown order, so within a priority
  // section entries keep the order the reader saw. What is already there is the action's own to
  // leave alone: this page knows nothing of a queue. No agent starts here. Each stops at the
  // first failure, whose reason lands under the buttons.

  /** The links grouped by project, in the shown order, one group per project in order of first appearance. */
  const grouped = (rows: { projectId: string; link: ModuleLink }[]): ProjectLinks[] => {
    const groups: ProjectLinks[] = []
    for (const { projectId, link } of rows) {
      const group = groups.find(g => g.projectId === projectId)
      if (group) group.links.push(link)
      else groups.push({ projectId, links: [link] })
    }
    return groups
  }

  // The tickets themselves, exactly as the detail page hands its one ticket over: the title as
  // the link, pointing back at the ticket, its priority picking the section.
  const ticketTargets = (targets: { projectId: string; ticket: WorkspaceTicket }[]) => grouped(targets.map(({ projectId, ticket }) => ({ projectId, link: ticketLink(ticket) })))

  // The tickets' PLANS: one `Create tickets/<stem>.plan.md` ask each, recognized by its exact text,
  // so the agent that works the entry writes the plan.
  const planAsks = (targets: { projectId: string; ticket: WorkspaceTicket }[]) => grouped(targets.map(({ projectId, ticket }) => ({ projectId, link: planLink(ticket) })))

  const flatRows = sortRows(visible, view.sort)

  // The row selection (the list idiom of issue trackers): tick some rows and the queue buttons narrow to just
  // them. Keyed project + file, since the page spans projects and two projects can share a
  // filename. Only shown selected rows count — a selected ticket the filters hide is neither
  // acted on nor counted, and comes back with its row — so what the buttons act on is always
  // visible below. A key whose ticket is gone lingers in the set harmlessly: it intersects
  // nothing shown.
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const toggleSelected = (key: string) =>
    setSelected(prev => {
      const next = new Set(prev)
      if (!next.delete(key)) next.add(key)
      return next
    })
  const selectedShown = flatRows.filter(r => selected.has(`${r.projectId}/${r.ticket.file}`))
  const hasSelection = selectedShown.length > 0

  // What the queue-add buttons act on — the shown rows, narrowed to the selected ones the moment
  // any row is selected, minus what each add would waste. Both skip claimed tickets: a ticket
  // some agent already holds (#1420) is being worked, and its entry would outlive that work as
  // queue noise. Both skip tickets in review or waiting too: no agent is handed one, nor its
  // plan. The plan add also skips planned tickets, whose plan already exists. In the
  // shown order, each row carrying its own project, so a cross-project view needs no special
  // case: every entry lands on its own project's queue.
  const scope = hasSelection ? selectedShown : flatRows
  const ready = scope.filter(r => !heldBack(r.ticket))
  const heldShown = scope.length - ready.length
  const targets = ready.filter(r => !r.ticket.locked)
  const claimedShown = ready.length - targets.length
  const skippedShown = scope.length - targets.length
  const planTargets = targets.filter(r => !r.ticket.planned)
  const planSkipped = scope.length - planTargets.length
  // One flip per acted-on set and per button: once this exact set is added the button says so and
  // rests, and any change to the set — a filter, a poll bringing new tickets, a selection — arms
  // it again (the button's own rule, keyed by these).
  const queueKey = targets.map(r => `${r.projectId}/${r.ticket.file}`).join('\n')
  const planKey = planTargets.map(r => `${r.projectId}/${r.ticket.file}`).join('\n')
  // The labels count what the click adds — saying "selected" while a selection narrows the
  // buttons, and stopping saying "all" the moment their count differs from the set's tally,
  // never promising a ticket they will skip. Each is the object of the module's own verb:
  // "Add to queue: all 5 tickets shown below".
  const queueObject = hasSelection
    ? targets.length === 1
      ? `the ${skippedShown > 0 ? 'one ready ' : ''}selected ticket`
      : skippedShown > 0
        ? `the ${targets.length} ready selected tickets`
        : `the ${targets.length} selected tickets`
    : targets.length === 1
      ? `the ${skippedShown > 0 ? 'one ready ' : ''}ticket shown below`
      : skippedShown > 0
        ? `the ${targets.length} ready tickets shown below`
        : `all ${targets.length} tickets shown below`
  const planObject = hasSelection
    ? planTargets.length === 1
      ? `a plan for the ${planSkipped > 0 ? 'one unplanned ' : ''}selected ticket`
      : planSkipped > 0
        ? `plans for the ${planTargets.length} unplanned selected tickets`
        : `plans for the ${planTargets.length} selected tickets`
    : planTargets.length === 1
      ? `a plan for the ${planSkipped > 0 ? 'one unplanned ' : ''}ticket shown below`
      : planSkipped > 0
        ? `plans for the ${planTargets.length} unplanned tickets shown below`
        : `plans for all ${planTargets.length} tickets shown below`
  const projectsShown = [...new Set(scope.map(r => r.projectId))]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The same header as the other pages (Automations, Logs, Queue): the same title, the same
          line under it, the same edge, and no bar of its own. Its count and its filter bar are the
          page's own, and stay above the list while the list scrolls. */}
      <div className="space-y-3 px-6 pt-6 pb-3 max-md:px-4 max-md:pt-4">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div>
            <h1 className="text-lg font-semibold">
              Tickets
              {/* Shown/total beside the name it counts (#1144 follow-up) — it describes the page's
                  content, not the toolbar's controls. Unfiltered it reads n/n, doubling as the
                  backlog's total, which the page otherwise says nowhere. */}
              {loaded && rows.length > 0 && (
                <span className="ml-2 text-sm font-normal tabular-nums text-muted-foreground">
                  {visible.length}/{rows.length}
                </span>
              )}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {projects.length === 1 ? 'This project\u2019s' : 'Every project\u2019s'} <code className="rounded bg-muted px-1">tickets/</code> backlog: what agents plan from.
            </p>
          </div>
          {/* The whole shown set onto the queue — or, with rows ticked, just the selected ones:
              the detail page's Queue action lifted to the page, and its plan sibling — the plan
              asks for the same set. Each renders only when it has something
              to add — "all 0 tickets" is not an offer, the list below already explains an empty
              set, and an all-claimed (or, for plans, all-planned) one has nothing left to ask
              for. */}
          {/* On a phone a button's words are longer than the screen: the buttons give up width, and their words are cut. */}
          <div className="flex flex-wrap items-center justify-end gap-2 md:shrink-0 max-md:min-w-0">
            {/* The selection's own readout and exit: while any row is ticked the buttons stop
                speaking for the shown set, so the count says what took over and the clear hands
                the page back without hunting down every ticked box. */}
            {hasSelection && (
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="tabular-nums">
                  {selectedShown.length} selected
                </span>
                <Button variant="outline" size="xs" onClick={() => setSelected(new Set())}>
                  Clear selection
                </Button>
              </span>
            )}
            {loaded && planTargets.length > 0 && (
              <LinkActions
                projects={projectsShown}
                targets={planAsks(planTargets)}
                resetKey={`plans\n${planKey}`}
                label={action => `${action.label}: ${planObject}`}
                disabled={busy}
                tooltip={
                  <>
                    Each {hasSelection ? 'selected ' : ''}ticket gets its plan asked for — the same &quot;Create tickets/….plan.md&quot; entry the plan-tickets
                    command queues — worked highest priority first and, within a priority, in the order shown below. Tickets already planned, held by an agent,
                    in review or waiting stay as they are, and what is already there is left alone.
                    {hasSelection && ' The rest of the shown set stays put.'}
                  </>
                }
              />
            )}
            {loaded && targets.length > 0 && (
              <LinkActions
                projects={projectsShown}
                targets={ticketTargets(targets)}
                resetKey={`tickets\n${queueKey}`}
                label={action => `${action.label}: ${queueObject}`}
                disabled={busy}
                tooltip={
                  <>
                    {`Every ${hasSelection ? 'selected ' : ''}ticket joins the queue — the work OpenAgent picks up on its own, worked highest priority first and, within a priority, in the order shown below. A ticket already queued stays as it is.`}
                    {hasSelection && ' The rest of the shown set stays put.'}
                    {claimedShown === 1 && ` The claimed ticket ${hasSelection ? 'selected' : 'shown'} is left to the agent holding it.`}
                    {claimedShown > 1 && ` The ${claimedShown} claimed tickets ${hasSelection ? 'selected' : 'shown'} are left to the agents holding them.`}
                    {heldShown === 1 && ` The ticket in review or waiting ${hasSelection ? 'selected' : 'shown'} is left out.`}
                    {heldShown > 1 && ` The ${heldShown} tickets in review or waiting ${hasSelection ? 'selected' : 'shown'} are left out.`}
                  </>
                }
              />
            )}
          </div>
        </div>
        {/* Page-level failures land here, above the toolbar, so grouped mode shows them too — the
            header owns an action of its own now, not just the flat rows'. */}
        {error && <p className="text-xs text-danger">{error}</p>}
        <TicketFilterBar
          view={view}
          rows={rows}
          onChange={setView}
        />
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {/* The full page width, no columns and no max-width (#1144/#1265): each project's table
            spans the whole pane, so a row has room for its title and every piece of meta at once.
            Columns looked tidy but split the one dimension the rows actually need. */}
        <div className="w-full px-6 pb-6 pt-1 max-md:px-4 max-md:pb-4">
          {!loaded ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">No project has the tickets package.</p>
          ) : view.group === 'none' ? (
            // The flat cross-project list: one pool, one order, rows carrying their project. No
            // per-project Update bars here — those belong to the sections, and grouped mode is a
            // menu click away.
            <div className="space-y-2">
              {filtered && rows.length - visible.length > 0 && (
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>
                    {rows.length - visible.length} ticket{rows.length - visible.length === 1 ? '' : 's'} hidden by the current filters.
                  </span>
                  <Button variant="outline" size="xs" onClick={clearFilters}>
                    Clear filters
                  </Button>
                </div>
              )}
              {flatRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {rows.length === 0 ? 'No tickets in any project yet — group by project to import a project\'s issues.' : 'No tickets match.'}
                </p>
              ) : (
                <div className="overflow-hidden rounded-lg border border-border">
                  <ul className="divide-y divide-border">
                    {flatRows.map(r => (
                      <TicketRow
                        key={`${r.projectId}/${r.ticket.file}`}
                        ticket={r.ticket}
                        projectName={r.projectName}
                        busy={busy}
                        selected={selected.has(`${r.projectId}/${r.ticket.file}`)}
                        onToggleSelect={() => toggleSelected(`${r.projectId}/${r.ticket.file}`)}
                        onOpen={() => onOpenTicket(r.projectId, r.ticket.file)}
                        onStartWork={() => void startWork(r.projectId, r.ticket.file)}
                        onConfigureWork={() => host.configureRun(r.projectId, workOnTicketPrompt(r.ticket.file))}
                        onOpenPlan={() => onOpenTicketPlan(r.projectId, r.ticket.file)}
                        onStartPlan={() => void startPlan(r.projectId, r.ticket.file)}
                        onConfigurePlan={() => host.configureRun(r.projectId, planTicketPrompt(r.ticket.file))}
                        onTopicClick={addTopic}
                        onClaimedClick={filterClaimed}
                        onOpenAgent={agentId => onOpenAgent(r.projectId, agentId)}
                      />
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-8">
              {groups.map(g => {
                const groupRows = visible.filter(r => r.projectId === g.projectId)
                const sorted = sortRows(groupRows, view.sort)
                return (
                  <section key={g.projectId} className="min-w-0 space-y-2">
                    <h2 className="truncate text-sm font-semibold">{g.projectName}</h2>
                    {g.error !== undefined && (
                      <p role="alert" className="text-xs text-danger">
                        Could not read the tickets of {g.projectName}: {g.error}
                      </p>
                    )}
                    <TicketsPanel
                      projectId={g.projectId}
                      tickets={sorted.map(r => r.ticket)}
                      loaded
                      hiddenByFilter={g.tickets.length - groupRows.length}
                      isSelected={file => selected.has(`${g.projectId}/${file}`)}
                      onToggleSelect={file => toggleSelected(`${g.projectId}/${file}`)}
                      onOpen={file => onOpenTicket(g.projectId, file)}
                      onOpenPlan={file => onOpenTicketPlan(g.projectId, file)}
                      onTopicClick={addTopic}
                      onClaimedClick={filterClaimed}
                      onOpenAgent={agentId => onOpenAgent(g.projectId, agentId)}
                      onClearFilters={filtered ? clearFilters : undefined}
                    />
                  </section>
                )
              })}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
