import { runPackageCommand, type ProvidedCommand } from '@openagt/agent-data'
import { providedCommand } from '../distribution-packages.js'

/**
 * The project's git host, as OpenAgent reads it (#1820): the project's page there, and the
 * accounts behind the project's commit emails. OpenAgent names no git host and runs no git host
 * tool: a project's git host comes from whichever of the distribution's packages declares that it
 * provides it — `"openagent": { "git-host": "<command>" }` in the package's own package.json — and
 * OpenAgent asks by running that command. The git host is the project's only when it answers the
 * project's page there: a project whose remote is on another host, or that has no remote, has none.
 * Its pull requests are its module's own (`chat.handoff`, `chat.labels`, `app.attention`).
 *
 * The command line a provider answers, each printing one JSON document and exiting 0 (a refusal
 * exits 1 with its reason on stderr):
 *   `<command> home`                                    the project's page on the git host, and the git host's name
 *   `<command> people <email>...`                       the accounts behind the project's commit emails: an array of
 *                                                       {@link GitHostPerson} each with its `email`, one per email the host knows
 */

/** The project's page on the git host, and what the git host is called: what a link is drawn from. */
export interface GitHostHome {
  url: string
  name: string
}

/** A person's account at the git host: what a card shows of them. */
export interface GitHostPerson {
  login: string
  name?: string
  /** A picture of them: an https address. */
  avatar?: string
}

/** A project's git host: what a provider answers, read and moved by OpenAgent. */
export interface GitHostSource {
  /** The project's page on the git host; `undefined` when the provider cannot tell (no remote there). */
  home(): Promise<GitHostHome | undefined>
  /** The accounts behind these commit emails, each with its email; an email the host knows no account for is left out. */
  people(emails: readonly string[]): Promise<(GitHostPerson & { email: string })[]>
}

/** The git host of the project at `root`, or `undefined` when none of its packages provides one. */
export type GitHostFor = (root: string) => Promise<GitHostSource | undefined>

/** A {@link GitHostFor} that also forgets what it knows of one project. */
export type GitHostReader = GitHostFor & { changed(root: string, pkg?: string): void }

/** How long a provider lookup is reused: the dashboard asks for the git host on every handoff read. */
const CACHE_MS = 5_000

/** The git host source over one provider command: each call one run of the command. */
function commandGitHost(root: string, command: ProvidedCommand): GitHostSource {
  return {
    async home() {
      const result = await runPackageCommand(root, command, ['home'])
      if (!result.ok || !result.output || typeof result.output !== 'object') return undefined
      const home = result.output as Record<string, unknown>
      return typeof home['url'] === 'string' && typeof home['name'] === 'string' ? { url: home['url'], name: home['name'] } : undefined
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
 * The production {@link GitHostReader}: the project's provider, looked up among the packages the project has (`distribution-packages.ts`), one
 * source per project kept while the same command provides, so a project whose git host changes is
 * read the new way within {@link CACHE_MS}. `changed(root)` forgets the
 * project, so the next ask looks its provider up again; `changed(root, pkg)` only when that package is the one providing.
 */
export function providedGitHost(now: () => number = Date.now): GitHostReader {
  const sources = new Map<string, { at: number; command?: ProvidedCommand; source?: GitHostSource }>()
  const reader: GitHostFor = async root => {
    let known = sources.get(root)
    if (!known || now() - known.at >= CACHE_MS) {
      let command = await providedCommand(root, 'git-host').catch(() => undefined)
      // The project did not choose its git host: it is the project's only when it knows the
      // project's page there (the origin remote is on that host).
      if (command && !(await commandGitHost(root, command).home())) command = undefined
      const same = known?.command && command && known.command.bin === command.bin
      known = { at: now(), ...(command ? { command, source: same ? known!.source! : commandGitHost(root, command) } : {}) }
      sources.set(root, known)
    }
    return known.source
  }
  return Object.assign(reader, {
    changed: (root: string, pkg?: string) => {
      if (pkg === undefined || sources.get(root)?.command?.package === pkg) sources.delete(root)
    },
  })
}

/** OpenAgent's one reader of the git host, shared by every caller. */
export const projectGitHost: GitHostReader = providedGitHost()

/** A {@link GitHostFor} for a project with no git host package. */
export const noGitHost: GitHostFor = async () => undefined
