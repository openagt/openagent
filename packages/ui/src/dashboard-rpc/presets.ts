import { isSkillName } from '@openagt/agent-data'
import { DEFAULT_PRESET, PRESETS, isPresetId, isPresetName, presetIdOf, presetsIn, type Preset, type RunOptions } from '@openagt/hooks'
import { distributionSettings } from '../distribution-hooks.js'
import { distributionPlugins } from '../distribution-packages.js'
import { onAgentAccounts, type AccountResult, type AccountRow } from './accounts.js'
import { onGitHosts } from './logins.js'
import { presetLoginsOn, syncLogins, type PresetLoginsOn } from '../dashboard/logins-sync.js'

export type { Preset, RunOptions } from '@openagt/hooks'
export type { PresetLoginsOn } from '../dashboard/logins-sync.js'

// The Presets page (#2394): a preset is a name and a saved set of run options, made once and used
// in any project or none, kept with the person through the store (the catalog's `presets.saved`),
// so every computer of theirs has the same presets. The page lists them, edits them in a dialog,
// makes new ones and removes them; Default is edited like the others and never removed or
// renamed. What a preset can name is what this computer knows: OpenAgent's own GitHub accounts
// here, the Claude and Codex accounts of the Permissions page, and the distribution's plugins its
// runs go without.

/** The host the GitHub skill answers for, whose accounts a preset names. */
const GITHUB = 'github.com'

export interface PresetsView {
  /** Every preset, Default first. */
  presets: Preset[]
  /** OpenAgent's GitHub accounts on this computer, and the host one more is added at. */
  github?: { host: string; accounts: string[] }
  /** The Claude accounts of the Permissions page, by id and name; this computer's own login says when it is logged out. */
  claude: PresetAccountChoice[]
  /** The Codex accounts, the same way. */
  codex: PresetAccountChoice[]
  /** The plugins a preset's runs can go without, by name: the distribution's that give runs a skill or a step, in its order. */
  plugins: string[]
}

/** A coding agent's account a preset can name. */
export interface PresetAccountChoice {
  id: string
  name: string
  /** This computer's own login, and the coding agent is not logged in: no run takes it while another account is there. */
  loggedOut?: true
}

/** Every preset, and what one can name. */
export async function onPresetsList(): Promise<PresetsView> {
  const [saved, hosts, claude, codex, plugins] = await Promise.all([savedPresets(), onGitHosts(), onAgentAccounts('claude'), onAgentAccounts('codex'), distributionPlugins()])
  const provider = hosts.hosts.find(row => row.host === GITHUB)?.provider
  return {
    presets: presetsIn(saved),
    ...(provider ? { github: { host: GITHUB, accounts: provider.accounts.filter(account => account.ok).map(account => account.login) } } : {}),
    claude: claude.accounts.map(accountChoice),
    codex: codex.accounts.map(accountChoice),
    plugins: plugins.flatMap(({ module }) => (module.hooks['run.skills'] || module.hooks['run.step'] ? [module.name] : [])),
  }
}

/** The presets the person made, and Default once it was changed: what the store keeps. */
async function savedPresets(): Promise<Preset[]> {
  return (await distributionSettings()).get(PRESETS)
}

function accountChoice(account: AccountRow): PresetAccountChoice {
  return { id: account.id, name: account.name, ...(account.loggedOut ? { loggedOut: true } : {}) }
}

/** What the page sends to save a preset: a new one has no id yet. */
export interface PresetChange {
  id?: string
  name: string
  /** Its run options, the ones a preset holds: its accounts, the plugins its runs go without, and which of the project's own skills they get. */
  options: RunOptions
}

/**
 * Save a preset: a new one under the id its name gives, an existing one under its own. The name
 * must give an id, and every account must be one this computer knows; else nothing is written and
 * the reason is said, with `field: 'name'` when it is the name's. Of the options, only the ones a
 * preset holds are kept.
 */
export async function sendSavePreset(change: PresetChange): Promise<({ ok: true; id: string } | { ok: false; error: string; field?: 'name' }) & Partial<AccountResult>> {
  if (typeof change !== 'object' || change === null) return { ok: false, error: 'That is no preset.' }
  if (!isPresetName(change.name)) return { ok: false, error: 'A preset needs a name of a few words: letters and digits, at most 40 characters.', field: 'name' }
  const name = change.name.trim()
  const id = change.id === undefined ? presetIdOf(name) : change.id
  if (!isPresetId(id)) return { ok: false, error: 'That is no preset id.' }
  const saved = await savedPresets()
  const all = presetsIn(saved)
  const taken = change.id === undefined ? all.find(preset => preset.id === id) : undefined
  if (taken) return { ok: false, error: `There is a preset ${taken.name} already: pick another name.`, field: 'name' }
  if (change.id !== undefined && !all.some(preset => preset.id === change.id)) return { ok: false, error: 'That preset is gone: make it again.' }
  if (id === DEFAULT_PRESET && name !== 'Default') return { ok: false, error: 'Default keeps its name.', field: 'name' }
  const options = await presetOptions(typeof change.options === 'object' && change.options !== null ? change.options : {})
  if (typeof options === 'string') return { ok: false, error: options }
  try {
    await (await distributionSettings()).set(PRESETS, [...saved.filter(preset => preset.id !== id), { id, name, options }])
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  // Its GitHub account goes to every device of the person's now, not a minute from now; the page follows it.
  if (options.github?.account !== undefined && process.env['OPENAGENT_SERVER'] !== '1') void syncLogins().catch(() => [])
  return { ok: true, id }
}

/** The options a preset holds, of the ones `given`, each checked against what this computer knows; why not, when one is not. */
async function presetOptions(given: RunOptions): Promise<RunOptions | string> {
  const view = await onPresetsList()
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
  if (project !== undefined && project !== 'none' && !(Array.isArray(project) && project.length > 0 && project.every(isSkillName))) return "A preset's project skills are none, or named by their names."
  const without = given.plugins?.without
  if (without !== undefined && !(Array.isArray(without) && without.every(name => typeof name === 'string' && view.plugins.includes(name)))) return 'That plugin is not one a run gets anything from.'
  return {
    ...(account !== undefined ? { github: { account } } : {}),
    ...(Object.keys(driver).length > 0 ? { 'agent-driver': driver } : {}),
    ...(project !== undefined ? { skills: { project } } : {}),
    ...(without !== undefined && without.length > 0 ? { plugins: { without: [...new Set(without)] } } : {}),
  }
}

/** How the presets' GitHub accounts stand on each device of the person's. A server copies to no device: none. */
export async function onPresetLogins(): Promise<PresetLoginsOn[]> {
  if (process.env['OPENAGENT_SERVER'] === '1') return []
  return presetLoginsOn()
}

/** Copy the presets' GitHub accounts to every device again, now: the press for one that failed. */
export async function sendCopyPresetLogins(): Promise<AccountResult> {
  if (process.env['OPENAGENT_SERVER'] === '1') return { ok: false, error: 'A server copies logins to no device.' }
  await syncLogins()
  return { ok: true }
}

/** Remove a preset; Default stays. */
export async function sendRemovePreset(id: string): Promise<AccountResult> {
  if (!isPresetId(id)) return { ok: false, error: 'That is no preset id.' }
  if (id === DEFAULT_PRESET) return { ok: false, error: 'Default stays.' }
  try {
    const saved = await savedPresets()
    if (saved.some(preset => preset.id === id)) await (await distributionSettings()).set(PRESETS, saved.filter(preset => preset.id !== id))
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
