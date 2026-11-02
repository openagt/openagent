import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readProjectCommands } from './project-commands.js'

async function skill(cwd: string, dir: string, name: string, skillMd: string | undefined): Promise<void> {
  await mkdir(join(cwd, dir, name), { recursive: true })
  if (skillMd !== undefined) await writeFile(join(cwd, dir, name, 'SKILL.md'), skillMd)
}

test('a project\'s commands are its skills written to be run by a person, from both folders, each once, by name', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'openagent-commands-'))
  try {
    await skill(cwd, '.claude/skills', 'work-queue', '---\nname: work-queue\ndescription: Work the agent queue.\ndisable-model-invocation: true\n---\nDo it.\n')
    // The same skill in the shared folder is the same command: the first copy decides.
    await skill(cwd, '.agents/skills', 'work-queue', '---\ndescription: another copy\ndisable-model-invocation: true\n---\n')
    await skill(cwd, '.agents/skills', 'ux', '---\nname: ux\ndisable-model-invocation: true\n---\nReview the flows.\n')
    // A skill that teaches the agent how to do something is no command, nor one only the agent may use.
    await skill(cwd, '.agents/skills', 'tickets', '---\nname: tickets\ndescription: "Where the tickets live."\n---\n# Tickets\n')
    await skill(cwd, '.claude/skills', 'ldd', '---\ndescription: internal\nuser-invocable: false\n---\n')
    // A later folder's copy does not turn a skill into a command.
    await skill(cwd, '.claude/skills', 'queue', '---\nname: queue\n---\n')
    await skill(cwd, '.agents/skills', 'queue', '---\nname: queue\ndisable-model-invocation: true\n---\n')
    // No front matter, and front matter that does not parse, say nothing: no command.
    await skill(cwd, '.claude/skills', 'bare', 'Just words.\n')
    await skill(cwd, '.claude/skills', 'broken', '---\ndisable-model-invocation: [\n---\n')
    // A folder without a SKILL.md, and a name no slash command could have, are skipped.
    await skill(cwd, '.claude/skills', 'empty', undefined)
    await skill(cwd, '.claude/skills', 'Not A Command', '---\ndisable-model-invocation: true\n---\n')

    assert.deepEqual(await readProjectCommands(cwd), [
      { name: 'ux' },
      { name: 'work-queue', description: 'Work the agent queue.' },
    ])
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('a project with no skills folder has no commands', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'openagent-commands-'))
  try {
    assert.deepEqual(await readProjectCommands(cwd), [])
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})
