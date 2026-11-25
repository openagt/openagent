import { computerRpcClient, usePolled, type ModuleHost, type ReadState } from '@openagt/ui/module'
import type { ProfileChange, ProfilesRead } from '../src/server.js'

// The module's calls of its own server part (`../src/server.ts`), typed by it, in no project: the
// profiles are the person's on every computer, and the pick is this computer's. Each throws the
// reason a call failed, so a polled read keeps the last answer it had.

export type { Profile, ProfileChange, ProfileResult, ProfileSaved, ProfilesRead, RunOptions } from '../src/server.js'

const server = (host: ModuleHost) => computerRpcClient<typeof import('../src/server.js')>(host)

/** Every profile, Default first, and the one picked for every next run. */
export const readProfiles = (host: ModuleHost) => server(host).profiles({})

/** Save a profile, a new one without an id. */
export const saveProfile = (host: ModuleHost, change: ProfileChange) => server(host).saveProfile(change)

/** Remove a profile; Default stays. */
export const removeProfile = (host: ModuleHost, id: string) => server(host).removeProfile({ id })

/** Pick the profile every next run on this computer is on. */
export const pickProfile = (host: ModuleHost, id: string) => server(host).pickProfile({ id })

/** How often the profiles are read again while something shows them. */
const SELDOM_MS = 30_000

/**
 * The profiles as the dashboard reads them, remembered across pages and loads under one key, so
 * the page, the gear's line and the Overview's line each show the others' read at once and a menu
 * lands whole from the first frame.
 */
export function useProfiles(host: ModuleHost): { read: ProfilesRead | undefined; state: ReadState; failing: boolean; reload: () => Promise<void> } {
  const { value, state, failing, reload } = usePolled<ProfilesRead | undefined>(() => readProfiles(host), undefined, SELDOM_MS, [], { remember: 'profiles:read', stored: true })
  return { read: value, state, failing, reload }
}

/** The page's address word: `/profiles`. */
export const PROFILES_PAGE = 'profiles'
