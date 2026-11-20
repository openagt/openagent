import { expect, test } from 'vitest'
import changes from './index.js'

test('the module adds the Changes pane, with its icon, and the count in a working run’s bar', () => {
  const views = changes.hooks['ui.view'] ?? []
  expect(views.map(view => `${view.place} ${view.id}`)).toEqual(['chat.pane changes', 'chat.summary changes'])
  const pane = views.find(view => view.place === 'chat.pane')
  expect(pane?.place === 'chat.pane' && pane.icon).toBeTruthy()
})
