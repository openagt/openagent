import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render as rtlRender, screen, waitFor, within } from '@testing-library/react'
import { hoverTooltip, openMenu, phoneScreen } from '../test-utils.js'
import type { ComponentProps, ReactElement, ReactNode } from 'react'
import { ModulesContext, type MountedModules, type MountedPanel } from '../lib/use-modules.js'
import type { ModulePanelProps } from '../module/index.js'

// The panes read the project's documents themselves (#1146), so the top bar can tell a project
// with some from one with none. Stub the read: the default project has one.
const onDocs = vi.hoisted(() => vi.fn())
vi.mock('../rpc/reads.js', () => ({ onDocs }))

// The Docs pane itself is tested elsewhere; here it names the documents it was handed.
vi.mock('./DocsPanel.js', () => ({ DocsPanel: ({ docs }: { docs: { name: string }[] }) => <div>docs: {docs.map(d => d.name).join(', ')}</div> }))

const { PaneLayout, PaneMenu, PanesProvider, PaneToggles } = await import('./Panes.js')
const { forgetRemembered } = await import('../lib/use-async.js')
const { forgetPanes, setPaneOpen } = await import('../lib/panes.js')
const { forgetRevealedChanges, revealChange, revealScreen } = await import('../lib/reveal-change.js')

const Icon = () => <svg aria-hidden />
// The installed modules' panes, as the Files module and the browser skill bring them: each shows what it was given.
const shown = vi.fn()
const FILES: MountedPanel = { id: 'files', label: 'Files', help: 'The project’s files', icon: Icon, Panel: (props: ModulePanelProps) => (shown(props), <div>the files</div>), package: '@openagt/files', projects: ['p1'] }
const CHANGES: MountedPanel = { id: 'changes', label: 'Changes', help: 'What changed', icon: Icon, changes: true, Panel: (props: ModulePanelProps) => <div>changes: {props.reveal?.path ?? 'none asked'}</div>, package: '@openagt/files', projects: ['p1'] }
const BROWSER: MountedPanel = { id: 'browser', label: 'Browser', help: 'The agent’s browser', icon: Icon, screen: true, Panel: () => <div>the browser</div>, package: '@openagt/skill-browser', projects: ['p1'] }
const mounted = (panels: MountedPanel[]): MountedModules => ({ pages: [], cards: [], linkActions: [], panels, runSlots: [], settings: [], loaded: true })

const base = { projectId: 'p1', agentId: 'r1', enabled: true, files: [] as string[], context: new Set<string>(), toggleContext: () => {} }

/** A page as the shell draws one: its top bar with the panes' menu and icons, and the page beside its panes. */
function Page(props: Partial<ComponentProps<typeof PanesProvider>>) {
  return (
    <PanesProvider {...base} {...props}>
      <header>
        <PaneMenu />
        <PaneToggles />
      </header>
      <PaneLayout>
        <main>the chat</main>
      </PaneLayout>
    </PanesProvider>
  )
}

/** Render with the given modules' panes installed (Changes, Files and the Browser by default). */
function render(ui: ReactElement, panels: MountedPanel[] = [CHANGES, FILES, BROWSER]) {
  const wrap = (node: ReactNode) => <ModulesContext.Provider value={mounted(panels)}>{node}</ModulesContext.Provider>
  const result = rtlRender(wrap(ui))
  return { ...result, rerender: (next: ReactNode) => result.rerender(wrap(next)) }
}

beforeEach(() => {
  forgetPanes()
  forgetRevealedChanges()
  forgetRemembered()
  shown.mockClear()
  onDocs.mockReset().mockResolvedValue([{ name: 'PLAN.md', content: '# plan' }])
})
afterEach(cleanup)

const icon = (name: string) => within(screen.getByRole('group', { name: 'Panes' })).getByRole('button', { name })
const icons = () => within(screen.getByRole('group', { name: 'Panes' })).getAllByRole('button').map(button => button.getAttribute('aria-label'))
/** The open panes, by name, in the order they stand. */
const cards = () => screen.queryAllByRole('region').map(card => card.getAttribute('aria-label'))
const card = (name: string) => screen.getByRole('region', { name })
const keptOpen = (page: string) => (JSON.parse(localStorage.getItem('oa.panes') ?? '{"pages":{}}') as { pages: Record<string, { open: string[] }> }).pages[page]?.open ?? []

