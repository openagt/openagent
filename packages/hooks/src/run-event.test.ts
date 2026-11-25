import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { answeredQuestion, continuationPrompt, skipPrompt } from './run-event.js'

// The sentences an answer and a skip go back to the agent as, read back by whoever shows the run's prompts.

test('the continuation prompt names the question and the answer', () => {
  assert.equal(continuationPrompt('Ship it?', 'Approve'), 'You paused to ask: "Ship it?". The user chose: Approve. Continue with that decision.')
})

test('a prompt that answers a question reads back as the question and its answer, a skip as the question alone', () => {
  assert.deepEqual(answeredQuestion(continuationPrompt('Which color?', 'Red')), { question: 'Which color?', answer: 'Red' })
  assert.deepEqual(answeredQuestion(skipPrompt('Which color do you prefer?')), { question: 'Which color do you prefer?' })
  assert.equal(answeredQuestion('Make it red.'), undefined)
})
