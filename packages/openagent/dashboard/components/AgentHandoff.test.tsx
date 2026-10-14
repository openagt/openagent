import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { openMenu } from '../test-utils.js'

const onAgentHandoff = vi.fn(async () => null as unknown)
const sendOpenPullRequest = vi.fn(async () => ({ ok: true }) as unknown)
const sendMerge = vi.fn(async () => ({ ok: true }) as unknown)
const sendPush = vi.fn(async () => ({ ok: true }) as unknown)
const sendMergeBranch = vi.fn(async () => ({ ok: true }) as unknown)
const sendMessage = vi.fn(async () => ({ ok: true }) as unknown)
vi.mock('../rpc/reads.js', () => ({ onAgentHandoff }))
vi.mock('../rpc/control.js', () => ({ sendOpenPullRequest, sendMerge, sendPush, sendMergeBranch, sendMessage }))

const { HandoffActions, HandoffSummary } = await import('./AgentHandoff.js')
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

// The same composition AgentView uses: the verdict and the next step, side by side in one bar.
// `working`: the run's turn is going, so nothing is read and the answer read before it is dropped.
function Harness({ subagent = false, working = false }: { subagent?: boolean; working?: boolean }) {
  const state = useAgentHandoff('p1', 'run-1', !working, false, working)
  return (
    <>
      <HandoffSummary handoff={state.handoff} subagent={subagent} />
      {state.error && <span>{state.error}</span>}
      <HandoffActions projectId="p1" agentId="run-1" state={state} subagent={subagent} />
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
  sendMergeBranch.mockClear()
  sendMessage.mockClear()
  sendMessage.mockResolvedValue({ ok: true })
  sendMergeBranch.mockResolvedValue({ ok: true })
})
afterEach(cleanup)

