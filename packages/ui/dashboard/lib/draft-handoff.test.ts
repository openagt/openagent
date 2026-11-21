import { afterEach, describe, expect, test } from 'vitest'
import { stashPendingDraft, takePendingDraft } from './draft-handoff.js'

// jsdom provides sessionStorage, so these round-trip real.
afterEach(() => sessionStorage.clear())

describe('a draft carried across a navigation (#1139)', () => {
  test('takePendingDraft returns then clears the stash', () => {
    stashPendingDraft('ship the thing')
    expect(takePendingDraft()).toBe('ship the thing')
    expect(takePendingDraft()).toBeNull() // cleared, so a reload does not re-seed it
  })

  test('with nothing carried there is nothing to take', () => {
    expect(takePendingDraft()).toBeNull()
  })
})
