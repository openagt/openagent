import { readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { personalFolder, withPersonalFolder, type PersonalFolderDeps } from './personal-folder.js'
import type { FileBranchWrite } from './file-branch.js'

/**
 * The agents (Rom's design): an agent is a name, a set of skills and a set of accounts, made
 * once and used in any project or none. Each is one file in the personal folder,
 * `agents/<id>.json`, so every computer of the person's that syncs the folder has the same
 * agents. The file names the accounts, never holds a token: an account the computer a run goes
 * to does not have is simply not there.
 *
 * `Default` is the agent a run is on when none is picked: the skills every run got before there
 * were agents, and no account of its own, so the computer's own picks apply. It is editable like
 * any other, and cannot be removed or renamed.
 */

/** The directory in the personal folder, one file per agent. */
export const AGENTS_DIR = 'agents'

/** The default agent's id. */
export const DEFAULT_AGENT = 'default'

/** The skills the default agent starts with: what an agent needs to ask the person and hand its work over. */
export const DEFAULT_AGENT_SKILLS: readonly string[] = ['ask', 'github']

export interface AgentRecord {
  /** The file's name: the name as a path-safe word. */
  id: string
  name: string
  /** The skills' names, as their texts' front matter names them (`tickets`, `github`). */
  skills: string[]
  /** The accounts it works as, by name: an account not on the computer a run goes to does not apply there. */
  accounts: AgentAccounts
  /**
   * Whether its sessions get the project's own skills, the ones a project keeps in its repo
   * (Rom's first level): off, a session starts from none, and can still pick them for itself.
   */
  projectSkills: boolean
}

export interface AgentAccounts {
  /** Its login at GitHub, one of OpenAgent's own accounts. */
  github?: string
  /** The Claude accounts its runs take, in order, as the Permissions page names them. */
  claude?: string[]
  /** The Codex accounts, the same way. */
  codex?: string[]
}

/** An agent's id, or a skill's name: lower-case words joined by dashes. */
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/

/** What a person may name an agent: a line of at most 40 characters that gives an id. */
export function isAgentName(name: unknown): name is string {
  return typeof name === 'string' && name.trim().length > 0 && name.trim().length <= 40 && ID.test(agentIdOf(name))
}

/** The id an agent's name gives: lower-case, every run of other characters one dash. */
export function agentIdOf(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function isAgentId(id: unknown): id is string {
  return typeof id === 'string' && ID.test(id)
}

/** The default agent as it is before anyone edits it. */
export function builtInDefault(): AgentRecord {
  return { id: DEFAULT_AGENT, name: 'Default', skills: [...DEFAULT_AGENT_SKILLS], accounts: {}, projectSkills: true }
}

export function agentsDir(folder: string = personalFolder()): string {
  return join(folder, AGENTS_DIR)
}

function agentFile(folder: string, id: string): string {
  if (!isAgentId(id)) throw new Error(`${id} is no agent id`)
  return join(agentsDir(folder), `${id}.json`)
}

/** The record a file holds, read strictly: a file that is not one is no agent. */
function readRecord(id: string, text: string): AgentRecord | undefined {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof raw !== 'object' || raw === null) return undefined
  const { name, skills, accounts, projectSkills } = raw as Record<string, unknown>
  if (typeof name !== 'string' || !name.trim()) return undefined
  const names = Array.isArray(skills) ? skills.filter((skill): skill is string => typeof skill === 'string' && ID.test(skill)) : []
  const given = typeof accounts === 'object' && accounts !== null ? (accounts as Record<string, unknown>) : {}
  const list = (value: unknown): string[] | undefined => (Array.isArray(value) && value.length > 0 && value.every(name => typeof name === 'string' && name.trim()) ? (value as string[]) : undefined)
  const claude = list(given['claude'])
  const codex = list(given['codex'])
  return {
    id,
    name: name.trim(),
    skills: [...new Set(names)],
    accounts: {
      ...(typeof given['github'] === 'string' && given['github'].trim() ? { github: given['github'].trim() } : {}),
      ...(claude ? { claude } : {}),
      ...(codex ? { codex } : {}),
    },
    projectSkills: projectSkills !== false,
  }
}

/**
 * One agent by its id: the default as built in when it has no file yet; none for another id with
 * no file, or a file that is no agent.
 */
export async function readAgent(id: string, folder: string = personalFolder()): Promise<AgentRecord | undefined> {
  if (!isAgentId(id)) return undefined
  const text = await readFile(agentFile(folder, id), 'utf8').catch(() => undefined)
  if (text === undefined) return id === DEFAULT_AGENT ? builtInDefault() : undefined
  return readRecord(id, text) ?? (id === DEFAULT_AGENT ? builtInDefault() : undefined)
}

/** Every agent: the default first, then the others by name. */
export async function listAgents(folder: string = personalFolder()): Promise<AgentRecord[]> {
  const names = await readdir(agentsDir(folder)).catch((): string[] => [])
  const agents: AgentRecord[] = []
  for (const file of names) {
    if (!file.endsWith('.json')) continue
    const id = file.slice(0, -'.json'.length)
    if (!isAgentId(id) || id === DEFAULT_AGENT) continue
    const record = await readAgent(id, folder)
    if (record) agents.push(record)
  }
  agents.sort((a, b) => a.name.localeCompare(b.name))
  return [(await readAgent(DEFAULT_AGENT, folder))!, ...agents]
}

/**
 * Write an agent: its file in the personal folder, committed there, so it goes to every computer
 * that syncs the folder. Only the names of its accounts are written, never a token.
 */
export async function writeAgent(record: AgentRecord, deps: PersonalFolderDeps = {}): Promise<FileBranchWrite> {
  const folder = deps.folder ?? personalFolder()
  const file = agentFile(folder, record.id)
  const body = JSON.stringify({ name: record.name, skills: record.skills, accounts: record.accounts, projectSkills: record.projectSkills }, null, 2) + '\n'
  return withPersonalFolder(
    folder,
    `agent ${record.name}`,
    async () => {
      await mkdir(agentsDir(folder), { recursive: true })
      await writeFile(file, body)
    },
    deps,
  )
}

/** Remove an agent's file; the default agent stays. */
export async function removeAgent(id: string, deps: PersonalFolderDeps = {}): Promise<FileBranchWrite> {
  if (id === DEFAULT_AGENT) throw new Error('the default agent cannot be removed')
  const folder = deps.folder ?? personalFolder()
  const file = agentFile(folder, id)
  return withPersonalFolder(folder, `remove agent ${id}`, () => rm(file, { force: true }), deps)
}
