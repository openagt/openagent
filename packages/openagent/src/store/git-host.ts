import { runPackageCommand, type ProvidedCommand } from '@openagt/agent-data'
import { isBuiltIn, providedCommand } from '../built-in.js'

/**
 * The project's git host, as OpenAgent reads and acts on it (#1820): the pull requests of the
 * project, opening one, landing one, and the project's page there. OpenAgent names no git host
 * and runs no git host tool: a project's git host comes from whichever of its packages declares that it
 * provides it — `"openagent": { "git-host": "<command>" }` in the package's own package.json — and
 * OpenAgent asks by running that command. Swap the package for another that answers the same
 * command line and prints the same shapes, and nothing here changes. No package declares it: the
 * project has no git host, so no pull requests, and a finished run's last step is the push. A
 * built-in package's git host is the project's only when it answers the project's page there: a
 * project whose remote is on another host, or that has no remote, has none.
 *
 * The command line a provider answers, each printing one JSON document and exiting 0 (a refusal
 * exits 1 with its reason on stderr):
 *   `<command> requests [--branch <b>] [--state open|merged|all] [--since <iso>]`
 *                                                       the project's pull requests, newest first, as an array of {@link GitHostRequest}
 *   `<command> open --branch <b> --title <t> [--body <text>] [--draft]`
 *                                                       open the branch's pull request; an open one is answered as it is (`existing`)
 *   `<command> merge <number>`                          land the pull request: armed to merge on green, or merged at once
 *   `<command> home`                                    the project's page on the git host, and the git host's name
 *   `<command> me`                                      who is signed in there: {@link GitHostPerson}
 *   `<command> people <email>...`                       the accounts behind the project's commit emails: an array of
 *                                                       {@link GitHostPerson} each with its `email`, one per email the host knows
 * The branch `open` is asked for must already be on the remote: pushing is the branches
 * provider's step, and OpenAgent runs it first.
 *
 * The shapes, owned here: {@link GitHostRequest}, {@link GitHostHome}, {@link GitHostPerson}.
 */

/** A pull request, as a provider lists it. */
export interface GitHostRequest {
  number: number
  url: string
  state: 'open' | 'merged' | 'closed'
  title: string
  draft: boolean
  /** The branch the request is from. */
  branch: string
  /** The commit the request's head is at. */
  head: string
  /** ISO creation time. */
  createdAt: string
  /** ISO merge time, for a merged request. */
  mergedAt?: string
  /** The commit a merged request landed as on the base branch. */
  mergeCommit?: string
}

/** The project's page on the git host, and what the git host is called: what a link is drawn from. */
export interface GitHostHome {
  url: string
  name: string
}

/** The person signed in at the git host: what the dashboard shows of them. */
export interface GitHostPerson {
  login: string
  name?: string
  /** A picture of them: an https address. */
  avatar?: string
}

/** What asking for requests answered: the list, or why there is none: "none" and "could not tell" are different answers. */
export type RequestsOutcome = { ok: true; requests: GitHostRequest[] } | { ok: false; error: string }

/** What opening a pull request left: the request, and whether it was open already. */
export type OpenOutcome = { ok: true; request: { number: number; url: string }; existing: boolean } | { ok: false; error: string }

/** What landing a pull request did: armed to merge on green, merged at once, or the provider watching its checks. */
export type MergeOutcome = { ok: true; outcome: 'auto-armed' | 'merged' | 'watching' } | { ok: false; error: string }

/** A project's git host: what a provider answers, read and moved by OpenAgent. */
export interface GitHostSource {
  /** The project's pull requests, newest first: all, or one branch's, or by state, or since a time. */
  requests(opts?: { branch?: string; state?: 'open' | 'merged' | 'all'; since?: string }): Promise<RequestsOutcome>
  /** Open a branch's pull request, or answer the open one. */
  open(branch: string, opts: { title: string; body?: string; draft?: boolean }): Promise<OpenOutcome>
  /** Land a pull request. */
  merge(number: number): Promise<MergeOutcome>
  /** The project's page on the git host; `undefined` when the provider cannot tell (no remote there). */
  home(): Promise<GitHostHome | undefined>
  /** Who is signed in at the git host; `undefined` when nobody is, or the provider cannot tell. */
  me(): Promise<GitHostPerson | undefined>
  /** The accounts behind these commit emails, each with its email; an email the host knows no account for is left out. */
  people(emails: readonly string[]): Promise<(GitHostPerson & { email: string })[]>
}

/** The git host of the project at `root`, or `undefined` when none of its packages provides one. */
export type GitHostFor = (root: string) => Promise<GitHostSource | undefined>

/** A {@link GitHostFor} that also forgets what it knows of one project. */
export type GitHostReader = GitHostFor & { changed(root: string): void }

/** How long a provider lookup is reused: the dashboard asks for the git host on every handoff read. */
const CACHE_MS = 5_000

/** The rows read back from a provider's `requests`: the objects with the facts a request needs; anything else is no request. */
export function parseRequests(output: unknown): GitHostRequest[] {
  if (!Array.isArray(output)) return []
  const requests: GitHostRequest[] = []
  for (const value of output) {
    if (!value || typeof value !== 'object') continue
    const row = value as Record<string, unknown>
    const state = row['state']
    if (typeof row['number'] !== 'number' || typeof row['url'] !== 'string' || (state !== 'open' && state !== 'merged' && state !== 'closed')) continue
    requests.push({
      number: row['number'],
      url: row['url'],
      state,
      title: typeof row['title'] === 'string' ? row['title'] : '',
      draft: row['draft'] === true,
      branch: typeof row['branch'] === 'string' ? row['branch'] : '',
      head: typeof row['head'] === 'string' ? row['head'] : '',
      createdAt: typeof row['createdAt'] === 'string' ? row['createdAt'] : '',
      ...(typeof row['mergedAt'] === 'string' ? { mergedAt: row['mergedAt'] } : {}),
      ...(typeof row['mergeCommit'] === 'string' ? { mergeCommit: row['mergeCommit'] } : {}),
    })
  }
  return requests
}

