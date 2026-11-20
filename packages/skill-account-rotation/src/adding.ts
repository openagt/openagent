import { spawn } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { configFile, writePrivate } from '@openagt/agent-driver'
import type { AgentLogins, SignInSaid } from '@openagt/hooks'
import { nameTaken, signIn } from './login.js'
import type { LoginWiring } from './wiring.js'

// Adding an account takes as long as the person takes to sign in, and on a computer with no browser
// it needs them twice: to open a page on another device, and to bring its code back. A command ends
// long before that, and a page's call sooner. So the sign-in runs in a process of its own, and the
// commands only start it, read how it goes from one file beside the accounts, hand it the code, or
// stop it: the same for an agent, a card on any page, and Settings, here and on a server. It
// outlives whoever started it, OpenAgent restarting included.

/** One sign-in, as far as it got. The file may hold a page to sign in at: readable by this user only. */
interface AddingFile {
  name: string
  /** The sign-in's process. Absent for the moment before it says so. */
  pid?: number
  /** The page to sign in at. */
  url?: string
  /** A code to type at that page. */
  code?: string
  /** The page gives a code to bring back. */
  paste?: true
  /** The code brought back is with the agent, which checks it. */
  checking?: true
  /** The agent did not take the code brought back: it waits for another. */
  refused?: true
  /** Why it did not go through. */
  failed?: string
  at: number
}

/** A sign-in under way, as the commands and the pages show it. */
export interface Adding {
  name: string
  url?: string
  code?: string
  paste?: true
  checking?: true
  refused?: true
}

/** How adding stands for one list: under way, why the last one did not go through, or neither. */
export interface AddingNow {
  adding?: Adding
  failed?: string
  /** This computer has no browser (a server, or Linux with no display): the person signs in on their own device. */
  noBrowser?: true
}

/** How long the process that was just started gets to say which it is. */
const STARTING_MS = 30_000
/** How long why the last one did not go through is said. */
const FAILED_SAID_MS = 60 * 60_000
/** How often a sign-in looks for a code brought back. */
const CODE_EVERY_MS = 200

const NOT_WAITING = 'No login waits for a code: start it again.'

/** Where a list's sign-in says how it goes: `$XDG_CONFIG_HOME/openagent-<list>-adding.json`, else dotted under the home. */
export function addingPath(list: string, env: NodeJS.ProcessEnv = process.env): string {
  return configFile(`openagent-${list}-adding.json`, env)
}

/** Start the sign-in's own process: this package's command, on its own, holding on to nothing of the one that started it. */
export function startAddingProcess(list: string, name: string): void {
  const bin = fileURLToPath(new URL('../bin/account-rotation', import.meta.url))
  spawn(process.execPath, [bin, 'add-worker', list, name], { detached: true, stdio: 'ignore' }).unref()
}

function readFile(path: string): AddingFile | undefined {
  try {
    const file = JSON.parse(readFileSync(path, 'utf8')) as Partial<AddingFile>
    return typeof file.name === 'string' && typeof file.at === 'number' ? (file as AddingFile) : undefined
  } catch {
    return undefined
  }
}

const writeFile = (path: string, file: AddingFile): void => writePrivate(path, `${JSON.stringify(file)}\n`)

/** The sign-in under way in the file: its process is there, or was only just started. */
function underWay(file: AddingFile, wiring: LoginWiring): boolean {
  if (file.failed !== undefined) return false
  return file.pid !== undefined ? wiring.isRunning(file.pid) : wiring.now() - file.at < STARTING_MS
}

/** How adding stands for a list. */
export function addingNow(list: string, wiring: LoginWiring): AddingNow {
  const where: AddingNow = wiring.headless() ? { noBrowser: true } : {}
  const file = readFile(wiring.addingPath(list))
  if (!file) return where
  if (file.failed !== undefined) return wiring.now() - file.at < FAILED_SAID_MS ? { ...where, failed: file.failed } : where
  if (!underWay(file, wiring)) return where
  return { ...where, adding: { name: file.name, ...(file.url !== undefined ? { url: file.url } : {}), ...(file.code !== undefined ? { code: file.code } : {}), ...(file.paste ? { paste: true } : {}), ...(file.checking ? { checking: true } : {}), ...(file.refused ? { refused: true } : {}) } }
}

