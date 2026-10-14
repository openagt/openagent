import type { ReactNode } from 'react'
import type { AgentHandoff } from '../../src/index.js'
import { ChevronDown, GitPullRequestDraft, Upload } from 'lucide-react'
import { sendMerge, sendMergeBranch, sendMessage, sendOpenPullRequest, sendPush } from '../rpc/control.js'
import type { AgentHandoffState } from '../lib/use-agent-handoff.js'
import { cn } from '../lib/utils.js'
import { DiffStat } from './DiffStat.js'
import { Button, buttonVariants } from './ui/button.js'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu.js'

// The end-of-session handoff (#799): what this session produced, and the next step offered rather
// than described. Before this, a finished session showed no branch, no commits and no diff, so
// finding out what it actually did meant leaving the dashboard for the command line.
//
// It used to be a panel of its own under the action bar, which repeated the bar's branch name and
// pushed the session output down even when the answer was "nothing changed". It is now the verdict
// and the next step, in the bar above the message box beside the branch they are about (#1023).
// The commits and the files themselves are in the side panel's Changes tab.
//
// The read is branch-addressed, so it survives the checkout: a clean agent's worktree is removed
// when it ends.

/**
 * The one-line verdict, in the action bar: what the session left behind, or that it left nothing.
 *
 * A subagent's work goes to its main agent's branch, never to the remote by a person's hand: its
 * line says what it changed, and whether it is landed is said where the next step would be
 * ({@link HandoffActions}).
 */
export function HandoffSummary({ handoff, subagent = false }: { handoff: AgentHandoff | null; subagent?: boolean }) {
  if (!handoff) return null
  // A landed run's branch is gone on purpose; what it held is read by its last commit, and when
  // this machine does not have that commit there is nothing to count: landed is said beside it.
  if (!handoff.exists && handoff.landed) return null
  // A branch that is gone and a branch that was never pushed are different facts, and the summary
  // is only useful if it tells them apart. Gone because the run changed nothing is no changes.
  if (!handoff.exists) return <span className="text-muted-foreground">{handoff.unchanged ? 'no changes' : 'branch gone'}</span>
  // A merged branch whose record names no start reads as empty too — its commits are all on the
  // base, so `base..branch` lists nothing — but "merged" and "no changes" are opposite verdicts,
  // and only one of them is true. One whose record names its start keeps its count below.
  const commits = `${handoff.commits.length} commit${handoff.commits.length === 1 ? '' : 's'}`
  // Commits that undo each other leave the files as the base has them. The commits are still what
  // the agent did, so they are counted, and that nothing is left of them is said beside the count.
  if (handoff.empty && handoff.commits.length > 0) return <span className="text-muted-foreground">{commits} · no change left</span>
  // Nothing committed and files left on disk: neither "merged" nor "no changes" is true of that,
  // and the words beside the Commit button name the files. So the verdict says nothing.
  if (handoff.empty && handoff.pendingFiles?.length) return null
  if (handoff.empty) return <span className="text-muted-foreground">{handoff.merged ? 'merged' : 'no changes'}</span>
  const files = `${handoff.files.length} file${handoff.files.length === 1 ? '' : 's'}`
  // What the branch holds, as Claude Code says it: the `+N −N` pair alone, in a chip. The counts
  // behind it — how many commits, how many files, whether they are on the remote — are the same
  // work in more words, so they are the chip's hover rather than three more things to read on a row
  // that already carries the branch and the next step. The files themselves are a pane away.
  const held = [commits, files, ...(!subagent && handoff.pushed && !handoff.pr ? ['pushed'] : [])].join(' · ')
  return (
    <span className="flex shrink-0 items-center whitespace-nowrap rounded-md bg-background/60 px-1.5 py-0.5" title={held} aria-label={held}>
      <DiffStat added={handoff.insertions} removed={handoff.deletions} zeros className="text-[11px] font-medium" />
    </span>
  )
}

/**
 * The next step, as a button, at the end of the action bar.
 *
 * What is left once a session has ended: its work is on this machine only, since an agent pushes
 * and opens its pull request only when its task or the person asks, and this is how a person
 * publishes it. Both put the agent's work on a shared remote under the user's name, so it is a
 * deliberate click, and the button's own word — Publish branch, Open PR — says it has not
 * happened yet. They sit in the
 * bar rather than behind the disclosure, because the point of the handoff is to be offered without
 * being looked for. Once a PR exists neither shows — the bar links the PR, and the interventions
 * queue (#632) has picked it up by then. What shows is what the PR still needs: the commit of work
 * left uncommitted, the push of commits it does not have, and its merge. Work committed after the
 * PR merged or closed is offered the next one.
 *
 * A subagent is offered none of them: it opens no pull request, and its branch is its main
 * agent's to land. In their place it says whether that happened, landed or not landed, at the end
 * of the bar where it is always in view. What it left uncommitted is still named, since nothing
 * lands that.
 */
