import { spawn as nodeSpawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmod, lstat, mkdir, readFile, readlink, rm, symlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { accountsPath, type AgentAccount, type DriverRateWindow } from '@openagt/agent-driver'
import { askCodex, askOnce, type AskOptions } from './codex-ask.js'
import { prepareCodexHome } from './codex.js'

// The Codex accounts runs may use (`accounts.ts` in the driver core keeps the list): the person's
// own login, in their own Codex home, and the ones added beside it. Codex keeps a login and the
// conversations in one home, so an added account is a folder of OpenAgent's own holding that
// account's login, where Codex renews it, and a turn on it runs from a home that has that login and
// links to the conversations of the home the person's own login runs from: a conversation one
// account started, the next goes on with. The person's own Codex home is never written.

/** Where the Codex accounts are kept: `$XDG_CONFIG_HOME/openagent-codex-accounts.json`, else dotted under the home. */
export function codexAccountsPath(env: NodeJS.ProcessEnv = process.env): string {
  return accountsPath('codex', env)
}

/** The folder added accounts' logins are kept in, one folder each: `$XDG_STATE_HOME/agent-driver/codex-accounts`, or under `~/.local/state`. */
export function codexAccountsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(env['XDG_STATE_HOME'] || join(env['HOME'] || homedir(), '.local', 'state'), 'agent-driver', 'codex-accounts')
}

/** An added account's folder, where its login is: the list names it by {@link AgentAccount.login}. */
export function accountFolder(account: AgentAccount, env: NodeJS.ProcessEnv = process.env): string {
  if (account.login === undefined || !/^[\w-]+$/.test(account.login)) throw new Error(`${account.name} is not an added Codex account`)
  return join(codexAccountsDir(env), account.login)
}

/** What a home shares with the one the person's own login runs from: the conversations, always. Never Codex's databases: their journals would land beside the link. */
const CONVERSATIONS = ['sessions', 'archived_sessions']
/** And, when the run loads the person's own setup, that setup. */
const SETUP = ['config.toml', 'AGENTS.md', 'AGENTS.override.md', 'skills', 'rules', 'prompts']

/**
 * The Codex home a turn on an added account runs from: the account's login, and links to what
 * `base` has: its conversations, and with `setup`, the person's own setup too. `base` is the home
 * the person's own login runs from, so a conversation goes on whichever account takes the turn. A
 * home of each kind per account, so two runs on one account never undo each other's links.
 */
export async function accountHome(folder: string, base: string, setup: boolean): Promise<string> {
  const home = join(folder, setup ? 'home' : 'plain')
  await prepareCodexHome(home, folder)
  for (const dir of CONVERSATIONS) await mkdir(join(base, dir), { recursive: true })
  for (const name of [...CONVERSATIONS, ...(setup ? SETUP : [])]) {
    const target = join(base, name)
    if (!(await lstat(target).catch(() => undefined))) continue
    const link = join(home, name)
    const found = await lstat(link).catch(() => undefined)
    if (found?.isSymbolicLink() && (await readlink(link)) === target) continue
    // Something of Codex's own in its place is never thrown away: a home that kept a part for itself keeps it.
    if (found && !found.isSymbolicLink()) continue
    if (found) await rm(link, { force: true })
    await symlink(target, link).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'EEXIST') throw err
    })
  }
  return home
}

/** Who a Codex home is logged in as, as its login says: a name to show, and what tells two logins apart. */
export interface CodexWho {
  /** The person's name, else their email. */
  name?: string
  /** The person and the workspace together: the same in two homes is the same account. */
  key?: string
}

/** Who the login in `home` is, read off the file Codex keeps it in. Nothing when there is none. */
export async function codexWho(home: string): Promise<CodexWho> {
  try {
    const auth = JSON.parse(await readFile(join(home, 'auth.json'), 'utf8')) as { tokens?: { id_token?: unknown } }
    const token = auth.tokens?.id_token
    if (typeof token !== 'string') return {}
    const part = token.split('.')[1]
    if (part === undefined) return {}
    const claims = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>
    const openai = (claims['https://api.openai.com/auth'] ?? {}) as Record<string, unknown>
    const name = [claims['name'], claims['email']].find((value): value is string => typeof value === 'string' && value.trim() !== '')
    const user = openai['chatgpt_user_id'] ?? claims['sub']
    const workspace = openai['chatgpt_account_id']
    return { ...(name !== undefined ? { name: name.trim() } : {}), ...(typeof user === 'string' ? { key: `${user}/${typeof workspace === 'string' ? workspace : ''}` } : {}) }
  } catch {
    return {}
  }
}

/** Codex's windows by how long they last, under the names Claude's rate-limit lines give the same ones. */
function windowName(minutes: number | undefined): string {
  if (minutes === 300) return 'five_hour'
  if (minutes === 7 * 24 * 60) return 'seven_day'
  if (minutes === 30 * 24 * 60) return 'thirty_day'
  return minutes === undefined ? 'unknown' : `${minutes}_min`
}

