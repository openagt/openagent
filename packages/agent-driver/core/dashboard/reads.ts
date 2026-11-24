import { useEffect, useState } from 'react'
import { computerRpcClient, useAskOn, usePolled, type ModuleHost } from '@openagt/ui/module'
import type { AgentPick } from '@openagt/hooks'
import type { AgentOffered, AgentState, QuotaView } from '../src/server.js'

// The package's server part, which every piece here reads through: what it reads is this
// computer's (the coding agents, their accounts, the picks for every next run), so it is called in
// no project. And the reads more than one piece shares, kept for the page's life under one name each.

/** The server part, for the host the piece is drawn with. */
export const server = (host: Pick<ModuleHost, 'callComputer'>) => computerRpcClient<typeof import('../src/server.js')>(host)

/** How often what an agent needs to run here is asked again: often while an install runs, less while one is missing. */
const BUSY_MS = 2_000
const MISSING_MS = 8_000
const SELDOM_MS = 30_000

/** The coding agents with the models each offers; `undefined` until answered. Asked once for the page's life: a menu opened later names the models from its first frame. */
export function useAgentsOffered(host: ModuleHost): AgentOffered[] | undefined {
  return usePolled<AgentOffered[] | undefined>(() => server(host).agents({}), undefined, 60 * 60_000, [], { remember: 'agent-driver:agents' }).value
}

/** The coding agent, model and effort picked for every next run on this computer, and how a new pick is saved. */
export function usePicked(host: ModuleHost): { picked: AgentPick | undefined; pick: (next: AgentPick) => Promise<void> } {
  const { value, reload } = usePolled<AgentPick | undefined>(() => server(host).picked({}), undefined, SELDOM_MS, [], { remember: 'agent-driver:picked', stored: true })
  return {
    picked: value,
    pick: async next => {
      await server(host).pick(next)
      await reload()
    },
  }
}

/** Whether each coding agent can run here, asked again at the pace its last answer calls for: often while an install runs, less while an agent is missing. */
export function useAgentStates(host: ModuleHost): { states: AgentState[] | undefined; reload: () => Promise<void> } {
  const [every, setEvery] = useState(SELDOM_MS)
  const { value, reload, refresh } = usePolled<AgentState[] | undefined>(() => server(host).states({}), undefined, every, [], { remember: 'agent-driver:states', stored: true })
  useAskOn(every, refresh)
  const next = value?.some(state => state.fixing) ? BUSY_MS : value?.some(state => !state.ready) ? MISSING_MS : SELDOM_MS
  useEffect(() => {
    if (next !== every) setEvery(next)
  }, [next, every])
  return { states: value, reload }
}

/** How often the quota is asked again: the server reads it from the agent every few minutes. */
const QUOTA_EVERY_MS = 60_000

/** Where the account's quota stands against its boundary; `undefined` until first read. Kept in this browser, so the card draws it from its first frame. */
export function useQuota(host: ModuleHost): QuotaView | undefined {
  return usePolled<QuotaView | undefined>(() => server(host).quota({}), undefined, QUOTA_EVERY_MS, [], { remember: 'agent-driver:quota', stored: true }).value
}
