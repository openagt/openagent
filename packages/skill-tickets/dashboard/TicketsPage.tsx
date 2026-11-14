import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button, FadeWhileStale, LinkActions, Page, Section, cn, usePolled, useAction, useModuleHost, type ProjectLinks, type ModuleLink, type ModuleProject } from '@openagt/dashboard/module'
import { heldBack, holderAgent, planLink, ticketLink, withHolder } from '../src/module.js'
import { holdingRun } from './lib/holding-run.js'
import type { ProjectTickets, WorkspaceTicket } from './lib/types.js'
import { listTickets } from './lib/list.js'
import { openFromList } from './lib/back-to-list.js'
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
import { TicketList, TicketsPanel, TicketRow } from './TicketsPanel.js'

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
// anywhere". Rows are selectable (the list idiom of issue trackers): while any shown row is ticked, a
// bar at the foot of the list holds the queue buttons for just the selected tickets.
export function TicketsPage({ projects }: { projects: ModuleProject[] }) {
  const host = useModuleHost()
  const key = projects.map(p => p.id).join(',')
  // Every project's tickets from `tickets list --local` in each, with each claim's holder looked up
  // among the project's runs: a lock names a run's id, so a claim a run made links to its page
  // and reads as its session name. A project whose command fails is named with the command's own
  // reason, and the other projects still show. A local read, no fetch: cheap enough to poll.
  const { value: groups, state } = usePolled<ProjectRead[]>(
    () =>
      Promise.all(
        projects.map(async (project): Promise<ProjectRead> => {
          const [listed, agents] = await Promise.all([listTickets(host, project.id), host.agents(project.id).catch(() => [])])
          if ('error' in listed) return { projectId: project.id, projectName: project.name, tickets: [], error: listed.error }
          const tickets = listed.tickets.map(ticket => withHolder(ticket, holdingRun(holderAgent(agents, ticket.lockedBy))))
          return { projectId: project.id, projectName: project.name, tickets }
        }),
      ),
    EMPTY_GROUPS,
    10_000,
    [key],
    // Kept for the next visit: the page opens with the last list, faded until it is read again.
    { remember: `skill-tickets:page:${key}`, stored: true },
  )
  const [view, setViewState] = useState<TicketsView>(initialView)
  const open = (projectId: string, path: string[]) => {
    openFromList(path)
    host.openPage('tickets', path, projectId)
  }
  const onOpenTicket = (projectId: string, file: string) => open(projectId, [file])
  const onOpenTicketPlan = (projectId: string, file: string) => open(projectId, [file, 'plan'])
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
  // action with the row's own project (a panel binds one projectId; the flat list has one per row).
  // The dashboard starts the run with the person's own picks and lands on it.
  const { busy, error, run } = useAction()
  // Which start is in flight, by its project and prompt: only the button that asked it spins.
  const [starting, setStarting] = useState<{ projectId: string; prompt: string } | null>(null)
  const startSession = async (projectId: string, prompt: string, failure: string) => {
    setStarting({ projectId, prompt })
    await run(() => host.startRun(projectId, prompt), failure)
    setStarting(null)
  }
  // The page-wide adds: every unclaimed shown ticket handed, as a link, to the actions the
  // installed modules offer on links — "Add to queue" when a project has a queue package — as the
  // ticket itself, or as the ask for its plan. Both walk the shown order, so within a priority
  // section entries keep the order the reader saw. What is already there is the action's own to
  // leave alone: this page knows nothing of a queue. No agent starts here. Each stops at the
  // first failure, whose reason lands under the buttons.

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
  // Escape hands the page back, as Clear selection does, unless something open took the key first.
  useEffect(() => {
    if (!hasSelection) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) setSelected(new Set())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hasSelection])


  // The selection's bar lingers 120ms after the last tick goes, drawn as it was, so it can leave.
  const lastSelected = useRef(selectedShown)
  if (hasSelection) lastSelected.current = selectedShown
  const [leaving, setLeaving] = useState(false)
  useEffect(() => {
    if (hasSelection) return setLeaving(false)
    if (lastSelected.current.length === 0) return
    setLeaving(true)
    const timer = setTimeout(() => {
      lastSelected.current = []
      setLeaving(false)
    }, 120)
    return () => clearTimeout(timer)
  }, [hasSelection])
  const barRows = hasSelection ? selectedShown : leaving ? lastSelected.current : []

  return (
    // The header (with the count, the page's buttons and its filter bar) stays above the list while the list scrolls.
    <Page
      title="Tickets"
      // Shown/total beside the name it counts (#1144 follow-up): unfiltered it reads n/n, doubling as the backlog's total.
      count={state !== 'unknown' && rows.length > 0 ? `${visible.length}/${rows.length}` : undefined}
      description={
        <>
          {projects.length === 1 ? 'This project\u2019s' : 'Every project\u2019s'} <code className="rounded-sm bg-muted px-1 font-mono text-xs">tickets/</code> backlog: what agents plan from.
        </>
      }
      // The whole shown set onto the queue: the detail page's Queue action lifted to the page, and
      // its plan sibling. While rows are ticked the selection's bar speaks for them instead, and
      // these keep their place, unseen, so nothing on the page moves.
      actions={
        state !== 'unknown' && (
          <span className={cn('contents', hasSelection && '[&>*]:invisible')} aria-hidden={hasSelection || undefined} inert={hasSelection || undefined}>
            <QueueAdds rows={flatRows} selection={false} disabled={busy} />
          </span>
        )
      }
      bar={
        <>
          {/* Page-level failures land here, above the toolbar, so grouped mode shows them too — the
              header owns an action of its own now, not just the flat rows'. */}
          {error && <p className="text-xs text-danger">{error}</p>}
          <TicketFilterBar
            view={view}
            rows={rows}
            onChange={setView}
          />
        </>
      }
    >
      {state === 'unknown' ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">No project has the tickets package.</p>
      ) : view.group === 'none' ? (
        // The flat cross-project list: one pool, one order, rows carrying their project. No
        // per-project Update bars here — those belong to the sections, and grouped mode is a
        // menu click away.
        <FadeWhileStale stale={state === 'kept'} className="space-y-2">
          {filtered && rows.length - visible.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
              <span>
                {rows.length - visible.length} ticket{rows.length - visible.length === 1 ? '' : 's'} hidden by the current filters.
              </span>
              <Button variant="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            </div>
          )}
          {flatRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {rows.length === 0 ? 'No tickets in any project yet — group by project to import a project\'s issues.' : 'No tickets match.'}
            </p>
          ) : (
            <TicketList>
                {flatRows.map(r => (
                  <TicketRow
                    key={`${r.projectId}/${r.ticket.file}`}
                    projectId={r.projectId}
                    ticket={r.ticket}
                    projectName={projects.length > 1 ? r.projectName : undefined}
                    busy={busy}
                    starting={starting?.projectId === r.projectId ? starting.prompt : null}
                    selected={selected.has(`${r.projectId}/${r.ticket.file}`)}
                    onToggleSelect={() => toggleSelected(`${r.projectId}/${r.ticket.file}`)}
                    onOpen={() => onOpenTicket(r.projectId, r.ticket.file)}
                    onStart={(prompt, failure) => void startSession(r.projectId, prompt, failure)}
                    onConfigure={prompt => host.configureRun(r.projectId, prompt)}
                    onOpenPlan={() => onOpenTicketPlan(r.projectId, r.ticket.file)}
                    onTopicClick={addTopic}
                    onClaimedClick={filterClaimed}
                    onOpenAgent={agentId => onOpenAgent(r.projectId, agentId)}
                  />
                ))}
            </TicketList>
          )}
        </FadeWhileStale>
      ) : (
        <FadeWhileStale stale={state === 'kept'} className="space-y-8">
          {groups.map(g => {
            const groupRows = visible.filter(r => r.projectId === g.projectId)
            const sorted = sortRows(groupRows, view.sort)
            const panel = (
              <>
                {g.error !== undefined && (
                  <p role="alert" className="mb-2 text-sm text-danger">
                    Could not read the tickets of {g.projectName}: {g.error}
                  </p>
                )}
                <TicketsPanel
                  projectId={g.projectId}
                  tickets={sorted.map(r => r.ticket)}
                  loaded
                  lead={groups.length === 1}
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
              </>
            )
            return (
              <Fragment key={g.projectId}>
                {/* One project's page needs no heading naming it: the sidebar does. */}
                {groups.length === 1 ? panel : <Section title={g.projectName}>{panel}</Section>}
              </Fragment>
            )
          })}
        </FadeWhileStale>
      )}
      {barRows.length > 0 && (
        <SelectionBar leaving={!hasSelection} count={barRows.length} onClear={() => setSelected(new Set())}>
          <QueueAdds rows={barRows} selection disabled={busy || !hasSelection} />
        </SelectionBar>
      )}
    </Page>
  )
}
/**
 * The selection's readout and its presses (the list idiom of issue trackers), floating at the
 * bottom of the list's column: it takes no room, so ticking a row moves nothing on the page.
 */
