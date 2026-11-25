import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { GitRunner, ProjectRef } from '@openagt/hooks'
import { readDiary, type AnyDiaryLine } from '@openagt/agent-driver'
import { bridgeStarts, resetBridgeStarts, type BridgeStartRequest } from './bridge-starts.js'
import { NOT_ON_GITHUB } from './github.js'
import { NO_EXTENSION, anchorRefOf, giveUp, handingOff, startWebRun, type HandOffDeps } from './hand-off.js'
import { git, originHas, removeRepo, testRepo, until } from './test-support.js'
import { findWebRun, type WebRun } from './web-runs.js'

// A run handed to Claude Code on the web: recorded at once, its start pushed for the session to
// start at, the session asked of the extension, and the record told how that went.

const NOW = new Date('2026-11-19T10:00:00.000Z')
const ID = '2026-11-19T10-00-00-000Z'

const projectAt = (dir: string): ProjectRef => ({ id: 'shop', name: 'shop', dir, remote: 'github.com/o/r' })

function deps(over: HandOffDeps = {}): HandOffDeps {
  return { repo: async () => 'o/r', extensionAlive: () => true, account: async () => ({ login: 'octo-agent', git }), host: 'laptop', now: () => NOW, pollMs: 5, ...over }
}

/** The extension, as the bridge sees it: it takes the start queued, and says how it went. */
async function extensionTakes(ok: boolean, sessionId?: string, note?: string): Promise<BridgeStartRequest> {
  const start = await until(async () => bridgeStarts().claimNext(), taken => taken !== undefined, 'the start to be queued')
  bridgeStarts().resolve(start!.id, ok, sessionId, note)
  return start!
}

/** The run once it ended, and the last line of its diary. */
async function ended(repo: string, id: string): Promise<{ run: WebRun; last: AnyDiaryLine | undefined }> {
  const run = await until(() => findWebRun(repo, id), found => found !== undefined && found.card.status !== 'running', 'the run to end')
  return { run: run!, last: (await readDiary(repo, id))?.at(-1) }
}

/** Run `body` with a project of its own and the extension's queue empty. */
async function withProject(body: (repo: string) => Promise<void>): Promise<void> {
  resetBridgeStarts()
  const repo = await testRepo()
  try {
    await body(repo)
  } finally {
    await removeRepo(repo)
    resetBridgeStarts()
  }
}

test('a start is refused in words for the person where its project is not on GitHub, or no extension is there to make its session; nothing is recorded (#2394)', () =>
  withProject(async repo => {
    const notOnGitHub = async (): Promise<string> => {
      throw new Error(NOT_ON_GITHUB)
    }
    await assert.rejects(startWebRun(projectAt(repo), { prompt: 'go' }, deps({ repo: notOnGitHub })), { message: NOT_ON_GITHUB })
    await assert.rejects(startWebRun(projectAt(repo), { prompt: 'go' }, deps({ extensionAlive: () => false })), { message: NO_EXTENSION })
    assert.equal(await findWebRun(repo, ID), undefined)
    assert.deepEqual(bridgeStarts().list(), [])
  }))

