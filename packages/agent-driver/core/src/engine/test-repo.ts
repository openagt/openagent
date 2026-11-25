import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { strict as assert } from 'node:assert'
import { DATA_BRANCH, nodeGitRunner } from '@openagt/git-branches'
import { writeSharing } from '@openagt/store-filesystem'
import { DISTRIBUTION_ENV } from '@openagt/hooks'
import { readDiary } from '../record-store.js'
import { type AnyDiaryLine } from '../record.js'

/**
 * A project for the tests: one commit on `main`, a bare `origin`, the `agent-data` branch born
 * on origin, a tracked `.claude/skills/work-queue`. Real git, because the records, the checkouts
 * and the reclaim rule are git.
 */

export const git = nodeGitRunner()

/** How many distributions this process's tests handed down: each is a file of its own, since a distribution is read once per file. */
let handedDown = 0

/**
 * Hand down to this process a distribution of the packages in `packages`, by name, each the folder
 * given, installed under `dir`'s `node_modules`: as OpenAgent hands its own down to a run's
 * process. Answers what hands back the distribution handed down before.
 */
export async function handDownDistribution(dir: string, packages: Record<string, string>): Promise<() => void> {
  for (const [name, from] of Object.entries(packages)) {
    const at = join(dir, 'node_modules', name)
    await mkdir(dirname(at), { recursive: true })
    await symlink(from, at)
  }
  const file = join(dir, `distribution-${++handedDown}.mjs`)
  await writeFile(file, `export default ${JSON.stringify(Object.keys(packages).map(name => ({ package: name })))}\n`)
  const before = process.env[DISTRIBUTION_ENV]
  process.env[DISTRIBUTION_ENV] = file
  return () => {
    if (before === undefined) delete process.env[DISTRIBUTION_ENV]
    else process.env[DISTRIBUTION_ENV] = before
  }
}

/**
 * Hand down to this process a distribution whose one module brings coding agents of Claude Code's
 * id and Codex's, ready and never run: what a command that names a coding agent reads them from.
 * Answers what hands back the distribution handed down before.
 */
export async function handDownAgents(dir: string): Promise<() => void> {
  const file = join(dir, `distribution-${++handedDown}.mjs`)
  await writeFile(
    file,
    [
      "const logins = list => ({ list, service: list, envLogins: [], installed: async () => true, ownLoginThere: () => true, ownName: async () => undefined, logOut: async () => {}, signIn: async () => ({ ok: false, error: 'these tests sign nobody in' }), isSignInCode: () => false, forget: async () => {}, usage: async () => undefined })",
      "const agent = (id, list) => ({ id, label: id, accounts: logins(list), ready: async () => ({ problems: [], warnings: [] }), driver: () => { throw new Error('these tests run no agent') } })",
      "export default [{ module: { name: 'test-agents', hooks: { 'run.agent': [agent('claude-code', 'claude'), agent('codex', 'codex')] } } }]",
      '',
    ].join('\n'),
  )
  const before = process.env[DISTRIBUTION_ENV]
  process.env[DISTRIBUTION_ENV] = file
  return () => {
    if (before === undefined) delete process.env[DISTRIBUTION_ENV]
    else process.env[DISTRIBUTION_ENV] = before
  }
}

export const RETRIED_RM = { recursive: true, force: true, maxRetries: 10 } as const

export async function testRepo(): Promise<string> {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'agent-runner-')))
  const repo = join(base, 'repo')
  const origin = join(base, 'origin.git')
  await mkdir(repo)
  await git(['init', '-q', '-b', 'main'], repo)
  await git(['config', 'user.email', 'tester@example.com'], repo)
  await git(['config', 'user.name', 'tester'], repo)
  await writeFile(join(repo, 'README.md'), '# t\n')
  await mkdir(join(repo, '.claude', 'skills', 'work-queue'), { recursive: true })
  await writeFile(join(repo, '.claude', 'skills', 'work-queue', 'SKILL.md'), '---\nname: work-queue\n---\nWork one queued task.\n')
  await git(['add', '-A'], repo)
  await git(['commit', '-q', '-m', 'init'], repo)
  await git(['init', '-q', '--bare', origin], base)
  await git(['remote', 'add', 'origin', origin], repo)
  await git(['push', '-q', '-u', 'origin', 'main'], repo)
  // The data branch, parentless, as the skills make it.
  const tree = (await git(['hash-object', '-t', 'tree', '/dev/null'], repo)).trim()
  const commit = (await git(['commit-tree', tree, '-m', `create the ${DATA_BRANCH} branch`], repo)).trim()
  await git(['push', '-q', 'origin', `${commit}:refs/heads/${DATA_BRANCH}`], repo)
  await git(['fetch', '-q', 'origin'], repo)
  // A project that shares its records with origin: the person's yes, given once per clone.
  await writeSharing(repo, true)
  return repo
}

/** The repository and its origin go together. */
export async function removeRepo(repo: string): Promise<void> {
  await rm(dirname(repo), RETRIED_RM)
}

/** A run's diary with each line's time checked and taken off: what is left is what happened. */
export async function readUntimedDiary(repo: string, id: string): Promise<AnyDiaryLine[]> {
  const lines = (await readDiary(repo, id)) ?? assert.fail(`no diary for ${id}`)
  return lines.map(({ at, ...line }) => {
    assert.equal(typeof at === 'string' && new Date(at).toISOString(), at, `a time on ${line.kind}`)
    return line as AnyDiaryLine
  })
}
