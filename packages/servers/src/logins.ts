import { spawn } from 'node:child_process'
import { exec as ownExec, lastLines, openSession, withAdvice, type Exec, type Said, type Session } from './ssh.js'
import { LOGIN_TIMEOUT_MS, claudeLoginScript, claudeLogoutScript, githubLoginScript, githubLogoutScript, type LoginScript } from './steps.js'
import { BEAT_MS, atWork, changeServer, isAccount, type Login, type LoginKind, type Server } from './store.js'

/**
 * The two logins a server works with, and how each gets there: over SSH, as the install's own
 * scripts do, never through the browser and never through the server's door.
 *
 * GitHub's is this computer's own, read from `gh` and copied. Claude's is made new for the
 * server: `claude setup-token` asks the person in this computer's browser and shows a login
 * that lasts a year; this computer's own Claude login is never read. Neither is written
 * anywhere on this computer, and what a server said is kept without them.
 *
 * Taking a login off the server deletes it there. It does not end the login: GitHub's is still
 * this computer's own, and Claude's is good until its year is over.
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
  const said = await run('gh', ['api', '--hostname', 'github.com', 'user', '--jq', '.login'], '', { timeoutMs: OWN_TIMEOUT_MS })
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

type Sent = { ok: true; out: string } | Failed

/** Run a login's script on the server. What comes back never holds the login. */
async function send(session: Session, { as, script }: LoginScript, login = ''): Promise<Sent> {
  const said = await session.run(as, script, LOGIN_TIMEOUT_MS)
  const clean = { out: scrubbed(said.out, login), err: scrubbed(said.err, login) }
  return said.code === 0 ? { ok: true, out: clean.out } : { ok: false, error: lastLines(clean) || 'The server did not answer.' }
}

export type GithubGiven =
  | { ok: true; account: string }
  | (Failed & {
      /** The server was sent the login. Its script leaves no login behind when it fails; a line that broke half-way leaves that unknown. */
      reached: boolean
    })

/** Copy this computer's GitHub login to the server on a line that is already open. */
export async function giveGithub(session: Session, run: Exec = ownExec): Promise<GithubGiven> {
  const own = await ownGithubLogin(run)
  if (!own.ok) return { ...own, reached: false }
  const sent = await send(session, githubLoginScript(own.login), own.login)
  if (!sent.ok) return { ...sent, reached: true }
  const account = sent.out.trim().split('\n').at(-1)?.trim()
  return isAccount(account) ? { ok: true, account } : { ok: false, error: 'The server took the login and did not say whose it is.', reached: true }
}

/** What is known of a login beyond a try: since when it is there, and whose it is. */
const known = (login: Login | undefined): Login => ({ ...(login?.since ? { since: login.since } : {}), ...(login?.account ? { account: login.account } : {}) })

/** Write down how a copy of the GitHub login went. */
export function noteGithub(kept: Server, given: GithubGiven): void {
  if (given.ok) kept.github = { since: new Date().toISOString(), account: given.account }
  // One that was sent and did not arrive replaced what the server had: this computer no longer counts on a login there.
  else kept.github = { ...(given.reached ? {} : known(kept.github)), failed: given.error }
}

/** What Claude Code writes before and after the login it made, and what such a login reads as. */
const MINTED = /Your OAuth token[^\n]*:\s*(sk-ant-[A-Za-z0-9_-]{40,400})\s+Store this token securely/
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
  const lines = [...new Set(text.split('\n').map(line => line.trim()).filter(line => line && !STARTED_AS.test(line)))]
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
/** The line the lent terminal's first program writes of itself, before it becomes Claude Code. */
const STARTED_AS = /^started as (\d+)$/m

/**
 * Make a Claude login that lasts a year, with Claude Code's own `claude setup-token`: it opens
 * this computer's browser, the person says yes there, and it shows the login once. It keeps
 * nothing, and neither does this.
 *
 * Claude Code draws on a terminal's screen and this process has none, so the system's `script`
 * lends it one, wide enough that the login stays on one line. Its input is a pipe nothing ever
 * writes to. `script` gives its program a group of its own, so that program first says which
 * process it is: at the end both groups are ended, whether or not Claude Code heeds a terminal
 * that went away.
 */
