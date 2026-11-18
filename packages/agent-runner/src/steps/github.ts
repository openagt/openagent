import { RunOrder, type RunStep } from '@openagt/hooks'
import type { Leg } from '../leg.js'
import { earlierPrs } from '../records.js'

/** github's step: the pull request the run's branch has, read back once the branch is. */
export function githubSteps(leg: Leg): RunStep[] {
  return [{ order: RunOrder.RECORD - 10, name: 'read the pull request back', run: () => readRequest(leg) }]
}

/**
 * The pull request the agent opened, if any, read back off its branch through the project's git
 * host; a run with no branch has none. The request the card names, and the ones the run opened
 * before it: a request other than the one named puts that one among the earlier ones, each once,
 * and never the one the card names, so work moved back to a branch takes its request back. The
 * earlier ones are said whenever the run has had any, so a list emptied by the work moving back is
 * said too.
 */
async function readRequest(leg: Leg): Promise<void> {
  const { worked, card } = leg
  if (worked.branch === undefined) return
  const pr = await leg.here.gitHost.requestOfBranch(leg.repo, worked.branch).catch(() => undefined)
  let named = card.pr
  let earlier = earlierPrs(card)
  const said = earlier.length > 0
  if (pr && named && pr.url !== named.url) earlier = [...earlier, { number: named.number, url: named.url }]
  if (pr) named = pr
  earlier = earlier.filter((one, at) => one.url !== named?.url && earlier.findIndex(other => other.url === one.url) === at)
  if (pr) worked.pr = pr
  if (said || earlier.length > 0) worked.earlierPrs = earlier
}