/** A Codex rate-limit reading (`account/rateLimits/read`'s `rateLimits`, or the notification's) as windows. */
export function codexWindows(snapshot: unknown): DriverRateWindow[] {
  if (typeof snapshot !== 'object' || snapshot === null) return []
  const reading = snapshot as Record<string, unknown>
  const windows: DriverRateWindow[] = []
  for (const key of ['primary', 'secondary']) {
    const window = reading[key] as Record<string, unknown> | null | undefined
    const used = window?.['usedPercent']
    const resets = window?.['resetsAt']
    if (typeof used !== 'number' || typeof resets !== 'number') continue
    const minutes = window?.['windowDurationMins']
    windows.push({ window: windowName(typeof minutes === 'number' ? minutes : undefined), percentUsed: Math.max(0, Math.min(100, used)), resetsAt: resets * 1000 })
  }
  return windows
}

/** How full the account logged in at `home` is, now: one short-lived app server, asked once. */
export async function readCodexUsage(opts: AskOptions & { timeoutMs?: number }): Promise<DriverRateWindow[]> {
  const answer = await askOnce(opts, 'account/rateLimits/read', null)
  return codexWindows(answer['rateLimits'])
}

/** How an account is logged in: the browser asked, the person says yes, the login is kept. */
export interface CodexLoginOptions {
  /** Where the account's folder is made. Default {@link codexAccountsDir}. */
  dir?: string
  /** Told the page to sign in at, once Codex gives it: what the browser is opened on, and what a person may copy into a private window. */
  onUrl?: (url: string) => void
  /** Opens the page in this computer's browser. Default the system's opener. */
  open?: (url: string) => void
  signal?: AbortSignal
  /** How long the person has to sign in. */
  timeoutMs?: number
  bin?: string
  env?: NodeJS.ProcessEnv
  spawn?: AskOptions['spawn']
}

export type CodexLogin = { ok: true; login: string; who: CodexWho } | { ok: false; error: string }

const LOGIN_TIMEOUT_MS = 10 * 60_000

/**
 * Log a new account in, in a folder of its own: Codex's own sign-in, in this computer's browser,
 * as `codex login` does it. Answers with the folder's name, the account's login for the list, and
 * who signed in. A login that does not go through leaves no folder behind.
 */
export async function loginCodex(opts: CodexLoginOptions = {}): Promise<CodexLogin> {
  const env = opts.env ?? process.env
  const login = `codex-${randomBytes(6).toString('hex')}`
  const folder = join(opts.dir ?? codexAccountsDir(env), login)
  await mkdir(folder, { recursive: true, mode: 0o700 })
  await chmod(folder, 0o700)
  const failed = async (error: string): Promise<CodexLogin> => {
    await rm(folder, { recursive: true, force: true })
    return { ok: false, error }
  }
  let server: Awaited<ReturnType<typeof askCodex>>
  try {
    server = await askCodex({ home: folder, env, ...(opts.bin !== undefined ? { bin: opts.bin } : {}), ...(opts.spawn !== undefined ? { spawn: opts.spawn } : {}) })
  } catch (err) {
    return failed(err instanceof Error ? err.message : String(err))
  }
  let timer: NodeJS.Timeout | undefined
  const stop = (): void => server.close()
  try {
    const done = new Promise<{ success: boolean; error?: string }>(resolve => {
      server.onNotification((method, params) => {
        if (method !== 'account/login/completed') return
        resolve({ success: params['success'] === true, ...(typeof params['error'] === 'string' ? { error: params['error'] } : {}) })
      })
      timer = setTimeout(() => resolve({ success: false, error: `Nobody signed in within ${Math.round((opts.timeoutMs ?? LOGIN_TIMEOUT_MS) / 60_000)} minutes.` }), opts.timeoutMs ?? LOGIN_TIMEOUT_MS)
      opts.signal?.addEventListener('abort', () => resolve({ success: false, error: 'The login was stopped.' }), { once: true })
      void server.gone.then(() => resolve({ success: false, error: 'Codex ended before anyone signed in.' }))
    })
    const started = await server.request('account/login/start', { type: 'chatgpt' })
    const url = started['authUrl']
    if (typeof url !== 'string') return await failed('Codex gave no page to sign in at.')
    opts.onUrl?.(url)
    ;(opts.open ?? openInBrowser)(url)
    const result = await done
    if (!result.success) return await failed(result.error ?? 'The sign-in did not go through.')
    return { ok: true, login, who: await codexWho(folder) }
  } catch (err) {
    return await failed(err instanceof Error ? err.message : String(err))
  } finally {
    clearTimeout(timer)
    stop()
    await server.gone
  }
}

/** This computer's browser, opened on `url`. */
function openInBrowser(url: string): void {
  const [command, ...args] = process.platform === 'darwin' ? ['open', url] : process.platform === 'win32' ? ['cmd', '/c', 'start', '', url] : ['xdg-open', url]
  nodeSpawn(command!, args, { stdio: 'ignore', detached: true })
    .on('error', () => {})
    .unref()
}
