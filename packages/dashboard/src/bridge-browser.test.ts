import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'
import {
  appBundle,
  bridgeBrowserDir,
  bridgeBrowserLaunchArgs,
  bridgeBrowserOwner,
  bridgeExtensionSource,
  freeProfile,
  profileLockOwner,
  seedExpression,
  startBridgeBrowser,
  type BridgeBrowser,
  type BridgeBrowserCdp,
  type BridgeBrowserDeps,
  type BridgeBrowserProcess,
  type CdpTarget,
} from './bridge-browser.js'

test('the bridge browser lives beside the registry, so the test isolation covers it too (#1332)', () => {
  assert.equal(bridgeBrowserDir({ XDG_CONFIG_HOME: '/cfg' }), '/cfg/openagent-browser')
  assert.equal(bridgeBrowserDir({ HOME: '/home/me' }), '/home/me/.openagent-browser')
})

test('the launch is headed, on its own profile, with the extension-debugging flag CDP installs need', () => {
  const args = bridgeBrowserLaunchArgs(9333, '/p/profile')
  assert.ok(!args.some(a => a.startsWith('--headless')), 'claude.ai’s bot gate rejects a headless browser')
  assert.ok(args.includes('--user-data-dir=/p/profile'))
  assert.ok(args.includes('--remote-debugging-port=9333'))
  assert.ok(args.includes('--enable-unsafe-extension-debugging'), 'Extensions.loadUnpacked refuses without it')
  assert.ok(args.includes('--use-mock-keychain') && args.includes('--password-store=basic'), 'an unattended browser must never pop a keychain password dialog')
  assert.ok(!args.some(a => a.startsWith('--load-extension')), 'a command-line install is disabled on the first reload')
})

test('the extension is the checkout’s, next to this package', () => {
  const source = bridgeExtensionSource()
  assert.equal(source?.checkout, true)
  assert.ok(source?.dir.endsWith('/packages/chrome-extension/'), source?.dir)
})

test('the extension comes from the checkout first, then from the package’s dist copy, and only when its manifest is the bridge’s (#1720)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-bridge-source-'))
  const moduleUrl = pathToFileURL(join(root, 'openagent/dist/bridge-browser.js')).href
  const manifest = async (dir: string, name: string) => {
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'manifest.json'), JSON.stringify({ name }))
  }
  assert.equal(bridgeExtensionSource(moduleUrl), undefined, 'neither folder is there')

  await manifest(join(root, 'chrome-extension'), 'Some other package')
  assert.equal(bridgeExtensionSource(moduleUrl), undefined, 'a foreign chrome-extension folder is not the bridge')

  await manifest(join(root, 'openagent/dist/chrome-extension'), 'OpenAgent: Claude web bridge')
  assert.deepEqual(bridgeExtensionSource(moduleUrl), { dir: join(root, 'openagent/dist/chrome-extension/'), checkout: false })

  await manifest(join(root, 'chrome-extension'), 'OpenAgent: Claude web bridge')
  assert.deepEqual(bridgeExtensionSource(moduleUrl), { dir: join(root, 'chrome-extension/'), checkout: true })
})

test('the build copies every file the extension’s self-reload watches into the package (#1720)', async () => {
  const target = await mkdtemp(join(tmpdir(), 'agent-bridge-copy-'))
  const script = new URL('../scripts/copy-extension.mjs', import.meta.url)
  const run = spawnSync(process.execPath, [script.pathname, target], { encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  const fingerprint = readFileSync(new URL('../../chrome-extension/fingerprint.js', import.meta.url), 'utf8')
  const watched = runInNewContext(`${fingerprint}\nWATCHED_FILES`) as string[]
  assert.ok(watched.includes('manifest.json'))
  assert.deepEqual((await readdir(target)).sort(), [...watched].sort())
})

test('the profile lock names the process holding it, and nothing when there is no lock', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'agent-bridge-profile-'))
  assert.equal(await profileLockOwner(profile), undefined)
  await symlink('mac-12345', join(profile, 'SingletonLock'))
  assert.equal(await profileLockOwner(profile), 12345)
  assert.equal(await profileLockOwner(profile, async () => 'garbage'), undefined)
})

test('the app bundle is what macOS activates', () => {
  assert.equal(appBundle('/x/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'), '/x/Google Chrome for Testing.app')
  assert.equal(appBundle('/usr/bin/chrome'), undefined)
})

