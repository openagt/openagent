import { afterEach, describe, expect, test, vi } from 'vitest'
import type { ModuleCallResult, UiHost } from '@openagt/ui/module'
import { fakeHost } from '@openagt/ui/module/testing'
import type { PrHandoff } from './calls.js'
import { handoffActions, prPresses } from './handoff.js'
import { menuActions } from './menu.js'

// The pull request presses in the bar above an ended run's message box, and GitHub's entries in a
// project's and a session's menu, as the shell asks them what they offer and presses them.

const PR = { number: 7, url: 'https://github.com/o/r/pull/7', state: 'OPEN', title: 'Fix' }

describe('what the bar offers for the run’s request', () => {
  test('a request to open: Open PR first, the draft under its arrow; one already on origin opens with no push', () => {
    expect(prPresses({ open: { pushed: false, branch: 'agent/fix' } })).toEqual({
      'open-pr': { title: 'Pushes the branch and opens a pull request for agent/fix', rank: 30 },
      'draft-pr': { rank: 40 },
    })
    expect(prPresses({ open: { pushed: true, branch: 'agent/fix' } })['open-pr']?.title).toBe('Opens a pull request for agent/fix')
  })

  test("what a request would carry beyond the run's own work is said beside its press, the main branch by name", () => {
    const offered = prPresses({ open: { pushed: true, branch: 'agent/fix', carries: { base: 'origin/feature', commits: 3, files: 1, insertions: 12, deletions: 4 } } })['open-pr']
    expect(offered).toMatchObject({ note: '1 file over feature', title: "A pull request against feature carries 3 commits · 1 file · +12 −4, this run's work among them." })
    expect(prPresses({ open: { pushed: true, branch: 'agent/fix', carries: { base: 'a'.repeat(40), commits: 1, files: 2, insertions: 1, deletions: 0 } } })['open-pr']?.note).toBe('2 files over the main branch')
  })

  test('an open request: its merge; the push of commits it does not have first; armed, said and not pressed; nothing to do, nothing', () => {
    const { 'pr-page': _page, 'close-pr': _close, ...needs } = prPresses({ pr: PR, merge: true })
    expect(needs).toEqual({ 'merge-pr': { title: 'Merges PR #7 now, or once its checks pass', rank: 20 } })
    expect(prPresses({ pr: PR, update: true })['update-pr']).toEqual({ note: 'not in the PR yet', rank: 20 })
    expect(prPresses({ pr: PR, armed: true })['merge-pr']).toEqual({ noteOnly: true, note: 'PR #7 merges when its checks pass.' })
    expect(prPresses({ pr: { ...PR, state: 'MERGED' } })).toEqual({})
    expect(prPresses({})).toEqual({})
  })

  test('under the arrow of an open request, whatever it needs: its page on GitHub, and its Close, in the danger colour and asked first', () => {
    for (const read of [{ pr: PR, merge: true as const }, { pr: PR, update: true as const }, { pr: PR, armed: true as const }]) {
      const offered = prPresses(read)
      expect(offered['pr-page']).toEqual({ href: 'https://github.com/o/r/pull/7', rank: 60 })
      expect(offered['close-pr']).toEqual({
        danger: true,
        rank: 70,
        confirm: { title: 'Close PR #7?', description: '“Fix” on o/r is closed without merging. Its branch stays; you can reopen it on GitHub.', confirmLabel: 'Close PR', danger: true },
      })
    }
    // A request whose title no read confirmed is named by its number.
    expect(prPresses({ pr: { ...PR, title: '' }, merge: true })['close-pr']?.confirm?.description).toBe('PR #7 on o/r is closed without merging. Its branch stays; you can reopen it on GitHub.')
    // Merged or closed, neither.
    expect(prPresses({ pr: { ...PR, state: 'CLOSED' } })).toEqual({})
  })
})

describe('the presses', () => {
  let read: PrHandoff = {}
  const call = vi.fn(async (_projectId: string, name: string, _input: object): Promise<ModuleCallResult> => {
    if (name === 'pullRequest') return { ok: true, output: read }
    if (name === 'openPr') return { ok: true, output: { ok: true, said: 'Opened PR #7.', number: 7 } }
    if (name === 'closePr') return { ok: true, output: { ok: true, said: 'Closed PR #7.' } }
    if (name === 'home') return { ok: true, output: { url: 'https://github.com/o/r' } }
    if (name === 'repositoryOffer') return { ok: true, output: { repository: 'octo/shop' } }
    return { ok: false, error: `no ${name} here` }
  })
  const host = fakeHost('@openagt/github', { call }) as unknown as UiHost
  const action = (id: string) => handoffActions.find(one => one.id === id)!
  afterEach(() => call.mockClear())

  test('the presses asking at once share one read of the request, for the run or one of its copies; a press reads it anew', async () => {
    read = { open: { pushed: true, branch: 'agent/fix' } }
    const on = { projectId: 'p1', agentId: 'r1' }
    const offers = await Promise.all(handoffActions.map(one => one.offer!(host, on)))
    expect(offers.map(offer => offer?.rank)).toEqual([30, 40, undefined, undefined, undefined, undefined])
    expect(call.mock.calls.filter(([, name]) => name === 'pullRequest')).toEqual([['p1', 'pullRequest', { agentId: 'r1' }]])
    await action('draft-pr').offer!(host, { ...on, repo: 'docs' })
    expect(call).toHaveBeenLastCalledWith('p1', 'pullRequest', { agentId: 'r1', repo: 'docs' })
    expect(await action('draft-pr').run!(host, on)).toEqual({ ok: true, said: 'Opened PR #7.', number: 7 })
    expect(call).toHaveBeenLastCalledWith('p1', 'openPr', { agentId: 'r1', draft: true })
    call.mockClear()
    await action('open-pr').offer!(host, on)
    expect(call).toHaveBeenCalledWith('p1', 'pullRequest', { agentId: 'r1' })
  })

  test("an open request's Close closes the run's request, or a copy's", async () => {
    expect(await action('close-pr').run!(host, { projectId: 'p1', agentId: 'r1', repo: 'docs' })).toEqual({ ok: true, said: 'Closed PR #7.' })
    expect(call).toHaveBeenLastCalledWith('p1', 'closePr', { agentId: 'r1', repo: 'docs' })
    // Its page is a link, nothing it runs.
    expect(action('pr-page').run).toBeUndefined()
  })

  test("the menus: the project's page on GitHub where its origin is there; a private repository for a project on this computer alone, asked once more", async () => {
    const [project, chat, create] = menuActions
    expect([project!.place, chat!.place, create!.place]).toEqual(['project.menu', 'chat.menu', 'project.menu'])
    expect(await project!.offer!(host, { projectId: 'p1' } as never)).toEqual({ href: 'https://github.com/o/r' })
    const asked = await create!.offer!(host, { projectId: 'p1' } as never)
    expect(asked?.confirm).toEqual({
      title: 'Create a private repository on GitHub?',
      description: 'This creates the private repository octo/shop on your GitHub account and pushes this project to it. The project’s code leaves this machine.',
      confirmLabel: 'Create and push',
    })
    call.mockImplementation(async () => ({ ok: true, output: {} }))
    expect(await project!.offer!(host, { projectId: 'p1' } as never)).toBeUndefined()
    expect(await create!.offer!(host, { projectId: 'p1' } as never)).toBeUndefined()
  })
})
