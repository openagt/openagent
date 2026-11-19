import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { pendingChoices } from './open-choices.js'
import type { OpenAgentEvent } from './events.js'

const ASK: OpenAgentEvent = { kind: 'choice', id: 'await-choices', title: 'Which way?', options: [{ id: 'a', label: 'Left' }, { id: 'b', label: 'Right' }], recommended: 'a' }
const SAID: OpenAgentEvent = { kind: 'driver', event: { type: 'text', text: 'going on' } }

test('a question stays open through the end of a run that ended waiting on it, whole', () => {
  const open = pendingChoices([SAID, ASK, { kind: 'usage', costUsd: 0.1 }, { kind: 'end', ok: false, waiting: true }])
  assert.deepEqual(open, [{ id: 'await-choices', title: 'Which way?', options: [{ id: 'a', label: 'Left' }, { id: 'b', label: 'Right' }], recommended: 'a' }])
})

test('a question closes when the agent goes on, and a later one opens again', () => {
  assert.deepEqual(pendingChoices([ASK, { kind: 'end', ok: false, waiting: true }, SAID]), [])
  assert.equal(pendingChoices([ASK, SAID, { ...ASK, title: 'And now?' } as OpenAgentEvent]).at(-1)?.title, 'And now?')
})

test('a run that ends for good takes its question with it: nobody would read the pick (#1359)', () => {
  assert.deepEqual(pendingChoices([ASK, { kind: 'end', ok: false, stopped: true }]), [])
  assert.deepEqual(pendingChoices([ASK, { kind: 'end', ok: true }]), [])
})

test('a recorded resolution closes the question it names, in a run from before the inbox', () => {
  assert.deepEqual(pendingChoices([ASK, { kind: 'choice-resolved', id: 'await-choices', picked: 'a', by: 'user' }]), [])
  assert.equal(pendingChoices([ASK, { kind: 'choice-resolved', id: 'another', picked: 'a', by: 'user' }]).length, 1)
})
