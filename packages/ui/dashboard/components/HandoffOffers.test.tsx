import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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

  test("its arrow lists every choice, the press too, as Claude Code's Create PR does, a line above the first that loses something", async () => {
    const action = (id: string, label: string, rank: number, offer: UiOffer = {}): MountedAction<'chat.handoff'> => ({ place: 'chat.handoff', id, label, offer: () => ({ rank, ...offer }), package: '@openagt/github', module: 'github', projects: ['p1'] })
    render(
      <ModulesContext.Provider value={mountedOf({ actions: { 'chat.handoff': [action('close-pr', 'Close PR', 70, { danger: true }), action('merge-pr', 'Merge PR', 20), action('pr-page', 'Open on GitHub', 60)] } })}>
        <HandoffOffers projectId="p1" agentId="r3" />
      </ModulesContext.Provider>,
    )
    expect(await screen.findByRole('button', { name: 'Merge PR' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Other choices' }))
    const menu = await screen.findByRole('menu')
    expect([...menu.querySelectorAll('[role="menuitem"], [role="separator"]')].map(one => (one.getAttribute('role') === 'separator' ? '—' : one.textContent))).toEqual(['Merge PR', 'Open on GitHub', '—', 'Close PR'])
    expect(screen.getByRole('menuitem', { name: 'Close PR' }).className).toContain('text-danger')
  })
})
