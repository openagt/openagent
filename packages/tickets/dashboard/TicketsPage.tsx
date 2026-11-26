import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button, Empty, LinkActions, Page, PanelShape, Section, Slot, cn, runsAgain, usePolled, useAction, useIsMobile, useLinkActions, useModuleHost, type ProjectLinks, type UiLink, type UiProject, type LinkActionOffer } from '@openagt/ui/module'
import { heldBack, holderAgent, planLink, ticketLink, withHolder } from '../src/module.js'
import { holdingRun } from './lib/holding-run.js'
import type { ProjectTickets, WorkspaceTicket } from './lib/types.js'
import { listTickets } from './lib/list.js'
import {
  defaultView,
  filterRows,
  flattenTickets,
  formatTicketsView,
  parseTicketsView,
  sortRows,
  type TicketRow,
  type TicketsView,
} from './lib/ticket-filter.js'
import { TicketFilterBar } from './TicketFilterBar.js'
import { ProjectTicketsPresses, TicketsPanel, type ListedTicket, type RowsProps } from './TicketsPanel.js'

/** Stable initial for the cross-project tickets poll, so it does not churn on every render. */
const EMPTY_GROUPS: ProjectTickets[] = []

/** One project's tickets as read: its rows with their holders resolved, or why they could not be read. */
interface ProjectRead extends ProjectTickets {
  error?: string
}

/** The view the page opens with: whatever the URL says (the URL is the selection, filters included), or the defaults. */
function initialView(): TicketsView {
  return typeof window === 'undefined' ? defaultView() : parseTicketsView(window.location.search)
}

/** A ticket's key on a page that spans projects, where two projects can share a filename. */
const keyOf = (row: { projectId: string; ticket: { file: string } }) => `${row.projectId}/${row.ticket.file}`

