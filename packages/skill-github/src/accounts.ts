import { spawn } from 'node:child_process'
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { errorMessage, type GhRunner } from './gh.js'

/**
 * The GitHub accounts this computer's `gh` knows, and the one OpenAgent's runs use. The terminal's
 * `gh` keeps its own active account; runs use the account picked here, given to each run as its
 * own token, so switching one never moves the other. The pick is the account `gh` had active when
 * OpenAgent first looked, kept from then on, until it is picked again here.
 *
 * The pick is kept in a file of its own, logins only: `gh` keeps the logins' tokens, and a run's
 * is asked of it when the run starts (`gh auth token --user`).
 */

/** The host this package answers for. */
export const HOST = 'github.com'

/** An account `gh` knows on the host. */
export interface GhAccount {
  login: string
  /** The terminal's: the one `gh` uses when it is not told which. */
  terminal: boolean
  /** Whether `gh` could use it when asked: false for a login GitHub no longer takes. */
  ok: boolean
}

/** What `gh` knows of the host: whether it is installed at all, and its accounts there. */
export type GhState = { installed: false } | { installed: true; accounts: GhAccount[] }

/** Where the runs' pick is kept: beside OpenAgent's other files in the person's config folder. */
export function picksPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env['XDG_CONFIG_HOME']) return join(env['XDG_CONFIG_HOME'], 'openagent-github.json')
  return join(env['HOME'] ?? homedir(), '.openagent-github.json')
}

interface PicksFile {
  /** The account runs use, by host. */
  runs: Record<string, string>
}

function readPicks(path: string): PicksFile {
  try {
    const file = JSON.parse(readFileSync(path, 'utf8')) as Partial<PicksFile>
    if (file.runs && typeof file.runs === 'object' && !Array.isArray(file.runs)) {
      return { runs: Object.fromEntries(Object.entries(file.runs).filter(([, login]) => typeof login === 'string')) }
    }
  } catch {
    // No file yet, or one that does not read: no pick.
  }
  return { runs: {} }
}

function writePicks(path: string, file: PicksFile): void {
  mkdirSync(dirname(path), { recursive: true })
  const next = `${path}.${process.pid}.tmp`
  writeFileSync(next, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 })
  chmodSync(next, 0o600)
  renameSync(next, path)
}

/** What `gh` knows of the host. A `gh` that is not on this computer is "not installed"; one that cannot say is no account. */
export async function ghState(cwd: string, gh: GhRunner): Promise<GhState> {
  try {
    await gh(['--version'], cwd)
  } catch (err) {
    if (/ENOENT|not found/i.test(errorMessage(err))) return { installed: false }
  }
  let said: unknown
  try {
    said = JSON.parse(await gh(['auth', 'status', '--json', 'hosts', '--hostname', HOST], cwd))
  } catch {
    return { installed: true, accounts: [] }
  }
  const rows = (said as { hosts?: Record<string, unknown> } | null)?.hosts?.[HOST]
  const accounts: GhAccount[] = []
  for (const row of Array.isArray(rows) ? rows : []) {
    const r = row as Record<string, unknown>
    if (typeof r['login'] !== 'string' || !r['login']) continue
    accounts.push({ login: r['login'], terminal: r['active'] === true, ok: r['state'] === 'success' })
  }
  return { installed: true, accounts }
}

/**
 * The account runs use: the one picked, while `gh` still knows it; else the terminal's, kept as
 * the pick from now on, so a later switch in the terminal leaves the runs where they were.
 */
export function runsAccount(accounts: readonly GhAccount[], path: string = picksPath()): string | undefined {
  const picks = readPicks(path)
  const picked = picks.runs[HOST]
  if (picked !== undefined && accounts.some(a => a.login === picked)) return picked
  const terminal = accounts.find(a => a.terminal)?.login
  if (terminal !== undefined) writePicks(path, { runs: { ...picks.runs, [HOST]: terminal } })
  return terminal
}

