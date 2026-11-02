import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { SKILLS_ENV } from '@openagt/agent-data'
import { DEFAULT_SKILLS, handDownSkills } from './skills.js'

test('the default skills are handed down as their packages\' directories, in the list\'s order', async () => {
  const env: NodeJS.ProcessEnv = {}
  await handDownSkills(env)
  const dirs = env[SKILLS_ENV]!.split(delimiter)
  const names = await Promise.all(dirs.map(async dir => (JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as { name: string }).name))
  assert.deepEqual(names, [...DEFAULT_SKILLS])
  assert.ok(names.includes('@openagt/skill-account-rotation'), 'accounts are the computer\'s, so every run gets their skill')
  for (const dir of dirs) assert.match(await readFile(join(dir, 'SKILL.md'), 'utf8'), /^---\nname: /, `${dir} holds a skill's text`)
})
