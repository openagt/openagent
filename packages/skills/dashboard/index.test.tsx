import { expect, test } from 'vitest'
import skills from './index.js'

test('the module adds Settings › Skills, first of the Project group, an entry that changes nothing', () => {
  const views = skills.hooks['ui.view'] ?? []
  expect(views.map(view => `${view.place} ${view.id}`)).toEqual(['settings.section skills'])
  const entry = views[0]
  expect(entry?.place === 'settings.section' && [entry.title, entry.order, entry.readOnly]).toEqual(['Skills', 10, true])
})
