import { execFile } from 'node:child_process'
import { lstat, mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { addressOfRemote, repositoryAddress } from './repository-address.js'

/**
 * A project added by its repository's address, for a computer that does not have its folder: a
 * server that was just connected has no screen to pick a folder on and no folder to pick. The
 * repository is cloned into `~/projects/<its name>`, in the home of the user OpenAgent runs as,
 * and that folder is then added like any other. Nothing is asked about where: the page says
 * where it went.
 *
 * git clones with the logins this computer has (its credential helper, its SSH keys) and is
 * never let ask a person for one: a repository it cannot read is refused in words.
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

const HOST = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i
const SEGMENT = /^[a-z0-9_][a-z0-9._~-]*$/i
const MAX_TYPED = 512

/**
 * Read what a person typed as a repository's address: `github.com/you/shop`, the same with
 * `https://` before it, `ssh://git@github.com/you/shop.git`, or `git@github.com:you/shop.git`.
 * Undefined for anything else: a folder on this disk, another kind of address, a name that could
 * be read as an option or lead out of the folder projects are cloned into.
 */
export function cloneTarget(typed: string, home: string = homedir()): CloneTarget | undefined {
  const said = typed.trim().replace(/\/+$/, '')
  if (!said || said.length > MAX_TYPED || /[\s\x00-\x1f\x7f]/.test(said)) return undefined
  const scp = /^([a-z0-9_][a-z0-9._-]*)@([^:/@]+):([^:].*)$/i.exec(said)
  const web = scp ? null : /^(?:(https|ssh):\/\/(?:([a-z0-9_][a-z0-9._-]*)@)?)?([^:/@]+)(?::(\d{1,5}))?\/(.+)$/i.exec(said)
  const [host, rest] = scp ? [scp[2]!, scp[3]!] : web ? [web[3]!, web[5]!] : []
  if (host === undefined || rest === undefined || !HOST.test(host) || !host.includes('.')) return undefined
  const segments = rest.split('/')
  if (!segments.every(segment => SEGMENT.test(segment))) return undefined
  const name = segments.at(-1)!.replace(/\.git$/i, '')
  if (!name || !SEGMENT.test(name)) return undefined
  const scheme = web?.[1]?.toLowerCase()
  // A user or a port is for SSH; a web address has neither, so no login rides in what was typed.
  if (web && scheme !== 'ssh' && (web[2] !== undefined || web[4] !== undefined)) return undefined
  // Written anew from its parts, so git is given the two kinds of address it is allowed, as it spells them.
  const url = scp ? said : scheme === 'ssh' ? `ssh://${web![2] !== undefined ? `${web![2]}@` : ''}${host}${web![4] !== undefined ? `:${web![4]}` : ''}/${rest}` : `https://${host}/${rest}`
  const address = addressOfRemote(url)
  return address ? { url, address, path: join(home, 'projects', name) } : undefined
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

/** The way to SSH a person set for git on this computer, when they set one: which key, which program. */
const ownSshCommand = (env: NodeJS.ProcessEnv): Promise<string | undefined> =>
  new Promise(done => execFile('git', ['config', '--get', 'core.sshCommand'], { env, cwd: homedir(), timeout: 10_000 }, (error, stdout) => done(error ? undefined : String(stdout).trim() || undefined)))

/** How long a clone may take: a large repository over a slow line, not a hang. */
const CLONE_TIMEOUT_MS = 15 * 60_000

/** What git says when it has no login that can read a repository, over the web and over SSH. */
const NO_LOGIN = /could not read Username|Authentication failed|terminal prompts disabled|Permission denied \(publickey|Repository not found/i
/** What SSH says of a host this computer has never met: it would ask a person, and nobody is there to answer. */
const NOT_MET = /Host key verification failed/i
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
  /** The person's own way to SSH for git, when they set one; read off git's settings when unsaid. */
  sshCommand?: (env: NodeJS.ProcessEnv) => Promise<string | undefined>
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
  const projects = dirname(path)
  await mkdir(projects, { recursive: true })
  // A name no repository has: one starts with a letter, a digit or an underscore.
  const making = await mkdtemp(join(projects, `.${basename(path)}.cloning-`))
  const env = opts.env ?? process.env
  const ssh = env.GIT_SSH_COMMAND ?? (await (opts.sshCommand ?? ownSshCommand)(env)) ?? 'ssh'
  const said = await (opts.run ?? nodeCloneRunner)(
    // Only the two ways in a repository's address names: a clone never runs a program an address could name.
    ['-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-c', 'protocol.ssh.allow=always', 'clone', '--', url, making],
    // Never a question to a person, in a terminal or in a window: nobody is there to answer one. The person's own way to SSH is kept, and told the same.
    { ...env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', GIT_SSH_COMMAND: `${ssh} -oBatchMode=yes` },
    opts.timeoutMs ?? CLONE_TIMEOUT_MS,
  )
  if (said.ok) {
    // Moved only where nothing is: a folder that came to be there meanwhile is not written over.
    const landed = (await there()) ?? (await rename(making, path).then(() => undefined, (err: unknown) => (err instanceof Error ? err.message : String(err))))
    if (landed === undefined) return { ok: true, path, cloned: true }
    await rm(making, { recursive: true, force: true })
    return typeof landed === 'string' ? { ok: false, error: `The clone could not be moved to ${path}: ${landed}` } : landed
  }
  await rm(making, { recursive: true, force: true })
  if (said.timedOut) return { ok: false, error: `Cloning ${address} took too long, and was stopped.` }
  const lines = said.said.split('\n').map(line => line.trim().replace(/^(fatal|error): /i, '')).filter(line => line && !SAID_EVERY_TIME.test(line))
  const words = lines.slice(-2).join(' ') || 'git could not clone it.'
  if (NOT_MET.test(said.said)) return { ok: false, error: `This computer has never met ${address.split('/')[0]} over SSH, so it does not know it is the real one. Use the address that starts with https://, or connect to it once in a terminal. git said: ${words}` }
  return { ok: false, error: NO_LOGIN.test(said.said) ? `This computer has no login that can read ${address}, or there is no such repository: a private one needs a login. git said: ${words}` : words }
}
