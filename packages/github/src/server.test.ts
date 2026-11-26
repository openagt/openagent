import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { RunFound } from '@openagt/hooks'
import { rpcHost } from '@openagt/hooks/testing'
import { runPrs } from './server.js'

// The run's pull requests, as the row above its message box shows them.

const RUN = '2026-11-26T00-43-44-681Z'
const found = (record: Record<string, unknown>): RunFound => ({ record: { status: 'done', ...record } }) as unknown as RunFound

test("a run's copies' pull requests are its own too, after the project's: a session with no project has only theirs", async () => {
  const own = { number: 47, url: 'https://github.com/o/test-project/pull/47' }
  const copy = { repo: 'oa-newuser', number: 9, url: 'https://github.com/o/oa-newuser/pull/9' }
  const both = rpcHost({ root: '/nowhere', run: async () => found({ pr: own, copyPrs: [copy] }) })
  assert.deepEqual((await runPrs(both, { agentId: RUN })).map(pr => pr.number), [47, 9])
  const copiesOnly = rpcHost({ root: '/nowhere', run: async () => found({ copyPrs: [copy] }) })
  assert.deepEqual(await runPrs(copiesOnly, { agentId: RUN }), [{ number: 9, url: copy.url }])
})
