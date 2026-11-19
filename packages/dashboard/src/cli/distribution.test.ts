import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { DISTRIBUTION_ENV, LOCAL_HOST, loadHandedDown } from '@openagt/hooks'
import { loadHooks, localHostOf } from '../distribution-hooks.js'
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
  const demo: NodeJS.ProcessEnv = { [DISTRIBUTION_ENV]: '/demo/distribution.js' }
  handDownDistribution(demo)
  assert.equal(demo[DISTRIBUTION_ENV], '/demo/distribution.js', 'one handed down to the dashboard is kept')
})

test("with none handed down, the dashboard runs its own distribution, and this computer's host is agent-driver's", async () => {
  const hooks = await loadHooks({})
  assert.deepEqual(hooks.modules.map(module => module.name), ['git-branches', 'github', 'agent-driver'])
  assert.equal((await localHostOf(hooks)).id, LOCAL_HOST)
})
