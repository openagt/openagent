import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { provideTestContext } from './test-context.js'
import { sendStart } from './control.js'
import type { StartAgentOptions } from '../dashboard/types.js'

test('sendStart hands the trimmed prompt, the picks and the project to the daemon\'s start, and refuses an empty prompt (#1774)', async () => {
  const calls: unknown[] = []
  provideTestContext({
    startAgent: (prompt: string, options: StartAgentOptions, projectId?: string) => {
      calls.push([prompt, options, projectId])
      return { ok: true, agentId: 'run-1' }
    },
  })
  assert.deepEqual(await sendStart('p1', '  /work-queue now \n', { driver: 'codex', model: 'gpt-5' }), { ok: true, agentId: 'run-1' })
  assert.deepEqual(await sendStart('p1', 'Read the docs'), { ok: true, agentId: 'run-1' })
  assert.deepEqual(calls, [['/work-queue now', { driver: 'codex', model: 'gpt-5' }, 'p1'], ['Read the docs', {}, 'p1']])
  assert.deepEqual(await sendStart('p1', '   '), { ok: false, error: 'a non-empty prompt is required' })
  assert.equal(calls.length, 2)
})
