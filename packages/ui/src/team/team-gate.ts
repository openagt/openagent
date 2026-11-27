import type { IncomingMessage, ServerResponse } from 'node:http'
import type { TLSSocket } from 'node:tls'
import { randomBytes } from 'node:crypto'
import { isExpectedHost, isJsonRequest, isSameOriginRequest } from '../dashboard/rpc-serve.js'
import type { GitHubSignIn } from './github-sign-in.js'
import { computerName } from '../computer-name.js'
import { sameLogin, type TeamCaller } from '@openagt/hooks'
import { hashKey, mayEnter, newKey, personOfKey, SESSION_DAYS, signedIn, type Team, type TeamPerson, type TeamStore } from './team-file.js'

// Team mode's door (team-file.ts): with it on, what the dashboard knows (its calls, a run's screen,
// a module's route) answers only a browser signed in as the owner or one of the people they added,
// or a program of this computer's that shows the file's key. The page's own files are no secret
// and are served to all: a browser not signed in gets the page, and the page asks `/_team/me` first,
// and shows the sign-in instead of the dashboard. The sign-in and the team's own changes are here,
// at `/_team/*`, where each change knows who asks: the owner alone adds, removes or turns it off.

export const TEAM_PREFIX = '/_team'
export const SESSION_COOKIE = 'openagent-session'

/** What the page reads first: off, or on and who you are there (none: sign in). */
export type TeamState =
  | { on: false }
  | {
      on: true
      /** This machine's name: what the sign-in says it is for. */
      name: string
      owner: TeamPerson
      /** Who this browser is signed in as. */
      person?: TeamPerson
      /** The people added: told to those signed in. */
      members?: { login: string; added: string; person?: TeamPerson; signedIn?: string }[]
    }

/** What a code asked for is, as the page shows it. */
export interface SignInCode {
  id: string
  userCode: string
  verificationUri: string
  expiresIn: number
  interval: number
}

/** What a wait says. */
export type SignInWait =
  | { state: 'pending'; interval: number }
  | { state: 'ended'; reason: string }
  | { state: 'not-member'; login: string; owner: string }
  | { state: 'done'; person: TeamPerson }

/** Whether a request may reach what the dashboard knows, and who it is for. */
export type Admission = { admitted: false } | { admitted: true; caller?: TeamCaller }

