import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { askGithub, giveGithubLogin, scrubbed, type Failed, type GithubGiven } from './logins.js'
import { exec as ownExec, lastLines, type Exec, type Session } from './ssh.js'
import { LOGIN_TIMEOUT_MS, SERVER_USER, githubLogoutScript, quoted, type LoginScript } from './steps.js'
import { BEAT_MS, MARK_LENGTH, atWork, heartbeat, update, type Login, type LoginKind, type Store } from './store.js'

/**
 * The logins of one person's own OpenAgent, on a computer several people use. There, each person
 * invited runs an OpenAgent of their own, as a user of their own, and that user holds their
 * GitHub and Claude logins: a run uses the logins of the person who started it, and nothing of
 * one person's reaches another's.
 *
 * The person is not at that computer and has no way in over SSH: their own computer hands the
 * logins to this OpenAgent through the door, with that computer's key there, and this OpenAgent
 * puts them where its user's programs read them. A login comes in on standard input, never on a
 * command line. The owner's OpenAgent is not one of these: its logins come over SSH, as before.
 *
 * GitHub's login is `gh`'s, in the user's own home, as on the owner's server; it must be the
 * person's own account. Claude's is a file in the user's home that the computer's service reads
 * as it starts that OpenAgent, so OpenAgent is started again once it was written.
 *
 * A login handed over may be a copy: the person's own OpenAgent on a server copies its logins to
 * their OpenAgent on another person's computer, the first time it starts a run there. Such a login
 * says the server it came from, and every login handed over keeps a mark of itself, so the copier
 * tells whether the copy is still its own login. A login the person made here is never a copy.
 */

/** A login's mark: the start of its SHA-256. */
export function markOf(login: string): string {
  return createHash('sha256').update(login).digest('hex').slice(0, MARK_LENGTH)
}

/** What tells an OpenAgent it is one person's on a computer several people use: their GitHub account. */
export const PERSON_ENV = 'OPENAGENT_PERSON'

/** The person this OpenAgent is, when it is one person's on a computer several people use. */
export function personHere(env: NodeJS.ProcessEnv): string | undefined {
  const said = env[PERSON_ENV]?.trim().toLowerCase()
  return said && /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/.test(said) ? said : undefined
}

/** Where a person's Claude login is kept, in their user's home: the computer's service reads it as it starts their OpenAgent. */
export const OWN_CLAUDE_FILE = '.config/openagent/claude.env'

/** The name Claude Code reads a login under that was made for a computer nobody sits at. */
const CLAUDE_NAME = 'CLAUDE_CODE_OAUTH_TOKEN'

/**
 * A line to this computer itself, for the scripts written for a server's own user: they run here,
 * as the user this OpenAgent is, in that user's home.
 */
export function localSession(run: Exec = ownExec, signal?: AbortSignal): Session {
  return {
    meet: async () => ({ ok: true }),
    run: (_as, script, timeoutMs) => run('bash', ['-s'], script, { timeoutMs, ...(signal ? { signal } : {}) }),
    close: async () => {},
  }
}

/** A whole script, as the server's own scripts are: nothing to read, the system's programs first after the user's own. */
function script(vars: Record<string, string>, body: string): string {
  return [
    'set -euo pipefail',
    'umask 022',
    'export PATH="$HOME/.local/bin:/opt/openagent/node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"',
    ...Object.entries(vars).map(([name, value]) => `${name}=${quoted(value)}`),
    'fail() { echo "$1" >&2; exit 1; }',
    'main() {',
    body.trim(),
    '}',
    'main </dev/null',
    '',
  ].join('\n')
}

/**
 * Give this OpenAgent's user a Claude login: Claude Code is first asked whether it reads it, then
 * it is written to the user's own file, which only that user reads. The file is written whole or
 * not at all.
 */
export function ownClaudeLoginScript(login: string): LoginScript {
  return {
    as: SERVER_USER,
    script: script(
      { LOGIN: login, FILE: OWN_CLAUDE_FILE },
      `
  # What is written where the service reads its settings is a login's letters and nothing else.
  case "$LOGIN" in '' | *[!A-Za-z0-9_-]*) fail "What was sent is no Claude login." ;; esac
  said=$(${CLAUDE_NAME}="$LOGIN" timeout 30 claude auth status 2>&1 || true)
  printf '%s' "$said" | grep -Eq '"loggedIn": *true' || fail "Claude Code on this computer does not take the login."
  mkdir -p "$HOME/$(dirname "$FILE")"
  (umask 077 && printf '${CLAUDE_NAME}=%s\\n' "$LOGIN" > "$HOME/$FILE.new")
  mv "$HOME/$FILE.new" "$HOME/$FILE"
`,
    ),
  }
}

