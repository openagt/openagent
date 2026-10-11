import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SERVER_USER } from './steps.js'

/**
 * A script run on the server, over SSH, with this computer's own `ssh`: its keys, its agent and
 * its settings are the person's, and OpenAgent keeps none of its own. Nothing is ever asked: a
 * key that needs a password typed, or a server that wants one, is a failure told in words.
 *
 * The first time this computer meets a server its key is taken as it is and remembered, as when
 * a person answers "yes" in a terminal. A server that later shows another key is refused by
 * `ssh` itself, before anything is sent.
 */

/** How a command ended, and what it said. */
export interface Said {
  /** The exit code; `null` for a command that was stopped, or could not start. */
  code: number | null
  out: string
  err: string
}

/** How one command is run and fed a text: the real one when unsaid. */
export type Exec = (bin: string, args: readonly string[], stdin: string, opts: { timeoutMs: number; signal?: AbortSignal }) => Promise<Said>

/** How much of what a command says is kept: its end, where a failure tells its reason. */
const KEPT = 64 * 1024

export const exec: Exec = (bin, args, stdin, { timeoutMs, signal }) =>
  new Promise(resolve => {
    const child = spawn(bin, [...args], { stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    let stopped: string | undefined
    const stop = (why: string): void => {
      stopped ??= why
      child.kill('SIGKILL')
    }
    const timer = setTimeout(() => stop(`No answer for ${Math.round(timeoutMs / 60_000)} minutes.`), timeoutMs)
    const aborted = (): void => stop('The install was stopped.')
    signal?.addEventListener('abort', aborted, { once: true })
    if (signal?.aborted) aborted()
    child.stdout.setEncoding('utf8').on('data', (said: string) => (out = (out + said).slice(-KEPT)))
    child.stderr.setEncoding('utf8').on('data', (said: string) => (err = (err + said).slice(-KEPT)))
    let ended = false
    const done = (code: number | null, more = ''): void => {
      if (ended) return
      ended = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', aborted)
      // Whatever still holds the command's output open is not listened to any longer.
      child.stdout.destroy()
      child.stderr.destroy()
      resolve({ code: stopped === undefined ? code : null, out, err: [err.trimEnd(), stopped, more].filter(Boolean).join('\n') })
    }
    child.once('error', error => done(null, `${bin} could not start: ${error.message}`))
    child.once('close', code => done(code))
    // `ssh` leaves a process behind that keeps the line open for the next script, and that one
    // may hold this command's output open long after the command ended: its end is the exit,
    // a moment later so what it said last has arrived.
    child.once('exit', code => void setTimeout(() => done(code), 250))
    // A command that ended before it read its text is told by its exit, not by a broken pipe here.
    child.stdin.on('error', () => {})
    child.stdin.end(stdin)
  })

export interface Session {
  /**
   * Meet the server: log in, and answer what its key is known by. `undefined` when `ssh` did not
   * say, which changes nothing: the key is the one `ssh` remembers either way.
   */
  meet(): Promise<{ ok: true; fingerprint?: string } | { ok: false; said: string }>
  /** Run `script` on the server as root or as the server's own user. */
  run(as: 'root' | typeof SERVER_USER, script: string, timeoutMs: number): Promise<Said>
  /** Hang up. */
  close(): Promise<void>
}

/** What `ssh -v` prints about itself, which is nothing the server said. */
const NOISE = /^(debug\d:|OpenSSH_|Authenticated to |Transferred: |Bytes per second: )/

/**
 * A line to one server, kept open between the scripts, so the keys are asked for once (a key
 * that wants a touch or a confirmation each time it is used would otherwise ask at every step).
 */
export async function openSession(server: { address: string; user: string }, opts: { exec?: Exec; signal?: AbortSignal } = {}): Promise<Session> {
  const run = opts.exec ?? exec
  // The line's own socket, in a folder only this user reads; a short path, which a socket needs.
  const dir = await mkdtemp(join(tmpdir(), 'oas-'))
  const options = [
    ['BatchMode', 'yes'],
    ['StrictHostKeyChecking', 'accept-new'],
    ['ConnectTimeout', '20'],
    ['ServerAliveInterval', '15'],
    ['ServerAliveCountMax', '4'],
    ['ControlMaster', 'auto'],
    ['ControlPath', join(dir, 's')],
    ['ControlPersist', '120'],
  ].flatMap(([name, value]) => ['-o', `${name}=${value}`])
  // `--` ends the options: an address is never read as one.
  const args = (remote: string, more: string[] = []): string[] => [...options, ...more, '-l', server.user, '--', server.address, remote]
  const root = server.user === 'root' ? '' : 'sudo -n '
  const signal = opts.signal ? { signal: opts.signal } : {}
  return {
    async meet() {
      const said = await run('ssh', args('true', ['-v']), '', { timeoutMs: 60_000, ...signal })
      if (said.code !== 0) return { ok: false, said: said.err.split('\n').filter(line => !NOISE.test(line)).join('\n').trim() }
      const fingerprint = /^debug1: Server host key: \S+ (SHA256:\S+)/m.exec(said.err)?.[1]
      return { ok: true, ...(fingerprint ? { fingerprint } : {}) }
    },
    run: (as, script, timeoutMs) => run('ssh', args(as === 'root' ? `${root}bash -s` : `${root}runuser -l ${SERVER_USER} -c 'bash -s'`), script, { timeoutMs, ...signal }),
    async close() {
      await run('ssh', ['-o', `ControlPath=${join(dir, 's')}`, '-O', 'exit', '--', server.address], '', { timeoutMs: 10_000 }).catch(() => {})
      await rm(dir, { recursive: true, force: true })
    },
  }
}
