import { describe, expect, test } from 'vitest'
import type { UiAction, UiActionAt } from '@openagt/ui/module'
import tickets from './index.js'
import { fakeHost } from './test-host.js'
import { POPULATE_ACTION, populateId, UPDATE_TICKETS_PROMPT } from '../src/module.js'

// "Update tickets", the fix of this computer's step "Populate the tickets" (`../src/attention.ts`):
// a run on the update prompt, in the project the step's item names.
const fix = tickets.hooks['ui.action']!.find((action: UiAction): action is UiActionAt<'attention.fix'> => action.place === 'attention.fix' && action.id === POPULATE_ACTION)!

describe('the fix of "Populate the tickets"', () => {
  test("starts the update in the item's project", async () => {
    const host = fakeHost()
    expect(await fix.run!(host, { item: populateId('shop-1') })).toEqual({ ok: true })
    expect(host.startRun.mock.calls).toEqual([['shop-1', UPDATE_TICKETS_PROMPT]])
  })

  test('a refused start says why; an item that names no project starts nothing', async () => {
    const host = fakeHost()
    host.startRun.mockResolvedValueOnce({ ok: false, error: 'a session is already active' })
    expect(await fix.run!(host, { item: populateId('shop-1') })).toEqual({ ok: false, error: 'a session is already active' })
    expect(await fix.run!(host, { item: 'other' })).toEqual({ ok: false, error: 'No project to update the tickets of.' })
    expect(host.startRun).toHaveBeenCalledOnce()
  })
})