/** Take this OpenAgent's user's Claude login off: the file goes. */
export function ownClaudeLogoutScript(): LoginScript {
  return { as: SERVER_USER, script: script({ FILE: OWN_CLAUDE_FILE }, `\n  rm -f "$HOME/$FILE" "$HOME/$FILE.new"\n`) }
}

/**
 * Give the user's git the name and email of the GitHub account it is logged in to, when it has
 * none: a commit made by a person's run reads as theirs. Only what git lacks is given. The email is
 * GitHub's own address for the account, which hides the person's own.
 */
export function ownIdentityScript(): LoginScript {
  return {
    as: SERVER_USER,
    script: script(
      {},
      `
  unset GH_TOKEN GITHUB_TOKEN GH_CONFIG_DIR XDG_CONFIG_HOME
  has() { [ -n "$(cd / && git config --get "$1" || true)" ]; }
  facts=$(gh api --hostname github.com user --jq '[.login, (.id | tostring), (.name // "")] | @tsv')
  login=$(printf '%s' "$facts" | cut -f1)
  id=$(printf '%s' "$facts" | cut -f2)
  name=$(printf '%s' "$facts" | cut -f3)
  [ -n "$login" ] && [ -n "$id" ] || fail "GitHub did not say whose the login is."
  has user.name || git config --global -- user.name "\${name:-$login}"
  has user.email || git config --global -- user.email "$id+$login@users.noreply.github.com"
`,
    ),
  }
}

/** Run a script on this computer; what comes back never holds the login. */
async function send(session: Session, { as, script: text }: LoginScript, login = ''): Promise<{ ok: true } | Failed> {
  const said = await session.run(as, text, LOGIN_TIMEOUT_MS)
  return said.code === 0 ? { ok: true } : { ok: false, error: lastLines({ out: scrubbed(said.out, login), err: scrubbed(said.err, login) }) || 'The login could not be written.' }
}

/**
 * A GitHub login is the person's only when it is their own account: one of anyone else's is taken
 * off again at once. Then git is given the account's name and email.
 */
async function theirs(session: Session, person: string, given: GithubGiven): Promise<GithubGiven> {
  if (!given.ok) return given
  if (given.account.toLowerCase() !== person) {
    await send(session, githubLogoutScript())
    return { ok: false, error: `That is the GitHub login of @${given.account}. This OpenAgent is @${person}'s: log in to GitHub as @${person}.`, reached: true }
  }
  const named = await send(session, ownIdentityScript())
  return named.ok ? given : { ok: false, error: `The login is there; git could not be given its name: ${named.error}`, reached: true }
}

/** Write down how a GitHub login went, for this OpenAgent's own user; `copied` says what was handed over, and from where when it is a copy. */
function noteOwnGithub(store: Store, given: GithubGiven, copied?: { login: string; from?: string }): void {
  const own = (store.own ??= {})
  if (given.ok) own.github = { since: new Date().toISOString(), account: given.account, ...handedOver(copied) }
  // One that was sent and did not arrive replaced what was there: no login is counted on.
  else own.github = { ...(given.reached ? {} : known(own.github)), failed: given.error }
}

/** What a login handed over says of itself: its mark, and the server it was copied from. */
function handedOver(copied: { login: string; from?: string } | undefined): Pick<Login, 'from' | 'mark'> {
  return copied ? { mark: markOf(copied.login), ...(copied.from !== undefined ? { from: copied.from } : {}) } : {}
}

/** What is known of a login beyond a try: since when it is there, and whose it is. */
const known = (login: Login | undefined): Login => ({
  ...(login?.since ? { since: login.since } : {}),
  ...(login?.account ? { account: login.account } : {}),
  ...(login?.from ? { from: login.from } : {}),
  ...(login?.mark ? { mark: login.mark } : {}),
})

/** Refused: the login is already being changed, in another process. */
export class OwnAtWork extends Error {
  constructor(kind: LoginKind) {
    super(`The ${kind === 'github' ? 'GitHub' : 'Claude'} login is being changed right now`)
  }
}

/** Mark the login as this process's to change; refused while another process changes it, unless that one only waits for the person. */
async function take(env: NodeJS.ProcessEnv, kind: LoginKind): Promise<number | undefined> {
  return update(env, store => {
    const own = (store.own ??= {})
    const login = own[kind]
    const busy = atWork(login?.worker)
    if (busy && login!.asking !== true) throw new OwnAtWork(kind)
    own[kind] = { ...known(login), worker: { pid: process.pid, seen: new Date().toISOString() } }
    return busy ? login!.worker!.pid : undefined
  })
}

/** End a process that still waits for the person: a second press starts over. */
function endWaiting(pid: number | undefined): void {
  if (pid === undefined) return
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    // Ended by itself in the meantime.
  }
}

