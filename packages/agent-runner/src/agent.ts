import { AGENT_ENV, DEFAULT_AGENT, isAgentId, readAgent, type AgentRecord } from '@openagt/agent-data'

/**
 * The agent a run is on (Rom's design): a name, a set of skills and a set of accounts, one file
 * in the personal folder (`agent-data`'s `agents.ts`). Whoever starts the run names it in the
 * environment ({@link AGENT_ENV}); a resumed run goes on with the one its record names. None
 * named, or a file this computer does not have (an agent made on another computer before the
 * folder synced), is the default agent, said on `log`.
 */

/** The agent named for this run, by its id, read off the environment: none for the default. */
export function agentNamed(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const id = env[AGENT_ENV]?.trim()
  if (!id) return undefined
  if (!isAgentId(id)) throw new Error(`${AGENT_ENV} is no agent id: ${id}`)
  return id === DEFAULT_AGENT ? undefined : id
}

/** The agent `id` names, or the default agent when it names none, or none this computer has. */
export async function runAgent(id: string | undefined, log: (line: string) => void = () => {}): Promise<AgentRecord> {
  const record = id !== undefined ? await readAgent(id) : undefined
  if (id !== undefined && !record) log(`[agent-runner] no agent ${id} on this computer: the run is on the default agent`)
  return record ?? (await readAgent(DEFAULT_AGENT))!
}
