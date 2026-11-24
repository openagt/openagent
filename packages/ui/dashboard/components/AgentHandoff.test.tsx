import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { openMenu } from '../test-utils.js'

const onAgentHandoff = vi.fn(async () => null as unknown)
const sendOpenPullRequest = vi.fn(async () => ({ ok: true }) as unknown)
const sendMerge = vi.fn(async () => ({ ok: true }) as unknown)
const sendPush = vi.fn(async () => ({ ok: true }) as unknown)
vi.mock('../rpc/reads.js', () => ({ onAgentHandoff }))
vi.mock('../rpc/control.js', () => ({ sendOpenPullRequest, sendMerge, sendPush }))

const { HandoffActions } = await import('./AgentHandoff.js')
const { handoffSays, useAgentHandoff } = await import('../lib/use-agent-handoff.js')

/** A handoff for a session that did real work, on a repo with a remote and no PR yet. */
const worked = {
  branch: 'openagent/dark-mode',
  exists: true,
  base: 'origin/main',
  commits: [{ sha: 'aaaaaaa1', short: 'aaaaaaa', subject: 'add dark mode' }],
  files: [{ path: 'src/theme.ts', insertions: 12, deletions: 3, binary: false }],
  insertions: 12,
  deletions: 3,
  empty: false,
  hasRemote: true,
  pushed: false,
  merged: false,
  gitHost: true,
}

// The pull request presses, as AgentView draws them in the bar; what the branch holds and the other
// steps are git-branches' (its dashboard tests).
// `working`: the run's turn is going, so nothing is read and the answer read before it is dropped.
// `agentId`: the session shown; the agent view keeps the hook when another one opens.
function Harness({ working = false, agentId = 'run-1' }: { working?: boolean; agentId?: string }) {
  const state = useAgentHandoff('p1', agentId, !working, false, working)
  return (
    <>
      {state.error && <span>{state.error}</span>}
      <HandoffActions projectId="p1" agentId={agentId} state={state} />
    </>
  )
}

beforeEach(() => {
  onAgentHandoff.mockClear()
  sendOpenPullRequest.mockClear()
  sendOpenPullRequest.mockResolvedValue({ ok: true })
  sendMerge.mockClear()
  sendMerge.mockResolvedValue({ ok: true })
  sendPush.mockClear()
  sendPush.mockResolvedValue({ ok: true })
})
afterEach(cleanup)

