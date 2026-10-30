import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { nodeGitRunner, runPackageCommand, type ProvidedCommand } from '@openagt/agent-data'
import type { DriverFix, DriverReadiness } from '@openagt/agent-driver'
import { claudeCodeReady } from '@openagt/agent-driver-claude'
import { codexReady } from '@openagt/agent-driver-codex'
import { readProjectAccounts, writeProjectAccounts } from '@openagt/agent-runner'
import { providedCommand } from '../built-in.js'
import { isDriverName, type DriverName } from '../driver-names.js'
import { readPreferences } from '../registry.js'
import { accountsWiring, onAgentAccounts, type AccountResult, type AccountsAgent } from './accounts.js'
import { contextProjects, resolveProjectPath } from './context.js'
import { readProvider, remoteHost, type GitHostProvider } from '../dashboard/git-hosts.js'
import { readCopied } from '../dashboard/copied-logins.js'
import { syncLogins } from '../dashboard/logins-sync.js'
import { hasAddedAccount } from '@openagt/skill-account-rotation'

export type { GitHostAccount, GitHostProvider } from '../dashboard/git-hosts.js'

// What runs log in with, and what is missing for them to: the coding agent's CLI (installed,
// logged in), and each git host the projects' remotes are on, as the git host's own package
// answers for it (`<command> accounts`): its name, its word for a pull request, the accounts its
// tool knows and the one runs use. OpenAgent names no git host: a host no package answers for is
// a host with no package. A press that fixes something runs a command the package declared, never
// one a page sent.

/** One host the projects' remotes are on: which projects, and its package's answer, or none when no package answers for it. */
export interface GitHostRow {
  host: string
  /** The projects whose remote is there, by name. */
  projects: string[]
  provider?: GitHostProvider
}

export interface GitHostsView {
  hosts: GitHostRow[]
}

/** What the RPCs reach for, swapped in tests. */
export const loginsWiring: {
  /** The origin remote's address of the project at `root`. */
  origin: (root: string) => Promise<string | undefined>
  /** The project's git host package's command. */
  gitHost: (root: string) => Promise<ProvidedCommand | undefined>
  run: typeof runPackageCommand
  /** Where a git host's package is asked when no project is on its host: the person's home folder. */
  home: () => string
  ready: (driver: DriverName) => Promise<DriverReadiness>
  /** Run a fix's command to its end; rejects with its last lines. */
  fix: (command: string) => Promise<void>
  driver: () => Promise<DriverName>
} = {
  origin: root =>
    nodeGitRunner()(['remote', 'get-url', 'origin'], root).then(
      url => url.trim() || undefined,
      () => undefined,
    ),
  gitHost: root => providedCommand(root, 'git-host').catch(() => undefined),
  run: runPackageCommand,
  home: () => homedir(),
  ready: driver => (driver === 'codex' ? codexReady({ addedAccount: hasAddedAccount('codex') }) : claudeCodeReady({ addedAccount: hasAddedAccount('claude') })),
  fix: runFix,
  driver: async () => {
    const picked = (await readPreferences().catch(() => ({}) as { driver?: string })).driver
    return picked !== undefined && isDriverName(picked) ? picked : 'claude-code'
  },
}

/** Where each host was last found: a project there, and its package's command, for a press on its card. */
const found = new Map<string, { root: string; command: ProvidedCommand }>()

async function askProvider(host: string, root: string, command: ProvidedCommand): Promise<GitHostProvider | undefined> {
  const result = await loginsWiring.run(root, command, ['accounts', '--host', host])
  return result.ok ? readProvider(result.output) : undefined
}

/**
 * The hosts as last read, and the read under way: a git host's tool asks its host who is logged
 * in (GitHub's takes most of a second), so a page is answered at once with the last answer while
 * the hosts are read again behind it, and sees that one at its next ask.
 */
let lastHosts: { projects: string; view: GitHostsView } | undefined
let readingHosts: Promise<GitHostsView> | undefined

/**
 * The hosts the projects' remotes are on, in the projects' order, each with its package's answer:
 * the last answer when there is one for the same projects, the hosts being read again behind it.
 */
