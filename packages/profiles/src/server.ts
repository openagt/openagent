import { DEFAULT_PROFILE, MODULE_NAME, PICKED_PROFILE, PROFILES, isProfileId, isProfileName, profileIdOf, profileOf, profilesIn, type Profile, type RunOptions } from '@openagt/hooks'
import { act, read, type RpcComputerHost } from '@openagt/hooks/rpc'

// profiles' server part (#2394): a profile is a name and a saved set of run options, made once and
// used in any project or none, kept with the person through the store (the catalog's
// `profiles.saved`), so every computer of theirs has the same profiles. The Profiles page lists
// them, edits them, makes new ones and removes them; Default is edited like the others and never
// removed or renamed. What a profile's options hold is each module's own, written by its control
// in the profile's editor and read back strictly by the setting. The profile picked under the
// message box is the one every next run started on this computer is on (`profiles.picked`).

export type { Profile, RunOptions } from '@openagt/hooks'

/** Every profile, and the one every next run on this computer is on. */
export interface ProfilesRead {
  /** Every profile, Default first. */
  profiles: Profile[]
  /** The profile picked for every next run, by its id: Default's when none is, or the one picked is gone. */
  picked: string
}

/** What a page sends to save a profile: a new one has no id yet. */
export interface ProfileChange {
  id?: string
  name: string
  /** Its run options, a slice per module, as the modules' controls in its editor wrote them. */
  options: RunOptions
}

/** What saving a profile answered: done, with its id, or why not, with `field: 'name'` when it is the name's. */
export type ProfileSaved = { ok: true; id: string } | { ok: false; error: string; field?: 'name' }

/** What another change of the profiles answered: done, or why not. */
export type ProfileResult = { ok: true } | { ok: false; error: string }

/** Every profile, Default first, and the one picked for every next run. */
export const profiles = read(async (host: RpcComputerHost, _input: object): Promise<ProfilesRead> => {
  const [saved, picked] = await Promise.all([host.settings.get(PROFILES), host.settings.get(PICKED_PROFILE)])
  return { profiles: profilesIn(saved), picked: profileOf(saved, picked).id }
})

/**
 * Save a profile: a new one under the id its name gives, an existing one under its own. The name
 * must give an id no other profile has; else nothing is written and the reason is said. Of the
 * options, each module's slice is kept, and never a profile of their own.
 */
export const saveProfile = act(async (host: RpcComputerHost, change: ProfileChange): Promise<ProfileSaved> => {
  if (typeof change !== 'object' || change === null) return { ok: false, error: 'That is no profile.' }
  if (!isProfileName(change.name)) return { ok: false, error: 'A profile needs a name of a few words: letters and digits, at most 40 characters.', field: 'name' }
  const name = change.name.trim()
  const id = change.id === undefined ? profileIdOf(name) : change.id
  if (!isProfileId(id)) return { ok: false, error: 'That is no profile id.' }
  const saved = await host.settings.get(PROFILES)
  const all = profilesIn(saved)
  const taken = change.id === undefined ? all.find(profile => profile.id === id) : undefined
  if (taken) return { ok: false, error: `There is a profile ${taken.name} already: pick another name.`, field: 'name' }
  if (change.id !== undefined && !all.some(profile => profile.id === change.id)) return { ok: false, error: 'That profile is gone: make it again.' }
  if (id === DEFAULT_PROFILE && name !== 'Default') return { ok: false, error: 'Default keeps its name.', field: 'name' }
  await host.settings.set(PROFILES, [...saved.filter(profile => profile.id !== id), { id, name, options: slicesOf(change.options) }])
  return { ok: true, id }
})

/** Of `given`, the modules' slices a profile holds: each an object under a module's name, and no profile. */
function slicesOf(given: unknown): RunOptions {
  if (typeof given !== 'object' || given === null || Array.isArray(given)) return {}
  return Object.fromEntries(Object.entries(given).filter(([key, slice]) => key !== 'profiles' && MODULE_NAME.test(key) && typeof slice === 'object' && slice !== null && !Array.isArray(slice))) as RunOptions
}

/** Remove a profile; Default stays. Every next run picked on it is on Default from then on. */
export const removeProfile = act(async (host: RpcComputerHost, { id }: { id: string }): Promise<ProfileResult> => {
  if (!isProfileId(id)) return { ok: false, error: 'That is no profile id.' }
  if (id === DEFAULT_PROFILE) return { ok: false, error: 'Default stays.' }
  const saved = await host.settings.get(PROFILES)
  if (saved.some(profile => profile.id === id)) await host.settings.set(PROFILES, saved.filter(profile => profile.id !== id))
  return { ok: true }
})

/** Pick the profile every next run started on this computer is on, by its id: Default's picks none. */
export const pickProfile = act(async (host: RpcComputerHost, { id }: { id: string }): Promise<ProfileResult> => {
  if (!isProfileId(id)) return { ok: false, error: 'That is no profile id.' }
  if (id !== DEFAULT_PROFILE && !(await host.settings.get(PROFILES)).some(profile => profile.id === id)) return { ok: false, error: 'That profile is gone.' }
  await host.settings.set(PICKED_PROFILE, id === DEFAULT_PROFILE ? undefined : id)
  return { ok: true }
})
