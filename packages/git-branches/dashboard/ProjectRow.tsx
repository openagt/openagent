import { useMemo, useRef } from 'react'
import { HandoffOffers, ViewsAt, WorkRow, useModuleHost, type UiWorkProps } from '@openagt/ui/module'
import { handoffSays, useHandoff, useWorktree } from './calls.js'
import { Committing } from './Committing.js'
import { HandoffSummary } from './HandoffSummary.js'

// The project's row in the panel of a session's work above its message box (`chat.work`, before
// the copies' rows): the run's branch, what it holds, its pull request and the next step.
//
// While the run works the row is read off its checkout (its branch, clean or dirty), and says
// what the modules' summaries say (`chat.summary`: the Changes pane's count) and "Committing…"
// while the agent does what the Commit press asked. Once the run has ended its branch is read
// (#799, #1023): what the branch holds, and its next steps (`chat.handoff`). The branch read is
// branch-addressed, so it survives the checkout: a clean run's checkout is removed when it ends.

/**
 * The project's row, while there is something to say: a pull request, in whatever state (a merged
 * or closed one too, its mark saying so, as Claude Code keeps its row), uncommitted changes while
 * the agent works, or, once it has ended and its branch is read, what the branch holds. A run that
 * changed nothing has no row, nor one whose work landed with no request, or whose branch merged.
 */
export function ProjectRow({ projectId, agentId, working, ended, saving, projectName, pr }: UiWorkProps) {
  const host = useModuleHost()
  // The run's checkout, read while it works and again the moment a turn starts or ends.
  const checkout = useWorktree(host, projectId, agentId, working)
  // What the branch holds (#1023), read once the run has ended: while it is still writing to the
  // branch there is nothing to hand off yet. While the run's clean-up is going, its checkout is
  // being removed, and an empty branch is deleted with it, so a publish offered then turned into
  // "Branch gone" moments later: the answer is only shown then for a branch with commits of its
  // own, which the clean-up keeps.
  const read = useHandoff(host, { projectId, agentId }, { ended, saving, working })
  const kept = read.handoff !== null && read.handoff.exists && !read.handoff.empty
  const { handoff, state } = saving && !kept ? { handoff: null, state: 'unknown' as const } : read
  const known = state !== 'unknown'
  // Over: there is no step left and no request to name. A run's request keeps its row, as a copy's does.
  const over = ended && pr === undefined && (handoff?.landed === true || (handoff?.merged === true && !handoff?.pendingFiles?.length))
  // Once the row has something to say for this run it keeps it (`held`): a run makes its own last
  // commit while it cleans up, after its turn ends, and the branch read taken in between answers
  // for a branch that holds nothing, which used to hide the row for the seconds until the next
  // read. A row that is there stays while the agent works (it committed: its checkout is clean
  // again) and while an ended agent's branch is still being read, so it never goes and comes back.
  const last = useRef<{ agentId: string | null; shows: boolean; branch?: string | undefined }>({ agentId: null, shows: false })
  const same = last.current.agentId === agentId
  const held = same && last.current.shows
  // An ended run's row comes up once its branch is read, all of it at once: shown on the pull
  // request alone, it came up with the request's number and grew the work and the next step a
  // moment later. So does a run not known yet to be going or ended.
  const shows = !over && (ended ? (known ? pr !== undefined || handoffSays(handoff) || held : held) : working ? pr !== undefined || checkout?.checkout?.dirty === true || held : held)
  // The branch is the checkout's, and with none the branch read's; with neither, the one the row
  // last said: the checkout's read answers without one for the moment its folder is being removed.
  const branch = checkout?.branch ?? handoff?.branch ?? (same ? last.current.branch : undefined)
  last.current = { agentId, shows, branch }
  // The next step is asked again as what the branch holds or the run's request moves.
  const again = useMemo(() => ({}), [handoff, pr?.url, pr?.state, saving])
  if (!shows || branch === undefined) return null
  return (
    <WorkRow
      project
      name={projectName || 'This project'}
      branch={branch}
      path={checkout?.checkout?.path}
      summary={ended && known ? <HandoffSummary handoff={handoff} /> : <WorkingSummary projectId={projectId} agentId={agentId} working={working} />}
      pr={pr}
      actions={ended ? <HandoffOffers projectId={projectId} agentId={agentId} again={again} /> : undefined}
    />
  )
}

/**
 * What the row says until the ended run's branch is read: "Committing…", and the modules'
 * summaries. A just-stopped run keeps showing them until its branch is read, so the summary swaps
 * once, to what the branch holds, instead of blanking for the beat the read takes (#1030).
 */
function WorkingSummary({ projectId, agentId, working }: { projectId: string; agentId: string; working: boolean }) {
  const props = { projectId, agentId, working }
  return (
    <>
      <Committing {...props} />
      <ViewsAt place="chat.summary" projectId={projectId} props={props} label="run summary" />
    </>
  )
}
