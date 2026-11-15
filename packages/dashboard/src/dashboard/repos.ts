import { basename, join } from 'node:path'

// The repos on this computer (Rom's "repos are not projects"): every Git repository a quick look
// through the person's folders finds, so a new session can be started in one that is not a project
// yet. A project is a repo the person pinned: the registry's list. A repo is only a folder with
// its Git address.
//
// The look is a crawl of the home folder and of the folders the person added, shallowest first so a
// crawl cut short has the nearest,
// that stops at a repository (what is inside one is that repository's) and stops altogether at a
// strict time limit: what was found by then is the list. It is kept, and read again in the
// background once it is old, so the picker never waits on a crawl but its first. A first crawl cut
// short (a busy start, a slow folder) is followed at once by one with time enough, behind the answer.

/** A Git repository found on this computer. */
export interface FoundRepo {
  /** Its folder, absolute. */
  path: string
  /** The folder's name. */
  name: string
  /** Its `origin` remote's address, when it has one. */
  url?: string
}

/** How far into a folder the crawl goes: `~/Projects/org/repo` is 3 deep. */
export const CRAWL_DEPTH = 4

/** The strict limit of a crawl someone waits on: past it, what was found is the list. */
export const CRAWL_LIMIT_MS = 2000

/** The limit of a crawl nobody waits on: behind a kept list. */
export const CRAWL_BEHIND_LIMIT_MS = 20_000

/** How old the kept list may be before a read crawls again, in the background. */
export const REPOS_MAX_AGE_MS = 60_000

/**
 * Folders no repository of the person's is in, or so big that a look through them would eat the
 * limit: package installs, build output, and the system's own folders of a home (macOS's).
 * Hidden folders are skipped too, which takes OpenAgent's own and the sessions' folders with them.
 */
const SKIPPED = new Set(['node_modules', 'Library', 'Applications', 'Pictures', 'Music', 'Movies', 'Public', 'dist', 'build', 'target', 'vendor', 'venv'])

/** The fs a crawl reads through, so a test can count and slow its reads. */
export interface CrawlFs {
  /** The folder's entries, with whether each is a folder; a folder that cannot be read has none. */
  entries(path: string): Promise<{ name: string; directory: boolean }[]>
  /** A file's text, or undefined when it cannot be read. */
  read(path: string): Promise<string | undefined>
}

/** The {@link CrawlFs} of this computer's disk. A link is not followed: its folder is found where it is. */
export function nodeCrawlFs(): CrawlFs {
  return {
    async entries(path) {
      const { readdir } = await import('node:fs/promises')
      const found = await readdir(path, { withFileTypes: true }).catch(() => [])
      return found.map(entry => ({ name: entry.name, directory: entry.isDirectory() }))
    },
    async read(path) {
      const { readFile } = await import('node:fs/promises')
      return readFile(path, 'utf8').catch(() => undefined)
    },
  }
}

/** The `url` of `[remote "origin"]` in a repository's `.git/config`; undefined when it has none. */
export function originUrlOf(config: string): string | undefined {
  let inOrigin = false
  for (const raw of config.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('[')) inOrigin = /^\[remote\s+"origin"\]$/.test(line)
    else if (inOrigin) {
      const match = /^url\s*=\s*(.+)$/.exec(line)
      if (match) return match[1]!.trim()
    }
  }
  return undefined
}

/** What a crawl is told: where to look, and how far and how long. */
export interface CrawlOptions {
  depth?: number
  limitMs?: number
  fs?: CrawlFs
  now?: () => number
}

/** What a crawl found, and whether it looked everywhere or the time was up first. */
export interface Crawl {
  repos: FoundRepo[]
  whole: boolean
}

/**
 * The repositories under `roots`, each found once, by name. A root that is itself a
 * repository is one, and is still looked through: a home folder can be a repository of its own
 * settings. Any other folder with a `.git` (a folder, or a worktree's file) is a repository, and the
 * crawl goes no further into it. The crawl reads a level of folders at once, and stops when the
 * time is up, between reads: what it found until then is the answer.
 */
