import { Flame } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitleLink, LinkActions, Tooltip, TooltipContent, TooltipTrigger, cn, usePolled, useModuleHost, type ModuleCardProps, type ModuleProject } from '@openagt/dashboard/module'
import { heldBack, holderAgent, hotLane, readListed, ticketLink, type HotLane } from '../src/module.js'
import type { WorkspaceTicket } from './lib/types.js'

// The Overview's hot-tickets card: a cross-project glance at what agents hold, what is flagged
// high priority, and what waits on a person, nothing else. Its data is `tickets list --local` in each project, the list an
// agent reads, with each claim's holder matched to the project's runs the dashboard knows. A row
// opens the ticket's own page; a claim opens the run holding it; beside every row sit the actions
// the installed modules offer on a ticket as a link ("Add to queue" where the project has a queue
// package), so the card names no queue and still leads to one.

/** One ticket on the card, tagged with its project and lane. */
interface HotTicket {
  project: ModuleProject
  lane: HotLane
  ticket: WorkspaceTicket
}

/** What one read of every project answered: the hot tickets, and the projects whose command failed. */
interface Read {
  hot: HotTicket[]
  errors: { project: ModuleProject; error: string }[]
}

const NOTHING_READ: Read = { hot: [], errors: [] }

/** The three lanes, each with the dot colour of the rest of the status vocabulary: warning = held, info = flagged, muted = parked on a person. */
const LANES: { key: HotLane; label: string; dot: string }[] = [
  { key: 'claimed', label: 'Claimed', dot: 'bg-warning' },
  { key: 'high-priority', label: 'High priority', dot: 'bg-info' },
  { key: 'waiting', label: 'Waiting', dot: 'bg-muted-foreground' },
]

export function HotTicketsCard({ projects }: ModuleCardProps) {
  const host = useModuleHost()
  const key = projects.map(p => p.id).join(',')
  const { value: read, loaded } = usePolled<Read>(
    async () => {
      const reads = await Promise.all(
        projects.map(async project => {
          const [listed, agents] = await Promise.all([host.runCommand(project.id, ['list', '--local']).then(readListed), host.agents(project.id).catch(() => [])])
          if ('error' in listed) return { project, hot: [], error: listed.error }
          const hot: HotTicket[] = []
          for (const ticket of listed.tickets) {
            const lane = hotLane(ticket)
            if (!lane) continue
            const agent = holderAgent(agents, ticket.lockedBy)
            hot.push({ project, lane, ticket: agent ? { ...ticket, lockedByAgent: { id: agent.id, ...(agent.name ? { name: agent.name } : {}) } } : ticket })
          }
          return { project, hot }
        }),
      )
      return {
        hot: reads.flatMap(r => r.hot),
        errors: reads.flatMap(r => (r.error !== undefined ? [{ project: r.project, error: r.error }] : [])),
      }
    },
    NOTHING_READ,
    // A local read per project plus its runs: a glance, not a feed.
    30_000,
    [key],
  )

  return (
    <Card>
      <CardHeader>
        <CardTitleLink icon={<Flame className="h-4 w-4 text-muted-foreground" aria-hidden />} href="/tickets" onOpen={() => host.openPage('tickets')}>
          Hot tickets
        </CardTitleLink>
      </CardHeader>
      <CardContent>
        {read.errors.map(({ project, error }) => (
          <p key={project.id} role="alert" className="mb-2 text-xs text-danger">
            Could not read the tickets of {project.name}: {error}
          </p>
        ))}
        {!loaded ? (
          <p className="py-2 text-sm text-muted-foreground">Loading…</p>
        ) : read.hot.length === 0 ? (
          // Named lanes, not "no tickets": the card is a shortlist, and its empty state must not
          // claim the backlog is empty when merely nothing qualifies.
          <p className="py-2 text-sm text-muted-foreground">Nothing claimed, high priority or waiting.</p>
        ) : (
          // The lanes stacked, not side by side: the card shares the Overview's narrow column with
          // the other packages' cards, and a row needs its width for the title.
          <div className="flex flex-col gap-5">
            {/* A lane with nothing in it is not drawn: "Claimed 0" says nothing the missing lane does not. */}
            {LANES.map(lane => ({ lane, tickets: read.hot.filter(t => t.lane === lane.key) }))
              .filter(({ tickets }) => tickets.length > 0)
              .map(({ lane, tickets }) => (
                <Lane key={lane.key} lane={lane} tickets={tickets} showProject={projects.length > 1} />
              ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Lane({ lane, tickets, showProject }: { lane: (typeof LANES)[number]; tickets: HotTicket[]; showProject: boolean }) {
  const host = useModuleHost()
  return (
    <div>
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
        <span aria-hidden className={cn('h-2 w-2 shrink-0 rounded-full', lane.dot)} />
        <span className="text-foreground/80">{lane.label}</span>
        <span className="tabular-nums text-muted-foreground/70">{tickets.length}</span>
      </div>
      {
        // Every ticket in the lane, never a "+N more": the card is the shortlist.
        <ul className="mt-1.5">
          {tickets.map(({ project, ticket }) => {
            const holder = ticket.lockedByAgent?.name ?? ticket.lockedBy
            return (
              <li key={`${project.id}:${ticket.file}`} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/60">
                <Tooltip>
                  <TooltipTrigger
                    render={<button type="button" onClick={() => host.openPage('tickets', [project.id, ticket.file])} className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:underline" />}
                  >
                    {ticket.title}
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[24rem]">{ticket.summary || ticket.title}</TooltipContent>
                </Tooltip>
                {/* The one fact that earns the lane: who holds it, the priority that flagged it, or what it waits on. */}
                {lane.key === 'claimed' && holder && (
                  ticket.lockedByAgent ? (
                    <button
                      type="button"
                      onClick={() => host.openAgent(project.id, ticket.lockedByAgent!.id)}
                      title="Open the run holding this ticket"
                      className="inline-block max-w-[8rem] shrink-0 truncate rounded border border-border px-1 text-[10px] text-warning hover:opacity-80"
                    >
                      {holder}
                    </button>
                  ) : (
                    <span className="inline-block max-w-[8rem] shrink-0 truncate rounded border border-border px-1 text-[10px] text-warning">{holder}</span>
                  )
                )}
                {lane.key === 'waiting' && ticket.waiting && (
                  <span title={`Waiting: ${ticket.waiting}`} className="inline-block max-w-[10rem] shrink-0 truncate text-[10px] text-muted-foreground">
                    {ticket.waiting}
                  </span>
                )}
                {lane.key === 'high-priority' && ticket.priority && (
                  <span className="shrink-0 rounded border border-border px-1 text-[10px] uppercase tracking-wide text-muted-foreground">{ticket.priority}</span>
                )}
                {/* The project's name only where the card spans several: with one it says nothing. */}
                {showProject && <span className="shrink-0 text-xs text-muted-foreground">{project.name}</span>}
                {!heldBack(ticket) && <LinkActions projects={[project.id]} targets={[{ projectId: project.id, links: [ticketLink(ticket)] }]} resetKey={`${project.id}:${ticket.file}`} size="xs" variant="ghost" />}
              </li>
            )
          })}
        </ul>
      }
    </div>
  )
}
