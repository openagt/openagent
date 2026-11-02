import { join } from 'node:path'
import { readFinishedDiary } from './agent-store.js'
import { projectBranches, type BranchesFor, type Checkout } from './branches.js'
import { isRunId, projectRuns, type AnyDiaryLine, type RunsFor } from './runs.js'
import { OPENAGENT_DIR } from '../openagent-dir.js'

/**
 * A run's checkout, as the project's branches provider lists it, or `undefined` when it lists
 * none for the id. The provider's list is shared for a few seconds; a run that is not in it may
 * have started a moment ago, so a miss asks once more, fresh (`branches.ts` bounds how fresh).
 */
export async function findCheckout(projectCwd: string, agentId: string, branches: BranchesFor, opts: { cached?: boolean } = {}): Promise<Checkout | undefined> {
  const source = await branches(projectCwd).catch(() => undefined)
  if (!source) return undefined
  const known = (await source.list().catch(() => [])).find(checkout => checkout.id === agentId)
  if (known || opts.cached) return known
  return (await source.list({ fresh: true }).catch(() => [])).find(checkout => checkout.id === agentId)
}

/**
 * The checkout an agent id resolves to (#738/#797): the agent's own checkout while the project's
 * branches provider lists one for it, else the project root. The list is asked fresh on a miss:
 * a run that just started has its checkout before its tool has written the card (#766), and the
 * event stream resolves its path once, when the browser opens it.
 *
 * An unknown or finished `agentId` falls back to the project root rather than failing: the
 * run's checkout may already be gone, and the project's own state is still the sane thing to
 * act on. This is the one resolution every run-addressed surface shares — the daemon's serve
 * targets and previews, and each dashboard RPC — so the fallback rules cannot drift apart.
 */
export async function resolveAgentCheckout(projectCwd: string, agentId: string | undefined, branches: BranchesFor = projectBranches): Promise<string> {
  if (!agentId || !isRunId(agentId)) return projectCwd
  return (await findCheckout(projectCwd, agentId, branches))?.path ?? projectCwd
}

/**
 * Where a run's diary is, for a reader that follows it: a file while the run has a checkout, the
 * finished run's lines once it has none, or nowhere yet (`pending`): the run was started a moment
 * ago and its tool has not made the checkout, so the reader asks again shortly.
 */
export type AgentDiarySource = { file: string } | { finished: AnyDiaryLine[] } | { pending: true }

/**
 * The diary a run-scoped subscribe should follow (#1472, #1774): the run's own `<id>.jsonl`.
 * While the run has a checkout it is a file there, under the checkout's `.openagent/`,
 * written by the run's tool as the agent works. Once the run is recorded and its checkout
 * reclaimed, it is the finished run's diary, whole, from the project's runs provider. A run that
 * has neither yet was started a moment ago: its tool has not made the checkout, so the diary is
 * nowhere yet, and the tail asks again (`../dashboard-rpc/events-tail.ts`). A project with no
 * runs provider answers the same for a finished run: nowhere, where nothing more comes.
 *
 * `cached` answers from the shared lists only, never asking the checkouts fresh on a miss: for a
 * reader that asks about a finished run for as long as it is open, in case it is resumed.
 *
 * Only the events tails resolve here; every other run-addressed surface keeps
 * {@link resolveAgentCheckout}'s root fallback, where the project's own state is the sane
 * thing to act on.
 */
export async function resolveAgentDiary(
  projectCwd: string,
  agentId: string | undefined,
  runs: RunsFor = projectRuns,
  branches: BranchesFor = projectBranches,
  opts: { cached?: boolean } = {},
): Promise<AgentDiarySource | undefined> {
  if (!agentId || !isRunId(agentId)) return undefined
  const checkout = await findCheckout(projectCwd, agentId, branches, opts)
  if (checkout) return { file: join(checkout.path, OPENAGENT_DIR, `${agentId}.jsonl`) }
  const finished = await readFinishedDiary(projectCwd, agentId, runs)
  return finished ? { finished } : { pending: true }
}
