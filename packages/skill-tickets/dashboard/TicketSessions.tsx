import { List, Row, StateCell, formatAge, runName, runSaid, type ModuleAgent, type WorkState } from '@openagt/dashboard/module'
import { holderAgent, planAgentFor, workAgentFor } from '../src/module.js'

/** One kind of session on a ticket: the one that wrote its plan, or the one that worked it. */
export interface TicketSession {
  kind: 'plan' | 'work'
  agent: ModuleAgent
}

/**
 * The sessions behind a ticket, from the project's runs: the one whose ask named its plan wrote it
 * (the plan file carries no marker), and the one that worked it — asked about its file, or holding
 * its claim now.
 */
export function sessionsOf(agents: readonly ModuleAgent[], ticket: { file: string; lockedBy?: string | undefined }): TicketSession[] {
  const plan = planAgentFor(agents, ticket.file)
  const work = holderAgent(agents, ticket.lockedBy) ?? workAgentFor(agents, ticket.file)
  return [...(plan ? [{ kind: 'plan' as const, agent: plan }] : []), ...(work && work.id !== plan?.id ? [{ kind: 'work' as const, agent: work }] : [])]
}

/** What each kind of run did to the ticket, said under the pointer. */
const DID = { plan: { running: 'Writing its plan', ended: 'Wrote its plan' }, work: { running: 'Working on it', ended: 'Worked on it' } } as const

/** A run's status as its mark draws it. */
const STATE: Record<string, WorkState> = { running: 'working', waiting: 'waiting', done: 'done', failed: 'failed', stopped: 'stopped' }

/** The runs that planned and worked a ticket, each opened by a press on its row. */
export function TicketSessions({ sessions, onOpen }: { sessions: readonly TicketSession[]; onOpen: (agentId: string) => void }) {
  if (sessions.length === 0) return null
  return (
    <List>
      {sessions.map(({ kind, agent }) => {
        const running = agent.status === 'running' || agent.status === 'waiting'
        return (
          <Row
            key={kind}
            leading={<StateCell state={STATE[agent.status] ?? 'idle'} />}
            title={<span title={`${running ? DID[kind].running : DID[kind].ended}: ${runSaid(agent.status)}`}>{runName({ ...(agent.title ? { title: agent.title } : {}), ...(agent.ask ? { intent: agent.ask } : {}), ...(agent.name ? { branch: agent.name } : {}) }) || agent.id}</span>}
            meta={<span className="tabular-nums">{formatAge(agent.endedAt ?? agent.startedAt).replace(/ ago$/, '')}</span>}
            onClick={() => onOpen(agent.id)}
          />
        )
      })}
    </List>
  )
}
