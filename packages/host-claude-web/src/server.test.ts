import { strict as assert } from 'node:assert'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { rpcKind } from '@openagt/hooks/rpc'
import { computerRpcHost, rpcHost } from '@openagt/hooks/testing'
import { bridgeQuestions, resetBridgeQuestions } from './bridge-store.js'
import { answer, bridge, browserAction, cancel, pickBrowser, run, token } from './server.js'
import { BROWSER } from './settings.js'
import { ensureToken } from './token.js'
import { recorded, removeRepo, testRepo } from './test-support.js'

// What the strip above a web run's chat reads and answers with, and what Settings › Claude web
// reads and saves.

const QUESTION = { sessionId: 'session_01A', title: 'Which flag?', options: [{ label: '--verbose' }, { label: '--quiet' }], receivedAt: '2026-11-19T11:00:00.000Z' }

test('the strip reads its run’s session, the question the session is parked on, the pick on its way and the mirror; nothing of another host’s run (#1237, #1265, #2394)', async () => {
  assert.equal(rpcKind(run), 'read')
  resetBridgeQuestions()
  const repo = await testRepo()
  try {
    await recorded(repo, '2026-11-19T10-00-00-000Z', {}, { sessionId: 'session_01A' })
    await recorded(repo, '2026-11-19T10-00-01-000Z')
    await recorded(repo, '2026-11-19T10-00-02-000Z', {}, { target: 'actions' })
    const store = bridgeQuestions()
    store.record(QUESTION)
    store.recordEvent({ sessionId: 'session_01A', seq: 0, role: 'agent', text: 'Reading the repo', receivedAt: '2026-11-19T11:00:00.000Z' })
    const host = rpcHost({ root: repo })
    const read = await run(host, { agentId: '2026-11-19T10-00-00-000Z' })
    assert.deepEqual(read?.session, { id: 'session_01A', url: 'https://claude.ai/code/session_01A' })
    assert.equal(read?.question?.title, 'Which flag?')
    assert.equal(read?.answer, undefined)
    assert.deepEqual(read?.mirror.map(event => event.text), ['Reading the repo'])
    assert.deepEqual(await run(host, { agentId: '2026-11-19T10-00-01-000Z' }), { mirror: [] }, 'its session not made yet')
    assert.equal(await run(host, { agentId: '2026-11-19T10-00-02-000Z' }), null)
    assert.equal(await run(host, { agentId: '../../x' }), null)
  } finally {
    await removeRepo(repo)
    resetBridgeQuestions()
  }
})

test('a pick is queued for the extension only as the labels of the question parked, and taken back while no extension collected it (#1237, #1554)', async () => {
  assert.deepEqual([rpcKind(answer), rpcKind(cancel)], ['act', 'act'])
  resetBridgeQuestions()
  const repo = await testRepo()
  try {
    await recorded(repo, '2026-11-19T10-00-00-000Z', {}, { sessionId: 'session_01A' })
    await recorded(repo, '2026-11-19T10-00-01-000Z')
    const host = rpcHost({ root: repo })
    const agentId = '2026-11-19T10-00-00-000Z'
    assert.deepEqual(await answer(host, { agentId: '2026-11-19T10-00-01-000Z', labels: ['x'] }), { ok: false, error: 'This run has no cloud session to answer.' })
    assert.deepEqual(await answer(host, { agentId, labels: [' '] }), { ok: false, error: 'An answer is the labels of the options picked.' })
    const unparked = await answer(host, { agentId, labels: ['--verbose'] })
    assert.equal(unparked.ok, false, 'no question is parked yet')
    bridgeQuestions().record(QUESTION)
    assert.equal((await answer(host, { agentId, labels: ['--loud'] })).ok, false, 'a label the question does not offer')
    assert.deepEqual(await answer(host, { agentId, labels: ['--verbose'] }), { ok: true })
    assert.deepEqual(bridgeQuestions().pendingAnswer('session_01A')?.labels, ['--verbose'])
    assert.deepEqual(await cancel(host, { agentId }), { ok: true })
    assert.equal(bridgeQuestions().pendingAnswer('session_01A'), undefined)
    assert.deepEqual(await cancel(host, { agentId }), { ok: false })
  } finally {
    await removeRepo(repo)
    resetBridgeQuestions()
  }
})

test('Settings › Claude web reads where the bridge stands, the folder the extension is loaded from, and the key (#1237, #1519, #2394)', async () => {
  assert.deepEqual([rpcKind(bridge), rpcKind(token)], ['read', 'read'])
  resetBridgeQuestions()
  const config = await mkdtemp(join(tmpdir(), 'claude-web-server-'))
  const was = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = config
  try {
    const host = computerRpcHost()
    bridgeQuestions().recordVersion('0.12.0', '0.13.0', true)
    const read = await bridge(host, {})
    assert.equal(read.browser, 'yours')
    assert.deepEqual(read.browserState, { state: 'off' }, 'the plugin is not started here: no browser')
    assert.match(read.folder ?? '', /host-claude-web\/extension\/$/)
    assert.deepEqual([read.version?.got, read.version?.blocked, read.questions], ['0.12.0', true, 0])
    assert.equal(await token(host, {}), null, 'no key before the plugin first started')
    const made = await ensureToken(join(config, 'openagent-claude-web'))
    assert.equal(await token(host, {}), made)
  } finally {
    if (was === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = was
    await rm(config, { recursive: true, force: true })
    resetBridgeQuestions()
  }
})

test('the browser picked is saved; what is no browser, or no action on it, is refused (#1332)', async () => {
  assert.deepEqual([rpcKind(pickBrowser), rpcKind(browserAction)], ['act', 'act'])
  const host = computerRpcHost()
  await pickBrowser(host, { browser: 'app' })
  assert.equal(await host.settings.get(BROWSER), 'app')
  await assert.rejects(pickBrowser(host, { browser: 'theirs' as 'app' }), { message: 'The browser is OpenAgent’s or yours.' })
  await assert.rejects(browserAction(host, { action: 'close' as 'show' }), { message: 'The browser is shown, hidden or restarted.' })
  // With the plugin not started here, there is no browser to act on.
  await browserAction(host, { action: 'show' })
})
