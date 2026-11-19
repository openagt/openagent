import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { projectId } from '@openagt/agent-data'
import { SCHEDULED_COMMANDS } from '@openagt/hooks'
import { memorySettings, rpcHost } from '@openagt/hooks/testing'
import { taker } from './server.js'

test("who takes from the queue is the scheduler's switch and pace for work-queue on this computer, in this project alone", async () => {
  const settings = memorySettings()
  const host = rpcHost({ root: '/work/shop', settings })
  assert.deepEqual(await taker(host, {}), { on: false }, 'nothing switched on')
  const on = '2026-10-03T08:00:00.000Z'
  await settings.set(SCHEDULED_COMMANDS, { [projectId('/work/shop')]: { 'work-queue': { on, pace: { every: '6h', since: on } }, triage: { on } }, [projectId('/work/other')]: { 'work-queue': { on } } })
  assert.deepEqual(await taker(host, {}), { on: true, pace: { every: '6h', since: on } })
  // A pace set while it is off: still off.
  await settings.set(SCHEDULED_COMMANDS, { [projectId('/work/shop')]: { 'work-queue': { pace: { work: true } } } })
  assert.deepEqual(await taker(host, {}), { on: false, pace: { work: true } })
})
