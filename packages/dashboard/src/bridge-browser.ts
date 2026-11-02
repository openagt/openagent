import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { cp, mkdir, readlink, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Browser, detectBrowserPlatform, getInstalledBrowsers, install, resolveBuildId } from '@puppeteer/browsers'
import { freePort, waitForDebugEndpoint } from './browser.js'
import { connectCdp } from './browser-stream.js'
import { registryPath } from './registry.js'

/**
 * The bridge browser (#1332): a Chrome for Testing the daemon launches and owns, with the Claude
 * web bridge extension installed, signed in to claude.ai once by the user and kept minimized.
 *
 * The bridge's far end is a browser signed in to claude.ai. Until now that was the user's own
 * Chrome with the extension loaded, so a web run could only start — and a parked question could
 * only be noticed — while that Chrome happened to be open. The spike on #1332 settled what a
 * browser nobody attends has to be: headed, because claude.ai's Cloudflare gate never clears a
 * headless one; Chrome for Testing, because branded Chrome stopped loading unpacked extensions
 * from the command line; and installed over CDP with developer mode on, because an extension
 * loaded any other way is disabled the first time it reloads itself (#1712).
 *
 * Nothing here talks to claude.ai. The daemon launches the browser, hands the extension the
 * bridge token, and from then on the extension's Driver tab does exactly what it does in the
 * user's own Chrome — the daemon only keeps the window out of the way and brings it up when the
 * user has to sign in.
 */

/** The directory holding the bridge browser's profile and binary, next to the registry file. */
export const BRIDGE_BROWSER_DIR = 'openagent-browser'

/**
 * Where the bridge browser lives: `$XDG_CONFIG_HOME/openagent-browser` when set, else the
 * dotted `$HOME/.openagent-browser`. Beside the registry, so the same variable that isolates
 * a test's registry isolates its browser, and a machine's real one is never touched from a test.
 * The profile inside it is persistent on purpose: the user signs in once and the sign-in outlives
 * every daemon restart.
 */
export function bridgeBrowserDir(env: NodeJS.ProcessEnv): string {
  return join(dirname(registryPath(env)), env.XDG_CONFIG_HOME ? BRIDGE_BROWSER_DIR : '.' + BRIDGE_BROWSER_DIR)
}

/**
 * The launch flags. Headed (no `--headless`): claude.ai's bot gate rejects a headless browser
 * outright, and a headed one whose window is minimized passes. The unsafe-extension-debugging
 * flag is what lets `Extensions.loadUnpacked` install the extension over CDP. The keychain flags
 * keep the cookie-encryption key out of the OS keychain (macOS asks for the login password on
 * every launch otherwise, and Linux for the wallet) — the same choice Puppeteer makes; the profile
 * directory's own permissions are what guard the sign-in.
 */
export function bridgeBrowserLaunchArgs(port: number, profileDir: string): string[] {
  return [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--use-mock-keychain',
    '--password-store=basic',
    '--enable-unsafe-extension-debugging',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1280,900',
    'about:blank',
  ]
}

/** The extension's name in its manifest: what tells its folder apart from any other `chrome-extension` folder. */
const BRIDGE_EXTENSION_NAME = 'OpenAgent: Claude web bridge'

/** Where the extension's files are, and whether that is a checkout, where they are edited in place. */
export interface BridgeExtensionSource {
  dir: string
  checkout: boolean
}

/**
 * The extension's files (#1720): the checkout's `packages/chrome-extension` next to this package,
 * so an edit there reaches the browser through the extension's self-reload; else the copy the
 * build puts in `dist/chrome-extension`, which is what an installed package has. A folder counts
 * only when its manifest names the bridge extension. Undefined when neither is there.
 * `moduleUrl` is this file's URL; tests point it elsewhere.
 */
export function bridgeExtensionSource(moduleUrl: string = import.meta.url): BridgeExtensionSource | undefined {
  const checkout = fileURLToPath(new URL('../../chrome-extension/', moduleUrl))
  if (isBridgeExtension(checkout)) return { dir: checkout, checkout: true }
  const packaged = fileURLToPath(new URL('./chrome-extension/', moduleUrl))
  if (isBridgeExtension(packaged)) return { dir: packaged, checkout: false }
  return undefined
}

