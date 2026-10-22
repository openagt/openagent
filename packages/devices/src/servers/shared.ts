import { mintClaude, type Mint } from '@openagt/agent-driver-claude'
import { ownGithubLogin } from './logins.js'
import { ownDoor, type OwnDoor } from './own-door.js'
import type { Exec } from './ssh.js'
import { BEAT_MS, atWork, heartbeat, isMachineUrl, isThroughUrl, update, type Login, type Reach, type Shared, type Store } from './store.js'

/**
 * A computer several people use, from the side of one of them who is not its owner: the server
 * someone invited this computer's person to. They have no way in over SSH. Everything goes through
 * the server's door, with the key OpenAgent holds there, and lands with this person's own
 * OpenAgent on the server, which keeps their logins for their runs.
 *
 * So this computer's OpenAgent is asked to make each call: it holds the key, and this package
 * never sees it. A login made or read here is handed over in the call's body, and is not kept.
 *
 * The same goes for another person's computer, set up as a server and shared with everyone on a
 * server this person is in at: this person has an OpenAgent of their own there too, which keeps
 * their logins for their runs there. Those are copies from their OpenAgent on the server, made
 * the first time they start a run there; a login made here for it instead is no copy, and no copy
 * takes its place. It is reached through the server, at the address OpenAgent saved it at.
 */

/** This package, as OpenAgent knows it: what is run on the other side under the same name. */
export const PACKAGE = '@openagt/devices'

/** How long this computer's OpenAgent gets to answer: a call it makes to the server waits up to its own limit. */
const ASK_TIMEOUT_MS = 60_000

/**
 * Ask this computer's own OpenAgent, as its own page would: where it answers is what it told the
 * command it started. It is only ever this computer's own.
 */
