import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readProjectSkills } from './project-skills.js'

async function skill(root: string, dir: string, name: string, text: string | undefined): Promise<void> {
  await mkdir(join(root, dir, name), { recursive: true })
  if (text !== undefined) await writeFile(join(root, dir, name, 'SKILL.md'), text)
}

test("a project's own skills: every one in either folder, each once, by name, with what it says of itself and whether it is a command", async () => {
  const root = await mkdtemp(join(tmpdir(), 'openagent-skills-'))
  try {
    await skill(root, '.claude/skills', 'work-queue', '---\nname: work-queue\ndescription: Work the agent queue.\ndisable-model-invocation: true\n---\nDo it.\n')
    // The same skill in the shared folder is the same skill: the first copy decides.
    await skill(root, '.agents/skills', 'work-queue', '---\ndescription: another copy\n---\n')
    await skill(root, '.agents/skills', 'ux', '---\nname: ux\ndisable-model-invocation: true\n---\nReview the flows.\n')
    // A skill that teaches the agent how to do something is a skill, and no command.
    await skill(root, '.agents/skills', 'tickets', '---\nname: tickets\ndescription: "Where the tickets live."\n---\n# Tickets\n')
    await skill(root, '.claude/skills', 'ldd', '---\ndescription: internal\nuser-invocable: false\n---\n')
    // A later folder's copy does not turn a skill into a command.
    await skill(root, '.claude/skills', 'queue', '---\nname: queue\n---\n')
    await skill(root, '.agents/skills', 'queue', '---\nname: queue\ndisable-model-invocation: true\n---\n')
    // No front matter, and front matter that does not parse, say nothing of it.
    await skill(root, '.claude/skills', 'bare', 'Just words.\n')
    await skill(root, '.claude/skills', 'broken', '---\ndisable-model-invocation: [\n---\n')
    // Claude Code's copy as a link to a text kept elsewhere in the project.
    await skill(root, 'our-skills', 'release', '---\ndescription: Cut a release.\n---\n')
    await symlink('../../our-skills/release', join(root, '.claude/skills/release'))
    // A folder without a SKILL.md, and a name no agent lists a skill by, are none.
    await skill(root, '.claude/skills', 'empty', undefined)
    await skill(root, '.claude/skills', 'Not A Skill', '---\ndescription: no\n---\n')

    assert.deepEqual(await readProjectSkills(root), [
      { name: 'bare', command: false },
      { name: 'broken', command: false },
      { name: 'ldd', description: 'internal', command: false },
      { name: 'queue', command: false },
      { name: 'release', description: 'Cut a release.', command: false },
      { name: 'tickets', description: 'Where the tickets live.', command: false },
      { name: 'ux', command: true },
      { name: 'work-queue', description: 'Work the agent queue.', command: true },
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a project with no skills folder has no skills', async () => {
  const root = await mkdtemp(join(tmpdir(), 'openagent-skills-'))
  try {
    assert.deepEqual(await readProjectSkills(root), [])
    assert.deepEqual(await readProjectSkills(join(root, 'not-there')), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
