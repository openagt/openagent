import type { ComponentType } from 'react'
import { GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft } from 'lucide-react'
import type { AgentMeta } from '../../src/index.js'

/** How a run's pull request stands, as the git host last said. */
export type PrState = NonNullable<AgentMeta['prState']>

/**
 * A run's pull request, one glyph per state in the git host's own colours, wherever the run's
 * request is marked (its row in the sidebar, the row under its message box), so a list of runs
 * says which have work waiting for review and which landed without opening one. Each state has its
 * own shape too, for a reader who cannot tell the colours apart. A request whose state is not
 * known, older than the git host lists or not read yet, has no mark: a plain one read as one more
 * state. Its number is still said.
 */
export const PR_MARKS: Record<PrState, { Icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>; tone: string; word: string }> = {
  open: { Icon: GitPullRequest, tone: 'text-success', word: 'open' },
  draft: { Icon: GitPullRequestDraft, tone: 'text-muted-foreground', word: 'draft' },
  merged: { Icon: GitMerge, tone: 'text-merged', word: 'merged' },
  closed: { Icon: GitPullRequestClosed, tone: 'text-danger', word: 'closed' },
}

/** A request's state as the git host spells it (`OPEN`, `MERGED`, `CLOSED`), as a mark's; none for one not known. */
export function prStateOf(hostState: string): PrState | undefined {
  const state = hostState.toLowerCase()
  return state === 'open' || state === 'merged' || state === 'closed' ? state : undefined
}
