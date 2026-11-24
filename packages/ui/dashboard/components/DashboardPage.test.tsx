import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import type { ActiveAgent, Waiting } from '../../src/index.js'

// The Overview's own layout: its cards on a grid, ordered, sized and hidden by the person's layout
// for the page (#overview layouts). The cards are tested on their own; here they are stand-ins, the
// agents at work are handed in as the shell reads them, and the preferences are a plain object a write changes.
vi.mock('./Quota.js', () => ({ Quota: () => <div>usage</div> }))
vi.mock('./OnboardingChecklist.js', () => ({ OnboardingChecklist: () => <div>onboarding</div> }))
const modules = vi.hoisted(() => ({ loaded: true, gone: false, line: [] as { id: string; order: number; node: unknown }[] }))
vi.mock('./ModuleCards.js', async () => {
  const { Section } = await import('./ui/section.js')
  const { PartDescription } = await import('./PartDescription.js')
  // A package's card as packages draw them: a part with a link to its page at its heading's right, and the sentence that says what it is.
  const node = (
    <Section title="Hot" action={<a href="/tickets">Every ticket of the project</a>}>
      <PartDescription>The tickets to do first</PartDescription>
      <div>a package's card</div>
    </Section>
  )
  // The card of what needs the person, a package's as ui-card-waiting's is, in the part the line's count scrolls to.
  const queue = (
    <div id="needs-you">
      <Section title="Human Queue">
        <div>what waits on you</div>
      </Section>
    </div>
  )
  const waiting = { id: 'human-queue', label: 'Human Queue', order: 5, width: '2/3', minWidth: '1/2', needsYou: true, node: queue }
  // A package's card a third wide, beside the Overview's own.
  const notes = { id: '@x/notes/recent', label: 'Notes', order: 41, width: '1/3', minWidth: '1/4', node: <div>notes</div> }
  return { useModuleCards: () => ({ cards: [waiting, notes, ...(modules.gone ? [] : [{ id: '@x/tickets/hot', label: 'Hot tickets', order: 50, width: '1/2', minWidth: '1/3', node }])], line: modules.line, loaded: modules.loaded }) }
})
// The screen's size, as the page reads it: a desktop's unless a test says a phone's.
const screenSize = vi.hoisted(() => ({ phone: false }))
vi.mock('../lib/use-mobile.js', async original => ({ ...(await original<typeof import('../lib/use-mobile.js')>()), useIsMobile: () => screenSize.phone }))
const prefs = vi.hoisted(() => ({ value: { onboardingDismissed: true } as Record<string, unknown>, loaded: true, updatePreferences: vi.fn() }))
vi.mock('../lib/preferences.js', () => ({ usePreferences: () => prefs.value, usePreferencesLoaded: () => prefs.loaded, updatePreferences: prefs.updatePreferences }))

const { DashboardPage } = await import('./DashboardPage.js')
const { FADE_AFTER_MS } = await import('./FadeWhileStale.js')

const active = (agentId: string, projectId = 'p1'): ActiveAgent => ({ projectId, projectName: projectId, agentId, cwd: `/repos/${agentId}`, status: 'running', startedAt: '2026-07-25T09:00:00.000Z', updatedAt: '2026-07-25T10:00:00.000Z', intent: `working on ${agentId}` })
const projects = [{ id: 'p1', name: 'alpha' }, { id: 'p2', name: 'beta' }] as never[]
/** The agents at work, as the shell read them. */
let working: ActiveAgent[] = []
/** The modules' pages as the sidebar lists them: none known until a test says. */
const overview = (scope: string | null = null, kept = { waiting: false, active: false }, read = true) => (
  <DashboardPage onProjectAdded={() => {}} onSelectAgent={() => {}} waiting={[]} waitingState={!read ? 'unknown' : kept.waiting ? 'kept' : 'fresh'} active={{ active: working, state: !read ? 'unknown' : kept.active ? 'kept' : 'fresh' }} projects={projects} scope={scope} start={null} />
)
const show = (...args: Parameters<typeof overview>) => render(overview(...args))
/** The cards drawn, in order, each with its grid classes. */
const drawn = () => [...document.querySelectorAll<HTMLElement>('[data-card]')].map(el => ({ id: el.dataset['card'], spans: el.className }))

