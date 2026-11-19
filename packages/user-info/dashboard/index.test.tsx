import { expect, test } from 'vitest'
import userInfo from './index.js'

test('the module adds Settings › Profile, first of the entries', () => {
  const views = userInfo.hooks['ui.view'] ?? []
  expect(views.map(view => `${view.place} ${view.id}`)).toEqual(['settings.section profile'])
  const profile = views[0]
  expect(profile?.place === 'settings.section' && [profile.title, profile.order]).toEqual(['Profile', 10])
})
