import { isSkillName } from '@openagt/agent-data'
import { DEFAULT_PROFILE, PROFILES, isProfileId, isProfileName, profileIdOf, profilesIn, type Profile, type RunOptions } from '@openagt/hooks'
import { distributionSettings } from '../distribution-hooks.js'
import { distributionPlugins } from '../distribution-packages.js'
import { onAgentAccounts, type AccountResult, type AccountRow } from './accounts.js'
import { onGitHosts } from './logins.js'


export type { Profile, RunOptions } from '@openagt/hooks'


// The Profiles page (#2394): a profile is a name and a saved set of run options, made once
// and used in any project or none, kept with the person through the store (the catalog's
// `profiles.saved`), so every computer of theirs has the same profiles. The page lists them, edits
// them in a dialog, makes new ones and removes them; Default is edited like the others and never
// removed or renamed. What a profile can name is what this computer knows: OpenAgent's own GitHub
// accounts here, the Claude and Codex accounts of the Permissions page, and the distribution's
// plugins its runs go without.

/** The host the GitHub skill answers for, whose accounts a profile names. */
const GITHUB = 'github.com'

export interface ProfilesView {
  /** Every profile, Default first. */
  profiles: Profile[]
  /** OpenAgent's GitHub accounts on this computer, and the host one more is added at. */
  github?: { host: string; accounts: string[] }
  /** The Claude accounts of the Permissions page, by id and name; this computer's own login says when it is logged out. */
  claude: ProfileAccountChoice[]
  /** The Codex accounts, the same way. */
  codex: ProfileAccountChoice[]
  /** The plugins a profile's runs can go without, by name: the distribution's that give runs a skill or a step, in its order. */
  plugins: string[]
}

/** A coding agent's account a profile can name. */
export interface ProfileAccountChoice {
  id: string
  name: string
  /** This computer's own login, and the coding agent is not logged in: no run takes it while another account is there. */
  loggedOut?: true
}

/** Every profile, and what one can name. */
export async function onProfilesList(): Promise<ProfilesView> {
  const [saved, hosts, claude, codex, plugins] = await Promise.all([savedProfiles(), onGitHosts(), onAgentAccounts('claude'), onAgentAccounts('codex'), distributionPlugins()])
  const provider = hosts.hosts.find(row => row.host === GITHUB)?.provider
  return {
    profiles: profilesIn(saved),
    ...(provider ? { github: { host: GITHUB, accounts: provider.accounts.filter(account => account.ok).map(account => account.login) } } : {}),
    claude: claude.accounts.map(accountChoice),
    codex: codex.accounts.map(accountChoice),
    plugins: plugins.flatMap(({ module }) => (module.hooks['run.skills'] || module.hooks['run.step'] ? [module.name] : [])),
  }
}

/** The profiles the person made, and Default once it was changed: what the store keeps. */
async function savedProfiles(): Promise<Profile[]> {
  return (await distributionSettings()).get(PROFILES)
}

function accountChoice(account: AccountRow): ProfileAccountChoice {
  return { id: account.id, name: account.name, ...(account.loggedOut ? { loggedOut: true } : {}) }
}

/** What the page sends to save a profile: a new one has no id yet. */
export interface ProfileChange {
  id?: string
  name: string
  /** Its run options, the ones a profile holds: its accounts, the plugins its runs go without, and which of the project's own skills they get. */
  options: RunOptions
}

/**
 * Save a profile: a new one under the id its name gives, an existing one under its own. The name
 * must give an id, and every account must be one this computer knows; else nothing is written and
 * the reason is said, with `field: 'name'` when it is the name's. Of the options, only the ones a
 * profile holds are kept.
 */
export async function sendSaveProfile(change: ProfileChange): Promise<({ ok: true; id: string } | { ok: false; error: string; field?: 'name' }) & Partial<AccountResult>> {
  if (typeof change !== 'object' || change === null) return { ok: false, error: 'That is no profile.' }
  if (!isProfileName(change.name)) return { ok: false, error: 'A profile needs a name of a few words: letters and digits, at most 40 characters.', field: 'name' }
  const name = change.name.trim()
  const id = change.id === undefined ? profileIdOf(name) : change.id
  if (!isProfileId(id)) return { ok: false, error: 'That is no profile id.' }
  const saved = await savedProfiles()
  const all = profilesIn(saved)
  const taken = change.id === undefined ? all.find(profile => profile.id === id) : undefined
  if (taken) return { ok: false, error: `There is a profile ${taken.name} already: pick another name.`, field: 'name' }
  if (change.id !== undefined && !all.some(profile => profile.id === change.id)) return { ok: false, error: 'That profile is gone: make it again.' }
  if (id === DEFAULT_PROFILE && name !== 'Default') return { ok: false, error: 'Default keeps its name.', field: 'name' }
  const options = await profileOptions(typeof change.options === 'object' && change.options !== null ? change.options : {})
  if (typeof options === 'string') return { ok: false, error: options }
  try {
    await (await distributionSettings()).set(PROFILES, [...saved.filter(profile => profile.id !== id), { id, name, options }])
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  return { ok: true, id }
}

/** The options a profile holds, of the ones `given`, each checked against what this computer knows; why not, when one is not. */
async function profileOptions(given: RunOptions): Promise<RunOptions | string> {
  const view = await onProfilesList()
  const account = given.github?.account
  if (account !== undefined && (typeof account !== 'string' || !view.github?.accounts.includes(account))) return `OpenAgent has no GitHub account ${String(account)} on this computer.`
  const driver: { claude?: string[]; codex?: string[] } = {}
  for (const kind of ['claude', 'codex'] as const) {
    const picked = given['agent-driver']?.[kind]
    if (picked === undefined) continue
    if (!Array.isArray(picked) || picked.some(one => typeof one !== 'string' || !view[kind].some(choice => choice.id === one))) return `That ${kind === 'claude' ? 'Claude' : 'Codex'} account is not on this computer.`
    if (picked.length > 0) driver[kind] = [...new Set(picked)]
  }
  const project = given.skills?.project
  if (project !== undefined && project !== 'none' && !(Array.isArray(project) && project.length > 0 && project.every(isSkillName))) return "A profile's project skills are none, or named by their names."
  const without = given.plugins?.without
  if (without !== undefined && !(Array.isArray(without) && without.every(name => typeof name === 'string' && view.plugins.includes(name)))) return 'That plugin is not one a run gets anything from.'
  return {
    ...(account !== undefined ? { github: { account } } : {}),
    ...(Object.keys(driver).length > 0 ? { 'agent-driver': driver } : {}),
    ...(project !== undefined ? { skills: { project } } : {}),
    ...(without !== undefined && without.length > 0 ? { plugins: { without: [...new Set(without)] } } : {}),
  }
}


/** Remove a profile; Default stays. */
export async function sendRemoveProfile(id: string): Promise<AccountResult> {
  if (!isProfileId(id)) return { ok: false, error: 'That is no profile id.' }
  if (id === DEFAULT_PROFILE) return { ok: false, error: 'Default stays.' }
  try {
    const saved = await savedProfiles()
    if (saved.some(profile => profile.id === id)) await (await distributionSettings()).set(PROFILES, saved.filter(profile => profile.id !== id))
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
