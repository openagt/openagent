import { useContext, useState, type ReactNode } from 'react'
import type { AgentHandoff } from '../../src/index.js'
import { ChevronDown, GitBranchPlus, GitPullRequestDraft, Upload } from 'lucide-react'
import { sendBringBranch, sendMerge, sendMergeBranch, sendMessage, sendOpenPullRequest, sendPush } from '../rpc/control.js'
import type { AgentHandoffState } from '../lib/use-agent-handoff.js'
import { DaemonDown } from '../lib/use-daemon-health.js'
import { cn } from '../lib/utils.js'
import { Button, buttonVariants } from './ui/button.js'
import { ButtonGroup, ButtonGroupSeparator } from './ui/button-group.js'
import { DiffStat } from './DiffStat.js'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu.js'
import { Facts } from './ui/panel.js'

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

/** The one-line verdict, in the action bar: what the session left behind, or that it left nothing. */
export function HandoffSummary({ handoff }: { handoff: AgentHandoff | null }) {
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
  if (handoff.empty && handoff.commits.length > 0) return <Facts facts={[commits, 'no change left']} className="text-muted-foreground" />
  // Nothing committed and files left on disk: neither "merged" nor "no changes" is true of that,
  // and the words beside the Commit button name the files. So the verdict says nothing.
  if (handoff.empty && handoff.pendingFiles?.length) return null
  if (handoff.empty) return <span className="text-muted-foreground">{handoff.merged ? 'merged' : 'no changes'}</span>
  const files = `${handoff.files.length} file${handoff.files.length === 1 ? '' : 's'}`
  // What the branch holds, as Claude Code says it: the `+N −N` pair alone. The counts behind it —
  // how many commits, how many files, whether they are on the remote — are the same work in more
  // words, so they are its hover rather than three more things to read on a row that already carries
  // the branch and the next step. The files themselves are a pane away.
  const held = [commits, files, ...(handoff.pushed && !handoff.pr ? ['pushed'] : [])].join(' · ')
  return (
    <span className="flex shrink-0 items-center whitespace-nowrap" title={held} aria-label={held}>
      <DiffStat added={handoff.insertions} removed={handoff.deletions} className="text-xs font-medium" />
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
 * being looked for. Once a PR exists neither shows — the bar links the PR, and the Human Queue
 * (#632) has picked it up by then. What shows is what the PR still needs: the commit of work
 * left uncommitted, the push of commits it does not have, and its merge. Work committed after the
 * PR merged or closed is offered the next one.
 */
/** What the Commit button says to the agent: it commits its own work, in its own words. */
const COMMIT_MESSAGE = 'Commit your work.'

/** The next step's look: a quiet press on the bar's own fill, not the page's primary one. Busy, a press stays focusable (`aria-disabled`): a disabled one drops the focus to the page. */
const NEXT_STEP = 'bg-background/60 hover:bg-background aria-disabled:pointer-events-none aria-disabled:opacity-50'

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

export function HandoffActions(props: {
  projectId: string
  agentId: string
  /** One of the session's copies of repos, by its name: the presses act on it, in place of the project. */
  repo?: string | undefined
  state: AgentHandoffState
  /** The Commit button's ask is on its way to the agent (`null`: it did not go through), so the page shows it at once. */
  onAsked?: ((text: string | null) => void) | undefined
}) {
  const { handoff, act } = props.state
  // What the last press did, said until the work on the branch moves on or the bar is put away.
  const [said, setSaid] = useState<{ text: string; work: string; title?: string; shown?: false } | null>(null)
  // The pull request a merge pressed here left to the provider's own watcher, which the git host does not report.
  const [watched, setWatched] = useState<number | null>(null)
  const work = handoff ? [handoff.commits.length, handoff.pendingFiles?.length ?? 0, handoff.insertions, handoff.deletions].join('|') : ''
  const saying = said?.work === work ? said : null
  // A merge that waits for the checks: armed on the git host, read with the pull request, or watched since a press here.
  const pr = handoff?.pr && !handoff.movedPastPr && !handoff.merged && handoff.pr.state === 'OPEN' ? handoff.pr : undefined
  const armed = pr !== undefined && (pr.armed === true || watched === pr.number)
  // What the last press did, in the bar, unless the bar already shows it (`shown: false`): then the screen reader alone hears it.
  const inBar = saying?.shown === false ? null : saying
  const shown: { text: string; title?: string } | null = inBar ?? (armed ? { text: mergesLater(pr.number) } : null)
  const press: Pressed = (which, fn, failed, answered, says) => {
    if (props.state.busy) return
    // The bar, not the split button around a press: that group is gone once its press is done.
    const bar = document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>('[role="group"]:not([data-slot="button-group"])') : null
    void act(which, fn, failed, answered).then(value => {
      const told = value === undefined ? undefined : says?.(value)
      if (told) setSaid({ ...told, work })
      if (value !== undefined && which === 'merge' && (value as { merge?: string }).merge === 'watching') setWatched(handoff?.pr?.number ?? null)
      requestAnimationFrame(() => keepFocusIn(bar))
    })
  }
  return (
    <>
      {shown && (
        <Reason {...(shown.title ? { title: shown.title } : {})} hidden={shown === inBar}>
          {shown.text}
        </Reason>
      )}
      <NextStep {...props} press={press} armed={armed} />
      <span aria-live="polite" className="sr-only">
        {saying?.text}
      </span>
    </>
  )
}

/** A press of the bar: `act`'s, and what to say once it went (`says`). */
type Pressed = <T>(
  which: Parameters<AgentHandoffState['act']>[0],
  fn: () => Promise<T>,
  failed: string,
  answered?: (value: Exclude<T, { ok: false }>) => Partial<AgentHandoff> | undefined,
  /** `shown: false`: what the bar already shows, said to a screen reader alone. */
  says?: (value: Exclude<T, { ok: false }>) => { text: string; title?: string; shown?: false } | undefined,
) => void

/** After a press the focus stays in the bar, on its next press or else on the bar, unless the person has moved it. */
function keepFocusIn(bar: HTMLElement | null): void {
  const at = document.activeElement
  if (!bar?.isConnected || (at !== null && at !== document.body && at !== bar)) return
  ;(bar.querySelector<HTMLElement>('[data-next-step]:not(:disabled)') ?? bar).focus()
}

function NextStep({
  projectId,
  agentId,
  repo,
  state,
  onAsked,
  press,
  armed,
}: {
  projectId: string
  agentId: string
  repo?: string | undefined
  state: AgentHandoffState
  onAsked?: ((text: string | null) => void) | undefined
  press: Pressed
  /** This PR merges by itself once its checks pass. */
  armed: boolean
}) {
  const { handoff, pending } = state
  // OpenAgent is not answering: no step can be taken until it does.
  const down = useContext(DaemonDown)
  // Each press of the next step: marked so a press that went finds the next one, and off while one goes.
  const step = { 'data-next-step': true, disabled: down, 'aria-disabled': state.busy || undefined }
  if (!handoff) return null
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
          size="sm"
          variant="ghost"
          className={NEXT_STEP}
          {...step}
          onClick={() => {
            if (state.busy) return
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
            press('commit', ask, 'Could not ask the agent to commit.')
          }}
        >
          <Steady words={['Commit', 'Asking…']} now={pending === 'commit' ? 1 : 0} />
        </Button>
      </>
    )
  }
  const pushed = handoff.gitHost ? { text: 'Pushed.' } : { text: 'Pushed. Pull requests need a remote on GitHub.', title: 'Another git host needs a module of its own in OpenAgent' }
  const push = () => press('push', () => (repo !== undefined ? sendPush(projectId, agentId, repo) : sendPush(projectId, agentId)), 'Could not push the branch.', () => ({ pushed: true }), () => pushed)
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
    if (handoff.pr.state !== 'OPEN' || handoff.merged || armed) return null
    const pr = handoff.pr
    const prHead = pr.headRefOid
    if (!handoff.pushed && handoff.commits.slice(1).some(commit => commit.sha === prHead)) {
      return (
        <>
          <Reason>not in the PR yet</Reason>
          <Button size="sm" variant="ghost" className={NEXT_STEP} {...step} onClick={push}>
            <Steady words={['Update PR', 'Updating PR…']} now={pending === 'push' ? 1 : 0} />
          </Button>
        </>
      )
    }
    return (
      <Button
        size="sm"
        variant="ghost"
        className={NEXT_STEP}
        {...step}
        title={`Merges PR #${pr.number} now, or once its checks pass`}
        onClick={() =>
          press(
            'merge',
            () => (repo !== undefined ? sendMerge(projectId, agentId, repo) : sendMerge(projectId, agentId)),
            'Could not merge the pull request.',
            done => (done.merge === 'merged' ? { pr: { ...pr, state: 'MERGED' } } : done.merge === 'auto-armed' ? { pr: { ...pr, armed: true } } : undefined),
            done => ({ text: done.merge === 'merged' ? `Merged PR #${pr.number}.` : mergesLater(pr.number) }),
          )
        }
      >
        <Steady words={['Merge PR', 'Merging…']} now={pending === 'merge' ? 1 : 0} />
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
  // A copy's main branch is the folder's it came from, which is the one that matters.
  if (handoff.merged) {
    const folder = handoff.copiedFrom?.path
    return <Reason {...(folder ? { title: folder } : {})}>Merged into {mainBranchName(handoff.base)}{folder ? ` in ${folder}` : ''}.</Reason>
  }
  // No remote: nothing to push to and no pull request to open, so the work reaches the project's
  // own folder by a merge on this machine, and that is the one step offered.
  if (!handoff.hasRemote) {
    if (repo !== undefined) {
      // A copy names the folder it was copied from; a repository the agent cloned into the session on its own names none, and its work stays there.
      if (!handoff.copiedFrom) return <Reason>No remote: the work stays in this copy.</Reason>
      return <CopyBack projectId={projectId} agentId={agentId} repo={repo} handoff={handoff} copiedFrom={handoff.copiedFrom} state={state} press={press} step={step} />
    }
    return (
      <>
        <Reason>Not in {mainBranchName(handoff.base)} yet.</Reason>
        <Button
          size="sm"
          variant="ghost"
          className={NEXT_STEP}
          {...step}
          onClick={() => press('merge-branch', () => sendMergeBranch(projectId, agentId), 'Could not merge the branch.')}
        >
          <Steady words={['Merge', 'Merging…']} now={pending === 'merge-branch' ? 1 : 0} />
        </Button>
      </>
    )
  }
  // No git host package (#1820): nothing opens a pull request for this project, so the last step is
  // the push, and a pushed branch is where the handoff ends.
  if (!handoff.gitHost) {
    if (handoff.pushed) return null
    return (
      <>
        <Button size="sm" variant="ghost" className={NEXT_STEP} {...step} onClick={push}>
          <Steady words={['Publish branch', 'Publishing…']} now={pending === 'push' ? 1 : 0} />
        </Button>
      </>
    )
  }
  // A split button: "Open PR" names the outcome and pushes the branch on the way, and the arrow
  // beside it holds the other choices: a draft pull request, and the push alone, for work that
  // should reach the remote with no pull request yet (gone once the branch is pushed).
  const openPr = (draft: boolean) =>
    press(
      'pr',
      () => sendOpenPullRequest(projectId, agentId, { draft, ...(repo !== undefined ? { repo } : {}) }),
      'Could not open the pull request.',
      opened => (opened.number !== undefined && opened.url !== undefined ? { pushed: true, pr: { number: opened.number, url: opened.url, state: 'OPEN', title: '' } } : undefined),
      // The bar names the pull request from here on.
      opened => (opened.number !== undefined ? { text: `Opened ${draft ? 'draft ' : ''}PR #${opened.number}.`, shown: false } : undefined),
    )
  return (
    <>
      {handoff.carries && <Carries carries={handoff.carries} />}
      <ButtonGroup>
        <Button
          size="sm"
          variant="ghost"
          className={cn(NEXT_STEP, 'pr-1.5!')}
          {...step}
          title={`${handoff.pushed ? 'Opens' : 'Pushes the branch and opens'} a pull request for ${handoff.branch}`}
          onClick={() => openPr(false)}
        >
          <Steady words={['Open PR', 'Opening PR…', 'Publishing…']} now={pending === 'pr' ? 1 : pending === 'push' ? 2 : 0} />
        </Button>
        <ButtonGroupSeparator className="bg-border opacity-100" />
        <DropdownMenu>
            <DropdownMenuTrigger
              type="button"
              aria-label="Other choices"
              {...step}
              className={cn(
                buttonVariants({ size: 'sm', variant: 'ghost' }),
                NEXT_STEP,
                'px-1 data-[popup-open]:bg-background',
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
      </ButtonGroup>
    </>
  )
}

/**
 * A copy of a repo with no remote, back to the folder it was copied from: "Merge" brings its
 * branch there and merges it into the folder's main branch, as a project with no remote merges;
 * its arrow holds "Only add the branch", for a folder busy on another branch. Once the folder has
 * the branch, the Merge is the one step left.
 */
function CopyBack({ projectId, agentId, repo, handoff, copiedFrom, state, press, step }: {
  projectId: string
  agentId: string
  repo: string
  handoff: AgentHandoff
  copiedFrom: NonNullable<AgentHandoff['copiedFrom']>
  state: AgentHandoffState
  press: Pressed
  step: Record<string, unknown>
}) {
  const main = mainBranchName(handoff.base)
  const bring = (merge: boolean) =>
    press(
      merge ? 'merge-branch' : 'bring',
      () => sendBringBranch(projectId, agentId, repo, merge ? { merge: true } : {}),
      merge ? 'Could not merge the branch.' : 'Could not add the branch.',
      () => (merge ? { merged: true } : { copiedFrom: { ...copiedFrom, hasBranch: true } }),
    )
  const merge = (
    <Button
      size="sm"
      variant="ghost"
      className={cn(NEXT_STEP, !copiedFrom.hasBranch && 'pr-1.5!')}
      {...step}
      title={`Merges ${handoff.branch} into ${main} in ${copiedFrom.path}`}
      onClick={() => bring(true)}
    >
      <Steady words={['Merge', 'Merging…']} now={state.pending === 'merge-branch' ? 1 : 0} />
    </Button>
  )
  return (
    <>
      <Reason title={copiedFrom.path}>{copiedFrom.hasBranch ? `In ${copiedFrom.path}, not in ${main} yet.` : `Not in ${main} yet.`}</Reason>
      {copiedFrom.hasBranch ? (
        merge
      ) : (
        <ButtonGroup>
          {merge}
          <ButtonGroupSeparator className="bg-border opacity-100" />
          <DropdownMenu>
            <DropdownMenuTrigger type="button" aria-label="Other choices" {...step} className={cn(buttonVariants({ size: 'sm', variant: 'ghost' }), NEXT_STEP, 'px-1 data-[popup-open]:bg-background')}>
              <ChevronDown className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[10rem]">
              <DropdownMenuItem onClick={() => bring(false)}>
                <GitBranchPlus className="h-3.5 w-3.5" />
                Only add the branch
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </ButtonGroup>
      )}
    </>
  )
}

/**
 * What a pull request would carry beyond the run's own work, beside the button that opens it: the
 * run started from a branch of this machine, and that branch's own unlanded commits go up with it.
 *
 * Said, never blocked: the pull request is still one click, and this is the one place a person can
 * see before the click that it takes more than this run's changes. The counts the bar already shows
 * are the run's own work, measured from where it began, and both numbers are true — which is
 * exactly why the second one has to be said out loud.
 */
function Carries({ carries }: { carries: NonNullable<AgentHandoff['carries']> }) {
  const base = mainBranchName(carries.base)
  const files = `${carries.files} file${carries.files === 1 ? '' : 's'}`
  const commits = `${carries.commits} commit${carries.commits === 1 ? '' : 's'}`
  return (
    <Reason title={`A pull request against ${base} carries ${commits} · ${files} · +${carries.insertions} −${carries.deletions}, this run's work among them.`}>
      {files} over {base}
    </Reason>
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

/**
 * A press's word (`words[now]`) in the room its widest word takes, so the bar does not move as the
 * press turns into what it is doing. The other words stand invisible in the same place, as
 * generated text the page's text and a screen reader leave out.
 */
function Steady({ words, now }: { words: readonly string[]; now: number }) {
  const [first, second] = words.filter((_, at) => at !== now)
  return (
    <span
      data-also={first}
      data-also-too={second ?? ''}
      className="inline-grid whitespace-nowrap *:col-start-1 *:row-start-1 before:invisible before:col-start-1 before:row-start-1 before:h-0 before:content-[attr(data-also)] after:invisible after:col-start-1 after:row-start-1 after:h-0 after:content-[attr(data-also-too)]"
    >
      <span>{words[now]}</span>
    </span>
  )
}

/** What the bar says of a pull request that merges by itself once its checks pass. */
function mergesLater(number: number): string {
  return `PR #${number} merges when its checks pass.`
}

/** Why there is nothing to press. Reads as part of the bar, not as an error. `hidden`: said to a screen reader elsewhere. */
function Reason({ children, title, hidden = false }: { children: ReactNode; title?: string; hidden?: boolean }) {
  // Capped and truncated: the bar's actions never shrink, so a long file name must ellipsize here
  // rather than push the row wide.
  return (
    <span className="inline-block max-w-[24rem] truncate align-middle text-xs text-muted-foreground" {...(title ? { title } : {})} {...(hidden ? { 'aria-hidden': true } : {})}>
      {children}
    </span>
  )
}
