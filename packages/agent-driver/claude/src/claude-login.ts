import { spawn } from 'node:child_process'

// A Claude login made for a computer nobody sits at, with Claude Code's own `claude setup-token`:
// the person says yes once in this computer's browser, and the login lasts a year. What a server
// is given, and what an account added beside the person's own is (`claude-accounts.ts`).

export type Failed = { ok: false; error: string }

/** What Claude Code writes before and after the login it made, and what such a login reads as. The gap between two words is of any width. */
const MINTED = /Your\s+OAuth\s+token[^\n]*:[\s\S]*?^\s*(sk-ant-[A-Za-z0-9_-]{40,400})\s+Store\s+this\s+token\s+securely/m
/** The columns and rows the lent terminal says it has. */
const COLUMNS = 250
const ROWS = 50
/** What a terminal is told that draws nothing and moves nothing here: a link's address, a title, a character set. */
const NOT_DRAWN = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][0-9A-Za-z]|\x1b[=>]|[\x0e\x0f\x07]/g
/** A move, an erase, a colour: what stands between two pieces of a screen. */
const CONTROL = /\x1b\[([0-?]*)[ -/]*([@-~])/y

/**
 * The words on Claude Code's screen, as a terminal shows them. Claude Code redraws only the cells
 * that changed: a letter already there is passed over with a move of the cursor, so what it wrote is
 * not what is on the screen, least of all after the sign-in page and the box for its code were
 * drawn where the login then comes. Lines past the top stay, as a terminal's scrollback does.
 */
export const words = (shown: string): string => {
  const lines: string[][] = [[]]
  let row = 0
  let column = 0
  const top = (): number => Math.max(0, lines.length - ROWS)
  const go = (to: number): void => {
    row = Math.max(top(), to)
    while (lines.length <= row) lines.push([])
  }
  const erase = (from: number, to: number): void => {
    const line = lines[row]!
    for (let at = from; at < Math.min(to, line.length); at++) line[at] = ' '
  }
  const text = shown.replace(NOT_DRAWN, '')
  for (let at = 0; at < text.length; ) {
    if (text[at] === '\x1b') {
      CONTROL.lastIndex = at
      const control = CONTROL.exec(text)
      if (!control) {
        // Another two-character sequence: of those, only "a line up" moves anything.
        if (text[at + 1] === 'M') go(row - 1)
        at += 2
        continue
      }
      at = CONTROL.lastIndex
      const args = control[1]!
      const count = Number(args.split(';')[0]) || 1
      switch (control[2]) {
        case 'A':
          go(row - count)
          break
        case 'B':
          go(row + count)
          break
        case 'C':
          column += count
          break
        case 'D':
          column = Math.max(0, column - count)
          break
        case 'G':
          column = count - 1
          break
        case 'H':
        case 'f': {
          const [down, across] = args.split(';')
          go(top() + (Number(down) || 1) - 1)
          column = (Number(across) || 1) - 1
          break
        }
        case 'K':
          if (args === '1') erase(0, column + 1)
          else if (args === '2') erase(0, COLUMNS)
          else erase(column, COLUMNS)
          break
        case 'J':
          if (args === '2' || args === '3') {
            lines.length = 0
            lines.push([])
            row = 0
          } else {
            erase(column, COLUMNS)
            lines.length = row + 1
          }
          break
      }
      continue
    }
    const character = String.fromCodePoint(text.codePointAt(at)!)
    at += character.length
    if (character === '\r') column = 0
    else if (character === '\n') go(row + 1)
    else if (character === '\b') column = Math.max(0, column - 1)
    else if (character >= ' ') {
      const line = lines[row]!
      while (line.length < column) line.push(' ')
      line[column] = character
      column += 1
    }
  }
  return lines.map(line => line.join('').trimEnd()).join('\n')
}

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

/** Where Claude Code's sign-in page is, as the link it drew says it: the whole address, however the screen wrapped its words. */
const SIGN_IN_LINK = /\x1b\]8;[^;\x07\x1b]*;(https:\/\/[^\x07\x1b\s]+\/oauth\/authorize\?[^\x07\x1b\s]+)(?:\x07|\x1b\\)/

/** The sign-in page Claude Code offers for a browser on another device, once it drew it. */
export function signInUrl(shown: string): string | undefined {
  return SIGN_IN_LINK.exec(shown)?.[1]
}

/** What the sign-in page hands the person to paste back: letters, digits and the few marks it is written with. */
export const isSignInCode = (code: string): boolean => /^[A-Za-z0-9_\-#.~]{8,1000}$/.test(code)

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
  /**
   * Told the sign-in page once Claude Code shows it, for a computer whose browser is on another
   * device: the person opens it there, says yes, and pastes back the code the page shows.
   * `paste` answers whether the code was handed to Claude Code.
   */
  onLink?: (url: string, paste: (code: string) => boolean) => void
  /** Told when Claude Code did not take the code pasted: it is ready for another, at the same page. */
  onRefused?: () => void
}

