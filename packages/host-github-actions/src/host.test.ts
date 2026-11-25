import { strict as assert } from 'node:assert'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { test } from 'node:test'
import { givenName, NAME_FILE_ENV, recordRun, runIdFrom, type RunCard } from '@openagt/agent-driver'
import type { ProjectRef, RunHost } from '@openagt/hooks'
import type { FetchLike } from './actions.js'
import { actionsHost, type ActionsHostDeps } from './host.js'
import { fakeGitHub, removeRepo, testRepo } from './test-support.js'
import type { GitHubAccess, TurnRequest } from './turn.js'

// GitHub Actions as a host for a project's runs: what stops a run there before its Start, a start
// handed to a turn's process of its own, what a person says to a run, a Stop's signal, and the runs
// it knows of the project's records.

const ACCESS: GitHubAccess = { owner: 'o', repo: 'r', token: 't', login: 'octo-agent' }
const NOW = new Date('2026-11-19T10:00:00.000Z')
const HERE = 'laptop'

function host(deps: ActionsHostDeps = {}): { host: RunHost; turns: TurnRequest[]; envs: Record<string, string>[] } {
  const turns: TurnRequest[] = []
  const envs: Record<string, string>[] = []
  return {
    turns,
    envs,
    host: actionsHost({
      spawnTurn: async (_dir, turn, env) => void (turns.push(turn), envs.push(env)),
      github: async () => ACCESS,
      fetch: fakeGitHub().fetch,
      host: HERE,
      now: () => NOW,
      ...deps,
    }),
  }
}

const projectAt = (dir: string): ProjectRef => ({ id: 'shop', name: 'shop', dir, remote: 'github.com/o/r' })

/** A run of the project's records: one of GitHub Actions' unless `caller` says otherwise. */
async function recorded(repo: string, id: string, status: RunCard['status'], caller: Record<string, unknown> = { target: 'actions', host: HERE }): Promise<void> {
  await recordRun(repo, { id, startedAt: id.replace(/T(\d\d)-(\d\d)-(\d\d)-(\d{3})Z$/, 'T$1:$2:$3.$4Z'), status, intent: `run ${id}`, branch: 'claude/actions-1', pr: { number: 7, url: 'https://github.com/o/r/pull/7' }, caller }, [])
}

const FIRST = '2026-11-19T09-00-00-000Z'
const SECOND = '2026-11-19T09-30-00-000Z'

test('what stops a run on GitHub Actions is said before its Start: no project, another coding agent, an account that cannot be used, a repository without the workflow (#2394)', async () => {
  const project = projectAt('/nowhere')
  const problems = async (deps: ActionsHostDeps, options = {}): Promise<string[]> => (await host(deps).host.check!({ project, options })).problems
  assert.deepEqual((await host().host.check!({ options: {} })).problems, ['GitHub Actions runs a project on GitHub: pick one.'])
  assert.deepEqual(await problems({}, { 'agent-driver': { driver: 'codex' } }), ['GitHub Actions runs Claude Code: pick it to run there.'])
  const noAccount = async (): Promise<GitHubAccess> => {
    throw new Error('This project is not on GitHub: GitHub Actions runs a project whose repository is there.')
  }
  assert.deepEqual(await problems({ github: noAccount }), ['This project is not on GitHub: GitHub Actions runs a project whose repository is there.'])
  const [missing] = await problems({ fetch: fakeGitHub({ workflow: false }).fetch })
  assert.match(missing!, /no workflow openagent-agent\.yml yet: copy the one @openagt\/host-github-actions brings \(workflow\.yml\) to \.github\/workflows\/openagent-agent\.yml, and add a CLAUDE_CODE_OAUTH_TOKEN secret/)
  // GitHub not answering is no reason to refuse the run: it is said, and the run may start.
  const down: FetchLike = async () => ({ ok: false, status: 502, statusText: 'Bad Gateway', text: async () => 'down' }) as unknown as Response
  const readiness = await host({ fetch: down }).host.check!({ project, options: {} })
  assert.deepEqual(readiness.problems, [])
  assert.match(readiness.warnings[0]!, /GitHub did not say whether the repository has its workflow: .*502/)
  assert.deepEqual(await problems({}, { 'agent-driver': { driver: 'claude-code' } }), [])
})