function isBridgeExtension(dir: string): boolean {
  try {
    return (JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as { name?: unknown }).name === BRIDGE_EXTENSION_NAME
  } catch {
    return false
  }
}

/**
 * The folder the extension is installed from. A checkout's folder as it is: its path is stable,
 * and the self-reload picks up edits there. A package's copy is copied again into the bridge
 * browser's own `extension` folder, overwriting it: Chrome derives an unpacked extension's id from
 * its path, and npx puts each version of the package in a different folder, so installing from
 * there would leave one dead extension in the profile per version.
 */
async function installableExtensionDir(source: BridgeExtensionSource, bridgeDir: string): Promise<string> {
  if (source.checkout) return source.dir
  const dir = join(bridgeDir, 'extension')
  await rm(dir, { recursive: true, force: true })
  await cp(source.dir, dir, { recursive: true })
  return dir
}

/**
 * The process holding a profile's singleton lock, or undefined when nothing does. Chrome leaves
 * the lock behind as a symlink whose target is `<host>-<pid>`; a daemon that died without closing
 * its browser leaves that browser running, and a second Chrome on the same profile would hand its
 * command line to the first and exit at once.
 */
export async function profileLockOwner(profileDir: string, readLink: (path: string) => Promise<string> = readlink): Promise<number | undefined> {
  const target = await readLink(join(profileDir, 'SingletonLock')).catch(() => undefined)
  const pid = Number(target?.split('-').at(-1))
  return Number.isInteger(pid) && pid > 0 ? pid : undefined
}

/** One page, worker or browser-internal target Chrome lists. */
export interface CdpTarget {
  id: string
  type: string
  url: string
  webSocketDebuggerUrl?: string
}

/** A session on one target: the calls go to that page or worker rather than to the browser. */
export interface CdpTargetSession {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>
  close(): void
}

/** How the daemon talks to its browser. Injectable: the real one speaks WebSocket to Chrome. */
export interface BridgeBrowserCdp {
  /** A browser-level call: installing the extension, opening and closing targets, window bounds. */
  call(method: string, params?: Record<string, unknown>): Promise<unknown>
  /** Every target Chrome lists — pages, the extension's worker, browser-internal pages. */
  targets(): Promise<CdpTarget[]>
  /** Attach to one target. */
  attach(target: CdpTarget): Promise<CdpTargetSession>
  /** Drop the browser-level connection. The browser keeps running. */
  close(): void
}

/** The real connection: the browser socket from `/json/version`, targets from `/json/list`. */
export async function connectBridgeBrowser(browserUrl: string): Promise<BridgeBrowserCdp> {
  const version = (await (await fetch(`${browserUrl}/json/version`)).json()) as { webSocketDebuggerUrl?: string }
  if (!version.webSocketDebuggerUrl) throw new Error('Chrome published no browser socket')
  const browser = await connectCdp(version.webSocketDebuggerUrl)
  return {
    call: (method, params) => browser.send(method, params),
    targets: async () => {
      const res = await fetch(`${browserUrl}/json/list`)
      const body = res.ok ? ((await res.json()) as CdpTarget[]) : []
      return Array.isArray(body) ? body : []
    },
    attach: async target => {
      if (!target.webSocketDebuggerUrl) throw new Error(`${target.url} cannot be attached to`)
      const session = await connectCdp(target.webSocketDebuggerUrl)
      return { send: (method, params) => session.send(method, params), close: () => session.close() }
    },
    close: () => browser.close(),
  }
}

/** Run an expression in a target and return its (awaited) value; a thrown exception is an error. */
async function evaluate(cdp: BridgeBrowserCdp, target: CdpTarget, expression: string): Promise<unknown> {
  const session = await cdp.attach(target)
  try {
    const reply = (await session.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })) as {
      result?: { value?: unknown }
      exceptionDetails?: { text?: string; exception?: { description?: string } }
    }
    if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text ?? 'the expression threw')
    return reply.result?.value
  } finally {
    session.close()
  }
}

