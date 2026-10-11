import { openSession, type Exec, type Said } from './ssh.js'
import { SERVER_USER, STEPS, linkScript, type StepId } from './steps.js'
import { readStore, update, type Server, type StepState } from './store.js'

/**
 * The install itself: the steps, one after the other, on one server, each written to the file
 * as it starts and as it ends, so the page shows where the install is. It stops at the first
 * step that fails, with what the server said. Run as a process of its own: an install takes
 * minutes, and a command a page runs has seconds.
 */

export interface InstallOptions {
  env: NodeJS.ProcessEnv
  address: string
  /** The OpenAgent the server gets. */
  version: string
  exec?: Exec
  /** Stops the install where it is. */
  signal?: AbortSignal
}

/** How many of a command's last lines are kept for the page. */
const SAID_LINES = 15

/** The end of what a command said, its errors last: where the reason of a failure is. */
export function lastLines(said: Pick<Said, 'out' | 'err'>): string {
  const lines = [said.out, said.err].flatMap(text => text.split('\n').map(line => line.trimEnd()).filter(Boolean))
  return lines.slice(-SAID_LINES).join('\n')
}

/** What to do about a failure `ssh` or `sudo` words its own way, after those words. */
export function withAdvice(server: Pick<Server, 'address' | 'user'>, said: string): string {
  const advice = /REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed/.test(said)
    ? 'This server shows another key than the one this computer remembers for it. Nothing was sent to it.'
    : /Permission denied/.test(said)
      ? `OpenAgent logs in with this computer's own SSH keys. Check that "ssh ${server.user}@${server.address}" works in a terminal without asking for anything.`
      : /sudo: a password is required|sudo: a terminal is required|sudo: command not found|sudo: not found/.test(said)
        ? `The user ${server.user} cannot become root without a password. Use root, or a user whose sudo asks for none.`
        : undefined
  return [said, advice].filter(Boolean).join('\n')
}

export async function install(opts: InstallOptions): Promise<void> {
  const { env, address, version } = opts
  const server = (await readStore(env)).servers.find(candidate => candidate.address === address)
  if (!server) throw new Error(`no server at ${address}`)
  const change = (apply: (server: Server) => void): Promise<void> =>
    update(env, store => {
      const kept = store.servers.find(candidate => candidate.address === address)
      if (kept) apply(kept)
    })
  const set = (id: StepId, state: StepState, said?: string): Promise<void> =>
    change(kept => {
      const step = kept.steps.find(candidate => candidate.id === id)!
      step.state = state
      if (said) step.said = said
      else delete step.said
    })

  await change(kept => void (kept.worker = process.pid))
  const session = await openSession(server, { ...(opts.exec ? { exec: opts.exec } : {}), ...(opts.signal ? { signal: opts.signal } : {}) })
  try {
    for (const step of STEPS) {
      await set(step.id, 'running')
      if (step.id === 'login') {
        const met = await session.meet()
        if (!met.ok) return await set(step.id, 'failed', withAdvice(server, met.said || 'The server did not answer.'))
        if (met.fingerprint) await change(kept => void (kept.fingerprint = met.fingerprint!))
      }
      const said = await session.run(step.as, step.script({ address, version }), step.timeoutMs)
      if (said.code !== 0) return await set(step.id, 'failed', withAdvice(server, lastLines(said) || 'The step ended without a word.'))
      await set(step.id, 'done')
    }
  } finally {
    await change(kept => {
      // A step still running here is one this process did not see the end of.
      for (const step of kept.steps) if (step.state === 'running') Object.assign(step, { state: 'failed', said: 'The install was stopped.' })
      if (kept.worker === process.pid) delete kept.worker
    }).catch(() => {})
    await session.close()
  }
}

export type Link = { ok: true; url: string; expires: string } | { ok: false; error: string }

/** Ask the server's door for a link a new machine gets in with: good once, for five minutes. */
export async function askLink(server: Pick<Server, 'address' | 'user'>, opts: { exec?: Exec } = {}): Promise<Link> {
  const session = await openSession(server, opts)
  try {
    const said = await session.run(SERVER_USER, linkScript(), 60_000)
    if (said.code !== 0) return { ok: false, error: withAdvice(server, lastLines(said) || 'The server did not answer.') }
    try {
      const { url, expires } = JSON.parse(said.out.trim().split('\n').at(-1) ?? '') as Record<string, unknown>
      if (typeof url === 'string' && typeof expires === 'string') return { ok: true, url, expires }
    } catch {
      // Told below, as any answer that is no link.
    }
    return { ok: false, error: 'The server answered something else than a link.' }
  } finally {
    await session.close()
  }
}
