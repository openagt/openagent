import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import plugin from './plugin.js'

test('the tickets give their runs their skill with its command, and the commands about them, each a folder holding its SKILL.md', async () => {
  const skills = await plugin.hooks['run.skills']!({})
  assert.deepEqual(
    skills.map(skill => [skill.name, skill.command]),
    [['tickets', 'tickets'], ['plan', undefined], ['plan-tickets', undefined], ['triage', undefined], ['update-tickets', undefined], ['suggest-tickets-to-work-on', undefined]],
  )
  for (const skill of skills) {
    const text = await readFile(new URL('SKILL.md', skill.dir), 'utf8')
    assert.match(text, new RegExp(`^---\\nname: ${skill.name}\\n`), `${skill.name}'s own text`)
  }
})