export async function onGitHosts(): Promise<GitHostsView> {
  const projects = (await contextProjects().list()).map(project => project.path).join('\n')
  const reading = (readingHosts ??= readGitHosts()
    .then(view => ((lastHosts = { projects, view }), view))
    .finally(() => (readingHosts = undefined)))
  if (lastHosts?.projects !== projects) return reading
  // Its answer is for the next ask; a read that failed leaves the last answer standing.
  reading.catch(() => undefined)
  return lastHosts.view
}

/**
 * The hosts the projects' remotes are on, in the projects' order, each with its package's answer,
 * then the host of the git host package OpenAgent brings, when no project is on it: a person logs
 * in there before a project is. A project with no remote is on none.
 */
async function readGitHosts(): Promise<GitHostsView> {
  const projects = await contextProjects().list()
  const byHost = new Map<string, { roots: string[]; names: string[] }>()
  for (const project of projects) {
    const remote = await loginsWiring.origin(project.path)
    const host = remote !== undefined ? remoteHost(remote) : undefined
    if (host === undefined) continue
    const row = byHost.get(host) ?? { roots: [], names: [] }
    row.roots.push(project.path)
    row.names.push(project.name)
    byHost.set(host, row)
  }
  const hosts: GitHostRow[] = []
  for (const [host, { roots, names }] of byHost) {
    let provider: GitHostProvider | undefined
    for (const root of roots) {
      const command = await loginsWiring.gitHost(root)
      provider = command ? await askProvider(host, root, command) : undefined
      if (provider && command) {
        found.set(host, { root, command })
        break
      }
    }
    if (!provider) found.delete(host)
    hosts.push({ host, projects: names, ...(provider ? { provider } : {}) })
  }
  const home = loginsWiring.home()
  const command = await loginsWiring.gitHost(home)
  const said = command ? await loginsWiring.run(home, command, ['accounts']) : undefined
  const host = said?.ok ? (said.output as { host?: unknown } | null)?.host : undefined
  const provider = said?.ok ? readProvider(said.output) : undefined
  if (command && provider && typeof host === 'string' && !byHost.has(host)) {
    found.set(host, { root: home, command })
    hosts.push({ host, projects: [], provider })
  }
  return { hosts: hosts.map(row => withCopies(row)) }
}

/** A host's accounts, each that a computer of the person's handed over saying which: on a server, the person's own computers' logins. */
function withCopies(row: GitHostRow): GitHostRow {
  if (!row.provider) return row
  const copies = readCopied().filter(login => login.kind === 'git' && login.host === row.host)
  if (copies.length === 0) return row
  const fromOf = (login: string): string | undefined => copies.find(copy => copy.name.toLowerCase() === login.toLowerCase())?.from
  return { ...row, provider: { ...row.provider, accounts: row.provider.accounts.map(account => ({ ...account, ...(fromOf(account.login) !== undefined ? { from: fromOf(account.login)! } : {}) })) } }
}

/**
 * A git host's package command for `host`, run where the host was last found, with `input` on its
 * standard input. An object, not a function: what the RPC table is built of are this module's
 * functions, and this is no call a page makes.
 */
export const gitHostPackages = {
  async run(host: string, args: string[], input?: string): Promise<{ ok: true; output: unknown } | { ok: false; error: string }> {
    const at = await providerOf(host)
    if (!at) return { ok: false, error: `No package answers for ${host}.` }
    const done = await loginsWiring.run(at.root, at.command, args, undefined, input)
    lastHosts = undefined
    return done
  },
}

/** The package of `host`, as last found, else found now. */
async function providerOf(host: string): Promise<{ root: string; command: ProvidedCommand } | undefined> {
  if (!found.has(host)) await readGitHosts()
  return found.get(host)
}

async function act(host: string, args: string[]): Promise<{ ok: true; output: unknown } | { ok: false; error: string }> {
  const at = await providerOf(host)
  if (!at) return { ok: false, error: `No package answers for ${host}.` }
  const done = await loginsWiring.run(at.root, at.command, args)
  // A press changed what the host's card says: the page reads it again, and waits for the change.
  lastHosts = undefined
  return done
}

/** Runs use `login` at `host` from now on; the terminal's own account stays as it is. */
export async function sendUseGitHostAccount(host: string, login: string): Promise<AccountResult> {
  const done = await act(host, ['use', login])
  return done.ok ? { ok: true } : done
}

