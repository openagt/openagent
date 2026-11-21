import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { answeredQuestion, continuationPrompt, skipPrompt, toolQuestion } from './question.js'

// A question asked with the agent's own tool, and the sentences an answer and a skip go back to the
// agent as, read back by whoever shows the run's prompts.

test('the continuation prompt names the question and the answer', () => {
  assert.equal(continuationPrompt('Ship it?', 'Approve'), 'You paused to ask: "Ship it?". The user chose: Approve. Continue with that decision.')
})

test('a prompt that answers a question reads back as the question and its answer, a skip as the question alone', () => {
  assert.deepEqual(answeredQuestion(continuationPrompt('Which color?', 'Red')), { question: 'Which color?', answer: 'Red' })
  assert.deepEqual(answeredQuestion(skipPrompt('Which color do you prefer?')), { question: 'Which color do you prefer?' })
  assert.equal(answeredQuestion('Make it red.'), undefined)
})

test("a question asked with the agent's own tool: its recommended option marked on the label, none without an option", () => {
  assert.deepEqual(toolQuestion({ question: 'Which colour?', header: 'Colour', options: [{ label: 'Blue (Recommended)', description: 'Light blue' }, { label: 'Green' }] }), {
    title: 'Which colour?',
    header: 'Colour',
    options: [
      { id: 'opt:0', label: 'Blue', detail: 'Light blue' },
      { id: 'opt:1', label: 'Green' },
    ],
    recommended: 'opt:0',
  })
  assert.equal(toolQuestion({ question: 'Which?', options: [] }), undefined)
})
