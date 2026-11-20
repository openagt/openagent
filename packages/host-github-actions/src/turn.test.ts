import { strict as assert } from 'node:assert'
import { stat } from 'node:fs/promises'
import { test } from 'node:test'
import { runLockPath, findRun, readDiary } from '@openagt/agent-driver'
import { ACTIONS_HOST, runTurn, type GitHubAccess, type TurnDeps } from './turn.js'
import { fakeGitHub, removeRepo, testRepo, type FakeOptions } from './test-support.js'

const ID = '2026-11-19T10-00-00-000Z'
const ACCESS: GitHubAccess = { owner: 'o', repo: 'r', token: 't', login: 'octo-agent' }

/** A turn's world: the fake GitHub, the account, an instant clock for the polls. */
function world(opts: FakeOptions = {}, more: Partial<TurnDeps> = {}): { deps: TurnDeps; calls: ReturnType<typeof fakeGitHub>['calls'] } {
  const { fetch, calls } = fakeGitHub(opts)
  let clock = 0
  return {
    calls,
    deps: {
      github: async () => ACCESS,
      actions: { fetch, pollIntervalMs: 1000, timeoutMs: 10_000, now: () => clock, sleep: async ms => void (clock += ms) },
      host: 'laptop',
      ...more,
    },
  }
}

/** The kinds of a diary's lines, in order. */
const kinds = async (repo: string): Promise<string[]> => ((await readDiary(repo, ID)) ?? []).map(line => line.kind)

test('a first turn is recorded running before it is dispatched, then as it ended: its transcript, its branch and the Actions run (#2394)', async () => {
  const repo = await testRepo()
  try {
    let atDispatch: Awaited<ReturnType<typeof findRun>>
    const { deps, calls } = world({ onCall: async call => void (call.url.includes('/dispatches') && (atDispatch = await findRun(repo, ID))) }, { title: Promise.resolve('Verbose flag') })
    const card = await runTurn(repo, { id: ID, prompt: 'add a --verbose flag', model: 'claude-opus-4-8' }, deps)
    // Every computer sharing the records sees it at work while the runner is still being made.
    assert.equal(atDispatch!?.status, 'running')
    assert.equal(atDispatch!?.caller?.['target'], ACTIONS_HOST)
    assert.equal(atDispatch!?.intent, 'add a --verbose flag')
    const recorded = await findRun(repo, ID)
    assert.deepEqual(recorded, card)
    assert.equal(recorded?.status, 'done')
    assert.equal(recorded?.title, 'Verbose flag', 'named as whoever started it asked')
    assert.equal(recorded?.branch, 'claude/issue-610')
    assert.equal(recorded?.model, 'claude-opus-4-8')
    assert.equal(recorded?.caller?.['target'], ACTIONS_HOST)
    assert.equal(recorded?.caller?.['actionsRun'], 'https://github.com/o/r/actions/runs/77')
    assert.equal(recorded?.caller?.['gitAccount'], 'octo-agent')
    assert.equal(recorded?.caller?.['sessionId'], 'sess-abc')
    assert.deepEqual(await kinds(repo), ['start', 'notice', 'action', 'session', 'said', 'action', 'result', 'cost', 'ended'])
    const dispatch = calls.find(c => c.url.includes('/dispatches'))!.body as { inputs: Record<string, string> }
    assert.equal(dispatch.inputs['prompt'], 'add a --verbose flag')
    assert.equal(dispatch.inputs['model'], 'claude-opus-4-8')
    // The run's lock is let go once it is recorded: the sweep may look at it again.
    assert.equal(await stat(runLockPath(repo, ID)).then(() => true, () => false), false)
  } finally {
    await removeRepo(repo)
  }
})

test('a message goes on with an ended run: on its branch, its conversation resumed, its diary kept and added to (#2394)', async () => {
  const repo = await testRepo()
  try {
    await runTurn(repo, { id: ID, prompt: 'add a --verbose flag' }, world().deps)
    const { deps, calls } = world()
    const card = await runTurn(repo, { id: ID, prompt: 'and document it', resume: true }, deps)
    assert.equal(card.status, 'done')
    const dispatch = calls.find(c => c.url.includes('/dispatches'))!.body as { ref: string; inputs: Record<string, string> }
    assert.equal(dispatch.ref, 'claude/issue-610')
    assert.equal(dispatch.inputs['branch'], 'claude/issue-610')
    assert.equal(dispatch.inputs['prompt'], 'and document it')
    assert.equal(dispatch.inputs['resume_session_id'], 'sess-abc')
    const lines = await kinds(repo)
    assert.equal(lines.filter(kind => kind === 'start').length, 2)
    assert.equal(lines.filter(kind => kind === 'ended').length, 2)
  } finally {
    await removeRepo(repo)
  }
})

test('a run whose Actions run fails is recorded failed, naming the run (#2394)', async () => {
  const repo = await testRepo()
  try {
    const card = await runTurn(repo, { id: ID, prompt: 'go' }, world({ agents: [{ status: 'completed', conclusion: 'failure' }] }).deps)
    assert.equal(card.status, 'failed')
    const ended = ((await readDiary(repo, ID)) ?? []).at(-1)
    assert.equal(ended?.kind, 'ended')
    assert.match(String(ended?.['detail']), /concluded "failure".*runs\/77/s)
  } finally {
    await removeRepo(repo)
  }
})

test('a run whose account cannot be used is recorded failed, saying why, and nothing is dispatched (#2394)', async () => {
  const repo = await testRepo()
  try {
    const { deps, calls } = world({}, {
      github: async () => {
        throw new Error("OpenAgent has no GitHub account: add one in OpenAgent's Permissions")
      },
    })
    const card = await runTurn(repo, { id: ID, prompt: 'go' }, deps)
    assert.equal(card.status, 'failed')
    assert.equal(calls.length, 0)
    assert.match(String(((await readDiary(repo, ID)) ?? []).at(-1)?.['detail']), /no GitHub account/)
  } finally {
    await removeRepo(repo)
  }
})

test('a Stop cancels the Actions run, and the run is recorded stopped (#2394)', async () => {
  const repo = await testRepo()
  try {
    const stop = new AbortController()
    stop.abort()
    const { deps, calls } = world({ agents: [{ status: 'queued' }, { status: 'in_progress' }] }, { stop: stop.signal })
    const card = await runTurn(repo, { id: ID, prompt: 'go' }, deps)
    assert.equal(card.status, 'stopped')
    assert.ok(calls.some(c => c.method === 'POST' && c.url.endsWith('/actions/runs/77/cancel')))
  } finally {
    await removeRepo(repo)
  }
})

test('a run that did not run on GitHub Actions is not gone on with there (#2394)', async () => {
  const repo = await testRepo()
  try {
    await assert.rejects(runTurn(repo, { id: ID, prompt: 'go on', resume: true }, world().deps), /No run .* ran on GitHub Actions/)
  } finally {
    await removeRepo(repo)
  }
})