test('the seed hands the extension its daemon and token and opens the pinned Driver tab', () => {
  const expression = seedExpression('http://127.0.0.1:4200', 'tok"en')
  assert.ok(expression.includes('"daemonUrl":"http://127.0.0.1:4200"'))
  assert.ok(expression.includes('"token":"tok\\"en"'), 'quoted, so a token cannot break out of the expression')
  assert.ok(expression.includes('"autoOpen":true'))
  assert.ok(expression.includes('pinned: true'))
  assert.ok(expression.includes('https://claude.ai/code'))
})

/** A fake Chrome: the CDP calls it saw, the targets it lists, and what each evaluate answers. */
function fakeChrome(over: { targets?: () => CdpTarget[]; loadUnpacked?: unknown; devMode?: unknown; seed?: unknown } = {}) {
  const calls: Array<{ method: string; params?: Record<string, unknown> | undefined }> = []
  const evaluated: Array<{ url: string; expression: string }> = []
  const extensionId = 'abcdefghijklmnopabcdefghijklmnop'
  const defaultTargets = (): CdpTarget[] => [
    { id: 'page-1', type: 'page', url: 'about:blank', webSocketDebuggerUrl: 'ws://page-1' },
    { id: 'page-2', type: 'page', url: 'https://claude.ai/login?from=logout', webSocketDebuggerUrl: 'ws://page-2' },
    { id: 'ext-1', type: 'page', url: 'chrome://extensions/', webSocketDebuggerUrl: 'ws://ext-1' },
    { id: 'sw-1', type: 'service_worker', url: `chrome-extension://${extensionId}/background.js`, webSocketDebuggerUrl: 'ws://sw-1' },
  ]
  const cdp: BridgeBrowserCdp = {
    call: async (method, params) => {
      calls.push({ method, params })
      if (method === 'Extensions.loadUnpacked') return over.loadUnpacked ?? { id: extensionId }
      if (method === 'Target.createTarget') return { targetId: 'ext-1' }
      if (method === 'Browser.getWindowForTarget') return { windowId: 7 }
      return {}
    },
    targets: async () => (over.targets ?? defaultTargets)(),
    attach: async target => ({
      send: async (method, params) => {
        if (method !== 'Runtime.evaluate') return {}
        const expression = String(params?.['expression'])
        evaluated.push({ url: target.url, expression })
        if (target.url === 'chrome://extensions/') return { result: { value: over.devMode ?? 'on' } }
        if (target.type === 'service_worker') return { result: { value: over.seed ?? 'ok' } }
        return { result: { value: undefined } }
      },
      close: () => {},
    }),
    close: () => {},
  }
  return { cdp, calls, evaluated, extensionId }
}

/** A fake Chrome process: alive until `exit` is fired; a kill only records its signal. */
function fakeProcess() {
  const listeners: Record<string, ((...args: never[]) => void)[]> = {}
  const child = {
    pid: 4242,
    killed: [] as NodeJS.Signals[],
    kill(signal: NodeJS.Signals = 'SIGTERM') {
      this.killed.push(signal)
      return true
    },
    on(event: string, listener: (...args: never[]) => void) {
      ;(listeners[event] ??= []).push(listener)
      return this
    },
    exit(code: number | null, signal: NodeJS.Signals | null = null) {
      for (const listener of listeners['exit'] ?? []) (listener as (c: number | null, s: NodeJS.Signals | null) => void)(code, signal)
    },
  }
  return child as typeof child & BridgeBrowserProcess
}

function fakeDeps(chrome: ReturnType<typeof fakeChrome>, child: ReturnType<typeof fakeProcess>, over: Partial<BridgeBrowserDeps> = {}) {
  const log = { spawned: [] as string[][], killed: [] as Array<[number, string]>, activated: [] as string[], reports: [] as string[] }
  const deps: BridgeBrowserDeps = {
    binary: async (_cacheDir, report) => {
      report('downloading Chrome for Testing 150: 100%')
      return '/apps/Chrome for Testing.app/Contents/MacOS/Chrome for Testing'
    },
    lockOwner: async () => undefined,
    alive: () => false,
    kill: (pid, signal) => log.killed.push([pid, signal]),
    port: async () => 9333,
    spawn: (binary, args) => {
      log.spawned.push([binary, ...args])
      return child
    },
    ready: async () => true,
    connect: async () => chrome.cdp,
    activate: binary => log.activated.push(binary),
    sleep: async () => {},
    ...over,
  }
  return { deps, log }
}

const options = (dir: string) => ({ daemonUrl: 'http://127.0.0.1:4200', token: 'tok', dir, extension: { dir: '/repo/packages/chrome-extension', checkout: true } })

