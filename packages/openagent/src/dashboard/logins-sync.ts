import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { computerName } from '../computer-name.js'
import { dirname, join } from 'node:path'
import { readAccounts, OWN_NAME } from '@openagt/agent-driver'
import { claudeAccountsPath, mintClaude, type Mint } from '@openagt/agent-driver-claude'
import { codexAccountsPath, codexWho, loginCodex, personalCodexHome, accountFolder, type CodexLogin, type CodexLoginOptions, type CodexWho } from '@openagt/agent-driver-codex'
import { listMachines, readPreferences, type MachineRecord, type Preferences } from '../registry.js'
import { machineCall, remoteFacts, type MachineAccess } from './remote-run.js'
import { markOf } from './machine-logins.js'
import { isKind, isWord, type CopiedKind, type CopiedLogin, type GivenLogin, type UsageWindow } from './copied-logins.js'
import { onAgentAccounts } from '../dashboard-rpc/accounts.js'
import { gitHostPackages, onGitHosts } from '../dashboard-rpc/logins.js'

/**
 * A computer's side of a server that uses its logins (`copied-logins.ts` is the server's side).
 * Once the person said so for a server of their own, this computer keeps the server's logins as
 * its own: every account it is logged in to, a coding agent's or a git host's, gets a login of the
 * server's own there, and a login that changes here changes there.
 *
 * A login is never shared by both: each computer renews its own, and a login renewed on one
 * computer would log the other one out. What can go as it is goes as it is, with nothing to
 * press: a git host's token, which its host never renews, and a Claude account added here, which
 * is a login made for a computer nobody sits at already. What cannot is made anew for the server,
 * in this computer's browser, with one press of the person's: their own Claude login (Claude
 * Code's `setup-token`), and any Codex account (a sign-in of its own). Nothing here is logged out.
 *
 * What the person no longer has here stays there until they say: kept, or taken off. A login
 * taken off there is deleted there and ends nothing.
 *
 * The person's settings follow the same way: what they change here is changed there, the next
 * minute. A setting changed on the server's own page stays, until the same one changes here.
 */

/** One of this computer's accounts, as a server gets it. */
export interface LocalLogin {
  kind: CopiedKind
  host?: string
  /** Which account it is here: `own` for the agent's own login, else its name here, or its login at the git host. */
  source: string
  name: string
  /** Who the account is: another one under the same `source` is a switch. */
  who: string
  /** A git host's account this computer's runs use. */
  runs?: boolean
  /** The login as it is, for one that can go as it is; none for one made anew for the server. */
  secret?: () => Promise<string>
}

/** How one of this computer's accounts stands on a server. */
export interface LoginThere {
  kind: CopiedKind
  host?: string
  source: string
  name: string
  /**
   * `there`: the server has it. `allow`: it waits for the person's press, which makes the server a
   * login of its own. `switched`: the server has another account of this one's, which the
   * person no longer is here: the press makes this one's. `failed`: it did not get there.
   */
  state: 'there' | 'allow' | 'switched' | 'failed'
  /** Its login is made anew for the server, with the person's press: taken off there, it stays off until that press. */
  anew?: true
  /** `switched`: the account the server has. */
  was?: string
  error?: string
}

/** One of this computer's servers, and how its logins stand there. */
export interface ServerLogins {
  machineId: string
  label: string
  /** The person said the server uses this computer's logins. */
  on: boolean
  /** It answered when last asked. */
  reachable: boolean
  logins: LoginThere[]
  /** What the server has of this computer's that this computer no longer has: the person keeps it there, or takes it off. */
  left: { kind: CopiedKind; host?: string; source: string; name: string }[]
  /** The press under way: the login being made, and the page it signs in at. */
  allowing?: { name: string; url?: string }
  /** Why the last press stopped. */
  failed?: string
}

