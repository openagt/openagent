import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { commitSkills } from './branch.js'
import { applyChange } from './change.js'
import { commitPaths } from './commit.js'
import { folder, gone, run } from './test-project.js'

test('the one commit holds the skill files alone: a file the person staged stays staged, and their edits stay theirs', async () => {
  const root = await folder(true)
  try {
    await writeFile(join(root, 'staged.txt'), 'theirs\n')
    await run(root, 'add', 'staged.txt')
    await writeFile(join(root, 'README.md'), '# edited\n')

    await applyChange(root, { write: ['plan-tickets', 'reply'] })
    const added = await commitSkills(root, ['plan-tickets', 'reply'])
    assert.ok(added.ok && added.committed && /^[0-9a-f]{7,}$/.test(added.commit!))
    assert.equal(await run(root, 'show', '--format=', '--name-only', 'HEAD'), '.agents/skills/plan-tickets/SKILL.md\n.agents/skills/reply/SKILL.md\n.claude/skills/plan-tickets\n.claude/skills/reply\n')
    assert.equal(await run(root, 'status', '--porcelain'), ' M README.md\nA  staged.txt\n', 'what the person had open is as they left it')

    await applyChange(root, { remove: ['reply'] })
    await commitSkills(root, ['reply'])
    assert.equal(await run(root, 'show', '--format=', '--name-status', 'HEAD'), 'D\t.agents/skills/reply/SKILL.md\nD\t.claude/skills/reply\n')
    assert.equal(await run(root, 'status', '--porcelain'), ' M README.md\nA  staged.txt\n')

    // Nothing changed at the paths: no commit, and no error.
    assert.deepEqual(await commitPaths(root, ['.agents/skills/plan-tickets/SKILL.md', '.agents/skills/never/SKILL.md'], 'again'), { ok: true, committed: false })
  } finally {
    await gone(root)
  }
})

test('a project whose ignore rules cover the skill folders is told so, and nothing is left staged', async () => {
  const root = await folder(true)
  try {
    await writeFile(join(root, '.gitignore'), '.claude/\n')
    await run(root, 'add', '.gitignore')
    await run(root, 'commit', '-q', '-m', 'ignore')
    await applyChange(root, { write: ['plan-tickets'] })
    assert.deepEqual(await commitSkills(root, ['plan-tickets']), { ok: false, error: 'git ignores .claude/skills/plan-tickets: an ignore rule of this project, or of yours, covers it' })
    assert.equal(await run(root, 'status', '--porcelain', '-uall'), '?? .agents/skills/plan-tickets/SKILL.md\n', 'written, and nothing staged')
  } finally {
    await gone(root)
  }
})
