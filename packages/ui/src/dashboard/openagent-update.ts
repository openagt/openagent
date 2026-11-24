import { compareVersions, nodeVersionFetcher, updateCommand, type VersionFetcher } from '../cli/update-check.js'
import { openagentPackage, type OpenAgentPackage } from '../version.js'

// Whether OpenAgent itself is behind: the version running against npm's `latest`, with the command
// that updates the copy that runs, which a person types. The Overview says it under the card of
// what needs the person, beside the modules' notices.

/** How long a reading is kept: a new version comes out every few days, and each reading asks npm. */
export const KEEP_MS = 12 * 60 * 60_000

/** A newer OpenAgent than the one running here: the two versions, and the command that updates this copy. */
export interface OpenAgentUpdate {
  installed: string
  latest: string
  command: string
}

export interface OpenAgentUpdates {
  /** A newer OpenAgent, when one is out; none when it is not, or npm does not answer. */
  read(): Promise<OpenAgentUpdate | undefined>
}

export interface OpenAgentUpdatesOptions {
  /** The version npm's `latest` names for a package; none when it does not answer. */
  latest?: VersionFetcher
  now?: () => number
  /** OpenAgent's package as it runs here ({@link openagentPackage}); none when it runs with no distribution, which has nothing to update. */
  openagent?: OpenAgentPackage
}

export function openAgentUpdates(opts: OpenAgentUpdatesOptions = {}): OpenAgentUpdates {
  const latest = opts.latest ?? nodeVersionFetcher()
  const now = opts.now ?? Date.now
  let kept: { at: number; reading: Promise<OpenAgentUpdate | undefined> } | undefined
  return {
    read() {
      const own = opts.openagent ?? openagentPackage()
      if (!own) return Promise.resolve(undefined)
      if (!kept || now() - kept.at >= KEEP_MS) {
        const installed = own.version
        kept = {
          at: now(),
          reading: latest(own.name).then(
            newest => (newest !== undefined && compareVersions(newest, installed) > 0 ? { installed, latest: newest, command: updateCommand(own) } : undefined),
            () => undefined,
          ),
        }
      }
      return kept.reading
    },
  }
}
