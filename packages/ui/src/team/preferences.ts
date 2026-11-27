import { dirname, join } from 'node:path'
import { registryPath, registryPreferencesStore, type PreferencesStore, type RegistryFs } from '../registry.js'
import { currentCaller } from './caller.js'

// The dashboard's preferences (how it looks, the box's picks, the Overview's cards) on a machine
// shared by a team: each person's own. The owner's are the machine's, the file they had before
// Team mode; everyone else's are a file of their own beside it, by their GitHub username, which
// starts empty: OpenAgent's defaults, not the owner's look.

/** Where a teammate's preferences are: `openagent-people/<login>/openagent.json`, beside the registry. */
export function personPreferencesEnv(env: NodeJS.ProcessEnv, login: string): NodeJS.ProcessEnv {
  return { XDG_CONFIG_HOME: join(dirname(registryPath(env)), 'openagent-people', login.toLowerCase()) }
}

/** The preferences of whoever the request is for: the machine's for its owner, and with no team. */
export function teamPreferencesStore(env: NodeJS.ProcessEnv = process.env, fs?: RegistryFs): PreferencesStore {
  const machine = registryPreferencesStore(env, ...(fs ? [fs] : []))
  const theirs = (): PreferencesStore => {
    const caller = currentCaller()
    return caller && !caller.owner ? registryPreferencesStore(personPreferencesEnv(env, caller.login), ...(fs ? [fs] : [])) : machine
  }
  return {
    read: () => theirs().read(),
    save: preferences => theirs().save(preferences),
    patch: patch => theirs().patch(patch),
  }
}
