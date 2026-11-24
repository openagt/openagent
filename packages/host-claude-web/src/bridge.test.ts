import { strict as assert } from 'node:assert'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { runIdFrom } from '@openagt/agent-driver'
import type { AppContext, ProjectRef } from '@openagt/hooks'
import { fakeApp, memorySettings } from '@openagt/hooks/testing'
import { bridgeBrowser, bridgeLifecycle, bridgeRoute, type BridgeDeps } from './bridge.js'
import type { BridgeBrowser } from './bridge-browser.js'
import { EXPECTED_EXTENSION_VERSION, EXTENSION_VERSION_HEADER } from './bridge-endpoints.js'
import { bridgeQuestions, resetBridgeQuestions } from './bridge-store.js'
import { BROWSER } from './settings.js'
import { readToken } from './token.js'
import { recorded, removeRepo, testRepo, until } from './test-support.js'

// The bridge while the plugin is on: its key, the extension's address on the app's own server
// (`app.route`), the browser OpenAgent runs for it when picked, and the sessions it serves.

/** The app's server answering the bridge's route, as the dashboard's answers a module's. */
async function served(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => void bridgeRoute.handle(req, res))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return {
    url,
    close: () =>
      new Promise<void>(resolve => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

/** The app, as the plugin is told it: its address, its projects, and the browser the person picked. */
async function appAt(url: string, projects: ProjectRef[] = [], browser: 'app' | 'yours' = 'yours'): Promise<AppContext> {
  const settings = memorySettings()
  await settings.set(BROWSER, browser)
  return fakeApp({ url, projects: async () => projects, settings })
}

/** Run `body` with a config folder of its own, the app's server, and the bridge as it starts. */
async function withBridge(body: (at: { url: string; config: string; deps: BridgeDeps }) => Promise<void>): Promise<void> {
  resetBridgeQuestions()
  const config = await mkdtemp(join(tmpdir(), 'claude-web-bridge-'))
  const server = await served()
  // A pass that follows no run: these tests have none of this computer's.
  const deps: BridgeDeps = { env: { XDG_CONFIG_HOME: config }, pass: { host: 'nowhere' }, passEveryMs: 60_000, log: () => {} }
  try {
    await body({ url: server.url, config, deps })
  } finally {
    await server.close()
    await rm(config, { recursive: true, force: true })
    resetBridgeQuestions()
  }
}

const asExtension = (token: string) => ({ authorization: `Bearer ${token}`, [EXTENSION_VERSION_HEADER]: EXPECTED_EXTENSION_VERSION })

test('the extension’s address answers only while the plugin is on, and only a call that shows the key it made (#1237, #2394)', () =>
  withBridge(async ({ url, config, deps }) => {
    assert.equal((await fetch(`${url}/_bridge/ping`)).status, 404, 'off: no bridge at all')
    const life = bridgeLifecycle(deps)
    await life.started!(await appAt(url))
    const token = await readToken(join(config, 'openagent-claude-web'))
    assert.ok(token, 'the key, made as the plugin starts')
    assert.equal((await fetch(`${url}/_bridge/ping`, { headers: asExtension(token) })).status, 200)
    assert.equal((await fetch(`${url}/_bridge/ping`, { headers: asExtension('not-the-key') })).status, 401)
    assert.equal((await fetch(`${url}/_bridge/ping`, { headers: { authorization: `Bearer ${token}`, [EXTENSION_VERSION_HEADER]: '0.0.1' } })).status, 426, 'an extension of another version is refused')
    assert.equal(bridgeQuestions().version()?.blocked, true)
    await life.stopping!()
    assert.equal((await fetch(`${url}/_bridge/ping`, { headers: asExtension(token) })).status, 404, 'switched off: no bridge again')
    // Switched on again, the same key: the extension keeps working.
    await life.started!(await appAt(url))
    assert.equal((await fetch(`${url}/_bridge/ping`, { headers: asExtension(token) })).status, 200)
    await life.stopping!()
  }))

test('the extension serves every project’s web runs of the session window, and every session an answer waits for (#1237, #1332)', () =>
  withBridge(async ({ url, config, deps }) => {
    const repo = await testRepo()
    try {
      const recent = runIdFrom(new Date(Date.now() - 60_000).toISOString())
      const old = runIdFrom(new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString())
      await recorded(repo, recent, {}, { sessionId: 'session_01Recent' })
      await recorded(repo, old, {}, { sessionId: 'session_01Old' })
      bridgeQuestions().record({ sessionId: 'session_01Old', title: 'Still there?', options: [{ label: 'Yes' }], receivedAt: new Date().toISOString() })
      assert.ok(typeof bridgeQuestions().queueAnswer('session_01Old', ['Yes']) !== 'string')
      const life = bridgeLifecycle(deps)
      await life.started!(await appAt(url, [{ id: 'shop', name: 'shop', dir: repo }]))
      const token = (await readToken(join(config, 'openagent-claude-web')))!
      const answered = await fetch(`${url}/_bridge/sessions`, { headers: asExtension(token) })
      assert.deepEqual(await answered.json(), {
        sessions: [
          { id: 'session_01Recent', url: 'https://claude.ai/code/session_01Recent', answerQueued: false },
          { id: 'session_01Old', url: 'https://claude.ai/code/session_01Old', answerQueued: true },
        ],
      })
      await life.stopping!()
    } finally {
      await removeRepo(repo)
    }
  }))

test('the browser OpenAgent runs starts with the plugin where the person picked it, told the app’s address and the key, and stops with it (#1332)', () =>
  withBridge(async ({ config, deps }) => {
    const launched: { daemonUrl: string; token: string; dir: string }[] = []
    let closed = 0
    const browser: BridgeBrowser = { extensionId: 'x', page: async () => '/new', show: async () => {}, hide: async () => {}, onExit: () => {}, close: async () => void closed++ }
    const life = bridgeLifecycle({ ...deps, launch: async ({ daemonUrl, token, dir }) => (launched.push({ daemonUrl, token, dir }), browser) })
    await life.started!(await appAt('http://127.0.0.1:4200', [], 'app'))
    await until(async () => (await bridgeBrowser()?.status())?.state, state => state === 'running', 'the browser to run')
    const token = await readToken(join(config, 'openagent-claude-web'))
    assert.deepEqual(launched, [{ daemonUrl: 'http://127.0.0.1:4200', token, dir: join(config, 'openagent-claude-web', 'browser') }])
    await life.stopping!()
    assert.equal(closed, 1)
    assert.equal(bridgeBrowser(), undefined)
    // With the person's own Chrome picked, none is started.
    await life.started!(await appAt('http://127.0.0.1:4200'))
    assert.deepEqual(await bridgeBrowser()?.status(), { state: 'off' })
    assert.equal(launched.length, 1)
    await life.stopping!()
  }))
