import { expect, test } from 'vitest'
import hostGithubActions from './index.js'

test("the module adds the strip above the chat of a run it runs (#2394)", () => {
  const views = hostGithubActions.hooks['ui.view'] ?? []
  expect(views.map(view => `${view.place} ${view.id}`)).toEqual(['chat.notice actions-run'])
})
