import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import { forgetRemembered, type ModuleCallResult, type UiRunProps, type UiWorkProps } from '@openagt/ui/module'
import { fakeHost, hoverTooltip, mountedOf, renderWithHost, type MountedAction, type MountedView } from '@openagt/ui/module/testing'
import type { Handoff, Worktree } from './calls.js'
import { ProjectRow } from './ProjectRow.js'

// The project's row in the panel of a session's work above its message box (`chat.work`): when it
// is there, what it says, and the next steps it offers, read off git-branches' server part.

/** A branch with a commit of its own, pushed: what a next step is offered for. */
const PUSHED: Handoff = {
  branch: 'agent-add-hello2',
  exists: true,
  commits: [{ sha: 'a'.repeat(40), short: 'aaaaaaa', subject: 'Add hello2.txt' }],
  files: [{ path: 'hello2.txt', insertions: 1, deletions: 0, binary: false }],
  insertions: 1,
  deletions: 0,
  empty: false,
  hasRemote: true,
  pushed: true,
  merged: false,
}
const NOTHING = { commits: [], files: [], insertions: 0, deletions: 0, empty: true }

let worktree: Worktree | null
let handoff: Handoff | null | Promise<Handoff | null>
const call = vi.fn(async (_projectId: string, name: string): Promise<ModuleCallResult> => {
  if (name === 'worktree') return { ok: true, output: worktree }
  if (name === 'handoff') return { ok: true, output: await handoff }
  if (name === 'committing') return { ok: true, output: false }
  return { ok: false, error: `no ${name} here` }
})
const host = fakeHost('@openagt/git-branches', { call: call as never })
const reads = (name: string) => call.mock.calls.filter(([, called]) => called === name)

/** A module's next step for the run's work (`chat.handoff`), offered whenever it is asked. */
const step: MountedAction<'chat.handoff'> = { place: 'chat.handoff', id: 'step', label: 'Next step', run: async () => ({ ok: true }), package: '@me/steps', module: 'steps', projects: ['p1'] }
/** Another module's words in the row while the run works (`chat.summary`). */
const Summary = ({ agentId, working }: UiRunProps) => <span>summary {agentId} {String(working)}</span>
const summary = (projects: string[]): MountedView<'chat.summary'> => ({ place: 'chat.summary', id: 'changes', View: Summary, package: '@me/changes', projects })
const modules = mountedOf({ actions: { 'chat.handoff': [step] }, views: { 'chat.summary': [summary(['p1'])] } })

const ENDED = { working: false, ended: true, saving: false }
const WORKING = { working: true, ended: false, saving: false }
// Each test's own run: what was read of one run's branch answers every place that asks within a second.
let runs = 0
let id = ''
const props = (over: Partial<UiWorkProps> = {}): UiWorkProps => ({ projectId: 'p1', agentId: id, ...ENDED, ...over })
const draw = (over: Partial<UiWorkProps> = {}) => renderWithHost(<ProjectRow {...props(over)} />, host, modules)
const row = () => screen.queryByRole('group', { name: /: its work$/ })
const settle = () => new Promise(resolve => setTimeout(resolve, 30))

beforeEach(() => {
  id = `run-${++runs}`
  worktree = { branch: 'agent-x' }
  handoff = null
})
afterEach(() => {
  cleanup()
  forgetRemembered()
  call.mockClear()
})

