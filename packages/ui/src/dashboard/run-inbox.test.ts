import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fakeHost } from '@openagt/hooks/testing'
import { provideTestContext } from '../dashboard-rpc/test-context.js'
import { SESSIONS_ID } from '../project-address.js'
import { sayToRun } from './run-inbox.js'

// What a person says to a run goes to this computer's host, with the run and its project; what
// the host refuses is said in its words. The host's own way with a working run and an ended one
// is agent-runner's (`host.test.ts`).

test('a line goes to the host with the run and its project, and a session with no project names none', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'openagent-run-inbox-')))
  const host = fakeHost()
  provideTestContext({ host })
  try {
    const { id } = await host.start({ prompt: 'fix it', options: {} })
    assert.deepEqual(await sayToRun('shop', dir, id, { kind: 'message', text: 'also add tests', publish: 'pr' }), { ok: true })
    assert.deepEqual(host.steered, [{ id, line: { kind: 'message', text: 'also add tests', publish: 'pr' } }])
    const asked: unknown[] = []
    provideTestContext({ host: { ...host, steer: async (run, line) => void asked.push([run, line]) } })
    await sayToRun(SESSIONS_ID, dir, id, { kind: 'now' })
    await sayToRun('shop', dir, id, { kind: 'now' })
    assert.deepEqual(asked, [
      [{ id }, { kind: 'now' }],
      [{ id, project: { id: 'shop', name: basename(dir), dir } }, { kind: 'now' }],
    ])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('what the host refuses is said in its own words', async () => {
  provideTestContext({ host: { ...fakeHost(), steer: async () => { throw new Error('no run r1 in this project') } } })
  assert.deepEqual(await sayToRun('shop', '/work/shop', 'r1', { kind: 'message', text: 'go on' }), { ok: false, error: 'no run r1 in this project' })
})
