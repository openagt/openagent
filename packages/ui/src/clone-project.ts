import { execFile } from 'node:child_process'
import { lstat, mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { repositoryAddress, type RemoteAccount } from '@openagt/agent-data'
import { typedRepository } from './typed-repository.js'

/**
 * A project added by its repository's address, for a computer that does not have its folder: a
 * server that was just connected has no screen to pick a folder on and no folder to pick. The
 * repository is cloned into `~/projects/<its name>`, in the home of the user OpenAgent runs as,
 * and that folder is then added like any other. Nothing is asked about where: the page says
 * where it went.
 *
 * git clones as one of OpenAgent's accounts at the repository's host (`account`), never with the
 * person's own logins: their credential helpers are dropped, and an SSH address, which would use
 * their own key, is refused unless the account's settings take it over the web. With no account
 * there, only a public repository can be cloned. git is never let ask a person for a login: a
 * repository it cannot read is refused in words.
 */

/** Where a repository is cloned from and to. */
export interface CloneTarget {
  /** What git is given. */
  url: string
  /** The repository's one name on every machine: see `addressOfRemote`. */
  address: string
  /** The folder it is cloned into. */
  path: string
}

/**
 * Where what a person typed would be cloned to: `~/projects/<its name>`, in the home of the user
 * OpenAgent runs as. Undefined wherever {@link typedRepository} is.
 */
export function cloneTarget(typed: string, home: string = homedir()): CloneTarget | undefined {
  const repository = typedRepository(typed)
  return repository && { url: repository.url, address: repository.address, path: join(home, 'projects', repository.name) }
}

/** How a clone went: the folder the project is in, and whether it was cloned now or was already there. */
export type Cloned = { ok: true; path: string; cloned: boolean } | { ok: false; error: string }

/** Run git and answer how it ended, with what it said on its error side. */
export type CloneRunner = (args: readonly string[], env: NodeJS.ProcessEnv, timeoutMs: number) => Promise<{ ok: true } | { ok: false; said: string; timedOut: boolean }>

const nodeCloneRunner: CloneRunner = (args, env, timeoutMs) =>
  new Promise(done => {
    execFile('git', [...args], { env, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (error, _stdout, stderr) => {
      if (!error) return done({ ok: true })
      // Stopped for taking too long, not for saying too much.
      const timedOut = (error as { killed?: boolean }).killed === true && (error as { code?: unknown }).code !== 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
      done({ ok: false, said: String(stderr), timedOut })
    })
  })

/** How long a clone may take: a large repository over a slow line, not a hang. */
const CLONE_TIMEOUT_MS = 15 * 60_000
/** How long asking a repository's host whether it is readable may take. */
const READ_TIMEOUT_MS = 30_000

/** What git says when it has no login that can read a repository. */
const NO_LOGIN = /could not read Username|Authentication failed|terminal prompts disabled|Repository not found/i
/** What git says after every failure, whatever the reason. */
const SAID_EVERY_TIME = /^(Cloning into |Please make sure you have the correct access rights|and the repository exists)/

const NOT_AN_ADDRESS = "is not a repository's address. One looks like github.com/you/project."

/** Where what a person typed would be cloned to, before anything is cloned: what the page shows to be confirmed. */
export function cloneTargetOf(typed: string, home?: string): { ok: true; address: string; path: string } | { ok: false; error: string } {
  const target = cloneTarget(typed, home)
  return target ? { ok: true, address: target.address, path: target.path } : { ok: false, error: `"${typed.trim().slice(0, 80)}" ${NOT_AN_ADDRESS}` }
}

export interface CloneOptions {
  home?: string
  run?: CloneRunner
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  /** The account of OpenAgent's the repository is read as: its git settings. None: no login at all. */
  account?: RemoteAccount
}

/** The clones on their way, by the folder each ends in: a second ask for the same folder waits for the first. */
const cloning = new Map<string, Promise<Cloned>>()

/**
 * Clone the repository a person typed the address of into `~/projects/<its name>`. A folder that
 * is already there and holds this very repository is taken as it is; one that holds anything
 * else is never written over, and is refused. The clone is made beside that folder and moved
 * there once it is whole: a clone that fails leaves nothing behind, and one on its way is no
 * folder a second ask could take for the project.
 */
export function cloneProject(typed: string, opts: CloneOptions = {}): Promise<Cloned> {
  const target = cloneTarget(typed, opts.home)
  if (!target) return Promise.resolve({ ok: false, error: `"${typed.trim().slice(0, 80)}" ${NOT_AN_ADDRESS}` })
  const onItsWay = cloning.get(target.path)
  // The same repository asked for twice: one clone, one answer. Another one of the same name is told once the first has landed.
  if (onItsWay) return onItsWay.then(() => cloneProject(typed, opts))
  const made = cloneTo(target, opts).finally(() => cloning.delete(target.path))
  cloning.set(target.path, made)
  return made
}

async function cloneTo({ url, address, path }: CloneTarget, opts: CloneOptions): Promise<Cloned> {
  const there = async (): Promise<Cloned | undefined> => {
    if (!(await lstat(path).then(() => true, () => false))) return undefined
    if ((await repositoryAddress(path)) === address) return { ok: true, path, cloned: false }
    return { ok: false, error: `${path} is already there, and it is not ${address}. Move that folder away first, or add it as it is.` }
  }
  const already = await there()
  if (already) return already
  const ssh = overSsh(url, address, opts)
  if (ssh) return ssh
  const projects = dirname(path)
  await mkdir(projects, { recursive: true })
  // A name no repository has: one starts with a letter, a digit or an underscore.
  const making = await mkdtemp(join(projects, `.${basename(path)}.cloning-`))
  const said = await askGit(['clone', '--', url, making], opts, CLONE_TIMEOUT_MS)
  if (said.ok) {
    // Moved only where nothing is: a folder that came to be there meanwhile is not written over.
    const landed = (await there()) ?? (await rename(making, path).then(() => undefined, (err: unknown) => (err instanceof Error ? err.message : String(err))))
    if (landed === undefined) return { ok: true, path, cloned: true }
    await rm(making, { recursive: true, force: true })
    return typeof landed === 'string' ? { ok: false, error: `The clone could not be moved to ${path}: ${landed}` } : landed
  }
  await rm(making, { recursive: true, force: true })
  if (said.timedOut) return { ok: false, error: `Cloning ${address} took too long, and was stopped.` }
  return { ok: false, error: gitRefusal(said.said, address, 'git could not clone it.') }
}

/**
 * Whether this computer's logins read the repository at the address, asked of its host without
 * cloning anything: what a run of a project cloned here first would hit before it starts. The
 * answer is the clone's own words when they cannot.
 */
export async function canRead(typed: string, opts: CloneOptions = {}, subject = 'This computer'): Promise<{ ok: true } | { ok: false; error: string }> {
  const target = cloneTarget(typed, opts.home)
  if (!target) return { ok: false, error: `"${typed.trim().slice(0, 80)}" ${NOT_AN_ADDRESS}` }
  const ssh = overSsh(target.url, target.address, opts)
  if (ssh) return ssh
  const said = await askGit(['ls-remote', '--heads', '--', target.url], opts, READ_TIMEOUT_MS)
  if (said.ok) return { ok: true }
  if (said.timedOut) return { ok: false, error: `${target.address} did not answer in time.` }
  return { ok: false, error: gitRefusal(said.said, target.address, 'git could not read it.', subject) }
}

/**
 * An SSH address would be read with the person's own key: refused, unless the account's settings
 * take that host's SSH addresses over the web, where the account's login is the one asked.
 */
function overSsh(url: string, address: string, opts: CloneOptions): { ok: false; error: string } | undefined {
  if (/^https:\/\//i.test(url)) return undefined
  const host = address.split('/')[0]!
  const rewritten = opts.account?.config.some(([key, value]) => key === `url.https://${host}/.insteadOf` && url.startsWith(value))
  if (rewritten) return undefined
  return { ok: false, error: `OpenAgent reads ${address} over SSH only through one of its own accounts, never with your own key. Paste its https:// address${opts.account ? '' : `, or add an account at ${host} in Permissions`}.` }
}

/** Run git about a repository the way a clone does: over the web only, as the account given or no login, never a question to a person. */
function askGit(args: readonly string[], opts: CloneOptions, timeoutMs: number): ReturnType<CloneRunner> {
  // The person's credential helpers dropped, the keychain's too; the account's in their place.
  const login = ['-c', 'credential.helper=', ...(opts.account?.config ?? []).flatMap(([key, value]) => ['-c', `${key}=${value}`])]
  return (opts.run ?? nodeCloneRunner)(
    // Over the web only: SSH would use the person's own key, and git never runs a program an address could name.
    [...login, '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', ...args],
    // Never a question to a person, in a terminal or in a window: nobody is there to answer one.
    { ...(opts.env ?? process.env), GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '' },
    opts.timeoutMs ?? timeoutMs,
  )
}

/** What git said when it could not reach the repository, in a person's words, of the computer it ran on. */
function gitRefusal(said: string, address: string, otherwise: string, subject = 'This computer'): string {
  const lines = said.split('\n').map(line => line.trim().replace(/^(fatal|error): /i, '')).filter(line => line && !SAID_EVERY_TIME.test(line))
  const words = lines.slice(-2).join(' ') || otherwise
  return NO_LOGIN.test(said) ? `${subject} has no account of OpenAgent's that can read ${address}, or there is no such repository: a private one needs one, added in Permissions. git said: ${words}` : words
}
