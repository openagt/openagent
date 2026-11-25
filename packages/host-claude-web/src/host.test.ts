import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { ProjectRef, RunHost, RunOptions } from '@openagt/hooks'
import { readDiary } from '@openagt/agent-driver'
import { bridgeStarts, resetBridgeStarts } from './bridge-starts.js'
import { NOT_ON_GITHUB } from './github.js'
import { NO_EXTENSION, UNMADE } from './hand-off.js'
import { webHost, type WebHostDeps } from './host.js'
import { git, recorded, removeRepo, testRepo, until } from './test-support.js'
import { WEB_HOST, findWebRun } from './web-runs.js'

// Claude Code on the web as a host for a project's runs: what stops a run there before its Start,
// its start, what a person says to it, a Stop, and the runs it knows of the project's records.

const NOW = new Date('2026-11-19T12:00:00.000Z')
const HERE = 'laptop'

const projectAt = (dir: string): ProjectRef => ({ id: 'shop', name: 'shop', dir, remote: 'github.com/o/r' })

function host(over: WebHostDeps = {}): RunHost {
  return webHost({ repo: async () => 'o/r', extensionAlive: () => true, account: async () => ({ login: 'octo-agent', git }), host: HERE, now: () => NOW, pollMs: 5, ...over })
}

test('what stops a run on the web is said before its Start: no project, another coding agent, a project not on GitHub, no extension (#2394)', async () => {
  const project = projectAt('/nowhere')
  const problems = async (over: WebHostDeps, options: RunOptions = {}): Promise<string[]> => (await host(over).check!({ project, options })).problems
  assert.deepEqual((await host().check!({ options: {} })).problems, ['A Claude Code cloud session works on a project on GitHub: pick one.'])
  assert.deepEqual(await problems({}, { 'agent-driver': { driver: 'codex' } }), ['Claude Code on the web runs Claude Code: pick it to run there.'])
  const notOnGitHub = async (): Promise<string> => {
    throw new Error(NOT_ON_GITHUB)
  }
  assert.deepEqual(await problems({ repo: notOnGitHub }), [NOT_ON_GITHUB])
  assert.deepEqual(await problems({ extensionAlive: () => false }), [NO_EXTENSION])
  assert.deepEqual(await problems({}, { 'agent-driver': { driver: 'claude-code' } }), [])
})

test('a start takes the model and the account the Start picked (#2394)', async () => {
  resetBridgeStarts()
  const repo = await testRepo()
  try {
    const asked: (string | undefined)[] = []
    const web = host({ account: async (_dir, account) => (asked.push(account), { login: account ?? 'octo-agent', git }) })
    const { id } = await web.start({ project: projectAt(repo), prompt: 'go', options: { 'agent-driver': { driver: 'claude-code', model: 'sonnet' }, github: { account: 'octo-other' } } })
    assert.deepEqual(asked, ['octo-other'])
    const start = await until(async () => bridgeStarts().claimNext(), taken => taken !== undefined, 'the start to be queued')
    assert.equal(start!.model, 'sonnet')
    assert.equal((await findWebRun(repo, id))?.card.caller?.['gitAccount'], 'octo-other')
    // A Stop while the session is being made gives the hand-off up.
    await web.stop({ id, project: projectAt(repo) })
    // Read back, then stopped: the card is rewritten in place, and a read in the middle of the write finds no run.
    const stopped = await until(() => findWebRun(repo, id), run => run !== undefined && run.card.status !== 'running', 'the run to stop')
    assert.equal(stopped!.card.status, 'stopped')
  } finally {
    await removeRepo(repo)
    resetBridgeStarts()
  }
})

test("what a person says to a run on the web is said in its session; a run of another host's is none of this host's (#2394)", async () => {
  const repo = await testRepo()
  try {
    const project = projectAt(repo)
    await recorded(repo, '2026-11-19T10-00-00-000Z', {}, { sessionId: 'session_01S' })
    await recorded(repo, '2026-11-19T10-00-01-000Z', {}, { target: 'actions' })
    const web = host()
    for (const say of [web.resume!, web.steer!]) {
      await assert.rejects(say({ id: '2026-11-19T10-00-00-000Z', project }, { prompt: 'and then' } as never), { message: 'It runs as a Claude Code cloud session: say it, or stop it, in its session on claude.ai.' })
      await assert.rejects(say({ id: '2026-11-19T10-00-01-000Z', project }, { prompt: 'and then' } as never), { message: 'This run did not run as a Claude Code cloud session.' })
    }
  } finally {
    await removeRepo(repo)
  }
})

