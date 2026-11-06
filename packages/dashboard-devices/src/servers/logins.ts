import { runsAccountDir } from '@openagt/skill-github'
import { exec as ownExec, lastLines, type Exec, type Said, type Session } from './ssh.js'
import { LOGIN_TIMEOUT_MS, githubLoginScript, type LoginScript } from './steps.js'
import { isAccount } from './store.js'

/**
 * GitHub logins: OpenAgent's own on this computer, the account its runs use, read for a copy, and
 * one given to the user a line runs as, which is how a person's own OpenAgent on a computer
 * several people use takes the one handed over to it. Neither is written anywhere on this
 * computer, and the person's own `gh` is never read.
 */

export type Failed = { ok: false; error: string }

/** How long one of this computer's own commands gets to answer. */
const OWN_TIMEOUT_MS = 15_000

/** Why there is no login to copy, in words: never gh's own, which could hold what it was asked for. */
function noGh(said: Said, otherwise: string): Failed {
  return { ok: false, error: `There is no GitHub login to copy from this computer. ${/could not start|No such file/.test(said.err) ? '`gh` is not on this computer.' : otherwise}` }
}

const NO_ACCOUNT: Failed = { ok: false, error: "There is no GitHub login to copy from this computer: add a GitHub account in OpenAgent's Permissions." }

/** `gh` as OpenAgent's account works it: that account's folder alone, with no token from this process's environment. */
function asRunsAccount(run: Exec, dir: string, args: readonly string[]): Promise<Said> {
  return run('env', ['-u', 'GH_TOKEN', '-u', 'GITHUB_TOKEN', `GH_CONFIG_DIR=${dir}`, 'gh', ...args], '', { timeoutMs: OWN_TIMEOUT_MS })
}

/** The GitHub account OpenAgent's runs use on this computer: whose login a copy would be. */
export async function ownGithubAccount(run: Exec = ownExec, env: NodeJS.ProcessEnv = process.env): Promise<{ ok: true; account: string } | Failed> {
  const runs = runsAccountDir(env)
  if (!runs) return NO_ACCOUNT
  const said = await asRunsAccount(run, runs.dir, ['api', '--hostname', 'github.com', 'user', '--jq', '.login'])
  const account = said.out.trim()
  return said.code === 0 && isAccount(account) ? { ok: true, account } : noGh(said, `GitHub does not take ${runs.login}'s login, or does not answer: add it again in OpenAgent's Permissions.`)
}

/** What a GitHub login reads as, as GitHub hands them out. */
const GITHUB_LOGIN = /^[A-Za-z0-9_]{20,255}$/

/** The login of the GitHub account OpenAgent's runs use on this computer, as OpenAgent keeps it. */
export async function ownGithubLogin(run: Exec = ownExec, env: NodeJS.ProcessEnv = process.env): Promise<{ ok: true; login: string } | Failed> {
  const runs = runsAccountDir(env)
  if (!runs) return NO_ACCOUNT
  const said = await asRunsAccount(run, runs.dir, ['auth', 'token', '--hostname', 'github.com'])
  const login = said.out.trim()
  // What it reads as is what GitHub hands out; anything else is not sent anywhere.
  return said.code === 0 && GITHUB_LOGIN.test(login) ? { ok: true, login } : noGh(said, `OpenAgent has no token for ${runs.login}: add it again in OpenAgent's Permissions.`)
}

/** `text` without the login it may repeat. */
export function scrubbed(text: string, login: string): string {
  return login ? text.replaceAll(login, '•••') : text
}

type Sent = { ok: true; out: string } | Failed

/** Run a login's script on the server. What comes back never holds the login. */
async function send(session: Session, { as, script }: LoginScript, login: string): Promise<Sent> {
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

/** Give the other end of a line that is already open this GitHub login, and answer whose it is. */
export async function giveGithubLogin(session: Session, login: string): Promise<GithubGiven> {
  // What it reads as is what GitHub hands out; anything else is not sent anywhere.
  if (!GITHUB_LOGIN.test(login)) return { ok: false, error: 'What was sent is no GitHub login.', reached: false }
  const sent = await send(session, githubLoginScript(login), login)
  if (!sent.ok) return { ...sent, reached: true }
  const account = sent.out.trim().split('\n').at(-1)?.trim()
  return isAccount(account) ? { ok: true, account } : { ok: false, error: 'The server took the login and did not say whose it is.', reached: true }
}
