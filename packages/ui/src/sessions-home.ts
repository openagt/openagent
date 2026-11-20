import { mkdir } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { OPENAGENT_DIR } from '@openagt/agent-data'
import { isPidAlive, sweep } from '@openagt/agent-driver'

// The sessions home: where the sessions with no project work, each in a folder of its own
// (`@openagt/agent-data`'s sessions). The daemon keeps it as it keeps a project: its `.openagent/`
// folder, and the sweep a project's scheduler runs for its own runs, which here no scheduler runs.

/** How often the sessions home is swept for a session whose process died. */
const SWEEP_EVERY_MS = 60_000

/** The sessions home made ready for runs, also when it was removed since the daemon started: its `.openagent/` folder. Answers the home. */
export async function readySessionsHome(home: string): Promise<string> {
  await mkdir(join(home, OPENAGENT_DIR), { recursive: true })
  return home
}

/** Sweep the sessions home now and every minute after, until the answer is called. */
export function startSessionsSweep(home: string, log: (line: string) => void = console.log): () => void {
  let sweeping: Promise<unknown> = Promise.resolve()
  const once = (): void => {
    sweeping = sweeping.then(() => sweep(home, { host: hostname(), isAlive: isPidAlive, log })).catch((err: unknown) => log(`[openagent] the sessions home could not be swept: ${err instanceof Error ? err.message : String(err)}`))
  }
  once()
  const timer = setInterval(once, SWEEP_EVERY_MS)
  timer.unref()
  return () => clearInterval(timer)
}
