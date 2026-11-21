import { expect, test } from 'vitest'
import hostClaudeWeb from './index.js'

test('the module adds Settings › Claude web, and the strip above a web run’s chat', () => {
  const views = hostClaudeWeb.hooks['ui.view'] ?? []
  expect(views.map(view => `${view.place} ${view.id}`)).toEqual(['settings.section claude-web', 'chat.notice web-run'])
  const entry = views[0]
  expect(entry?.place === 'settings.section' && [entry.title, entry.order]).toEqual(['Claude web', 70])
})