test('the launch installs the extension over CDP, turns developer mode on, seeds the token, and minimizes (#1332)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-bridge-'))
  const chrome = fakeChrome()
  const child = fakeProcess()
  const { deps, log } = fakeDeps(chrome, child, { binary: async (_c, report) => (report('downloading'), '/bin/chrome') })
  const reports: string[] = []
  const browser = await startBridgeBrowser({ ...options(dir), report: r => reports.push(r) }, deps)

  assert.equal(browser.extensionId, chrome.extensionId)
  assert.deepEqual(log.spawned[0]?.slice(0, 2), ['/bin/chrome', '--remote-debugging-port=9333'])
  assert.ok(log.spawned[0]?.includes(`--user-data-dir=${join(dir, 'profile')}`), 'a persistent profile under the bridge browser’s dir')
  const methods = chrome.calls.map(c => c.method)
  assert.deepEqual(chrome.calls.find(c => c.method === 'Extensions.loadUnpacked')?.params, { path: '/repo/packages/chrome-extension' })
  assert.ok(methods.indexOf('Extensions.loadUnpacked') < methods.indexOf('Target.createTarget'), 'developer mode after the install')
  assert.ok(chrome.evaluated.some(e => e.url === 'chrome://extensions/' && e.expression.includes('#devMode')), 'the switch is flipped on the extensions page')
  assert.ok(methods.includes('Target.closeTarget'), 'the extensions page is closed again')
  const seed = chrome.evaluated.find(e => e.url.endsWith('/background.js'))
  assert.ok(seed?.expression.includes('"token":"tok"') && seed.expression.includes('"daemonUrl":"http://127.0.0.1:4200"'), 'the worker gets the token')
  assert.deepEqual(chrome.calls.filter(c => c.method === 'Browser.setWindowBounds').at(-1)?.params, { windowId: 7, bounds: { windowState: 'minimized' } })
  assert.deepEqual(reports, ['downloading', 'starting Chrome for Testing', 'installing the extension', 'handing the extension the bridge token'])

  assert.equal(await browser.page(), '/login', 'the daemon reads which page its own tab is on')
  await browser.show()
  assert.deepEqual(chrome.calls.filter(c => c.method === 'Browser.setWindowBounds').at(-1)?.params, { windowId: 7, bounds: { windowState: 'normal' } })
  assert.deepEqual(log.activated, ['/bin/chrome'], 'the app is brought to the front for the sign-in')
  await browser.hide()
  assert.deepEqual(chrome.calls.filter(c => c.method === 'Browser.setWindowBounds').at(-1)?.params, { windowId: 7, bounds: { windowState: 'minimized' } })
})

test('a package’s extension is copied into the bridge browser’s own folder and installed from there, so its id outlives the package version (#1720)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-bridge-'))
  const packaged = await mkdtemp(join(tmpdir(), 'agent-bridge-packaged-'))
  await writeFile(join(packaged, 'manifest.json'), '{"version":"new"}')
  await mkdir(join(dir, 'extension'))
  await writeFile(join(dir, 'extension', 'stale.js'), '')
  const chrome = fakeChrome()
  const { deps } = fakeDeps(chrome, fakeProcess())
  await startBridgeBrowser({ ...options(dir), extension: { dir: packaged, checkout: false } }, deps)

  assert.deepEqual(chrome.calls.find(c => c.method === 'Extensions.loadUnpacked')?.params, { path: join(dir, 'extension') })
  assert.deepEqual(await readdir(join(dir, 'extension')), ['manifest.json'], 'the old copy is replaced, not merged')
  assert.equal(readFileSync(join(dir, 'extension', 'manifest.json'), 'utf8'), '{"version":"new"}')
})

test('a stale browser holding the profile is stopped before the launch, gently first', async () => {
  const alive = new Set([777])
  const chrome = fakeChrome()
  const { deps, log } = fakeDeps(chrome, fakeProcess(), {
    lockOwner: async () => 777,
    alive: pid => alive.has(pid),
    kill: (pid, signal) => {
      log.killed.push([pid, signal])
      alive.delete(pid)
    },
  })
  assert.equal(await freeProfile('/p', deps), true)
  assert.deepEqual(log.killed, [[777, 'SIGTERM']])
  // A lock whose owner is gone is just a leftover file.
  assert.equal(await freeProfile('/p', { ...deps, alive: () => false }), false)
})

test('a browser that never listens is killed and the launch fails with the reason', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-bridge-'))
  const child = fakeProcess()
  const { deps } = fakeDeps(fakeChrome(), child, { ready: async () => false })
  await assert.rejects(startBridgeBrowser(options(dir), deps), /never opened its debugging port/)
  assert.deepEqual(child.killed, ['SIGTERM', 'SIGKILL'], 'killed outright when SIGTERM does not end it')
})