/** What the sync reaches for, swapped in tests. */
export const syncWiring: {
  /** The environment the daemon was started with: whose saved machines, whose logins. */
  env: NodeJS.ProcessEnv
  machines: () => Promise<MachineRecord[]>
  /** Whether a machine is a server, and answers. */
  facts: (machine: MachineAccess) => Promise<{ server?: true; version?: string }>
  call: (machine: MachineAccess, fn: string, args: unknown[]) => Promise<{ ok: true; ret: unknown } | { ok: false; error: string }>
  /** This computer's own logins. */
  local: () => Promise<LocalLogin[]>
  /** How full each of this computer's accounts is, as its own page reads it. */
  usage: () => Promise<{ kind: CopiedKind; source: string; windows: UsageWindow[]; at: number }[]>
  /** This computer's settings. */
  preferences: () => Promise<Preferences>
  mint: Mint
  loginCodex: (opts: CodexLoginOptions) => Promise<CodexLogin>
  computer: () => string
} = {
  env: process.env,
  machines: () => listMachines(undefined, syncWiring.env),
  facts: machine => remoteFacts(machine),
  call: (machine, fn, args) => machineCall(machine, fn, args),
  local: () => localLogins(syncWiring.env),
  usage: ownUsage,
  preferences: () => readPreferences(undefined, syncWiring.env),
  mint: mintClaude,
  loginCodex,
  computer: computerName,
}

/** The person's own Claude login here, as Claude Code keeps who it is: none when it is logged in to no account. */
export function claudeOwnAccount(env: NodeJS.ProcessEnv = process.env): { name: string; who: string } | undefined {
  try {
    const account = (JSON.parse(readFileSync(join(env['CLAUDE_CONFIG_DIR'] ?? env['HOME'] ?? homedir(), '.claude.json'), 'utf8')) as { oauthAccount?: Record<string, unknown> }).oauthAccount
    const who = [account?.['accountUuid'], account?.['emailAddress']].find((value): value is string => typeof value === 'string' && value.trim() !== '')
    if (who === undefined) return undefined
    const name = [account?.['displayName'], account?.['emailAddress']].find((value): value is string => typeof value === 'string' && value.trim() !== '')
    return { name: name?.trim() ?? 'Claude', who }
  } catch {
    return undefined
  }
}

/** The git hosts this computer's runs work with, with the accounts their tools know, as Settings shows them. */
async function gitHostAccounts(): Promise<{ host: string; accounts: { login: string; runs: boolean; ok: boolean }[] }[]> {
  return (await onGitHosts()).hosts.flatMap(row => (row.provider ? [{ host: row.host, accounts: row.provider.accounts }] : []))
}

/** An account's token at a git host, as its package hands it out. */
async function gitToken(host: string, login: string): Promise<string> {
  const said = await gitHostPackages.run(host, ['token', '--user', login])
  if (!said.ok) throw new Error(said.error)
  const token = (said.output as { token?: unknown } | null)?.token
  if (typeof token !== 'string' || !token) throw new Error(`${host} gave no token for ${login}`)
  return token
}

/**
 * How full each of this computer's Claude accounts is, as its own page reads it: what a server's
 * page shows of them, where a login made for the server cannot read it. A server reads Codex's itself.
 */
async function ownUsage(): Promise<{ kind: CopiedKind; source: string; windows: UsageWindow[]; at: number }[]> {
  const view = await onAgentAccounts('claude')
  return view.accounts.filter(row => row.windows.length > 0).map(row => ({ kind: 'claude', source: row.own ? 'own' : row.id, windows: row.windows, at: row.asOf ?? view.now }))
}

/** Every account this computer is logged in to: its coding agents' and its git hosts'. */
export async function localLogins(env: NodeJS.ProcessEnv = process.env): Promise<LocalLogin[]> {
  const logins: LocalLogin[] = []
  for (const account of readAccounts(claudeAccountsPath(env))) {
    if (account.login === undefined) {
      const own = claudeOwnAccount(env)
      if (own) logins.push({ kind: 'claude', source: 'own', name: account.name === OWN_NAME ? own.name : account.name, who: own.who })
    } else {
      const login = account.login
      logins.push({ kind: 'claude', source: account.name, name: account.name, who: markOf(login), secret: async () => login })
    }
  }
  for (const account of readAccounts(codexAccountsPath(env))) {
    const own = account.login === undefined
    const who: CodexWho = await codexWho(own ? personalCodexHome(env) : accountFolder(account, env)).catch(() => ({}))
    if (who.key === undefined) continue
    logins.push({ kind: 'codex', source: own ? 'own' : account.name, name: own && account.name === OWN_NAME ? (who.name ?? 'Codex') : account.name, who: who.key })
  }
  for (const { host, accounts } of await gitHostAccounts().catch(() => [])) {
    for (const account of accounts) {
      if (!account.ok) continue
      logins.push({ kind: 'git', host, source: account.login, name: account.login, who: account.login, runs: account.runs, secret: () => gitToken(host, account.login) })
    }
  }
  return logins
}

