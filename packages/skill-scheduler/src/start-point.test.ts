import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, mkdtemp, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { GitRunner } from '@openagt/agent-data'
import { atStartOf, isOnCommit, readStartPoint } from './start-point.js'
import { RETRIED_RM, git, removeRepo, testRepo, writeSkill } from './test-repo.js'

// Where a run's checkout starts and whether a skill's file is there, read off real git: a remote's
// default branch, a repository with no remote, links on the way to the file, a commit that cannot be read.

const WORK_QUEUE = '.claude/skills/work-queue/SKILL.md'
const ANSWER = '.claude/skills/answer-comments/SKILL.md'

const commit = async (repo: string, message: string): Promise<void> => {
  await git(['add', '-A'], repo)
  await git(['commit', '-q', '-m', message], repo)
}

/** A second clone of the project's origin, with its own author. */
async function otherClone(repo: string): Promise<string> {
  const other = `${repo}-other`
  // The branch by name: a bare origin's own HEAD may name a branch that does not exist, and the clone would then be empty.
  await git(['clone', '-q', '-b', 'main', join(repo, '..', 'origin.git'), other], join(repo, '..'))
  await git(['config', 'user.email', 'other@example.com'], other)
  await git(['config', 'user.name', 'other'], other)
  return other
}

test("a skill is where a run's checkout starts once it is on origin's default branch: not when only written, not when only committed here", async () => {
  const repo = await testRepo()
  try {
    const atStart = (file: string) => atStartOf(repo, git)(file)
    assert.deepEqual(await atStart(WORK_QUEUE), { ref: 'origin/main', reached: true, there: true })
    await writeSkill(repo, 'answer-comments', 'schedule:\n  when: gh api comments\n')
    assert.deepEqual(await atStart(ANSWER), { ref: 'origin/main', reached: true, there: false }, 'written, not committed')
    await commit(repo, 'A skill')
    assert.equal((await atStart(ANSWER)).there, false, 'committed here, not on origin')
    await git(['push', '-q', 'origin', 'main'], repo)
    assert.equal((await atStart(ANSWER)).there, true)
    // The folder alone is no skill: its file has to be there.
    assert.equal(await isOnCommit(repo, 'origin/main', '.claude/skills/answer-comments', git), false)
    assert.equal(await isOnCommit(repo, 'origin/main', '.claude/skills/answer-comments/NOTES.md', git), false)
  } finally {
    await removeRepo(repo)
  }
})

test('the start point is brought up to date like a run\'s checkout: a skill another machine brought onto the default branch is there, and one it took off is not; the fetch is made once for a whole tick', async () => {
  const repo = await testRepo()
  let other = ''
  try {
    other = await otherClone(repo)
    await writeSkill(other, 'answer-comments', 'schedule:\n  when: gh api comments\n')
    await git(['rm', '-rq', '.claude/skills/work-queue'], other)
    await commit(other, 'One skill in, one out')
    await git(['push', '-q', 'origin', 'main'], other)
    // This clone has not fetched: its own copy of the branch still has the old skills.
    assert.equal(await isOnCommit(repo, 'origin/main', WORK_QUEUE, git), true)
    const fetches: string[][] = []
    const counting: GitRunner = (args, cwd) => (args[0] === 'fetch' && fetches.push(args), git(args, cwd))
    const atStart = atStartOf(repo, counting)
    assert.deepEqual(await atStart(ANSWER), { ref: 'origin/main', reached: true, there: true })
    assert.deepEqual(await atStart(WORK_QUEUE), { ref: 'origin/main', reached: true, there: false })
    assert.deepEqual(fetches, [['fetch', '--quiet', '--no-write-fetch-head', 'origin', 'main']], 'one fetch for both questions, of the default branch alone')
  } finally {
    if (other) await rm(other, RETRIED_RM)
    await removeRepo(repo)
  }
})

test('origin that cannot be reached leaves the copy this clone last saw, and the start point says so; a fetch that fails does not fail the question', async () => {
  const repo = await testRepo()
  try {
    await writeSkill(repo, 'answer-comments', 'schedule:\n  when: gh api comments\n')
    await rename(join(repo, '..', 'origin.git'), join(repo, '..', 'gone.git'))
    assert.deepEqual(await readStartPoint(repo, git), { ref: 'origin/main', reached: false })
    const atStart = atStartOf(repo, git)
    assert.deepEqual(await atStart(ANSWER), { ref: 'origin/main', reached: false, there: false })
    assert.deepEqual(await atStart(WORK_QUEUE), { ref: 'origin/main', reached: false, there: true }, 'what this clone last saw still answers')
  } finally {
    await removeRepo(repo)
  }
})

