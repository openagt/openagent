import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nodeGitRunner } from '@openagt/git-branches'
import { leftOutSkillPaths, projectSkillNames } from './left-out.js'

const git = nodeGitRunner()

test("the project's own skills are the entries git tracks under .agents/skills and .claude/skills; the paths left out are those of every one a pick does not keep", async () => {
  const repo = await realpath(await mkdtemp(join(tmpdir(), 'openagent-skills-left-out-')))
  try {
    await git(['init', '-q', '-b', 'main'], repo)
    await mkdir(join(repo, '.agents', 'skills', 'deploy'), { recursive: true })
    await writeFile(join(repo, '.agents', 'skills', 'deploy', 'SKILL.md'), '---\nname: deploy\n---\n')
    await mkdir(join(repo, '.agents', 'skills', 'work-queue'), { recursive: true })
    await writeFile(join(repo, '.agents', 'skills', 'work-queue', 'SKILL.md'), '---\nname: work-queue\n---\n')
    await mkdir(join(repo, '.claude', 'skills'), { recursive: true })
    await symlink('../../.agents/skills/deploy', join(repo, '.claude', 'skills', 'deploy'))
    // A skill Claude Code alone has, as a folder of its own.
    await mkdir(join(repo, '.claude', 'skills', 'lint'))
    await writeFile(join(repo, '.claude', 'skills', 'lint', 'SKILL.md'), '---\nname: lint\n---\n')
    await git(['add', '-A'], repo)
    await git(['-c', 'user.name=tester', '-c', 'user.email=tester@example.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'skills'], repo)
    // One not committed is not the project's yet.
    await mkdir(join(repo, '.agents', 'skills', 'draft'))
    await writeFile(join(repo, '.agents', 'skills', 'draft', 'SKILL.md'), '---\nname: draft\n---\n')
    assert.deepEqual((await projectSkillNames(repo)).sort(), ['deploy', 'lint', 'work-queue'])
    assert.deepEqual(await leftOutSkillPaths(repo, undefined), [], 'every skill: nothing left out')
    assert.deepEqual(await leftOutSkillPaths(repo, 'all'), [])
    assert.deepEqual((await leftOutSkillPaths(repo, 'none')).sort(), ['.agents/skills/deploy', '.agents/skills/lint', '.agents/skills/work-queue', '.claude/skills/deploy', '.claude/skills/lint', '.claude/skills/work-queue'])
    assert.deepEqual(await leftOutSkillPaths(repo, ['deploy', 'work-queue']), ['.claude/skills/lint', '.agents/skills/lint'])
    assert.deepEqual(await leftOutSkillPaths(repo, ['deploy', 'lint', 'work-queue', 'nothing']), [])
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('a folder with no git has no project skills', async () => {
  assert.deepEqual(await projectSkillNames('/nowhere/at/all'), [])
})
