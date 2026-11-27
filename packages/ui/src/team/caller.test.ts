import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { TeamCaller } from '@openagt/hooks'
import { runOptionsOf } from '../daemon-runtime.js'
import { asCaller, currentCaller } from './caller.js'

// Who a request is for reaches what it calls, and a run it starts is for the one signed in: never
// for whom a page says.

const DANI: TeamCaller = { login: 'nitedani', owner: true, teamOwner: 'nitedani' }
const SULEIMAN: TeamCaller = { login: 'suleimansh', owner: false, teamOwner: 'nitedani' }

test('the caller reaches what the request calls, now or later, and nothing outside it', async () => {
  assert.equal(currentCaller(), undefined)
  const seen = await asCaller(SULEIMAN, async () => {
    await new Promise(resolve => setTimeout(resolve, 1))
    return currentCaller()
  })
  assert.deepEqual(seen, SULEIMAN)
  assert.equal(currentCaller(), undefined)
})

test('a run started is for the one signed in; a caller the page sends is dropped', () => {
  const forged = { options: { caller: DANI, github: { account: 'bot' } } } as Parameters<typeof runOptionsOf>[0]
  assert.deepEqual(
    asCaller(SULEIMAN, () => runOptionsOf(forged, 'commit')),
    { publish: 'commit', github: { account: 'bot' }, caller: SULEIMAN },
  )
  // On a machine of one person, no caller at all.
  assert.deepEqual(runOptionsOf(forged, undefined), { github: { account: 'bot' } })
})
