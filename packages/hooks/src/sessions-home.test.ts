import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { sessionsHome } from './sessions-home.js'

test('the sessions home sits beside the personal folder, never in it', () => {
  assert.equal(sessionsHome({ XDG_CONFIG_HOME: '/x' }), '/x/openagent-sessions')
  assert.equal(sessionsHome({ HOME: '/home/me' }), '/home/me/.openagent-sessions')
})
