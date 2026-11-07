import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { leftOutSkillPaths, projectSkillNames } from './project-skills.js'
import { git, removeRepo, testRepo } from './test-repo.js'

test('the project\'s own skills are the entries git tracks under .agents/skills and .claude/skills; the paths left out are those of every one a pick does not keep', async () => {
  const repo = await testRepo()
  try {
    await mkdir(join(repo, '.agents', 'skills', 'deploy'), { recursive: true })
    await writeFile(join(repo, '.agents', 'skills', 'deploy', 'SKILL.md'), '---\nname: deploy\n---\n')
    await mkdir(join(repo, '.claude', 'skills'), { recursive: true })
    await symlink('../../.agents/skills/deploy', join(repo, '.claude', 'skills', 'deploy'))
    // A skill Claude Code alone has, as a folder of its own.
    await mkdir(join(repo, '.claude', 'skills', 'lint'))
    await writeFile(join(repo, '.claude', 'skills', 'lint', 'SKILL.md'), '---\nname: lint\n---\n')
    await git(['add', '-A'], repo)
    await git(['commit', '-m', 'skills'], repo)
    // One not committed is not the project's yet. (The test repo tracks a work-queue skill of its own already.)
    await mkdir(join(repo, '.agents', 'skills', 'draft'))
    await writeFile(join(repo, '.agents', 'skills', 'draft', 'SKILL.md'), '---\nname: draft\n---\n')
    assert.deepEqual(await projectSkillNames(repo), ['deploy', 'lint', 'work-queue'])
    assert.deepEqual(await leftOutSkillPaths(repo, undefined), [], 'every skill: nothing left out')
    assert.deepEqual(await leftOutSkillPaths(repo, 'none'), ['.agents/skills/deploy', '.claude/skills/deploy', '.agents/skills/lint', '.claude/skills/lint', '.agents/skills/work-queue', '.claude/skills/work-queue'])
    assert.deepEqual(await leftOutSkillPaths(repo, ['deploy', 'work-queue']), ['.agents/skills/lint', '.claude/skills/lint'])
    assert.deepEqual(await leftOutSkillPaths(repo, ['deploy', 'lint', 'work-queue', 'nothing']), [])
  } finally {
    await removeRepo(repo)
  }
})

test('a folder with no git has no project skills', async () => {
  assert.deepEqual(await projectSkillNames('/nowhere/at/all'), [])
})