/** Runs use `login` from now on: an account `gh` knows. */
export function useForRuns(login: string, accounts: readonly GhAccount[], path: string = picksPath()): void {
  if (!accounts.some(a => a.login === login)) throw new Error(`gh knows no account ${login} on ${HOST}: add it first`)
  const picks = readPicks(path)
  writePicks(path, { runs: { ...picks.runs, [HOST]: login } })
}

/**
 * How `gh` is put on this computer with no admin: with Homebrew where it is, else GitHub's own
 * build for this computer, unpacked into `~/.local/bin`. One line, shown under the button as it runs.
 */
export function installCommand(hasBrew: boolean): string {
  if (hasBrew) return 'brew install gh'
  return [
    'tag=$(curl -fsSLI -o /dev/null -w "%{url_effective}" https://github.com/cli/cli/releases/latest) && v=${tag##*/v}',
    'case "$(uname -s)-$(uname -m)" in Darwin-arm64) f=macOS_arm64.zip;; Darwin-x86_64) f=macOS_amd64.zip;; Linux-x86_64) f=linux_amd64.tar.gz;; Linux-aarch64) f=linux_arm64.tar.gz;; *) echo "GitHub has no gh for $(uname -sm)" >&2; exit 1;; esac',
    'd=$(mktemp -d) && curl -fsSL -o "$d/$f" "https://github.com/cli/cli/releases/download/v$v/gh_${v}_$f"',
    'case $f in *.zip) unzip -q "$d/$f" -d "$d";; *) tar -xzf "$d/$f" -C "$d";; esac',
    'mkdir -p "$HOME/.local/bin" && mv "$d"/gh_*/bin/gh "$HOME/.local/bin/gh" && rm -rf "$d"',
  ].join('; ')
}

/** Whether Homebrew is on this computer. */
export async function hasBrew(run: (bin: string, args: string[]) => Promise<boolean> = probe): Promise<boolean> {
  return run('brew', ['--version'])
}

function probe(bin: string, args: string[]): Promise<boolean> {
  return new Promise(resolve => {
    const child = spawn(bin, args, { stdio: 'ignore' })
    child.once('error', () => resolve(false))
    child.once('close', code => resolve(code === 0))
  })
}

/** What this package starts that goes on after it answered: the install, and a login waiting for the browser's yes. */
export type Job = 'install' | 'login'

/** Where a job keeps what it said, which process it is, and how it ended. */
export interface JobFiles {
  log: string
  pid: string
  exit: string
}

export function jobFiles(job: Job, env: NodeJS.ProcessEnv = process.env): JobFiles {
  const dir = join(env['TMPDIR'] ?? tmpdir(), `openagent-github-${process.getuid?.() ?? 'user'}`)
  return { log: join(dir, `${job}.log`), pid: join(dir, `${job}.pid`), exit: join(dir, `${job}.exit`) }
}

/** How a job is: going on, or ended, with its last lines when it failed; nothing when none was started. */
export type JobState = { running: true; said: string } | { running: false; failed?: string; said: string }

export function jobState(files: JobFiles): JobState | undefined {
  const read = (path: string): string | undefined => {
    try {
      return readFileSync(path, 'utf8')
    } catch {
      return undefined
    }
  }
  const said = read(files.log)
  if (said === undefined) return undefined
  const exit = read(files.exit)?.trim()
  if (exit === undefined || exit === '') {
    const pid = Number(read(files.pid)?.trim())
    let alive = false
    try {
      if (pid) alive = process.kill(pid, 0)
    } catch {
      alive = false
    }
    // A process gone with no end written was ended from outside: it failed.
    return alive ? { running: true, said } : { running: false, failed: lastLines(said) || 'it was stopped', said }
  }
  return exit === '0' ? { running: false, said } : { running: false, failed: lastLines(said) || `it ended with ${exit}`, said }
}

function lastLines(said: string): string {
  return said.trim().split('\n').slice(-3).join('\n')
}

/**
 * Start `script` in a shell of its own, which goes on after this process ends, writing what it
 * says to the job's log itself (a pipe would end with this process) and how it ended after.
 * `args` are its `$1`, `$2`….
 */