describe('the panes\' icons', () => {
  test('one per pane the modules add, in their order, and Docs once the project has a document; none is open until its icon is pressed', async () => {
    render(<Page />)
    expect(icons()).toEqual(['Changes', 'Files', 'Browser'])
    await waitFor(() => expect(icons()).toEqual(['Changes', 'Files', 'Browser', 'Docs']))
    for (const name of icons()) expect(icon(name!).getAttribute('aria-pressed')).toBe('false')
    expect(cards()).toEqual([])
    // A closed pane renders nothing, so nothing in it reads anything.
    expect(shown).not.toHaveBeenCalled()
    expect(screen.getByText('the chat')).toBeTruthy()
  })

  test('a project with no document has no Docs icon, and a project without a module has none of its panes', async () => {
    onDocs.mockResolvedValue([])
    const { unmount } = render(<Page />)
    await waitFor(() => expect(onDocs).toHaveBeenCalled())
    expect(icons()).toEqual(['Changes', 'Files', 'Browser'])
    unmount()
    render(<Page projectId="p2" />)
    await waitFor(() => expect(onDocs).toHaveBeenCalledWith('p2'))
    expect(screen.queryByRole('group', { name: 'Panes' })).toBeNull()
  })

  test('an icon says what its pane shows', async () => {
    render(<Page />)
    const tip = await hoverTooltip(icon('Files'))
    expect(tip.textContent).toBe('FilesThe project’s files')
  })

  test('a page with no panes has no icon, reads no documents, and is drawn as it is', () => {
    const { container, unmount } = render(<Page enabled={false} />)
    expect(screen.queryByRole('group', { name: 'Panes' })).toBeNull()
    expect(container.querySelector('[data-group]')).toBeNull()
    expect(screen.getByText('the chat')).toBeTruthy()
    unmount()
    render(<Page projectId={null} />)
    expect(screen.queryByRole('group', { name: 'Panes' })).toBeNull()
    expect(onDocs).not.toHaveBeenCalled()
  })
})

describe('opening and closing a pane', () => {
  test('an icon opens its pane and closes it again; an open pane\'s icon is lit, and the browser remembers it for this agent', () => {
    render(<Page />)
    fireEvent.click(icon('Files'))
    expect(cards()).toEqual(['Files'])
    expect(within(card('Files')).getByText('the files')).toBeTruthy()
    expect(icon('Files').getAttribute('aria-pressed')).toBe('true')
    expect(icon('Files').className.split(' ')).toContain('bg-accent')
    expect(icon('Changes').getAttribute('aria-pressed')).toBe('false')
    expect(keptOpen('p1/r1')).toEqual(['@openagt/files/files'])
    fireEvent.click(icon('Files'))
    expect(cards()).toEqual([])
    expect(icon('Files').getAttribute('aria-pressed')).toBe('false')
  })

  test('the open panes stand in the order they were opened, whatever the order of their icons', async () => {
    render(<Page />)
    await waitFor(() => expect(icons()).toContain('Docs'))
    for (const name of ['Files', 'Docs', 'Changes']) fireEvent.click(icon(name))
    expect(cards()).toEqual(['Files', 'Docs', 'Changes'])
    expect(within(card('Docs')).getByText('docs: PLAN.md')).toBeTruthy()
    // Closed and opened again, a pane is the last.
    fireEvent.click(icon('Files'))
    fireEvent.click(icon('Files'))
    expect(cards()).toEqual(['Docs', 'Changes', 'Files'])
  })

  test('a pane\'s card names it and closes it', () => {
    render(<Page />)
    fireEvent.click(icon('Files'))
    fireEvent.click(icon('Browser'))
    expect(within(card('Browser')).getByRole('heading').textContent).toBe('Browser')
    fireEvent.click(screen.getByRole('button', { name: 'Close Files' }))
    expect(cards()).toEqual(['Browser'])
    expect(icon('Files').getAttribute('aria-pressed')).toBe('false')
  })

  test('each page has its own: what is open on one agent\'s page is not on the next one\'s, nor on the "New agent" page', () => {
    const { rerender } = render(<Page />)
    fireEvent.click(icon('Files'))
    rerender(<Page agentId="r2" />)
    expect(cards()).toEqual([])
    rerender(<Page agentId={null} />)
    expect(cards()).toEqual([])
    fireEvent.click(icon('Changes'))
    expect(keptOpen('new')).toEqual(['@openagt/files/changes'])
    rerender(<Page />)
    expect(cards()).toEqual(['Files'])
  })

  test('a pane left open whose module is gone is not drawn, and takes no column', () => {
    setPaneOpen('p1/r1', '@openagt/gone/pane', true)
    const { container } = render(<Page />)
    expect(cards()).toEqual([])
    expect(container.querySelectorAll('[data-panel]')).toHaveLength(1)
  })
})

