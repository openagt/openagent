import { DiffStat, Facts, useModuleHost, type UiRunProps } from '@openagt/ui/module'
import { useHandoff, type Handoff } from './calls.js'

// What an ended session left on its branch, in a few words, in the bar above its message box
// (`chat.summary`) beside the branch they are about (#799, #1023): the next step is offered beside
// it (`chat.handoff`), and the commits and the files themselves are a pane away. The read is
// branch-addressed, so it survives the checkout: a clean run's checkout is removed when it ends.

/** The summary of the run's own branch, once the run has ended. */
export function RunSummary({ projectId, agentId, working }: UiRunProps) {
  const host = useModuleHost()
  const { handoff } = useHandoff(host, { projectId, agentId }, !working)
  return working ? null : <HandoffSummary handoff={handoff} />
}

/** The one-line verdict: what the session left behind, or that it left nothing. */
export function HandoffSummary({ handoff }: { handoff: Handoff | null }) {
  if (!handoff) return null
  // A landed run's branch is gone on purpose; what it held is read by its last commit, and when
  // this machine does not have that commit there is nothing to count: landed is said beside it.
  if (!handoff.exists && handoff.landed) return null
  // A branch that is gone and a branch that was never pushed are different facts, and the summary
  // is only useful if it tells them apart. Gone because the run changed nothing is no changes.
  if (!handoff.exists) return <span className="text-muted-foreground">{handoff.unchanged ? 'no changes' : 'branch gone'}</span>
  const commits = `${handoff.commits.length} commit${handoff.commits.length === 1 ? '' : 's'}`
  // Commits that undo each other leave the files as the base has them. The commits are still what
  // the agent did, so they are counted, and that nothing is left of them is said beside the count.
  if (handoff.empty && handoff.commits.length > 0) return <Facts facts={[commits, 'no change left']} className="text-muted-foreground" />
  // Nothing committed and files left on disk: neither "merged" nor "no changes" is true of that,
  // and the words beside the Commit press name the files. So the verdict says nothing.
  if (handoff.empty && handoff.pendingFiles?.length) return null
  // A merged branch whose record names no start reads as empty too, its commits all on the base;
  // "merged" and "no changes" are opposite verdicts, and only one of them is true.
  if (handoff.empty) return <span className="text-muted-foreground">{handoff.merged ? 'merged' : 'no changes'}</span>
  const files = `${handoff.files.length} file${handoff.files.length === 1 ? '' : 's'}`
  // What the branch holds, as Claude Code says it: the `+N −N` pair alone. The counts behind it are
  // the same work in more words, so they are its hover.
  const held = [commits, files, ...(handoff.pushed ? ['pushed'] : [])].join(' · ')
  return (
    <span className="flex shrink-0 items-center whitespace-nowrap" title={held} aria-label={held}>
      <DiffStat added={handoff.insertions} removed={handoff.deletions} className="text-xs font-medium" />
    </span>
  )
}
