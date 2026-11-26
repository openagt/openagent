import { nodeGitRunner } from '@openagt/git-branches'
import { read, type RpcHost } from '@openagt/hooks/rpc'
import type { PersonActivity } from './people.js'
import { newestRuns, peopleAt, records } from './reads.js'
import { publicCard, type RunCard } from '@openagt/agent-driver'

// The logs' server part (`@openagt/hooks/rpc`): what their page and their Overview card read, as
// the command prints it (`reads.ts`). What a caller sends is checked here, whatever its type says:
// it comes from a page.

/** A run as a list shows it: its card, less the writer's own key, with the person it is kept under; `noProject` for a session with no project that had a copy of the project. */
export type ShownRun = Omit<RunCard, 'caller'> & { person: string; noProject?: true }

const DAY = 86_400_000

/** A count a page asks for: a whole number above 0. */
function count(name: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw new Error(`${name} is a whole number above 0`)
  return value
}

/** The project's newest `limit` runs, newest first: what `logs --limit` prints, from origin's copy of the records, fetched. */
export const runs = read(async (host: RpcHost, input: { limit: number }): Promise<ShownRun[]> => {
  const cards = await newestRuns(await records(host.root, false, nodeGitRunner()), count('limit', input.limit))
  return cards.map(({ person, noProject, ...card }) => ({ ...publicCard(card), person, ...(noProject ? { noProject } : {}) }))
})

/** Who works in the project, with what they did in the last `days` days: what `logs people --local` prints, from this machine's copy. */
export const people = read(
  async (host: RpcHost, input: { days: number }): Promise<PersonActivity[]> => peopleAt(host.root, Date.now() - count('days', input.days) * DAY, true, nodeGitRunner()),
)
