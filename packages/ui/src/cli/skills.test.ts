import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { SKILL_CATALOGUE_ENV, SKILLS_ENV } from '@openagt/agent-data'
import { handDownSkills } from './skills.js'
import { SKILL_NAMES } from '../project-skills/catalogue.js'
import { handDownTestDistribution } from '../test-distribution.js'

handDownTestDistribution()

/** The names of the packages at the directories `dirs` joins, each holding a skill's text. */
async function packagesAt(dirs: string): Promise<string[]> {
  return Promise.all(
    dirs.split(delimiter).map(async dir => {
      assert.match(await readFile(join(dir, 'SKILL.md'), 'utf8'), /^---\nname: /, `${dir} holds a skill's text`)
      return (JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as { name: string }).name
    }),
  )
}

test("the skills every run gets are handed down as their packages' directories, the ones the distribution names", async () => {
  const env: NodeJS.ProcessEnv = {}
  await handDownSkills(env)
  assert.deepEqual(await packagesAt(env[SKILLS_ENV]!), ['@openagt/skill-github', '@openagt/skill-ask'], "every other skill is picked on the project's Skills page")
})

test("every skill of the catalogue is handed down beside them, as its package's directory, for an agent to pick from by name", async () => {
  const env: NodeJS.ProcessEnv = {}
  await handDownSkills(env)
  assert.deepEqual(await packagesAt(env[SKILL_CATALOGUE_ENV]!), SKILL_NAMES.map(name => `@openagt/skill-${name}`))
})
