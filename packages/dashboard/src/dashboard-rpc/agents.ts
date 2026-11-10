import { readFile, realpath } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { agentIdOf, DEFAULT_AGENT, DEFAULT_AGENT_SKILLS, isAgentId, isAgentName, listAgents, readAgent, removeAgent, writeAgent, type AgentAccounts, type AgentRecord } from '@openagt/agent-data'
import { carriedSkills, GROUPS } from '../project-skills/catalogue.js'
import { onAgentAccounts, type AccountResult } from './accounts.js'
import { onGitHosts } from './logins.js'
import { agentLoginsOn, syncLogins, type AgentLoginsOn } from '../dashboard/logins-sync.js'

export type { AgentAccounts, AgentRecord } from '@openagt/agent-data'
export type { AgentLoginsOn } from '../dashboard/logins-sync.js'

// The Agents page (Rom's design): an agent is a name, a set of skills and a set of accounts, kept
// as one file each in the personal folder, so every computer that syncs it has the same agents.
// The page lists them, edits them in a dialog, makes new ones and removes them; the default agent is
// edited like the others and never removed. What an agent can be given is what this computer
// knows: the skills the dashboard carries, OpenAgent's own GitHub accounts here, and the Claude
// and Codex accounts of the Permissions page.

/** The host the GitHub skill answers for, whose accounts an agent names. */
const GITHUB = 'github.com'

/** One skill an agent can be given. */
export interface AgentSkillChoice {
  name: string
  /** The one line the skill's text says of itself. */
  description: string
}

export interface AgentsView {
  /** Every agent, the default first. */
  agents: AgentRecord[]
  /** The skills to pick from, in groups: the default agent's first, then the catalogue's. */
  skills: { title: string; skills: AgentSkillChoice[] }[]
  /** OpenAgent's GitHub accounts on this computer, and the host one more is added at. */
  github?: { host: string; accounts: string[] }
  /** The Claude accounts of the Permissions page, by id and name. */
  claude: { id: string; name: string }[]
  /** The Codex accounts, the same way. */
  codex: { id: string; name: string }[]
}

/** The group the default agent's skills are shown in. */
const DEFAULTS_GROUP = 'Every agent starts with'

let defaults: Promise<AgentSkillChoice[]> | undefined

/** The default skills' names and lines, read once from their packages. */
function defaultSkillChoices(): Promise<AgentSkillChoice[]> {
  return (defaults ??= (async () => {
    const require = createRequire(import.meta.url)
    const choices: AgentSkillChoice[] = []
    for (const name of DEFAULT_AGENT_SKILLS) {
      try {
        const dir = await realpath(dirname(require.resolve(`@openagt/skill-${name}/package.json`)))
        const text = await readFile(join(dir, 'SKILL.md'), 'utf8')
        const description = /^description:[ \t]*(.*)$/m.exec(text)?.[1]?.trim().replace(/^"(.*)"$/, '$1') ?? ''
        choices.push({ name, description })
      } catch {
        choices.push({ name, description: '' })
      }
    }
    return choices
  })())
}

/** The skills an agent can be given, in groups. */
async function skillChoices(): Promise<AgentsView['skills']> {
  const carried = await carriedSkills()
  return [
    { title: DEFAULTS_GROUP, skills: await defaultSkillChoices() },
    ...GROUPS.map(group => ({ title: group.title, skills: group.skills.flatMap(name => (carried.has(name) ? [{ name, description: carried.get(name)!.description }] : [])) })),
  ]
}

/** Every agent, and what one can be given. (`onAgents` names the runs' list already.) */
export async function onAgentsList(): Promise<AgentsView> {
  const [agents, skills, hosts, claude, codex] = await Promise.all([listAgents(), skillChoices(), onGitHosts(), onAgentAccounts('claude'), onAgentAccounts('codex')])
  const provider = hosts.hosts.find(row => row.host === GITHUB)?.provider
  return {
    agents,
    skills,
    ...(provider ? { github: { host: GITHUB, accounts: provider.accounts.filter(account => account.ok).map(account => account.login) } } : {}),
    claude: claude.accounts.map(account => ({ id: account.id, name: account.name })),
    codex: codex.accounts.map(account => ({ id: account.id, name: account.name })),
  }
}