test('a setup step that fails closes the browser again rather than leaving it half set up', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-bridge-'))
  const chrome = fakeChrome({ targets: () => [{ id: 'page-1', type: 'page', url: 'about:blank', webSocketDebuggerUrl: 'ws://page-1' }] })
  const child = fakeProcess()
  const { deps } = fakeDeps(chrome, child)
  await assert.rejects(startBridgeBrowser(options(dir), deps), /developer mode/)
  assert.ok(chrome.calls.some(c => c.method === 'Browser.close'), 'asked to close itself')
  assert.deepEqual(child.killed, ['SIGTERM', 'SIGKILL'], 'and killed when it did not')
})

test('a worker that never takes the token fails the launch by name', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-bridge-'))
  const { deps } = fakeDeps(fakeChrome({ seed: 'nope' }), fakeProcess())
  await assert.rejects(startBridgeBrowser(options(dir), deps), /did not take the token: nope/)
})

test('Chrome exiting on its own is reported once; a close asked for is not', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-bridge-'))
  const child = fakeProcess()
  const { deps } = fakeDeps(fakeChrome(), child)
  const browser = await startBridgeBrowser(options(dir), deps)
  const exits: string[] = []
  browser.onExit(detail => exits.push(detail))
  child.exit(null, 'SIGKILL')
  child.exit(null, 'SIGKILL')
  assert.deepEqual(exits, ['Chrome exited on SIGKILL'])
  await browser.close()
  assert.deepEqual(child.killed, [], 'nothing to kill once it is gone')

  const child2 = fakeProcess()
  const chrome2 = fakeChrome()
  const browser2 = await startBridgeBrowser(options(dir), fakeDeps(chrome2, child2).deps)
  const exits2: string[] = []
  browser2.onExit(detail => exits2.push(detail))
  const closing = browser2.close()
  child2.exit(0)
  await closing
  assert.deepEqual(exits2, [], 'an exit the close caused is not an exit to report')
  assert.ok(chrome2.calls.some(c => c.method === 'Browser.close'))
})

test('a browser that never answers Browser.close is killed after the grace, not waited on (#2141)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-bridge-'))
  const chrome = fakeChrome()
  const call = chrome.cdp.call
  chrome.cdp.call = (method, params) => (method === 'Browser.close' ? new Promise(() => {}) : call(method, params))
  const child = fakeProcess()
  const browser = await startBridgeBrowser(options(dir), fakeDeps(chrome, child).deps)
  await browser.close()
  assert.deepEqual(child.killed, ['SIGTERM', 'SIGKILL'])
})

test('an aborted launch stops waiting on its step, and kills a Chrome it spawned (#2141)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-bridge-'))
  const downloading = new AbortController()
  const never = fakeDeps(fakeChrome(), fakeProcess(), { binary: () => new Promise(() => {}) }).deps
  const download = startBridgeBrowser({ ...options(dir), signal: downloading.signal }, never)
  downloading.abort()
  await assert.rejects(download, /stopped/)

  const listening = new AbortController()
  const child = fakeProcess()
  let spawned!: () => void
  const asked = new Promise<void>(resolve => (spawned = resolve))
  const ready = (): Promise<boolean> => (spawned(), new Promise(() => {}))
  const waiting = startBridgeBrowser({ ...options(dir), signal: listening.signal }, fakeDeps(fakeChrome(), child, { ready }).deps)
  await asked
  listening.abort()
  await assert.rejects(waiting, /stopped/)
  assert.deepEqual(child.killed, ['SIGTERM', 'SIGKILL'])
})

/** A launch that resolves when the test says so. */
function controlledLaunch() {
  let resolve!: (browser: BridgeBrowser) => void
  let reject!: (err: Error) => void
  const reports: string[] = []
  const browser = (): BridgeBrowser & { closed: number; exit: ((detail: string) => void) | undefined; shown: number; path: string } => {
    const b = {
      extensionId: 'x',
      closed: 0,
      shown: 0,
      path: '/code',
      exit: undefined as undefined | ((detail: string) => void),
      show: async () => void b.shown++,
      page: async () => b.path,
      hide: async () => {},
      onExit: (listener: (detail: string) => void) => {
        b.exit = listener
      },
      close: async () => void b.closed++,
    }
    return b
  }
  const launch = (report: (detail: string) => void) =>
    new Promise<BridgeBrowser>((res, rej) => {
      reports.push('launch called')
      resolve = res
      reject = rej
      report('downloading')
    })
  return { launch, reports, browser, resolve: (b: BridgeBrowser) => resolve(b), reject: (e: Error) => reject(e) }
}