describe('what a module\'s pane is given', () => {
  test('the project, the run, how far its feed is, and the Context\'s files alone', () => {
    render(<Page files={['a.ts', 'b.ts']} context={new Set(['a.ts', '/some/project'])} activity={7} />)
    fireEvent.click(icon('Files'))
    const props = shown.mock.lastCall![0] as ModulePanelProps
    expect(props.projectId).toBe('p1')
    expect(props.agentId).toBe('r1')
    expect(props.activity).toBe(7)
    // A project path the launcher put in the Context is no file.
    expect([...props.context.files]).toEqual(['a.ts'])
  })

  test('on the "New agent" page it is given no run', () => {
    render(<Page agentId={null} activity={7} />)
    fireEvent.click(icon('Files'))
    const props = shown.mock.lastCall![0] as ModulePanelProps
    expect(props.agentId).toBeUndefined()
    expect(props.activity).toBeUndefined()
  })

  test('a pane that throws breaks only itself', () => {
    const broken: MountedPanel = { ...FILES, Panel: () => { throw new Error('boom') } }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<Page />, [broken, BROWSER])
    fireEvent.click(icon('Files'))
    fireEvent.click(icon('Browser'))
    expect(within(card('Files')).getByRole('alert').textContent).toContain('boom')
    expect(within(card('Browser')).getByText('the browser')).toBeTruthy()
    expect(screen.getByText('the chat')).toBeTruthy()
  })
})

