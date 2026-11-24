import { hostname } from 'node:os'
import { errorMessage, sessionsHome } from '@openagt/agent-data'
import type { AppContext } from '@openagt/hooks'
import { isPidAlive } from './run-lock.js'
import { sweep } from './sweep.js'

// The sessions with no project work in the sessions home, each in a folder of its own
// (`@openagt/agent-data`'s sessions). A project's runs are swept by its scheduler; no scheduler runs
// there, so this module sweeps it itself, as its own background work while the app runs.

/** How often the sessions home is swept for a session whose process died. */
const SWEEP_EVERY_MS = 60_000

/** Sweep the sessions home now and every minute after, until the app stops (`app.lifecycle`'s `started`). */
export function sweepSessions(app: Pick<AppContext, 'signal'>, log: (line: string) => void = console.log): void {
  const home = sessionsHome()
  let sweeping: Promise<unknown> = Promise.resolve()
  const once = (): void => {
    sweeping = sweeping.then(() => sweep(home, { host: hostname(), isAlive: isPidAlive, log })).catch((err: unknown) => log(`[openagent] the sessions home could not be swept: ${errorMessage(err)}`))
  }
  once()
  const timer = setInterval(once, SWEEP_EVERY_MS)
  timer.unref()
  app.signal.addEventListener('abort', () => clearInterval(timer), { once: true })
}
