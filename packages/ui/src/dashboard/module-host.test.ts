import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { computerRpcHost, memorySettings } from '@openagt/hooks/testing'
import { callModuleFunction, computerHost, functionKind, serverHost, MAX_CALL_INPUT, type AppOfHost, type ServerHostDeps } from './module-host.js'
import { pullRequestState } from './pr-states.js'

/** The app a host is made of in a test: settings in memory, no account, and a lifecycle that tells nobody. */
const SETTINGS: AppOfHost = { settings: memorySettings(), gitAccess: async () => undefined, lifecycle: computerRpcHost().lifecycle }

/** A project whose runs' host knows nothing of any run: what a call about none is given. */
const NO_RUNS: ServerHostDeps = {
  projects: async () => [{ id: 'p', name: 'p', dir: '/p' }],
  accounts: { hosts: async () => [], sendAs: async () => ({ ok: false, error: 'no account' }), mergeCommit: async () => ({ pending: false }) },
  project: async () => ({ id: 'p', name: 'p', dir: '/p' }),
  find: async () => undefined,
  questions: async () => [],
  say: async () => {
    throw new Error('unknown session')
  },
  landed: async () => {
    throw new Error('unknown session')
  },
  pullRequest: async () => {
    throw new Error('unknown session')
  },
  modulesOn: async () => [],
}

test('a function is given the project it is called in, as its caller reads it, and none in a session with no project', async () => {
  assert.deepEqual(await serverHost('/p', SETTINGS, NO_RUNS).project(), { id: 'p', name: 'p', dir: '/p' })
  assert.equal(await serverHost('/sessions', SETTINGS, { ...NO_RUNS, project: async () => undefined }).project(), undefined)
})

test("where a run has its work is its host's to say, asked by the run's id; a string that is no run's id is never asked about", async () => {
  const asked: string[] = []
  const found = { checkout: '/p/.branches/agent-a', record: { status: 'running', branch: 'agent-a' }, changedNothing: false }
  const host = serverHost('/p', SETTINGS, { ...NO_RUNS, find: async agentId => (asked.push(agentId), agentId === '2026-09-16T14-01-00-000Z' ? found : undefined) })
  assert.deepEqual(await host.run('2026-09-16T14-01-00-000Z'), found)
  assert.equal(await host.run('2026-09-16T14-05-00-000Z'), undefined)
  assert.equal(await host.run('../etc'), undefined)
  assert.deepEqual(asked, ['2026-09-16T14-01-00-000Z', '2026-09-16T14-05-00-000Z'])
})

test("a run's open questions and a line said to it go through its host, by the run's id; a string that is no run's id is asked nothing and told nothing", async () => {
  const run = '2026-09-16T14-01-00-000Z'
  const question = { id: '2026-09-16T14:02:00.000Z', title: 'Which one?', options: [{ id: 'a', label: 'A' }] }
  const said: [string, unknown][] = []
  const host = serverHost('/p', SETTINGS, {
    ...NO_RUNS,
    questions: async agentId => (agentId === run ? [question] : []),
    say: async (agentId, line) => void said.push([agentId, line]),
  })
  assert.deepEqual(await host.questions(run), [question])
  assert.deepEqual(await host.questions('../etc'), [])
  await host.say(run, { kind: 'answer', question: 'Which one?', answer: 'A' })
  await assert.rejects(host.say('../etc', { kind: 'answer', question: 'Which one?', answer: 'A' }), /unknown session/)
  assert.deepEqual(said, [[run, { kind: 'answer', question: 'Which one?', answer: 'A' }]])
})

test("a pull request is written down on a run by its id alone, and how pull requests stand is kept for the lists of runs", async () => {
  const written: unknown[][] = []
  const host = serverHost('/p', SETTINGS, { ...NO_RUNS, pullRequest: async (...args) => void written.push(args) })
  await host.pullRequest('r1', { number: 5, url: 'https://github.com/o/r/pull/5' })
  await assert.rejects(host.pullRequest('../etc', { number: 5, url: 'u' }), /unknown session/)
  assert.deepEqual(written, [['r1', { number: 5, url: 'https://github.com/o/r/pull/5' }]])
  host.pullRequestsRead([{ url: 'https://github.com/o/r/pull/5', state: 'merged', title: 'A fix' }])
  assert.deepEqual(pullRequestState('https://github.com/o/r/pull/5'), { state: 'merged', title: 'A fix' })
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
    const host = serverHost('/p', SETTINGS, NO_RUNS)
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

test("a host passes the app's word on: the modules' accounts, and a project added or removed told to every module", async () => {
  const told: string[] = []
  const project = { id: 'p', name: 'p', dir: '/p' }
  const host = computerHost({
    settings: memorySettings(),
    gitAccess: async remote => (remote === 'https://example.com/o/r' ? { env: { GIT_AUTHOR_NAME: 'octo-agent' } } : undefined),
    lifecycle: {
      added: async added => void told.push(`added ${added.id}`),
      refusal: async () => 'An agent is working in this project.',
      removed: async (removed, { files }) => (told.push(`removed ${removed.id}${files ? ' with its files' : ''}`), { removed: ['.branches'], kept: [], failed: [] }),
    },
  }, NO_RUNS)
  assert.deepEqual(await host.gitAccess('https://example.com/o/r'), { env: { GIT_AUTHOR_NAME: 'octo-agent' } })
  await host.lifecycle.added(project)
  assert.equal(await host.lifecycle.refusal(project), 'An agent is working in this project.')
  assert.deepEqual(await host.lifecycle.removed(project, { files: true }), { removed: ['.branches'], kept: [], failed: [] })
  assert.deepEqual(told, ['added p', 'removed p with its files'])
})