test('a Stop: a session already made is stopped over there; a hand-off of another computer there; one that ended with OpenAgent here ends now (#2394)', async () => {
  const repo = await testRepo()
  try {
    const project = projectAt(repo)
    await recorded(repo, '2026-11-19T10-00-00-000Z', {}, { sessionId: 'session_01S' })
    await recorded(repo, '2026-11-19T10-00-01-000Z', {}, { host: 'desk' })
    await recorded(repo, '2026-11-19T10-00-02-000Z')
    await recorded(repo, '2026-11-19T10-00-03-000Z', { status: 'done' })
    const web = host()
    await assert.rejects(web.stop({ id: '2026-11-19T10-00-00-000Z', project }), { message: 'It runs as a Claude Code cloud session: say it, or stop it, in its session on claude.ai.' })
    await assert.rejects(web.stop({ id: '2026-11-19T10-00-01-000Z', project }), { message: 'Its hand-off runs on another computer: stop it there.' })
    await assert.rejects(web.stop({ id: '2026-11-19T10-00-03-000Z', project }), { message: 'It had already ended.' })
    await assert.rejects(web.stop({ id: '2026-11-19T09-00-00-000Z', project }), { message: 'This run did not run as a Claude Code cloud session.' })
    await web.stop({ id: '2026-11-19T10-00-02-000Z', project })
    assert.equal((await findWebRun(repo, '2026-11-19T10-00-02-000Z'))?.card.status, 'stopped')
    assert.deepEqual((await readDiary(repo, '2026-11-19T10-00-02-000Z'))?.at(-1), { kind: 'ended', status: 'stopped', detail: UNMADE, at: NOW.toISOString() })
  } finally {
    await removeRepo(repo)
  }
})

test("the host lists the project's runs on the web, and finds one by its record: never a checkout of this computer's (#2394)", async () => {
  const repo = await testRepo()
  try {
    const project = projectAt(repo)
    await recorded(repo, '2026-11-19T10-00-00-000Z', { title: 'Add a flag' }, { sessionId: 'session_01S' })
    await recorded(repo, '2026-11-19T11-00-00-000Z', { status: 'done', endedAt: '2026-11-19T11:30:00.000Z', branch: 'claude/add-flag', pr: { number: 9, url: 'https://github.com/o/r/pull/9' } })
    await recorded(repo, '2026-11-19T11-30-00-000Z', {}, { target: 'actions' })
    const web = host()
    const listed = await web.list!(project)
    assert.deepEqual(
      listed.map(run => [run.id, run.host, run.project, run.status, run.endedAt, run.title, run.prompt, run.facts?.github?.pr?.number, run.facts?.['git-branches']?.branch, run.session?.id, run.computer]),
      [
        ['2026-11-19T11-00-00-000Z', WEB_HOST, 'shop', 'done', '2026-11-19T11:30:00.000Z', undefined, 'run 2026-11-19T11-00-00-000Z', 9, 'claude/add-flag', undefined, HERE],
        ['2026-11-19T10-00-00-000Z', WEB_HOST, 'shop', 'working', undefined, 'Add a flag', 'run 2026-11-19T10-00-00-000Z', undefined, undefined, 'session_01S', HERE],
      ],
    )
    assert.deepEqual((await web.list!(project, { ids: ['2026-11-19T10-00-00-000Z'] })).map(run => run.id), ['2026-11-19T10-00-00-000Z'])
    assert.deepEqual(await web.list!(), [])
    assert.deepEqual(await web.find!({ id: '2026-11-19T11-00-00-000Z', project }), { record: { status: 'done', host: HERE, branch: 'claude/add-flag', pr: { number: 9, url: 'https://github.com/o/r/pull/9' } }, changedNothing: false })
    assert.equal(await web.find!({ id: '2026-11-19T11-30-00-000Z', project }), undefined)
    assert.equal(await web.find!({ id: '2026-11-19T11-00-00-000Z' }), undefined, 'a run of no project is none of this host')
  } finally {
    await removeRepo(repo)
  }
})
