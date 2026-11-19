import { expect, test } from 'vitest'
import notificationsBrowser from './index.js'

test('the module adds its notifier over every page, and Settings › Notifications', () => {
  const views = notificationsBrowser.hooks['ui.view'] ?? []
  expect(views.map(view => `${view.place} ${view.id}`)).toEqual(['app.overlay notifier', 'settings.section notifications'])
  const entry = views[1]
  expect(entry?.place === 'settings.section' && [entry.title, entry.order]).toEqual(['Notifications', 30])
})
