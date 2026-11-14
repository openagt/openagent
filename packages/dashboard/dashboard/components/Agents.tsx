import { useContext } from 'react'
import type { ActiveAgent } from '../../src/index.js'
import { Section } from './ui/section.js'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip.js'
import { formatAge, formatDateTime } from '../lib/format-date.js'
import { OnComputer } from './MachineMark.js'
import { runName } from '../../src/client.js'
import { awaitingName } from '../lib/agent-label.js'
import { STATUS_DOT } from '../lib/status-tone.js'
import { cn } from '../lib/utils.js'
import { HostServicesContext, INERT_HOST_SERVICES } from '../lib/host-services.js'
import { inPlace } from '../lib/in-place.js'

// The Overview's Agents card (#1139): the sessions working right now. Each row is the whole line,
// clickable straight into that session — its label is the one-liner the sidebar shows, and its age
// reads "22s ago" with the exact moment on hover. This is what replaced the old "Working now" list.
// The Recent column the card launched with is gone: finished sessions already live in the sidebar's
// session list, so a second copy here said nothing new.
//
// Its own file rather than inline in DashboardPage, like every other card on the Overview: opening
// a session from here is the behaviour #1189 exists to protect, and DashboardPage has no test file
// to pin it in.

export function Agents({
  working,
  loaded,
  namesRuns,
  onSelectAgent,
}: {
  /** The agents at work; none says so in one line. */
  working: ActiveAgent[]
  /** The agents were read: until then the card says it is loading, not that none is at work. */
  loaded: boolean
  /** Whether runs are given a short name, which a row waits for as the sidebar's does. */
  namesRuns: boolean
  onSelectAgent: (projectId: string, agentId: string) => void
}) {
  const services = useContext(HostServicesContext) ?? INERT_HOST_SERVICES
  return (
    <Section title="Agents at work" count={loaded && working.length > 0 ? working.length : undefined}>
      <p className="-mt-1 mb-3 text-xs text-muted-foreground">Agents currently working</p>
      {!loaded ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : working.length === 0 ? (
        <p className="text-sm text-muted-foreground">No agent is at work.</p>
      ) : (
        <ul className="-mx-2 space-y-0.5">
          {working.map(a => (
            <AgentRow
              key={`${a.projectId}:${a.agentId}`}
              label={activeLabel(a)}
              naming={awaitingName(a, namesRuns)}
              cloud={a.cloud}
              computer={a.computer}
              at={a.updatedAt}
              projectName={a.projectName}
              href={services.agentHref(a.projectId, a.agentId)}
              onOpen={() => onSelectAgent(a.projectId, a.agentId)}
            />
          ))}
        </ul>
      )}
    </Section>
  )
}

function AgentRow({
  label,
  naming,
  cloud,
  computer,
  at,
  projectName,
  href,
  onOpen,
}: {
  /** The session's one-liner, the same the sidebar shows. */
  label: string
  /** The name is still being made: the row holds its place, as the sidebar's does. */
  naming: boolean
  /** A web run's cloud side at work (#1668): say where it is, since no local process backs the row. */
  cloud?: 'in-cloud' | 'waiting' | undefined
  /** The computer it runs on, when that is not this one (#1648). */
  computer?: ActiveAgent['computer']
  /** ISO: the session's last activity. */
  at: string | undefined
  projectName: string
  /** The session's address, for a click the browser takes (a new tab, a middle click). */
  href: string
  /** Open the session — project and run both, never just the launcher (#1189). */
  onOpen: () => void
}) {
  return (
    <li>
      {/* No hint on the row itself: that a session row opens the session is the one thing this card
          says already, and a tooltip on the row would sit over the one on the age (#1149). */}
      <a
        href={href}
        onClick={inPlace(onOpen)}
        className="flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
      >
        <span aria-hidden className={cn('size-1.5 shrink-0 self-center rounded-full', STATUS_DOT[cloud === 'waiting' ? 'waiting' : 'running'])} />
        {naming ? (
          <span className="min-w-0 flex-1 self-center">
            <span className="block h-3.5 w-2/3 animate-pulse rounded bg-muted-foreground/20" />
            <span className="sr-only">Naming this session</span>
          </span>
        ) : (
          <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
        )}
        {cloud && <span className="shrink-0 text-[10px] uppercase text-muted-foreground">{cloud === 'waiting' ? 'waiting' : 'in cloud'}</span>}
        <span className="shrink-0 text-xs text-muted-foreground">{projectName}</span>
        {computer && <OnComputer computer={computer} />}

        {at && (
          <Tooltip>
            <TooltipTrigger
              render={<span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground/80" />}
            >
              {formatAge(at)}
            </TooltipTrigger>
            <TooltipContent>{formatDateTime(at)}</TooltipContent>
          </Tooltip>
        )}
      </a>
    </li>
  )
}

// A working session's one-liner: what the sidebar shows for it (`runName`); its project is the last resort.
function activeLabel(a: ActiveAgent): string {
  return runName(a) ?? (a.scope?.trim() || a.projectName)
}
