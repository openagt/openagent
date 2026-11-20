import { expect, test, vi } from 'vitest'
import type { ModuleCallResult } from '@openagt/ui/module'
import { fakeHost } from '@openagt/ui/module/testing'
import savedPrompts from './index.js'

// The message box's saved prompts as the module offers them (`composer.prompts`), its server part
// answering as a test says.

const entry = () => {
  const views = savedPrompts.hooks['ui.view'] ?? []
  expect(views.map(view => `${view.place} ${view.id}`)).toEqual(['composer.prompts saved-prompts'])
  const view = views[0]
  if (view?.place !== 'composer.prompts') throw new Error('no composer.prompts entry')
  return view
}

test("the box is offered the person's prompts, then the project's, each listed under whose it is", async () => {
  const call = vi.fn(async (): Promise<ModuleCallResult> => ({ ok: true, output: { person: [{ id: 'a', label: 'Deep review', text: 'Audit this PR.' }], project: [{ id: 'b', label: 'Release notes', text: 'Write the notes.' }] } }))
  expect(await entry().list(fakeHost('@openagt/saved-prompts', { call }), 'shop')).toEqual([
    { id: 'person:a', label: 'Deep review', text: 'Audit this PR.', group: 'Your saved prompts' },
    { id: 'project:b', label: 'Release notes', text: 'Write the notes.', group: 'Project saved prompts' },
  ])
  expect(call).toHaveBeenCalledWith('shop', 'prompts', {})
  // A session with no project has the person's alone.
  call.mockResolvedValueOnce({ ok: true, output: { person: [] } })
  expect(await entry().list(fakeHost('@openagt/saved-prompts', { call }), 'session')).toEqual([])
})

test("deleting one names whose it is and its own id; what refused it is said", async () => {
  const call = vi.fn(async (): Promise<ModuleCallResult> => ({ ok: true, output: null }))
  const host = fakeHost('@openagt/saved-prompts', { call })
  expect(await entry().remove(host, 'shop', 'project:b')).toEqual({ ok: true })
  expect(call).toHaveBeenCalledWith('shop', 'remove', { whose: 'project', id: 'b' })
  call.mockResolvedValueOnce({ ok: false, error: "A session with no project has no project's prompts." })
  expect(await entry().remove(host, 'session', 'project:b')).toEqual({ ok: false, error: "A session with no project has no project's prompts." })
  expect(await entry().remove(host, 'shop', 'b')).toEqual({ ok: false, error: 'No such saved prompt.' })
})
