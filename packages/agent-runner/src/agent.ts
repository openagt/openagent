import { AGENT_ENV, DEFAULT_AGENT, PROJECT_SKILLS_ENV, SKILLS_OFF_ENV, SKILLS_ON_ENV, isAgentId, isSkillName, readAgent, type AgentRecord } from '@openagt/agent-data'

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

/** Which of the project's own skills a run gets: none, or the ones named; every one when absent. */
export type ProjectSkillsPick = 'none' | string[]

/**
 * A session's picks of the skills its run gets, made beside the message box for that run alone
 * and kept on its record: skills on top of its agent's, skills of its agent's left out, and which
 * of the project's own skills stay in its checkout. Named in the environment with the agent
 * ({@link SKILLS_ON_ENV}, {@link SKILLS_OFF_ENV}, {@link PROJECT_SKILLS_ENV}).
 */
export interface SkillPicks {
  on?: string[]
  off?: string[]
  project?: ProjectSkillsPick
}

/** The picks named for this run in the environment; none where nothing is set. A word that is no skill name refuses. */
export function skillPicksNamed(env: NodeJS.ProcessEnv = process.env): SkillPicks {
  const names = (variable: string): string[] | undefined => {
    const value = env[variable]?.trim()
    if (!value) return undefined
    const list = value.split(',').map(name => name.trim()).filter(Boolean)
    const odd = list.find(name => !isSkillName(name))
    if (odd !== undefined) throw new Error(`${variable} is no list of skill names: ${odd}`)
    return [...new Set(list)]
  }
  const on = names(SKILLS_ON_ENV)
  const off = names(SKILLS_OFF_ENV)
  const project = env[PROJECT_SKILLS_ENV]?.trim()
  const kept = !project || project === 'all' ? undefined : project === 'none' ? 'none' : names(PROJECT_SKILLS_ENV)!
  return { ...(on ? { on } : {}), ...(off ? { off } : {}), ...(kept !== undefined ? { project: kept } : {}) }
}

/** Whether any pick is made. */
export function anySkillPick(picks: SkillPicks): boolean {
  return picks.on !== undefined || picks.off !== undefined || picks.project !== undefined
}

/** The agent `id` names, or the default agent when it names none, or none this computer has. */
export async function runAgent(id: string | undefined, log: (line: string) => void = () => {}): Promise<AgentRecord> {
  const record = id !== undefined ? await readAgent(id) : undefined
  if (id !== undefined && !record) log(`[agent-runner] no agent ${id} on this computer: the run is on the default agent`)
  return record ?? (await readAgent(DEFAULT_AGENT))!
}