function SelectionBar({ leaving, count, onClear, children }: { leaving: boolean; count: number; onClear: () => void; children: ReactNode }) {
  return (
    <div className="pointer-events-none sticky bottom-16 z-10 h-0">
      <div
        role="region"
        aria-label="Selected tickets"
        className={cn(
          'pointer-events-auto absolute inset-x-0 top-2 mx-auto flex w-fit max-w-full flex-wrap items-center gap-2 menu-surface rounded-lg p-1 pl-3 text-sm shadow-lg ring-1 ring-foreground/10',
          'transition-[opacity,translate] ease-out starting:translate-y-2 starting:opacity-0',
          leaving ? 'pointer-events-none translate-y-2 opacity-0 duration-120' : 'duration-180',
        )}
      >
        <span className="tabular-nums">{count} selected</span>
        {children}
        <Button variant="ghost" onClick={onClear}>
          Clear selection
        </Button>
      </div>
    </div>
  )
}

/**
 * The page-wide adds: every unclaimed ticket of `rows` handed, as a link, to the actions the
 * installed modules offer on links — "Add to queue" when a project has a queue package — as the
 * ticket itself, or as the ask for its plan. Both walk the shown order, so within a priority
 * section entries keep the order the reader saw. What is already there is the action's own to
 * leave alone: this page knows nothing of a queue. No agent starts here. Each stops at the
 * first failure, whose reason lands under the buttons. `selection`: `rows` are the ticked ones,
 * and the ticket add is the bar's primary press.
 */
