import { describe, expect, test, vi } from 'vitest'
import type { ModuleCallResult, UiActionAt } from '@openagt/ui/module'
import { fakeHost } from '@openagt/ui/module/testing'
import gitBranches from './index.js'

// git-branches' entries in the shell's places, as the module brings them.

const actions = gitBranches.hooks['ui.action'] ?? []
const action = <P extends 'chat.menu' | 'attention.fix'>(place: P, id: string) => actions.find(each => each.place === place && each.id === id) as UiActionAt<P>

describe("the session's menu: Remove worktree", () => {
  const removing = (checkout: { kept: boolean; sizeBytes?: number }) => {
    const call = vi.fn(async (_projectId: string, name: string): Promise<ModuleCallResult> => ({ ok: true, output: name === 'checkout' ? checkout : { ok: true, said: 'Removed the worktree.' } }))
    return { host: fakeHost('@openagt/git-branches', { call }), call }
  }
  const on = { projectId: 'p1', agentId: 'r1' }

  test('offered only for a run that kept its checkout, its size on disk its hover', async () => {
    expect(await action('chat.menu', 'remove-worktree').offer!(removing({ kept: false }).host, on)).toBeUndefined()
    expect(await action('chat.menu', 'remove-worktree').offer!(removing({ kept: true, sizeBytes: 1_258_291 }).host, on)).toEqual({ title: 'Its checkout takes 1.2 MB on disk' })
    expect(await action('chat.menu', 'remove-worktree').offer!(removing({ kept: true }).host, on)).toEqual({})
  })

  test('a press asks the server part to remove it', async () => {
    const { host, call } = removing({ kept: true })
    expect(await action('chat.menu', 'remove-worktree').run!(host, on)).toEqual({ ok: true, said: 'Removed the worktree.' })
    expect(call).toHaveBeenCalledWith('p1', 'removeCheckout', { agentId: 'r1' })
  })
})

test("the fix of a project's folder behind its remote updates the folder; with no project there is none to update", async () => {
  const call = vi.fn(async (): Promise<ModuleCallResult> => ({ ok: true, output: { ok: true } }))
  const host = fakeHost('@openagt/git-branches', { call })
  expect(await action('attention.fix', 'update-folder').run!(host, { projectId: 'p1' })).toEqual({ ok: true })
  expect(call).toHaveBeenCalledWith('p1', 'updateProjectFolder', {})
  expect(await action('attention.fix', 'update-folder').run!(host, {})).toEqual({ ok: false, error: 'No project to update.' })
})

test("the Auto menu's levels: Commit everywhere, Publish branch where the work can be pushed", () => {
  const levels = gitBranches.hooks['ui.option']?.filter(option => option.place === 'composer.auto') ?? []
  expect(levels.map(level => level.id)).toEqual(['commit', 'branch'])
  const branch = levels[1]!
  expect(branch.offered?.({ id: 'p1', name: 'shop', remote: 'github.com/me/shop' })).toBe(true)
  expect(branch.offered?.({ id: 'p1', name: 'shop' })).toBe(false)
  expect(branch.offered?.(undefined)).toBe(true)
  expect(levels.map(level => level.sentence)).toEqual(['When you finish, if you changed any file, commit your work.', 'When you finish, if you changed any file, commit your work, push your branch and open no pull request.'])
})
