import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { DISTRIBUTION_ENV, loadHandedDown } from '@openagt/hooks'
import { handDownDistribution } from './distribution.js'

test("the distribution handed down is the dashboard's file, and its packages load from the dashboard's install", async () => {
  const env: NodeJS.ProcessEnv = {}
  handDownDistribution(env)
  assert.match(env[DISTRIBUTION_ENV] ?? '', /distribution\.js$/)
  const modules = await loadHandedDown(env)
  assert.deepEqual(
    modules?.map(entry => entry.module.name),
    ['git-branches', 'github', 'agent-driver'],
  )
})
