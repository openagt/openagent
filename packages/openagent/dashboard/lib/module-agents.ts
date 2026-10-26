import type { ModuleAgent, ModuleAgentsWanted } from '../../src/dashboard/module-agents.js'
import { onModuleAgents } from '../rpc/reads.js'

/** How long one card's answer serves another asking the same: the Overview's cards ask at once, then on their own clocks. */
const SHARED_MS = 3000

/** Each question as last asked: the answer, or the read on its way, and when it was asked. */
const lastRead = new Map<string, { at: number; agents: Promise<ModuleAgent[]> }>()

/**
 * A project's runs for a module's page or card, the ones it wants: a read on its way, or one
 * answered within {@link SHARED_MS}, for the same question is the answer, so two cards asking at
 * once ask the daemon once.
 */
export function readModuleAgents(projectId: string, wanted: ModuleAgentsWanted = {}): Promise<ModuleAgent[]> {
  const key = JSON.stringify([projectId, wanted.ids ?? null, wanted.since ?? null])
  const last = lastRead.get(key)
  if (last && Date.now() - last.at < SHARED_MS) return last.agents
  const read = { at: Date.now(), agents: onModuleAgents(projectId, wanted) }
  lastRead.set(key, read)
  // A failed read is not handed to the next asker.
  read.agents.catch(() => void (lastRead.get(key) === read && lastRead.delete(key)))
  return read.agents
}
