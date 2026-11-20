import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import plugin from './plugin.js'

test('the queue gives its runs its skill with its command, and work-queue, each a folder holding its SKILL.md', async () => {
  const skills = await plugin.hooks['run.skills']!({})
  assert.deepEqual(skills.map(skill => [skill.name, skill.command]), [['queue', 'queue'], ['work-queue', undefined]])
  for (const skill of skills) {
    const text = await readFile(new URL('SKILL.md', skill.dir), 'utf8')
    assert.match(text, new RegExp(`^---\\nname: ${skill.name}\\n`), `${skill.name}'s own text`)
  }
})
