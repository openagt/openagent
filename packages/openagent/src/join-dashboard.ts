import type { StartedInResult } from './dashboard/types.js'

/**
 * A second `openagent` on a port a dashboard already listens on (#2141): it asks that port whether
 * it is OpenAgent's, and if it is, hands it the folder it was started in. Binding first and asking
 * only on `EADDRINUSE` leaves the common start as it was, with no race between a look and a bind.
 *
 * The call is a plain RPC: with no `Origin` and a loopback `Host`, the dashboard's guards let it
 * by, as they let any program on this computer call `sendAddProject`.
 */

/** What the port answered: OpenAgent's dashboard, its version and the folder's project; or something else. */
export type JoinedDashboard =
  | { joined: true; url: string; version: string; project?: StartedInResult }
  | { joined: false }

/** Hand `folder` (undefined outside a repository) to the dashboard on `port` of this computer. */
export async function joinRunningDashboard(port: number, folder: string | undefined): Promise<JoinedDashboard> {
  const url = `http://127.0.0.1:${port}`
  try {
    const res = await fetch(`${url}/_rpc/sendStartedAgain`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([folder ?? null]),
    })
    if (!res.ok) return { joined: false }
    const { ret } = (await res.json()) as { ret?: { version?: unknown; project?: StartedInResult } }
    if (typeof ret?.version !== 'string') return { joined: false }
    return { joined: true, url, version: ret.version, ...(ret.project ? { project: ret.project } : {}) }
  } catch {
    // Refused, or not JSON: no OpenAgent dashboard answers there.
    return { joined: false }
  }
}
