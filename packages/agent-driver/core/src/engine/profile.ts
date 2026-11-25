import { PLUGINS_WITHOUT_ENV, PROFILE_ENV, PROJECT_SKILLS_ENV, isSkillName } from './names.js'
import { DEFAULT_PROFILE, MODULE_NAME, PROFILES, createHooks, isProfileId, loadHandedDown, profileOf, type Profile, type Settings, type SkillsOptions } from '@openagt/hooks'

/**
 * The profile a run is on (#2394): a name and a saved set of run options, kept with the person (the
 * catalog's `profiles.saved`). Whoever starts the run names it in the environment
 * ({@link PROFILE_ENV}); a resumed run goes on with the one its record names. None named, or one
 * this computer does not have (a profile made on another computer before the person's folder
 * synced), is Default, said on `log`.
 */

/** The profile named for this run, by its id, read off the environment: none for Default. */
export function profileNamed(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const id = env[PROFILE_ENV]?.trim()
  if (!id) return undefined
  if (!isProfileId(id)) throw new Error(`${PROFILE_ENV} is no profile id: ${id}`)
  return id === DEFAULT_PROFILE ? undefined : id
}

/** The profile `id` names, as `settings` keep it, or Default when it names none, or none of them; a store that cannot be read has only Default. */
export async function runProfile(id: string | undefined, settings: Settings, log: (line: string) => void = () => {}): Promise<Profile> {
  const profile = profileOf(await settings.get(PROFILES).catch((): Profile[] => []), id)
  if (id !== undefined && profile.id !== id) log(`[agent-runner] no profile ${id} on this computer: the run is on Default`)
  return profile
}

/**
 * The settings of the distribution handed down to this process, which the person's profiles are
 * read through; with none handed down, none to read, and a run is on Default.
 */
export async function handedDownSettings(env: NodeJS.ProcessEnv = process.env): Promise<Settings> {
  return createHooks((await loadHandedDown(env)) ?? []).settings
}

/** Which of the project's own skills a run gets: every one, none, or the ones named; its profile's when absent. */
export type ProjectSkillsPick = NonNullable<SkillsOptions['project']>

/**
 * A session's picks for its run, made beside the message box for that run alone and kept on its
 * record, over its profile's: the enabled plugins it goes without, so it gets none of their skills
 * nor their steps, and which of the project's own skills stay in its checkout. Named in the
 * environment with the profile ({@link PLUGINS_WITHOUT_ENV}, {@link PROJECT_SKILLS_ENV}).
 */
export interface SessionPicks {
  /** The plugins the run goes without, by name: none of them for an empty list. */
  without?: string[]
  project?: ProjectSkillsPick
}

/**
 * The picks named for this run in the environment; none where nothing is set. The plugins'
 * variable set to nothing is a pick too: the run goes without none of them, whatever its profile
 * leaves out. A word that is no plugin's or skill's name refuses.
 */
export function sessionPicksNamed(env: NodeJS.ProcessEnv = process.env): SessionPicks {
  const names = (variable: string, isName: (name: string) => boolean, what: string): string[] => {
    const list = (env[variable] ?? '').split(',').map(name => name.trim()).filter(Boolean)
    const odd = list.find(name => !isName(name))
    if (odd !== undefined) throw new Error(`${variable} is no list of ${what} names: ${odd}`)
    return [...new Set(list)]
  }
  const without = env[PLUGINS_WITHOUT_ENV] !== undefined ? names(PLUGINS_WITHOUT_ENV, name => MODULE_NAME.test(name), 'plugin') : undefined
  const project = env[PROJECT_SKILLS_ENV]?.trim()
  const kept = !project ? undefined : project === 'all' || project === 'none' ? project : names(PROJECT_SKILLS_ENV, isSkillName, 'skill')
  return { ...(without ? { without } : {}), ...(kept !== undefined ? { project: kept } : {}) }
}

/** Whether any pick is made. */
export function anyPick(picks: SessionPicks): boolean {
  return picks.without !== undefined || picks.project !== undefined
}