/** Install the extension from its directory. Chrome answers with the extension's id. */
export async function installExtension(cdp: BridgeBrowserCdp, extensionDir: string): Promise<string> {
  const reply = (await cdp.call('Extensions.loadUnpacked', { path: extensionDir })) as { id?: string } | undefined
  if (!reply?.id) throw new Error('Chrome installed the extension but named no id')
  return reply.id
}

/**
 * The developer-mode switch on Chrome's extensions page, flipped on if it is off. Chrome (137
 * and later) disables an unpacked extension on reload while the mode is off, and the extension
 * reloads itself whenever its files change (#1712), so without this the bridge would die on the
 * first edit or pull. The profile remembers the setting, but writing the preference into the
 * profile directly does nothing — the switch is the one way that works.
 */
export const DEVELOPER_MODE_ON = `(() => {
  const manager = document.querySelector('extensions-manager')?.shadowRoot
  const toggle = manager?.querySelector('extensions-toolbar')?.shadowRoot?.querySelector('#devMode')
  if (!toggle) return 'missing'
  if (!toggle.checked) toggle.click()
  return 'on'
})()`

/** How many times, a beat apart, a target is looked for before the step gives up. */
const TARGET_ATTEMPTS = 40
const TARGET_BEAT_MS = 250

/** Open Chrome's extensions page in the background, switch developer mode on, close the page. */
export async function enableDeveloperMode(cdp: BridgeBrowserCdp, sleep: (ms: number) => Promise<void>): Promise<void> {
  const { targetId } = (await cdp.call('Target.createTarget', { url: 'chrome://extensions/', background: true })) as { targetId: string }
  try {
    for (let attempt = 0; attempt < TARGET_ATTEMPTS; attempt++) {
      const target = (await cdp.targets()).find(t => t.id === targetId)
      const outcome = target ? await evaluate(cdp, target, DEVELOPER_MODE_ON).catch(() => 'missing') : 'missing'
      if (outcome === 'on') return
      await sleep(TARGET_BEAT_MS)
    }
    throw new Error('could not switch developer mode on in chrome://extensions')
  } finally {
    await cdp.call('Target.closeTarget', { targetId }).catch(() => {})
  }
}

/** The Driver's page: claude.ai's session list, which is also where a signed-out user signs in. */
const DRIVER_URL = 'https://claude.ai/code'

/**
 * What the extension is told, run inside its own worker: the daemon's address and the bridge
 * token go into the storage its options page would have written, and the Driver tab is opened
 * as the one pinned claude.ai/code tab — the shape the extension adopts as its Driver — in place
 * of the blank page the browser started on. Opened here rather than left to the extension
 * because the extension opens no Driver tab while the daemon lists no cloud session, and the user
 * signs in on that tab before any session exists.
 */
export function seedExpression(daemonUrl: string, token: string): string {
  return `(async () => {
  await chrome.storage.local.set(${JSON.stringify({ daemonUrl, token, autoOpen: true })})
  const before = await chrome.tabs.query({})
  const driver = await chrome.tabs.create({ url: ${JSON.stringify(DRIVER_URL)}, pinned: true, active: true })
  for (const tab of before) if (tab.id !== driver.id) await chrome.tabs.remove(tab.id).catch(() => {})
  return 'ok'
})()`
}

/** Hand the freshly installed extension its daemon and token, in its service worker. */
export async function seedExtension(
  cdp: BridgeBrowserCdp,
  extensionId: string,
  daemonUrl: string,
  token: string,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  const workerUrl = `chrome-extension://${extensionId}/background.js`
  for (let attempt = 0; attempt < TARGET_ATTEMPTS; attempt++) {
    const worker = (await cdp.targets()).find(t => t.type === 'service_worker' && t.url === workerUrl)
    if (worker) {
      const outcome = await evaluate(cdp, worker, seedExpression(daemonUrl, token))
      if (outcome === 'ok') return
      throw new Error(`the extension's worker did not take the token: ${String(outcome)}`)
    }
    await sleep(TARGET_BEAT_MS)
  }
  throw new Error("the extension's worker never appeared")
}

/** Every window Chrome has a page in. */
async function windowIds(cdp: BridgeBrowserCdp): Promise<number[]> {
  const ids = new Set<number>()
  for (const page of (await cdp.targets()).filter(t => t.type === 'page')) {
    const reply = (await cdp.call('Browser.getWindowForTarget', { targetId: page.id }).catch(() => undefined)) as { windowId?: number } | undefined
    if (reply?.windowId !== undefined) ids.add(reply.windowId)
  }
  return [...ids]
}

