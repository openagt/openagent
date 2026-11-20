import { expect, test } from 'vitest'
import files from './index.js'

test('the module adds the Files pane, with its icon', () => {
  const views = files.hooks['ui.view'] ?? []
  expect(views.map(view => `${view.place} ${view.id}`)).toEqual(['chat.pane files'])
  const pane = views[0]
  expect(pane?.place === 'chat.pane' && pane.icon).toBeTruthy()
})