/** The backlog of the picked project or of every project, in one view the URL carries. */
export function TicketsPage({ projects }: { projects: UiProject[] }) {
  const host = useModuleHost()
  const phone = useIsMobile()
  const key = projects.map(p => p.id).join(',')
  // A project whose read fails says why while the others still show.
  const { value: groups, state } = usePolled<ProjectRead[]>(
    () =>
      Promise.all(
        projects.map(async (project): Promise<ProjectRead> => {
          const [listed, agents] = await Promise.all([listTickets(host, project.id), host.agents(project.id).catch(() => [])])
          if ('error' in listed) return { projectId: project.id, projectName: project.name, tickets: [], error: listed.error }
          const tickets = listed.tickets.map(ticket => {
            const holder = holderAgent(agents, ticket.lockedBy)
            return { ...withHolder(ticket, holdingRun(holder)), ...(holder ? { holderStatus: holder.status } : {}) }
          })
          return { projectId: project.id, projectName: project.name, tickets }
        }),
      ),
    EMPTY_GROUPS,
    10_000,
    [key],
    // Kept for the next visit: the page opens with the last list, faded until it is read again.
    { remember: `tickets:page:${key}`, stored: true },
    runsAgain(undefined),
  )
  const [view, setViewState] = useState<TicketsView>(initialView)
  // A view change is an adjust, not a navigation: Back steps over filters, and the address stays shareable.
  const setView = (next: TicketsView) => {
    setViewState(next)
    if (typeof window !== 'undefined') host.adjustPage(undefined, formatTicketsView(next, window.location.search))
  }
  const clearFilters = () => setView({ ...view, filters: defaultView().filters })

  const rows = useMemo(() => flattenTickets(groups), [groups])
  // Read, and no project holds a ticket: there is nothing to filter, so the filters are not drawn.
  const noTicket = state !== 'unknown' && groups.every(g => g.error === undefined && g.tickets.length === 0)
  const visible = filterRows(rows, view.filters)
  const flatRows = sortRows(visible, view.sort)

  const { busy, error, run } = useAction()
  const [starting, setStarting] = useState<{ projectId: string; prompt: string } | null>(null)
  const only = projects.length === 1 ? projects[0] : undefined

  // A ticked ticket the filters hide is neither counted nor acted on, and comes back ticked with its row.
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const selectedShown = flatRows.filter(r => selected.has(keyOf(r)))
  const hasSelection = selectedShown.length > 0
  // Escape hands the page back, as the bar's clear does, unless something open took the key first.
  useEffect(() => {
    if (!hasSelection) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) setSelected(new Set())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hasSelection])
  // The bar lingers 120 ms after the last tick goes, drawn as it was, so it can leave.
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

  const rowsProps: RowsProps = {
    busy,
    starting,
    isSelected: row => selected.has(keyOf(row)),
    onToggleSelect: row =>
      setSelected(prev => {
        const next = new Set(prev)
        if (!next.delete(keyOf(row))) next.add(keyOf(row))
        return next
      }),
    onOpen: row => host.openPage('tickets', [row.ticket.file], row.projectId),
    onStart: async (row, prompt, failure) => {
      setStarting({ projectId: row.projectId, prompt })
      await run(() => host.startRun(row.projectId, prompt), failure)
      setStarting(null)
    },
    onConfigure: (row, prompt) => host.configureRun(row.projectId, prompt),
    // Added to what is filtered, so a second topic widens the list; lowercased, the one casing the filters hold.
    onTopic: raw => {
      const topic = raw.toLowerCase()
      if (!view.filters.topics.includes(topic)) setView({ ...view, filters: { ...view.filters, topics: [...view.filters.topics, topic] } })
    },
    onClaimed: () => {
      if (!view.filters.stage.includes('claimed')) setView({ ...view, filters: { ...view.filters, stage: [...view.filters.stage, 'claimed'] } })
    },
  }
  const listed = (r: TicketRow, named: boolean): ListedTicket => ({ projectId: r.projectId, ...(named ? { projectName: r.projectName } : {}), ticket: r.ticket })

  return (
    <Page
      title="Tickets"
      description={
        <>
          {only ? 'The backlog' : 'Every project’s backlog'} agents plan from, read from <code className="rounded-sm bg-muted px-1 font-mono text-xs">tickets/</code>.
        </>
      }
      actions={only && <ProjectTicketsPresses projectId={only.id} />}
      bar={
        <>
          {error && <p role="alert" className="mb-2 text-xs text-danger">{error}</p>}
          {!noTicket && <TicketFilterBar view={view} rows={rows} reading={state === 'unknown'} spansProjects={projects.length > 1} onChange={setView} />}
        </>
      }
    >
      {/* While the tickets are read: a card of rows as they land, their priority's column after the tick, one line each,
          and on a phone two, the stage under the name. */}
      <Slot of={{ state, value: groups }} shape={<PanelShape rows={3} lines={phone ? 2 : 1} before />}>
        {groups =>
          groups.length === 0 ? (
            <Empty title="No project has the tickets package." />
          ) : groups.length > 1 && view.group === 'project' ? (
            // A part per project, each with its own presses: the page's head cannot hold one project's.
            <div className="space-y-8">
              {groups.map(g => (
                <Section key={g.projectId} title={g.projectName} action={<ProjectTicketsPresses projectId={g.projectId} primary={false} />}>
                  <TicketsPanel
                    projectId={g.projectId}
                    rows={flatRows.filter(r => r.projectId === g.projectId).map(r => listed(r, false))}
                    error={g.error}
                    hiddenByFilter={g.tickets.length - visible.filter(r => r.projectId === g.projectId).length}
                    onClearFilters={clearFilters}
                    {...rowsProps}
                  />
                </Section>
              ))}
            </div>
          ) : groups.length > 1 ? (
            // One list across projects, each row saying its own.
            <div className="space-y-4">
              {groups
                .filter(g => g.error !== undefined)
                .map(g => (
                  <p key={g.projectId} role="alert" className="text-sm text-danger">
                    Could not read the tickets of {g.projectName}: {g.error}
                  </p>
                ))}
              {rows.length === 0 ? (
                <Empty title="No project has a ticket yet." />
              ) : (
                <TicketsPanel projectId="" rows={flatRows.map(r => listed(r, true))} hiddenByFilter={rows.length - visible.length} onClearFilters={clearFilters} {...rowsProps} />
              )}
            </div>
          ) : (
            <TicketsPanel
              projectId={groups[0]!.projectId}
              rows={flatRows.map(r => listed(r, false))}
              error={groups[0]!.error}
              hiddenByFilter={rows.length - visible.length}
              onClearFilters={clearFilters}
              {...rowsProps}
            />
          )
        }
      </Slot>
      {/* The selection bar's room at the list's end, 16 under it, kept whether or not a row is ticked, so ticking moves nothing. */}
      <div aria-hidden className="h-13 max-md:h-38" />
      {barRows.length > 0 && (
        <SelectionBar
          leaving={!hasSelection}
          count={barRows.length}
          onSelectAll={barRows.length < flatRows.length ? () => setSelected(new Set([...selected, ...flatRows.map(keyOf)])) : undefined}
          onClear={() => setSelected(new Set())}
        >
          <QueueAdds rows={barRows} disabled={busy || !hasSelection} />
        </SelectionBar>
      )}
    </Page>
  )
}