export async function crawlRepos(roots: readonly string[], options: CrawlOptions = {}): Promise<Crawl> {
  const fs = options.fs ?? nodeCrawlFs()
  const depth = options.depth ?? CRAWL_DEPTH
  const now = options.now ?? Date.now
  const deadline = now() + (options.limitMs ?? CRAWL_LIMIT_MS)
  const found = new Map<string, FoundRepo>()
  const seen = new Set<string>()
  let level = roots.filter(root => !seen.has(root) && seen.add(root))
  let whole = true
  for (let at = 0; level.length > 0 && at <= depth && whole; at++) {
    const next: string[] = []
    // A level at a time, in chunks, so a slow folder holds up only its chunk and the time is checked often.
    for (let i = 0; i < level.length; i += 32) {
      if (now() >= deadline) {
        whole = false
        break
      }
      await Promise.all(
        level.slice(i, i + 32).map(async folder => {
          const entries = await fs.entries(folder)
          if (entries.some(entry => entry.name === '.git')) {
            const config = await fs.read(join(folder, '.git', 'config'))
            const url = config === undefined ? undefined : originUrlOf(config)
            found.set(folder, { path: folder, name: basename(folder), ...(url ? { url } : {}) })
            if (at > 0) return
          }
          for (const entry of entries) {
            if (!entry.directory || entry.name.startsWith('.') || SKIPPED.has(entry.name)) continue
            const path = join(folder, entry.name)
            if (!seen.has(path)) {
              seen.add(path)
              next.push(path)
            }
          }
        }),
      )
    }
    level = next
  }
  // By name: the reads of a level run at once and land in any order, and the list should not move between crawls.
  const repos = [...found.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.path.localeCompare(b.path))
  return { repos, whole }
}

/** The repos as kept, and whether a crawl with more time is looking for the rest of them. */
export interface RepoRead {
  repos: FoundRepo[]
  looking: boolean
}

/** The kept repo list and how it is read again. */
export interface RepoIndex {
  /** The repos as last found: the first read waits on a crawl, a read of an old or cut-short list crawls again in the background. */
  read(): Promise<RepoRead>
  /** Crawl now, and answer what this crawl found: after a folder is added. */
  refresh(): Promise<RepoRead>
}

/** A {@link RepoIndex} over the folders `roots` names when a crawl starts. */
export function repoIndex(roots: () => Promise<string[]>, options: { crawl?: (roots: string[], limitMs: number) => Promise<Crawl>; now?: () => number; maxAgeMs?: number } = {}): RepoIndex {
  const crawl = options.crawl ?? ((found, limitMs) => crawlRepos(found, { limitMs }))
  const now = options.now ?? Date.now
  const maxAge = options.maxAgeMs ?? REPOS_MAX_AGE_MS
  // `again`: the crawl someone waited on was cut short, and one with time enough is to follow it.
  let kept: { repos: FoundRepo[]; at: number; again: boolean } | undefined
  let running: Promise<void> | undefined
  const crawlOnce = (waited: boolean): Promise<void> => {
    running ??= roots()
      .then(found => crawl(found, waited ? CRAWL_LIMIT_MS : CRAWL_BEHIND_LIMIT_MS))
      .then(
        ({ repos, whole }) => {
          kept = { repos, at: now(), again: waited && !whole }
        },
        () => {},
      )
      .finally(() => {
        running = undefined
      })
    return running
  }
  const answer = (): RepoRead => ({ repos: kept?.repos ?? [], looking: kept?.again ?? false })
  return {
    async read() {
      if (!kept) await crawlOnce(true)
      if (kept && (kept.again || now() - kept.at > maxAge)) void crawlOnce(false)
      return answer()
    },
    // A crawl already on its way may have started before what changed: this one starts after it.
    refresh: () =>
      (running ?? Promise.resolve())
        .then(() => crawlOnce(true))
        .then(answer),
  }
}

let thisComputer: RepoIndex | undefined

/**
 * This computer's repos: one list for the daemon, first crawled when a page asks. It looks in the home folder
 * and in the folders the person added (`repoFolders` in the registry).
 */
export function thisComputersRepos(): RepoIndex {
  thisComputer ??= repoIndex(async () => {
    const { homedir } = await import('node:os')
    const { listRepoFolders } = await import('../registry.js')
    return [homedir(), ...(await listRepoFolders())]
  })
  return thisComputer
}
