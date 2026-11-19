import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { SKILL_CATALOGUE_ENV, SKILLS_ENV } from '@openagt/agent-data'
import { DEFAULT_SKILLS, handDownSkills } from './skills.js'
import { SKILL_NAMES } from '../project-skills/catalogue.js'

test('the default skills are handed down as their packages\' directories, in the list\'s order', async () => {
  const env: NodeJS.ProcessEnv = {}
  await handDownSkills(env)
  const dirs = env[SKILLS_ENV]!.split(delimiter)
  const names = await Promise.all(dirs.map(async dir => (JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as { name: string }).name))
  assert.deepEqual(names, [...DEFAULT_SKILLS])
  assert.deepEqual(names, ['@openagt/skill-ask', '@openagt/skill-github'], 'every other skill is picked on the project\'s Skills page')
  for (const dir of dirs) assert.match(await readFile(join(dir, 'SKILL.md'), 'utf8'), /^---\nname: /, `${dir} holds a skill's text`)
})

test('every skill of the catalogue is handed down beside them, as its package\'s directory, for an agent to pick from by name', async () => {
  const env: NodeJS.ProcessEnv = {}
  await handDownSkills(env)
  const dirs = env[SKILL_CATALOGUE_ENV]!.split(delimiter)
  const names = await Promise.all(dirs.map(async dir => (JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as { name: string }).name))
  assert.deepEqual(names, SKILL_NAMES.map(name => `@openagt/skill-${name}`))
  for (const dir of dirs) assert.match(await readFile(join(dir, 'SKILL.md'), 'utf8'), /^---\nname: /, `${dir} holds a skill's text`)
})
