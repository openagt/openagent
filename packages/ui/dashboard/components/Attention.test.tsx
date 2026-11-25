import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Attention } from '@openagt/hooks'
import { forgetRemembered } from '../lib/use-async.js'
import { ModulesContext, mountedOf, type MountedAction } from '../lib/use-modules.js'

// What a project needs (`app.attention` items about the project), at the top of its "New agent
// session" page: each item's words, and its fix, a module's action (`attention.fix`).

const attention = vi.hoisted(() => ({ onAttention: vi.fn() }))
vi.mock('../rpc/attention.js', () => attention)
const { ModuleFixPress, ProjectItemsLine } = await import('./Attention.js')

afterEach(() => {
  cleanup()
  forgetRemembered()
  attention.onAttention.mockReset()
})

const BEHIND: Attention = { module: 'tools', kind: 'setup', scope: 'project', id: 'behind', words: 'The folder is 2 commits behind main.', fix: { label: 'Update folder', action: 'update' } }

/** The page, with the module `tools` bringing the action `update`, answering `run`. */
function page(run: () => Promise<{ ok: true } | { ok: false; error: string }>) {
  const update: MountedAction<'attention.fix'> = { place: 'attention.fix', id: 'update', label: 'Update folder', run, package: '@me/tools', module: 'tools', projects: ['p1'] }
  return render(
    <ModulesContext.Provider value={mountedOf({ actions: { 'attention.fix': [update] } })}>
      <ProjectItemsLine projectId="p1" />
    </ModulesContext.Provider>,
  )
}

test("a project's items are said with their words, and nothing else is: an item about this computer or a run is drawn elsewhere", async () => {
  attention.onAttention.mockResolvedValue({ items: [BEHIND, { ...BEHIND, id: 'other', scope: 'computer', words: 'Not here' }, { ...BEHIND, id: 'run', scope: 'run', words: 'Nor here' }], whole: true })
  page(async () => ({ ok: true }))
  expect(await screen.findByText('The folder is 2 commits behind main.')).toBeTruthy()
  expect(attention.onAttention).toHaveBeenCalledWith('p1', undefined)
  expect(screen.queryByText('Not here')).toBeNull()
  expect(screen.queryByText('Nor here')).toBeNull()
})

test('its fix runs the module’s action, and the line goes once the item is gone', async () => {
  attention.onAttention.mockResolvedValueOnce({ items: [BEHIND], whole: true }).mockResolvedValue({ items: [], whole: true })
  const run = vi.fn(async () => ({ ok: true as const }))
  page(run)
  fireEvent.click(await screen.findByRole('button', { name: 'Update folder' }))
  await waitFor(() => expect(screen.queryByText('The folder is 2 commits behind main.')).toBeNull())
  expect(run).toHaveBeenCalled()
})

test('a fix that fails says its words, and the line stays', async () => {
  attention.onAttention.mockResolvedValue({ items: [BEHIND], whole: true })
  page(async () => ({ ok: false, error: 'fatal: Not possible to fast-forward, aborting.' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Update folder' }))
  expect((await screen.findByRole('alert')).textContent).toContain('fatal: Not possible to fast-forward, aborting.')
  expect(screen.getByText('The folder is 2 commits behind main.')).toBeTruthy()
})

test("a module's fix drawn by another module's part (an account added where a host has none) runs that module's action, and says it is done; with no module bringing it here, nothing is drawn", async () => {
  const run = vi.fn(async () => ({ ok: true as const }))
  const add: MountedAction<'attention.fix'> = { place: 'attention.fix', id: 'add-account', label: 'Add a GitHub account', run, package: '@me/github', module: 'github', projects: [], computer: true }
  const fixed = vi.fn()
  const fix = { module: 'github', action: 'add-account', label: 'Add a GitHub account' }
  const { unmount } = render(
    <ModulesContext.Provider value={mountedOf({ actions: { 'attention.fix': [add] } })}>
      <ModuleFixPress fix={fix} onFixed={fixed} />
    </ModulesContext.Provider>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Add a GitHub account' }))
  await waitFor(() => expect(fixed).toHaveBeenCalled())
  expect(run).toHaveBeenCalled()
  unmount()
  const { container } = render(
    <ModulesContext.Provider value={mountedOf()}>
      <ModuleFixPress fix={fix} />
    </ModulesContext.Provider>,
  )
  expect(container.textContent).toBe('')
})