test("a start hands the run's first turn to a process of its own, and answers the run's id at once; one the check refuses starts nothing (#2394)", async () => {
  const { host: actions, turns, envs } = host()
  const { id } = await actions.start({ project: projectAt('/nowhere'), prompt: 'add a --verbose flag', options: { 'agent-driver': { driver: 'claude-code', model: 'claude-opus-4-8' }, github: { account: 'octo-agent' } }, title: Promise.resolve('Verbose flag') })
  assert.equal(id, runIdFrom(NOW.toISOString()))
  assert.deepEqual(turns, [{ id, prompt: 'add a --verbose flag', model: 'claude-opus-4-8', account: 'octo-agent' }])
  // The name asked for it goes to the turn's process once it is in, as a run's of this computer does.
  const file = envs[0]?.[NAME_FILE_ENV]
  assert.ok(file)
  assert.equal(await givenName(file, undefined, 5_000), 'Verbose flag')
  await actions.start({ project: projectAt('/nowhere'), prompt: 'go', options: {}, title: false })
  assert.equal(envs[1]?.[NAME_FILE_ENV], undefined, 'not named where runs are not')

  const refused = host({ fetch: fakeGitHub({ workflow: false }).fetch })
  await assert.rejects(refused.host.start({ project: projectAt('/nowhere'), prompt: 'go', options: {} }), /no workflow openagent-agent\.yml/)
  assert.deepEqual(refused.turns, [])
})

test("it knows the project's runs on GitHub Actions, and only those: where one's work is, and the list (#2394)", async () => {
  const repo = await testRepo()
  try {
    await recorded(repo, FIRST, 'done')
    await recorded(repo, SECOND, 'done', { host: HERE })
    const { host: actions } = host()
    const project = projectAt(repo)
    assert.deepEqual(await actions.find({ id: FIRST, project }), {
      record: { status: 'done', host: HERE, branch: 'claude/actions-1', pr: { number: 7, url: 'https://github.com/o/r/pull/7' } },
      changedNothing: false,
    })
    // This computer's run is its own host's to find, and a run is found in a project.
    assert.equal(await actions.find({ id: SECOND, project }), undefined)
    assert.equal(await actions.find({ id: FIRST }), undefined)
    assert.deepEqual(
      (await actions.list(project)).map(run => [run.id, run.status, run.prompt]),
      [[FIRST, 'done', `run ${FIRST}`]],
    )
    assert.deepEqual(await actions.list(), [])
  } finally {
    await removeRepo(repo)
  }
})

test('what a person says to an ended run goes on with it in a turn of its own; said to one at work, it waits for the turn to end (#2394)', async () => {
  const repo = await testRepo()
  try {
    await recorded(repo, FIRST, 'done')
    await recorded(repo, SECOND, 'running', { target: 'actions', host: HERE, runner: { host: HERE, pid: 1 } })
    const { host: actions, turns } = host()
    const project = projectAt(repo)
    await actions.resume({ id: FIRST, project }, { text: 'and document it' })
    await actions.steer({ id: FIRST, project }, { kind: 'message', text: 'add a test too' })
    // A run there asks nothing with a card of its own: an answer is a reply like any other.
    await actions.resume({ id: FIRST, project }, { answer: '--verbose' })
    assert.deepEqual(turns, [
      { id: FIRST, prompt: 'and document it', resume: true },
      { id: FIRST, prompt: 'add a test too', resume: true },
      { id: FIRST, prompt: '--verbose', resume: true },
    ])
    await assert.rejects(actions.steer({ id: SECOND, project }, { kind: 'message', text: 'faster' }), /still working on GitHub Actions: say it once its turn has ended/)
    await assert.rejects(actions.resume({ id: FIRST, project }, { text: '  ' }), /goes on with a message/)
    await assert.rejects(actions.resume({ id: '2026-11-19T08-00-00-000Z', project }, { text: 'go on' }), /did not run on GitHub Actions/)
    assert.equal(turns.length, 3)
  } finally {
    await removeRepo(repo)
  }
})

test("a Stop is a signal to the turn's process, which cancels the Actions run; a run at work on another computer is that one's to stop (#2394)", async () => {
  const repo = await testRepo()
  const turn = spawn('sleep', ['30'], { stdio: 'ignore' })
  try {
    await once(turn, 'spawn')
    await recorded(repo, FIRST, 'running', { target: 'actions', host: HERE, runner: { host: HERE, pid: turn.pid } })
    await recorded(repo, SECOND, 'running', { target: 'actions', host: 'desk', runner: { host: 'desk', pid: turn.pid } })
    const { host: actions } = host({ isAlive: () => true })
    const project = projectAt(repo)
    await assert.rejects(actions.stop({ id: SECOND, project }), /This run is on desk/)
    const [, signal] = await Promise.all([actions.stop({ id: FIRST, project }), once(turn, 'exit').then(([, signal]) => signal)])
    assert.equal(signal, 'SIGINT')
    await recorded(repo, FIRST, 'stopped')
    await assert.rejects(actions.stop({ id: FIRST, project }), /already ended/)
  } finally {
    turn.kill()
    await removeRepo(repo)
  }
})
