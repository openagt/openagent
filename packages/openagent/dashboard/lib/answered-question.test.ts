import { expect, test } from 'vitest'
import { continuationPrompt } from '@openagt/agent-driver'
import { answeredQuestion, answerPrompt, skipPrompt } from './answered-question.js'

test('it reads the question and the answer out of the prompt the driver writes', () => {
  expect(answeredQuestion(continuationPrompt('Which color do you prefer?', 'Red'))).toEqual({ question: 'Which color do you prefer?', answer: 'Red' })
  // Several picks, and a question with quotes and a full stop in it.
  expect(answeredQuestion(continuationPrompt('Ship "v2". Now?', 'Red, Blue'))).toEqual({ question: 'Ship "v2". Now?', answer: 'Red, Blue' })
})

test('the answer the chat shows before the agent\'s own line is the driver\'s sentence, word for word', () => {
  expect(answerPrompt('Which color?', 'Red')).toBe(continuationPrompt('Which color?', 'Red'))
})

test('a skipped question is read back as its question with no answer', () => {
  expect(answeredQuestion(skipPrompt('Which color do you prefer?'))).toEqual({ question: 'Which color do you prefer?' })
})

test('any other prompt is no answered question', () => {
  expect(answeredQuestion('Add a README.')).toBeUndefined()
  expect(answeredQuestion('I skip this question.')).toBeUndefined()
  expect(answeredQuestion(`${continuationPrompt('Q?', 'A')} And one more thing.`)).toBeUndefined()
})
