import { spawn } from 'node:child_process'

// A Claude login made for a computer nobody sits at, with Claude Code's own `claude setup-token`:
// the person says yes once in this computer's browser, and the login lasts a year. What a server
// is given, and what an account added beside the person's own is (`claude-accounts.ts`).

export type Failed = { ok: false; error: string }

/** What Claude Code writes before and after the login it made, and what such a login reads as. The gap between two words is of any width. */
const MINTED = /Your\s+OAuth\s+token[^\n]*:\s*(sk-ant-[A-Za-z0-9_-]{40,400})\s+Store\s+this\s+token\s+securely/
/** What a terminal is told beside words: colours, where the cursor goes, a link's address. */
const TERMINAL = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g
/** A colour: the one thing a terminal is told that leaves the words on its two sides together. */
const COLOUR = /\x1b\[[0-9;:]*m/g

/**
 * The words Claude Code showed, without what only a terminal reads. A colour goes; anything else
 * a terminal is told is a gap: Claude Code's screen puts a word at its column where a plain line
 * holds a space, and a login the cursor moved in is not one login.
 */
const words = (shown: string): string => shown.replace(COLOUR, '').replace(TERMINAL, ' ').replaceAll('\r', '\n')

/** The login among what Claude Code showed, once all of it is there. */
export function mintedIn(shown: string): string | undefined {
  return MINTED.exec(words(shown))?.[1]
}

/** Why Claude Code ended without a login, from what it showed: its last lines, never a part of a login. */
export function notMinted(shown: string): string {
  const text = words(shown)
  // However the screen was drawn: where a login or its heading shows, none of the screen is told.
  if (/YourOAuthtoken|sk-ant-/.test(text.replace(/\s/g, ''))) return 'Claude Code made a login, and this OpenAgent could not read it off what Claude Code showed.'
  const lines = [...new Set(text.split('\n').map(line => line.trim().replace(/\s+/g, ' ')).filter(line => line && !STARTED_AS.test(line)))]
  return ['Claude Code ended without a login.', ...lines.slice(-5)].join('\n')
}

/** Which process the lent terminal's first program said it is, once its whole line is there: half a number names another process. */
export function startedAs(shown: string): number | undefined {
  return Number(/^started as (\d+)\n/m.exec(words(shown))?.[1]) || undefined
}

export interface MintOptions {
  signal?: AbortSignal
  /** How long the person has to say yes in the browser. */
  timeoutMs?: number
  /** The command that makes the login; Claude Code's own when unsaid. */
  command?: string
}

/** How a Claude login is made: Claude Code's own, or a stand-in for tests. */
export type Mint = (opts?: MintOptions) => Promise<{ ok: true; login: string } | Failed>

const MINT_TIMEOUT_MS = 10 * 60_000
/** How much of what Claude Code showed is kept: its end, where the login is. */
const SHOWN = 256 * 1024
/** The line the lent terminal's first program writes of itself, before it becomes Claude Code. */
const STARTED_AS = /^started as \d+$/

/**
 * Make a Claude login that lasts a year, with Claude Code's own `claude setup-token`: it opens
 * this computer's browser, the person says yes there, and it shows the login once. It keeps
 * nothing, and neither does this.
 *
 * Claude Code draws on a terminal's screen and this process has none, so the system's `script`
 * lends it one, wide enough that the login stays on one line. Its input is a pipe nothing ever
 * writes to. `script` gives its program a group of its own, so that program first says which
 * process it is: at the end both groups are ended, whether or not Claude Code heeds a terminal
 * that went away.
 */
export const mintClaude: Mint = ({ signal, timeoutMs = MINT_TIMEOUT_MS, command = 'claude setup-token' } = {}) =>
  new Promise(resolve => {
    const inner = `echo "started as $$"; stty cols 250 rows 50; command -v ${command.split(' ')[0]} >/dev/null || { echo "Claude Code is not on this computer."; exit 1; }; exec ${command}`
    const lent = process.platform === 'darwin' ? 'script -q /dev/null sh -c "$0"' : 'script -q -e -c "$0" /dev/null'
    // On Linux `script` starts its program with the person's own shell, and the line above is written for sh.
    const child = spawn('sh', ['-c', `tail -f /dev/null | { ${lent}; kill 0; }`, inner], { stdio: ['ignore', 'pipe', 'pipe'], detached: true, env: { ...process.env, SHELL: '/bin/sh' } })
    let shown = ''
    let lentTo: number | undefined
    let ended = false
    const end = (answer: { ok: true; login: string } | Failed): void => {
      if (ended) return
      ended = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', stopped)
      for (const group of [lentTo, child.pid]) {
        if (group === undefined || group <= 1) continue
        try {
          process.kill(-group, 'SIGKILL')
        } catch {
          // Gone already.
        }
      }
      child.stdout.destroy()
      child.stderr.destroy()
      resolve(answer)
    }
    const stopped = (): void => end({ ok: false, error: 'The login was stopped.' })
    const timer = setTimeout(() => end({ ok: false, error: `No yes came from the browser in ${Math.round(timeoutMs / 60_000)} minutes.` }), timeoutMs)
    signal?.addEventListener('abort', stopped, { once: true })
    if (signal?.aborted) stopped()
    const read = (said: string): void => {
      shown = (shown + said).slice(-SHOWN)
      // Read once, as it comes: it is the first thing written, and a long wait scrolls it out of what is kept.
      lentTo ??= startedAs(shown)
      const login = mintedIn(shown)
      if (login) end({ ok: true, login })
    }
    child.stdout.setEncoding('utf8').on('data', read)
    child.stderr.setEncoding('utf8').on('data', read)
    child.once('error', error => end({ ok: false, error: `Claude Code could not be started: ${error.message}` }))
    child.once('close', () => end({ ok: false, error: notMinted(shown) }))
  })
