import { homedir } from 'node:os'
import { spellingOfRemote, type PersonalFolderState } from '@openagt/agent-data'

/** The person's own folder as a page shows it: its path with the home directory as `~`, the repository it syncs with as `host/path`, and that repository's page. */
export interface PersonalFolderShown {
  path: string
  /** The repository it syncs with, as `host/path`, or its address as given when it is not one. */
  remote?: string
  /** The repository's page, for a remote that is on a host. */
  remoteUrl?: string
}

export function personalFolderShown(state: PersonalFolderState, home: string = homedir()): PersonalFolderShown {
  const spelling = state.remote ? spellingOfRemote(state.remote) : undefined
  const path = state.path === home || state.path.startsWith(home + '/') ? '~' + state.path.slice(home.length) : state.path
  return { path, ...(state.remote ? { remote: spelling ?? state.remote } : {}), ...(spelling ? { remoteUrl: `https://${spelling}` } : {}) }
}