beforeEach(() => {
  working = []
  screenSize.phone = false
  prefs.value = { onboardingDismissed: true }
  prefs.loaded = true
  prefs.updatePreferences.mockReset()
  modules.loaded = true
  modules.line = []
  modules.gone = false
})
afterEach(cleanup)

describe('the Overview', () => {
  test('with no layout picked, the cards stand in their own order and widths; the agents at work show even while none works', async () => {
    working = []
    show()
    await screen.findByText('Human Queue')
    expect(drawn().map(card => card.id)).toEqual(['human-queue', 'working', 'usage', '@x/notes/recent', '@x/tickets/hot'])
    expect(screen.getByText('No agent is at work.')).toBeTruthy()
    // Two columns once the page has the room: what needs the person two thirds wide, what is at work
    // and the usage a half each, side by side; in a middling column each is a half, in a narrow one the
    // whole row; a half is a half from a middling column on; a row's cards fill it.
    expect(drawn()[0]!.spans).toContain('@max-2xl:basis-full')
    expect(drawn()[0]!.spans).toContain('@2xl:basis-[calc(50%_-_1rem)]')
    expect(drawn()[0]!.spans).toContain('@4xl:basis-[calc(66.667%_-_0.667rem)]')
    expect(drawn()[1]!.spans).toContain('@2xl:basis-[calc(50%_-_1rem)]')
    expect(drawn()[1]!.spans).not.toContain('@4xl:')
    expect(drawn()[2]!.spans).toContain('@2xl:basis-[calc(50%_-_1rem)]')
    expect(drawn()[2]!.spans).not.toContain('@4xl:')
    expect(drawn()[4]!.spans).toContain('@2xl:basis-[calc(50%_-_1rem)]')
    expect(drawn()[4]!.spans).not.toContain('@4xl:')
    expect(drawn()[4]!.spans).toContain('grow-[6]')
    cleanup()
    working = [active('r1', 'p1')]
    show()
    expect(await screen.findByText('working on r1')).toBeTruthy()
    expect(drawn().map(card => card.id)).toEqual(['human-queue', 'working', 'usage', '@x/notes/recent', '@x/tickets/hot'])
    cleanup()
    // With a project picked, only that project's agents count.
    show('p2')
    await screen.findByText('Human Queue')
    expect(screen.queryByText('working on r1')).toBeNull()
  })

  test('"Discover OpenAgent" is the first part of the page, above the box that starts a session, whatever the layout; its ✕ takes it off', async () => {
    working = []
    const withBox = () => render(<DashboardPage onProjectAdded={() => {}} onSelectAgent={() => {}} waiting={[]} waitingState="fresh" active={{ active: working, state: 'fresh' }} projects={projects} scope={null} start={<p>the box</p>} />)
    prefs.value = {}
    withBox()
    const discover = await screen.findByText('onboarding')
    expect(discover.previousElementSibling).toBeNull()
    expect(discover.nextElementSibling!.textContent).toBe('the box')
    cleanup()
    prefs.value = { overviewLayouts: { '*': ['usage', 'human-queue', 'working', '@x/notes/recent', '@x/tickets/hot'].map(id => ({ id, hidden: true })) } }
    withBox()
    expect((await screen.findByText('onboarding')).nextElementSibling!.textContent).toBe('the box')
    cleanup()
    prefs.value = { onboardingDismissed: true }
    withBox()
    await screen.findByText('the box')
    expect(screen.queryByText('onboarding')).toBeNull()
  })

  test('a layout orders, sizes and hides the cards; one it does not name comes after, at its own width; a width narrower than a card fits is not kept', async () => {
    working = []
    prefs.value = {
      onboardingDismissed: true,
      overviewLayouts: { '*': [{ id: '@x/tickets/hot', width: '1/3' }, { id: 'usage', hidden: true }, { id: 'human-queue', width: '1/4' }, { id: 'gone' }, { id: '@x/notes/recent', width: '1/4' }] },
    }
    show()
    await screen.findByText('Human Queue')
    expect(drawn().map(card => card.id)).toEqual(['@x/tickets/hot', 'human-queue', '@x/notes/recent', 'working'])
    expect(screen.queryByText('usage')).toBeNull()
    expect(drawn()[0]!.spans).toContain('@4xl:basis-[calc(33.333%_-_1.333rem)]')
    // What needs the person fits half at the narrowest: a quarter is passed over for its own width, two thirds.
    expect(drawn()[1]!.spans).toContain('@4xl:basis-[calc(66.667%_-_0.667rem)]')
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

  test('the box that starts a session is the page\'s first part, before every card, and arranging the cards leaves it there', async () => {
    working = [active('1-a')]
    render(<DashboardPage onProjectAdded={() => {}} onSelectAgent={() => {}} waiting={[]} waitingState="fresh" active={{ active: working, state: 'fresh' }} projects={projects} scope={null} start={<p>the box</p>} />)
    const box = screen.getByText('the box')
    const firstCard = await waitFor(() => {
      const card = document.querySelector('[data-card]')
      expect(card).toBeTruthy()
      return card!
    })
    expect(box.compareDocumentPosition(firstCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: 'Customize' }))
    await screen.findByRole('button', { name: 'Done' })
    expect(screen.getByText('the box')).toBeTruthy()
  })

  test('Customize arranges the page on its cards: a width, ✕ to the tray, + back from it, the arrow keys to move; each change is this page\'s layout at once', async () => {
    working = []
    prefs.value = { onboardingDismissed: true, overviewLayouts: { '*': [{ id: 'usage' }], p1: [{ id: 'usage' }, { id: '@x/notes/recent', hidden: true }] } }
    show('p1')
    fireEvent.click(await screen.findByRole('button', { name: 'Customize' }))
    expect(screen.getByRole('status').textContent).toMatch(/Arranging the layout for alpha/)
    // Every shown card has its bar; the agents at work, though none works, are there to be placed.
    expect(screen.getAllByRole('toolbar').map(bar => bar.getAttribute('aria-label'))).toEqual(['Usage', 'Human Queue', 'At work', 'Hot tickets'])
    // The card hidden waits in the tray.
    const tray = within(screen.getByRole('region', { name: 'Cards not on the page' }))
    expect(tray.getAllByRole('listitem').map(item => item.getAttribute('aria-label'))).toEqual(['Notes'])
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
    fireEvent.click(tray.getByRole('button', { name: 'Add Notes' }))
    expect(saved()['p1']!.map(place => place.id).at(-1)).toBe('@x/notes/recent')
    expect(saved()['p1']!.at(-1)).toEqual({ id: '@x/notes/recent' })
    // The arrow keys on a card's handle move it among the cards on the page: Usage passes what needs the person.
    // (Each press here is read against the layout the page started with: the stand-in preferences do not change.)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Move Usage: arrow keys' }), { key: 'ArrowRight' })
    expect(saved()['p1']!.map(place => place.id)).toEqual(['@x/notes/recent', 'human-queue', 'usage', 'working', '@x/tickets/hot'])
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
    const asleep = screen.getByText("a package's card").closest<HTMLElement>('[inert]')!
    // Its heading's link is not drawn, however long its words.
    const link = screen.getByRole('link', { name: 'Every ticket of the project' }).parentElement!
    expect([...asleep.querySelectorAll('section>div:first-child>h2~*')]).toEqual([link])
    expect(asleep.className.split(' ')).toContain('[&_section>div:first-child>h2~*]:invisible')
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.getByText("a package's card").closest('[inert]')).toBeNull()
  })

  test("while the page is arranged, a card's bar stands above the card, on its frame: it covers none of the card, however narrow, and moves none of it", async () => {
    show()
    fireEvent.click(await screen.findByRole('button', { name: 'Customize' }))
    const bar = screen.getByRole('toolbar', { name: 'Hot tickets' })
    const card = screen.getByText("a package's card").closest<HTMLElement>('[inert]')!
    // Beside the card, not in it, and laid out of the flow: the card's heading and rows stand where they stood.
    expect(bar.parentElement).toBe(card.parentElement)
    expect(card.contains(bar)).toBe(false)
    expect(bar.className.split(' ')).toEqual(expect.arrayContaining(['absolute', 'bottom-full', 'right-0']))
  })

  test("while the page is arranged, a part's sentence is still for a screen reader alone, so arranging moves nothing", async () => {
    show()
    fireEvent.click(await screen.findByRole('button', { name: 'Customize' }))
    const sentence = screen.getByText('The tickets to do first')
    expect(sentence.className).toBe('sr-only')
    expect(sentence.closest('[inert]')!.className).not.toMatch(/sr-only/)
  })

  test("on a phone the press that gives up the page's own layout stands in the tray at the page's foot, under its words, and Done stands alone in the head", async () => {
    screenSize.phone = true
    prefs.value = { onboardingDismissed: true, overviewLayouts: { '*': [{ id: '@x/notes/recent', hidden: true }] } }
    show()
    fireEvent.click(await screen.findByRole('button', { name: 'Customize' }))
    const tray = screen.getByRole('region', { name: 'Cards not on the page' })
    const reset = within(tray).getByRole('button', { name: 'Reset to the default layout' })
    // Under the tray's two sentences, in its full words.
    const [, words] = tray.querySelectorAll('p')
    expect(words!.compareDocumentPosition(reset) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Reset to the default layout' })).toEqual([reset])
    fireEvent.click(reset)
    expect(prefs.updatePreferences).toHaveBeenCalledWith({ overviewLayouts: {} })
  })

  test('Esc leaves Customize as Done does, and the keyboard is back on Customize', async () => {
    // A layout of the page's own: its reset press stands before Done.
    prefs.value = { onboardingDismissed: true, overviewLayouts: { '*': [{ id: 'usage' }] } }
    show()
    fireEvent.click(await screen.findByRole('button', { name: 'Customize' }))
    expect(screen.getAllByRole('toolbar').length).toBeGreaterThan(0)
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('toolbar')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Customize' }))
  })

  test('a card dragged from the tray shows where it lands, a bar beside the card under the pointer or at the end, and lands there', async () => {
    working = []
    prefs.value = { onboardingDismissed: true, overviewLayouts: { '*': [{ id: '@x/notes/recent', hidden: true }] } }
    show()
    fireEvent.click(await screen.findByRole('button', { name: 'Customize' }))
    const chip = within(screen.getByRole('region', { name: 'Cards not on the page' })).getByRole('listitem', { name: 'Notes' })
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
    expect(order.indexOf('@x/notes/recent')).toBe(order.indexOf('usage') - 1)
    expect(saved['*']!.find(place => place.id === '@x/notes/recent')).toEqual({ id: '@x/notes/recent' })
    expect(document.querySelector('[data-drop]')).toBeNull()
    // Over the page's empty room: at the end, the bar after the last card.
    fireEvent.dragStart(chip, transfer)
    fireEvent.dragOver(usage.parentElement!, transfer)
    expect(document.querySelector('[data-card]:last-child [data-drop="after"]')).toBeTruthy()
  })

  test('a card that leaves the page while it is dragged (its package removed) is dropped on nothing: no layout is written', async () => {
    working = []
    const { rerender } = show()
    fireEvent.click(await screen.findByRole('button', { name: 'Customize' }))
    const transfer = { dataTransfer: { effectAllowed: '', setData: () => {} } }
    fireEvent.dragStart(document.querySelector('[data-card="@x/tickets/hot"]')!, transfer)
    modules.gone = true
    rerender(overview())
    const usage = document.querySelector('[data-card="usage"]')!
    // What a press's handler throws reaches the window, not the test.
    const thrown: unknown[] = []
    const caught = (event: ErrorEvent): void => {
      thrown.push(event.error)
      event.preventDefault()
    }
    window.addEventListener('error', caught)
    fireEvent.dragOver(usage, { ...transfer, clientX: 0 })
    fireEvent.drop(usage, transfer)
    window.removeEventListener('error', caught)
    expect(thrown).toEqual([])
    expect(prefs.updatePreferences).not.toHaveBeenCalled()
    expect(drawn().map(card => card.id)).toEqual(['human-queue', 'working', 'usage', '@x/notes/recent'])
  })

  test('a card dragged on the page leaves the page still, shows where it lands, and moves only when dropped', async () => {
    working = []
    show()
    fireEvent.click(await screen.findByRole('button', { name: 'Customize' }))
    const transfer = { dataTransfer: { effectAllowed: '', setData: () => {} } }
    const before = drawn().map(card => card.id)
    fireEvent.dragStart(document.querySelector('[data-card="@x/notes/recent"]')!, transfer)
    fireEvent.dragOver(document.querySelector('[data-card="human-queue"]')!, { ...transfer, clientX: 0 })
    // Nothing has moved; the bar says where it goes.
    expect(drawn().map(card => card.id)).toEqual(before)
    expect(document.querySelector('[data-card="human-queue"] [data-drop="before"]')).toBeTruthy()
    expect(prefs.updatePreferences).not.toHaveBeenCalled()
    fireEvent.drop(document.querySelector('[data-card="human-queue"]')!, transfer)
    const order = (prefs.updatePreferences.mock.lastCall![0] as { overviewLayouts: Record<string, { id: string }[]> }).overviewLayouts['*']!.map(place => place.id)
    expect(order).toEqual(['@x/notes/recent', 'human-queue', 'working', 'usage', '@x/tickets/hot'])
  })

  test('the cards slide to their places after a drag, never after a key or a press, nor under reduced motion', async () => {
    working = []
    const slide = vi.fn((update: () => void) => update())
    document.startViewTransition = slide as never
    const reduced = window.matchMedia
    try {
      window.matchMedia = ((query: string) => ({ ...reduced(query), matches: false })) as typeof window.matchMedia
      show()
      fireEvent.click(await screen.findByRole('button', { name: 'Customize' }))
      fireEvent.keyDown(screen.getByRole('button', { name: 'Move Usage: arrow keys' }), { key: 'ArrowRight' })
      fireEvent.click(screen.getByRole('button', { name: 'Take Notes off the page' }))
      expect(slide).not.toHaveBeenCalled()
      const transfer = { dataTransfer: { effectAllowed: '', setData: () => {} } }
      fireEvent.dragStart(document.querySelector('[data-card="@x/notes/recent"]')!, transfer)
      fireEvent.dragOver(document.querySelector('[data-card="human-queue"]')!, { ...transfer, clientX: 0 })
      fireEvent.drop(document.querySelector('[data-card="human-queue"]')!, transfer)
      expect(slide).toHaveBeenCalledTimes(1)
      // Under reduced motion a drag moves the cards with no slide.
      window.matchMedia = reduced
      fireEvent.dragStart(document.querySelector('[data-card="@x/notes/recent"]')!, transfer)
      fireEvent.dragOver(document.querySelector('[data-card="human-queue"]')!, { ...transfer, clientX: 0 })
      fireEvent.drop(document.querySelector('[data-card="human-queue"]')!, transfer)
      expect(slide).toHaveBeenCalledTimes(1)
      expect(prefs.updatePreferences).toHaveBeenCalledTimes(4)
    } finally {
      window.matchMedia = reduced
      delete (document as { startViewTransition?: unknown }).startViewTransition
    }
  })

  test('with every card off the page, the page says so beside the press that brings them back, which gives a room to drop the first one into', async () => {
    working = []
    prefs.value = { onboardingDismissed: true, overviewLayouts: { '*': ['usage', 'human-queue', 'working', '@x/notes/recent', '@x/tickets/hot'].map(id => ({ id, hidden: true })) } }
    show()
    const said = await screen.findByText(/Every card is off the Overview/)
    fireEvent.click(within(said.parentElement!).getByRole('button', { name: 'Customize' }))
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
      show(null, { waiting: false, active: true })
      await screen.findByText('working on r1')
      const faded = () => [...document.querySelectorAll<HTMLElement>('[data-stale]')].map(el => el.dataset['card'])
      // A read that answers within the second never fades its card: no flicker on every load.
      expect(faded()).toEqual([])
      act(() => vi.advanceTimersByTime(FADE_AFTER_MS))
      expect(faded()).toEqual(['working'])
      expect(document.querySelector('[data-card="working"]')!.className).toContain('opacity-60')
      cleanup()
      // What waits on the person only an earlier visit read: its card, a package's, fades itself.
      show(null, { waiting: true, active: false })
      await screen.findByText('working on r1')
      act(() => vi.advanceTimersByTime(FADE_AFTER_MS))
      expect(faded()).toEqual([])
      cleanup()
      show()
      await screen.findByText('working on r1')
      act(() => vi.advanceTimersByTime(FADE_AFTER_MS))
      expect(faded()).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  test('on a first visit nothing is drawn under the Human Queue until it has answered, so nothing is pushed when it does', async () => {
    const { rerender } = show(null, { waiting: false, active: false }, false)
    await screen.findByText('Human Queue')
    expect(drawn().map(card => card.id)).toEqual(['human-queue'])
    rerender(overview())
    await waitFor(() => expect(drawn().map(card => card.id)).toEqual(['human-queue', 'working', 'usage', '@x/notes/recent', '@x/tickets/hot']))
  })

  test('no card is drawn before the layout is read: a card taken off never reads anything', async () => {
    prefs.loaded = false
    show()
    await screen.findByText('Overview')
    expect(drawn()).toEqual([])
  })

  test('the line under the title says no count before its reads, and a nothing in words after', async () => {
    show(null, { waiting: false, active: false }, false)
    await screen.findByText('Human Queue')
    expect(screen.queryByRole('button', { name: /needs? you/ })).toBeNull()
    expect(screen.queryByText(/^(no agent|\d+) working$/)).toBeNull()
    cleanup()
    show()
    expect(await screen.findByRole('button', { name: 'nothing needs you' })).toBeTruthy()
    expect(screen.getByText('no agent working')).toBeTruthy()
  })

  test("before the packages' code is in, the line is its own parts, and a package's part that comes takes its place by its order", async () => {
    modules.loaded = false
    const { rerender } = show()
    const line = (await screen.findByText('no agent working')).closest('p')!
    expect(line.textContent).toBe('·nothing needs you·no agent working')
    // A phone shows it too, beside Customize.
    expect(line.className).not.toContain('sr-only')
    modules.line = [{ id: '@x/queue/queued', order: 3, node: <span>nothing queued</span> }]
    rerender(overview())
    expect(line.textContent).toBe('·nothing needs you·no agent working·nothing queued')
    // Every package in, none with a part: the line is its own parts only.
    modules.loaded = true
    modules.line = []
    rerender(overview())
    expect(line.textContent).toBe('·nothing needs you·no agent working')
  })

  test("on a browser's first visit, no page known yet, the line is its own parts, and a package's part that comes takes its place", async () => {
    modules.loaded = false
    const { rerender } = show()
    const firstVisit = (await screen.findByText('no agent working')).closest('p')!
    expect(firstVisit.textContent).toBe('·nothing needs you·no agent working')
    modules.line = [{ id: '@x/queue/queued', order: 3, node: <span>nothing queued</span> }]
    rerender(overview())
    expect(firstVisit.textContent).toBe('·nothing needs you·no agent working·nothing queued')
  })

  test("the line's first part: how many things wait, and how many of each mark on its hover; it takes the page to the card of what needs the person", async () => {
    working = []
    const item = (mark: Waiting['mark'], n: number): Waiting => ({ projectId: 'p1', projectName: 'alpha', kind: 'waiting', module: 'm', scope: 'run', run: `r${n}`, words: 'Needs it', title: `t${n}`, ...(mark ? { mark } : {}) })
    const scrolled = vi.fn()
    Element.prototype.scrollIntoView = scrolled
    render(<DashboardPage onProjectAdded={() => {}} onSelectAgent={() => {}} waiting={[item('question', 1), item('question', 2), item('pull-request', 3), item(undefined, 4)]} waitingState="fresh" active={{ active: [], state: 'fresh' }} projects={projects} scope={null} start={null} />)
    const part = await screen.findByRole('button', { name: '4 need you' })
    expect(part.getAttribute('title')).toBe('2 questions, 1 pull request, 1 more')
    fireEvent.click(part)
    expect(scrolled).toHaveBeenCalled()
    expect(scrolled.mock.contexts[0]).toBe(document.getElementById('needs-you'))
  })
})
