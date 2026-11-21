import { expect, test } from 'vitest'
import notificationsCommand from './index.js'

test('the module adds Settings › Notification command', () => {
  const views = notificationsCommand.hooks['ui.view'] ?? []
  expect(views.map(view => `${view.place} ${view.id}`)).toEqual(['settings.section notifications-command'])
  const entry = views[0]
  expect(entry?.place === 'settings.section' && [entry.title, entry.order]).toEqual(['Notification command', 35])
})