export async function askOpenAgent(env: NodeJS.ProcessEnv, fn: string, args: unknown[]): Promise<unknown> {
  const said = env.OPENAGENT_URL
  if (!said) throw new Error('This is run by OpenAgent: OPENAGENT_URL says where it is, and it is not set.')
  const origin = new URL(said).origin
  if (!/^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(origin)) throw new Error('OpenAgent is asked on this computer only.')
  const res = await fetch(`${origin}/_rpc/${fn}`, {
    method: 'POST',
    // Asked as OpenAgent's own page asks: from its own address.
    headers: { 'content-type': 'application/json', origin, 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(ASK_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`OpenAgent answered ${res.status} to ${fn}`)
  return ((await res.json()) as { ret?: unknown }).ret
}

type Answered = { ok: true; output: unknown } | { ok: false; error: string }

/** Run one of this package's commands on the server, as this person's OpenAgent there runs it, with `input` on its standard input. */
async function onServer(env: NodeJS.ProcessEnv, machine: string, args: string[], input?: string): Promise<Answered> {
  try {
    const said = (await askOpenAgent(env, 'runComputerCommandOn', [PACKAGE, machine, args, null, input ?? null])) as Answered | undefined
    return said && typeof said === 'object' && typeof said.ok === 'boolean' ? said : { ok: false, error: 'OpenAgent answered something else than expected.' }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** What this computer keeps for a shared server, by its address; a fresh one when it keeps nothing. */
function sharedIn(store: Store, url: string): Shared {
  let kept = store.shared.find(candidate => candidate.url === url)
  if (!kept) store.shared.push((kept = { url }))
  return kept
}

/** Copy this computer's GitHub login to the person's own OpenAgent on the server; answers what it said of its logins. */
export async function copyGithub(env: NodeJS.ProcessEnv, machine: string, run?: Exec): Promise<Answered> {
  const own = await ownGithubLogin(run)
  if (!own.ok) return own
  return onServer(env, machine, ['own', 'login', 'github'], own.login)
}

/** Hand a login made here to the person's own OpenAgent on another person's computer: no copy, so no server's copy takes its place. */
async function toOther(env: NodeJS.ProcessEnv, machine: string, given: { github?: string; claude?: string }): Promise<Answered> {
  try {
    const said = (await askOpenAgent(env, 'sendMachineLogins', [machine, given])) as { ok?: unknown; logins?: unknown; error?: unknown } | undefined
    if (said?.ok === true) return { ok: true, output: said.logins }
    return { ok: false, error: typeof said?.error === 'string' ? said.error : 'OpenAgent answered something else than expected.' }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** What the person's own OpenAgent on another person's computer says of their logins there, through OpenAgent. */
export async function otherLogins(env: NodeJS.ProcessEnv, machine: string): Promise<Answered> {
  try {
    const said = (await askOpenAgent(env, 'onMachineLogins', [machine])) as { ok?: unknown; logins?: unknown; error?: unknown } | undefined
    if (said?.ok === true) return { ok: true, output: said.logins }
    return { ok: false, error: typeof said?.error === 'string' ? said.error : 'OpenAgent answered something else than expected.' }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Copy this computer's GitHub login to the person's own OpenAgent on another person's computer; answers what it says of the logins there. */
export async function copyGithubToOther(env: NodeJS.ProcessEnv, machine: string, run?: Exec): Promise<Answered> {
  const own = await ownGithubLogin(run)
  if (!own.ok) return own
  return toOther(env, machine, { github: own.login })
}

/** Where a Claude login made here goes: the person's own OpenAgent on a shared server, or on another person's computer. */
export type MintFor = 'shared' | 'other'

/**
 * Make a Claude login for the person's own OpenAgent on the server, or on another person's
 * computer, with Claude Code's `setup-token` in this computer's browser, and hand it over. Run as
 * a process of its own: the person's yes in the browser takes a while. How it ended is written to
 * the file, for the page.
 */
export async function mintFor(opts: { env: NodeJS.ProcessEnv; machine: string; to?: MintFor; mint?: Mint; signal?: AbortSignal; beatMs?: number }): Promise<void> {
  const { env, machine } = opts
  const mine = (login: Login | undefined): boolean => login?.worker?.pid === process.pid
  const change = (apply: (login: Login) => void): Promise<unknown> =>
    update(env, store => {
      const kept = sharedIn(store, machine)
      if (mine(kept.claude)) apply(kept.claude!)
    })
  const beating = heartbeat(() => change(login => void (login.worker = { pid: process.pid, seen: new Date().toISOString() })), opts.beatMs ?? BEAT_MS)
  let after: (login: Login) => void = login => void (login.failed = 'The work stopped before it ended.')
  try {
    await change(login => void (login.asking = true))
    const minted = await (opts.mint ?? mintClaude)(opts.signal ? { signal: opts.signal } : {})
    await change(login => void delete login.asking)
    if (!minted.ok) return void (after = login => void (login.failed = minted.error))
    const given = opts.to === 'other' ? await toOther(env, machine, { claude: minted.login }) : await onServer(env, machine, ['own', 'login', 'claude'], minted.login)
    after = given.ok ? login => void delete login.failed : login => void (login.failed = given.error)
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    after = login => void (login.failed = error)
  } finally {
    await beating.stop()
    await change(login => {
      after(login)
      delete login.worker
      delete login.asking
    }).catch(() => {})
  }
}

/** Start the process that makes a Claude login; a second press while the browser waits starts over. */
export async function startMint(env: NodeJS.ProcessEnv, machine: string, startWork: (words: string[]) => number, to: MintFor = 'shared'): Promise<void> {
  const before = await update(env, store => {
    const kept = sharedIn(store, machine)
    const busy = atWork(kept.claude?.worker)
    if (busy && kept.claude!.asking !== true) throw new Error('A Claude login for that server is being made right now.')
    const was = busy ? kept.claude!.worker!.pid : undefined
    kept.claude = { worker: { pid: process.pid, seen: new Date().toISOString() } }
    return was
  })
  if (before !== undefined) {
    try {
      process.kill(before, 'SIGTERM')
    } catch {
      // Ended by itself in the meantime.
    }
  }
  let worker: number | undefined
  try {
    worker = startWork([to === 'other' ? 'other-work' : 'shared-work', machine])
  } finally {
    await update(env, store => {
      const login = store.shared.find(candidate => candidate.url === machine)?.claude
      if (!login || login.worker?.pid !== process.pid) return
      if (worker !== undefined) login.worker = { pid: worker, seen: new Date().toISOString() }
      else delete login.worker
    })
  }
}

/** The line this computer keeps open to a server, as its own door says: what the server may do, and whether it said no to the key. */
export async function lineTo(env: NodeJS.ProcessEnv, machine: string, door: OwnDoor = ownDoor): Promise<{ mode: Reach; refused: boolean; id?: string } | undefined> {
  const answer = await door(['status'], env)
  if (!answer.ok || answer.out === undefined) return undefined
  try {
    const { lines } = JSON.parse(answer.out) as { lines?: unknown }
    const line = Array.isArray(lines) ? (lines as Record<string, unknown>[]).find(candidate => candidate?.url === machine) : undefined
    if (!line || (line.mode !== 'full' && line.mode !== 'watch')) return undefined
    return { mode: line.mode, refused: line.refused === true, ...(typeof line.id === 'string' ? { id: line.id } : {}) }
  } catch {
    return undefined
  }
}

/**
 * Keep a line open to the server, as this person's, and say what the server may do through it; or
 * none. The first time, the server's door gives this person a link for a line, through
 * OpenAgent, and this computer's own door gets in with it.
 */
export async function setSharedReach(env: NodeJS.ProcessEnv, machine: string, mode: Reach | 'off', door: OwnDoor = ownDoor): Promise<void> {
  const line = await lineTo(env, machine, door)
  if (mode === 'off') {
    if (line) {
      const gone = await door(['line', 'remove', machine], env)
      if (!gone.ok) throw new Error(gone.error)
    }
    return
  }
  if (line && !line.refused && (await door(['line', mode, machine], env)).ok) return
  const link = (await askOpenAgent(env, 'sendMachineLineLink', [machine])) as { ok?: boolean; url?: unknown; error?: unknown } | undefined
  if (!link?.ok || typeof link.url !== 'string') throw new Error(typeof link?.error === 'string' ? link.error : 'The server gave no link for a line.')
  const asked = await door(['line', 'add', '-', ...(mode === 'watch' ? ['watch'] : [])], env, link.url)
  if (!asked.ok) throw new Error(asked.error)
}

/** Forget what this computer keeps for a shared server, and the line it keeps to it. */
export async function forgetShared(env: NodeJS.ProcessEnv, machine: string, door: OwnDoor = ownDoor): Promise<void> {
  await setSharedReach(env, machine, 'off', door)
  await update(env, store => void (store.shared = store.shared.filter(kept => kept.url !== machine)))
}

/** Whether `said` names another person's computer the way OpenAgent's machines do: through a server, or at its line's address on one. */
export const isOtherUrl = (said: string | undefined): said is string => said !== undefined && (isThroughUrl(said) || (isMachineUrl(said) && said.startsWith('http://127.0.0.1:')))

/** Whether `said` names a shared server the way OpenAgent's machines do. */
export const isSharedUrl = (said: string | undefined): said is string => said !== undefined && isMachineUrl(said) && said.startsWith('https://')
