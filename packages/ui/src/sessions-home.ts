import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { OPENAGENT_DIR } from '@openagt/agent-data'

// The sessions home: where the sessions with no project work, each in a folder of its own
// (`@openagt/agent-data`'s sessions). The daemon keeps it as it keeps a project: its `.openagent/`
// folder. The module whose runs work there sweeps it (`app.lifecycle`).

/** The sessions home made ready for runs, also when it was removed since the daemon started: its `.openagent/` folder. Answers the home. */
export async function readySessionsHome(home: string): Promise<string> {
  await mkdir(join(home, OPENAGENT_DIR), { recursive: true })
  return home
}