/**
 * Take an account off at `host`, on this computer: its tool forgets it, and its token goes on
 * working wherever else it is. The account runs use is not taken off: another is picked first.
 * The servers that use this computer's logins are asked again at once, so what they said of it
 * goes with it.
 */
export async function sendForgetGitHostAccount(host: string, login: string): Promise<AccountResult> {
  const runs = (await onGitHosts()).hosts.find(row => row.host === host)?.provider?.accounts.find(account => account.runs)
  if (runs?.login === login) return { ok: false, error: `Runs use @${login}: pick another account for runs first.` }
  const done = await act(host, ['forget', login])
  if (!done.ok) return done
  await syncLogins().catch(() => [])
  return { ok: true }
}

/** Log another account in at `host`, in the browser: the code the person types, and where. */
export async function sendGitHostLogin(host: string): Promise<{ ok: true; code: string; url: string } | { ok: false; error: string }> {
  const done = await act(host, ['login'])
  if (!done.ok) return done
  const said = done.output as { code?: unknown; url?: unknown } | null
  return typeof said?.code === 'string' && typeof said.url === 'string' && said.url.startsWith('https://') ? { ok: true, code: said.code, url: said.url } : { ok: false, error: 'The package gave no code to log in with.' }
}

/** Install the tool `host`'s package works through, with the command it declared; the card follows it. */
export async function sendGitHostInstall(host: string): Promise<AccountResult> {
  const done = await act(host, ['install'])
  return done.ok ? { ok: true } : done
}

/** How the coding agent's CLI is on this computer, and what a press does about what is missing. */
export interface AgentState {
  driver: DriverName
  /** Installed and logged in, or it could not say otherwise. */
  ready: boolean
  /** What is in the way, in words. */
  problem?: string
  /** What a press does about it, when the agent's package declared a command for it. */
  fix?: DriverFix
  /** The agent's own login is out, and runs use an added account: the own login is no account to show. */
  ownLoggedOut?: true
  /** A press's fix going on. */
  fixing?: DriverFix['kind']
  /** Why the last press's fix failed. */
  failed?: string
}

/** The fixes under way and the last one that failed, by agent. */
const fixes = new Map<DriverName, { fixing?: DriverFix['kind']; failed?: string }>()

/** The coding agent picked in Settings, or `driver`: installed, logged in, and what a press fixes. */
export async function onAgentState(driver?: string): Promise<AgentState> {
  const name = driver !== undefined && isDriverName(driver) ? driver : await loginsWiring.driver()
  const ready = await loginsWiring.ready(name)
  const press = fixes.get(name)
  // A computer with no browser cannot log its agent in by a press: the person adds an account in its card instead.
  const fix = ready.fix && !(ready.fix.kind === 'log-in' && accountsWiring.headless()) ? ready.fix : undefined
  return {
    driver: name,
    ready: ready.problems.length === 0,
    ...(ready.problems[0] !== undefined ? { problem: ready.problems[0] } : {}),
    ...(fix ? { fix } : {}),
    ...(ready.ownLoggedOut ? { ownLoggedOut: true as const } : {}),
    ...(press?.fixing ? { fixing: press.fixing } : {}),
    ...(press?.failed !== undefined && ready.problems.length > 0 ? { failed: press.failed } : {}),
  }
}

/**
 * Fix what is in the way of `driver`: the command its package declared for it, run here, the
 * install to its end, the login until the browser said yes. Answers at once; the page follows it
 * in {@link onAgentState}.
 */
export async function sendAgentFix(driver: string): Promise<AccountResult> {
  if (!isDriverName(driver)) return { ok: false, error: `No coding agent ${driver}.` }
  if (fixes.get(driver)?.fixing) return { ok: false, error: 'It is being fixed: wait for it to end.' }
  const fix = (await loginsWiring.ready(driver)).fix
  if (!fix) return { ok: false, error: 'Nothing to fix by a press: see the line it says.' }
  fixes.set(driver, { fixing: fix.kind })
  void loginsWiring
    .fix(fix.command)
    .then(
      () => fixes.delete(driver),
      (err: unknown) => fixes.set(driver, { failed: err instanceof Error ? err.message : String(err) }),
    )
  return { ok: true }
}

