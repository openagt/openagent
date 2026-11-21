import { useState } from 'react'
import { rpcClient, runsAgain, usePolled, useModuleHost, type ReadState } from '@openagt/ui/module'
import { holderAgent, withHolder } from '../../src/module.js'
import { sessionsOf, type TicketSession } from '../TicketSessions.js'
import { holdingRun } from './holding-run.js'
import type { WorkspaceTicketDetail } from './types.js'

/**
 * One ticket as its pages read it: the ticket with its holder resolved against the project's runs
 * (a lock names a run's id, so a claim a run made links to its page and reads as its session name),
 * its plan, how the run holding its claim stands, and the sessions that planned and worked it.
 * `ticket` is null for a ticket that is not there (deleted since the list read, a stale link).
 */
export type TicketRead =
  | { ticket: WorkspaceTicketDetail | null; plan: string | null; holderStatus?: string; sessions: TicketSession[] }
  | { error: string }

/** The ticket `slug`, read every 10 s and kept for the next visit; `released` hides its claim until a read no longer shows that holder's. */
export function useTicket(projectId: string, slug: string): { read: TicketRead | null; state: ReadState; reload: () => Promise<void>; released: () => void } {
  const host = useModuleHost()
  const server = rpcClient<typeof import('../../src/server.js')>(host)
  const { value: polled, state, reload } = usePolled<TicketRead | null>(
    async () => {
      const [shown, agents] = await Promise.all([
        server.show(projectId, { file: slug }).then(
          shown => ({ shown }),
          (err: unknown) => ({ error: err instanceof Error ? err.message : String(err) }),
        ),
        host.agents(projectId).catch(() => []),
      ])
      if ('error' in shown) return shown
      if (!shown.shown) return { ticket: null, plan: null, sessions: [] }
      const holder = holderAgent(agents, shown.shown.ticket.lockedBy)
      return {
        ticket: withHolder(shown.shown.ticket, holdingRun(holder)),
        plan: shown.shown.plan ?? null,
        ...(holder ? { holderStatus: holder.status } : {}),
        sessions: sessionsOf(agents, shown.shown.ticket),
      }
    },
    null,
    10_000,
    [projectId, slug],
    { remember: `tickets:ticket:${projectId}/${slug}`, stored: true },
    runsAgain(projectId),
  )
  const [releasedFrom, setReleasedFrom] = useState<string | null>(null)
  const ticket = polled && 'ticket' in polled ? polled.ticket : null
  let read = polled
  if (polled && 'ticket' in polled && ticket?.locked && ticket.lockedBy === releasedFrom) {
    const { lockedBy: _by, lockedByAgent: _agent, ...free } = ticket
    const { holderStatus: _status, ...rest } = polled
    read = { ...rest, ticket: { ...free, locked: false } }
  }
  const released = () => {
    setReleasedFrom(ticket?.lockedBy ?? null)
    void reload()
  }
  return { read, state, reload, released }
}
