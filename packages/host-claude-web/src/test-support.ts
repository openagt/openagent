import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DATA_BRANCH, nodeGitRunner } from '@openagt/git-branches'
import { writeSharing } from '@openagt/store-filesystem'
import type { GitRunner } from '@openagt/hooks'
import { writeRun, type AnyDiaryLine, type RunCard } from '@openagt/agent-driver'
import { WEB_HOST } from './web-runs.js'

// What the tests work with: a project whose runs' records are kept where a real one keeps them,
// with an origin its starts are pushed to and its sessions' branches come from.

export const git: GitRunner = nodeGitRunner()

/**
 * A project for the tests: one commit on `main`, a bare `origin`, the `agent-data` branch born on
 * origin, its records shared. Real git, because the records and the starts are.
 */
export async function testRepo(): Promise<string> {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'host-claude-web-')))
  const repo = join(base, 'repo')
  const origin = join(base, 'origin.git')
  await mkdir(repo)
  await git(['init', '-q', '-b', 'main'], repo)
  await git(['config', 'user.email', 'tester@example.com'], repo)
  await git(['config', 'user.name', 'tester'], repo)
  await writeFile(join(repo, 'README.md'), '# t\n')
  await git(['add', '-A'], repo)
  await git(['commit', '-q', '-m', 'init'], repo)
  await git(['init', '-q', '--bare', origin], base)
  await git(['remote', 'add', 'origin', origin], repo)
  await git(['push', '-q', '-u', 'origin', 'main'], repo)
  const tree = (await git(['hash-object', '-t', 'tree', '/dev/null'], repo)).trim()
  const commit = (await git(['commit-tree', tree, '-m', `create the ${DATA_BRANCH} branch`], repo)).trim()
  await git(['push', '-q', 'origin', `${commit}:refs/heads/${DATA_BRANCH}`], repo)
  await git(['fetch', '-q', 'origin'], repo)
  await writeSharing(repo, true)
  return repo
}

/** The repository and its origin go together. */
export async function removeRepo(repo: string): Promise<void> {
  await rm(dirname(repo), { recursive: true, force: true, maxRetries: 10 })
}

/** The start of a run whose id is `id`, as its card says it. */
export function startOf(id: string): string {
  return id.replace(/T(\d\d)-(\d\d)-(\d\d)-(\d{3})Z$/, 'T$1:$2:$3.$4Z')
}

/** A run of the project's records: one of this host's, of computer `laptop`, unless `caller` says otherwise. */
export async function recorded(repo: string, id: string, card: Partial<RunCard> = {}, caller: Record<string, unknown> = {}, diary: AnyDiaryLine[] = []): Promise<void> {
  await writeRun(repo, { id, startedAt: startOf(id), status: 'running', intent: `run ${id}`, driver: 'claude-code', ...card, caller: { target: WEB_HOST, host: 'laptop', ...caller } }, diary)
}

/** An empty commit on `main`, pushed to origin as `branch`: a run's start. Answers the commit. */
export async function pushedStart(repo: string, branch: string): Promise<string> {
  const anchor = (await git(['commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', 'a start'], repo)).trim()
  await git(['push', '-q', 'origin', `${anchor}:refs/heads/${branch}`], repo)
  return anchor
}

/** A commit on `from`, pushed to origin as `branch`: a cloud session's work. Answers the commit. */
export async function pushedWork(repo: string, from: string, branch: string): Promise<string> {
  const work = (await git(['commit-tree', `${from}^{tree}`, '-p', from, '-m', `work on ${branch}`], repo)).trim()
  await git(['push', '-q', 'origin', `${work}:refs/heads/${branch}`], repo)
  return work
}

/** The commit origin's `branch` is at; none when origin has no such branch. */
export async function originHas(repo: string, branch: string): Promise<string | undefined> {
  const listed = await git(['ls-remote', 'origin', `refs/heads/${branch}`], repo)
  return listed.trim().split(/\s+/)[0] || undefined
}

/** Wait until `done` says so: what a background hand-off wrote is read back. */
export async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, what: string, timeoutMs = 20_000): Promise<T> {
  const end = Date.now() + timeoutMs
  for (;;) {
    const value = await read()
    if (done(value)) return value
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}: ${JSON.stringify(value)}`)
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}