/**
 * Minimize or restore every window. Minimized rather than moved off-screen: macOS keeps a sliver
 * of any off-screen window on the screen, and Cloudflare lets a minimized window through.
 */
async function setWindowState(cdp: BridgeBrowserCdp, windowState: 'minimized' | 'normal'): Promise<void> {
  for (const windowId of await windowIds(cdp)) await cdp.call('Browser.setWindowBounds', { windowId, bounds: { windowState } }).catch(() => {})
}

/** The claude.ai tab — the Driver tab, or the sign-in page it was redirected to. */
async function claudeTab(cdp: BridgeBrowserCdp): Promise<CdpTarget | undefined> {
  return (await cdp.targets()).find(t => t.type === 'page' && t.url.startsWith('https://claude.ai/'))
}

/** Put the claude.ai tab in front, so what comes up is the page the user has to sign in on. */
async function frontClaudeTab(cdp: BridgeBrowserCdp): Promise<void> {
  const page = await claudeTab(cdp)
  if (!page) return
  const session = await cdp.attach(page).catch(() => undefined)
  if (!session) return
  await session.send('Page.bringToFront').catch(() => {})
  session.close()
}

/** The bridge browser once it runs. */
export interface BridgeBrowser {
  extensionId: string
  /** The path the claude.ai tab is on (`/login` while signed out), or undefined without such a tab. */
  page(): Promise<string | undefined>
  /** Restore the window and bring the browser to the front, for the user to sign in. */
  show(): Promise<void>
  /** Minimize the window again. */
  hide(): Promise<void>
  /** Called once if Chrome exits on its own — the user quit it, or it crashed. */
  onExit(listener: (detail: string) => void): void
  /** Close the browser. Safe to call twice. */
  close(): Promise<void>
}

/** The Chrome process, as much of it as this module needs. */
export interface BridgeBrowserProcess {
  pid?: number | undefined
  kill(signal?: NodeJS.Signals): unknown
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown
  on(event: 'error', listener: (err: Error) => void): unknown
}

/** Everything the launch touches outside its own logic. Injectable so the sequence is testable without a Chrome. */
export interface BridgeBrowserDeps {
  /** The Chrome for Testing binary, downloaded into `cacheDir` if none is there yet. */
  binary(cacheDir: string, report: (detail: string) => void): Promise<string>
  /** The process holding the profile's lock, if any. */
  lockOwner(profileDir: string): Promise<number | undefined>
  alive(pid: number): boolean
  kill(pid: number, signal: NodeJS.Signals): void
  port(): Promise<number>
  spawn(binary: string, args: string[]): BridgeBrowserProcess
  ready(browserUrl: string): Promise<boolean>
  connect(browserUrl: string): Promise<BridgeBrowserCdp>
  /** Bring the browser application to the front (macOS: activate the app bundle). */
  activate(binary: string): void
  sleep(ms: number): Promise<void>
}

/**
 * The Chrome for Testing binary in `cacheDir`, or the current stable one downloaded there (about
 * 150 MB, once). Chrome for Testing rather than whatever Chrome the machine has: branded Chrome
 * ignores an unpacked extension handed to it from outside, and the agent's own browser lookup
 * would find exactly that.
 */
export async function bridgeBrowserBinary(cacheDir: string, report: (detail: string) => void): Promise<string> {
  await mkdir(cacheDir, { recursive: true })
  const installed = (await getInstalledBrowsers({ cacheDir })).filter(b => b.browser === Browser.CHROME)
  const newest = installed.sort((a, b) => a.buildId.localeCompare(b.buildId, undefined, { numeric: true })).at(-1)
  if (newest) return newest.executablePath
  const platform = detectBrowserPlatform()
  if (!platform) throw new Error('Chrome for Testing has no build for this platform')
  report('looking up the current Chrome for Testing')
  const buildId = await resolveBuildId(Browser.CHROME, platform, 'stable')
  report(`downloading Chrome for Testing ${buildId}`)
  const browser = await install({
    cacheDir,
    browser: Browser.CHROME,
    buildId,
    downloadProgressCallback: (downloaded, total) =>
      report(`downloading Chrome for Testing ${buildId}: ${total > 0 ? Math.round((downloaded / total) * 100) : 0}%`),
  })
  return browser.executablePath
}