export const mintClaude: Mint = ({ signal, timeoutMs = MINT_TIMEOUT_MS, command = 'claude setup-token' } = {}) =>
  new Promise(resolve => {
    const inner = `echo "started as $$"; stty cols 250 rows 50; command -v ${command.split(' ')[0]} >/dev/null || { echo "Claude Code is not on this computer."; exit 1; }; exec ${command}`
    const lent = process.platform === 'darwin' ? 'script -q /dev/null sh -c "$0"' : 'script -q -e -c "$0" /dev/null'
    // On Linux `script` starts its program with the person's own shell, and the line above is written for sh.
    const child = spawn('sh', ['-c', `tail -f /dev/null | { ${lent}; kill 0; }`, inner], { stdio: ['ignore', 'pipe', 'pipe'], detached: true, env: { ...process.env, SHELL: '/bin/sh' } })
    let shown = ''
    let lentTo: number | undefined
    let ended = false
    const end = (answer: { ok: true; login: string } | Failed): void => {
      if (ended) return
      ended = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', stopped)
      for (const group of [lentTo, child.pid]) {
        if (group === undefined || group <= 1) continue
        try {
          process.kill(-group, 'SIGKILL')
        } catch {
          // Gone already.
        }
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
      // Read once, as it comes: it is the first thing written, and a long wait scrolls it out of what is kept.
      lentTo ??= Number(STARTED_AS.exec(words(shown))?.[1]) || undefined
      const login = mintedIn(shown)
      if (login) end({ ok: true, login })
    }
    child.stdout.setEncoding('utf8').on('data', read)
    child.stderr.setEncoding('utf8').on('data', read)
    child.once('error', error => end({ ok: false, error: `Claude Code could not be started: ${error.message}` }))
    child.once('close', () => end({ ok: false, error: notMinted(shown) }))
  })

/** One change to one login of a server. */
export interface Job {
  kind: LoginKind
  /** Take the login off the server, where otherwise the server is given one. */
  remove: boolean
}

export interface LoginOptions extends Job {
  env: NodeJS.ProcessEnv
  address: string
  exec?: Exec
  mint?: Mint
  /** Stops waiting for the person. What was already on its way to the server arrives all the same. */
  signal?: AbortSignal
  /** How often the file is told the work still goes on. */
  beatMs?: number
}

const NAMES: Record<LoginKind, string> = { github: 'GitHub', claude: 'Claude' }

/** Refused: the login is already being changed, in another process. */
export class AlreadyAtWork extends Error {
  constructor(address: string, kind: LoginKind) {
    super(`The ${NAMES[kind]} login of ${address} is being changed right now`)
  }
}

/** Open a line to the server, meet it, and do `work` on it; a server that cannot be met is told with what to do about it. */
async function onServer<T>(server: Pick<Server, 'address' | 'user'>, run: Exec | undefined, work: (session: Session) => Promise<T>): Promise<T | (Failed & { reached: false })> {
  const session = await openSession(server, run ? { exec: run } : {})
  try {
    const met = await session.meet()
    if (!met.ok) return { ok: false, error: withAdvice(server, met.said || 'The server did not answer.'), reached: false }
    return await work(session)
  } finally {
    await session.close()
  }
}

/**
 * Change one login of a server: give it one, or take it off. Run as a process of its own: a
 * person asked in the browser takes a while, a server may too, and a command a page runs has
 * seconds. How it ended is written to the file, for the page.
 *
 * Once the server is being told, it is told to the end: a line cut half-way would leave on the
 * server what this computer does not know of.
 */
export async function changeLogin(opts: LoginOptions): Promise<void> {
  const { env, address, kind, remove } = opts
  const mine = (kept: Server): boolean => kept[kind]?.worker?.pid === process.pid
  const beat = (): { pid: number; seen: string } => ({ pid: process.pid, seen: new Date().toISOString() })
  // This process's from here on; the command that started it held it under its own name until now.
  const server = await changeServer(env, address, kept => {
    const worker = kept[kind]?.worker
    if (atWork(worker) && worker!.pid !== process.pid && worker!.pid !== process.ppid) throw new AlreadyAtWork(address, kind)
    kept[kind] = { ...known(kept[kind]), worker: beat() }
    return { address: kept.address, user: kept.user }
  })
  if (!server) throw new Error(`no server at ${address}`)
  const beating = setInterval(() => void changeServer(env, address, kept => void (mine(kept) && (kept[kind]!.worker = beat()))).catch(() => {}), opts.beatMs ?? BEAT_MS)
  const failed = (error: string) => (kept: Server): void => void (kept[kind] = { ...known(kept[kind]), failed: error })
  let after: (kept: Server) => void = failed('The work stopped before it ended.')
  try {
    if (remove) {
      const gone = await onServer(server, opts.exec, session => send(session, kind === 'github' ? githubLogoutScript() : claudeLogoutScript()))
      after = gone.ok ? kept => void delete kept[kind] : failed(gone.error)
    } else if (kind === 'github') {
      const given = await onServer(server, opts.exec, session => giveGithub(session, opts.exec))
      after = kept => noteGithub(kept, given)
    } else {
      await changeServer(env, address, kept => void (mine(kept) && (kept.claude!.asking = true)))
      const minted = await (opts.mint ?? mintClaude)(opts.signal ? { signal: opts.signal } : {})
      await changeServer(env, address, kept => void (mine(kept) && delete kept.claude!.asking))
      if (!minted.ok) return void (after = failed(minted.error))
      const given = await onServer(server, opts.exec, session => send(session, claudeLoginScript(minted.login), minted.login))
      after = given.ok ? kept => void (kept.claude = { since: new Date().toISOString() }) : failed(given.error)
    }
  } finally {
    clearInterval(beating)
    // One that was started over is another process's by now: nothing of it is this one's to write.
    await changeServer(env, address, kept => void (mine(kept) && after(kept))).catch(() => {})
  }
}
