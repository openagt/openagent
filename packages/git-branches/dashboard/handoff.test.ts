import { describe, expect, test, vi } from 'vitest'
import type { ModuleCallResult } from '@openagt/ui/module'
import { fakeHost } from '@openagt/ui/module/testing'
import type { Handoff } from './calls.js'
import { handoffActions, nextSteps } from './handoff.js'

// The next steps of an ended run's work (`chat.handoff`): what each is offered as, for what the
// branch holds, and what a press asks of the module's server part.

/** A branch that holds one commit, on a repo with a remote, not pushed yet. */
const worked: Handoff = {
  branch: 'agent-fix-footer',
  exists: true,
  base: 'origin/main',
  commits: [{ sha: 'a'.repeat(40), short: 'aaaaaaa', subject: 'fix the footer' }],
  files: [{ path: 'src/footer.ts', insertions: 15, deletions: 3, binary: false }],
  insertions: 15,
  deletions: 3,
  empty: false,
  hasRemote: true,
  pushed: false,
  merged: false,
}

const offered = (handoff: Handoff | null, repo?: string) => Object.keys(nextSteps(handoff, repo))

describe('nextSteps', () => {
  test('a branch with a remote is offered its push, until it is pushed; the pull request is the git host module’s', () => {
    expect(nextSteps(worked)).toEqual({ push: { title: 'Pushes agent-fix-footer to origin', rank: 60 } })
    expect(nextSteps({ ...worked, pushed: true })).toEqual({})
    expect(nextSteps(null)).toEqual({})
  })

  test('work left uncommitted comes first: named, its commit asked of the agent, and its discard under the arrow, asked first', () => {
    const steps = nextSteps({ ...worked, commits: [], empty: true, pendingFiles: ['a.ts', 'b.ts', 'c.ts'] })
    expect(Object.keys(steps)).toEqual(['commit', 'discard'])
    expect(steps.commit).toEqual({ note: 'Nothing committed — a.ts, b.ts and 1 more left uncommitted.', title: 'a.ts\nb.ts\nc.ts', rank: 10 })
    expect(steps.discard?.danger).toBe(true)
    expect(steps.discard?.confirm?.confirmLabel).toBe('Discard')
    // On a branch with commits, "Nothing committed" would be false.
    expect(nextSteps({ ...worked, pendingFiles: ['a.ts'] }).commit?.note).toBe('a.ts left uncommitted.')
    expect(nextSteps({ ...worked, pendingFiles: ['a.ts'] }).discard?.confirm?.description).toBe('a.ts goes back to what the branch holds, and new files are deleted. This cannot be undone.')
  })

  test('what is left to say with nothing to press: landed, merged, a branch gone, commits that cancel out; a run that changed nothing says nothing', () => {
    expect(nextSteps({ ...worked, landed: true })).toEqual({ merge: { noteOnly: true, note: 'Merged into the main branch.' } })
    expect(nextSteps({ ...worked, merged: true })).toEqual({ merge: { noteOnly: true, note: 'Merged into main.' } })
    expect(nextSteps({ ...worked, merged: true, base: 'b'.repeat(40) }).merge?.note).toBe('Merged into the main branch.')
    expect(nextSteps({ ...worked, exists: false })).toEqual({ push: { noteOnly: true, note: 'Branch gone — nothing to open a PR from.' } })
    expect(nextSteps({ ...worked, exists: false, unchanged: true })).toEqual({})
    expect(nextSteps({ ...worked, empty: true }).push?.note).toBe('Nothing to publish: the commits cancel out.')
    expect(nextSteps({ ...worked, empty: true, hasRemote: false }).push?.note).toBe('Nothing to merge: the commits cancel out.')
    expect(nextSteps({ ...worked, empty: true, commits: [] })).toEqual({})
  })

  test("no remote: the project's branch is merged on this machine; a copy goes back to the folder it was copied from, or stays where it is", () => {
    expect(nextSteps({ ...worked, base: 'main', hasRemote: false })).toEqual({ merge: { note: 'Not in main yet.', rank: 20 } })
    const copy = { ...worked, base: 'main', hasRemote: false, copiedFrom: { path: '/me/app', hasBranch: false } }
    expect(offered(copy, 'app')).toEqual(['merge', 'only-add'])
    expect(nextSteps(copy, 'app').merge).toEqual({ note: 'Not in main yet.', title: 'Merges agent-fix-footer into main in /me/app', rank: 20 })
    // The folder has the branch now: the merge is the one step left.
    expect(offered({ ...copy, copiedFrom: { path: '/me/app', hasBranch: true } }, 'app')).toEqual(['merge'])
    expect(nextSteps({ ...copy, copiedFrom: { path: '/me/app', hasBranch: true } }, 'app').merge?.note).toBe('In your folder, not in main yet.')
    expect(nextSteps({ ...copy, merged: true }, 'app').merge).toEqual({ noteOnly: true, note: 'Merged into your folder.', title: 'Merged into the main branch of /me/app' })
    const { copiedFrom: _, ...cloned } = copy
    expect(nextSteps(cloned, 'app')).toEqual({ merge: { noteOnly: true, note: 'No remote: the work stays in this copy.' } })
  })
})

describe('the presses', () => {
  const action = (id: string) => handoffActions.find(each => each.id === id)!
  const pressing = () => {
    const asked: [string, object][] = []
    const call = vi.fn(async (_projectId: string, name: string, input: object): Promise<ModuleCallResult> => {
      asked.push([name, input])
      return name === 'handoff' ? { ok: true, output: worked } : { ok: true, output: { ok: true } }
    })
    return { host: fakeHost('@openagt/git-branches', { call }), asked }
  }

  test('each press asks the server part its step, of the run or of the copy it is on', async () => {
    const { host, asked } = pressing()
    const run = { projectId: 'p1', agentId: 'r1' }
    const copy = { ...run, repo: 'app' }
    await action('commit').run!(host, run)
    await action('merge').run!(host, run)
    await action('merge').run!(host, copy)
    await action('only-add').run!(host, copy)
    await action('push').run!(host, copy)
    await action('discard').run!(host, run)
    expect(asked).toEqual([
      ['commit', { agentId: 'r1' }],
      ['merge', { agentId: 'r1' }],
      ['bring', { agentId: 'r1', repo: 'app', merge: true }],
      ['bring', { agentId: 'r1', repo: 'app' }],
      ['push', { agentId: 'r1', repo: 'app' }],
      ['discard', { agentId: 'r1' }],
    ])
  })

  test('each is offered as the branch read now says, one read answering them all', async () => {
    const { host, asked } = pressing()
    const on = { projectId: 'p1', agentId: 'r-offers' }
    const offers = await Promise.all(handoffActions.map(each => each.offer!(host, on)))
    expect(offers.map(offer => offer !== undefined)).toEqual(handoffActions.map(each => each.id === 'push'))
    expect(asked).toEqual([['handoff', { agentId: 'r-offers' }]])
  })
})
