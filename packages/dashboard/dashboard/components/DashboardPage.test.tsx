import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ActiveAgent, Intervention } from '../../src/index.js'

// The Overview's own layout: its cards on a grid, ordered, sized and hidden by the person's layout
// for the page (#overview layouts). The cards are tested on their own; here they are stand-ins, the
// agents at work are handed in as the shell reads them, and the preferences are a plain object a write changes.
vi.mock('./Quota.js', () => ({ Quota: () => <div>usage</div> }))
vi.mock('./OnboardingChecklist.js', () => ({ OnboardingChecklist: () => <div>onboarding</div> }))
vi.mock('./SkillsCard.js', () => ({ SkillsCard: () => <div>skills</div> }))
vi.mock('./YourAgentsTile.js', () => ({ YourAgentsTile: () => <div>your agents</div> }))
vi.mock('./ModuleCards.js', () => ({
  useModuleCards: () => [{ id: '@x/tickets/hot', label: 'Hot tickets', width: '1/2', minWidth: '1/3', present: true, node: <div>a package's card</div> }],
}))
const prefs = vi.hoisted(() => ({ value: { onboardingDismissed: true } as Record<string, unknown>, loaded: true, updatePreferences: vi.fn() }))
vi.mock('../lib/preferences.js', () => ({ usePreferences: () => prefs.value, usePreferencesLoaded: () => prefs.loaded, updatePreferences: prefs.updatePreferences }))

const { DashboardPage } = await import('./DashboardPage.js')
const { FADE_AFTER_MS } = await import('./FadeWhileStale.js')

const active = (agentId: string, projectId = 'p1'): ActiveAgent => ({ projectId, projectName: projectId, agentId, cwd: `/repos/${agentId}`, status: 'running', startedAt: '2026-07-25T09:00:00.000Z', updatedAt: '2026-07-25T10:00:00.000Z', intent: `working on ${agentId}` })
const projects = [{ id: 'p1', name: 'alpha' }, { id: 'p2', name: 'beta' }] as never[]
/** The agents at work, as the shell read them. */
let working: ActiveAgent[] = []
const show = (scope: string | null = null, stale = { interventions: false, active: false }, loaded = true) =>
  render(<DashboardPage onProjectAdded={() => {}} onSelectProject={() => {}} projectHref={id => `/${id}`} onSelectAgent={() => {}} onAgentStarted={() => {}} interventions={[]} interventionsStale={stale.interventions} interventionsLoaded={loaded} active={{ active: working, stale: stale.active, loaded }} projects={projects} scope={scope} />)
/** The cards drawn, in order, each with its grid classes. */
const drawn = () => [...document.querySelectorAll<HTMLElement>('[data-card]')].map(el => ({ id: el.dataset['card'], spans: el.className }))

beforeEach(() => {
  working = []
  prefs.value = { onboardingDismissed: true }
  prefs.loaded = true
  prefs.updatePreferences.mockReset()
})
afterEach(cleanup)

describe('the Overview', () => {
  test('with no layout picked, the cards stand in their own order and widths, the tiles first; the agents at work show even while none works', async () => {
    working = []
    show()
    await screen.findByText('Human Queue')
    expect(drawn().map(card => card.id)).toEqual(['needs-you', 'working-now', 'your-agents', 'usage', 'human-queue', 'working', 'skills', '@x/tickets/hot'])
    expect(screen.getByText('No agent is at work.')).toBeTruthy()
    // Full width is the whole row at every size; a third is a half once the column has the room, a
    // third once it is wide; a quarter (the number tiles) a third, then a quarter; a row's cards fill it.
    expect(drawn()[0]!.spans).toContain('@4xl:basis-[calc(25%_-_1.5rem)]')
    expect(drawn()[4]!.spans).toContain('basis-full')
    expect(drawn()[4]!.spans).not.toMatch(/@\w+:basis-/)
    expect(drawn()[7]!.spans).toContain('@2xl:basis-[calc(50%_-_1rem)]')
    expect(drawn()[7]!.spans).toContain('grow-[6]')
    cleanup()
    working = [active('r1', 'p1')]
    show()
    expect(await screen.findByText('working on r1')).toBeTruthy()
    expect(drawn().map(card => card.id)).toEqual(['needs-you', 'working-now', 'your-agents', 'usage', 'human-queue', 'working', 'skills', '@x/tickets/hot'])
    cleanup()
    // With a project picked, only that project's agents count.
    show('p2')
    await screen.findByText('Human Queue')
    expect(screen.queryByText('working on r1')).toBeNull()
  })

  test('a layout orders, sizes and hides the cards; one it does not name comes after, at its own width; a width narrower than a card fits is not kept', async () => {
    working = []
    prefs.value = {
      onboardingDismissed: true,
      overviewLayouts: { '*': [{ id: '@x/tickets/hot', width: '1/3' }, { id: 'usage', hidden: true }, { id: 'human-queue', width: '1/4' }, { id: 'gone' }, { id: 'needs-you', width: '1/4' }] },
    }
    show()
    await screen.findByText('Human Queue')
    expect(drawn().map(card => card.id)).toEqual(['@x/tickets/hot', 'human-queue', 'needs-you', 'working-now', 'your-agents', 'working', 'skills'])
    expect(screen.queryByText('usage')).toBeNull()
    expect(drawn()[0]!.spans).toContain('@5xl:basis-[calc(33.333%_-_1.333rem)]')
    // The Human Queue fits half at the narrowest: a quarter is passed over for its own width, the whole row.
    expect(drawn()[1]!.spans).not.toMatch(/@\w+:basis-/)
    expect(drawn()[2]!.spans).toContain('@4xl:basis-[calc(25%_-_1.5rem)]')
  })

  test("a project's layout is its own; a project never arranged is laid out as all projects are", async () => {
    working = []
    prefs.value = { onboardingDismissed: true, overviewLayouts: { '*': [{ id: 'human-queue' }], p1: [{ id: '@x/tickets/hot' }] } }
    show('p1')
    await screen.findByText('Human Queue')
    expect(drawn()[0]!.id).toBe('@x/tickets/hot')
    cleanup()
    show('p2')
    await screen.findByText('Human Queue')
    expect(drawn()[0]!.id).toBe('human-queue')
  })

  test('Customize arranges the page on its cards: a width, ✕ to the tray, + back from it, the arrow keys to move; each change is this page\'s layout at once', async () => {
    working = []
    prefs.value = { onboardingDismissed: true, overviewLayouts: { '*': [{ id: 'usage' }], p1: [{ id: 'usage' }, { id: 'needs-you', hidden: true }] } }
    show('p1')
    fireEvent.click(await screen.findByRole('button', { name: 'Customize' }))
    expect(screen.getByRole('status').textContent).toMatch(/Arranging the layout for alpha/)
    // Every shown card has its bar; the agents at work, though none works, are there to be placed.
    expect(screen.getAllByRole('toolbar').map(bar => bar.getAttribute('aria-label'))).toEqual(['Usage', 'Working now', 'Your agents', 'Human Queue', 'Agents at work', 'Skills', 'Hot tickets'])
    // The card hidden waits in the tray.
    const tray = within(screen.getByRole('region', { name: 'Cards not on the page' }))
    expect(tray.getAllByRole('listitem').map(item => item.getAttribute('aria-label'))).toEqual(['Needs you'])
    const saved = () => (prefs.updatePreferences.mock.lastCall![0] as { overviewLayouts: Record<string, { id: string; hidden?: true; width?: string }[]> }).overviewLayouts
    // A width: only the ones it fits are offered.
    const widths = within(screen.getByRole('group', { name: 'Width of Hot tickets' }))
    expect(widths.getAllByRole('button').map(button => button.textContent)).toEqual(['⅓', '½', '⅔', '¾', 'Full'])
    fireEvent.click(widths.getByRole('button', { name: 'Full' }))
    expect(saved()['p1']!.find(place => place.id === '@x/tickets/hot')).toEqual({ id: '@x/tickets/hot', width: '1' })
    // ✕ takes a card off the page.
    fireEvent.click(screen.getByRole('button', { name: 'Take Human Queue off the page' }))
    expect(saved()['p1']!.find(place => place.id === 'human-queue')).toEqual({ id: 'human-queue', hidden: true })
    // + brings one back, at the end.
    fireEvent.click(tray.getByRole('button', { name: 'Add Needs you' }))
    expect(saved()['p1']!.map(place => place.id).at(-1)).toBe('needs-you')
    expect(saved()['p1']!.at(-1)).toEqual({ id: 'needs-you' })
    // The arrow keys on a card's handle move it among the cards on the page: Usage passes Working now.
    // (Each press here is read against the layout the page started with: the stand-in preferences do not change.)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Move Usage: arrow keys' }), { key: 'ArrowRight' })
    expect(saved()['p1']!.map(place => place.id)).toEqual(['needs-you', 'working-now', 'usage', 'your-agents', 'human-queue', 'working', 'skills', '@x/tickets/hot'])
    // Back to the all-projects layout: the project's own is forgotten, and the other layouts stay.
    fireEvent.click(screen.getByRole('button', { name: 'Use the all-projects layout' }))
    expect(saved()).toEqual({ '*': [{ id: 'usage' }] })
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('toolbar')).toBeNull()
  })

  test("while the page is arranged, a card's own buttons are asleep: no focus, no press", async () => {
    show()
    fireEvent.click(await screen.findByRole('button', { name: 'Customize' }))
    // The press that took Customize away hands the keyboard to Done, not to the page.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Done' }))
    expect(screen.getByText("a package's card").closest('[inert]')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.getByText("a package's card").closest('[inert]')).toBeNull()
  })

  test('a card dragged from the tray shows where it lands, a bar beside the card under the pointer or at the end, and lands there', async () => {
    working = []
    prefs.value = { onboardingDismissed: true, overviewLayouts: { '*': [{ id: 'needs-you', hidden: true }] } }
    show()
    fireEvent.click(await screen.findByRole('button', { name: 'Customize' }))
    const chip = within(screen.getByRole('region', { name: 'Cards not on the page' })).getByRole('listitem', { name: 'Needs you' })
    const transfer = { dataTransfer: { effectAllowed: '', setData: () => {} } }
    fireEvent.dragStart(chip, transfer)
    expect(document.querySelector('[data-drop]')).toBeNull()
    // Over a card's first half: the bar stands at its start, and nothing on the page moves.
    const ids = drawn().map(card => card.id)
    const usage = document.querySelector('[data-card="usage"]')!
    fireEvent.dragOver(usage, { ...transfer, clientX: 0 })
    expect(usage.querySelector('[data-drop="before"]')).toBeTruthy()
    expect(document.querySelectorAll('[data-drop]')).toHaveLength(1)
    expect(drawn().map(card => card.id)).toEqual(ids)
    fireEvent.drop(usage, transfer)
    const saved = (prefs.updatePreferences.mock.lastCall![0] as { overviewLayouts: Record<string, { id: string }[]> }).overviewLayouts
    const order = saved['*']!.map(place => place.id)
    expect(order.indexOf('needs-you')).toBe(order.indexOf('usage') - 1)
    expect(saved['*']!.find(place => place.id === 'needs-you')).toEqual({ id: 'needs-you' })
    expect(document.querySelector('[data-drop]')).toBeNull()
    // Over the page's empty room: at the end, the bar after the last card.
    fireEvent.dragStart(chip, transfer)
    fireEvent.dragOver(usage.parentElement!, transfer)
    expect(document.querySelector('[data-card]:last-child [data-drop="after"]')).toBeTruthy()
  })

  test('a card dragged on the page leaves the page still, shows where it lands, and moves only when dropped', async () => {
    working = []
    show()
    fireEvent.click(await screen.findByRole('button', { name: 'Customize' }))
    const transfer = { dataTransfer: { effectAllowed: '', setData: () => {} } }
    const before = drawn().map(card => card.id)
    fireEvent.dragStart(document.querySelector('[data-card="needs-you"]')!, transfer)
    fireEvent.dragOver(document.querySelector('[data-card="human-queue"]')!, { ...transfer, clientX: 0 })
    // Nothing has moved; the bar says where it goes.
    expect(drawn().map(card => card.id)).toEqual(before)
    expect(document.querySelector('[data-card="human-queue"] [data-drop="before"]')).toBeTruthy()
    expect(prefs.updatePreferences).not.toHaveBeenCalled()
    fireEvent.drop(document.querySelector('[data-card="human-queue"]')!, transfer)
    const order = (prefs.updatePreferences.mock.lastCall![0] as { overviewLayouts: Record<string, { id: string }[]> }).overviewLayouts['*']!.map(place => place.id)
    expect(order.slice(0, 5)).toEqual(['working-now', 'your-agents', 'usage', 'needs-you', 'human-queue'])
  })

  test('with every card off the page, the page says so, and Customize gives a room to drop the first one into', async () => {
    working = []
    prefs.value = { onboardingDismissed: true, overviewLayouts: { '*': ['needs-you', 'working-now', 'your-agents', 'usage', 'human-queue', 'working', 'skills', '@x/tickets/hot'].map(id => ({ id, hidden: true })) } }
    show()
    expect(await screen.findByText(/Every card is off the Overview/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Customize' }))
    const transfer = { dataTransfer: { effectAllowed: '', setData: () => {} } }
    fireEvent.dragStart(within(screen.getByRole('region', { name: 'Cards not on the page' })).getByRole('listitem', { name: 'Usage' }), transfer)
    const room = document.querySelector('[data-empty]')!
    fireEvent.dragOver(room, transfer)
    fireEvent.drop(room, transfer)
    const saved = (prefs.updatePreferences.mock.lastCall![0] as { overviewLayouts: Record<string, { id: string; hidden?: true }[]> }).overviewLayouts['*']!
    expect(saved.find(place => place.id === 'usage')).toEqual({ id: 'usage' })
  })

  test('a card showing only what an earlier visit read is faded once its fresh read has been out for a second, until it is read again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      working = [active('r1', 'p1')]
      show(null, { interventions: true, active: false })
      await screen.findByText('working on r1')
      const faded = () => [...document.querySelectorAll<HTMLElement>('[data-stale]')].map(el => el.dataset['card'])
      // A read that answers within the second never fades its card: no flicker on every load.
      expect(faded()).toEqual([])
      act(() => vi.advanceTimersByTime(FADE_AFTER_MS))
      expect(faded()).toEqual(['needs-you', 'human-queue'])
      expect(document.querySelector('[data-card="needs-you"]')!.className).toContain('opacity-60')
      cleanup()
      show(null, { interventions: false, active: true })
      await screen.findByText('working on r1')
      act(() => vi.advanceTimersByTime(FADE_AFTER_MS))
      expect(faded()).toEqual(['working-now', 'working'])
      cleanup()
      show()
      await screen.findByText('working on r1')
      act(() => vi.advanceTimersByTime(FADE_AFTER_MS))
      expect(faded()).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  test('no card is drawn before the layout is read: a card taken off never reads anything', async () => {
    prefs.loaded = false
    show()
    await screen.findByText('Overview')
    expect(drawn()).toEqual([])
  })

  test('the Needs you and Working now tiles show no count before their reads', async () => {
    show(null, { interventions: false, active: false }, false)
    for (const label of ['Needs you', 'Working now']) expect((await screen.findByText(label)).parentElement!.textContent).toBe(`${label}\u00a0Loading…`)
  })

  test('the Human Queue says it is loading before its read, not that nothing waits', async () => {
    show(null, { interventions: false, active: false }, false)
    const card = (await screen.findByText('Human Queue')).closest('[data-card]')!
    expect(card.textContent).toContain('Loading…')
    expect(card.textContent).not.toContain('AI doesn’t need you.')
  })

  test("the Needs you tile: how many things wait, and how many of each kind; it takes the page to the Human Queue", async () => {
    working = []
    const item = (kind: Intervention['kind'], n: number): Intervention => ({ projectId: 'p1', projectName: 'alpha', kind, title: `t${n}`, agentId: `r${n}` })
    const scrolled = vi.fn()
    Element.prototype.scrollIntoView = scrolled
    render(<DashboardPage onProjectAdded={() => {}} onSelectProject={() => {}} projectHref={id => `/${id}`} onSelectAgent={() => {}} onAgentStarted={() => {}} interventions={[item('awaiting', 1), item('awaiting', 2), item('pr', 3)]} interventionsStale={false} interventionsLoaded active={{ active: [], stale: false, loaded: true }} projects={projects} scope={null} />)
    const tile = (await screen.findByText('Needs you')).closest('button')!
    expect(tile.textContent).toBe('Needs you32 questions, 1 pull request')
    fireEvent.click(tile)
    expect(scrolled).toHaveBeenCalled()
    expect(scrolled.mock.contexts[0]).toBe(document.getElementById('needs-you'))
  })

  test('the Human Queue: work left uncommitted asks for a commit and opens its run; a request a run opened opens that run, one opened elsewhere links the git host', async () => {
    working = []
    const onSelectAgent = vi.fn()
    const item = (over: Partial<Intervention>): Intervention => ({ projectId: 'p1', projectName: 'test-project', kind: 'pr', title: 't', ...over })
    const interventions = [
      item({ kind: 'uncommitted', title: 'Create test.md', agentId: 'r1', branch: 'agent-r1', files: 1 }),
      item({ number: 6, title: 'Add DESCRIPTION.md', url: 'https://x/pull/6', agentId: 'r6' }),
      item({ number: 8, title: 'Condense README', url: 'https://x/pull/8' }),
    ]
    render(<DashboardPage onProjectAdded={() => {}} onSelectProject={() => {}} projectHref={id => `/${id}`} onSelectAgent={onSelectAgent} onAgentStarted={() => {}} interventions={interventions} interventionsStale={false} interventionsLoaded active={{ active: [], stale: false, loaded: true }} projects={[]} scope={null} />)
    // Grouped by kind, each under its heading, in the order that holds a run up most; a row says its kind on its icon's hover.
    expect(within(screen.getByRole('region', { name: 'Human Queue' })).getAllByRole('region').map(group => group.getAttribute('aria-label'))).toEqual(['Pull requests', 'To commit'])
    expect(screen.getByTitle('Needs commit')).toBeTruthy()
    expect(screen.getByText('1 file')).toBeTruthy()
    fireEvent.click(screen.getByText('Create test.md'))
    fireEvent.click(screen.getByText('Add DESCRIPTION.md'))
    expect(onSelectAgent.mock.calls).toEqual([['p1', 'r1'], ['p1', 'r6']])
    expect(screen.getByText('Condense README').closest('a')?.getAttribute('href')).toBe('https://x/pull/8')
    expect(screen.getByText('Add DESCRIPTION.md').closest('a')?.getAttribute('href')).toBe('/p1/r6')
  })
})
