import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { saidCall, type AgentCalls } from './calls.js'

// A coding agent's words, as a sample: one of each way a detail is said, and a family of names.
const CALLS: AgentCalls = {
  tools: {
    shell: { verb: 'Ran', doing: 'Running', kind: 'command' },
    open: { verb: 'Read', doing: 'Reading', kind: 'read', detail: 'path' },
    find: { verb: 'Searched', doing: 'Searching', kind: 'search', detail: 'query' },
    skill: { verb: 'Ran skill', doing: 'Running skill', kind: 'skill', detail: 'slash' },
    spawn: { verb: 'Started agent', doing: 'Starting agent', kind: 'other', detail: 'task' },
  },
  families: [{ pattern: 'tool:(\\w+):(\\w+)', verb: 'Used $1:', doing: 'Using $1:', target: '$2', kind: 'other' }],
}

test("a call reads by its tool's words, its detail as the tool says it is", () => {
  assert.deepEqual(saidCall(CALLS, 'shell', 'pnpm test'), { verb: 'Ran', doing: 'Running', target: 'pnpm test', detail: 'pnpm test', kind: 'command' })
  assert.deepEqual(saidCall(CALLS, 'open', '/repo/AGENTS.md'), { verb: 'Read', doing: 'Reading', target: 'AGENTS.md', detail: '/repo/AGENTS.md', path: '/repo/AGENTS.md', kind: 'read' })
  // Several paths are each said by their name, and open none.
  assert.deepEqual(saidCall(CALLS, 'open', '/repo/a.ts, /repo/src/'), { verb: 'Read', doing: 'Reading', target: 'a.ts, src', detail: '/repo/a.ts, /repo/src/', kind: 'read' })
  assert.deepEqual(saidCall(CALLS, 'find', 'TODO'), { verb: 'Searched', doing: 'Searching', target: 'TODO', detail: 'TODO', kind: 'search', plain: true })
  assert.equal(saidCall(CALLS, 'skill', 'github').target, '/github')
  assert.equal(saidCall(CALLS, 'skill', '/github').target, '/github')
  assert.equal(saidCall(CALLS, 'spawn', 'Map the pages').task, true)
})

test("a family's call puts its groups in its words, the target said as words, unless a detail says it", () => {
  assert.deepEqual(saidCall(CALLS, 'tool:github:get_me'), { verb: 'Used github:', doing: 'Using github:', target: 'Get me', kind: 'other' })
  assert.equal(saidCall(CALLS, 'tool:github:get_me', 'me').target, 'me')
  // The pattern matches the label whole.
  assert.equal(saidCall(CALLS, 'a tool:github:get_me').verb, 'a tool:github:get_me')
})

test('a label no words are given for is its own verb: a camel-case name as words, any other as it is', () => {
  assert.deepEqual(saidCall(CALLS, 'imageView'), { verb: 'Image view', doing: 'Image view', kind: 'other' })
  assert.deepEqual(saidCall(undefined, 'run https://example.test/1'), { verb: 'run https://example.test/1', doing: 'run https://example.test/1', kind: 'other' })
  // A name every object has is no tool of the agent's.
  assert.deepEqual(saidCall(CALLS, 'constructor'), { verb: 'constructor', doing: 'constructor', kind: 'other' })
})
