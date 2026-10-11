import { spawn } from 'node:child_process'
import { exec as ownExec, lastLines, openSession, withAdvice, type Exec, type Said, type Session } from './ssh.js'
import { LOGIN_TIMEOUT_MS, claudeLoginScript, claudeLogoutScript, githubLoginScript, githubLogoutScript, type LoginScript } from './steps.js'
import { BEAT_MS, atWork, changeServer, isAccount, readStore, type LoginKind, type Server } from './store.js'

/**
 * The two logins a server works with, and how each gets there: over SSH, as the install's own
 * scripts do, never through the browser and never through the server's door.
 *
 * GitHub's is this computer's own, read from `gh` and copied. Claude's is made new for the
 * server: `claude setup-token` asks the person in this computer's browser and shows a login
 * that lasts a year; this computer's own Claude login is never read. Neither is written
 * anywhere on this computer, and what a server said is kept without them.
 */

export type Failed = { ok: false; error: string }

/** How long one of this computer's own commands gets to answer. */
const OWN_TIMEOUT_MS = 15_000

/** Why this computer's `gh` gave nothing, in words: never its own, which could hold what it was asked for. */
function noGh(said: Said, otherwise: string): Failed {
  return { ok: false, error: `There is no GitHub login to copy from this computer. ${/could not start/.test(said.err) ? '`gh` is not on this computer.' : otherwise}` }
}

/** The GitHub account `gh` is logged in to on this computer: whose login a copy would be. */
export async function ownGithubAccount(run: Exec = ownExec): Promise<{ ok: true; account: string } | Failed> {
  const said = await run('gh', ['api', 'user', '--jq', '.login'], '', { timeoutMs: OWN_TIMEOUT_MS })
  const account = said.out.trim()
  return said.code === 0 && isAccount(account) ? { ok: true, account } : noGh(said, '`gh` is not logged in to github.com here, or GitHub does not answer: see `gh auth status`.')
}

/** This computer's GitHub login, as `gh` keeps it. */
async function ownGithubLogin(run: Exec): Promise<{ ok: true; login: string } | Failed> {
  const said = await run('gh', ['auth', 'token', '--hostname', 'github.com'], '', { timeoutMs: OWN_TIMEOUT_MS })
  const login = said.out.trim()
  // What it reads as is what GitHub hands out; anything else is not sent anywhere.
  return said.code === 0 && /^[A-Za-z0-9_]{20,255}$/.test(login) ? { ok: true, login } : noGh(said, '`gh` is not logged in to github.com here: run `gh auth login`.')
}

/** `text` without the login it may repeat. */
export function scrubbed(text: string, login: string): string {
  return login ? text.replaceAll(login, '•••') : text
}

/** Run a login's script on the server. What comes back never holds the login. */
async function send(session: Session, { as, script }: LoginScript, login = ''): Promise<Said> {
  const said = await session.run(as, script, LOGIN_TIMEOUT_MS)
  return { code: said.code, out: scrubbed(said.out, login), err: scrubbed(said.err, login) }
}

export type GithubGiven = { ok: true; account: string } | (Failed & { /** The server was told to drop the login it had: it has none now. */ reached: boolean })

/** Copy this computer's GitHub login to the server on a line that is already open. */
export async function giveGithub(session: Session, run: Exec = ownExec): Promise<GithubGiven> {
  const own = await ownGithubLogin(run)
  if (!own.ok) return { ...own, reached: false }
  const said = await send(session, githubLoginScript(own.login), own.login)
  if (said.code !== 0) return { ok: false, error: lastLines(said) || 'The server did not answer.', reached: true }
  const account = said.out.trim().split('\n').at(-1)?.trim()
  return isAccount(account) ? { ok: true, account } : { ok: false, error: 'The server took the login and did not say whose it is.', reached: true }
}

/** Write down how a copy of the GitHub login went. `tell` keeps a failure's words for the page: for a copy nobody waits for the answer of. */
export function noteGithub(kept: Server, given: GithubGiven, tell: boolean): void {
  if (given.ok) return void (kept.github = { since: new Date().toISOString(), account: given.account })
  const { since, account } = given.reached ? {} : (kept.github ?? {})
  kept.github = { ...(since ? { since } : {}), ...(account ? { account } : {}), ...(tell ? { failed: given.error } : {}) }
}