test('the owner reports the launch step, then running, then why it stopped (#1332)', async () => {
  const launch = controlledLaunch()
  const owner = bridgeBrowserOwner(launch.launch)
  assert.deepEqual(await owner.status(), { state: 'off' })
  const starting = owner.start()
  assert.deepEqual(await owner.status(), { state: 'starting', detail: 'downloading' })
  const b = launch.browser()
  launch.resolve(b)
  await starting
  const status = await owner.status()
  assert.equal(status.state, 'running')
  await owner.act('show')
  assert.equal(b.shown, 1)
  assert.deepEqual(await owner.status(), { ...status, visible: true })
  b.exit?.('Chrome exited on SIGTERM')
  assert.deepEqual(await owner.status(), { state: 'stopped', detail: 'Chrome exited on SIGTERM' })
  // Stopped is not off: the switch is still on, and the dashboard offers a restart.
  await owner.act('show')
  assert.equal(b.shown, 1, 'nothing to show once it is gone')
})

test('a failed launch is stopped with the reason; a second start tries again', async () => {
  const launch = controlledLaunch()
  const lines: string[] = []
  const owner = bridgeBrowserOwner(launch.launch, line => lines.push(line))
  const first = owner.start()
  launch.reject(new Error('Chrome never opened its debugging port'))
  await first
  assert.deepEqual(await owner.status(), { state: 'stopped', detail: 'Chrome never opened its debugging port' })
  assert.ok(lines.some(line => line.includes('could not start')))
  const second = owner.start()
  assert.equal(launch.reports.filter(r => r === 'launch called').length, 2)
  launch.resolve(launch.browser())
  await second
  assert.equal((await owner.status()).state, 'running')
})

test('a launcher that throws before launching is a failed launch with the reason, not a crash (#1332)', async () => {
  const lines: string[] = []
  const owner = bridgeBrowserOwner(
    () => {
      throw new Error('turn the browser bridge on, then restart the dashboard')
    },
    line => lines.push(line),
  )
  await owner.start()
  assert.deepEqual(await owner.status(), { state: 'stopped', detail: 'turn the browser bridge on, then restart the dashboard' })
  assert.ok(lines.some(line => line.includes('could not start')))
})

test('a stop during a launch closes the browser the launch then hands over', async () => {
  const launch = controlledLaunch()
  const owner = bridgeBrowserOwner(launch.launch)
  const starting = owner.start()
  const stopping = owner.stop()
  assert.deepEqual(await owner.status(), { state: 'off' })
  const b = launch.browser()
  launch.resolve(b)
  await starting
  await stopping
  assert.equal(b.closed, 1, 'not left running unowned')
  assert.deepEqual(await owner.status(), { state: 'off' })
})

test('a stop gives a launch under way up rather than waiting it out (#2141)', async () => {
  let aborted = false
  const owner = bridgeBrowserOwner((_report, signal) => new Promise<BridgeBrowser>((_resolve, reject) => signal.addEventListener('abort', () => ((aborted = true), reject(new Error('stopped'))))))
  const starting = owner.start()
  await owner.stop()
  await starting
  assert.equal(aborted, true)
  assert.deepEqual(await owner.status(), { state: 'off' })
})

test('start is one launch however often it is asked; restart is a stop and a start', async () => {
  const launch = controlledLaunch()
  const owner = bridgeBrowserOwner(launch.launch)
  const a = owner.start()
  const b = owner.start()
  assert.equal(launch.reports.filter(r => r === 'launch called').length, 1)
  const first = launch.browser()
  launch.resolve(first)
  await Promise.all([a, b])
  const restarting = owner.act('restart')
  await new Promise(r => setImmediate(r))
  assert.equal(first.closed, 1)
  launch.resolve(launch.browser())
  await restarting
  assert.equal((await owner.status()).state, 'running')
  assert.equal(launch.reports.filter(r => r === 'launch called').length, 2)
})

test('a running browser on claude.ai’s sign-in page says a sign-in is needed', async () => {
  const launch = controlledLaunch()
  const owner = bridgeBrowserOwner(launch.launch)
  const starting = owner.start()
  const b = launch.browser()
  b.path = '/login'
  launch.resolve(b)
  await starting
  assert.equal((await owner.status() as { signIn?: boolean }).signIn, true)
  b.path = '/logout'
  assert.equal((await owner.status() as { signIn?: boolean }).signIn, true, 'the logout step redirects to the sign-in page')
  b.path = '/code'
  assert.equal((await owner.status() as { signIn?: boolean }).signIn, false)
})
