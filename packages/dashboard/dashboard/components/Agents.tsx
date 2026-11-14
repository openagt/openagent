import { useContext } from 'react'
import type { ActiveAgent } from '../../src/index.js'
import { Section } from './ui/section.js'
import { List, Row } from './ui/list.js'
import { Skeleton } from './ui/skeleton.js'
import { RowShapes, Slot } from './ui/slot.js'
import type { ReadState } from '../lib/use-async.js'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip.js'
import { formatAge, formatDateTime } from '../lib/format-date.js'
import { OnComputer } from './MachineMark.js'
import { runName } from '../../src/client.js'
import { awaitingName } from '../lib/agent-label.js'
import { STATUS_DOT } from '../lib/status-tone.js'
import { cn } from '../lib/utils.js'
import { HostServicesContext, INERT_HOST_SERVICES } from '../lib/host-services.js'

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
  state,
  namesRuns,
  onSelectAgent,
}: {
  /** The agents at work; none says so in one line. */
  working: ActiveAgent[]
  /** What is known of the agents: until they are read the card says it is loading, not that none is at work. */
  state: ReadState
  /** Whether runs are given a short name, which a row waits for as the sidebar's does. */
  namesRuns: boolean
  onSelectAgent: (projectId: string, agentId: string) => void
}) {
  const services = useContext(HostServicesContext) ?? INERT_HOST_SERVICES
  return (
    <Section title="Agents at work" count={state !== 'unknown' && working.length > 0 ? working.length : undefined}>
      <p className="-mt-1 mb-3 text-xs text-muted-foreground">Agents currently working</p>
      <Slot of={{ state, value: working }} shape={<RowShapes rows={1} />}>
        {() => working.length === 0 ? (
          <p className="text-sm text-muted-foreground">No agent is at work.</p>
        ) : (
          <List>
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
          </List>
        )}
      </Slot>
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
    // No hint on the row itself: that a session row opens the session is the one thing this list
    // says already, and a tooltip on the row would sit over the one on the age (#1149).
    <Row
      leading={
        <span className="flex size-4 items-center justify-center" aria-hidden>
          <span className={cn('size-1.5 rounded-full', STATUS_DOT[cloud === 'waiting' ? 'waiting' : 'running'])} />
        </span>
      }
      title={
        naming ? (
          <>
            <Skeleton className="h-3.5 w-2/3" aria-hidden />
            <span className="sr-only">Naming this session</span>
          </>
        ) : (
          label
        )
      }
      meta={
        <>
          {cloud && <span>{cloud === 'waiting' ? 'waiting' : 'in cloud'}</span>}
          <span>{projectName}</span>
          {computer && <OnComputer computer={computer} />}
          {at && (
            <Tooltip>
              <TooltipTrigger render={<span className="relative whitespace-nowrap tabular-nums" />}>{formatAge(at)}</TooltipTrigger>
              <TooltipContent>{formatDateTime(at)}</TooltipContent>
            </Tooltip>
          )}
        </>
      }
      href={href}
      onClick={onOpen}
    />
  )
}

// A working session's one-liner: what the sidebar shows for it (`runName`); its project is the last resort.
function activeLabel(a: ActiveAgent): string {
  return runName(a) ?? (a.scope?.trim() || a.projectName)
}
