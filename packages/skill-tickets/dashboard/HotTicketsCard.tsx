import { useState } from 'react'
import { ArrowUp, Bot, CirclePause, Clock, WifiOff, type LucideIcon } from 'lucide-react'
import { Button, LinkActions, PageLink, Section, cn, formatDateTime, inPlace, usePolled, useModuleHost, useOpenAgentDown, type ModuleCardProps, type ModuleProject } from '@openagt/dashboard/module'
import { claimState, heldBack, holderAgent, hotLane, ticketLink, withHolder, type ClaimState, type HotLane } from '../src/module.js'
import { holdingRun } from './lib/holding-run.js'
import { listTickets } from './lib/list.js'
import type { WorkspaceTicket } from './lib/types.js'
import { releaseClaim } from './lib/release.js'

// The Overview's hot-tickets card: a cross-project glance at what agents hold, what is flagged
// high priority, and what waits on a person, nothing else. Its data is `tickets list --local` in each project, the list an
// agent reads, with each claim's holder matched to the project's runs the dashboard knows. A row
// opens the ticket's own page; a claim opens the run holding it; beside every row sit the actions
// the installed modules offer on a ticket as a link ("Add to queue" where the project has a queue
// package), so the card names no queue and still leads to one.

/** The card's lanes: a claim, told apart by how its run stands ({@link claimState}), and the card's other two. */
type CardLane = ClaimState | Exclude<HotLane, 'claimed'>

/** One ticket on the card, tagged with its project and lane, and the run holding it when one does. */
interface HotTicket {
  project: ModuleProject
  lane: CardLane
  ticket: WorkspaceTicket
  /** The run holding it: how it stands, and, while its computer does not answer, which computer and when it was last seen. */
  holder?: { id: string; status: string; machine?: string; seenAt?: string }
}

/** What one read of every project answered: the hot tickets, and the projects whose command failed. */
interface Read {
  hot: HotTicket[]
  errors: { project: ModuleProject; error: string }[]
}

const NOTHING_READ: Read = { hot: [], errors: [] }

/** The kinds of row, in the order the list shows them, each with its heading. */
const LANES: { key: CardLane; heading: string }[] = [
  { key: 'stale', heading: 'Claimed, run stopped' },
  { key: 'working', heading: 'Being worked on' },
  { key: 'offline', heading: 'Claimed, computer offline' },
  { key: 'high-priority', heading: 'High priority' },
  { key: 'waiting', heading: 'Waiting' },
]

/** How a holder's run ended, as a stale claim's row says it. */
const ENDED: Record<string, string> = { stopped: 'Run stopped', failed: 'Run failed', done: 'Run ended' }