describe('while the agent works', () => {
  test('the row comes once its checkout holds changes, and stays once it committed: its checkout is clean again', async () => {
    worktree = { branch: 'agent-x', checkout: { path: '/w', dirty: false } }
    const first = draw(WORKING)
    await waitFor(() => expect(reads('worktree')).toHaveLength(1))
    await settle()
    expect(row()).toBeNull()
    first.unmount()
    worktree = { branch: 'agent-y', checkout: { path: '/w', dirty: true } }
    const { rerender } = draw({ ...WORKING, agentId: `${id}-b`, projectName: 'shop' })
    await waitFor(() => expect(row()).toBeTruthy())
    expect(row()!.getAttribute('aria-label')).toBe('shop: its work')
    expect((await hoverTooltip(within(row()!).getByText(/^This project|^shop/))).textContent).toContain('agent-y')
    expect(call).toHaveBeenCalledWith('p1', 'worktree', { agentId: `${id}-b` })
    // No branch is read while the run is still writing it.
    expect(reads('handoff')).toHaveLength(0)
    worktree = { branch: 'agent-y', checkout: { path: '/w', dirty: false } }
    rerender(<ProjectRow {...props({ ...WORKING, agentId: `${id}-b` })} />)
    await settle()
    expect(row()).toBeTruthy()
  })

  test('a checkout read that comes back with no branch, as one taken while the checkout is removed, leaves the row the branch it said', async () => {
    worktree = { branch: 'agent-y', checkout: { path: '/w', dirty: true } }
    const { rerender } = draw(WORKING)
    await waitFor(() => expect(row()).toBeTruthy())
    worktree = null
    rerender(<ProjectRow {...props({ working: false, ended: false })} />)
    await waitFor(() => expect(reads('worktree')).toHaveLength(2))
    await settle()
    expect((await hoverTooltip(within(row()!).getByText(/^This project|^shop/))).textContent).toContain('agent-y')
  })

  test('its checkout is read again the moment its turn ends, not at the next poll', async () => {
    worktree = { branch: 'agent-x', checkout: { path: '/w', dirty: false } }
    const { rerender } = draw(WORKING)
    await waitFor(() => expect(reads('worktree')).toHaveLength(1))
    worktree = { branch: 'agent-x', checkout: { path: '/w', dirty: true } }
    rerender(<ProjectRow {...props({ working: false, ended: false })} />)
    await waitFor(() => expect(reads('worktree')).toHaveLength(2))
  })

  test("a run with a pull request has its row, the request in it; the modules' words are said in it, and not the branch's", async () => {
    draw({ ...WORKING, pr: { number: 4, url: 'https://x/pull/4', state: 'open', title: 'T' } })
    await waitFor(() => expect(row()).toBeTruthy())
    expect(within(row()!).getByRole('link', { name: '#4' }).getAttribute('href')).toBe('https://x/pull/4')
    expect(within(row()!).getByText(`summary ${id} true`)).toBeTruthy()
    expect(within(row()!).queryByRole('button', { name: 'Next step' })).toBeNull()
  })

  test('a project without the module that says words gets none of them', async () => {
    renderWithHost(<ProjectRow {...props({ ...WORKING, pr: { number: 4, url: 'https://x/pull/4' } })} />, host, mountedOf({ views: { 'chat.summary': [summary(['p2'])] } }))
    await waitFor(() => expect(row()).toBeTruthy())
    expect(screen.queryByText(/^summary/)).toBeNull()
  })
})

