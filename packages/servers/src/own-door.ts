import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

/**
 * This computer's own door, asked as a person asks it: by its command. The line a server is
 * reached back through is the door's to keep; this package only says to which server, and what
 * that server may do through it.
 */
export type OwnDoor = (args: string[], env: NodeJS.ProcessEnv, input?: string) => Promise<{ ok: true; /** What the command answered, when it was read. */ out?: string } | { ok: false; error: string }>

const ANSWER_MS = 60_000
/** How much of an answer is kept: the door's file caps what it lists far below this. */
const ANSWER_MAX = 256_000

export const ownDoor: OwnDoor = (args, env, input) =>
  new Promise(resolve => {
    let bin: string
    try {
      bin = join(dirname(createRequire(import.meta.url).resolve('@openagt/remote-access/package.json')), 'bin', 'remote-access')
    } catch {
      return resolve({ ok: false, error: 'the door of this computer is not installed beside OpenAgent' })
    }
    // What must not be read off the list of running programs (a link's code) goes in on standard input.
    const child = spawn(process.execPath, [bin, ...args], { env, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] })
    child.stdin?.on('error', () => {}).end(input)
    let out = ''
    child.stdout!.setEncoding('utf8').on('data', (chunk: string) => (out = (out + chunk).slice(0, ANSWER_MAX)))
    let said = ''
    child.stderr!.setEncoding('utf8').on('data', (chunk: string) => (said = (said + chunk).slice(-2_000)))
    const timer = setTimeout(() => child.kill('SIGKILL'), ANSWER_MS)
    const end = (answer: { ok: true; out: string } | { ok: false; error: string }): void => {
      clearTimeout(timer)
      resolve(answer)
    }
    child.once('error', err => end({ ok: false, error: err.message }))
    // Its end, with all it printed read: an answer is not taken for whole before that.
    child.once('close', code => end(code === 0 ? { ok: true, out } : { ok: false, error: said.trim().split('\n').at(-1) || 'the door of this computer did not answer' }))
  })
