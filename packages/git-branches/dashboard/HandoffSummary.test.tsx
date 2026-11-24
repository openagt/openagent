import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { forgetRemembered, type ModuleCallResult } from '@openagt/ui/module'
import { fakeHost, renderWithHost } from '@openagt/ui/module/testing'
import type { Handoff } from './calls.js'
import { HandoffSummary, RunSummary } from './HandoffSummary.js'

// What an ended session left on its branch, in the bar above its message box (`chat.summary`).

/** A session that did real work, on a repo with a remote, not pushed yet. */
const worked: Handoff = {
  branch: 'openagent/dark-mode',
  exists: true,
  base: 'origin/main',
  commits: [{ sha: 'a'.repeat(40), short: 'aaaaaaa', subject: 'add dark mode' }],
  files: [{ path: 'src/theme.ts', insertions: 12, deletions: 3, binary: false }],
  insertions: 12,
  deletions: 3,
  empty: false,
  hasRemote: true,
  pushed: false,
  merged: false,
}
const nothing = { commits: [], files: [], insertions: 0, deletions: 0, empty: true }

afterEach(() => {
  cleanup()
  forgetRemembered()
})

describe('HandoffSummary', () => {
  test('the size of the change, with how many commits and files as its hover; never the commits, the files or the branch name, which the bar already says (#1023)', () => {
    render(<HandoffSummary handoff={worked} />)
    expect(screen.getByLabelText('1 commit · 1 file')).toBeTruthy()
    expect(screen.getByText('+12')).toBeTruthy()
    expect(screen.getByText('−3')).toBeTruthy()
    // A screen reader says the pair in words, not as its signs.
    expect(screen.getByText('12 lines added, 3 removed')).toBeTruthy()
    expect(screen.queryByText('add dark mode')).toBeNull()
    expect(screen.queryByText('src/theme.ts')).toBeNull()
    expect(screen.queryByText('openagent/dark-mode')).toBeNull()
    cleanup()
    render(<HandoffSummary handoff={{ ...worked, pushed: true }} />)
    expect(screen.getByTitle('1 commit · 1 file · pushed')).toBeTruthy()
  })

  test('a count of none is not drawn: a run that only added lines says what it added', () => {
    render(<HandoffSummary handoff={{ ...worked, files: [{ path: 'src/login.ts', insertions: 1, deletions: 0, binary: false }], insertions: 1, deletions: 0 }} />)
    expect(screen.getByText('+1')).toBeTruthy()
    expect(screen.queryByText('−0')).toBeNull()
    expect(screen.getByText('1 line added')).toBeTruthy()
  })

  test('the words with no change to count: no changes, merged (not "no changes": its commits are all on the base), commits that cancel out, a branch gone', () => {
    const said = (handoff: Handoff) => {
      cleanup()
      return render(<HandoffSummary handoff={handoff} />).container.textContent
    }
    expect(said({ ...worked, ...nothing })).toBe('no changes')
    expect(said({ ...worked, ...nothing, pushed: true, merged: true })).toBe('merged')
    expect(said({ ...worked, files: [], insertions: 0, deletions: 0, empty: true })).toBe('1 commit·no change left')
    expect(said({ ...worked, exists: false })).toBe('branch gone')
    expect(said({ ...worked, exists: false, unchanged: true })).toBe('no changes')
  })

  test('nothing where the press beside it says it: files left uncommitted on an empty branch, and landed work whose branch went with it', () => {
    expect(render(<HandoffSummary handoff={{ ...worked, ...nothing, pendingFiles: ['index.html'] }} />).container.textContent).toBe('')
    cleanup()
    expect(render(<HandoffSummary handoff={{ ...worked, ...nothing, merged: true, pendingFiles: ['index.html'] }} />).container.textContent).toBe('')
    cleanup()
    expect(render(<HandoffSummary handoff={{ ...worked, exists: false, landed: true }} />).container.textContent).toBe('')
  })
})

describe('RunSummary', () => {
  test("the run's branch is read once the run has ended, and nothing is said while it works", async () => {
    const call = vi.fn(async (): Promise<ModuleCallResult> => ({ ok: true, output: worked }))
    const host = fakeHost('@openagt/git-branches', { call })
    const { container } = renderWithHost(<RunSummary projectId="p1" agentId="run-1" working />, host)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(call).not.toHaveBeenCalled()
    expect(container.textContent).toBe('')
    cleanup()
    renderWithHost(<RunSummary projectId="p1" agentId="run-1" working={false} />, host)
    await waitFor(() => expect(screen.getByLabelText('1 commit · 1 file')).toBeTruthy())
    expect(call).toHaveBeenCalledWith('p1', 'handoff', { agentId: 'run-1' })
  })
})