describe('run handoff (#799)', () => {
  test('a split button: Open PR pushes and opens the pull request', async () => {
    onAgentHandoff.mockResolvedValue(worked)
    render(<Harness />)
    await waitFor(() => expect(screen.getByText('Open PR')).toBeTruthy())
    fireEvent.click(screen.getByText('Open PR'))
    await waitFor(() => expect(sendOpenPullRequest).toHaveBeenCalledWith('p1', 'run-1', { draft: false }))
    expect(sendPush).not.toHaveBeenCalled()
  })

  test('Create draft PR, under the arrow, opens the pull request as a draft, pushed or not', async () => {
    onAgentHandoff.mockResolvedValue(worked)
    const { unmount } = render(<Harness />)
    await openMenu(await screen.findByRole('button', { name: 'Other choices' }))
    fireEvent.click(await screen.findByText('Create draft PR'))
    await waitFor(() => expect(sendOpenPullRequest).toHaveBeenCalledWith('p1', 'run-1', { draft: true }))
    expect(sendPush).not.toHaveBeenCalled()
    unmount()
    onAgentHandoff.mockResolvedValue({ ...worked, pushed: true })
    render(<Harness />)
    await openMenu(await screen.findByRole('button', { name: 'Other choices' }))
    expect(await screen.findByText('Create draft PR')).toBeTruthy()
  })

  test('a failed action surfaces its reason rather than doing nothing', async () => {
    onAgentHandoff.mockResolvedValue(worked)
    sendOpenPullRequest.mockResolvedValue({ ok: false, error: 'gh: not logged in' })
    render(<Harness />)
    await waitFor(() => expect(screen.getByText('Open PR')).toBeTruthy())
    fireEvent.click(screen.getByText('Open PR'))
    // What failed in the bar's words, then the program's own line.
    await waitFor(() => expect(screen.getByText('Could not open the pull request. gh: not logged in')).toBeTruthy())
  })

  test('an opened PR is the bar\'s at once, from the press\'s own answer: its Merge is offered before the branch is read again', async () => {
    onAgentHandoff.mockResolvedValue(worked)
    sendOpenPullRequest.mockResolvedValue({ ok: true, number: 3, url: 'https://example.test/3' })
    render(<Harness />)
    const open = await screen.findByText('Open PR')
    // What the press does, before it is pressed.
    expect(open.closest('button')!.title).toBe('Pushes the branch and opens a pull request for openagent/dark-mode')
    // The read after the press is still looking up the PR, as it does once the cached one was dropped.
    onAgentHandoff.mockResolvedValue({ ...worked, pushed: true, prPending: true })
    const reads = onAgentHandoff.mock.calls.length
    fireEvent.click(open)
    await waitFor(() => expect(onAgentHandoff.mock.calls.length).toBeGreaterThan(reads))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(screen.getByRole('button', { name: 'Merge PR' }).title).toBe('Merges PR #3 now, or once its checks pass')
    expect(document.querySelector('[aria-live="polite"]')!.textContent).toBe('Opened PR #3.')
    // Said to a screen reader alone: the bar names the pull request.
    expect(screen.getAllByText('Opened PR #3.')).toHaveLength(1)
  })

  test("a PR opened for one session is never shown on another opened while it was opening, nor once it is open", async () => {
    const other = { ...worked, branch: 'openagent/other' }
    onAgentHandoff.mockImplementation((async (_project: string, agent: string) => (agent === 'run-1' ? worked : { ...other, prPending: true })) as never)
    let opened!: (answer: unknown) => void
    sendOpenPullRequest.mockReturnValue(new Promise(resolve => (opened = resolve)))
    const bar = render(<Harness />)
    fireEvent.click(await screen.findByText('Open PR'))
    bar.rerender(<Harness agentId="run-2" />)
    await waitFor(() => expect(onAgentHandoff).toHaveBeenLastCalledWith('p1', 'run-2'))
    await act(async () => opened({ ok: true, number: 3, url: 'https://example.test/3' }))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(screen.queryByRole('button', { name: 'Merge PR' })).toBeNull()
    // Answered while its own session shows, then another opened that still looks up its PR.
    cleanup()
    sendOpenPullRequest.mockResolvedValue({ ok: true, number: 4, url: 'https://example.test/4' })
    const again = render(<Harness />)
    fireEvent.click(await screen.findByText('Open PR'))
    expect(await screen.findByRole('button', { name: 'Merge PR' })).toBeTruthy()
    again.rerender(<Harness agentId="run-2" />)
    await waitFor(() => expect(onAgentHandoff).toHaveBeenLastCalledWith('p1', 'run-2'))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(screen.queryByRole('button', { name: 'Merge PR' })).toBeNull()
  })

  test('a merge left to wait for the checks says so, and is not offered again, after a reload too', async () => {
    const open = { number: 42, url: 'https://example.test/42', state: 'OPEN', title: 'Add dark mode' }
    onAgentHandoff.mockResolvedValue({ ...worked, pushed: true, pr: open })
    sendMerge.mockResolvedValue({ ok: true, number: 42, url: 'https://example.test/42', merge: 'auto-armed' })
    render(<Harness />)
    fireEvent.click(await screen.findByRole('button', { name: 'Merge PR' }))
    await waitFor(() => expect(document.querySelector('[aria-live="polite"]')!.textContent).toBe('PR #42 merges when its checks pass.'))
    expect(screen.queryByRole('button', { name: 'Merge PR' })).toBeNull()
    // The git host says it is armed: a page opened again, here or on another device, says so as well.
    cleanup()
    onAgentHandoff.mockResolvedValue({ ...worked, pushed: true, pr: { ...open, armed: true } })
    render(<Harness />)
    expect(await screen.findByText('PR #42 merges when its checks pass.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Merge PR' })).toBeNull()
  })

  test("a merge left to the provider's watcher is not offered again in this tab", async () => {
    onAgentHandoff.mockResolvedValue({ ...worked, pushed: true, pr: { number: 42, url: 'https://example.test/42', state: 'OPEN', title: 'Add dark mode' } })
    sendMerge.mockResolvedValue({ ok: true, number: 42, url: 'https://example.test/42', merge: 'watching' })
    render(<Harness />)
    fireEvent.click(await screen.findByRole('button', { name: 'Merge PR' }))
    await waitFor(() => expect(document.querySelector('[aria-live="polite"]')!.textContent).toBe('PR #42 merges when its checks pass.'))
    expect(screen.queryByRole('button', { name: 'Merge PR' })).toBeNull()
  })

  test('a failed merge says so in the bar\'s words, then the program\'s line', async () => {
    onAgentHandoff.mockResolvedValue({ ...worked, pushed: true, pr: { number: 42, url: 'https://example.test/42', state: 'OPEN', title: 'Add dark mode' } })
    sendMerge.mockResolvedValue({ ok: false, error: 'pull request 42 could not be landed: X Pull request o/r#42 is not mergeable' })
    render(<Harness />)
    fireEvent.click(await screen.findByRole('button', { name: 'Merge PR' }))
    await waitFor(() => expect(screen.getByText('Could not merge the pull request. pull request 42 could not be landed: X Pull request o/r#42 is not mergeable')).toBeTruthy())
  })

  test('after a press the focus stays in the bar: on its next press, else on the bar, never on the page', async () => {
    onAgentHandoff.mockResolvedValue({ ...worked, pushed: true, pr: { number: 42, url: 'https://example.test/42', state: 'OPEN', title: 'Add dark mode' } })
    sendMerge.mockResolvedValue({ ok: true, merge: 'merged' })
    render(
      <div role="group" aria-label="This session's work" tabIndex={-1}>
        <Harness />
      </div>,
    )
    const merge = await screen.findByRole('button', { name: 'Merge PR' })
    merge.focus()
    fireEvent.click(merge)
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Merge PR' })).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('group', { name: "This session's work" })))
    cleanup()
    // With a next press, the focus is on it.
    onAgentHandoff.mockResolvedValue(worked)
    sendOpenPullRequest.mockResolvedValue({ ok: true, number: 3, url: 'https://example.test/3' })
    render(
      <div role="group" aria-label="This session's work" tabIndex={-1}>
        <Harness />
      </div>,
    )
    const open = await screen.findByRole('button', { name: 'Open PR' })
    open.focus()
    fireEvent.click(open)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Merge PR' })))
  })

  test('an existing open PR withdraws the offer and becomes the Merge (#632/#1391)', async () => {
    onAgentHandoff.mockResolvedValue({
      ...worked,
      pushed: true,
      pr: { number: 42, url: 'https://example.test/42', state: 'OPEN', title: 'Add dark mode' },
    })
    render(<Harness />)
    await waitFor(() => expect(screen.getByText('Merge PR')).toBeTruthy())
    expect(screen.queryByText('Open PR')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Other choices' })).toBeNull()
    // The one step left for an open, unmerged PR is the human's Merge — the withheld-merge
    // ending (#1363) leaves exactly this behind when the agent never signalled.
    fireEvent.click(screen.getByText('Merge PR'))
    await waitFor(() => expect(sendMerge).toHaveBeenCalledWith('p1', 'run-1'))
  })

  test('more work after the pull request was opened: nothing while it is uncommitted, then the push that brings it to the PR, then the Merge', async () => {
    const pr = { number: 42, url: 'https://example.test/42', state: 'OPEN', title: 'Add dark mode' }
    // Asked for another change, the agent left it uncommitted: a merge would land the PR without it, and its commit is git-branches' step.
    onAgentHandoff.mockResolvedValue({ ...worked, pushed: true, pr, pendingFiles: ['index.html'] })
    const { container } = render(<Harness />)
    await waitFor(() => expect(onAgentHandoff).toHaveBeenCalled())
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(container.querySelector('button')).toBeNull()
    cleanup()

    // Committed: the branch is one commit past the pull request's head.
    const commits = [{ sha: 'bbbbbbb2', short: 'bbbbbbb', subject: 'a darker dark mode' }, ...worked.commits]
    const behind = { ...pr, headRefOid: 'aaaaaaa1' }
    onAgentHandoff.mockResolvedValue({ ...worked, commits, pushed: false, pr: behind })
    render(<Harness />)
    await waitFor(() => expect(screen.getByText('not in the PR yet')).toBeTruthy())
    expect(screen.queryByText('Merge PR')).toBeNull()
    expect(screen.queryByText('Open PR')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Update PR' }))
    await waitFor(() => expect(sendPush).toHaveBeenCalledWith('p1', 'run-1'))
    expect(sendOpenPullRequest).not.toHaveBeenCalled()
    cleanup()

    // Pushed: the pull request has everything, and its Merge is the step left.
    onAgentHandoff.mockResolvedValue({ ...worked, commits, pushed: true, pr: { ...pr, headRefOid: 'bbbbbbb2' } })
    render(<Harness />)
    await waitFor(() => expect(screen.getByText('Merge PR')).toBeTruthy())
    expect(screen.queryByText('not in the PR yet')).toBeNull()
  })

  test('a branch that differs from the remote because the remote moved has nothing to push: the Merge stays', async () => {
    const pr = { number: 42, url: 'https://example.test/42', state: 'OPEN', title: 'Add dark mode' }
    // The pull request was updated on the git host and this machine fetched it: its head is no commit of this branch.
    onAgentHandoff.mockResolvedValue({ ...worked, pushed: false, pr: { ...pr, headRefOid: 'ccccccc3' } })
    render(<Harness />)
    await waitFor(() => expect(screen.getByText('Merge PR')).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Update PR' })).toBeNull()
    cleanup()

    // A pull request read without its head, and one whose branch only the remote has: nothing is known to push.
    onAgentHandoff.mockResolvedValue({ ...worked, pushed: false, pr })
    render(<Harness />)
    await waitFor(() => expect(screen.getByText('Merge PR')).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Update PR' })).toBeNull()
    cleanup()
    onAgentHandoff.mockResolvedValue({ ...worked, exists: false, commits: [], files: [], empty: true, pushed: false, pr: { ...pr, headRefOid: 'aaaaaaa1' } })
    render(<Harness />)
    await waitFor(() => expect(screen.getByText('Merge PR')).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Update PR' })).toBeNull()
  })

  test('work committed after the pull request merged is offered a pull request of its own', async () => {
    const commits = [{ sha: 'bbbbbbb2', short: 'bbbbbbb', subject: 'a darker dark mode' }, ...worked.commits]
    onAgentHandoff.mockResolvedValue({
      ...worked,
      commits,
      pr: { number: 42, url: 'https://example.test/42', state: 'MERGED', title: 'Add dark mode', headRefOid: 'aaaaaaa1' },
      movedPastPr: true,
    })
    render(<Harness />)
    await waitFor(() => expect(screen.getByText('Open PR')).toBeTruthy())
    expect(screen.queryByText('Merge PR')).toBeNull()
    fireEvent.click(screen.getByText('Open PR'))
    await waitFor(() => expect(sendOpenPullRequest).toHaveBeenCalledWith('p1', 'run-1', { draft: false }))
  })

  test('a merged or closed PR offers nothing — landed is an answer, not an action (#1391)', async () => {
    onAgentHandoff.mockResolvedValue({
      ...worked,
      pushed: true,
      merged: true,
      pr: { number: 42, url: 'https://example.test/42', state: 'MERGED', title: 'Add dark mode' },
    })
    const { container } = render(<Harness />)
    await waitFor(() => expect(onAgentHandoff).toHaveBeenCalled())
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(container.querySelector('button')).toBeNull()
  })

  test('the bar has something to say for work, landed work and a lost branch, and nothing for an agent that changed nothing', () => {
    expect(handoffSays(null)).toBe(false)
    expect(handoffSays(worked as never)).toBe(true)
    // Nothing committed, nothing left on disk: nothing to say, merged into the base or not.
    expect(handoffSays({ ...worked, commits: [], files: [], empty: true, merged: true } as never)).toBe(false)
    expect(handoffSays({ ...worked, commits: [], files: [], empty: true, pendingFiles: ['index.html'] } as never)).toBe(true)
    // Commits that cancel out are still what the agent did.
    expect(handoffSays({ ...worked, files: [], empty: true } as never)).toBe(true)
    expect(handoffSays({ ...worked, exists: false, unchanged: true } as never)).toBe(false)
    expect(handoffSays({ ...worked, exists: false } as never)).toBe(true)
    expect(handoffSays({ ...worked, exists: false, landed: true } as never)).toBe(true)
  })

  test('a run started from another branch says what a pull request would carry over main, beside the button', async () => {
    onAgentHandoff.mockResolvedValue({ ...worked, carries: { base: 'origin/main', commits: 2, files: 43, insertions: 529, deletions: 0 } })
    render(<Harness />)
    await waitFor(() => expect(screen.getByText('43 files over main')).toBeTruthy())
    // The numbers themselves are the hover; the row says the one that matters.
    expect(screen.getByTitle("A pull request against main carries 2 commits · 43 files · +529 −0, this run's work among them.")).toBeTruthy()
    // Nothing is blocked by it: the button is where it was.
    expect(screen.getByText('Open PR')).toBeTruthy()
  })

  test('a run started from the branch the project starts from says nothing of the kind', async () => {
    onAgentHandoff.mockResolvedValue(worked)
    render(<Harness />)
    await waitFor(() => expect(screen.getByText('Open PR')).toBeTruthy())
    expect(screen.queryByText(/over main/)).toBeNull()
  })

  test("a run whose turn has just ended has its branch read every second, not every fifteen", async () => {
    // A clean run makes its own last commit as it cleans up, after its turn has ended: the read
    // taken the moment it ends answers for a branch with nothing on it yet, and waiting fifteen
    // seconds for the next one is what made the last step arrive late.
    onAgentHandoff.mockResolvedValue({ ...worked, commits: [], files: [], empty: true })
    const { rerender } = render(<Harness working />)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(onAgentHandoff).not.toHaveBeenCalled()
    rerender(<Harness />)
    await waitFor(() => expect(onAgentHandoff).toHaveBeenCalled())
    const reads = onAgentHandoff.mock.calls.length
    await waitFor(() => expect(onAgentHandoff.mock.calls.length).toBeGreaterThan(reads), { timeout: 2500 })
  })

  test('once the branch has something to say, it is back to the resting pace', async () => {
    onAgentHandoff.mockResolvedValue(worked)
    const { rerender } = render(<Harness working />)
    rerender(<Harness />)
    await waitFor(() => expect(screen.getByText('Open PR')).toBeTruthy())
    await new Promise(resolve => setTimeout(resolve, 100))
    const reads = onAgentHandoff.mock.calls.length
    await new Promise(resolve => setTimeout(resolve, 1500))
    expect(onAgentHandoff.mock.calls.length).toBe(reads)
  })

  test('nothing is rendered before the first read, so no wrong empty state flashes', () => {
    onAgentHandoff.mockReturnValue(new Promise(() => {}) as never)
    const { container } = render(<Harness />)
    expect(container.textContent).toBe('')
  })
  test('Merge PR pressed: the button says "Merging…" until the branch is read again, never "Merge PR" in between', async () => {
    const pr = { number: 42, url: 'https://example.test/42', state: 'OPEN', title: 'Add dark mode' }
    onAgentHandoff.mockResolvedValue({ ...worked, pushed: true, pr })
    render(<Harness />)
    fireEvent.click(await screen.findByRole('button', { name: 'Merge PR' }))
    // The merge is done; the read made after it has not answered yet.
    let answer: (handoff: unknown) => void = () => {}
    onAgentHandoff.mockReturnValue(new Promise(resolve => (answer = resolve)) as never)
    await waitFor(() => expect(sendMerge).toHaveBeenCalled())
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(screen.getByRole('button', { name: 'Merging…' })).toBeTruthy()
    answer({ ...worked, pushed: true, merged: true, pr: { ...pr, state: 'MERGED' } })
    await waitFor(() => expect(screen.queryByRole('button')).toBeNull())
  })
})