/** The same account of this computer's, here and there. */
const same = (a: { kind: CopiedKind; host?: string; source: string }, b: { kind: CopiedKind; host?: string; source: string }): boolean => a.kind === b.kind && (a.host ?? '') === (b.host ?? '') && a.source === b.source

/** What a server says it keeps, as far as it reads as such: it is another computer's data. */
function readThere(ret: unknown): CopiedLogin[] | string {
  const { ok, logins, error } = (ret && typeof ret === 'object' ? ret : {}) as Record<string, unknown>
  if (ok !== true) return typeof error === 'string' ? error : 'The server answered something else than its logins.'
  if (!Array.isArray(logins)) return []
  return logins.flatMap(entry => {
    const { kind, host, source, name, who, from, kept } = (entry ?? {}) as Record<string, unknown>
    if (!isKind(kind) || !isWord(source) || !isWord(name) || !isWord(who) || !isWord(from)) return []
    return [{ kind, ...(isWord(host) ? { host } : {}), source, name, who, from, ...(kept === true ? { kept: true as const } : {}) }]
  })
}

/** What a call to the server came to: done, or why not in its words. */
function outcome(said: { ok: true; ret: unknown } | { ok: false; error: string }): { ok: true } | { ok: false; error: string } {
  if (!said.ok) return said
  const { ok, error } = (said.ret && typeof said.ret === 'object' ? said.ret : {}) as Record<string, unknown>
  return ok === true ? { ok: true } : { ok: false, error: typeof error === 'string' ? error : 'The server answered something else than expected.' }
}

const access = (machine: MachineRecord): MachineAccess => ({ url: machine.url, key: machine.key, ...(machine.pin ? { pin: machine.pin } : {}) })

/** The servers as last read, by machine, and the press under way on one. */
const last = new Map<string, ServerLogins>()
const allowing = new Map<string, { name: string; url?: string }>()
const pressFailed = new Map<string, string>()

/**
 * Bring one server's logins up to this computer's: what can go as it is is handed over when the
 * server lacks it or has another; how full each account is goes with it. Answers how they stand.
 */
async function syncServer(machine: MachineRecord, local: LocalLogin[], usage: Awaited<ReturnType<typeof syncWiring.usage>>): Promise<ServerLogins> {
  const base = { machineId: machine.id, label: machine.label, on: machine.logins === true, ...(allowing.get(machine.id) ? { allowing: allowing.get(machine.id)! } : {}), ...(pressFailed.has(machine.id) ? { failed: pressFailed.get(machine.id)! } : {}) }
  const unreached: ServerLogins = { ...base, reachable: false, logins: [], left: [] }
  if (!machine.logins) return { ...base, reachable: true, logins: [], left: [] }
  const said = await syncWiring.call(access(machine), 'onCopiedLogins', [])
  if (!said.ok) return unreached
  const there = readThere(said.ret)
  if (typeof there === 'string') return { ...unreached, reachable: true, failed: there }
  const me = syncWiring.computer()
  const mine = there.filter(login => login.from === me && !login.kept)
  const logins: LoginThere[] = []
  for (const login of local) {
    const has = mine.find(other => same(other, login))
    const row = { kind: login.kind, ...(login.host !== undefined ? { host: login.host } : {}), source: login.source, name: login.name, ...(login.secret ? {} : { anew: true as const }) }
    if (has?.who === login.who) {
      logins.push({ ...row, state: 'there' })
      continue
    }
    if (!login.secret) {
      logins.push({ ...row, state: has ? 'switched' : 'allow', ...(has ? { was: has.name } : {}) })
      continue
    }
    const secret = await login.secret().then(
      (value): { ok: true; value: string } => ({ ok: true, value }),
      (err: unknown): { ok: false; error: string } => ({ ok: false, error: err instanceof Error ? err.message : String(err) }),
    )
    const given = secret.ok ? await hand(machine, login, secret.value) : secret
    logins.push(given.ok ? { ...row, state: 'there' } : { ...row, state: 'failed', error: given.error })
  }
  const left = mine.filter(login => !local.some(other => same(other, login))).map(({ kind, host, source, name }) => ({ kind, ...(host !== undefined ? { host } : {}), source, name }))
  const readings = usage.filter(reading => logins.some(login => login.state === 'there' && login.kind === reading.kind && login.source === reading.source))
  if (readings.length > 0) await syncWiring.call(access(machine), 'sendCopiedUsage', [readings])
  await followSettings(machine)
  return { ...base, reachable: true, logins, left }
}