export async function startJob(files: JobFiles, script: string, args: readonly string[] = []): Promise<void> {
  mkdirSync(dirname(files.log), { recursive: true })
  writeFileSync(files.log, '')
  rmSync(files.exit, { force: true })
  const child = spawn('sh', ['-c', `log=$1; ended=$2; shift 2; exec >>"$log" 2>&1; (${script}); echo $? >"$ended"`, 'sh', files.log, files.exit, ...args], { detached: true, stdio: 'ignore' })
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', reject)
  })
  child.unref()
  writeFileSync(files.pid, String(child.pid))
}

/** A login in the browser, under way: the code the person types, and where. */
export interface LoggingIn {
  code: string
  url: string
}

const CODE = /one-time code: ([A-Z0-9]{4}-[A-Z0-9]{4})/
const DEVICE_URL = /(https:\/\/github\.com\/login\/device)/

function codeIn(said: string): LoggingIn | undefined {
  const code = CODE.exec(said)?.[1]
  return code ? { code, url: DEVICE_URL.exec(said)?.[1] ?? 'https://github.com/login/device' } : undefined
}

/** The login under way, while its `gh` is still waiting for the browser's yes. */
export function loginUnderWay(files = jobFiles('login')): LoggingIn | undefined {
  const state = jobState(files)
  return state?.running ? codeIn(state.said) : undefined
}

/**
 * Log an account in to `gh` in the browser: GitHub's device login, whose code the person types at
 * github.com/login/device, wherever they are. `gh` makes the new account the terminal's, so once
 * the browser said yes, the terminal's account before it is made the terminal's again: logging an
 * account in for runs leaves the terminal as it was. Answers once `gh` showed the code; `gh`
 * waits on, in a process of its own, for the yes.
 */
export async function startLogin(terminal: string | undefined, files = jobFiles('login'), waitMs = 20_000): Promise<LoggingIn> {
  const under = loginUnderWay(files)
  if (under) return under
  const back = terminal !== undefined ? ` && gh auth switch --hostname ${HOST} --user "$1"` : ''
  await startJob(files, `gh auth login --hostname ${HOST} --git-protocol https --web${back}`, terminal !== undefined ? [terminal] : [])
  const until = Date.now() + waitMs
  for (;;) {
    const state = jobState(files)
    const shown = state ? codeIn(state.said) : undefined
    if (shown) return shown
    if (!state?.running || Date.now() > until) {
      if (state?.running) stopJob(files)
      throw new Error((state && !state.running ? state.failed : undefined) ?? (lastLines(state?.said ?? '') || 'gh showed no code to log in with'))
    }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
}

function stopJob(files: JobFiles): void {
  try {
    process.kill(-Number(readFileSync(files.pid, 'utf8').trim()), 'SIGTERM')
  } catch {
    // Gone already.
  }
}

/**
 * The environment a run gets to work as `login`: its token for `gh`, and the same token for git's
 * pushes and fetches to GitHub, whatever the person's own git keeps for it (the keychain, a
 * different helper, an ssh key). Set through git's environment, so nothing of the person's own
 * settings changes. The settings already in the environment are kept.
 */
export function runEnv(token: string, env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const given = Number(env['GIT_CONFIG_COUNT'] ?? 0) || 0
  const lines: [string, string][] = [
    // An empty helper drops every helper set before it; then one that answers with the token.
    [`credential.https://${HOST}.helper`, ''],
    [`credential.https://${HOST}.helper`, '!f() { test "$1" = get && echo username=x-access-token && echo "password=$GH_TOKEN"; }; f'],
    // A remote read over ssh goes over https too, where the token is the one asked.
    [`url.https://${HOST}/.insteadOf`, `git@${HOST}:`],
    [`url.https://${HOST}/.insteadOf`, `ssh://git@${HOST}/`],
  ]
  const out: Record<string, string> = { GH_TOKEN: token, GIT_CONFIG_COUNT: String(given + lines.length) }
  lines.forEach(([key, value], i) => {
    out[`GIT_CONFIG_KEY_${given + i}`] = key
    out[`GIT_CONFIG_VALUE_${given + i}`] = value
  })
  return out
}
