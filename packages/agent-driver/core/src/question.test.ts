import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { toolQuestion } from './question.js'

// A question asked with the agent's own tool.

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