describe('once the agent has ended', () => {
  test('a run that changed nothing has no row; one with a pull request has it', async () => {
    handoff = { ...PUSHED, ...NOTHING }
    const first = draw()
    await waitFor(() => expect(reads('handoff')).toHaveLength(1))
    await settle()
    expect(row()).toBeNull()
    first.unmount()
    draw({ agentId: `${id}-b`, pr: { number: 3, url: 'https://x/pull/3', state: 'open' } })
    await waitFor(() => expect(row()).toBeTruthy())
  })

  test('what the branch holds replaces the words said while it worked, and its next step is offered beside it', async () => {
    handoff = PUSHED
    draw()
    expect(await screen.findByRole('button', { name: 'Next step' })).toBeTruthy()
    expect(within(row()!).getByLabelText('1 commit · 1 file · pushed')).toBeTruthy()
    expect(screen.queryByText(/^summary/)).toBeNull()
    expect(call).toHaveBeenCalledWith('p1', 'handoff', { agentId: id })
  })

  test('a run whose pull request is merged has no row from the first frame', async () => {
    handoff = PUSHED
    const seen = new Set<boolean>()
    const watch = new MutationObserver(() => seen.add(row() !== null))
    watch.observe(document.body, { subtree: true, childList: true })
    draw({ pr: { number: 3, url: 'https://x/pull/3', state: 'merged' } })
    await waitFor(() => expect(reads('handoff')).toHaveLength(1))
    await settle()
    watch.disconnect()
    seen.add(row() !== null)
    expect([...seen]).toEqual([false])
  })

  test('as the agent ends, the row stays while its branch is read, then says what the branch holds', async () => {
    worktree = { branch: 'agent-x', checkout: { path: '/w', dirty: true } }
    let answer: (read: Handoff) => void = () => {}
    handoff = new Promise(resolve => (answer = resolve))
    const { rerender } = draw(WORKING)
    await waitFor(() => expect(row()).toBeTruthy())
    // Ended: its checkout is gone, its branch not read yet.
    worktree = { branch: 'agent-x' }
    rerender(<ProjectRow {...props()} />)
    await settle()
    expect(row()).toBeTruthy()
    answer(PUSHED)
    expect(await screen.findByRole('button', { name: 'Next step' })).toBeTruthy()
  })

  test("a branch read taken before the run's own last commit never takes the row away again, and the next read comes within seconds", async () => {
    // The blink: a clean run commits what it was holding as it cleans up, after its turn has
    // ended, so the read taken the moment the run ends answers for a branch with nothing on it.
    worktree = { branch: 'agent-x', checkout: { path: '/w', dirty: true } }
    handoff = { ...PUSHED, ...NOTHING }
    const { rerender } = draw(WORKING)
    await waitFor(() => expect(row()).toBeTruthy())
    worktree = { branch: 'agent-x' }
    rerender(<ProjectRow {...props()} />)
    await waitFor(() => expect(reads('handoff')).toHaveLength(1))
    await settle()
    expect(row()).toBeTruthy()
    // And the commit, once it is seen, lands in the row that stayed.
    handoff = PUSHED
    await waitFor(() => expect(reads('handoff').length).toBeGreaterThan(1), { timeout: 3000 })
    expect(await screen.findByRole('button', { name: 'Next step' })).toBeTruthy()
  })

  test('while its clean-up is going an empty branch is not offered, and the branch is read again once it is done', async () => {
    // The checkout is cleaned up then, and an empty branch is deleted with it: a publish offered
    // in that window turned into "Branch gone" moments later.
    handoff = { ...PUSHED, ...NOTHING, pushed: false }
    const { rerender } = draw({ saving: true })
    await waitFor(() => expect(reads('handoff')).toHaveLength(1))
    await settle()
    expect(row()).toBeNull()
    handoff = PUSHED
    rerender(<ProjectRow {...props()} />)
    await waitFor(() => expect(reads('handoff')).toHaveLength(2))
    expect(await screen.findByRole('button', { name: 'Next step' })).toBeTruthy()
  })

  test('a branch with commits, pushed or not, is offered while the clean-up is going: the clean-up keeps it', async () => {
    handoff = { ...PUSHED, pushed: false }
    draw({ saving: true })
    expect(await screen.findByRole('button', { name: 'Next step' })).toBeTruthy()
  })

  test('work that was landed, or a branch merged, or a pull request closed, has no row: there is no step left', async () => {
    for (const [handoffNow, pr] of [
      [{ ...PUSHED, hasRemote: false, pushed: false, landed: true }, undefined],
      [{ ...PUSHED, merged: true }, { number: 9, url: 'https://x/pull/9', state: 'merged' as const }],
      [PUSHED, { number: 3, url: 'https://x/pull/3', state: 'closed' as const }],
    ] as const) {
      handoff = handoffNow
      id = `run-${++runs}`
      draw(pr ? { pr } : {})
      await waitFor(() => expect(reads('handoff')).toHaveLength(1))
      await settle()
      expect(row()).toBeNull()
      cleanup()
      forgetRemembered()
      call.mockClear()
    }
  })

  test('work left uncommitted after the merge keeps the row: that work is not landed', async () => {
    handoff = { ...PUSHED, merged: true, pendingFiles: ['index.html'] }
    draw({ pr: { number: 9, url: 'https://x/pull/9', state: 'merged' } })
    await waitFor(() => expect(row()).toBeTruthy())
  })

  test("a checkout read with no branch, as one taken while the checkout is removed, leaves the row the branch read's branch", async () => {
    worktree = {}
    handoff = PUSHED
    draw({ pr: { number: 7, url: 'https://x/pull/7', state: 'open' } })
    await waitFor(() => expect(row()).toBeTruthy())
    expect((await hoverTooltip(within(row()!).getByText(/^This project|^shop/))).textContent).toContain('agent-add-hello2')
    expect(within(row()!).getByRole('link', { name: '#7' })).toBeTruthy()
    expect(row()!.getAttribute('aria-label')).toBe('This project: its work')
  })

  test('a message sent to the ended agent takes the next step out of the row at once; its end offers it again', async () => {
    handoff = { ...PUSHED, hasRemote: false, pushed: false }
    const { rerender } = draw()
    expect(await screen.findByRole('button', { name: 'Next step' })).toBeTruthy()
    rerender(<ProjectRow {...props(WORKING)} />)
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Next step' })).toBeNull())
    expect(row()).toBeTruthy()
    await act(async () => rerender(<ProjectRow {...props()} />))
    expect(await screen.findByRole('button', { name: 'Next step' })).toBeTruthy()
  })
})
