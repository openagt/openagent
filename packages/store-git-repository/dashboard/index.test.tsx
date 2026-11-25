import { expect, test } from 'vitest'
import gitRepository from './index.js'

test('the module adds Settings › Your agent data among the computer’s entries', () => {
  const views = gitRepository.hooks['ui.view'] ?? []
  expect(views.map(view => `${view.place} ${view.id}`)).toEqual(['settings.section agent-data'])
  const entry = views[0]
  expect(entry?.place === 'settings.section' && [entry.title, entry.order]).toEqual(['Your agent data', 50])
})
