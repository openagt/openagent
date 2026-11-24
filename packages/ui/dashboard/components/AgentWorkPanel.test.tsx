import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { forgetRemembered } from '../lib/use-async.js'
import { openMenu } from '../test-utils.js'

const onAgentHandoff = vi.fn(async () => null as unknown)
const onAgentCopies = vi.fn(async () => [] as string[])
const sendOpenPullRequest = vi.fn(async () => ({ ok: true }) as unknown)
const sendMerge = vi.fn(async () => ({ ok: true }) as unknown)
const sendPush = vi.fn(async () => ({ ok: true }) as unknown)
const sendMergeBranch = vi.fn(async () => ({ ok: true }) as unknown)
const sendMessage = vi.fn(async () => ({ ok: true }) as unknown)
const sendBringBranch = vi.fn(async () => ({ ok: true }) as unknown)
vi.mock('../rpc/reads.js', () => ({ onAgentHandoff, onAgentCopies }))
vi.mock('../rpc/control.js', () => ({ sendOpenPullRequest, sendMerge, sendPush, sendMergeBranch, sendMessage, sendBringBranch }))

const { AgentWorkPanel, CopyWorkRow, ProjectWorkRow, WorkRow, useAgentCopies } = await import('./AgentWorkPanel.js')

/** A copy that holds one commit, on a repo with a remote and no pull request yet. */
const worked = {
  branch: 'agent-fix-footer',
  exists: true,
  base: 'origin/main',
  commits: [{ sha: 'aaaaaaa1', short: 'aaaaaaa', subject: 'fix the footer' }],
  files: [{ path: 'src/footer.ts', insertions: 15, deletions: 3, binary: false }],
  insertions: 15,
  deletions: 3,
  empty: false,
  hasRemote: true,
  pushed: false,
  merged: false,
  gitHost: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  onAgentHandoff.mockResolvedValue(null)
  sendOpenPullRequest.mockResolvedValue({ ok: true })
})
afterEach(() => {
  cleanup()
  forgetRemembered()
})

const copyRow = (over: Partial<Parameters<typeof CopyWorkRow>[0]> = {}) => <CopyWorkRow projectId="p1" agentId="run-1" repo="oa-newuser" ended saving={false} working={false} committing={false} {...over} />