/** What the page sends to save an agent: a new one has no id yet. */
export interface AgentChange {
  id?: string
  name: string
  skills: string[]
  accounts: AgentAccounts
  /** Whether its sessions get the project's own skills. */
  projectSkills: boolean
}

/**
 * Save an agent: a new one under the id its name gives, an existing one under its own. The name
 * must give an id, every skill must be one this computer carries, and every account one it knows;
 * else nothing is written and the reason is said.
 */
export async function sendSaveAgent(change: AgentChange): Promise<({ ok: true; id: string } | { ok: false; error: string }) & Partial<AccountResult>> {
  if (typeof change !== 'object' || change === null) return { ok: false, error: 'That is no agent.' }
  if (!isAgentName(change.name)) return { ok: false, error: 'An agent needs a name of a few words: letters and digits, at most 40 characters.' }
  const name = change.name.trim()
  const id = change.id === undefined ? agentIdOf(name) : change.id
  if (!isAgentId(id)) return { ok: false, error: 'That is no agent id.' }
  if (change.id === undefined && (await readAgent(id)) !== undefined) return { ok: false, error: `There is an agent ${name} already.` }
  if (change.id !== undefined && change.id !== DEFAULT_AGENT && (await readAgent(change.id)) === undefined) return { ok: false, error: 'That agent is gone: make it again.' }
  if (id === DEFAULT_AGENT && name !== 'Default') return { ok: false, error: 'The default agent keeps its name.' }
  const known = new Set((await skillChoices()).flatMap(group => group.skills.map(skill => skill.name)))
  const skills = Array.isArray(change.skills) ? change.skills : undefined
  if (!skills || skills.some(skill => typeof skill !== 'string' || !known.has(skill))) return { ok: false, error: 'An agent is given skills from the list.' }
  if (typeof change.projectSkills !== 'boolean') return { ok: false, error: 'Whether an agent gets project skills is yes or no.' }
  const view = await onAgentsList()
  const given = typeof change.accounts === 'object' && change.accounts !== null ? change.accounts : {}
  const accounts: AgentAccounts = {}
  if (given.github !== undefined) {
    if (typeof given.github !== 'string' || !view.github?.accounts.includes(given.github)) return { ok: false, error: `OpenAgent has no GitHub account ${String(given.github)} on this computer.` }
    accounts.github = given.github
  }
  for (const kind of ['claude', 'codex'] as const) {
    const picked = given[kind]
    if (picked === undefined) continue
    if (!Array.isArray(picked) || picked.some(one => typeof one !== 'string' || !view[kind].some(account => account.id === one))) return { ok: false, error: `That ${kind === 'claude' ? 'Claude' : 'Codex'} account is not on this computer.` }
    if (picked.length > 0) accounts[kind] = picked
  }
  const written = await writeAgent({ id, name, skills: [...new Set(skills)], accounts, projectSkills: change.projectSkills })
  if (!written.ok && !written.committed) return { ok: false, error: written.error }
  // Its GitHub account goes to every device of the person's now, not a minute from now; the page follows it.
  if (accounts.github !== undefined && process.env['OPENAGENT_SERVER'] !== '1') void syncLogins().catch(() => [])
  return { ok: true, id }
}

/** How the agents' GitHub accounts stand on each device of the person's. A server copies to no device: none. */
export async function onAgentLogins(): Promise<AgentLoginsOn[]> {
  if (process.env['OPENAGENT_SERVER'] === '1') return []
  return agentLoginsOn()
}

/** Copy the agents' GitHub accounts to every device again, now: the press for one that failed. */
export async function sendCopyAgentLogins(): Promise<AccountResult> {
  if (process.env['OPENAGENT_SERVER'] === '1') return { ok: false, error: 'A server copies logins to no device.' }
  await syncLogins()
  return { ok: true }
}

/** Remove an agent; the default agent stays. */
export async function sendRemoveAgent(id: string): Promise<AccountResult> {
  if (!isAgentId(id)) return { ok: false, error: 'That is no agent id.' }
  if (id === DEFAULT_AGENT) return { ok: false, error: 'The default agent stays.' }
  try {
    const removed = await removeAgent(id)
    return removed.ok || removed.committed ? { ok: true } : { ok: false, error: removed.error }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