/**
 * The settings that are the person's wherever they open OpenAgent: how it looks, what it tells
 * them, what a run starts with. Never this computer's own: its editor, its browser bridge, where
 * its projects' runs start from.
 */
const FOLLOWING = ['theme', 'notifyBrowser', 'notifyNewActivity', 'notifyHumanIntervention', 'driver', 'model', 'effort', 'publish', 'postMergeCleanup', 'nameRuns', 'showThinking', 'recentsSort', 'customPresets', 'onboardingDismissed', 'overviewLayouts'] as const satisfies readonly (keyof Preferences)[]

type Followed = Pick<Preferences, (typeof FOLLOWING)[number]>

/** Where the settings each server was last sent are kept: beside OpenAgent's other files. */
function sentPath(): string {
  const env = syncWiring.env
  return env['XDG_CONFIG_HOME'] ? join(env['XDG_CONFIG_HOME'], 'openagent-sent-settings.json') : join(env['HOME'] ?? homedir(), '.openagent-sent-settings.json')
}

function readSent(): Record<string, Followed> {
  try {
    const sent = JSON.parse(readFileSync(sentPath(), 'utf8')) as unknown
    return sent && typeof sent === 'object' && !Array.isArray(sent) ? (sent as Record<string, Followed>) : {}
  } catch {
    return {}
  }
}

function writeSent(sent: Record<string, Followed>): void {
  const path = sentPath()
  mkdirSync(dirname(path), { recursive: true })
  const next = `${path}.${process.pid}.new`
  writeFileSync(next, `${JSON.stringify(sent, null, 2)}\n`, { mode: 0o600 })
  chmodSync(next, 0o600)
  renameSync(next, path)
}

/**
 * Send a server the settings changed here since it was last sent them, and only those: one the
 * person changed on the server's own page stays there until the same one changes here. One no
 * longer set here is emptied there; a switch left unset keeps what it is.
 */
async function followSettings(machine: MachineRecord): Promise<void> {
  const now = await syncWiring.preferences().catch(() => undefined)
  if (!now) return
  const mine: Followed = Object.fromEntries(FOLLOWING.flatMap(key => (now[key] !== undefined ? [[key, now[key]]] : [])))
  const sent = readSent()
  const before = sent[machine.id]
  const patch: Record<string, unknown> = {}
  for (const key of FOLLOWING) {
    const value = mine[key]
    if (before !== undefined && JSON.stringify(value) === JSON.stringify(before[key])) continue
    if (value !== undefined) patch[key] = value
    else if (before?.[key] !== undefined && typeof before[key] !== 'boolean') patch[key] = Array.isArray(before[key]) ? [] : ''
  }
  if (Object.keys(patch).length === 0) {
    if (before === undefined) writeSent({ ...sent, [machine.id]: mine })
    return
  }
  if (outcome(await syncWiring.call(access(machine), 'patchPreferences', [patch])).ok) writeSent({ ...readSent(), [machine.id]: mine })
}

/** Hand one login to a server: what it is, and the login itself. */
async function hand(machine: MachineRecord, login: LocalLogin, secret: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const given: GivenLogin = { kind: login.kind, ...(login.host !== undefined ? { host: login.host } : {}), source: login.source, name: login.name, who: login.who, from: syncWiring.computer(), ...(login.runs ? { runs: true } : {}) }
  return outcome(await syncWiring.call(access(machine), 'sendCopiedLogin', [given, secret]))
}

/** Bring every server that uses this computer's logins up to them, and note how each stands; a saved machine that is no server of the person's is left out. */
export async function syncLogins(): Promise<ServerLogins[]> {
  const machines = (await syncWiring.machines()).filter(machine => machine.owner === undefined)
  const servers: ServerLogins[] = []
  let local: LocalLogin[] | undefined
  let usage: Awaited<ReturnType<typeof syncWiring.usage>> | undefined
  for (const machine of machines) {
    if (!(await syncWiring.facts(access(machine))).server) {
      last.delete(machine.id)
      continue
    }
    local ??= await syncWiring.local()
    usage ??= machine.logins ? await syncWiring.usage().catch(() => []) : undefined
    const server = await syncServer(machine, local, usage ?? [])
    last.set(machine.id, server)
    servers.push(server)
  }
  for (const id of last.keys()) if (!machines.some(machine => machine.id === id)) last.delete(id)
  return servers
}

