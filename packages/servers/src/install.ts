import { giveGithub, noteGithub } from './logins.js'
import { exec as realExec, lastLines, openSession, withAdvice, type Exec, type Session } from './ssh.js'
import { PERSON_TIMEOUT_MS, SERVER_USER, STEPS, linkScript, type StepId } from './steps.js'
import { BEAT_MS, changeServer, doorUrl, heartbeat, working, type Server, type StepState } from './store.js'

/**
 * The install itself: the steps, one after the other, on one server, each written to the file
 * as it starts and as it ends, so the page shows where the install is. It stops at the first
 * step that fails, with what the server said. Run as a process of its own: an install takes
 * minutes, and a command a page runs has seconds.
 *
 * Once the steps are done, the GitHub login is copied when the person asked for that.
 */

export interface InstallOptions {
  env: NodeJS.ProcessEnv
  address: string
  /** The OpenAgent the server gets. */
  version: string
  exec?: Exec
  /** Stops the install where it is. */
  signal?: AbortSignal
  /** How often the file is told the install still runs. */
  beatMs?: number
}

/** Refused: the server's install already runs, in another process. */
export class AlreadyWorking extends Error {
  constructor(address: string) {
    super(`OpenAgent is being installed on ${address} right now`)
  }
}

/** How long this computer's git gets to say a name. */
const GIT_TIMEOUT_MS = 10_000

/**
 * This computer's own name and email in git, each when it has one: what the person commits as
 * in a folder that says nothing else, so git is asked outside every folder. A server's git
 * that has none gets them.
 */
export async function ownGitIdentity(exec: Exec = realExec): Promise<{ name?: string; email?: string }> {
  const own = async (key: string): Promise<string | undefined> => {
    const said = await exec('git', ['-C', '/', 'config', '--get', key], '', { timeoutMs: GIT_TIMEOUT_MS })
    return said.code === 0 && said.out.trim() ? said.out.trim() : undefined
  }
  const [name, email] = [await own('user.name'), await own('user.email')]
  return { ...(name !== undefined ? { name } : {}), ...(email !== undefined ? { email } : {}) }
}

export async function install(opts: InstallOptions): Promise<void> {
  const { env, address, version } = opts
  const change = <T>(apply: (server: Server) => T): Promise<T | undefined> => changeServer(env, address, apply)
  const mine = (kept: Server): boolean => kept.worker?.pid === process.pid
  const beat = (): Promise<unknown> => change(kept => void (mine(kept) && (kept.worker = { pid: process.pid, seen: new Date().toISOString() })))
  const set = (id: StepId, state: StepState, said?: string): Promise<unknown> =>
    change(kept => {
      const step = kept.steps.find(candidate => candidate.id === id)!
      step.state = state
      if (said) step.said = said
      else delete step.said
    })

  // The install is this process's from here on; the command that started it held it under its own name until now.
  const server = await change(kept => {
    if (working(kept) && !mine(kept) && kept.worker!.pid !== process.ppid) throw new AlreadyWorking(address)
    kept.worker = { pid: process.pid, seen: new Date().toISOString() }
    return { address: kept.address, user: kept.user }
  })
  if (!server) throw new Error(`no server at ${address}`)
  const beating = heartbeat(beat, opts.beatMs ?? BEAT_MS)
  let session: Session | undefined
  try {
    session = await openSession(server, { ...(opts.exec ? { exec: opts.exec } : {}), ...(opts.signal ? { signal: opts.signal } : {}) })
    const facts = { address, version, ...(await ownGitIdentity(opts.exec)) }
    for (const step of STEPS) {
      await set(step.id, 'running')
      const login = step.id === 'login'
      if (login) {
        const met = await session.meet()
        if (!met.ok) return void (await set(step.id, 'failed', withAdvice(server, met.said || 'The server did not answer.')))
        if (met.fingerprint) await change(kept => void (kept.fingerprint = met.fingerprint!))
      }
      const said = await session.run(step.as, step.script(facts), step.timeoutMs)
      if (said.code !== 0) {
        const words = lastLines(said) || 'The step ended without a word.'
        return void (await set(step.id, 'failed', login ? withAdvice(server, words) : words))
      }
      await set(step.id, 'done')
    }
    // The person's tick. A copy that fails is told on the login's own line: the server is installed all the same.
    if (await change(kept => kept.github?.wanted === true)) {
      const given = await giveGithub(session, opts.exec)
      await change(kept => noteGithub(kept, given))
    }
  } finally {
    await beating.stop()
    await change(kept => {
      if (!mine(kept)) return
      // A step still running here is one this process did not see the end of.
      for (const step of kept.steps) if (step.state === 'running') Object.assign(step, { state: 'failed', said: 'The install was stopped.' })
      delete kept.worker
    }).catch(() => {})
    await session?.close()
  }
}

export type Link = { ok: true; url: string; expires: string } | { ok: false; error: string }

/** How long a link may be: a door's link is its address, a code and a key's mark, and a page draws it as a QR code. */
const LINK_MAX = 512

/**
 * How long the server gets to answer with a link: less than a page's command has, so the line is
 * always hung up. A link for a person waits longer: the person's user and OpenAgent are made first.
 */
const LINK_TIMEOUT_MS = 20_000

/**
 * Ask the server's door for a link a new machine gets in with: good once, for five minutes.
 * Only a link to that very server is one: what a server answers is not trusted to say where
 * this computer goes to be let in.
 */
export async function askLink(server: Pick<Server, 'address' | 'user'>, opts: { exec?: Exec } = {}, person?: string): Promise<Link> {
  const session = await openSession(server, opts)
  try {
    const said = await session.run(SERVER_USER, linkScript(person), person === undefined ? LINK_TIMEOUT_MS : PERSON_TIMEOUT_MS)
    if (said.code !== 0) return { ok: false, error: withAdvice(server, lastLines(said) || 'The server did not answer.') }
    try {
      const { url, expires } = JSON.parse(said.out.trim().split('\n').at(-1) ?? '') as Record<string, unknown>
      if (typeof url === 'string' && url.length <= LINK_MAX && typeof expires === 'string' && Number.isFinite(Date.parse(expires)) && new URL(url).origin === doorUrl(server.address)) return { ok: true, url, expires }
    } catch {
      // Told below, as any answer that is no link.
    }
    return { ok: false, error: `The server answered something else than a link to its own door at ${doorUrl(server.address)}.` }
  } finally {
    await session.close()
  }
}
