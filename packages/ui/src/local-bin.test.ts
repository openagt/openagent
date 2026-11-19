import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { withLocalBin } from './local-bin.js'

test('~/.local/bin goes on the PATH once, last', () => {
  const env: NodeJS.ProcessEnv = { HOME: '/home/p', PATH: '/usr/bin:/bin' }
  withLocalBin(env)
  assert.equal(env['PATH'], '/usr/bin:/bin:/home/p/.local/bin')
  withLocalBin(env)
  assert.equal(env['PATH'], '/usr/bin:/bin:/home/p/.local/bin')
  const empty: NodeJS.ProcessEnv = { HOME: '/home/p' }
  withLocalBin(empty)
  assert.equal(empty['PATH'], '/home/p/.local/bin')
})