/** What the Commit button says to the agent: it commits its own work, in its own words. */
export const COMMIT_MESSAGE = 'Commit your work.'

/** The project's main branch by name, when the handoff was measured from it; a run measured from a commit only knows it as "the main branch". */
function mainBranchName(base: string | undefined): string {
  return base !== undefined && !/^[0-9a-f]{40}$/.test(base) ? base.replace(/^origin\//, '') : 'the main branch'
}

/** Whether a prompt is the Commit button's ask. */
export function isCommitAsk(prompt: string | undefined): boolean {
  return prompt === COMMIT_MESSAGE
}

/** Where the next step would be, while the agent does what the Commit button asked of it. */
export function Committing() {
  return <Reason>Committing…</Reason>
}

export function HandoffActions({
  projectId,
  agentId: agentId,
  state,
  subagent = false,
  onAsked,
}: {
  projectId: string
  agentId: string
  state: AgentHandoffState
  subagent?: boolean
  /** The Commit button's ask is on its way to the agent (`null`: it did not go through), so the page shows it at once. */
  onAsked?: ((text: string | null) => void) | undefined
}) {
  const { handoff, busy, pending, act } = state
  if (!handoff) return null
  if (subagent) {
    if (handoff.landed) return <Reason>landed</Reason>
    return handoff.empty ? <Uncommitted paths={handoff.pendingFiles ?? []} /> : <Reason>not landed</Reason>
  }
  // Merged into the project's main branch on this machine: the work is in, and its branch went with it.
  if (handoff.landed) return <Reason>Merged into the main branch.</Reason>
  // While the PR lookup is still out (#1028), nothing is offered: acting on "not known yet" is
  // how a second PR gets opened.
  if (handoff.prPending) return null
  // Uncommitted work comes before every other step, with a pull request or without one: a push or
  // an opened pull request would be refused while the checkout is unclean, and a merge would leave
  // the newest work behind. The work is named, and the next step is offered: the agent is asked to commit it. The agent
  // commits, not the dashboard: it knows what it changed and writes the message, and nothing is
  // committed on its behalf. This is also the agent that committed, was asked for more, and left
  // that uncommitted.
  const paths = handoff.pendingFiles ?? []
  if (paths.length > 0) {
    return (
      <>
        <Uncommitted paths={paths} committed={!handoff.empty} />
        <Button
          size="xs"
          variant="ghost"
          disabled={busy}
          onClick={() => {
            onAsked?.(COMMIT_MESSAGE)
            const ask = () =>
              sendMessage(projectId, COMMIT_MESSAGE, agentId).then(
                sent => {
                  if (!sent.ok) onAsked?.(null)
                  return sent
                },
                err => {
                  onAsked?.(null)
                  throw err
                },
              )
            act('commit', ask, 'Could not ask the agent to commit.')
          }}
        >
          {pending === 'commit' ? 'Asking…' : 'Commit'}
        </Button>
      </>
    )
  }
  const push = () => act('push', () => sendPush(projectId, agentId), 'Could not push the branch.')
  // Once a PR exists the bar links it and the needs-you queue (#632) has it: offering to open one
  // again is the single mistake this must not make. What is still worth offering is the Merge
  // (#1391): an open, unmerged PR takes one human click to land. An agent asked for more after its
  // PR was opened has commits the PR does not: the push that brings them to it comes first, since a
  // merge would land the PR without them. Offered only when the PR's own head is an earlier commit
  // of this branch: a branch that differs from the remote because the remote moved (the PR was
  // updated on the git host) has nothing to push, and a push of it would be refused.
  // An agent that kept committing after its PR merged or closed is past that PR: its newer work
  // is offered a pull request of its own, as work with no PR is, below.
  if (handoff.pr && !handoff.movedPastPr) {
    if (handoff.pr.state !== 'OPEN' || handoff.merged) return null
    const prHead = handoff.pr.headRefOid
    if (!handoff.pushed && handoff.commits.slice(1).some(commit => commit.sha === prHead)) {
      return (
        <>
          <Reason>not in the PR yet</Reason>
          <Button size="xs" variant="ghost" disabled={busy} onClick={push}>
            {pending === 'push' ? 'Updating PR…' : 'Update PR'}
          </Button>
        </>
      )
    }
    return (
      <Button
        size="xs"
        variant="ghost"
        disabled={busy}
        onClick={() => act('merge', () => sendMerge(projectId, agentId), 'Could not merge the pull request.')}
      >
        {pending === 'merge' ? 'Merging…' : 'Merge PR'}
      </Button>
    )
  }
  // A run that changed nothing shows nothing here: there is nothing to do, and a finished run with
  // work always shows its button, so silence already says it. A reason is written only where
  // something was left behind the user may act on.
  // A branch the run's own tool deleted because it held nothing is no loss, so it too is silent.
  if (!handoff.exists) return handoff.unchanged ? null : <Reason>Branch gone — nothing to open a PR from.</Reason>
  // A branch with no diff never gets the button (#1173): there is nothing the git host would accept a PR
  // for, and offering one that fails with "No commits between main and <branch>" is the dead end
  // this bar exists to prevent. Commits that undo each other: there is work, and none of it is
  // left to take. Said, so the missing button does not read as a fault.
  if (handoff.empty) return handoff.commits.length > 0 ? <Reason>Nothing to {handoff.hasRemote ? 'publish' : 'merge'}: the commits cancel out.</Reason> : null
  // The main branch already has the work: there is no step left, with a remote or without one.
  // The commits and files stay counted beside it, measured from where the run's work began.
  if (handoff.merged) return <Reason>Merged into {mainBranchName(handoff.base)}.</Reason>
  // No remote: nothing to push to and no pull request to open, so the work reaches the project's
  // own folder by a merge on this machine, and that is the one step offered.
  if (!handoff.hasRemote) {
    return (
      <>
        <Reason>Not in {mainBranchName(handoff.base)} yet.</Reason>
        <Button
          size="xs"
          variant="ghost"
          disabled={busy}
          onClick={() => act('merge-branch', () => sendMergeBranch(projectId, agentId), 'Could not merge the branch.')}
        >
          {pending === 'merge-branch' ? 'Merging…' : 'Merge'}
        </Button>
      </>
    )
  }
  // No git host package (#1820): nothing opens a pull request for this project, so the last step is
  // the push, and a pushed branch is where the handoff ends.
  if (!handoff.gitHost) {
    if (handoff.pushed) return <Reason>Pushed — no git host package to open a pull request with.</Reason>
    return (
      <>
        <Button size="xs" variant="ghost" disabled={busy} onClick={push}>
          {pending === 'push' ? 'Publishing…' : 'Publish branch'}
        </Button>
      </>
    )
  }
  // A split button: "Open PR" names the outcome and pushes the branch on the way, and the arrow
  // beside it holds the other choices: a draft pull request, and the push alone, for work that
  // should reach the remote with no pull request yet (gone once the branch is pushed).
  const openPr = (draft: boolean) => act('pr', () => sendOpenPullRequest(projectId, agentId, { draft }), 'Could not open the pull request.')
  return (
    <>
      <span className="inline-flex">
        <Button
          size="xs"
          variant="ghost"
          className="rounded-r-none pr-1.5"
          disabled={busy}
          onClick={() => openPr(false)}
        >
          {pending === 'pr' ? 'Opening PR…' : pending === 'push' ? 'Publishing…' : 'Open PR'}
        </Button>
        <DropdownMenu>
            <DropdownMenuTrigger
              type="button"
              aria-label="Other choices"
              disabled={busy}
              className={cn(
                buttonVariants({ size: 'xs', variant: 'ghost' }),
                'rounded-l-none px-1 text-muted-foreground data-[popup-open]:bg-[var(--color-accent)] data-[popup-open]:text-[var(--color-accent-foreground)]',
              )}
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[10rem]">
              <DropdownMenuItem onClick={() => openPr(true)}>
                <GitPullRequestDraft className="h-3.5 w-3.5" />
                Create draft PR
              </DropdownMenuItem>
              {!handoff.pushed && (
                <DropdownMenuItem onClick={push}>
                  <Upload className="h-3.5 w-3.5" />
                  Publish branch
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
      </span>
    </>
  )
}

/**
 * The work a checkout holds uncommitted, named; nothing when the tree is clean. `committed` says
 * the branch has commits already, so "Nothing committed" would be false.
 */
function Uncommitted({ paths, committed = false }: { paths: string[]; committed?: boolean }) {
  if (paths.length === 0) return null
  return (
    <Reason title={paths.join('\n')}>
      {committed ? '' : 'Nothing committed — '}
      {namePending(paths)} left uncommitted.
    </Reason>
  )
}

/**
 * The uncommitted paths, worded for a one-line bar: the first couple named, the rest counted.
 * The full list is one hover (the Reason's title) away.
 */
function namePending(paths: string[]): string {
  const shown = paths.slice(0, 2).join(', ')
  const rest = paths.length - Math.min(paths.length, 2)
  return rest > 0 ? `${shown} and ${rest} more` : shown
}

/** Why there is nothing to press. Reads as part of the bar, not as an error. */
function Reason({ children, title }: { children: ReactNode; title?: string }) {
  // Capped and truncated: the bar's actions never shrink, so a long file name must ellipsize here
  // rather than push the row wide.
  return (
    <span className="inline-block max-w-[24rem] truncate align-middle text-xs text-muted-foreground" {...(title ? { title } : {})}>
      {children}
    </span>
  )
}
