import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { forgetRemembered, type ModuleCallResult } from '@openagt/ui/module'
import { fakeHost, mountedOf, renderWithHost, type MountedAction } from '@openagt/ui/module/testing'
import type { Handoff } from './calls.js'
import { CopyRows } from './CopyRows.js'

// The session's copies of repos in the panel of its work (`chat.work`): a row per copy that holds
// work, read off the copy's own branch, with the next steps the modules offer for that copy.

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

let held: Record<string, Handoff> = {}
const call = vi.fn(async (_projectId: string, name: string, input: { repo?: string }): Promise<ModuleCallResult> => {
  if (name === 'copies') return { ok: true, output: Object.keys(held) }
  if (name === 'handoff') return { ok: true, output: held[input.repo ?? ''] ?? null }
  return { ok: false, error: `no ${name} here` }
})
const host = fakeHost('@openagt/git-branches', { call: call as never })

// A module's next step for a copy: offered for the copy it is asked about, by its name.
const offeredFor: string[] = []
const step: MountedAction<'chat.handoff'> = {
  place: 'chat.handoff',
  id: 'step',
  label: 'Take it further',
  offer: async (_host, on) => (offeredFor.push(on.repo ?? ''), {}),
  run: async () => ({ ok: true }),
  package: '@me/steps',
  module: 'steps',
  projects: ['p1'],
}
const modules = mountedOf({ actions: { 'chat.handoff': [step] } })

afterEach(() => {
  cleanup()
  forgetRemembered()
  call.mockClear()
  offeredFor.length = 0
  held = {}
})

test("a copy's row reads the copy's own branch: its name, its branch, what it holds, and the next steps offered for that copy", async () => {
  held = { 'oa-newuser': worked }
  renderWithHost(<CopyRows projectId="p1" agentId="run-1" working={false} />, host, modules)
  const row = await screen.findByRole('listitem')
  expect(call).toHaveBeenCalledWith('p1', 'copies', { agentId: 'run-1' })
  expect(call).toHaveBeenCalledWith('p1', 'handoff', { agentId: 'run-1', repo: 'oa-newuser' })
  expect(row.getAttribute('aria-label')).toBe('oa-newuser: its work')
  expect(within(row).getByText('agent-fix-footer')).toBeTruthy()
  expect(await within(row).findByRole('button', { name: 'Take it further' })).toBeTruthy()
  expect(offeredFor).toContain('oa-newuser')
})

test('a copy with no work has no row, and neither has one of a run still going, whose branch is not read', async () => {
  held = { empty: { ...worked, commits: [], files: [], insertions: 0, deletions: 0, empty: true }, site: worked }
  renderWithHost(<CopyRows projectId="p1" agentId="run-1" working={false} />, host, modules)
  await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1))
  expect(screen.getByRole('listitem').getAttribute('aria-label')).toBe('site: its work')
  cleanup()
  forgetRemembered()
  call.mockClear()
  renderWithHost(<CopyRows projectId="p1" agentId="run-1" working />, host, modules)
  await waitFor(() => expect(call).toHaveBeenCalledWith('p1', 'copies', { agentId: 'run-1' }))
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(call.mock.calls.some(([, name]) => name === 'handoff')).toBe(false)
  expect(screen.queryByRole('listitem')).toBeNull()
})
