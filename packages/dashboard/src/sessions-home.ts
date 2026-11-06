import { mkdir, rm, stat } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { OPENAGENT_DIR } from '@openagt/agent-data'
import { DASHBOARD_HOOKS, isPidAlive, resumeDetached, sweep } from '@openagt/agent-runner'
import { writeHookLines } from './built-in.js'

// The sessions home: where the sessions with no project work, each in a folder of its own
// (`@openagt/agent-data`'s sessions). The daemon keeps it as it keeps a project: the hook lines a
// run is started, resumed and checked by, and the sweep a project's scheduler runs for its own
// runs, which here no scheduler runs.

/** How often the sessions home is swept for a session whose process died. */
const SWEEP_EVERY_MS = 60_000

/**
 * The sessions home made ready for runs: its `.openagent/` folder, and the hook lines every
 * package that writes them writes there, as into a project that is added. The lines are
 * OpenAgent's own, not a person's: written fresh, so they are always this version's. Answers the home.
 */
export async function prepareSessionsHome(home: string, log: (line: string) => void = console.log): Promise<string> {
  await mkdir(join(home, OPENAGENT_DIR), { recursive: true })
  await rm(join(home, DASHBOARD_HOOKS), { force: true })
  for (const failed of await writeHookLines(home)) log(`[openagent] hook lines (${home}): ${failed}`)
  return home
}

/** The sessions home, prepared first when its hook lines are not there: removed since the daemon started, say. */
export async function readySessionsHome(home: string): Promise<string> {
  const there = await stat(join(home, DASHBOARD_HOOKS)).then(() => true, () => false)
  return there ? home : prepareSessionsHome(home)
}

/** Sweep the sessions home now and every minute after, until the answer is called. */
export function startSessionsSweep(home: string, log: (line: string) => void = console.log): () => void {
  let sweeping: Promise<unknown> = Promise.resolve()
  const once = (): void => {
    sweeping = sweeping.then(() => sweep(home, { host: hostname(), isAlive: isPidAlive, resume: resumeDetached(home), log })).catch((err: unknown) => log(`[openagent] the sessions home could not be swept: ${err instanceof Error ? err.message : String(err)}`))
  }
  once()
  const timer = setInterval(once, SWEEP_EVERY_MS)
  timer.unref()
  return () => clearInterval(timer)
}