/** A pull request read back from an `open` answer, or undefined. */
function requestOf(output: unknown): { number: number; url: string } | undefined {
  const request = output && typeof output === 'object' ? ((output as Record<string, unknown>)['request'] as Record<string, unknown> | undefined) : undefined
  return request && typeof request === 'object' && typeof request['number'] === 'number' && typeof request['url'] === 'string' ? { number: request['number'], url: request['url'] } : undefined
}

/** The git host source over one provider command: each call one run of the command. */
function commandGitHost(root: string, command: ProvidedCommand): GitHostSource {
  return {
    async requests(opts = {}) {
      const args = ['requests', ...(opts.branch ? ['--branch', opts.branch] : []), ...(opts.state ? ['--state', opts.state] : []), ...(opts.since ? ['--since', opts.since] : [])]
      const result = await runPackageCommand(root, command, args)
      if (!result.ok) return { ok: false, error: result.error }
      return { ok: true, requests: parseRequests(result.output) }
    },
    async open(branch, opts) {
      const args = ['open', '--branch', branch, '--title', opts.title, ...(opts.body !== undefined ? ['--body', opts.body] : []), ...(opts.draft ? ['--draft'] : [])]
      const result = await runPackageCommand(root, command, args)
      if (!result.ok) return { ok: false, error: result.error }
      const request = requestOf(result.output)
      if (!request) return { ok: false, error: `${command.name} opened no pull request` }
      return { ok: true, request, existing: (result.output as Record<string, unknown>)['existing'] === true }
    },
    async merge(number) {
      const result = await runPackageCommand(root, command, ['merge', String(number)])
      if (!result.ok) return { ok: false, error: result.error }
      const outcome = result.output && typeof result.output === 'object' ? (result.output as Record<string, unknown>)['outcome'] : undefined
      if (outcome === 'auto-armed' || outcome === 'merged' || outcome === 'watching') return { ok: true, outcome }
      return { ok: false, error: `${command.name} did not merge` }
    },
    async home() {
      const result = await runPackageCommand(root, command, ['home'])
      if (!result.ok || !result.output || typeof result.output !== 'object') return undefined
      const home = result.output as Record<string, unknown>
      return typeof home['url'] === 'string' && typeof home['name'] === 'string' ? { url: home['url'], name: home['name'] } : undefined
    },
    async me() {
      const result = await runPackageCommand(root, command, ['me'])
      if (!result.ok || !result.output || typeof result.output !== 'object') return undefined
      const me = result.output as Record<string, unknown>
      if (typeof me['login'] !== 'string' || !me['login']) return undefined
      return {
        login: me['login'],
        ...(typeof me['name'] === 'string' && me['name'] ? { name: me['name'] } : {}),
        // Only a picture on the web: the page loads it, and nothing else is fetched.
        ...(typeof me['avatar'] === 'string' && me['avatar'].startsWith('https://') ? { avatar: me['avatar'] } : {}),
      }
    },
    async people(emails) {
      if (emails.length === 0) return []
      const result = await runPackageCommand(root, command, ['people', ...emails])
      if (!result.ok || !Array.isArray(result.output)) return []
      return result.output.flatMap(value => {
        const { email, login, avatar } = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
        if (typeof email !== 'string' || !emails.includes(email) || typeof login !== 'string' || !login) return []
        // Only a picture on the web: the page loads it, and nothing else is fetched.
        return [{ email, login, ...(typeof avatar === 'string' && avatar.startsWith('https://') ? { avatar } : {}) }]
      })
    },
  }
}

/**
 * The production {@link GitHostReader}: the project's provider, looked up among the packages the project has (`built-in.ts`), one
 * source per project kept while the same command provides, so a project that installs, swaps or
 * drops its git host is read the new way within {@link CACHE_MS}. `changed(root)` forgets the
 * project, so the next ask looks its provider up again.
 */
export function providedGitHost(now: () => number = Date.now): GitHostReader {
  const sources = new Map<string, { at: number; command?: ProvidedCommand; source?: GitHostSource }>()
  const reader: GitHostFor = async root => {
    let known = sources.get(root)
    if (!known || now() - known.at >= CACHE_MS) {
      let command = await providedCommand(root, 'git-host').catch(() => undefined)
      // A built-in git host is one the project did not choose: it is the project's only when it
      // knows the project's page there (the origin remote is on that host).
      if (command && isBuiltIn(command) && !(await commandGitHost(root, command).home())) command = undefined
      const same = known?.command && command && known.command.bin === command.bin
      known = { at: now(), ...(command ? { command, source: same ? known!.source! : commandGitHost(root, command) } : {}) }
      sources.set(root, known)
    }
    return known.source
  }
  return Object.assign(reader, { changed: (root: string) => sources.delete(root) })
}

/** OpenAgent's one reader of the git host, shared by every caller. */
export const projectGitHost: GitHostReader = providedGitHost()

/** A {@link GitHostFor} for a project with no git host package. */
export const noGitHost: GitHostFor = async () => undefined
