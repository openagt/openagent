import { read, type RpcHost } from '@openagt/hooks/rpc'
import { findRun, isRunId } from '@openagt/agent-driver'
import { ACTIONS_HOST } from './turn.js'

// host-github-actions' server part (`@openagt/hooks/rpc`): what the strip above a run's chat reads.
// What a caller sends is checked here, whatever its type says: it comes from a page.

/** A run of the project on GitHub Actions, as its strip says it: the Actions run's address once GitHub made it. Null for a run that did not run there. */
export const run = read(async (host: RpcHost, input: { agentId: string }): Promise<{ address?: string } | null> => {
  if (typeof input.agentId !== 'string' || !isRunId(input.agentId)) return null
  const card = await findRun(host.root, input.agentId).catch(() => undefined)
  if (card?.caller?.['target'] !== ACTIONS_HOST) return null
  const address = card.caller['actionsRun']
  return typeof address === 'string' && /^https:\/\//.test(address) ? { address } : {}
})