test('a link on the way to the file is followed as a checkout follows it: a link to the skill\'s folder, a link for the whole skills folder, a link to the file; a link whose target is not on the commit, leaves the repository or turns in a circle leads nowhere', async () => {
  const repo = await testRepo()
  try {
    // As this repository keeps its skills: the text in one folder, a link to it from the other.
    await mkdir(join(repo, '.agents', 'skills', 'plan'), { recursive: true })
    await writeFile(join(repo, '.agents', 'skills', 'plan', 'SKILL.md'), '---\nname: plan\n---\nPlan.\n')
    await symlink('../../.agents/skills/plan', join(repo, '.claude', 'skills', 'plan'))
    // A link whose target was never committed, one out of the repository, one to the file itself, two in a circle.
    await symlink('../../.agents/skills/unwritten', join(repo, '.claude', 'skills', 'dangling'))
    await symlink('../../../elsewhere', join(repo, '.claude', 'skills', 'outside'))
    await mkdir(join(repo, '.claude', 'skills', 'by-file'))
    await symlink('../../../.agents/skills/plan/SKILL.md', join(repo, '.claude', 'skills', 'by-file', 'SKILL.md'))
    await symlink('circle-b', join(repo, '.claude', 'skills', 'circle-a'))
    await symlink('circle-a', join(repo, '.claude', 'skills', 'circle-b'))
    await commit(repo, 'Links')
    const on = (file: string) => isOnCommit(repo, 'HEAD', file, git)
    assert.equal(await on('.claude/skills/plan/SKILL.md'), true)
    assert.equal(await on('.agents/skills/plan/SKILL.md'), true)
    assert.equal(await on('.claude/skills/by-file/SKILL.md'), true)
    assert.equal(await on('.claude/skills/dangling/SKILL.md'), false)
    assert.equal(await on('.claude/skills/outside/SKILL.md'), false)
    assert.equal(await on('.claude/skills/circle-a/SKILL.md'), false)
    // A project that links its whole skills folder: every skill is reached through the one link.
    const linked = await realpath(await mkdtemp(join(tmpdir(), 'scheduler-linked-')))
    try {
      await git(['init', '-q', '-b', 'main'], linked)
      await git(['config', 'user.email', 'tester@example.com'], linked)
      await git(['config', 'user.name', 'tester'], linked)
      await mkdir(join(linked, '.agents', 'skills', 'alpha'), { recursive: true })
      await writeFile(join(linked, '.agents', 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\n---\nDo.\n')
      await mkdir(join(linked, '.claude'))
      await symlink('../.agents/skills', join(linked, '.claude', 'skills'))
      await commit(linked, 'A linked skills folder')
      assert.equal(await isOnCommit(linked, 'HEAD', '.claude/skills/alpha/SKILL.md', git), true)
      assert.equal(await isOnCommit(linked, 'HEAD', '.claude/skills/beta/SKILL.md', git), false)
    } finally {
      await rm(linked, RETRIED_RM)
    }
  } finally {
    await removeRepo(repo)
  }
})

test('a repository with no remote starts a checkout from HEAD: a skill is there once it is committed; with no commit yet nothing can be said, and nothing is held back', async () => {
  const repo = await realpath(await mkdtemp(join(tmpdir(), 'scheduler-local-')))
  try {
    await git(['init', '-q', '-b', 'main'], repo)
    await git(['config', 'user.email', 'tester@example.com'], repo)
    await git(['config', 'user.name', 'tester'], repo)
    await writeSkill(repo, 'answer-comments', 'schedule:\n  when: gh api comments\n')
    assert.equal(await isOnCommit(repo, 'HEAD', ANSWER, git), undefined, 'no commit: the start point cannot be read')
    assert.deepEqual(await atStartOf(repo, git)(ANSWER), { ref: 'HEAD', reached: true, there: true })
    await commit(repo, 'A skill')
    assert.deepEqual(await atStartOf(repo, git)(ANSWER), { ref: 'HEAD', reached: true, there: true })
    await writeSkill(repo, 'watch-competitor', 'schedule:\n  every: 1h\n')
    assert.deepEqual(await atStartOf(repo, git)('.claude/skills/watch-competitor/SKILL.md'), { ref: 'HEAD', reached: true, there: false })
  } finally {
    await rm(repo, RETRIED_RM)
  }
})
