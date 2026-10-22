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

/** The name and email this computer's git has in a test, made up. */
export const GIT_IDENTITY = { name: 'Mona Octocat', email: 'mona@example.com' }

/** A GitHub login as `gh` hands one out, made up. */
export const GH_LOGIN = `gho_${'a1B2'.repeat(9)}`

/**
 * A server that is not there: every `ssh` is answered by `answer`, or goes well with nothing said.
 * The first meeting shows the key `ssh -v` would.
 *
 * This computer's own `gh` is not there either: it is logged in as octocat and holds
 * {@link GH_LOGIN}, unless `gh` answers otherwise for what it is asked. Nor is its `git`,
 * which commits as {@link GIT_IDENTITY} unless `git` says otherwise.
 */
export function pretendServer(
  answer: (call: Call) => Partial<Said> | undefined = () => undefined,
  gh: (args: readonly string[]) => Partial<Said> | undefined = () => undefined,
  git: { name?: string; email?: string } = GIT_IDENTITY,
): { exec: Exec; calls: Call[]; asked: string[] } {
  const calls: Call[] = []
  const asked: string[] = []
  const exec: Exec = async (bin, args, script) => {
    if (bin === 'git') {
      // As `git config --get` answers: the value, or nothing and a 1 for a key that is not set.
      const value = args.at(-1) === 'user.name' ? git.name : args.at(-1) === 'user.email' ? git.email : undefined
      return value === undefined ? { code: 1, out: '', err: '' } : { code: 0, out: `${value}\n`, err: '' }
    }
    if (bin === 'gh') {
      asked.push(args.join(' '))
      return { code: 0, out: `${args[0] === 'auth' ? GH_LOGIN : 'octocat'}\n`, err: '', ...gh(args) }
    }
    if (bin !== 'ssh') throw new Error(`not ssh: ${bin}`)
    // Hanging up is no script.
    if (args.includes('-O')) return { code: 0, out: '', err: '' }
    const call = { args, remote: args.at(-1)!, script }
    calls.push(call)
    const met = call.remote === 'true' ? 'OpenSSH_9.9p2, LibreSSL 3.3.6\ndebug1: Server host key: ssh-ed25519 SHA256:0123456789abcdefghijklmnopqrstuvwxyzABCDEFG\nAuthenticated to 203.0.113.5 ([203.0.113.5]:22) using "publickey".' : ''
    return { code: 0, out: '', err: met, ...answer(call) }
  }
  return { exec, calls, asked }
}
