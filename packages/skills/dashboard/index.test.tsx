import { expect, test, vi } from 'vitest'
import type { ModuleCallResult } from '@openagt/ui/module'
import { fakeHost } from '@openagt/ui/module/testing'
import skills from './index.js'

test('the module adds Settings › Skills, first of the Project group, an entry that changes nothing; and the gear\'s Skills line, after the profile\'s', () => {
  const views = skills.hooks['ui.view'] ?? []
  expect(views.map(view => `${view.place} ${view.id}`)).toEqual(['settings.section skills', 'composer.control skills'])
  const [entry, control] = views
  expect(entry?.place === 'settings.section' && [entry.title, entry.order, entry.readOnly]).toEqual(['Skills', 10, true])
  expect(control?.place === 'composer.control' && [control.at, control.order]).toEqual(['setup', 20])
})

test("the message box's commands are the project's command skills, as its server part lists them", async () => {
  const [option] = skills.hooks['ui.option'] ?? []
  const listed = [{ name: 'plan', description: 'Plan a ticket' }, { name: 'ship', waiting: 'main' }]
  const call = vi.fn(async (): Promise<ModuleCallResult> => ({ ok: true, output: listed }))
  expect(option?.place).toBe('composer.commands')
  if (option?.place !== 'composer.commands') return
  expect(await option.list(fakeHost('@openagt/skills', { call }), 'p1')).toEqual(listed)
  expect(call).toHaveBeenCalledWith('p1', 'commands', {})
})
