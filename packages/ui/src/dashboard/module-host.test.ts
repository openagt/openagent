import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BranchesFor, BranchesSource, Checkout } from '../store/branches.js'
import { callModuleRead, serverHost, MAX_READ_INPUT, type ServerHostDeps } from './module-host.js'

const listing = (checkouts: Checkout[]): BranchesFor => async () => ({ list: async () => checkouts }) as unknown as BranchesSource

/** The deps for a project whose runs have the given checkouts and records. */
function deps(checkouts: Checkout[], records: Record<string, { status?: string; host?: string; branch?: string; pr?: { number: number }; base?: string; baseCommit?: string; landed?: string }>): ServerHostDeps {
  return {
    host: 'this-machine',
    branches: listing(checkouts),
    agent: async (_root, id) => (records[id] ? { id, ...records[id] } : undefined),
  }
}

test('a run’s facts: its checkout, its record, and whether it ended here having changed nothing', async () => {
  const host = serverHost('/p', deps([{ id: 'run-a', path: '/p/.branches/agent-a' } as Checkout], {
    'run-a': { status: 'running', host: 'this-machine', branch: 'agent-a' },
    'run-b': { status: 'done', host: 'this-machine', branch: 'agent-b' },
    'run-c': { status: 'done', host: 'other-machine', branch: 'agent-c' },
    'run-d': { status: 'done', host: 'this-machine', branch: 'agent-d', pr: { number: 4 } },
  }))
  assert.deepEqual(await host.run('run-a'), { checkout: '/p/.branches/agent-a', record: { status: 'running', host: 'this-machine', branch: 'agent-a' }, changedNothing: false })
  assert.equal((await host.run('run-b'))?.changedNothing, true)
  assert.equal((await host.run('run-c'))?.changedNothing, false, 'another machine’s run may just not have its branch here')
  assert.equal((await host.run('run-d'))?.changedNothing, false, 'a run with a pull request changed something')
  assert.deepEqual((await host.run('run-d'))?.record?.pr, { number: 4 })
  assert.equal(await host.run('run-z'), undefined, 'no checkout and no record: no run')
})

test('a run’s facts carry the commit its own work begins at and the commit it was landed at; a landed run did not change nothing', async () => {
  const host = serverHost('/p', deps([], {
    'run-b': { status: 'running', host: 'this-machine', base: 'my-branch' },
    'run-s': { status: 'done', host: 'this-machine', branch: 'agent-s', baseCommit: 'b'.repeat(40) },
    'run-l': { status: 'done', host: 'this-machine', baseCommit: 'b'.repeat(40), landed: 'c'.repeat(40) },
  }))
  assert.deepEqual((await host.run('run-b'))?.record, { status: 'running', host: 'this-machine', base: 'my-branch' }, 'the branch it was told to start from')
  assert.deepEqual((await host.run('run-s'))?.record, { status: 'done', host: 'this-machine', branch: 'agent-s', baseCommit: 'b'.repeat(40) })
  assert.deepEqual(await host.run('run-l'), { record: { status: 'done', host: 'this-machine', baseCommit: 'b'.repeat(40), landed: 'c'.repeat(40) }, changedNothing: false })
  assert.equal(await host.run('../etc'), undefined, 'a string that is no run id is never looked up')
})

test('a merge lookup says "still asking" only while the git host has not answered at all', async () => {
  const answering = (value: { number: number; mergeCommit?: string; headRefOid?: string }[] | undefined, pending: boolean): ServerHostDeps => ({
    prs: async () => ({ value: value as never, pending }),
  })
  assert.deepEqual(await serverHost('/p', answering(undefined, true)).mergeCommit('b', 1), { pending: true })
  assert.deepEqual(await serverHost('/p', answering([{ number: 1, mergeCommit: 'abc' }], true)).mergeCommit('b', 1), { pending: false, commit: 'abc' })
  assert.deepEqual(await serverHost('/p', answering([{ number: 2, mergeCommit: 'abc' }], false)).mergeCommit('b', 1), { pending: false })
  // The last commit of the branch the request merged rides along when the git host says it.
  assert.deepEqual(await serverHost('/p', answering([{ number: 1, mergeCommit: 'abc', headRefOid: 'def' }], false)).mergeCommit('b', 1), { pending: false, commit: 'abc', head: 'def' })
  assert.deepEqual(await serverHost('/p', answering([{ number: 1, headRefOid: 'def' }], false)).mergeCommit('b', 1), { pending: false })
  assert.deepEqual(await serverHost('/p', { prs: async () => Promise.reject(new Error('offline')) }).mergeCommit('b', 1), { pending: false })
})

test('a read is called with the host and the input, and whatever goes wrong answers an error', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'module-host-'))
  try {
    const file = join(dir, 'server.mjs')
    await writeFile(file, `export default { reads: {
      echo: async (host, input) => ({ root: host.root, input }),
      nothing: async () => undefined,
      throws: async () => { throw new Error('broken read') },
      hangs: () => new Promise(() => {}),
    } }`)
    const host = serverHost('/p', deps([], {}))
    assert.deepEqual(await callModuleRead(file, 'echo', host, { agentId: 'run-a', path: 'x' }), { ok: true, output: { root: '/p', input: { agentId: 'run-a', path: 'x' } } })
    assert.deepEqual(await callModuleRead(file, 'nothing', host, {}), { ok: true, output: null })
    assert.deepEqual(await callModuleRead(file, 'throws', host, {}), { ok: false, error: 'broken read' })
    assert.deepEqual(await callModuleRead(file, 'hangs', host, {}, 20), { ok: false, error: 'the read hangs took too long' })
    assert.deepEqual(await callModuleRead(file, 'missing', host, {}), { ok: false, error: 'the module has no read missing' })
    assert.deepEqual(await callModuleRead(file, 'toString', host, {}), { ok: false, error: 'the module has no read toString' })
    assert.deepEqual(await callModuleRead(file, 'echo', host, ['x']), { ok: false, error: 'a read takes an object' })
    assert.deepEqual(await callModuleRead(file, 'echo', host, { big: 'x'.repeat(MAX_READ_INPUT) }), { ok: false, error: 'the read input is too large' })

    const broken = join(dir, 'broken.mjs')
    await writeFile(broken, 'export default 42')
    assert.deepEqual(await callModuleRead(broken, 'echo', host, {}), { ok: false, error: 'the module’s server part did not load' })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
