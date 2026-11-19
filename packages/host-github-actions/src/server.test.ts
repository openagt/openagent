import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { recordRun } from '@openagt/agent-runner'
import { rpcKind } from '@openagt/hooks/rpc'
import { rpcHost } from '@openagt/hooks/testing'
import { run } from './server.js'
import { removeRepo, testRepo } from './test-support.js'

// What the strip above a run's chat reads, from the project's records.

const card = (id: string, caller: Record<string, unknown>) => ({ id, startedAt: '2026-11-19T10:00:00.000Z', status: 'done' as const, intent: 'go', caller })

test("the strip reads the Actions run of a run on GitHub Actions, once GitHub made it; nothing of another host's run (#2394)", async () => {
  assert.equal(rpcKind(run), 'read')
  const repo = await testRepo()
  try {
    await recordRun(repo, card('2026-11-19T10-00-00-000Z', { target: 'actions', actionsRun: 'https://github.com/o/r/actions/runs/77' }), [])
    await recordRun(repo, card('2026-11-19T10-00-01-000Z', { target: 'actions' }), [])
    await recordRun(repo, card('2026-11-19T10-00-02-000Z', { target: 'actions', actionsRun: 'javascript:alert(1)' }), [])
    await recordRun(repo, card('2026-11-19T10-00-03-000Z', { host: 'laptop' }), [])
    const host = rpcHost({ root: repo })
    assert.deepEqual(await run(host, { agentId: '2026-11-19T10-00-00-000Z' }), { address: 'https://github.com/o/r/actions/runs/77' })
    assert.deepEqual(await run(host, { agentId: '2026-11-19T10-00-01-000Z' }), {})
    assert.deepEqual(await run(host, { agentId: '2026-11-19T10-00-02-000Z' }), {}, 'only a web address is linked to')
    assert.equal(await run(host, { agentId: '2026-11-19T10-00-03-000Z' }), null)
    assert.equal(await run(host, { agentId: '../../x' }), null)
    assert.equal(await run(host, { agentId: 7 } as unknown as { agentId: string }), null)
  } finally {
    await removeRepo(repo)
  }
})
