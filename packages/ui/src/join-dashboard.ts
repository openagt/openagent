import type { StartedInResult } from './dashboard/types.js'
import { readSecureAddress } from './secure-address.js'

/**
 * A second `openagent` on a port a dashboard already listens on (#2141): it asks that port whether
 * it is OpenAgent's, and if it is, hands it the folder it was started in. Binding first and asking
 * only on `EADDRINUSE` leaves the common start as it was, with no race between a look and a bind.
 *
 * The call is a plain RPC: with no `Origin` and a loopback `Host`, the dashboard's guards let it
 * by, as they let any program on this computer call `sendAddProject`.
 */

/**
 * What the port answered: OpenAgent's dashboard, the URL to open it at, its version and the
 * folder's project; or something else. The URL is the secure address's when this computer has
 * one (#1919), since every dashboard started here answers it.
 */
export type JoinedDashboard =
  | { joined: true; url: string; version: string; project?: StartedInResult }
  | { joined: false }

/** Hand `folder` (undefined outside a repository) to the dashboard on `port` of this computer. */
export async function joinRunningDashboard(port: number, folder: string | undefined, env: NodeJS.ProcessEnv = process.env): Promise<JoinedDashboard> {
  const url = `http://127.0.0.1:${port}`
  // Asked first with no folder, which a dashboard answers at once, so a program that holds the port
  // and never answers is given up on; adding a folder runs its open hooks, however long they take.
  const running = await startedAgain(url, null, AbortSignal.timeout(3000))
  const answer = running && folder !== undefined ? await startedAgain(url, folder) : running
  if (!answer) return { joined: false }
  const secure = await readSecureAddress(env).catch(() => undefined)
  return { joined: true, url: secure ? `https://${secure.name}` : url, version: answer.version, ...(answer.project ? { project: answer.project } : {}) }
}

/** What the dashboard at `url` answers when handed `folder`; undefined when no OpenAgent dashboard answers there. */
async function startedAgain(url: string, folder: string | null, signal?: AbortSignal): Promise<{ version: string; project?: StartedInResult } | undefined> {
  try {
    const res = await fetch(`${url}/_rpc/sendStartedAgain`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([folder]),
      signal: signal ?? null,
    })
    if (!res.ok) return undefined
    const { ret } = (await res.json()) as { ret?: { version?: unknown; project?: StartedInResult } }
    if (typeof ret?.version !== 'string') return undefined
    return { version: ret.version, ...(ret.project ? { project: ret.project } : {}) }
  } catch {
    // Refused, silent, or not JSON: no OpenAgent dashboard answers there.
    return undefined
  }
}
