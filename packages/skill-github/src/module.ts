import { defineModule, RunOrder, type ModuleDefinition, type PullRequest, type RunContext } from '@openagt/hooks'
import { homeUrlFor } from './home.js'
import { listRequests } from './requests.js'

/**
 * github, the module (#2394): the pull request a run's branch has, read back once the branch is,
 * into the run's facts (`RunFacts.github`), which the run's record keeps.
 */

/** What the module works with; the real one when absent. */
export interface GithubDeps {
  /** The newest pull request whose head is `branch` in the project at `dir`, open or closed; none when there is none, or GitHub cannot say. */
  requestOfBranch?: (dir: string, branch: string) => Promise<PullRequest | undefined>
}

export function githubModule(deps: GithubDeps = {}): ModuleDefinition {
  const requestOfBranch = deps.requestOfBranch ?? branchRequest
  return defineModule({
    name: 'github',
    hooks: {
      'run.step': [{ order: RunOrder.RECORD - 10, name: 'read the pull request back', run: ctx => readRequest(ctx, requestOfBranch) }],
    },
  })
}

export default githubModule()

/** The newest pull request of a branch on GitHub; none for a project that is not on GitHub. */
async function branchRequest(dir: string, branch: string): Promise<PullRequest | undefined> {
  if ((await homeUrlFor(dir).catch(() => undefined)) === undefined) return undefined
  const [newest] = await listRequests(dir, { branch })
  return newest ? { number: newest.number, url: newest.url } : undefined
}

/**
 * The pull request the agent opened, if any, read back off the branch the run's work is on; a
 * run with no branch has none. The run's request and the ones it opened before: a request other
 * than the run's puts that one among the earlier ones, each once, and never the run's own, so work
 * moved back to a branch takes its request back. The earlier ones are said whenever the run has
 * had any, so a list emptied by the work moving back is said too.
 */
async function readRequest(ctx: RunContext, requestOfBranch: NonNullable<GithubDeps['requestOfBranch']>): Promise<void> {
  const branch = ctx.facts['git-branches']?.branch
  if (branch === undefined || !ctx.project) return
  const before = ctx.facts.github ?? {}
  const pr = await requestOfBranch(ctx.project.dir, branch).catch(() => undefined)
  let named = before.pr
  let earlier = before.earlierPrs ?? []
  if (pr && named && pr.url !== named.url) earlier = [...earlier, { number: named.number, url: named.url }]
  if (pr) named = pr
  earlier = earlier.filter((one, at) => one.url !== named?.url && earlier.findIndex(other => other.url === one.url) === at)
  ctx.facts.github = { ...(named ? { pr: named } : {}), ...(before.earlierPrs !== undefined || earlier.length > 0 ? { earlierPrs: earlier } : {}) }
}