/** How a Claude login is made: Claude Code's own, or a stand-in for tests. */
export type Mint = (opts?: MintOptions) => Promise<{ ok: true; login: string } | Failed>

const MINT_TIMEOUT_MS = 10 * 60_000
/**
 * How long after a code its Enter is pressed. Claude Code reads what comes at once as a paste, an
 * Enter in it included, and a code is long enough that it then only sits there: it needs the Enter
 * as a key of its own.
 */
const ENTER_AFTER_MS = 600
/** What Claude Code says of a code it did not take, then waiting for an Enter to ask again. */
const REFUSED = /OAuth\s+error/
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
 * lends it one, wide enough that the login stays on one line. Its input is a pipe nothing writes
 * to but a code the person pastes back. `script` gives its program a group of its own, so that
 * program first says which process it is: at the end both groups are ended, whether or not Claude
 * Code heeds a terminal that went away.
 */
export const mintClaude: Mint = ({ signal, timeoutMs = MINT_TIMEOUT_MS, command = 'claude setup-token', onLink, onRefused } = {}) =>
  new Promise(resolve => {
    const inner = `echo "started as $$"; stty cols ${COLUMNS} rows ${ROWS}; command -v ${command.split(' ')[0]} >/dev/null || { echo "Claude Code is not on this computer."; exit 1; }; exec ${command}`
    const lent = process.platform === 'darwin' ? 'script -q /dev/null sh -c "$0"' : 'script -q -e -c "$0" /dev/null'
    // On Linux `script` starts its program with the person's own shell, and the line above is written for sh.
    const child = spawn('sh', ['-c', `cat | { ${lent}; kill 0; }`, inner], { stdio: ['pipe', 'pipe', 'pipe'], detached: true, env: { ...process.env, SHELL: '/bin/sh' } })
    child.stdin.on('error', () => {})
    let shown = ''
    let lentTo: number | undefined
    let linked = false
    let ended = false
    /** Where in what is shown the words about the last code pasted start; none while no code waits for an answer. */
    let answerFrom: number | undefined
    let enter: NodeJS.Timeout | undefined
    const end = (answer: { ok: true; login: string } | Failed): void => {
      if (ended) return
      ended = true
      clearTimeout(timer)
      clearTimeout(enter)
      signal?.removeEventListener('abort', stopped)
      for (const group of [lentTo, child.pid]) {
        if (group === undefined || group <= 1) continue
        try {
          process.kill(-group, 'SIGKILL')
        } catch {
          // Gone already.
        }
      }
      child.stdin.destroy()
      child.stdout.destroy()
      child.stderr.destroy()
      resolve(answer)
    }
    const stopped = (): void => end({ ok: false, error: 'The login was stopped.' })
    const timer = setTimeout(() => end({ ok: false, error: `No yes came from the browser in ${Math.round(timeoutMs / 60_000)} minutes.` }), timeoutMs)
    signal?.addEventListener('abort', stopped, { once: true })
    if (signal?.aborted) stopped()
    /** How much was ever shown: what is kept of it is only its end. */
    let shownEver = 0
    let answer = ''
    const read = (said: string): void => {
      shown = (shown + said).slice(-SHOWN)
      shownEver += said.length
      if (answerFrom !== undefined) {
        answer = (answer + said).slice(-SHOWN)
        if (REFUSED.test(words(answer))) {
          answerFrom = undefined
          answer = ''
          child.stdin.write('\r')
          onRefused?.()
        }
      }
      // Read once, as it comes: it is the first thing written, and a long wait scrolls it out of what is kept.
      lentTo ??= startedAs(shown)
      const url = linked || !onLink ? undefined : signInUrl(shown)
      if (url !== undefined) {
        linked = true
        onLink!(url, code => {
          const word = code.trim()
          if (ended || !isSignInCode(word)) return false
          child.stdin.write(word)
          enter = setTimeout(() => {
            answerFrom = shownEver
            answer = ''
            child.stdin.write('\r')
          }, ENTER_AFTER_MS)
          return true
        })
      }
      const login = mintedIn(shown)
      if (login) end({ ok: true, login })
    }
    child.stdout.setEncoding('utf8').on('data', read)
    child.stderr.setEncoding('utf8').on('data', read)
    child.once('error', error => end({ ok: false, error: `Claude Code could not be started: ${error.message}` }))
    child.once('close', () => end({ ok: false, error: notMinted(shown) }))
  })
