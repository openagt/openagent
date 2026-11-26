import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { UiOffer } from '../module/index.js'
import { ModulesContext, mountedOf, type MountedAction } from '../lib/use-modules.js'

const { HandoffOffers } = await import('./Places.js')

// A session's next step, as its row draws it: back on a session, the step it last offered.

afterEach(cleanup)

/** The modules' answer to "what do you offer?", as each test sets it: `null` never answers. */
let answer: UiOffer | null = {}
const openPr: MountedAction<'chat.handoff'> = {
  place: 'chat.handoff',
  id: 'open-pr',
  label: 'Open PR',
  offer: () => (answer === null ? new Promise<UiOffer>(() => {}) : answer),
  package: '@openagt/github',
  module: 'github',
  projects: ['p1'],
}
const draw = (agentId: string) =>
  render(
    <ModulesContext.Provider value={mountedOf({ actions: { 'chat.handoff': [openPr] } })}>
      <HandoffOffers projectId="p1" agentId={agentId} repo="oa-newuser" />
    </ModulesContext.Provider>,
  )

describe('the next step of a session', () => {
  test('back on a session, the step it last offered is drawn at once, while the modules are asked again; another session waits for its own', async () => {
    answer = {}
    draw('r1')
    expect(await screen.findByRole('button', { name: 'Open PR' })).toBeTruthy()
    cleanup()
    // The modules slow to answer now: the step known for r1 stands meanwhile.
    answer = null
    draw('r1')
    expect(screen.getByRole('button', { name: 'Open PR' })).toBeTruthy()
    cleanup()
    draw('r2')
    expect(screen.queryByRole('button', { name: 'Open PR' })).toBeNull()
  })
})
