import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveChromePath } from './chrome.js'
import type { HostAnswer, HostCommand, HostState } from './host.js'

/**
 * The `browser` command. Each call is short: it finds the browser's own process for this project
 * (the state file under the temp directory, keyed by the project's root), starting it on `open`
 * when there is none, and forwards the command to it. The page comes back as text on stdout.
 *
 * Exit codes: 0 done, 1 a refusal (the sentence on stderr), 2 a command line that could not be read.
 */

export const USAGE = `usage: browser <command>

  open <address>          open the address, starting the browser if none is open, and print the page
  read                    print the page: its text, then its numbered elements
  click <n>               click element n of the last read, then print the page
  type <n> <text>         replace what element n holds with the text (a select: pick that option),
                          then print the page
  press <key>             press Enter, Tab, Escape, Backspace, Space, ArrowUp, ArrowDown, ArrowLeft
                          or ArrowRight, then print the page
  screenshot [file]       save what the page shows as a PNG, and print the file's path
  eval <script>           run JavaScript in the page and print what it returns, as JSON
  console                 print the page's console: what it logged, and its errors
  close                   close the browser

Exit code 1 for a refusal (the reason on stderr), 2 for a usage error.`

export interface CliIo {
  cwd: string
  env: NodeJS.ProcessEnv
  stdout: (line: string) => void
  stderr: (line: string) => void
}

/** How long a browser sits unused before it closes itself. */
export const IDLE_MS = 30 * 60 * 1000

/** How many arguments each command takes: [least, most]. */
const ARITY: Record<HostCommand['name'], [number, number]> = {
  open: [1, 1],
  read: [0, 0],
  click: [1, 1],
  type: [2, 2],
  press: [1, 1],
  screenshot: [0, 1],
  eval: [1, 1],
  console: [0, 0],
  close: [0, 0],
}

/** The project a browser belongs to: the git root of the working directory, else the directory itself. */
export function projectRoot(cwd: string): string {
  const git = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' })
  return git.status === 0 ? git.stdout.trim() : resolve(cwd)
}

/** Where the browser's process of a project writes how to reach it. */
export function stateFile(root: string): string {
  return join(tmpdir(), 'skill-browser', `${createHash('sha256').update(root).digest('hex').slice(0, 16)}.json`)
}

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  const [name, ...args] = argv
  if (name === '--help' || name === '-h') {
    io.stdout(USAGE)
    return 0
  }
  const arity = name !== undefined && Object.hasOwn(ARITY, name) ? ARITY[name as HostCommand['name']] : undefined
  if (!arity || args.length < arity[0] || args.length > arity[1]) {
    io.stderr(USAGE)
    return 2
  }
  const refuse = (reason: string): number => {
    io.stderr(reason)
    return 1
  }

  const file = stateFile(projectRoot(io.cwd))
  if (!(await ownDirectory(dirname(file)))) return refuse(`${dirname(file)} is not this user's own directory: remove it, then run the command again.`)
  let state = await liveState(file)
  if (!state) {
    if (name === 'close') {
      io.stdout('No browser is open.')
      return 0
    }
    if (name !== 'open') return refuse('No browser is open. Start one with `browser open <address>`.')
    const chromePath = resolveChromePath(io.env)
    if (!chromePath) return refuse('No Chrome on this machine: install Google Chrome, or set CHROME_PATH to a Chrome or Chromium executable.')
    const started = await startHost(file, chromePath, io.env)
    if ('error' in started) return refuse(`The browser could not start: ${started.error}`)
    state = started
  }

  const answer = await send(state, { name: name as HostCommand['name'], args })
  if (!answer.ok) return refuse(answer.reason)
  if (answer.png !== undefined) {
    const path = resolve(io.cwd, args[0] ?? join(tmpdir(), `browser-${Date.now()}.png`))
    try {
      await writeFile(path, Buffer.from(answer.png, 'base64'))
    } catch (err) {
      return refuse(`The screenshot could not be saved to ${path}: ${err instanceof Error ? err.message : String(err)}`)
    }
    io.stdout(path)
    return 0
  }
  io.stdout(answer.output)
  return 0
}

/** The state of a browser that answers, or `undefined` (a stale file is removed). */
async function liveState(file: string): Promise<HostState | undefined> {
  const state = await readState(file)
  if (!state) return undefined
  if ('error' in state) {
    await rm(file, { force: true })
    return undefined
  }
  const alive = await fetch(`http://127.0.0.1:${state.port}/alive`, { headers: { 'x-browser-token': state.token } }).then(res => res.ok, () => false)
  if (alive) return state
  await rm(file, { force: true })
  return undefined
}

async function readState(file: string): Promise<HostState | { error: string } | undefined> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as HostState | { error: string }
  } catch {
    return undefined
  }
}

/**
 * The state directory, private to this user: made so when missing, closed to others when it is
 * this user's; `false` when it is someone else's, since a state file there says where commands go.
 */
async function ownDirectory(dir: string): Promise<boolean> {
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const info = await stat(dir)
  if (process.getuid !== undefined && info.uid !== process.getuid()) return false
  if ((info.mode & 0o077) !== 0) await chmod(dir, 0o700)
  return true
}

/** How long `open` waits for the browser's process: past Chrome's own launch wait, so its error is what is said. */
const START_MS = 75_000

/**
 * Start the browser's process, detached so it outlives this command, and wait for its state file.
 * A lock file lets only one command start it: a second `open` meanwhile waits for the first's.
 */
async function startHost(file: string, chromePath: string, env: NodeJS.ProcessEnv): Promise<HostState | { error: string }> {
  const lock = `${file}.starting`
  const held = await open(lock, 'wx').then(handle => handle.close().then(() => true), () => false)
  if (!held) {
    // A lock older than the wait below was left by a command that died while starting.
    const age = Date.now() - ((await stat(lock).catch(() => undefined))?.mtimeMs ?? 0)
    if (age > START_MS + 5_000) {
      await rm(lock, { force: true })
      return startHost(file, chromePath, env)
    }
  } else {
    await rm(file, { force: true })
    const main = fileURLToPath(new URL('./host-main.js', import.meta.url))
    const child = spawn(process.execPath, [main, '--state', file, '--chrome', chromePath, '--idle-ms', String(IDLE_MS)], { detached: true, stdio: 'ignore', env })
    child.unref()
  }
  try {
    return await waitForState(file)
  } finally {
    if (held) await rm(lock, { force: true })
  }
}

async function waitForState(file: string): Promise<HostState | { error: string }> {
  const deadline = Date.now() + START_MS
  while (Date.now() < deadline) {
    const state = await readState(file)
    if (state) return state
    await new Promise(r => setTimeout(r, 100))
  }
  return { error: `it did not answer within ${START_MS / 1000}s` }
}

async function send(state: HostState, command: HostCommand): Promise<HostAnswer> {
  try {
    const res = await fetch(`http://127.0.0.1:${state.port}/command`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-browser-token': state.token },
      body: JSON.stringify(command),
      signal: AbortSignal.timeout(90_000),
    })
    return (await res.json()) as HostAnswer
  } catch (err) {
    return { ok: false, reason: `The browser stopped answering: ${err instanceof Error ? err.message : String(err)}` }
  }
}
