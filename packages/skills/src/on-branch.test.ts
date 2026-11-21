import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { RpcHost } from '@openagt/hooks/rpc'
import { skillsOn, startBranch } from './on-branch.js'
import { projectSkills } from './server.js'

/** Git in `root`, with an identity of its own: a test machine may have none. */
const git = async (root: string, ...args: string[]): Promise<string> =>
  (await promisify(execFile)('git', ['-c', 'user.name=tester', '-c', 'user.email=tester@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: root })).stdout

/** A git repository with one commit on `main`. */
async function repository(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'openagent-skills-')))
  await git(root, 'init', '-q', '-b', 'main')
  await writeFile(join(root, 'README.md'), '# a project\n')
  await git(root, 'add', '-A')
  await git(root, 'commit', '-q', '-m', 'init')
  return root
}

async function skill(root: string, dir: string, name: string): Promise<void> {
  await mkdir(join(root, dir, name), { recursive: true })
  await writeFile(join(root, dir, name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} it.\n---\nDo it.\n`)
}

const commit = async (root: string): Promise<void> => {
  await git(root, 'add', '-A')
  await git(root, 'commit', '-q', '-m', 'skills')
}

/** Which of `names` are on `ref`. */
async function on(root: string, ref: string, ...names: string[]): Promise<string[]> {
  const branch = await skillsOn(root, ref)
  return names.filter(name => branch.has(name))
}

const gone = (root: string): Promise<void> => rm(root, { recursive: true, force: true })

test("a skill in the folder is on a branch once it is committed there: by its text, or by Claude Code's link to one", async () => {
  const root = await repository()
  try {
    await skill(root, '.agents/skills', 'deploy')
    await mkdir(join(root, '.claude/skills'), { recursive: true })
    await symlink('../../.agents/skills/deploy', join(root, '.claude/skills/deploy'))
    await skill(root, 'our-skills', 'release')
    await symlink('../../our-skills/release', join(root, '.claude/skills/release'))
    assert.deepEqual(await on(root, 'HEAD', 'deploy', 'release'), [], 'in the folder, not committed')
    await commit(root)
    assert.deepEqual(await on(root, 'HEAD', 'deploy', 'release', 'lint'), ['deploy', 'release'])
    assert.deepEqual(await on(root, 'no-such-branch', 'deploy'), [], 'a branch that is not there has none')
  } finally {
    await gone(root)
  }
})

test("Claude Code's folder kept as a link to the shared one counts that one's skills; a link to anywhere else says nothing is known, so nothing waits", async () => {
  const root = await repository()
  try {
    await skill(root, '.agents/skills', 'deploy')
    await mkdir(join(root, '.claude'), { recursive: true })
    await symlink('../.agents/skills', join(root, '.claude/skills'))
    await commit(root)
    assert.deepEqual(await on(root, 'HEAD', 'deploy', 'lint'), ['deploy'])
    await rm(join(root, '.claude/skills'))
    await skill(root, 'elsewhere', 'lint')
    await symlink('../elsewhere', join(root, '.claude/skills'))
    await commit(root)
    assert.deepEqual(await on(root, 'HEAD', 'deploy', 'lint', 'anything'), ['deploy', 'lint', 'anything'])
  } finally {
    await gone(root)
  }
})

test("runs start from origin's default branch as this clone has it, else from the branch the folder is on; a folder that is no repository has none", async () => {
  const origin = await repository()
  const plain = await realpath(await mkdtemp(join(tmpdir(), 'openagent-skills-')))
  const clone = `${plain}-clone`
  try {
    assert.deepEqual(await startBranch(origin), { ref: 'HEAD', name: 'main' }, 'no remote: the branch the folder is on')
    await git(origin, 'checkout', '-q', '-b', 'feature')
    assert.deepEqual(await startBranch(origin), { ref: 'HEAD', name: 'feature' })
    await git(origin, 'checkout', '-q', 'main')
    await git(plain, 'clone', '-q', origin, clone)
    await git(clone, 'checkout', '-q', '-b', 'mine')
    assert.deepEqual(await startBranch(clone), { ref: 'origin/main', name: 'main' }, "origin's default, whatever the folder is on")
    assert.equal(await startBranch(plain), undefined)
  } finally {
    await Promise.all([gone(origin), gone(plain), gone(clone)])
  }
})

test("Settings › Skills reads the project's own skills, each one not yet on the branch runs start from said waiting", async () => {
  const origin = await repository()
  const plain = await realpath(await mkdtemp(join(tmpdir(), 'openagent-skills-')))
  const clone = `${plain}-clone`
  try {
    await skill(origin, '.agents/skills', 'deploy')
    await commit(origin)
    await git(plain, 'clone', '-q', origin, clone)
    // Committed in the folder but not pushed, and not committed at all: a run started from origin's main has neither.
    await skill(clone, '.agents/skills', 'lint')
    await commit(clone)
    await skill(clone, '.claude/skills', 'release')
    const host = { root: clone } as RpcHost
    assert.deepEqual(await projectSkills(host, {}), {
      skills: [
        { name: 'deploy', description: 'deploy it.', command: false },
        { name: 'lint', description: 'lint it.', command: false, waiting: true },
        { name: 'release', description: 'release it.', command: false, waiting: true },
      ],
      startBranch: 'main',
    })
    assert.equal(projectSkills.rpc, 'read', 'a read, which a computer that only lets its server watch still answers')
    // A folder that is no repository: its skills, with no branch to wait for.
    await skill(plain, '.agents/skills', 'notes')
    assert.deepEqual(await projectSkills({ root: plain } as RpcHost, {}), { skills: [{ name: 'notes', description: 'notes it.', command: false }] })
  } finally {
    await Promise.all([gone(origin), gone(plain), gone(clone)])
  }
})
