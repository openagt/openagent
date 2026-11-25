import { expect, test } from 'vitest'
import profiles from './index.js'

test('the module adds the Profiles page, last of the modules\' rows, the gear\'s first line, and the Overview\'s line on the profiles', () => {
  const views = profiles.hooks['ui.view'] ?? []
  expect(views.map(view => `${view.place} ${view.id}`)).toEqual(['app.page profiles', 'composer.control profile', 'overview.line profiles'])
  const [page, control] = views
  expect(page?.place === 'app.page' && [page.label, page.order]).toEqual(['Profiles', 90])
  expect(control?.place === 'composer.control' && [control.at, control.order]).toEqual(['setup', 10])
})
