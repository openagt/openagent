import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { saidCall } from '@openagt/hooks'
import { CLAUDE_CODE_CALLS } from './calls.js'

const said = (label: string, detail?: string) => saidCall(CLAUDE_CODE_CALLS, label, detail)

test("Claude Code's tools read as a verb and what it was done to", () => {
  assert.deepEqual(said('Bash', 'pnpm test'), { verb: 'Ran', doing: 'Running', target: 'pnpm test', detail: 'pnpm test', kind: 'command' })
  assert.deepEqual(said('Read', '/repo/AGENTS.md'), { verb: 'Read', doing: 'Reading', target: 'AGENTS.md', detail: '/repo/AGENTS.md', path: '/repo/AGENTS.md', kind: 'read' })
  assert.equal(said('Edit', '/repo/src/app.ts').verb, 'Edited')
  assert.deepEqual(said('Write', '/repo/src/new.ts'), { verb: 'Wrote', doing: 'Writing', target: 'new.ts', detail: '/repo/src/new.ts', path: '/repo/src/new.ts', kind: 'edit' })
  // What a search looked for is in the verb's grey, as Claude Code on the web says it.
  assert.deepEqual(said('Grep', 'TODO'), { verb: 'Searched', doing: 'Searching', target: 'TODO', detail: 'TODO', kind: 'search', plain: true })
  assert.deepEqual(said('Glob', '**/*.md'), { verb: 'Searched', doing: 'Searching', target: '**/*.md', detail: '**/*.md', kind: 'find', plain: true })
  assert.deepEqual(said('Skill', 'browser'), { verb: 'Ran skill', doing: 'Running skill', target: '/browser', detail: 'browser', kind: 'skill' })
  assert.equal(said('ToolSearch', 'select:Read').verb, 'Loaded tools')
  assert.deepEqual(said('TodoWrite'), { verb: 'Updated todos', doing: 'Updating todos', kind: 'other' })
  assert.equal(said('Read', '/repo/src/').target, 'src')
})

test('every tool has its word for a call still going on', () => {
  assert.deepEqual(
    ['Bash', 'Read', 'Edit', 'Write', 'Grep', 'WebSearch', 'WebFetch', 'Skill', 'Task'].map(label => said(label).doing),
    ['Running', 'Reading', 'Editing', 'Writing', 'Searching', 'Searching the web', 'Fetching', 'Running skill', 'Starting agent'],
  )
})

test('the calls that start a subagent have the task as their detail', () => {
  assert.equal(said('Agent', 'Map the pages').task, true)
  assert.equal(said('Task', 'Map the pages').task, true)
  assert.equal(said('Bash', 'ls').task, undefined)
})

test("an MCP server's tool reads as Claude Code on the web says a connector's: the server, then the tool", () => {
  assert.deepEqual(said('mcp__github__get_me'), { verb: 'Used github:', doing: 'Using github:', target: 'Get me', kind: 'other' })
})