export function HotTicketsCard({ projects }: ModuleCardProps) {
  const host = useModuleHost()
  const key = projects.map(p => p.id).join(',')
  const { value: read, loaded, reload } = usePolled<Read>(
    async () => {
      const reads = await Promise.all(
        projects.map(async project => {
          const listed = await listTickets(host, project.id)
          if ('error' in listed) return { project, hot: [], error: listed.error }
          // Only the runs holding a claim, the few this card names, and none when nothing is claimed.
          const holders = listed.tickets.flatMap(ticket => (ticket.locked && ticket.lockedBy !== undefined ? [ticket.lockedBy] : []))
          const agents = holders.length > 0 ? await host.agents(project.id, { ids: holders }).catch(() => []) : []
          const hot: HotTicket[] = []
          for (const ticket of listed.tickets) {
            const hotIn = hotLane(ticket)
            if (!hotIn) continue
            const agent = holderAgent(agents, ticket.lockedBy)
            const lane: CardLane = hotIn === 'claimed' ? claimState(agent?.status) : hotIn
            hot.push({
              project,
              lane,
              ticket: withHolder(ticket, holdingRun(agent)),
              ...(agent ? { holder: { id: agent.id, status: agent.status, ...(agent.machine ? { machine: agent.machine } : {}), ...(agent.seenAt ? { seenAt: agent.seenAt } : {}) } } : {}),
            })
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
    // Kept for the next visit: the page opens with the last tickets, faded until they are read again.
    { remember: `skill-tickets:hot:${key}`, stored: true },
  )

  return (
    <Section title="Hot tickets" count={read.hot.length > 0 ? read.hot.length : undefined} action={<PageLink href={host.pageHref('tickets')} onOpen={() => host.openPage('tickets')}>Tickets</PageLink>}>
      {loaded && read.hot.length === 0 && read.errors.length === 0 ? (
        // Named lanes, not "no tickets": the list is a shortlist, and its empty state must not
        // claim the backlog is empty when merely nothing qualifies.
        <p className="text-sm text-muted-foreground">Nothing claimed, high priority or waiting.</p>
      ) : (
        <HotList hot={read.hot} errors={read.errors} loaded={loaded} showProject={projects.length > 1} reload={reload} />
      )}
    </Section>
  )
}

/**
 * The list, as an issue list draws one: a quiet heading per kind, with how many; under it one row
 * per ticket, whose small icon says the same in its tone and whose title takes the row. Ordered by
 * what needs a person most: a claim held for nobody, then work going on, then what is flagged,
 * then what waits on someone else. A kind with nothing in it has no heading.
 */
function HotList({ hot, errors, loaded, showProject, reload }: { hot: HotTicket[]; errors: Read['errors']; loaded: boolean; showProject: boolean; reload: () => Promise<void> }) {
  const groups = LANES.map(lane => ({ lane, tickets: hot.filter(t => t.lane === lane.key) })).filter(group => group.tickets.length > 0)
  return (
    <>
      {errors.map(({ project, error }) => (
        <p key={project.id} role="alert" className="mb-2 text-xs text-danger">
          Could not read the tickets of {project.name}: {error}
        </p>
      ))}
      {!loaded ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        // Every ticket, never a "+N more": the list is the shortlist. Pulled out by the rows' own
        // inset, so their text starts where the heading does.
        <div className="-mx-2 space-y-3">
          {groups.map(({ lane, tickets }) => (
            <section key={lane.key} aria-label={lane.heading}>
              <h3 className="flex items-baseline gap-1.5 px-2 pb-0.5 text-xs font-medium text-muted-foreground">
                {lane.heading}
                <span className="tabular-nums opacity-70">{tickets.length}</span>
              </h3>
              <ul>
                {tickets.map(t => (
                  <Row key={`${t.project.id}:${t.ticket.file}`} hot={t} showProject={showProject} reload={reload} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  )
}

/** A row's mark, in its tone, and what it means, said on its hover. */
function stateOf(hot: HotTicket): { Icon: LucideIcon; says: string; tone: string } {
  const holder = hot.ticket.lockedByAgent?.name ?? hot.ticket.lockedBy
  const by = holder ? `, claimed by ${holder}` : ''
  if (hot.lane === 'working') return { Icon: Bot, says: `${hot.holder?.status === 'waiting' ? 'Its run waits on your answer' : 'Its run is at work'}${by}: open the run`, tone: 'text-success' }
  if (hot.lane === 'offline') {
    const seen = hot.holder?.seenAt ? `, last seen ${formatDateTime(hot.holder.seenAt)}` : ''
    return { Icon: WifiOff, says: `${hot.holder?.machine ?? 'Its computer'} is offline${seen}: how its run stands is unknown${by}`, tone: 'text-muted-foreground' }
  }
  if (hot.lane === 'stale') return { Icon: CirclePause, says: `${hot.holder ? (ENDED[hot.holder.status] ?? 'Run stopped') : 'No run holds it any more'}${by}`, tone: 'text-warning' }
  if (hot.lane === 'high-priority') return { Icon: ArrowUp, says: `Priority ${hot.ticket.priority ?? ''}`.trim(), tone: 'text-info' }
  return { Icon: Clock, says: `Waiting${hot.ticket.waiting ? ` on ${hot.ticket.waiting}` : ''}`, tone: 'text-muted-foreground' }
}

/**
 * One ticket: its mark, its title, which opens its page, a short fact at the end (its priority,
 * what it waits on, its project where the card spans several), and, under the pointer, what can be
 * done with it, laid over the title's end beside that fact rather than pushing the row. A ticket held for nobody can be
 * gone on with (its run opens) or let go (the claim is lifted, and it is a ticket like any other
 * again); one held by a run at work, or in review or waiting, has nothing to be done here. A phone
 * has no hover: there the actions always show, in the row.
 */
function Row({ hot, showProject, reload }: { hot: HotTicket; showProject: boolean; reload: () => Promise<void> }) {
  const host = useModuleHost()
  const { project, ticket, lane, holder } = hot
  const [releasing, setReleasing] = useState(false)
  const down = useOpenAgentDown()
  const [failed, setFailed] = useState<string>()
  const release = async (): Promise<void> => {
    setReleasing(true)
    setFailed(undefined)
    const outcome = await releaseClaim(host, project.id, ticket.file).catch((err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) }))
    if (!outcome.ok) setFailed(outcome.error)
    await reload().catch(() => {})
    setReleasing(false)
  }
  const actions = lane === 'stale' ? (
    <>
      {holder && (
        <Button variant="ghost" size="sm" onClick={() => host.openAgent(project.id, holder.id)} title="Open the run that claimed it, to go on with its work">
          Continue
        </Button>
      )}
      <Button variant="ghost" size="sm" disabled={releasing || down} onClick={() => void release()} title="Lift the claim: any agent may take the ticket again">
        {releasing ? 'Releasing…' : 'Release'}
      </Button>
    </>
  ) : lane !== 'working' && !heldBack(ticket) ? (
    <LinkActions projects={[project.id]} targets={[{ projectId: project.id, links: [ticketLink(ticket)] }]} resetKey={`${project.id}:${ticket.file}`} size="sm" variant="ghost" />
  ) : null
  const { Icon, says, tone } = stateOf(hot)
  // The short fact at the row's end, in grey.
  const fact = lane === 'waiting' ? ticket.waiting : lane === 'high-priority' && ticket.priority ? `P${ticket.priority}` : undefined
  const mark = <Icon className="h-3.5 w-3.5" aria-hidden />
  return (
    <li className="group/row relative flex h-8 items-center gap-2.5 rounded-md px-2 text-sm hover:bg-accent">
      {lane === 'working' && holder ? (
        <button type="button" onClick={() => host.openAgent(project.id, holder.id)} title={says} aria-label={says} className={cn('flex size-4 shrink-0 items-center justify-center', tone)}>
          {mark}
        </button>
      ) : (
        <span title={says} aria-label={says} className={cn('flex size-4 shrink-0 items-center justify-center', tone)}>
          {mark}
        </span>
      )}
      <a href={host.pageHref('tickets', [ticket.file], project.id)} onClick={inPlace(() => host.openPage('tickets', [ticket.file], project.id))} className="min-w-0 flex-1 truncate text-left text-foreground hover:underline">
        {ticket.title}
      </a>
      {failed && <span className="shrink-0 text-xs text-danger">{failed}</span>}
      <span className="relative flex shrink-0 items-center gap-2.5 self-stretch md:bg-[inherit]">
        {/* Laid over the title's end, on the row's own colour, so the row never moves under the pointer and its fact stays in view. */}
        {actions && (
          <div className="flex items-center gap-0.5 md:absolute md:inset-y-0 md:right-full md:w-max md:bg-[inherit] md:pl-3 md:opacity-0 md:transition-opacity md:group-hover/row:opacity-100 md:focus-within:opacity-100">
            {actions}
          </div>
        )}
        {(fact || showProject) && (
          <span className="max-w-40 truncate text-xs text-muted-foreground" title={fact}>
            {[fact, showProject ? project.name : undefined].filter(Boolean).join(' · ')}
          </span>
        )}
      </span>
    </li>
  )
}
