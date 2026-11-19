import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BranchesFor, BranchesSource, Checkout } from '../store/branches.js'
import { memorySettings } from '@openagt/hooks/testing'
import { callModuleFunction, functionKind, serverHost, MAX_CALL_INPUT, type ServerHostDeps } from './module-host.js'

const SETTINGS = memorySettings()

const listing = (checkouts: Checkout[]): BranchesFor => async () => ({ list: async () => checkouts }) as unknown as BranchesSource

/** The deps for a project whose runs have the given checkouts and records. */
function deps(checkouts: Checkout[], records: Record<string, { status?: string; host?: string; branch?: string; pr?: { number: number }; base?: string; baseCommit?: string; landed?: string }>): ServerHostDeps {
  return {
    host: 'this-machine',
    branches: listing(checkouts),
    agent: async (_root, id) => (records[id] ? { id, ...records[id] } : undefined),
  }
}

test('what is known of a run: its checkout, its record, and whether it ended here having changed nothing', async () => {
  const host = serverHost('/p', SETTINGS, deps([{ id: 'run-a', path: '/p/.branches/agent-a' } as Checkout], {
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

test('what is known of a run carries the commit its own work begins at and the commit it was landed at; a landed run did not change nothing', async () => {
  const host = serverHost('/p', SETTINGS, deps([], {
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
  assert.deepEqual(await serverHost('/p', SETTINGS, answering(undefined, true)).mergeCommit('b', 1), { pending: true })
  assert.deepEqual(await serverHost('/p', SETTINGS, answering([{ number: 1, mergeCommit: 'abc' }], true)).mergeCommit('b', 1), { pending: false, commit: 'abc' })
  assert.deepEqual(await serverHost('/p', SETTINGS, answering([{ number: 2, mergeCommit: 'abc' }], false)).mergeCommit('b', 1), { pending: false })
  // The last commit of the branch the request merged rides along when the git host says it.
  assert.deepEqual(await serverHost('/p', SETTINGS, answering([{ number: 1, mergeCommit: 'abc', headRefOid: 'def' }], false)).mergeCommit('b', 1), { pending: false, commit: 'abc', head: 'def' })
  assert.deepEqual(await serverHost('/p', SETTINGS, answering([{ number: 1, headRefOid: 'def' }], false)).mergeCommit('b', 1), { pending: false })
  assert.deepEqual(await serverHost('/p', SETTINGS, { prs: async () => Promise.reject(new Error('offline')) }).mergeCommit('b', 1), { pending: false })
})

test('a function is called with the host and the input, and whatever goes wrong answers an error; whether it reads or acts is its own word', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'module-host-'))
  try {
    const file = join(dir, 'server.mjs')
    await writeFile(
      file,
      `import { act, read } from ${JSON.stringify(import.meta.resolve('@openagt/hooks/rpc'))}
export const echo = read(async (host, input) => ({ root: host.root, input }))
export const nothing = read(async () => undefined)
export const throws = read(async () => { throw new Error('broken read') })
export const hangs = read(() => new Promise(() => {}))
export const claim = act(async (host, input) => ({ claimed: input.id }))
export const plain = async () => 'not wrapped'
export default { echo }`,
    )
    const host = serverHost('/p', SETTINGS, deps([], {}))
    assert.deepEqual(await callModuleFunction(file, 'echo', host, { agentId: 'run-a', path: 'x' }), { ok: true, output: { root: '/p', input: { agentId: 'run-a', path: 'x' } } })
    assert.deepEqual(await callModuleFunction(file, 'claim', host, { id: 't1' }), { ok: true, output: { claimed: 't1' } })
    assert.deepEqual(await callModuleFunction(file, 'nothing', host, {}), { ok: true, output: null })
    assert.deepEqual(await callModuleFunction(file, 'throws', host, {}), { ok: false, error: 'broken read' })
    assert.deepEqual(await callModuleFunction(file, 'hangs', host, {}, 20), { ok: false, error: 'the call hangs took too long' })
    // What the file exports beside its functions is none of them: a plain function, its default, a name off the prototype.
    for (const name of ['missing', 'plain', 'default', 'toString']) assert.deepEqual(await callModuleFunction(file, name, host, {}), { ok: false, error: `the module has no function ${name}` })
    assert.deepEqual(await callModuleFunction(file, 'echo', host, ['x']), { ok: false, error: 'a call takes an object' })
    assert.deepEqual(await callModuleFunction(file, 'echo', host, { big: 'x'.repeat(MAX_CALL_INPUT) }), { ok: false, error: 'the call input is too large' })
    assert.deepEqual(await Promise.all(['echo', 'claim', 'plain', 'missing'].map(name => functionKind(file, name))), ['read', 'act', undefined, undefined])

    const broken = join(dir, 'broken.mjs')
    await writeFile(broken, 'export const echo = ')
    assert.deepEqual(await callModuleFunction(broken, 'echo', host, {}), { ok: false, error: 'the module’s server part did not load' })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