/** The selection's bar, floating over the list's foot and taking no room, so ticking a row moves nothing. */
function SelectionBar({ leaving, count, onSelectAll, onClear, children }: { leaving: boolean; count: number; /** Ticks every shown ticket; none once all are. */ onSelectAll: (() => void) | undefined; onClear: () => void; children: ReactNode }) {
  return (
    // On a phone 16 over what stands at the window's foot, the shell's bar of pages (`--foot`).
    <div className="pointer-events-none sticky bottom-6 z-10 h-0 max-md:bottom-[calc(var(--foot)+1rem)]">
      <div
        role="region"
        aria-label="Selected tickets"
        className={cn(
          'pointer-events-auto absolute bottom-0 flex items-center gap-1 menu-surface rounded-lg py-1 pr-1 pl-4 text-sm shadow-lg backdrop-blur-xl',
          // In the middle of the column, as wide as what it holds. On a phone part of the page's foot, on the column's
          // edges as the list is, and a grid: the count, Select all and the close on its first line, each add on a
          // line of its own under them, its words whole.
          'md:left-1/2 md:w-max md:-translate-x-1/2 max-md:inset-x-0 max-md:grid max-md:grid-cols-[auto_1fr_auto] max-md:px-4 max-md:py-0',
          'transition-[opacity,translate] ease-out starting:translate-y-2 starting:opacity-0',
          leaving ? 'pointer-events-none translate-y-2 opacity-0 duration-120' : 'duration-180',
        )}
      >
        <span className="mr-2 font-medium tabular-nums">{count} selected</span>
        {onSelectAll && (
          <Button variant="ghost" size="sm" onClick={onSelectAll} className="max-md:h-11 max-md:justify-self-start">
            Select all
          </Button>
        )}
        {/* On a phone the adds are the bar's rows, as a phone's menu draws them: 4 in from its sides, their words on the
            first line's inset. */}
        <div className="contents max-md:order-last max-md:col-span-full max-md:-mx-3 max-md:flex max-md:flex-col max-md:*:h-11 max-md:*:w-full max-md:*:justify-start max-md:*:px-3">
          {children}
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Clear the selection" title="Clear the selection (Esc)" onClick={onClear} className="text-muted-foreground max-md:col-start-3 max-md:-mr-3 max-md:size-11">
          <X className="size-4" aria-hidden />
        </Button>
      </div>
    </div>
  )
}

/** The ticked tickets, or the asks for their plans, handed as links to the actions modules offer on links. */
function QueueAdds({ rows, disabled }: { rows: readonly TicketRow[]; disabled: boolean }) {
  // Not a ticket an agent holds, nor one in review or waiting; a plan only for a ticket that has none.
  const targets = rows.filter(r => !heldBack(r.ticket) && !r.ticket.locked)
  const planTargets = targets.filter(r => !r.ticket.planned)
  const queueKey = targets.map(keyOf).join('\n')
  const planKey = planTargets.map(keyOf).join('\n')
  const projectsShown = [...new Set(rows.map(r => r.projectId))]
  const ticketLinks = linksByProject(targets, ticketLink)
  // Once every ticket of the set is on the queue, its plan is not asked for beside it.
  const queuedAlready = useLinkActions(projectsShown, ticketLinks).actions
  const [addedHere, setAddedHere] = useState<string | null>(null)
  const ticketsQueued = addedHere === queueKey || (queuedAlready.length > 0 && queuedAlready.every(action => action.done))
  const left = rows.length - targets.length
  // Each the object of the module's own verb, "Add to queue: 2 tickets", counting what a press adds, never a
  // ticket it skips or one already on the queue; done, what the set now has on the queue: "Queued: 3 plans".
  const label = (noun: string) => (action: LinkActionOffer, done: boolean) =>
    done ? `${action.doneLabel ?? action.label}: ${counted(action.total, noun)}` : `${action.label}: ${counted(action.left, noun)}`
  return (
    <>
      {targets.length > 0 && (
        <LinkActions
          projects={projectsShown}
          targets={ticketLinks}
          resetKey={`tickets\n${queueKey}`}
          onDone={() => setAddedHere(queueKey)}
          label={label('ticket')}
          variant="ghost"
          size="sm"
          disabled={disabled}
          tooltip={`Each ticket joins the queue, worked highest priority first.${left > 0 ? ` ${counted(left, 'ticket')} an agent holds, in review or waiting ${left === 1 ? 'is' : 'are'} left out.` : ''}`}
        />
      )}
      {planTargets.length > 0 && !ticketsQueued && (
        <LinkActions
          projects={projectsShown}
          targets={linksByProject(planTargets, planLink)}
          resetKey={`plans\n${planKey}`}
          label={label('plan')}
          variant="ghost"
          size="sm"
          disabled={disabled}
          tooltip="Each ticket with no plan gets its plan asked for on the queue, the entry the plan-tickets command queues."
        />
      )}
    </>
  )
}

/** Each ticket as a link (the ticket, or the ask for its plan), grouped by project in the shown order. */
function linksByProject(rows: readonly { projectId: string; ticket: WorkspaceTicket }[], asLink: (ticket: WorkspaceTicket) => UiLink): ProjectLinks[] {
  const groups: ProjectLinks[] = []
  for (const { projectId, ticket } of rows) {
    const group = groups.find(g => g.projectId === projectId)
    if (group) group.links.push(asLink(ticket))
    else groups.push({ projectId, links: [asLink(ticket)] })
  }
  return groups
}

/** "2 tickets", "1 plan": in digits, beside each other. */
function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}