/** macOS: the `.app` bundle the binary lives in, which `open` activates. Undefined elsewhere. */
export function appBundle(binary: string): string | undefined {
  const index = binary.indexOf('.app/')
  return index === -1 ? undefined : binary.slice(0, index + 4)
}

/** The real dependencies. */
export function bridgeBrowserDeps(): BridgeBrowserDeps {
  return {
    binary: bridgeBrowserBinary,
    lockOwner: profileLockOwner,
    alive: pid => {
      try {
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    },
    kill: (pid, signal) => {
      try {
        process.kill(pid, signal)
      } catch {
        // Already gone.
      }
    },
    port: freePort,
    spawn: (binary, args) => spawn(binary, args, { stdio: 'ignore' }),
    ready: browserUrl => waitForDebugEndpoint(browserUrl, { timeoutMs: 30_000 }),
    connect: connectBridgeBrowser,
    activate: binary => {
      const bundle = process.platform === 'darwin' ? appBundle(binary) : undefined
      if (bundle) spawn('open', [bundle], { stdio: 'ignore' }).on('error', () => {})
    },
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  }
}

/** How often a wait for a process to leave looks again. */
const BEAT_MS = 100
/** How long a stale browser gets to leave after SIGTERM before it is killed outright. */
const STALE_EXIT_MS = 5_000
/** How long the browser gets to close on its own after `Browser.close` before it is killed. */
const CLOSE_GRACE_MS = 3_000

/**
 * Make sure nothing else holds the profile: a browser a dead daemon left behind is stopped,
 * gently first. It is OpenAgent's own profile, so whatever holds it is OpenAgent's own
 * leftover; nothing the user runs shares it.
 */
export async function freeProfile(profileDir: string, deps: BridgeBrowserDeps): Promise<boolean> {
  const owner = await deps.lockOwner(profileDir)
  if (owner === undefined || owner === process.pid || !deps.alive(owner)) return false
  deps.kill(owner, 'SIGTERM')
  for (let beat = 0; beat < STALE_EXIT_MS / BEAT_MS && deps.alive(owner); beat++) await deps.sleep(BEAT_MS)
  if (deps.alive(owner)) deps.kill(owner, 'SIGKILL')
  return true
}

/** What a launch needs to know. */
export interface BridgeBrowserOptions {
  /** Where the daemon listens — what the extension is told to call. */
  daemonUrl: string
  /** The bridge token the extension presents on every call. */
  token: string
  /** The bridge browser's directory: the profile and the binary live under it. */
  dir: string
  /** The extension's files. Default: `bridgeExtensionSource()`. */
  extension?: BridgeExtensionSource | undefined
  /** Progress, one line at a time, for the dashboard to show while the launch runs. */
  report?: ((detail: string) => void) | undefined
  /** Gives the launch up: a step under way is not waited for, and a Chrome already spawned is killed. */
  signal?: AbortSignal | undefined
}

/** `promise`, or a rejection as soon as `signal` aborts: a launch step a stop does not wait for. */
function unlessAborted<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => reject(new Error('the launch was stopped'))
    if (signal.aborted) return abort()
    signal.addEventListener('abort', abort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

/**
 * Launch the bridge browser and get it ready: binary, profile, extension, developer mode, token,
 * Driver tab, minimized. Throws with the step that failed; the browser is closed again on a
 * failure after the spawn, so a half-set-up browser is never left running.
 */
export async function startBridgeBrowser(opts: BridgeBrowserOptions, deps: BridgeBrowserDeps = bridgeBrowserDeps()): Promise<BridgeBrowser> {
  const report = opts.report ?? (() => {})
  const step = <T>(promise: Promise<T>): Promise<T> => unlessAborted(promise, opts.signal)
  const extension = opts.extension ?? bridgeExtensionSource()
  if (!extension) throw new Error('the extension files are missing from this package (dist/chrome-extension)')
  const profileDir = join(opts.dir, 'profile')
  await step(mkdir(profileDir, { recursive: true }))
  const binary = await step(deps.binary(join(opts.dir, 'chrome'), report))
  if (await step(freeProfile(profileDir, deps))) report('stopped a browser an earlier daemon left behind')
  const extensionDir = await step(installableExtensionDir(extension, opts.dir))

  report('starting Chrome for Testing')
  const port = await step(deps.port())
  const browserUrl = `http://127.0.0.1:${port}`
  const child = deps.spawn(binary, bridgeBrowserLaunchArgs(port, profileDir))

  let exited: string | undefined
  let closing = false
  const exitListeners: ((detail: string) => void)[] = []
  const gone = (detail: string) => {
    if (exited) return
    exited = detail
    if (closing) return
    for (const listener of exitListeners) listener(detail)
  }
  child.on('exit', (code, signal) => gone(`Chrome exited${signal ? ` on ${signal}` : code !== null ? ` with code ${code}` : ''}`))
  child.on('error', err => gone(`Chrome could not start: ${err.message}`))

  // Waits for the browser to exit, a beat at a time, for up to `ms`.
  const exitWithin = async (ms: number): Promise<void> => {
    for (let beat = 0; beat < ms / BEAT_MS && !exited; beat++) await deps.sleep(BEAT_MS)
  }
  // Kill it, and kill it outright if it is still there a moment later: a browser left running
  // keeps the profile held, and the next daemon has to stop it first.
  const kill = async (): Promise<void> => {
    child.kill()
    await exitWithin(STALE_EXIT_MS)
    if (!exited) child.kill('SIGKILL')
  }
  let connected: BridgeBrowserCdp | undefined
  // One close, however often it is asked: a stop and the launch's own failure may both ask.
  let closed: Promise<void> | undefined
  const close = (): Promise<void> =>
    (closed ??= (async () => {
      closing = true
      if (!exited) {
        // Asked, not awaited: a browser that is quitting already (it got the terminal's Ctrl+C
        // too) may never answer, and the grace is all it gets either way.
        void connected?.call('Browser.close').catch(() => {})
        if (connected) await exitWithin(CLOSE_GRACE_MS)
        if (!exited) await kill()
      }
      connected?.close()
    })())
  const giveUp = (): void => void close()
  opts.signal?.addEventListener('abort', giveUp, { once: true })

  const ready = await step(deps.ready(browserUrl)).catch(async (err: unknown) => {
    await close()
    throw err
  })
  if (!ready) {
    await close()
    throw new Error(exited ?? 'Chrome never opened its debugging port')
  }
  const cdp = await step(deps.connect(browserUrl)).catch(async (err: unknown) => {
    await close()
    throw err
  })
  connected = cdp
  try {
    report('installing the extension')
    const extensionId = await installExtension(cdp, extensionDir)
    await enableDeveloperMode(cdp, deps.sleep)
    report('handing the extension the bridge token')
    await seedExtension(cdp, extensionId, opts.daemonUrl, opts.token, deps.sleep)
    await setWindowState(cdp, 'minimized')
    return {
      extensionId,
      page: async () => {
        const tab = await claudeTab(cdp).catch(() => undefined)
        return tab ? new URL(tab.url).pathname : undefined
      },
      show: async () => {
        await setWindowState(cdp, 'normal')
        await frontClaudeTab(cdp)
        deps.activate(binary)
      },
      hide: () => setWindowState(cdp, 'minimized'),
      onExit: listener => {
        if (exited && !closing) listener(exited)
        else exitListeners.push(listener)
      },
      close,
    }
  } catch (err) {
    await close()
    throw err
  } finally {
    opts.signal?.removeEventListener('abort', giveUp)
  }
}

/** Where the bridge browser stands, for the dashboard. */
export type BridgeBrowserStatus =
  | { state: 'off' }
  | { state: 'starting'; detail: string }
  /** `signIn`: the claude.ai tab is on the sign-in page, so a person has to sign in before anything is served. */
  | { state: 'running'; since: string; visible: boolean; signIn: boolean }
  | { state: 'stopped'; detail: string }

/** The claude.ai paths a signed-out browser lands on: the sign-in page, and the logout step that redirects to it. */
const SIGN_IN_PATHS = /^\/(login|logout)(\/|$)/

/** What the dashboard can ask of the bridge browser. */
export type BridgeBrowserAction = 'show' | 'hide' | 'restart'

/** The daemon's handle on its bridge browser: one at a time, started and stopped from the preference and the dashboard. */
export interface BridgeBrowserOwner {
  /** Where the browser stands; a running one is asked which page its claude.ai tab is on. */
  status(): Promise<BridgeBrowserStatus>
  /** Launch it, unless it is running or on its way. Resolves once the launch is over, either way. */
  start(): Promise<void>
  /** Close it, or cancel a launch under way. */
  stop(): Promise<void>
  act(action: BridgeBrowserAction): Promise<void>
}

/** How the owner launches a browser: the daemon's real launch, or a test's fake. `signal` aborts when a stop gives the launch up. */
export type BridgeBrowserLauncher = (report: (detail: string) => void, signal: AbortSignal) => Promise<BridgeBrowser>

/**
 * The one bridge browser a daemon runs. A launch is slow — the first one downloads Chrome — so
 * the status carries the step it is on, and a stop that lands mid-launch gives the launch up, and
 * closes the browser a launch that went on regardless hands over, rather than leaving it unowned. A browser that exits on its own
 * (the user quit it) is reported as stopped with the reason, and not relaunched: quitting it was
 * an act, and the dashboard offers a restart.
 */
export function bridgeBrowserOwner(launch: BridgeBrowserLauncher, log: (line: string) => void = () => {}): BridgeBrowserOwner {
  let current: BridgeBrowserStatus = { state: 'off' }
  let browser: BridgeBrowser | undefined
  let launching: Promise<void> | undefined
  let aborting: AbortController | undefined
  let generation = 0

  const start = async (): Promise<void> => {
    if (browser || launching) return launching
    const mine = ++generation
    const abort = (aborting = new AbortController())
    current = { state: 'starting', detail: 'preparing' }
    // A launcher that throws before it has anything to await — the bridge token it needs does not
    // exist — is a launch that failed, and goes the same way as one that failed later. Left as a
    // plain call, that throw would escape `start()` as a rejection nobody handles, and an
    // unhandled rejection ends the daemon process (#1332). The executor runs at once, so the
    // launcher is still called synchronously and its first step is readable right away.
    launching = new Promise<BridgeBrowser>(resolve =>
      resolve(
        launch(detail => {
          if (generation === mine) current = { state: 'starting', detail }
        }, abort.signal),
      ),
    )
      .then(async launched => {
        if (generation !== mine) {
          await launched.close()
          return
        }
        browser = launched
        current = { state: 'running', since: new Date().toISOString(), visible: false, signIn: false }
        log('[openagent] the bridge browser is running')
        launched.onExit(detail => {
          if (browser !== launched) return
          browser = undefined
          current = { state: 'stopped', detail }
          log(`[openagent] the bridge browser stopped: ${detail}`)
        })
      })
      .catch((err: unknown) => {
        if (generation !== mine) return
        const detail = err instanceof Error ? err.message : String(err)
        current = { state: 'stopped', detail }
        log(`[openagent] the bridge browser could not start: ${detail}`)
      })
      .finally(() => {
        launching = undefined
      })
    return launching
  }

  const stop = async (): Promise<void> => {
    generation++
    current = { state: 'off' }
    // A launch under way is given up rather than waited out: the first one downloads Chrome,
    // and a stop (the daemon's Ctrl+C) must not wait for that.
    aborting?.abort()
    await launching
    const running = browser
    browser = undefined
    await running?.close()
  }

  return {
    status: async () => {
      if (current.state !== 'running' || !browser) return current
      const page = await browser.page().catch(() => undefined)
      return { ...current, signIn: SIGN_IN_PATHS.test(page ?? '') }
    },
    start,
    stop,
    act: async action => {
      if (action === 'restart') {
        await stop()
        return start()
      }
      if (!browser) return
      if (action === 'show') {
        await browser.show()
        if (current.state === 'running') current = { ...current, visible: true }
      } else {
        await browser.hide()
        if (current.state === 'running') current = { ...current, visible: false }
      }
    },
  }
}
