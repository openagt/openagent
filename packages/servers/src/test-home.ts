import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Exec, Said } from './ssh.js'

/** A home folder of a test's own: the env the servers file is found through, and how to remove it. */
export async function testHome(): Promise<{ env: NodeJS.ProcessEnv; remove: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'servers-'))
  return { env: { XDG_CONFIG_HOME: dir }, remove: () => rm(dir, { recursive: true, force: true }) }
}

/** One `ssh` a test saw: what it was to run on the server, and the script it was fed. */
export interface Call {
  args: readonly string[]
  /** The last argument: the command the server runs, or `true` for the first meeting. */
  remote: string
  script: string
}

/**
 * A server that is not there: every `ssh` is answered by `answer`, or goes well with nothing said.
 * The first meeting shows the key `ssh -v` would.
 */
export function pretendServer(answer: (call: Call) => Partial<Said> | undefined = () => undefined): { exec: Exec; calls: Call[] } {
  const calls: Call[] = []
  const exec: Exec = async (bin, args, script) => {
    if (bin !== 'ssh') throw new Error(`not ssh: ${bin}`)
    // Hanging up is no script.
    if (args.includes('-O')) return { code: 0, out: '', err: '' }
    const call = { args, remote: args.at(-1)!, script }
    calls.push(call)
    const met = call.remote === 'true' ? 'OpenSSH_9.9p2, LibreSSL 3.3.6\ndebug1: Server host key: ssh-ed25519 SHA256:0123456789abcdefghijklmnopqrstuvwxyzABCDEFG\nAuthenticated to 203.0.113.5 ([203.0.113.5]:22) using "publickey".' : ''
    return { code: 0, out: '', err: met, ...answer(call) }
  }
  return { exec, calls }
}