export interface TeamGate {
  /** Whether `req` may reach what the dashboard knows: Team mode off (no caller), a browser signed in, or this computer's key (the owner). */
  admits(req: IncomingMessage): Promise<Admission>
  /** Answer a request at {@link TEAM_PREFIX} or below. */
  handle(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void>
}

/** A code asked for and not yet settled. */
interface Pending {
  deviceCode: string
  interval: number
  /** Not asked GitHub again before then (ms). */
  next: number
  ends: number
  /** Asked for to turn Team mode on: whoever signs in owns it. */
  turnOn: boolean
}

/** A GitHub username as GitHub allows one. */
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/

export function teamGate(store: TeamStore, github: GitHubSignIn, now: () => number = Date.now): TeamGate {
  const pending = new Map<string, Pending>()

  const keyOf = (req: IncomingMessage): string | undefined => cookieOf(req, SESSION_COOKIE)
  const personOf = (team: Team, req: IncomingMessage): TeamPerson | undefined => {
    const key = keyOf(req)
    return key === undefined ? undefined : personOfKey(team, key, new Date(now()))
  }
  const local = (team: Team, req: IncomingMessage): boolean => {
    const header = req.headers.authorization
    return team.localKey !== undefined && header === `Bearer ${team.localKey}`
  }
  const isOwner = (team: Team, req: IncomingMessage): boolean => {
    if (local(team, req)) return true
    const person = personOf(team, req)
    return person !== undefined && team.owner !== undefined && sameLogin(person.login, team.owner.login)
  }

  const admits = async (req: IncomingMessage): Promise<Admission> => {
    const team = await store.read()
    if (!team.on || !team.owner) return { admitted: true }
    const person = local(team, req) ? team.owner : personOf(team, req)
    if (!person) return { admitted: false }
    return { admitted: true, caller: callerOf(team.owner, person) }
  }

  const state = async (req: IncomingMessage): Promise<TeamState> => {
    const team = await store.read()
    if (!team.on || !team.owner) return { on: false }
    const person = local(team, req) ? team.owner : personOf(team, req)
    return { on: true, name: computerName(), owner: team.owner, ...(person ? { person, members: team.members } : {}) }
  }

  const startSignIn = async (body: Record<string, unknown>): Promise<SignInCode | { error: string }> => {
    const team = await store.read()
    const turnOn = body.turnOn === true && !team.on
    if (!team.on && !turnOn) return { error: 'Team mode is off: nobody signs in here.' }
    for (const [id, p] of pending) if (p.ends <= now()) pending.delete(id)
    const code = await github.start()
    const id = randomBytes(16).toString('hex')
    pending.set(id, { deviceCode: code.deviceCode, interval: code.interval, next: now() + code.interval * 1000, ends: now() + code.expiresIn * 1000, turnOn })
    return { id, userCode: code.userCode, verificationUri: code.verificationUri, expiresIn: code.expiresIn, interval: code.interval }
  }

  const wait = async (body: Record<string, unknown>, req: IncomingMessage, res: ServerResponse): Promise<SignInWait> => {
    const id = typeof body.id === 'string' ? body.id : ''
    const p = pending.get(id)
    if (!p || p.ends <= now()) {
      pending.delete(id)
      return { state: 'ended', reason: 'The code ran out. Start again.' }
    }
    // Asked again before GitHub allows: told to wait, GitHub not asked.
    if (now() < p.next) return { state: 'pending', interval: p.interval }
    const poll = await github.poll(p.deviceCode)
    if (poll.state === 'pending' || poll.state === 'slow-down') {
      if (poll.state === 'slow-down') p.interval = poll.interval
      p.next = now() + p.interval * 1000
      return { state: 'pending', interval: p.interval }
    }
    pending.delete(id)
    if (poll.state === 'ended') return { state: 'ended', reason: poll.reason }
    const person = poll.person
    const key = newKey()
    let refused: { login: string; owner: string } | undefined
    await store.change(team => {
      if (!team.on && p.turnOn)
        return signedIn(
          {
            on: true,
            owner: person,
            members: team.members.filter(m => !sameLogin(m.login, person.login)),
            sessions: [],
            localKey: newKey(),
          },
          person,
          hashKey(key),
          new Date(now()),
        )
      if (!team.on || !mayEnter(team, person.login)) {
        refused = { login: person.login, owner: team.owner?.login ?? '' }
        return team
      }
      return signedIn(team, person, hashKey(key), new Date(now()))
    })
    if (refused) return { state: 'not-member', ...refused }
    res.setHeader('set-cookie', sessionCookie(req, key, SESSION_DAYS * 24 * 60 * 60))
    return { state: 'done', person }
  }

  const signOut = async (req: IncomingMessage, res: ServerResponse): Promise<{ ok: true }> => {
    const key = keyOf(req)
    if (key !== undefined) {
      const hash = hashKey(key)
      await store.change(team => ({ ...team, sessions: team.sessions.filter(s => s.hash !== hash) }))
    }
    res.setHeader('set-cookie', sessionCookie(req, '', 0))
    return { ok: true }
  }

  const addMember = async (body: Record<string, unknown>): Promise<{ ok: true } | { error: string }> => {
    const login = typeof body.login === 'string' ? body.login.trim().replace(/^@/, '') : ''
    if (!LOGIN.test(login)) return { error: `"${login}" is no GitHub username.` }
    let known = false
    await store.change(team => {
      known = mayEnter(team, login)
      return known ? team : { ...team, members: [...team.members, { login, added: new Date(now()).toISOString() }] }
    })
    return known ? { error: `@${login} is on the team already.` } : { ok: true }
  }

  const removeMember = async (body: Record<string, unknown>): Promise<{ ok: true }> => {
    const login = typeof body.login === 'string' ? body.login : ''
    await store.change(team => ({
      ...team,
      members: team.members.filter(m => !sameLogin(m.login, login)),
      // Signed out at once, on every browser.
      sessions: team.sessions.filter(s => !sameLogin(s.login, login)),
    }))
    return { ok: true }
  }

  const turnOff = async (): Promise<{ ok: true }> => {
    // The people added are kept for when it is on again; nobody stays signed in, and the owner is
    // whoever turns it on next.
    await store.change(team => ({ on: false, members: team.members, sessions: [] }))
    return { ok: true }
  }

  const handle = async (req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> => {
    const path = pathname.slice(TEAM_PREFIX.length)
    if (!isExpectedHost(req)) return send(res, 403, { error: 'forbidden' })
    if (req.method === 'GET' && path === '/me') return send(res, 200, await state(req))
    if (req.method !== 'POST') return send(res, 404, { error: 'not found' })
    // A change is a page's of this dashboard's own: the RPC mount's guards.
    if (!isSameOriginRequest(req) || !isJsonRequest(req)) return send(res, 403, { error: 'forbidden' })
    const body = await readJson(req)
    try {
      if (path === '/sign-in') return send(res, 200, await startSignIn(body))
      if (path === '/sign-in/wait') return send(res, 200, await wait(body, req, res))
      if (path === '/sign-out') return send(res, 200, await signOut(req, res))
      const team = await store.read()
      if (!team.on || !isOwner(team, req)) return send(res, 403, { error: `Only ${team.owner ? `@${team.owner.login}` : 'the owner'} changes the team.` })
      if (path === '/members/add') return send(res, 200, await addMember(body))
      if (path === '/members/remove') return send(res, 200, await removeMember(body))
      if (path === '/off') return send(res, 200, await turnOff())
      return send(res, 404, { error: 'not found' })
    } catch (err) {
      return send(res, 502, { error: err instanceof Error ? err.message : String(err) })
    }
  }

  return { admits, handle }
}

/** Who a person signed in is for the modules: their GitHub account, and whether they own the team. */
function callerOf(owner: TeamPerson, person: TeamPerson): TeamCaller {
  return { login: person.login, ...(person.name ? { name: person.name } : {}), ...(person.id ? { id: person.id } : {}), owner: sameLogin(owner.login, person.login), teamOwner: owner.login }
}

/** The session's cookie: the browser's alone (no script reads it), sent on this site's own pages, on HTTPS only when it came over HTTPS. */
function sessionCookie(req: IncomingMessage, key: string, maxAge: number): string {
  const secure = (req.socket as TLSSocket).encrypted === true
  return `${SESSION_COOKIE}=${key}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`
}

/** One cookie's value from a request. */
export function cookieOf(req: IncomingMessage, name: string): string | undefined {
  const header = req.headers.cookie
  if (!header) return undefined
  for (const part of header.split(';')) {
    const at = part.indexOf('=')
    if (at === -1) continue
    if (part.slice(0, at).trim() === name) return part.slice(at + 1).trim() || undefined
  }
  return undefined
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > 16 * 1024) return {}
    chunks.push(chunk as Buffer)
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as unknown
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(body))
}
