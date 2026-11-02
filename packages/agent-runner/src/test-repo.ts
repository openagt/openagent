import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { strict as assert } from 'node:assert'
import { DATA_BRANCH, nodeGitRunner, SKILLS_ENV, writeSharing } from '@openagt/agent-data'
import { readDiary, type AnyDiaryLine } from '@openagt/skill-logs'

/**
 * A project for the tests: one commit on `main`, a bare `origin`, the `agent-data` branch born
 * on origin, a tracked `.claude/skills/work-queue`. Real git, because the records, the checkouts
 * and the reclaim rule are git.
 */

export const git = nodeGitRunner()

/**
 * Hand this process the basic skills as `@openagt/dashboard` hands them to OpenAgent: logs, question
 * and github, from this package's own install.
 */
export function handDownBasicSkills(): void {
  const require = createRequire(import.meta.url)
  process.env[SKILLS_ENV] = ['@openagt/skill-logs', '@openagt/skill-question', '@openagt/skill-github'].map(name => dirname(require.resolve(`${name}/package.json`))).join(delimiter)
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