describe('the session\'s work panel', () => {
  test('a row says the repo, and under it its branch, what it holds and its pull request; its next step stands at its end', () => {
    render(
      <AgentWorkPanel>
        <WorkRow project name="test-project" branch="agent-fix-footer" summary={<span>+42 −7</span>} pr={{ number: 45, url: 'https://github.com/o/r/pull/45', state: 'OPEN', title: 'Fix the footer' }} actions={<button type="button">Merge PR</button>} />
        <WorkRow name="oa-newuser" branch="agent-fix-footer" summary={<span>+15 −3</span>} actions={<button type="button">Open PR</button>} error="Could not open the pull request." />
      </AgentWorkPanel>,
    )
    const panel = screen.getByRole('group', { name: "This session's work" })
    const [project, copy] = within(panel).getAllByRole('listitem')
    expect(project!.getAttribute('aria-label')).toBe('test-project: its work')
    expect(within(project!).getByText('test-project')).toBeTruthy()
    expect(within(project!).getByText('+42 −7')).toBeTruthy()
    expect(within(project!).getByRole('link', { name: /PR #45/ }).getAttribute('href')).toBe('https://github.com/o/r/pull/45')
    expect(within(project!).getByRole('button', { name: 'Merge PR' })).toBeTruthy()
    expect(within(copy!).getByText('oa-newuser')).toBeTruthy()
    expect(within(copy!).queryByRole('link')).toBeNull()
    expect(within(copy!).getByRole('button', { name: 'Open PR' })).toBeTruthy()
    expect(within(copy!).getByRole('alert').textContent).toBe('Could not open the pull request.')
  })

  test('with no row the panel holds nothing: a project with nothing to say, or no branch, has no row', () => {
    render(
      <AgentWorkPanel>
        <ProjectWorkRow name="test-project" checkout={{ branch: 'agent-x' }} show={false} />
        <ProjectWorkRow name="test-project" checkout={null} show />
      </AgentWorkPanel>,
    )
    expect(screen.getByRole('group', { name: "This session's work" }).querySelector('ul')!.childElementCount).toBe(0)
    cleanup()
    render(
      <AgentWorkPanel>
        <ProjectWorkRow checkout={{ branch: 'agent-x' }} show />
      </AgentWorkPanel>,
    )
    expect(screen.getByText('This project')).toBeTruthy()
  })

  test("a copy's row reads the copy's own branch and offers its next step, which acts on that copy", async () => {
    onAgentHandoff.mockResolvedValue(worked)
    render(<AgentWorkPanel>{copyRow()}</AgentWorkPanel>)
    const row = await screen.findByRole('listitem')
    expect(onAgentHandoff).toHaveBeenCalledWith('p1', 'run-1', 'oa-newuser')
    expect(within(row).getByText('oa-newuser')).toBeTruthy()
    fireEvent.click(within(row).getByText('Open PR'))
    await waitFor(() => expect(sendOpenPullRequest).toHaveBeenCalledWith('p1', 'run-1', { draft: false, repo: 'oa-newuser' }))
  })

  test('a copy with no work has no row, and neither has one of a run still going; one with no remote says its work stays in it', async () => {
    onAgentHandoff.mockResolvedValue({ ...worked, commits: [], files: [], insertions: 0, deletions: 0, empty: true })
    render(<AgentWorkPanel>{copyRow()}</AgentWorkPanel>)
    await waitFor(() => expect(onAgentHandoff).toHaveBeenCalled())
    expect(screen.queryByRole('listitem')).toBeNull()
    cleanup()
    forgetRemembered()
    onAgentHandoff.mockClear()
    onAgentHandoff.mockResolvedValue(worked)
    render(<AgentWorkPanel>{copyRow({ ended: false, working: true })}</AgentWorkPanel>)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(onAgentHandoff).not.toHaveBeenCalled()
    expect(screen.queryByRole('listitem')).toBeNull()
    cleanup()
    forgetRemembered()
    onAgentHandoff.mockResolvedValue({ ...worked, hasRemote: false })
    render(<AgentWorkPanel>{copyRow()}</AgentWorkPanel>)
    expect(await screen.findByText('No remote: the work stays in this copy.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Merge' })).toBeNull()
  })

  test("a copy with no remote goes back to the folder it was copied from: Merge merges it into that folder's main, its arrow only adds the branch", async () => {
    const local = { ...worked, base: 'main', hasRemote: false, gitHost: false, copiedFrom: { path: '/me/app', hasBranch: false } }
    onAgentHandoff.mockResolvedValue(local)
    render(<AgentWorkPanel>{copyRow()}</AgentWorkPanel>)
    expect(await screen.findByText('Not in main yet.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }))
    await waitFor(() => expect(sendBringBranch).toHaveBeenCalledWith('p1', 'run-1', 'oa-newuser', { merge: true }))
    expect(sendMergeBranch).not.toHaveBeenCalled()
    expect(await screen.findByText('Merged into main in /me/app.')).toBeTruthy()
    cleanup()
    forgetRemembered()
    sendBringBranch.mockClear()
    render(<AgentWorkPanel>{copyRow()}</AgentWorkPanel>)
    await openMenu(await screen.findByRole('button', { name: 'Other choices' }))
    fireEvent.click(await screen.findByText('Only add the branch'))
    await waitFor(() => expect(sendBringBranch).toHaveBeenCalledWith('p1', 'run-1', 'oa-newuser', {}))
    // The folder has the branch now: the merge is the one step left.
    expect(await screen.findByText('In /me/app, not in main yet.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Merge' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Other choices' })).toBeNull()
  })

  test("the session's copies are asked of its folder, by the run", async () => {
    onAgentCopies.mockResolvedValue(['oa-newuser', 'recipe-box'])
    function Names() {
      return <span data-testid="names">{useAgentCopies('p1', 'run-1', false).join(',')}</span>
    }
    render(<Names />)
    await waitFor(() => expect(screen.getByTestId('names').textContent).toBe('oa-newuser,recipe-box'))
    expect(onAgentCopies).toHaveBeenCalledWith('p1', 'run-1')
  })
})
