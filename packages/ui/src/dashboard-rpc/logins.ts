import { homedir } from 'node:os'
import { originUrl, runPackageCommand, type ProvidedCommand } from '@openagt/agent-data'
import { providedCommand } from '../distribution-packages.js'
import { contextProjects } from './context.js'
import { readProvider, remoteHost, type GitHostProvider } from '../dashboard/git-hosts.js'

import { refreshLoginShellPath } from '../shell-path.js'

export type { GitHostAccount, GitHostProvider } from '../dashboard/git-hosts.js'

// What runs log in with at each git host the projects' remotes are on, and what is missing for
// them to, as the git host's own package answers for it (`<command> accounts`): its name, its word for a pull request, the accounts its
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
} = {
  origin: root => originUrl(root),
  gitHost: root => providedCommand(root, 'git-host').catch(() => undefined),
  run: runPackageCommand,
  home: () => homedir(),
}

export type AccountResult = { ok: true } | { ok: false; error: string }

/** Where each host was last found: a project there, and its package's command, for a press on its card. */
const found = new Map<string, { root: string; command: ProvidedCommand }>()

async function askProvider(host: string, root: string, command: ProvidedCommand): Promise<GitHostProvider | undefined> {
  const result = await loginsWiring.run(root, command, ['accounts', '--host', host])
  return result.ok ? readProvider(result.output) : undefined
}

/**
 * The hosts as last read, and the read under way, each for the projects it read: a git host's tool
 * asks its host who is logged in (GitHub's takes most of a second), so a page is answered at once
 * with the last answer while the hosts are read again behind it, and sees that one at its next ask.
 */
let lastHosts: { projects: string; view: GitHostsView } | undefined
let readingHosts: { projects: string; view: Promise<GitHostsView> } | undefined

/**
 * The hosts the projects' remotes are on, in the projects' order, each with its package's answer:
 * the last answer when there is one for the same projects, the hosts being read again behind it.
 */
export async function onGitHosts(): Promise<GitHostsView> {
  const projects = (await contextProjects().list()).map(project => project.path).join('\n')
  const reading = readingHosts?.projects === projects ? readingHosts.view : readHosts(projects)
  if (lastHosts?.projects !== projects) return reading
  // Its answer is for the next ask; a read that failed leaves the last answer standing.
  reading.catch(() => undefined)
  return lastHosts.view
}

/** Read the hosts of `projects`. Its answer is the last one only if it is still the read under way when it lands: no press came since. */
function readHosts(projects: string): Promise<GitHostsView> {
  const read = {
    projects,
    view: readGitHosts()
      .then(view => {
        if (readingHosts === read) lastHosts = { projects, view }
        return view
      })
      .finally(() => {
        if (readingHosts === read) readingHosts = undefined
      }),
  }
  readingHosts = read
  return read.view
}

/** A press changed what a host's card says: what is answered after it is read after it, not by a read already under way. */
function hostsChanged(): void {
  lastHosts = undefined
  readingHosts = undefined
}

/**
 * The hosts the projects' remotes are on, in the projects' order, each with its package's answer,
 * then the host of the git host package OpenAgent brings, when no project is on it: a person logs
 * in there before a project is. A project with no remote is on none.
 */
async function readGitHosts(): Promise<GitHostsView> {
  const view = await readGitHostsOnce()
  if (!view.hosts.some(row => row.provider?.installed === false)) return view
  // A `gh` installed since OpenAgent started, or only on the terminal's PATH, is found.
  await refreshLoginShellPath()
  return readGitHostsOnce()
}

async function readGitHostsOnce(): Promise<GitHostsView> {
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
  return { hosts }
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
    hostsChanged()
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
  // The page reads the card again, and waits for the change.
  hostsChanged()
  return done
}

/** Runs use `login`, one of OpenAgent's own accounts at `host`, from now on. */
export async function sendUseGitHostAccount(host: string, login: string): Promise<AccountResult> {
  const done = await act(host, ['use', login])
  return done.ok ? { ok: true } : done
}

/**
 * Take an account off at `host`, on this computer: its tool forgets it, and its token goes on
 * working wherever else it is. The account runs use is not taken off: another is picked first.
 */
export async function sendForgetGitHostAccount(host: string, login: string): Promise<AccountResult> {
  const runs = (await onGitHosts()).hosts.find(row => row.host === host)?.provider?.accounts.find(account => account.runs)
  if (runs?.login === login) return { ok: false, error: `Runs use @${login}: pick another account for runs first.` }
  const done = await act(host, ['forget', login])
  return done.ok ? { ok: true } : done
}

/** Log another account in at `host`, in the browser: the code the person types, and where. */
export async function sendGitHostLogin(host: string): Promise<{ ok: true; code: string; url: string } | { ok: false; error: string }> {
  const done = await act(host, ['login'])
  if (!done.ok) return done
  const said = done.output as { code?: unknown; url?: unknown } | null
  return typeof said?.code === 'string' && typeof said.url === 'string' && said.url.startsWith('https://') ? { ok: true, code: said.code, url: said.url } : { ok: false, error: 'The package gave no code to log in with.' }
}

/** Give up the login under way at `host`: its tool stops waiting, and the press to add an account is back. */
export async function sendStopGitHostLogin(host: string): Promise<AccountResult> {
  const done = await act(host, ['stop-login'])
  return done.ok ? { ok: true } : done
}

/** Install the tool `host`'s package works through, with the command it declared; the card follows it. */
export async function sendGitHostInstall(host: string): Promise<AccountResult> {
  const done = await act(host, ['install'])
  return done.ok ? { ok: true } : done
}