/** What Claude Code writes before and after the login it made. */
const MINTED = /Your OAuth token[^\n]*:\s*([A-Za-z0-9_-]{40,400})\s+Store this token securely/
/** What a terminal is told beside words: colours, where the cursor goes, a link's address. */
const TERMINAL = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g

/** The words Claude Code showed, without what only a terminal reads. */
const words = (shown: string): string => shown.replace(TERMINAL, '').replaceAll('\r', '\n')

/** The login among what Claude Code showed, once all of it is there. */
export function mintedIn(shown: string): string | undefined {
  return MINTED.exec(words(shown))?.[1]
}

/** Why Claude Code ended without a login, from what it showed: its last lines, never a part of a login. */
export function notMinted(shown: string): string {
  const text = words(shown)
  if (/Your OAuth token/.test(text)) return 'Claude Code made a login, and this OpenAgent could not read it off what Claude Code showed.'
  const lines = [...new Set(text.split('\n').map(line => line.trim()).filter(Boolean))]
  return ['Claude Code ended without a login.', ...lines.slice(-5)].join('\n')
}

export interface MintOptions {
  signal?: AbortSignal
  /** How long the person has to say yes in the browser. */
  timeoutMs?: number
  /** The command that makes the login; Claude Code's own when unsaid. */
  command?: string
}

/** How a Claude login is made for a server. */
export type Mint = (opts?: MintOptions) => Promise<{ ok: true; login: string } | Failed>

const MINT_TIMEOUT_MS = 10 * 60_000
/** How much of what Claude Code showed is kept: its end, where the login is. */
const SHOWN = 256 * 1024

/**
 * Make a Claude login that lasts a year, with Claude Code's own `claude setup-token`: it opens
 * this computer's browser, the person says yes there, and it shows the login once. It keeps
 * nothing, and neither does this.
 *
 * Claude Code draws on a terminal's screen and this process has none, so the system's `script`
 * lends it one, wide enough that the login stays on one line. Its input is a pipe nothing ever
 * writes to, and the whole group of processes ends with it.
 */
export const mintClaude: Mint = ({ signal, timeoutMs = MINT_TIMEOUT_MS, command = 'claude setup-token' } = {}) =>
  new Promise(resolve => {
    const inner = `stty cols 250 rows 50; command -v ${command.split(' ')[0]} >/dev/null || { echo "Claude Code is not on this computer."; exit 1; }; exec ${command}`
    const lent = process.platform === 'darwin' ? 'script -q /dev/null sh -c "$0"' : 'script -q -e -c "$0" /dev/null'
    const child = spawn('sh', ['-c', `tail -f /dev/null | { ${lent}; kill 0; }`, inner], { stdio: ['ignore', 'pipe', 'pipe'], detached: true })
    let shown = ''
    let ended = false
    const end = (answer: { ok: true; login: string } | Failed): void => {
      if (ended) return
      ended = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', stopped)
      try {
        process.kill(-child.pid!, 'SIGKILL')
      } catch {
        // Gone already.
      }
      child.stdout.destroy()
      child.stderr.destroy()
      resolve(answer)
    }
    const stopped = (): void => end({ ok: false, error: 'The login was stopped.' })
    const timer = setTimeout(() => end({ ok: false, error: `No yes came from the browser in ${Math.round(timeoutMs / 60_000)} minutes.` }), timeoutMs)
    signal?.addEventListener('abort', stopped, { once: true })
    if (signal?.aborted) stopped()
    const read = (said: string): void => {
      shown = (shown + said).slice(-SHOWN)
      const login = mintedIn(shown)
      if (login) end({ ok: true, login })
    }
    child.stdout.setEncoding('utf8').on('data', read)
    child.stderr.setEncoding('utf8').on('data', read)
    child.once('error', error => end({ ok: false, error: `Claude Code could not be started: ${error.message}` }))
    child.once('close', () => end({ ok: false, error: notMinted(shown) }))
  })

export interface LoginOptions {
  env: NodeJS.ProcessEnv
  address: string
  exec?: Exec
  mint?: Mint
  signal?: AbortSignal
  /** How often the file is told the login is still being made. */
  beatMs?: number
}

/** Refused: a Claude login is already being made for the server, in another process. */
export class AlreadyAsking extends Error {
  constructor(address: string) {
    super(`A Claude login is being made for ${address} right now`)
  }
}

