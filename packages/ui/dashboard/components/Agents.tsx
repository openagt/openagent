import { useContext } from 'react'
import type { ActiveAgent, AgentDoing } from '../../src/index.js'
import { Panel, PanelGroup, PanelNote, PanelRow } from './ui/panel.js'
import { Skeleton } from './ui/skeleton.js'
import { PanelShape, Slot } from './ui/slot.js'
import { PartDescription } from './PartDescription.js'
import type { ReadState } from '../lib/use-async.js'
import { formatDateTime, formatDuration } from '../lib/format-date.js'
import { OnComputer } from './MachineMark.js'
import { MiddleCut } from './MiddleCut.js'
import { runName } from '../../src/client.js'
import { awaitingName } from '../lib/agent-label.js'
import { useRunHosts } from '../lib/run-hosts.js'
import { RunMark } from './RunMark.js'
import { HostServicesContext, INERT_HOST_SERVICES } from '../lib/host-services.js'

// The Overview's At work part (#1139): the sessions working right now, a row each, the whole row a
// link straight into that session. A row names the run as the sidebar does; under it where it runs
// and the last step its diary took, where this computer can read it; at its end how long it has
// worked, its start on hover. The part's name says they work, so no row says it again. Finished
// sessions live in the sidebar's session list, so a second copy here says nothing new.
//
// Its own file rather than inline in DashboardPage: opening a session from here is the behaviour
// #1189 exists to protect. What the runs are doing is read by the page and handed in, so the part has
// no read of its own to stand in for in a test.

export function Agents({
  working,
  state,
  namesRuns,
  doing = {},
  projectsNamed = true,
  onSelectAgent,
}: {
  /** The agents at work; none says so in one line. */
  working: ActiveAgent[]
  /** What is known of the agents: until they are read the part waits, not saying that none is at work. */
  state: ReadState
  /** Whether runs are given a short name, which a row waits for as the sidebar's does. */
  namesRuns: boolean
  /** What each is doing now, by `${projectId}/${agentId}`: a run with no entry says nothing of it. */
  doing?: Record<string, AgentDoing>
  /** The runs may be of several projects: each row names its own. */
  projectsNamed?: boolean
  onSelectAgent: (projectId: string, agentId: string) => void
}) {
  const services = useContext(HostServicesContext) ?? INERT_HOST_SERVICES
  return (
    <PanelGroup bare title="At work">
      <PartDescription>Agents currently working</PartDescription>
      <Slot of={{ state, value: working }} shape={<PanelShape />}>
        {() => (
          <Panel>
            {working.length === 0 && <PanelNote>No agent is at work.</PanelNote>}
            {working.map(agent => (
              <RunRow
                key={`${agent.projectId}:${agent.agentId}`}
                agent={agent}
                naming={awaitingName(agent, namesRuns)}
                doing={doing[`${agent.projectId}/${agent.agentId}`]?.doing}
                projectNamed={projectsNamed}
                href={services.agentHref(agent.projectId, agent.agentId)}
                onOpen={() => onSelectAgent(agent.projectId, agent.agentId)}
              />
            ))}
          </Panel>
        )}
      </Slot>
    </PanelGroup>
  )
}

/** One run at work: its mark, its name, where it runs and its last step, and how long it has worked. */
function RunRow({ agent, naming, doing, projectNamed, href, onOpen }: {
  agent: ActiveAgent
  /** The name is still being made: the row holds its place, as the sidebar's does. */
  naming: boolean
  /** The last step it took, on one line. */
  doing: string | undefined
  projectNamed: boolean
  /** The session's address, for a click the browser takes (a new tab, a middle click). */
  href: string
  /** Open the session — project and run both, never just the launcher (#1189). */
  onOpen: () => void
}) {
  // A run on a host beside this computer's (#1668, #2394): no process here backs the row, so it says where it runs.
  const hosts = useRunHosts(agent.host !== undefined ? agent.projectId : null)
  return (
    // The run's mark is the hexagon, 14 in the row's 16 place (rulings-5: at least 12 of ink).
    <PanelRow
      state={<RunMark status="running" />}
      title={
        naming ? (
          <>
            <Skeleton className="my-0.5 h-4 w-2/3" aria-hidden />
            <span className="sr-only">Naming this session</span>
          </>
        ) : (
          activeLabel(agent)
        )
      }
      meta={[
        agent.host !== undefined && (hosts.find(one => one.id === agent.host)?.label ?? 'Another host'),
        projectNamed && agent.projectName,
        agent.computer && <OnComputer computer={agent.computer} />,
        // The part that gives way, with its last step: cut in its middle, as the Logs cut it, so the words before it stay whole.
        agent.branch && {
          fact: (
            <span className="flex min-w-0 font-mono" title={agent.branch}>
              <MiddleCut text={agent.branch} />
            </span>
          ),
          className: 'not-last:shrink',
        },
        doing !== undefined && (
          <span title={doing} className="font-mono">
            {doing}
          </span>
        ),
      ]}
      fact={
        <span title={`Started ${formatDateTime(agent.startedAt)}`} className="tabular-nums">
          {formatDuration(Date.now() - Date.parse(agent.startedAt))}
        </span>
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