describe('a pane that fills the page', () => {
  const wrapper = (name: string) => card(name).parentElement!

  test('its card\'s button lays it over the whole page where it is, and the same button brings it back', () => {
    const { container } = render(<Page />)
    fireEvent.click(icon('Files'))
    fireEvent.click(icon('Browser'))
    expect(wrapper('Files').className.split(' ')).not.toContain('absolute')
    fireEvent.click(screen.getByRole('button', { name: 'Let Files fill the page' }))
    for (const cls of ['absolute', 'inset-0', 'z-30', 'bg-background']) expect(wrapper('Files').className.split(' ')).toContain(cls)
    // Over all the page and its panes, which are still there under it: nothing is drawn anew.
    expect(container.querySelector('[data-group]')!.parentElement!.className.split(' ')).toContain('relative')
    expect(cards()).toEqual(['Files', 'Browser'])
    expect(screen.getByText('the chat')).toBeTruthy()
    expect(wrapper('Browser').className.split(' ')).not.toContain('absolute')
    const back = screen.getByRole('button', { name: 'Bring Files back to its place' })
    expect(back.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(back)
    expect(wrapper('Files').className.split(' ')).not.toContain('absolute')
  })

  test('closed while it fills the page, it leaves the page as it was; opened again it is in its place', () => {
    render(<Page />)
    fireEvent.click(icon('Files'))
    fireEvent.click(screen.getByRole('button', { name: 'Let Files fill the page' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close Files' }))
    expect(cards()).toEqual([])
    fireEvent.click(icon('Files'))
    expect(wrapper('Files').className.split(' ')).not.toContain('absolute')
  })
})

describe('how the room is shared', () => {
  type Dragged = HTMLElement & { layoutChanged(layout: Record<string, number>, meta: { isUserInteraction: boolean }): void }
  const groups = (container: HTMLElement) => [...container.querySelectorAll<Dragged>('[data-group]')]
  // A panel is named for what it holds and, after an `@`, for whose shares it has.
  const holds = (panel: Element) => (panel.id.includes('@', 1) ? panel.id.slice(0, panel.id.lastIndexOf('@')) : panel.id)
  const panel = (id: string) => [...document.querySelectorAll('[data-panel]')].find(el => holds(el) === id)!
  const share = (id: string) => panel(id).getAttribute('data-default-size')
  const owner = (id: string) => panel(id).id.slice(id.length + 1)
  /** The group says a layout changed, as after a drag: the shares by what each panel holds. */
  const laidOut = (group: Dragged, shares: Record<string, number>, isUserInteraction = true) =>
    act(() => group.layoutChanged(Object.fromEntries(Object.entries(shares).map(([id, value]) => [panel(id).id, value])), { isUserInteraction }))

  test('with no pane open the page has all the room: no column and no line', () => {
    const { container } = render(<Page />)
    expect(groups(container)).toHaveLength(1)
    expect(groups(container)[0]!.getAttribute('data-orientation')).toBe('horizontal')
    expect(container.querySelectorAll('[data-panel]')).toHaveLength(1)
    expect(screen.queryByRole('separator')).toBeNull()
    // The page is the first panel whatever is open, so it is never drawn anew.
    expect(document.getElementById('chat')!.textContent).toBe('the chat')
    expect(groups(container)[0]!.hasAttribute('data-disabled')).toBe(false)
  })

  test('the open panes are a column beside the page, a line between the two and one between each two panes', () => {
    const { container } = render(<Page />)
    fireEvent.click(icon('Files'))
    expect(screen.getAllByRole('separator')).toHaveLength(1)
    expect(share('panes')).toBe('50%')
    fireEvent.click(icon('Changes'))
    const [row, column] = groups(container)
    expect(column!.getAttribute('data-orientation')).toBe('vertical')
    expect(row!.contains(column!)).toBe(true)
    expect(screen.getAllByRole('separator')).toHaveLength(2)
    // In the column: a pane, a line, a pane.
    expect([...column!.children].map(child => (child.getAttribute('role') === 'separator' ? 'line' : holds(child)))).toEqual(['@openagt/files/files', 'line', '@openagt/files/changes'])
    // Each line says what it shares.
    expect(screen.getAllByRole('separator').map(line => line.getAttribute('aria-label'))).toEqual(['The width of the chat and the panes', 'The height of Files and Changes'])
    // An even share until a person sets one.
    expect(share('@openagt/files/files')).toBe('50%')
    expect(share('@openagt/files/changes')).toBe('50%')
  })

  test('a share a person dragged is kept for that agent; an agent never sized starts with the last share set on any', () => {
    const { container, rerender } = render(<Page />)
    fireEvent.click(icon('Files'))
    laidOut(groups(container)[0]!, { chat: 40, panes: 60 })
    expect(share('panes')).toBe('60%')
    // Another agent, never sized: the last share set anywhere.
    rerender(<Page agentId="r2" />)
    fireEvent.click(icon('Files'))
    expect(share('panes')).toBe('60%')
    laidOut(groups(container)[0]!, { chat: 70, panes: 30 })
    expect(share('panes')).toBe('30%')
    // The first agent kept its own, and the "New agent" page starts with the last.
    rerender(<Page />)
    expect(share('panes')).toBe('60%')
    rerender(<Page agentId={null} />)
    fireEvent.click(icon('Files'))
    expect(share('panes')).toBe('30%')
  })

  test('a layout the group came to by itself is not a person\'s: it is not kept', () => {
    const { container } = render(<Page />)
    fireEvent.click(icon('Files'))
    laidOut(groups(container)[0]!, { chat: 20, panes: 80 }, false)
    expect(share('panes')).toBe('50%')
  })

  // The library remembers a layout by its panels' names, and would show one page's on the next.
  test('a panel is named for whose shares it has: a sized page\'s own, and for a page never sized the last set anywhere, which is another name once shares are set anew', () => {
    const { container, rerender } = render(<Page />)
    fireEvent.click(icon('Files'))
    const unsized = owner('panes')
    rerender(<Page agentId="r2" />)
    fireEvent.click(icon('Files'))
    // Two pages never sized share the last shares, and the name.
    expect(owner('panes')).toBe(unsized)
    laidOut(groups(container)[0]!, { chat: 40, panes: 60 })
    expect(owner('panes')).toBe('p1/r2')
    // The first page, still never sized, has the new last shares under a new name.
    rerender(<Page />)
    expect(share('panes')).toBe('60%')
    expect(owner('panes')).not.toBe(unsized)
    expect(owner('panes')).not.toBe('p1/r2')
    laidOut(groups(container)[0]!, { chat: 70, panes: 30 })
    expect(owner('panes')).toBe('p1/r1')
    // The page itself is one panel everywhere: it is never another.
    expect(document.getElementById('chat')!.textContent).toBe('the chat')
  })

  test('no line is dragged under a pane that fills the page', () => {
    const { container } = render(<Page />)
    fireEvent.click(icon('Files'))
    fireEvent.click(icon('Changes'))
    for (const group of groups(container)) expect(group.hasAttribute('data-disabled')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Let Files fill the page' }))
    for (const group of groups(container)) expect(group.hasAttribute('data-disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Bring Files back to its place' }))
    for (const group of groups(container)) expect(group.hasAttribute('data-disabled')).toBe(false)
  })

  test('the height two panes share is kept for those two, in that order', () => {
    const { container } = render(<Page />)
    fireEvent.click(icon('Files'))
    fireEvent.click(icon('Changes'))
    laidOut(groups(container)[1]!, { '@openagt/files/files': 70, '@openagt/files/changes': 30 })
    expect(share('@openagt/files/files')).toBe('70%')
    expect(share('@openagt/files/changes')).toBe('30%')
    expect(owner('@openagt/files/files')).toBe('p1/r1')
    // A third pane: three other panes share the height, evenly until a person sets it.
    fireEvent.click(icon('Browser'))
    for (const id of ['@openagt/files/files', '@openagt/files/changes', '@openagt/skill-browser/browser']) expect(Number.parseFloat(share(id)!)).toBeCloseTo(100 / 3)
    // The two again: as they were left.
    fireEvent.click(icon('Browser'))
    expect(share('@openagt/files/files')).toBe('70%')
  })
})

// The row of a changed file in the chat asks for the file (`lib/reveal-change.ts`).
describe('a changed file asked for from the chat', () => {
  test('opens the pane that lists changes, under the panes already open, and hands it the file', () => {
    render(<Page />)
    fireEvent.click(icon('Files'))
    act(() => revealChange('p1/r1', 'src/app.ts'))
    expect(cards()).toEqual(['Files', 'Changes'])
    expect(within(card('Changes')).getByText('changes: src/app.ts')).toBeTruthy()
    expect(icon('Changes').getAttribute('aria-pressed')).toBe('true')
  })

  test('an open one is handed the file where it stands; opened by hand, it is asked nothing', () => {
    render(<Page />)
    fireEvent.click(icon('Changes'))
    expect(within(card('Changes')).getByText('changes: none asked')).toBeTruthy()
    fireEvent.click(icon('Files'))
    act(() => revealChange('p1/r1', 'src/app.ts'))
    expect(cards()).toEqual(['Changes', 'Files'])
    expect(within(card('Changes')).getByText('changes: src/app.ts')).toBeTruthy()
  })

  test('another page\'s ask opens nothing here', () => {
    render(<Page />)
    act(() => revealChange('p1/other', 'src/app.ts'))
    expect(cards()).toEqual([])
  })

  test('each ask opens the pane once: closed since, it stays closed on coming back to the page', () => {
    const { rerender } = render(<Page />)
    act(() => revealChange('p1/r1', 'src/app.ts'))
    fireEvent.click(screen.getByRole('button', { name: 'Close Changes' }))
    rerender(<Page agentId="r2" />)
    rerender(<Page />)
    expect(cards()).toEqual([])
    // A new ask for the same file opens it again.
    act(() => revealChange('p1/r1', 'src/app.ts'))
    expect(cards()).toEqual(['Changes'])
  })

  test('with no pane that lists changes, nothing opens', () => {
    render(<Page />, [FILES])
    act(() => revealChange('p1/r1', 'src/app.ts'))
    expect(cards()).toEqual([])
  })
})

// The row of a live screen in the chat asks for the screen (`lib/reveal-change.ts`).
describe('a live screen asked for from the chat', () => {
  test('opens the pane that shows it; another page\'s ask opens nothing, and a second ask opens it again once closed', () => {
    render(<Page />)
    act(() => revealScreen('p1/other'))
    expect(cards()).toEqual([])
    act(() => revealScreen('p1/r1'))
    expect(cards()).toEqual(['Browser'])
    fireEvent.click(screen.getByRole('button', { name: 'Close Browser' }))
    act(() => revealScreen('p1/r1'))
    expect(cards()).toEqual(['Browser'])
  })
})

describe('on a phone', () => {
  let wide = () => {}
  beforeEach(() => {
    wide = phoneScreen()
  })
  afterEach(() => wide())

  test('with no pane open the icons are in the top bar, as on a wide screen', () => {
    render(<Page />)
    expect(icons()).toEqual(['Changes', 'Files', 'Browser'])
    expect(screen.queryByRole('button', { name: 'Panes' })).toBeNull()
  })

  test('the open panes lie over the page as a column of cards, with no line to drag; the page keeps all the room under them', () => {
    const { container } = render(<Page />)
    fireEvent.click(icon('Files'))
    const column = card('Files').closest('.absolute')!
    for (const cls of ['absolute', 'inset-y-0', 'right-0', 'z-20', 'w-2/3']) expect(column.className.split(' ')).toContain(cls)
    expect(container.querySelectorAll('[data-panel]')).toHaveLength(1)
    expect(screen.queryByRole('separator')).toBeNull()
    expect(screen.getByText('the chat')).toBeTruthy()
  })

  test('the icons, which the column covers, are one menu at the top bar\'s start: it lists the panes, the open ones checked, and opens and closes them', async () => {
    render(<Page />)
    await waitFor(() => expect(icons()).toContain('Docs'))
    fireEvent.click(icon('Files'))
    expect(screen.queryByRole('group', { name: 'Panes' })).toBeNull()
    await openMenu(screen.getByRole('button', { name: 'Panes' }))
    const items = await screen.findAllByRole('menuitemcheckbox')
    expect(items.map(item => [item.textContent?.trim(), item.getAttribute('aria-checked')])).toEqual([['Changes', 'false'], ['Files', 'true'], ['Browser', 'false'], ['Docs', 'false']])
    fireEvent.click(items[0]!)
    expect(cards()).toEqual(['Files', 'Changes'])
    // The last pane closed, the icons are back.
    fireEvent.click(screen.getByRole('button', { name: 'Close Files' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close Changes' }))
    expect(icons()).toEqual(['Changes', 'Files', 'Browser', 'Docs'])
  })

  test('a pane that fills the page takes the whole screen', () => {
    render(<Page />)
    fireEvent.click(icon('Files'))
    fireEvent.click(screen.getByRole('button', { name: 'Let Files fill the page' }))
    const column = card('Files').closest('.z-20')!
    expect(column.className.split(' ')).toContain('left-0')
    expect(column.className.split(' ')).not.toContain('w-2/3')
  })

  test('leaving the page closes its panes: no page is found covered on coming back', () => {
    const { rerender } = render(<Page />)
    fireEvent.click(icon('Files'))
    rerender(<Page agentId="r2" />)
    rerender(<Page />)
    expect(cards()).toEqual([])
    expect(keptOpen('p1/r1')).toEqual([])
  })

  test('going to a page with no panes closes them too', () => {
    const { unmount } = render(<Page />)
    fireEvent.click(icon('Files'))
    unmount()
    expect(keptOpen('p1/r1')).toEqual([])
  })

  test('a phone turned on its side, wide now, keeps its panes open, beside the page', () => {
    const { container } = render(<Page />)
    fireEvent.click(icon('Files'))
    act(() => wide())
    expect(cards()).toEqual(['Files'])
    expect(container.querySelectorAll('[data-panel]')).toHaveLength(3)
    expect(icons()).toEqual(['Changes', 'Files', 'Browser'])
  })

  test('on a wide screen leaving the page keeps them open, as the person left them', () => {
    wide()
    const { rerender } = render(<Page />)
    fireEvent.click(icon('Files'))
    rerender(<Page agentId="r2" />)
    rerender(<Page />)
    expect(cards()).toEqual(['Files'])
  })
})
