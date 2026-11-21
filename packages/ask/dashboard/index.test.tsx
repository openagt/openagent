import { expect, test } from 'vitest'
import ask from './index.js'
import { QuestionCard } from './QuestionCard.js'

test("the module draws a run's question as its card; the block the question is written in has no look of its own: the card under the message asks it", () => {
  const renders = ask.hooks['ui.render'] ?? []
  expect(renders.map(each => each.kind)).toEqual(['question', 'await-choices'])
  expect(renders[0]?.Render).toBe(QuestionCard)
  expect(renders[1]?.Render).toBeUndefined()
})
