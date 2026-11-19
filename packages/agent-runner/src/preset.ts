import { PRESET_ENV, PROJECT_SKILLS_ENV, SKILLS_OFF_ENV, SKILLS_ON_ENV, isSkillName } from '@openagt/agent-data'
import { DEFAULT_PRESET, PRESETS, createHooks, isPresetId, loadHandedDown, presetOf, type Preset, type Settings } from '@openagt/hooks'

/**
 * The preset a run is on (#2394): a name and a saved set of run options, kept with the person (the
 * catalog's `presets.saved`). Whoever starts the run names it in the environment
 * ({@link PRESET_ENV}); a resumed run goes on with the one its record names. None named, or one
 * this computer does not have (a preset made on another computer before the person's folder
 * synced), is Default, said on `log`.
 */

/** The preset named for this run, by its id, read off the environment: none for Default. */
export function presetNamed(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const id = env[PRESET_ENV]?.trim()
  if (!id) return undefined
  if (!isPresetId(id)) throw new Error(`${PRESET_ENV} is no preset id: ${id}`)
  return id === DEFAULT_PRESET ? undefined : id
}

/** The preset `id` names, as `settings` keep it, or Default when it names none, or none of them; a store that cannot be read has only Default. */
export async function runPreset(id: string | undefined, settings: Settings, log: (line: string) => void = () => {}): Promise<Preset> {
  const preset = presetOf(await settings.get(PRESETS).catch((): Preset[] => []), id)
  if (id !== undefined && preset.id !== id) log(`[agent-runner] no preset ${id} on this computer: the run is on Default`)
  return preset
}

/**
 * The settings of the distribution handed down to this process, which the person's presets are
 * read through; with none handed down, none to read, and a run is on Default.
 */
export async function handedDownSettings(env: NodeJS.ProcessEnv = process.env): Promise<Settings> {
  return createHooks((await loadHandedDown(env)) ?? []).settings
}

/** Which of the project's own skills a run gets: every one, none, or the ones named; its preset's when absent. */
export type ProjectSkillsPick = 'all' | 'none' | string[]

/**
 * A session's picks of the skills its run gets, made beside the message box for that run alone
 * and kept on its record: skills on top of the ones every run gets, ones of those left out, and
 * which of the project's own skills stay in its checkout, over its preset's. Named in the
 * environment with the preset ({@link SKILLS_ON_ENV}, {@link SKILLS_OFF_ENV}, {@link PROJECT_SKILLS_ENV}).
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
  const kept = !project ? undefined : project === 'all' || project === 'none' ? project : names(PROJECT_SKILLS_ENV)!
  return { ...(on ? { on } : {}), ...(off ? { off } : {}), ...(kept !== undefined ? { project: kept } : {}) }
}

/** Whether any pick is made. */
export function anySkillPick(picks: SkillPicks): boolean {
  return picks.on !== undefined || picks.off !== undefined || picks.project !== undefined
}