/** Start adding an account under `name`, and answer as soon as it is started. Refused while one is being added, and for a name that cannot be used. */
export async function beginAdding(logins: AgentLogins, name: string, wiring: LoginWiring): Promise<{ ok: true } | { ok: false; error: string }> {
  const busy = addingNow(logins.list, wiring).adding
  if (busy) return { ok: false, error: `${busy.name}'s account is being added: sign in on the page it gave, or wait for it to end.` }
  const refused = await nameTaken(logins, name, wiring)
  if (refused) return { ok: false, error: refused }
  const said = name.trim()
  writeFile(wiring.addingPath(logins.list), { name: said, at: wiring.now() })
  try {
    wiring.startAdding(logins.list, said)
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    writeFile(wiring.addingPath(logins.list), { name: said, failed: error, at: wiring.now() })
    return { ok: false, error }
  }
  return { ok: true }
}

/** Hand the sign-in the code its page showed the person. */
export function bringCode(logins: AgentLogins, code: unknown, wiring: LoginWiring): { ok: true } | { ok: false; error: string } {
  if (!addingNow(logins.list, wiring).adding?.paste) return { ok: false, error: NOT_WAITING }
  const word = typeof code === 'string' ? code.trim() : ''
  if (!logins.isSignInCode(word)) return { ok: false, error: 'That is not the code the page shows: copy it whole, and paste it here.' }
  writePrivate(`${wiring.addingPath(logins.list)}.code`, word)
  return { ok: true }
}

/** Stop the sign-in under way, and forget why the last one did not go through. */
export function cancelAdding(list: string, wiring: LoginWiring): void {
  const path = wiring.addingPath(list)
  const file = readFile(path)
  if (file?.pid !== undefined && underWay(file, wiring)) wiring.stopAdding(file.pid)
  rmSync(path, { force: true })
  rmSync(`${path}.code`, { force: true })
}

/**
 * The sign-in itself, in the process {@link beginAdding} started: says how it goes in the file, and
 * takes the code from beside it. Ends with the file gone when the account is kept, or saying why not.
 */
export async function runAdding(logins: AgentLogins, name: string, wiring: LoginWiring, signal?: AbortSignal): Promise<void> {
  const path = wiring.addingPath(logins.list)
  const pid = wiring.ownPid()
  const say = (more: Partial<AddingFile>): void => writeFile(path, { name, pid, at: wiring.now(), ...more })
  say({})
  let paste: ((code: string) => boolean) | undefined
  let link: string | undefined
  const looking = setInterval(() => {
    let code: string
    try {
      code = readFileSync(`${path}.code`, 'utf8')
    } catch {
      return
    }
    rmSync(`${path}.code`, { force: true })
    if (paste?.(code) && link !== undefined) say({ url: link, paste: true, checking: true })
  }, CODE_EVERY_MS)
  // Each agent's sign-in says where through the ones it has a use for: on this computer's browser a
  // page to copy, else a page whose code is brought back, or a code to type at a page.
  const onScreen: SignInSaid = !wiring.headless()
    ? { onUrl: url => say({ url }) }
    : {
        onLink: (url, handIn) => {
          paste = handIn
          link = url
          say({ url, paste: true })
        },
        onRefused: () => say({ ...(link !== undefined ? { url: link } : {}), paste: true, refused: true }),
        onCode: (code, url) => say({ url, code }),
      }
  const failed = await signIn(logins, name, wiring, { ...onScreen, ...(signal ? { signal } : {}) }).catch((err: unknown) => (err instanceof Error ? err.message : String(err)))
  clearInterval(looking)
  rmSync(`${path}.code`, { force: true })
  if (failed !== undefined && !signal?.aborted) writeFile(path, { name, failed, at: wiring.now() })
  else rmSync(path, { force: true })
}
