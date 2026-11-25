import type { PullRequestRead, PullRequestState } from '@openagt/hooks'

// How pull requests stand, as the modules last read them at their git host (`pullRequestsRead`):
// what the lists of runs mark each run's requests by, and what tells a branch with an open request
// from one waiting on a push. This daemon's memory alone: a request no module has read since it
// started has no state, and its run's row marks none until one does.

const known = new Map<string, PullRequestRead>()
const listeners = new Set<() => void>()

/** What a module read of pull requests: kept, and the lists told when one is read for the first time, or stands otherwise than before. */
export function pullRequestsRead(prs: readonly PullRequestRead[]): void {
  let moved = false
  for (const pr of prs) {
    if (typeof pr?.url !== 'string') continue
    const before = known.get(pr.url)
    if (before?.state !== pr.state) moved = true
    known.set(pr.url, pr)
  }
  if (moved) for (const listener of [...listeners]) listener()
}

/** How the request at `url` stands, as a module last read it; none for one not read. */
export function pullRequestState(url: string): { state: PullRequestState; title?: string } | undefined {
  const pr = known.get(url)
  return pr && { state: pr.state, ...(pr.title !== undefined ? { title: pr.title } : {}) }
}

/** No request read yet, as when the daemon starts: for a test, which reads its own. */
export function forgetPullRequestStates(): void {
  known.clear()
}

/** The branches an open request is from, as the modules last read them. */
export function requestedBranches(): Set<string> {
  return new Set([...known.values()].flatMap(pr => (pr.branch !== undefined && (pr.state === 'open' || pr.state === 'draft') ? [pr.branch] : [])))
}

/** Call `listener` each time a request is read for the first time or standing otherwise than before (merged, closed, out of draft), until the answer is called. */
export function onPrMoved(listener: () => void): () => void {
  const own = (): void => listener()
  listeners.add(own)
  return () => void listeners.delete(own)
}