test('a start is recorded at once; its start, an empty commit on the checkout, is pushed to a branch of its own; once the extension made the session, the record names it (#610, #1328, #1601)', () =>
  withProject(async repo => {
    const { id } = await startWebRun(projectAt(repo), { prompt: 'Add the flag', model: 'opus', title: Promise.resolve('Add a flag') }, deps())
    assert.equal(id, ID)
    const first = await findWebRun(repo, id)
    assert.deepEqual([first?.card.status, first?.card.intent, first?.card.driver, first?.card.model], ['running', 'Add the flag', 'claude-code', 'opus'])
    assert.deepEqual(first?.card.caller, { target: 'web', host: 'laptop', gitAccount: 'octo-agent' })
    assert.equal(handingOff(id), true)
    const start = await extensionTakes(true, 'session_01Made')
    assert.deepEqual([start.repo, start.branch, start.prompt, start.model], ['o/r', anchorRefOf(id), 'Add the flag', 'opus'])
    const made = await until(() => findWebRun(repo, id), run => run?.session !== undefined, 'the session on the record')
    assert.deepEqual(made!.session, { id: 'session_01Made', url: 'https://claude.ai/code/session_01Made' })
    // At work for as long as its session may be: the pass ends it.
    assert.equal(made!.card.status, 'running')
    assert.equal(made!.card.title, 'Add a flag', 'its name, written as it came in')
    // Its start: an empty commit of its own on the checkout's HEAD, on origin, slash-free.
    assert.equal(made!.anchorRef, `openagent-web-${id}`)
    assert.equal(await originHas(repo, made!.anchorRef!), made!.anchor)
    assert.equal((await git(['rev-parse', `${made!.anchor}^`], repo)).trim(), (await git(['rev-parse', 'HEAD'], repo)).trim())
    assert.equal((await git(['rev-parse', `${made!.anchor}^{tree}`], repo)).trim(), (await git(['rev-parse', 'HEAD^{tree}'], repo)).trim())
    const diary = (await readDiary(repo, id)) ?? []
    assert.deepEqual(diary.map(line => line.kind), ['start', 'result'])
    const result = diary.at(-1)
    assert.match(result?.kind === 'result' ? String(result.text) : '', /claude\.ai\/code\/session_01Made[\s\S]*claude --teleport session_01Made/)
    await until(async () => handingOff(id), under => !under, 'the hand-off to be over')
    assert.equal(bridgeStarts().get(start.id), undefined, 'its start is no longer queued')
  }))

test('an extension that could not make the session fails the run, in its own words; the start stays on origin for the pass to sweep (#1328)', () =>
  withProject(async repo => {
    const { id } = await startWebRun(projectAt(repo), { prompt: 'go' }, deps())
    await extensionTakes(false, undefined, 'not signed in to claude.ai')
    const { run, last } = await ended(repo, id)
    assert.equal(run.card.status, 'failed')
    assert.equal(run.card.endedAt, NOW.toISOString())
    assert.deepEqual(last, { kind: 'ended', status: 'failed', detail: 'The extension could not make its session: not signed in to claude.ai.', at: NOW.toISOString() })
    assert.equal(run.anchorRef, anchorRefOf(id))
    assert.equal(await originHas(repo, anchorRefOf(id)), run.anchor)
  }))

test('a Stop while the session is being made gives the hand-off up: the run stopped (#2394)', () =>
  withProject(async repo => {
    const { id } = await startWebRun(projectAt(repo), { prompt: 'go' }, deps())
    await until(async () => bridgeStarts().list().length, queued => queued > 0, 'the start to be queued')
    assert.equal(giveUp(id), true)
    const { run, last } = await ended(repo, id)
    assert.equal(run.card.status, 'stopped')
    assert.equal(last?.kind === 'ended' && last.detail, 'Stopped before its cloud session was made.')
    await until(async () => handingOff(id), under => !under, 'the hand-off to be over')
    assert.equal(giveUp(id), false, 'nothing is under way any more')
  }))

test('a start that cannot be pushed, or that no extension takes in time, fails the run, saying so (#1320, #1328)', () =>
  withProject(async repo => {
    const refused: GitRunner = async (args, cwd) => (args[0] === 'push' ? Promise.reject(new Error('denied')) : git(args, cwd))
    const unpushed = await startWebRun(projectAt(repo), { prompt: 'go' }, deps({ account: async () => ({ login: 'octo-agent', git: refused }) }))
    const first = await ended(repo, unpushed.id)
    assert.equal(first.run.card.status, 'failed')
    assert.match(first.last?.kind === 'ended' ? String(first.last.detail) : '', /^Its start could not be pushed to origin as openagent-web-\S+ \(denied\)/)
    assert.equal(first.run.anchorRef, undefined, 'nothing was pushed to sweep')
    const later = new Date(NOW.getTime() + 1000)
    const untaken = await startWebRun(projectAt(repo), { prompt: 'go' }, deps({ now: () => later, timeoutMs: 50 }))
    const second = await ended(repo, untaken.id)
    assert.equal(second.last?.kind === 'ended' && second.last.detail, 'No extension took the start in time: is its browser still open?')
  }))