async function saved(env: NodeJS.ProcessEnv, address: string): Promise<Pick<Server, 'address' | 'user'>> {
  const server = (await readStore(env)).servers.find(candidate => candidate.address === address)
  if (!server) throw new Error(`no server at ${address}`)
  return { address: server.address, user: server.user }
}

/** Open a line to the server, meet it, and do `work` on it; a server that cannot be met is told with what to do about it. */
async function onServer<T>(server: Pick<Server, 'address' | 'user'>, opts: Pick<LoginOptions, 'exec' | 'signal'>, work: (session: Session) => Promise<T>): Promise<T | (Failed & { reached: false })> {
  const session = await openSession(server, { ...(opts.exec ? { exec: opts.exec } : {}), ...(opts.signal ? { signal: opts.signal } : {}) })
  try {
    const met = await session.meet()
    if (!met.ok) return { ok: false, error: withAdvice(server, met.said || 'The server did not answer.'), reached: false }
    return await work(session)
  } finally {
    await session.close()
  }
}

/** Copy this computer's GitHub login to the server, now. */
export async function copyGithub(opts: LoginOptions): Promise<{ ok: true } | Failed> {
  const server = await saved(opts.env, opts.address)
  const given = await onServer(server, opts, session => giveGithub(session, opts.exec))
  await changeServer(opts.env, server.address, kept => noteGithub(kept, given, false))
  return given.ok ? { ok: true } : { ok: false, error: given.error }
}

/** Take a login off the server. What this computer knew of it is forgotten once the server said it is gone. */
export async function removeLogin(opts: LoginOptions & { kind: LoginKind }): Promise<{ ok: true } | Failed> {
  const server = await saved(opts.env, opts.address)
  const gone = await onServer(server, opts, async session => {
    const said = await send(session, opts.kind === 'github' ? githubLogoutScript() : claudeLogoutScript())
    return said.code === 0 ? { ok: true as const } : { ok: false as const, error: lastLines(said) || 'The server did not answer.' }
  })
  if (!gone.ok) return { ok: false, error: gone.error }
  await changeServer(opts.env, server.address, kept => void delete kept[opts.kind])
  return { ok: true }
}

/**
 * Make a Claude login for the server and give it to it: the person says yes in the browser,
 * and the login goes from Claude Code's screen to the server's own file. Run as a process of
 * its own: a person takes a while, and a command a page runs has seconds. How it ended is
 * written to the file, for the page.
 */
export async function makeClaude(opts: LoginOptions): Promise<void> {
  const { env, address } = opts
  const mine = (kept: Server): boolean => kept.claude?.worker?.pid === process.pid
  const beat = (): { pid: number; seen: string } => ({ pid: process.pid, seen: new Date().toISOString() })
  // This process's from here on; the command that started it held it under its own name until now.
  const server = await changeServer(env, address, kept => {
    const worker = kept.claude?.worker
    if (atWork(worker) && worker!.pid !== process.pid && worker!.pid !== process.ppid) throw new AlreadyAsking(address)
    kept.claude = { ...(kept.claude?.since ? { since: kept.claude.since } : {}), worker: beat() }
    return { address: kept.address, user: kept.user }
  })
  if (!server) throw new Error(`no server at ${address}`)
  const beating = setInterval(() => void changeServer(env, address, kept => void (mine(kept) && (kept.claude!.worker = beat()))).catch(() => {}), opts.beatMs ?? BEAT_MS)
  let failed: string | undefined = 'The login was stopped.'
  let made = false
  try {
    const minted = await (opts.mint ?? mintClaude)(opts.signal ? { signal: opts.signal } : {})
    if (!minted.ok) return void (failed = minted.error)
    const given = await onServer(server, opts, async session => {
      const said = await send(session, claudeLoginScript(minted.login), minted.login)
      return said.code === 0 ? { ok: true as const } : { ok: false as const, error: lastLines(said) || 'The server did not answer.' }
    })
    if (given.ok) made = true
    else failed = given.error
  } finally {
    clearInterval(beating)
    await changeServer(env, address, kept => {
      // One that was started over is another process's by now: nothing of it is this one's to write.
      if (!mine(kept)) return
      kept.claude = made ? { since: new Date().toISOString() } : { ...(kept.claude?.since ? { since: kept.claude.since } : {}), ...(failed ? { failed } : {}) }
    }).catch(() => {})
  }
}
