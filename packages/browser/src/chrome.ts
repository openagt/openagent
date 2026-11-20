import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'

/**
 * The browser's Chrome: the machine's own Chrome, headless, on a throwaway profile, with its
 * debugging port open on loopback only. Headless so a run never puts a window on the screen of
 * the person at the machine; the throwaway profile so the agent never sees their logins.
 */

/** The prefix of every profile this package makes. */
const PROFILE_PREFIX = 'skill-browser-'

/** Where Chrome usually lives, per platform. First hit wins. */
const CHROME_PATHS: Record<string, string[]> = {
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'],
  linux: ['/opt/google/chrome/chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
  win32: ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'],
}

/** The names looked for on `PATH` when no well-known path exists. */
const CHROME_BINARIES = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']

/**
 * The Chrome to launch, or `undefined` when the machine has none. `CHROME_PATH` wins. `exists` is
 * a parameter so a test does not depend on what the host has installed.
 */
export function resolveChromePath(env: NodeJS.ProcessEnv = process.env, platform: string = process.platform, exists: (path: string) => boolean = existsSync): string | undefined {
  if (env.CHROME_PATH && exists(env.CHROME_PATH)) return env.CHROME_PATH
  for (const candidate of CHROME_PATHS[platform] ?? []) if (exists(candidate)) return candidate
  const exts = platform === 'win32' ? ['.exe', ''] : ['']
  for (const name of CHROME_BINARIES) {
    for (const dir of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
      for (const ext of exts) if (exists(join(dir, name + ext))) return join(dir, name + ext)
    }
  }
  return undefined
}

/** The launch flags. Port 0: Chrome picks a free one and writes it to the profile's `DevToolsActivePort`. */
export function chromeArgs(profile: string): string[] {
  return [
    '--headless=new',
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1280,800',
    'about:blank',
  ]
}

export interface Chrome {
  /** The debugging endpoint, `http://127.0.0.1:<port>`. */
  endpoint: string
  process: ChildProcess
  /** Kill Chrome and remove its profile. Safe to call twice. */
  close(): Promise<void>
}

/**
 * Launch Chrome and wait until its debugging port answers. Throws with a sentence when it cannot.
 * A first start on a busy machine can take past 20 seconds (seen on a CI runner), so the wait is a
 * minute: a slow start still succeeds, and a healthy one answers as soon as the port does.
 */
export async function launchChrome(chromePath: string, timeoutMs = 60_000): Promise<Chrome> {
  const profile = await mkdtemp(join(tmpdir(), PROFILE_PREFIX))
  const child = spawn(chromePath, chromeArgs(profile), { stdio: 'ignore' })
  let closed = false
  const close = async (): Promise<void> => {
    if (closed) return
    closed = true
    // The profile goes once Chrome has exited, since until then it still writes there; a Chrome
    // that does not exit within 5 seconds of the signal is killed outright.
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve))
      child.kill()
      const force = setTimeout(() => child.kill('SIGKILL'), 5000)
      await exited
      clearTimeout(force)
    }
    await rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {})
  }
  const failed = new Promise<never>((_, reject) => {
    child.once('error', err => reject(new Error(`Chrome could not start: ${err.message}`)))
    child.once('exit', code => reject(new Error(`Chrome exited as it started (code ${code})`)))
  })
  failed.catch(() => {})
  try {
    const endpoint = await Promise.race([waitForEndpoint(profile, timeoutMs), failed])
    return { endpoint, process: child, close }
  } catch (err) {
    await close()
    throw err
  }
}

/** Read the port Chrome wrote, then poll `/json/version` until it answers. */
async function waitForEndpoint(profile: string, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8').catch(() => '')).split('\n')[0]
    if (port) {
      const endpoint = `http://127.0.0.1:${port}`
      const up = await fetch(`${endpoint}/json/version`).then(res => res.ok, () => false)
      if (up) return endpoint
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Chrome did not open its debugging port within ${timeoutMs / 1000}s`)
}