/** The servers as last read, with the press under way on each: read anew when none were read yet. */
export async function serverLogins(): Promise<ServerLogins[]> {
  if (last.size === 0) await syncLogins()
  return [...last.values()].map(server => {
    const press = allowing.get(server.machineId)
    const failed = pressFailed.get(server.machineId)
    const { allowing: _was, failed: _old, ...rest } = server
    return { ...rest, ...(press ? { allowing: press } : {}), ...(failed !== undefined ? { failed } : {}) }
  })
}

/** Make the server a login of its own for one account of this computer's: in this computer's browser, with the person's press. */
async function makeFor(machine: MachineRecord, login: LocalLogin): Promise<{ ok: true } | { ok: false; error: string }> {
  const press = (url?: string): void => void allowing.set(machine.id, { name: login.name, ...(url !== undefined ? { url } : {}) })
  press()
  if (login.kind === 'claude') {
    const minted = await syncWiring.mint()
    if (!minted.ok) return minted
    return hand(machine, login, minted.login)
  }
  const dir = await mkdtemp(join(tmpdir(), 'openagent-codex-'))
  try {
    const signed = await syncWiring.loginCodex({ dir, onUrl: url => press(url) })
    if (!signed.ok) return signed
    if (signed.who.key !== login.who) return { ok: false, error: `The browser signed in to ${signed.who.name ?? 'another account'}, not ${login.name}. Copy the link into a private window, and sign in to ${login.name} there.` }
    return hand(machine, login, await readFile(join(dir, signed.login, 'auth.json'), 'utf8'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/**
 * The person's press for a server: each of this computer's accounts that waits for it gets a
 * login of the server's own, made in this computer's browser, one after the other. Answers at
 * once; how it goes is in {@link serverLogins}.
 */
export async function allowLogins(machineId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const machine = (await syncWiring.machines()).find(saved => saved.id === machineId)
  if (!machine?.logins) return { ok: false, error: 'That server does not use this computer\'s logins.' }
  if (allowing.has(machineId)) return { ok: false, error: 'Logins are being made for it: finish in the browser, or wait for it to end.' }
  const waiting = (last.get(machineId)?.logins ?? []).filter(login => login.state === 'allow' || login.state === 'switched')
  const local = (await syncWiring.local()).filter(login => waiting.some(w => same(w, login)))
  if (local.length === 0) return { ok: true }
  pressFailed.delete(machineId)
  allowing.set(machineId, { name: local[0]!.name })
  void (async () => {
    try {
      for (const login of local) {
        const made = await makeFor(machine, login)
        if (!made.ok) {
          pressFailed.set(machineId, `${login.name}: ${made.error}`)
          break
        }
      }
    } catch (err) {
      pressFailed.set(machineId, err instanceof Error ? err.message : String(err))
    } finally {
      allowing.delete(machineId)
      await syncLogins().catch(() => [])
    }
  })()
  return { ok: true }
}

/** Keep, or take off, a login the server has of this computer's that this computer no longer has. */
// A login the server still has of this computer's is taken off the same way: one made anew with a
// press then waits for it, as one the server never had.
export async function settleLeft(machineId: string, which: { kind: CopiedKind; host?: string; source: string }, keep: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const machine = (await syncWiring.machines()).find(saved => saved.id === machineId)
  if (!machine) return { ok: false, error: 'That server is no longer saved.' }
  const done = outcome(await syncWiring.call(access(machine), keep ? 'sendKeepCopiedLogin' : 'sendForgetCopiedLogin', [{ kind: which.kind, ...(which.host !== undefined ? { host: which.host } : {}), source: which.source }]))
  await syncLogins().catch(() => [])
  return done
}

/** How often the servers are brought up to this computer's logins. */
const EVERY_MS = 60_000

/** Keep every server that uses this computer's logins up to them, from now on: a minute apart, the first a moment after the start. */
export function startLoginsSync(env: NodeJS.ProcessEnv): () => void {
  syncWiring.env = env
  let stopped = false
  const run = (): void => void syncLogins().catch(() => [])
  const first = setTimeout(run, 5_000)
  const timer = setInterval(() => !stopped && run(), EVERY_MS)
  first.unref()
  timer.unref()
  return () => {
    stopped = true
    clearTimeout(first)
    clearInterval(timer)
  }
}
