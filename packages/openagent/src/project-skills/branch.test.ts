import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { commitSkills, skillsOn, uncommittedSkills } from './branch.js'
import { applyChange } from './change.js'
import { folder, gone, run } from './test-project.js'

/** Which of `names` are on `ref`. */
async function on(root: string, ref: string, ...names: string[]): Promise<string[]> {
  const branch = await skillsOn(root, ref)
  return names.filter(name => branch.has(name))
}

test('a skill written into the folder is not on the branch until it is committed; a project\'s own skill counts by its text or by its link', async () => {
  const root = await folder(true)
  try {
    assert.deepEqual(await on(root, 'HEAD', 'maintenance', 'readability'), [])
    const changed = await applyChange(root, { write: ['maintenance', 'readability'] })
    assert.deepEqual(await on(root, 'HEAD', 'maintenance', 'readability'), [], 'written, not committed')
    assert.deepEqual(await uncommittedSkills(root), ['maintenance', 'readability'], 'two texts and two links')
    await commitSkills(root, changed.written)
    assert.deepEqual(await on(root, 'HEAD', 'maintenance', 'readability', 'plan'), ['maintenance', 'readability'])
    assert.deepEqual(await uncommittedSkills(root), [])

    // The project's own skills: a real folder where Claude Code reads, and a link to a folder kept somewhere else in the project.
    await mkdir(join(root, '.claude/skills/deploy'), { recursive: true })
    await writeFile(join(root, '.claude/skills/deploy/SKILL.md'), '---\nname: deploy\n---\nOurs.\n')
    await mkdir(join(root, 'our-skills/release'), { recursive: true })
    await writeFile(join(root, 'our-skills/release/SKILL.md'), '---\nname: release\n---\nOurs.\n')
    await symlink('../../our-skills/release', join(root, '.claude/skills/release'))
    assert.deepEqual(await on(root, 'HEAD', 'deploy', 'release'), [])
    await run(root, 'add', '-A')
    await run(root, 'commit', '-q', '-m', 'ours')
    assert.deepEqual(await on(root, 'HEAD', 'deploy', 'release', 'maintenance', 'plan'), ['deploy', 'release', 'maintenance'])
    assert.deepEqual(await on(root, 'no-such-branch', 'maintenance'), [], 'a branch that is not there has none')
  } finally {
    await gone(root)
  }
})

test('where the skills folder is itself a link: to the other skills folder, the texts are read there; to anywhere else, nothing is said to be missing', async () => {
  const root = await folder(true)
  try {
    await mkdir(join(root, '.agents/skills/maintenance'), { recursive: true })
    await writeFile(join(root, '.agents/skills/maintenance/SKILL.md'), '---\nname: maintenance\n---\n')
    await mkdir(join(root, '.claude'))
    await symlink('../.agents/skills', join(root, '.claude/skills'))
    await run(root, 'add', '-A')
    await run(root, 'commit', '-q', '-m', 'linked folder')
    assert.deepEqual(await on(root, 'HEAD', 'maintenance', 'readability'), ['maintenance'])
    // The dashboard's commit works in this shape: the text is one path, and no path goes through the link.
    await applyChange(root, { write: ['readability'] })
    assert.deepEqual(await uncommittedSkills(root), ['readability'])
    const committed = await commitSkills(root)
    assert.ok(committed.ok && committed.committed, JSON.stringify(committed))
    assert.equal(await run(root, 'show', '--format=', '--name-only', 'HEAD'), '.agents/skills/readability/SKILL.md\n')

    await rm(join(root, '.claude/skills'))
    await symlink('../shared/skills', join(root, '.claude/skills'))
    await run(root, 'add', '-A')
    await run(root, 'commit', '-q', '-m', 'linked elsewhere')
    assert.deepEqual(await on(root, 'HEAD', 'maintenance', 'anything'), ['maintenance', 'anything'], 'not known, so nothing is held back')
  } finally {
    await gone(root)
  }
})

test('the commit of every skill file that stands uncommitted takes a deleted one too, and nothing else; with names it takes those skills\' files alone', async () => {
  const root = await folder(true)
  try {
    await applyChange(root, { write: ['maintenance', 'ux'] })
    await commitSkills(root)
    await applyChange(root, { write: ['plan'], remove: ['ux'] })
    await writeFile(join(root, '.agents/skills/maintenance/SKILL.md'), 'changed by hand\n')
    await writeFile(join(root, 'README.md'), '# edited\n')
    await writeFile(join(root, 'staged.txt'), 'theirs\n')
    await run(root, 'add', 'staged.txt')
    assert.deepEqual(await uncommittedSkills(root), ['plan', 'maintenance', 'ux'], 'plan\'s text and link, ux\'s text and link, maintenance\' text')

    // By name: what a change wrote or deleted, and not the text somebody changed by hand meanwhile.
    const named = await commitSkills(root, ['plan'])
    assert.ok(named.ok && named.committed)
    assert.equal(await run(root, 'show', '--format=%s', '--name-status', 'HEAD'), 'Update OpenAgent skills\n\nA\t.agents/skills/plan/SKILL.md\nA\t.claude/skills/plan\n')
    assert.deepEqual(await uncommittedSkills(root), ['maintenance', 'ux'])
    await run(root, 'reset', '-q', '--soft', 'HEAD~1')
    await run(root, 'reset', '-q', '--', '.agents/skills/plan', '.claude/skills/plan')

    const committed = await commitSkills(root)
    assert.ok(committed.ok && committed.committed)
    assert.equal(await run(root, 'show', '--format=%s', '--name-status', 'HEAD'), 'Update OpenAgent skills\n\nM\t.agents/skills/maintenance/SKILL.md\nA\t.agents/skills/plan/SKILL.md\nD\t.agents/skills/ux/SKILL.md\nA\t.claude/skills/plan\nD\t.claude/skills/ux\n')
    assert.equal(await run(root, 'status', '--porcelain'), ' M README.md\nA  staged.txt\n')
    assert.deepEqual(await uncommittedSkills(root), [])
    assert.deepEqual(await commitSkills(root), { ok: true, committed: false }, 'nothing left to commit')
    await rm(join(root, 'staged.txt'))
  } finally {
    await gone(root)
  }
})
