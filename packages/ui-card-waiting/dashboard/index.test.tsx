import { expect, test } from 'vitest'
import waiting from './index.js'

test("the module adds the Overview's card of what needs the person, before the others, two thirds wide", () => {
  const views = waiting.hooks['ui.view'] ?? []
  expect(views.map(view => `${view.place} ${view.id}`)).toEqual(['overview.card waiting'])
  const card = views[0]
  expect(card?.place === 'overview.card' && [card.label, card.order, card.width, card.minWidth, card.needsYou]).toEqual(['Human Queue', 5, '2/3', '1/2', true])
})
