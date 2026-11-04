import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { continuationPrompt, parseQuestion } from './question.js'

// The one parser of the question block: what it reads, what it tolerates, what is not a question.

const block = (json: string): string => `Some text before.\n\n\`\`\`await-choices\n${json}\n\`\`\`\n`

test('a turn with no block is not a question', () => {
  assert.equal(parseQuestion('Built the whole app. Done.'), undefined)
  assert.equal(parseQuestion('```await-choices\nnot json\n```'), undefined)
  assert.equal(parseQuestion(block('{ "title": "Empty", "options": [] }')), undefined, 'no pickable option is no question')
  assert.equal(parseQuestion(block('{ "title": "Blank labels", "options": [{ "detail": "x" }] }')), undefined)
})

test('a well-formed block parses with its options, the recommended id, the file and multi', () => {
  const q = parseQuestion(block('{ "title": "Ship it?", "options": [{ "id": "yes", "label": "Approve", "detail": "merge now" }, { "id": "no", "label": "Decline", "stop": true }], "recommended": "yes", "file": "PLAN_x.agent.md" }'))
  assert.deepEqual(q, {
    title: 'Ship it?',
    options: [
      { id: 'yes', label: 'Approve', detail: 'merge now' },
      { id: 'no', label: 'Decline', stop: true },
    ],
    recommended: 'yes',
    file: 'PLAN_x.agent.md',
  })
  const multi = parseQuestion(block('{ "title": "Which?", "multi": true, "options": [{ "label": "A", "default": true }, { "label": "B" }] }'))
  assert.equal(multi?.multi, true)
  assert.deepEqual(multi?.options[0], { id: 'opt:0', label: 'A', default: true })
})

test('ids are synthesized from position, a blank title falls back, and a recommended label maps to its id', () => {
  const q = parseQuestion(block('{ "options": [{ "label": "A" }, { "label": "B" }], "recommended": "B" }'))
  assert.equal(q?.title, 'Which option?')
  assert.deepEqual(q?.options.map(o => o.id), ['opt:0', 'opt:1'])
  assert.equal(q?.recommended, 'opt:1')
  assert.equal(parseQuestion(block('{ "options": [{ "label": "A" }], "recommended": "nope" }'))?.recommended, undefined)
})

test('the last usable block wins, falling back past a malformed one', () => {
  const text = block('{ "title": "First", "options": [{ "label": "A" }] }') + block('{ "title": "Second", "options": [{ "label": "B" }] }') + '```await-choices\n{ broken\n```'
  assert.equal(parseQuestion(text)?.title, 'Second')
})

test('a header names the question in a word or two; a blank one is left out', () => {
  assert.equal(parseQuestion(block('{ "title": "Which colour?", "header": " Background ", "options": [{ "label": "Blue" }] }'))?.header, 'Background')
  assert.equal(parseQuestion(block('{ "title": "Which colour?", "header": "", "options": [{ "label": "Blue" }] }'))?.header, undefined)
})

test('the continuation prompt names the question and the answer', () => {
  assert.equal(continuationPrompt('Ship it?', 'Approve'), 'You paused to ask: "Ship it?". The user chose: Approve. Continue with that decision.')
})