function QueueAdds({ rows, selection, disabled }: { rows: ReturnType<typeof flattenTickets>; selection: boolean; disabled: boolean }) {
  // Both skip claimed tickets: a ticket some agent already holds (#1420) is being worked, and its
  // entry would outlive that work as queue noise. Both skip tickets in review or waiting too: no
  // agent is handed one, nor its plan. The plan add also skips planned tickets, whose plan
  // already exists. In the shown order, each row carrying its own project, so a cross-project
  // view needs no special case: every entry lands on its own project's queue.
  const ready = rows.filter(r => !heldBack(r.ticket))
  const heldShown = rows.length - ready.length
  const targets = ready.filter(r => !r.ticket.locked)
  const claimedShown = ready.length - targets.length
  const planTargets = targets.filter(r => !r.ticket.planned)
  // One flip per acted-on set and per button: once this exact set is added the button says so and
  // rests, and any change to the set — a filter, a poll bringing new tickets, a selection — arms
  // it again (the button's own rule, keyed by these).
  const queueKey = targets.map(r => `${r.projectId}/${r.ticket.file}`).join('\n')
  const planKey = planTargets.map(r => `${r.projectId}/${r.ticket.file}`).join('\n')
  const projectsShown = [...new Set(rows.map(r => r.projectId))]
  const which = selection ? 'selected' : 'shown'
  // Each renders only when it has something to add — "all 0 tickets" is not an offer, the list
  // already explains an empty set, and an all-claimed (or, for plans, all-planned) one has
  // nothing left to ask for. The labels count what the click adds, never promising a ticket they
  // will skip. Each is the object of the module's own verb: "Add to queue: 5 tickets".
  return (
    <>
      {planTargets.length > 0 && (
        <LinkActions
          projects={projectsShown}
          targets={linksByProject(planTargets, planLink)}
          resetKey={`plans\n${planKey}`}
          label={action => `${action.label}: ${counted(planTargets.length, 'plan')}`}
          variant="ghost"
          disabled={disabled}
          tooltip={
            <>
              Each {selection ? 'selected ' : ''}ticket gets its plan asked for — the same &quot;Create tickets/….plan.md&quot; entry the plan-tickets
              command queues — worked highest priority first and, within a priority, in the order shown below. Tickets already planned, held by an agent,
              in review or waiting stay as they are, and what is already there is left alone.
              {selection && ' The rest of the shown set stays put.'}
            </>
          }
        />
      )}
      {targets.length > 0 && (
        <LinkActions
          projects={projectsShown}
          targets={linksByProject(targets, ticketLink)}
          resetKey={`tickets\n${queueKey}`}
          label={action => `${action.label}: ${counted(targets.length, 'ticket')}`}
          variant={selection ? 'default' : 'ghost'}
          disabled={disabled}
          tooltip={
            <>
              {`Every ${selection ? 'selected ' : ''}ticket joins the queue — the work OpenAgent picks up on its own, worked highest priority first and, within a priority, in the order shown below. A ticket already queued stays as it is.`}
              {selection && ' The rest of the shown set stays put.'}
              {claimedShown === 1 && ` The claimed ticket ${which} is left to the agent holding it.`}
              {claimedShown > 1 && ` The ${claimedShown} claimed tickets ${which} are left to the agents holding them.`}
              {heldShown === 1 && ` The ticket in review or waiting ${which} is left out.`}
              {heldShown > 1 && ` The ${heldShown} tickets in review or waiting ${which} are left out.`}
            </>
          }
        />
      )}
    </>
  )
}

/**
 * What a page-wide add hands the link actions: each ticket as a link — the ticket itself
 * (`ticketLink`), or the ask for its plan (`planLink`) — grouped by project in the shown order,
 * one group per project in order of first appearance.
 */
function linksByProject(rows: readonly { projectId: string; ticket: WorkspaceTicket }[], asLink: (ticket: WorkspaceTicket) => ModuleLink): ProjectLinks[] {
  const groups: ProjectLinks[] = []
  for (const { projectId, ticket } of rows) {
    const group = groups.find(g => g.projectId === projectId)
    if (group) group.links.push(asLink(ticket))
    else groups.push({ projectId, links: [asLink(ticket)] })
  }
  return groups
}

/**
 * What a page-wide add acts on, as the object of its verb: "5 tickets", "one plan". Short, so the
 * heading stays one line: which tickets it takes — the shown or the selected ones, less the ones
 * it skips — is the tooltip's to say.
 */
function counted(count: number, noun: string): string {
  return count === 1 ? `one ${noun}` : `${count} ${noun}s`
}