export interface OwnOptions {
  env: NodeJS.ProcessEnv
  /** The person this OpenAgent is. */
  person: string
  exec?: Exec
}

/** Copy a GitHub login handed over on standard input to this OpenAgent's user; `from` names the server it is a copy from. */
export async function giveOwnGithub(opts: OwnOptions, login: string, from?: string): Promise<void> {
  endWaiting(await take(opts.env, 'github'))
  const session = localSession(opts.exec)
  const word = login.trim()
  let given: GithubGiven = { ok: false, error: 'The work stopped before it ended.', reached: false }
  try {
    given = await theirs(session, opts.person, await giveGithubLogin(session, word))
  } finally {
    await update(opts.env, store => noteOwnGithub(store, given, { login: word, ...(from !== undefined ? { from } : {}) }))
  }
}

/**
 * Have this OpenAgent's user ask GitHub for a login of its own: GitHub answers with a code, which
 * the file shows, and the work waits until the person typed it at GitHub. Run as a process of its
 * own, started by {@link startOwnGithubCode}.
 */
export async function askOwnGithub(opts: OwnOptions & { signal?: AbortSignal; beatMs?: number }): Promise<void> {
  const mine = (login: Login | undefined): boolean => login?.worker?.pid === process.pid
  const beating = heartbeat(() => update(opts.env, store => void (mine(store.own?.github) && (store.own!.github!.worker = { pid: process.pid, seen: new Date().toISOString() }))), opts.beatMs ?? BEAT_MS)
  const session = localSession(opts.exec, opts.signal)
  let given: GithubGiven = { ok: false, error: 'The work stopped before it ended.', reached: true }
  try {
    const shown = (code: string): Promise<unknown> => update(opts.env, store => void (mine(store.own?.github) && Object.assign(store.own!.github!, { asking: true, code })))
    given = await theirs(localSession(opts.exec), opts.person, await askGithub(session, shown))
  } finally {
    await beating.stop()
    await update(opts.env, store => void (mine(store.own?.github) && noteOwnGithub(store, given))).catch(() => {})
  }
}

/** Start the process that asks GitHub for a login with a code; a second press while it waits starts over. */
export async function startOwnGithubCode(opts: OwnOptions, startWork: (words: string[]) => number): Promise<void> {
  const before = await take(opts.env, 'github')
  endWaiting(before)
  let worker: number | undefined
  try {
    worker = startWork(['own-work', 'github'])
  } finally {
    await update(opts.env, store => {
      const login = store.own?.github
      if (!login || login.worker?.pid !== process.pid) return
      if (worker !== undefined) login.worker = { pid: worker, seen: new Date().toISOString() }
      else delete login.worker
    })
  }
}

/** Give this OpenAgent's user the Claude login handed over on standard input; `from` names the server it is a copy from. Answers whether OpenAgent is to be started again with it. */
export async function giveOwnClaude(opts: OwnOptions, login: string, from?: string): Promise<boolean> {
  await take(opts.env, 'claude')
  const word = login.trim()
  let given: { ok: true } | Failed = { ok: false, error: 'The work stopped before it ended.' }
  try {
    given = await send(localSession(opts.exec), ownClaudeLoginScript(word), word)
  } finally {
    const after = given
    await update(opts.env, store => {
      const own = (store.own ??= {})
      // One that failed half-way left the file as it was: what was there before is still there.
      own.claude = after.ok ? { since: new Date().toISOString(), ...handedOver({ login: word, ...(from !== undefined ? { from } : {}) }) } : { ...known(own.claude), failed: after.error }
    })
  }
  return given.ok
}

/** Take one of this OpenAgent's user's logins off. Answers whether OpenAgent is to be started again without it. */
export async function removeOwn(opts: OwnOptions, kind: LoginKind): Promise<boolean> {
  endWaiting(await take(opts.env, kind))
  const gone = await send(localSession(opts.exec), kind === 'github' ? githubLogoutScript() : ownClaudeLogoutScript())
  await update(opts.env, store => {
    const own = (store.own ??= {})
    if (gone.ok) delete own[kind]
    else own[kind] = { ...known(own[kind]), failed: gone.error }
  })
  return gone.ok && kind === 'claude'
}

/**
 * Start this OpenAgent again, a moment after the command that asked has answered: the service
 * reads the Claude login only as it starts it, and starts it again whenever it ends. A run at work
 * goes on, as at any start of OpenAgent.
 */
export function startOverSoon(): void {
  const again = `sleep 1; pid=$(systemctl show -p MainPID --value "openagent-person@$(id -un)" 2>/dev/null || true); case "$pid" in '' | 0 | *[!0-9]*) exit 0 ;; esac; kill -TERM "$pid"`
  const child = spawn('sh', ['-c', again], { stdio: 'ignore', detached: true })
  child.once('error', () => {})
  child.unref()
}