/** How long a fix may take: an install's download, or the person's yes in the browser. */
const FIX_MS = 10 * 60_000

/** A fix's command in a shell, to its end, its own group ended with it on a timeout. */
function runFix(command: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('sh', ['-c', command], { stdio: ['ignore', 'pipe', 'pipe'], detached: true })
    let said = ''
    const keep = (chunk: Buffer): void => {
      said = (said + chunk.toString('utf8')).slice(-4096)
    }
    child.stdout.on('data', keep)
    child.stderr.on('data', keep)
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid!, 'SIGKILL')
      } catch {
        // Gone already.
      }
    }, FIX_MS)
    child.once('error', err => (clearTimeout(timer), reject(err)))
    child.once('close', code => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(said.trim().split('\n').slice(-3).join('\n') || (code === null ? 'It took too long, and was stopped.' : `It ended with ${code}.`)))
    })
  })
}

/** A project's own accounts, beside the computer's: shown for a kind the computer has two or more of, or that the project names already. */
export interface ProjectAccountsView {
  gitHost?: {
    host: string
    name: string
    /** The host's word for a pull request. */
    requestWord: string
    accounts: string[]
    /** The computer's runs' account. */
    computer?: string
    /** The project's own, when it names one. */
    project?: string
  }
  claude?: ProjectAgentAccounts
  codex?: ProjectAgentAccounts
}

/** One agent's accounts a project may pick from, and its own few. */
export interface ProjectAgentAccounts {
  accounts: { id: string; name: string }[]
  /** The project's own few, by id, when it names some. */
  project?: string[]
}

export async function onProjectAccounts(projectId: string): Promise<ProjectAccountsView | null> {
  const root = await resolveProjectPath(projectId)
  if (!root) return null
  const own = await readProjectAccounts(root, () => {})
  const view: ProjectAccountsView = {}
  const remote = await loginsWiring.origin(root)
  const host = remote !== undefined ? remoteHost(remote) : undefined
  // The host's accounts as the Git hosts answer has them: asking its tool again takes most of a second.
  const provider = host !== undefined ? (await onGitHosts()).hosts.find(row => row.host === host)?.provider : undefined
  if (host !== undefined && provider && (provider.accounts.length >= 2 || own.gitHost !== undefined)) {
    const computer = provider.accounts.find(a => a.runs)?.login
    view.gitHost = { host, name: provider.name, requestWord: provider.requestWord, accounts: provider.accounts.map(a => a.login), ...(computer !== undefined ? { computer } : {}), ...(own.gitHost !== undefined ? { project: own.gitHost } : {}) }
  }
  for (const agent of ['claude', 'codex'] as const) {
    const accounts = (await onAgentAccounts(agent)).accounts
    const project = own[agent]
    if (accounts.length >= 2 || project !== undefined) view[agent] = { accounts: accounts.map(a => ({ id: a.id, name: a.name })), ...(project !== undefined ? { project } : {}) }
  }
  return view
}

/** Change a project's own accounts: a value sets one, `null` goes back to the computer's. Kept on this computer, never in the repository. */
export async function sendProjectAccounts(projectId: string, change: { gitHost?: string | null; claude?: string[] | null; codex?: string[] | null }): Promise<AccountResult> {
  const root = await resolveProjectPath(projectId)
  if (!root) return { ok: false, error: 'No such project.' }
  const known = await onProjectAccounts(projectId)
  if (typeof change.gitHost === 'string' && !known?.gitHost?.accounts.includes(change.gitHost)) return { ok: false, error: `This computer knows no account ${change.gitHost} there.` }
  for (const agent of ['claude', 'codex'] as const satisfies AccountsAgent[]) {
    const picked = change[agent]
    if (Array.isArray(picked) && picked.some(id => !known?.[agent]?.accounts.some(a => a.id === id))) return { ok: false, error: `That ${agent === 'codex' ? 'Codex' : 'Claude'} account is not on this computer.` }
  }
  try {
    await writeProjectAccounts(root, {
      ...(change.gitHost !== undefined ? { gitHost: change.gitHost } : {}),
      ...(change.claude !== undefined ? { claude: change.claude } : {}),
      ...(change.codex !== undefined ? { codex: change.codex } : {}),
    })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