describe('run handoff (#799)', () => {
  test('counts what a finished session produced and offers the next step, and lists neither the commits nor the files (#1023)', async () => {
    onAgentHandoff.mockResolvedValue(worked)
    render(<Harness />)
    // The chip is the size of the change; how many commits and files is its hover.
    await waitFor(() => expect(screen.getByLabelText('1 commit · 1 file')).toBeTruthy())
    expect(screen.getByText('+12')).toBeTruthy()
    expect(screen.getByText('−3')).toBeTruthy()
    // The commits and the files themselves are in the side panel's Changes tab.
    expect(screen.queryByText('add dark mode')).toBeNull()
    expect(screen.queryByText('src/theme.ts')).toBeNull()
    expect(screen.getByText('Open PR')).toBeTruthy()
  })

  test('the branch name is not repeated — the action bar it sits in already says it (#1023)', async () => {
    onAgentHandoff.mockResolvedValue(worked)
    render(<Harness />)
    await waitFor(() => expect(screen.getByLabelText('1 commit · 1 file')).toBeTruthy())
    expect(screen.queryByText('openagent/dark-mode')).toBeNull()
  })

  test('a session that changed nothing reads no changes and says nothing more', async () => {
    onAgentHandoff.mockResolvedValue({ ...worked, commits: [], files: [], insertions: 0, deletions: 0, empty: true })
    render(<Harness />)
    await waitFor(() => expect(screen.getByText('no changes')).toBeTruthy())
    // Nothing to hand off and nothing to do: no button and no sentence, since a run with work always
    // shows its button.
    expect(screen.queryByText('Open PR')).toBeNull()
    expect(screen.queryByText(/nothing to open|no PR to open/i)).toBeNull()
  })

  test('a merged branch says merged, not "no changes" — its commits are all on the base', async () => {
    // Merged implies empty: `base..branch` lists nothing once every commit landed. The two facts
    // must not read the same, since one means work shipped and the other means there was none.
    onAgentHandoff.mockResolvedValue({ ...worked, commits: [], files: [], insertions: 0, deletions: 0, empty: true, pushed: true, merged: true })
    render(<Harness />)
    await waitFor(() => expect(screen.getByText('merged')).toBeTruthy())
    expect(screen.queryByText('no changes')).toBeNull()
  })

  test('an empty branch with work waiting in the tree names the work, never a button (#1173)', async () => {
    onAgentHandoff.mockResolvedValue({
      ...worked,
      commits: [],
      files: [],
      insertions: 0,
      deletions: 0,
      empty: true,
      pendingFiles: ['index.html', 'src/app.ts'],
    })
    render(<Harness />)
    // A no-diff branch never gets the Open PR button — GitHub would refuse it with "No commits
    // between main and <branch>", the confusion this ticket started from. What is waiting is said
    // by name instead.
    await waitFor(() => expect(screen.getByText('Nothing committed — index.html, src/app.ts left uncommitted.')).toBeTruthy())
    expect(screen.queryByText('Open PR')).toBeNull()
    // Nothing is committed, so nothing is merged; and files were changed, so "no changes" is wrong too.
    expect(screen.queryByText('no changes')).toBeNull()
    expect(screen.queryByText('merged')).toBeNull()
    cleanup()
    // The same branch as git reports it: its last commit is in the main branch, so it reads merged.
    onAgentHandoff.mockResolvedValue({ ...worked, commits: [], files: [], insertions: 0, deletions: 0, empty: true, merged: true, pendingFiles: ['index.html'] })
    render(<Harness />)
    await waitFor(() => expect(screen.getByText('Nothing committed — index.html left uncommitted.')).toBeTruthy())
    expect(screen.queryByText('merged')).toBeNull()
  })

  test('uncommitted work gets a Commit button that asks the agent to commit; a subagent, and a branch with nothing left behind, get none', async () => {
    const left = { ...worked, commits: [], files: [], insertions: 0, deletions: 0, empty: true, pendingFiles: ['index.html'] }
    onAgentHandoff.mockResolvedValue(left)
    render(<Harness />)
    fireEvent.click(await screen.findByRole('button', { name: 'Commit' }))
    // The agent is asked: it writes the commit, the dashboard commits nothing itself.
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith('p1', 'Commit your work.', 'run-1'))
    cleanup()

    sendMessage.mockClear()
    sendMessage.mockResolvedValue({ ok: false, error: 'this project has no resume hook' })
    render(<Harness />)
    fireEvent.click(await screen.findByRole('button', { name: 'Commit' }))
    await waitFor(() => expect(screen.getByText(/this project has no resume hook/)).toBeTruthy())
    cleanup()

    onAgentHandoff.mockResolvedValue({ ...left, pendingFiles: [] })
    render(<Harness />)
    await waitFor(() => expect(onAgentHandoff).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Commit' })).toBeNull()
    cleanup()

    onAgentHandoff.mockResolvedValue(left)
    render(<Harness subagent />)
    await waitFor(() => expect(screen.getByText('Nothing committed — index.html left uncommitted.')).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Commit' })).toBeNull()
  })

  test('uncommitted work on top of commits gets Commit first: no merge, no publish, until the checkout is clean', async () => {
    // The agent committed, was asked for more, and left that uncommitted.
    onAgentHandoff.mockResolvedValue({ ...worked, hasRemote: false, base: 'main', pendingFiles: ['index.html'] })
    render(<Harness />)
    await waitFor(() => expect(screen.getByText('index.html left uncommitted.')).toBeTruthy())
    expect(screen.queryByText(/Nothing committed/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Merge' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Commit' }))
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith('p1', 'Commit your work.', 'run-1'))
    cleanup()

    // With a remote and a git host too: Commit, not Open PR.
    onAgentHandoff.mockResolvedValue({ ...worked, pendingFiles: ['index.html'] })
    render(<Harness />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Commit' })).toBeTruthy())
    expect(screen.queryByText('Open PR')).toBeNull()
    cleanup()

    // Clean again: the next step is back.
    onAgentHandoff.mockResolvedValue({ ...worked, hasRemote: false, base: 'main' })
    render(<Harness />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Merge' })).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Commit' })).toBeNull()
  })

  test('commits that cancel out are still counted, and the bar says there is nothing to take', async () => {
    const cancelled = { ...worked, hasRemote: false, base: 'main', commits: [{ sha: 'a'.repeat(40), short: 'aaaaaaa', subject: 'Change to welcome' }, { sha: 'b'.repeat(40), short: 'bbbbbbb', subject: 'Change back to hello' }], files: [], insertions: 0, deletions: 0, empty: true }
    onAgentHandoff.mockResolvedValue(cancelled)
    render(<Harness />)
    await waitFor(() => expect(screen.getByText('2 commits · no change left')).toBeTruthy())
    expect(screen.getByText('Nothing to merge: the commits cancel out.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Merge' })).toBeNull()
    cleanup()

    onAgentHandoff.mockResolvedValue({ ...cancelled, hasRemote: true })
    render(<Harness />)
    await waitFor(() => expect(screen.getByText('Nothing to publish: the commits cancel out.')).toBeTruthy())
    cleanup()

    // No commits at all is still "no changes", with nothing said where the button would be.
    onAgentHandoff.mockResolvedValue({ ...cancelled, commits: [] })
    render(<Harness />)
    await waitFor(() => expect(screen.getByText('no changes')).toBeTruthy())
    expect(screen.queryByText(/cancel out/)).toBeNull()
  })

  test('past two uncommitted files the rest are counted, and the hover carries them all (#1173)', async () => {
    const pendingFiles = ['a.ts', 'b.ts', 'c.ts', 'd.ts']
    onAgentHandoff.mockResolvedValue({ ...worked, commits: [], files: [], insertions: 0, deletions: 0, empty: true, pendingFiles })
    render(<Harness />)
    const reason = await screen.findByText('Nothing committed — a.ts, b.ts and 2 more left uncommitted.')
    expect(reason.getAttribute('title')).toBe(pendingFiles.join('\n'))
  })

  test('a branch that is gone is reported, not shown as work', async () => {
    onAgentHandoff.mockResolvedValue({ ...worked, exists: false, commits: [], files: [], empty: true })
    render(<Harness />)
    await waitFor(() => expect(screen.getByText('branch gone')).toBeTruthy())
    expect(screen.queryByText('Open PR')).toBeNull()
    expect(screen.getByText('Branch gone — nothing to open a PR from.')).toBeTruthy()
  })

  test('a branch gone because the run changed nothing reads as no changes, not as lost work', async () => {
    onAgentHandoff.mockResolvedValue({ ...worked, exists: false, unchanged: true, commits: [], files: [], empty: true })
    render(<Harness />)
    await waitFor(() => expect(screen.getByText('no changes')).toBeTruthy())
    expect(screen.queryByText(/nothing to open|no PR to open/i)).toBeNull()
    expect(screen.queryByText(/Branch gone/i)).toBeNull()
  })

  test('a split button: Open PR pushes and opens the pull request, and its menu holds the push alone', async () => {
    onAgentHandoff.mockResolvedValue(worked)
    render(<Harness />)
    await waitFor(() => expect(screen.getByText('Open PR')).toBeTruthy())
    // The push alone is in the menu, never a second button beside the first (#1173).
    expect(screen.queryByText('Publish branch')).toBeNull()
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
    // The branch is on the remote already: the push alone is no choice any more.
    expect(screen.queryByText('Publish branch')).toBeNull()
  })

  test('Publish branch, in the menu, pushes the branch and opens no pull request', async () => {
    onAgentHandoff.mockResolvedValue(worked)
    render(<Harness />)
    await openMenu(await screen.findByRole('button', { name: 'Other choices' }))
    fireEvent.click(await screen.findByText('Publish branch'))
    await waitFor(() => expect(sendPush).toHaveBeenCalledWith('p1', 'run-1'))
    expect(sendOpenPullRequest).not.toHaveBeenCalled()
  })

  test('a failed action surfaces its reason rather than doing nothing', async () => {
    onAgentHandoff.mockResolvedValue(worked)
    sendOpenPullRequest.mockResolvedValue({ ok: false, error: 'gh: not logged in' })
    render(<Harness />)
    await waitFor(() => expect(screen.getByText('Open PR')).toBeTruthy())
    fireEvent.click(screen.getByText('Open PR'))
    await waitFor(() => expect(screen.getByText('gh: not logged in')).toBeTruthy())
  })

  test('an existing open PR withdraws the offer and becomes the Merge (#632/#1391)', async () => {
    onAgentHandoff.mockResolvedValue({
      ...worked,
      pushed: true,
      pr: { number: 42, url: 'https://example.test/42', state: 'OPEN', title: 'Add dark mode' },
    })
    render(<Harness />)
    await waitFor(() => expect(screen.getByLabelText('1 commit · 1 file')).toBeTruthy())
    expect(screen.queryByText('Open PR')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Other choices' })).toBeNull()
    // The bar links the pull request: pushed is not part of what the chip says.
    expect(screen.queryByLabelText(/pushed/)).toBeNull()
    // The one step left for an open, unmerged PR is the human's Merge — the withheld-merge
    // ending (#1363) leaves exactly this behind when the agent never signalled.
    fireEvent.click(screen.getByText('Merge PR'))
    await waitFor(() => expect(sendMerge).toHaveBeenCalledWith('p1', 'run-1'))
  })

  test('more work after the pull request was opened: Commit first, then the push that brings it to the PR, then the Merge', async () => {
    const pr = { number: 42, url: 'https://example.test/42', state: 'OPEN', title: 'Add dark mode' }
    // Asked for another change, the agent left it uncommitted: a merge would land the PR without it.
    onAgentHandoff.mockResolvedValue({ ...worked, pushed: true, pr, pendingFiles: ['index.html'] })
    render(<Harness />)
    await waitFor(() => expect(screen.getByText('index.html left uncommitted.')).toBeTruthy())
    expect(screen.queryByText('Merge PR')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Commit' }))
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith('p1', 'Commit your work.', 'run-1'))
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
    render(<Harness />)
    await waitFor(() => expect(screen.getByLabelText('1 commit · 1 file')).toBeTruthy())
    expect(screen.queryByText('Merge PR')).toBeNull()
    expect(screen.queryByText('Open PR')).toBeNull()
  })

  test('with no git host package the last step is Publish branch, one plain button, and a pushed branch is where the handoff ends (#1820)', async () => {
    onAgentHandoff.mockResolvedValue({ ...worked, gitHost: false })
    render(<Harness />)
    await waitFor(() => expect(screen.getByText('Publish branch')).toBeTruthy())
    expect(screen.queryByText('Open PR')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Other choices' })).toBeNull()
    fireEvent.click(screen.getByText('Publish branch'))
    await waitFor(() => expect(sendPush).toHaveBeenCalledWith('p1', 'run-1'))
    cleanup()
    onAgentHandoff.mockResolvedValue({ ...worked, gitHost: false, pushed: true })
    render(<Harness />)
    await waitFor(() => expect(screen.getByText(/Pushed — no git host package/)).toBeTruthy())
    expect(screen.queryByText('Publish branch')).toBeNull()
  })

  test('a repo with no remote offers the one step it has: merge the work into the main branch, on this machine', async () => {
    onAgentHandoff.mockResolvedValue({ ...worked, hasRemote: false, base: 'main' })
    render(<Harness />)
    await waitFor(() => expect(screen.getByText('Not in main yet.')).toBeTruthy())
    expect(screen.queryByText(/Open PR|Publish branch/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }))
    await waitFor(() => expect(sendMergeBranch).toHaveBeenCalledWith('p1', 'run-1'))
    expect(sendPush).not.toHaveBeenCalled()
  })

  test('a merge that does not go in shows the reason; merged work says so and offers nothing more', async () => {
    onAgentHandoff.mockResolvedValue({ ...worked, hasRemote: false, base: 'main' })
    sendMergeBranch.mockResolvedValue({ ok: false, error: 'agent-x does not merge cleanly into main: it conflicts in a.ts; nothing was changed' })
    render(<Harness />)
    fireEvent.click(await screen.findByRole('button', { name: 'Merge' }))
    await waitFor(() => expect(screen.getByText(/does not merge cleanly into main/)).toBeTruthy())
    cleanup()

    // Its branch went with the merge: the record says landed.
    onAgentHandoff.mockResolvedValue({ ...worked, hasRemote: false, landed: true, merged: true })
    render(<Harness />)
    await waitFor(() => expect(screen.getByText('Merged into the main branch.')).toBeTruthy())
    expect(screen.queryByRole('button', { name: /Merge/ })).toBeNull()
    cleanup()

    // A branch that was kept and is in the main branch already.
    onAgentHandoff.mockResolvedValue({ ...worked, hasRemote: false, base: 'main', merged: true })
    render(<Harness />)
    await waitFor(() => expect(screen.getByText('Merged into main.')).toBeTruthy())
    expect(screen.queryByRole('button', { name: /Merge/ })).toBeNull()
    cleanup()

    // With a remote too: work the main branch already has keeps its count and is offered no publish step.
    onAgentHandoff.mockResolvedValue({ ...worked, base: 'a'.repeat(40), merged: true })
    render(<Harness />)
    await waitFor(() => expect(screen.getByText('Merged into the main branch.')).toBeTruthy())
    expect(screen.queryByRole('button', { name: /Open PR|Publish branch|Merge/ })).toBeNull()
  })

  test('work still only on this machine is said by the button that publishes it; once pushed the chip says pushed; with no remote it says neither', async () => {
    onAgentHandoff.mockResolvedValue(worked)
    render(<Harness />)
    // The button names the step that has not happened yet, so no word beside it repeats it.
    await waitFor(() => expect(screen.getByText('Open PR')).toBeTruthy())
    expect(screen.queryByText('not published')).toBeNull()
    cleanup()

    // No git host package: the same, beside Publish branch.
    onAgentHandoff.mockResolvedValue({ ...worked, gitHost: false })
    render(<Harness />)
    await waitFor(() => expect(screen.getByText('Publish branch')).toBeTruthy())
    expect(screen.queryByText('not published')).toBeNull()
    cleanup()

    onAgentHandoff.mockResolvedValue({ ...worked, pushed: true })
    render(<Harness />)
    await waitFor(() => expect(screen.getByLabelText('1 commit · 1 file · pushed')).toBeTruthy())
    cleanup()

    onAgentHandoff.mockResolvedValue({ ...worked, hasRemote: false })
    render(<Harness />)
    await waitFor(() => expect(screen.getByLabelText('1 commit · 1 file')).toBeTruthy())
  })

  test('a subagent is offered no pull request, no push and no merge: its line says whether its main agent landed it', async () => {
    onAgentHandoff.mockResolvedValue({ ...worked, pushed: true })
    render(<Harness subagent />)
    await waitFor(() => expect(screen.getByText('not landed')).toBeTruthy())
    // A subagent's work is its main agent's to land, so the chip never says pushed.
    expect(screen.getByLabelText('1 commit · 1 file')).toBeTruthy()
    expect(screen.queryByText('not published')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    cleanup()

    // Not even where another run would be offered the Merge of its open pull request, or a Push.
    onAgentHandoff.mockResolvedValue({ ...worked, pr: { number: 7, url: 'u', state: 'OPEN', title: '' } })
    render(<Harness subagent />)
    await waitFor(() => expect(screen.getByText('not landed')).toBeTruthy())
    expect(screen.queryByRole('button')).toBeNull()
    cleanup()
    onAgentHandoff.mockResolvedValue({ ...worked, gitHost: false })
    render(<Harness subagent />)
    await waitFor(() => expect(screen.getByText('not landed')).toBeTruthy())
    expect(screen.queryByRole('button')).toBeNull()
  })

  test('a landed subagent still says what it changed, and that it is landed', async () => {
    onAgentHandoff.mockResolvedValue({ ...worked, branch: 'a'.repeat(40), landed: true })
    render(<Harness subagent />)
    await waitFor(() => expect(screen.getByText('landed')).toBeTruthy())
    expect(screen.getByLabelText('1 commit · 1 file')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    cleanup()

    // Its last commit is not on this machine: landed is still the answer, never "branch gone".
    onAgentHandoff.mockResolvedValue({ ...worked, exists: false, commits: [], files: [], empty: true, landed: true })
    render(<Harness subagent />)
    await waitFor(() => expect(screen.getByText('landed')).toBeTruthy())
    expect(screen.queryByText('branch gone')).toBeNull()
    expect(screen.queryByText('no changes')).toBeNull()
    expect(screen.queryByText(/nothing to open a PR from/)).toBeNull()
  })

  test('a subagent that ended without committing has its uncommitted work named, and its gone branch draws no reason', async () => {
    onAgentHandoff.mockResolvedValue({ ...worked, commits: [], files: [], empty: true, pendingFiles: ['handtest/one.md'] })
    render(<Harness subagent />)
    await waitFor(() => expect(screen.getByText('Nothing committed — handtest/one.md left uncommitted.')).toBeTruthy())
    // A file was changed and left on disk: "no changes" beside it would say the opposite.
    expect(screen.queryByText('no changes')).toBeNull()
    expect(screen.queryByText('not landed')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    cleanup()

    onAgentHandoff.mockResolvedValue({ ...worked, exists: false, commits: [], files: [], empty: true })
    render(<Harness subagent />)
    await waitFor(() => expect(screen.getByText('branch gone')).toBeTruthy())
    expect(screen.queryByText(/nothing to open a PR from/)).toBeNull()
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
    // Nothing is blocked by it: the button is where it was, and the run's own work is still counted.
    expect(screen.getByText('Open PR')).toBeTruthy()
    expect(screen.getByLabelText('1 commit · 1 file')).toBeTruthy()
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
  test('Merge pressed: the button says "Merging…" until the branch is read again, never "Merge" in between', async () => {
    onAgentHandoff.mockResolvedValue({ ...worked, hasRemote: false, gitHost: false })
    render(<Harness />)
    fireEvent.click(await screen.findByRole('button', { name: 'Merge' }))
    // The merge is done; the read made after it has not answered yet.
    let answer: (handoff: unknown) => void = () => {}
    onAgentHandoff.mockReturnValue(new Promise(resolve => (answer = resolve)) as never)
    await waitFor(() => expect(sendMergeBranch).toHaveBeenCalled())
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(screen.getByRole('button', { name: 'Merging…' })).toBeTruthy()
    answer({ ...worked, hasRemote: false, gitHost: false, landed: true })
    await waitFor(() => expect(screen.getByText('Merged into the main branch.')).toBeTruthy())
    expect(screen.queryByRole('button')).toBeNull()
  })
})
