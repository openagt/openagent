import { useContext, useState, type ReactNode } from 'react'
import type { AgentHandoff } from '../../src/index.js'
import { ChevronDown, GitPullRequestDraft } from 'lucide-react'
import { sendMerge, sendOpenPullRequest, sendPush } from '../rpc/control.js'
import type { AgentHandoffState } from '../lib/use-agent-handoff.js'
import { DaemonDown } from '../lib/use-daemon-health.js'
import { cn } from '../lib/utils.js'
import { Button, buttonVariants } from './ui/button.js'
import { ButtonGroup, ButtonGroupSeparator } from './ui/button-group.js'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu.js'

// The end-of-session handoff's pull request presses (#799), at the end of the bar above the
// message box: Open PR, the push that brings an open one the newer commits, and its merge. The
// rest of the bar, what the branch holds and the presses that keep the work on this machine or
// publish its branch, is git-branches' (`chat.summary`, `chat.handoff`); these are the git host's.
//
// Opening a pull request puts the agent's work on a shared remote under the user's name, so it is
// a deliberate click, and the button's own word says it has not happened yet. Once a PR exists it
// is not offered again: the bar links the PR, and the Human Queue (#632) has picked it up by then.
// What shows is what the PR still needs: the push of commits it does not have, and its merge. Work
// committed after the PR merged or closed is offered the next one.
//
// The read is branch-addressed, so it survives the checkout: a clean agent's worktree is removed
// when it ends.

/** The next step's look: a quiet press on the bar's own fill, not the page's primary one. Busy, a press stays focusable (`aria-disabled`): a disabled one drops the focus to the page. */
const NEXT_STEP = 'bg-background/60 hover:bg-background aria-disabled:pointer-events-none aria-disabled:opacity-50'

/** The project's main branch by name, when the handoff was measured from it; a run measured from a commit only knows it as "the main branch". */
function mainBranchName(base: string | undefined): string {
  return base !== undefined && !/^[0-9a-f]{40}$/.test(base) ? base.replace(/^origin\//, '') : 'the main branch'
}

export function HandoffActions(props: {
  projectId: string
  agentId: string
  /** One of the session's copies of repos, by its name: the presses act on it, in place of the project. */
  repo?: string | undefined
  state: AgentHandoffState
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
  press,
  armed,
}: {
  projectId: string
  agentId: string
  repo?: string | undefined
  state: AgentHandoffState
  press: Pressed
  /** This PR merges by itself once its checks pass. */
  armed: boolean
}) {
  const { handoff, pending } = state
  // OpenAgent is not answering: no step can be taken until it does.
  const down = useContext(DaemonDown)
  // Each press of the next step: marked so a press that went finds the next one, and off while one goes.
  const step = { 'data-next-step': true, disabled: down, 'aria-disabled': state.busy || undefined }
  // Merged on this machine, or a pull request lookup still out (#1028): nothing to offer, and
  // acting on "not known yet" is how a second PR gets opened. Work left uncommitted comes first: a
  // push or an opened pull request would be refused while the checkout is unclean, and a merge
  // would leave the newest work behind; git-branches offers its commit.
  if (!handoff || handoff.landed || handoff.prPending || (handoff.pendingFiles?.length ?? 0) > 0) return null
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
      const push = () => press('push', () => (repo !== undefined ? sendPush(projectId, agentId, repo) : sendPush(projectId, agentId)), 'Could not push the branch.', () => ({ pushed: true }), () => ({ text: 'Pushed.' }))
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
  // No pull request to open: a branch that is gone, one with no diff (#1173: the git host would
  // refuse it with "No commits between main and <branch>"), work the main branch already has, a
  // project with no remote or with no git host package (#1820). What is said of each is git-branches'.
  if (!handoff.exists || handoff.empty || handoff.merged || !handoff.hasRemote || !handoff.gitHost) return null
  // A split button: "Open PR" names the outcome and pushes the branch on the way, and the arrow
  // beside it holds a draft pull request.
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
          <Steady words={['Open PR', 'Opening PR…']} now={pending === 'pr' ? 1 : 0} />
        </Button>
        <ButtonGroupSeparator className="bg-border opacity-100" />
        <DropdownMenu>
          <DropdownMenuTrigger type="button" aria-label="Other choices" {...step} className={cn(buttonVariants({ size: 'sm', variant: 'ghost' }), NEXT_STEP, 'px-1 data-[popup-open]:bg-background')}>
            <ChevronDown className="h-3.5 w-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[10rem]">
            <DropdownMenuItem onClick={() => openPr(true)}>
              <GitPullRequestDraft className="h-3.5 w-3.5" />
              Create draft PR
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </ButtonGroup>
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
  // rather than push the row wide. On a phone it wraps in a narrow column instead: the panel's rows
  // share one column for their ends, and a reason one line long there leaves the names no room.
  return (
    <span className="inline-block max-w-[24rem] truncate align-middle text-xs text-muted-foreground max-md:max-w-32 max-md:whitespace-normal max-md:text-right" {...(title ? { title } : {})} {...(hidden ? { 'aria-hidden': true } : {})}>
      {children}
    </span>
  )
}
