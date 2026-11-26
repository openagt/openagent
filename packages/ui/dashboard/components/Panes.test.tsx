import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render as rtlRender, screen, waitFor, within } from '@testing-library/react'
import { hoverTooltip, openMenu, phoneScreen } from '../test-utils.js'
import type { ComponentProps, ReactElement, ReactNode } from 'react'
import { ModulesContext, mountedOf, type MountedModules, type MountedView } from '../lib/use-modules.js'
import type { UiPaneProps } from '../module/index.js'

// The panes read the project's documents themselves (#1146), so the top bar can tell a project
// with some from one with none. Stub the read: the default project has one.
const onDocs = vi.hoisted(() => vi.fn())
vi.mock('../rpc/reads.js', () => ({ onDocs }))

// The Docs pane itself is tested elsewhere; here it names the documents it was handed.
vi.mock('./DocsPanel.js', () => ({ DocsPanel: ({ docs }: { docs: { name: string }[] }) => <div>docs: {docs.map(d => d.name).join(', ')}</div> }))

const { PaneLayout, PanesProvider, PaneToggles, TopBar } = await import('./Panes.js')
const { forgetRemembered } = await import('../lib/use-async.js')
const { forgetPanes, setPaneOpen } = await import('../lib/panes.js')
const { shortcutKeys } = await import('../lib/shortcut.js')
const { forgetRevealedChanges, revealChange, revealFile, revealScreen, revealSubagent } = await import('../lib/reveal-change.js')

const Icon = () => <svg aria-hidden />
// The installed modules' panes, as the Files module and the browser skill bring them: each shows what it was given.
const shown = vi.fn()
type MountedPanel = MountedView<'chat.pane'>
const FILES: MountedPanel = { place: 'chat.pane', id: 'files', label: 'Files', icon: Icon, files: true, View: (props: UiPaneProps) => (shown(props), <div>the files</div>), package: '@openagt/ui-pane-files', projects: ['p1'] }
const CHANGES: MountedPanel = { place: 'chat.pane', id: 'changes', label: 'Changes', icon: Icon, changes: true, View: (props: UiPaneProps) => <div>changes: {props.reveal?.path ?? 'none asked'}</div>, package: '@openagt/ui-pane-changes', projects: ['p1'] }
const BROWSER: MountedPanel = { place: 'chat.pane', id: 'browser', label: 'Browser', icon: Icon, screen: true, View: () => <div>the browser</div>, package: '@openagt/browser', projects: ['p1'] }
const mounted = (panes: MountedPanel[]): MountedModules => mountedOf({ views: { 'chat.pane': panes } })

const base = { projectId: 'p1', agentId: 'r1', enabled: true, files: [] as string[], context: new Set<string>(), toggleContext: () => {} }

/** A page as the shell draws one: its top bar with the panes' menu and icons, and the page beside its panes. */
function Page(props: Partial<ComponentProps<typeof PanesProvider>>) {
  return (
    <PanesProvider {...base} {...props}>
      <header>
        <PaneToggles />
      </header>
      <PaneLayout>
        <main>the chat</main>
      </PaneLayout>
    </PanesProvider>
  )
}

/** A page as an agent's draws its own top bar, inside the page. */
function PageWithItsBar() {
  return (
    <PanesProvider {...base}>
      <PaneLayout>
        <main>
          <TopBar>
            <header>
              <PaneToggles />
            </header>
          </TopBar>
          the chat
        </main>
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

/** The panel icon: in the top bar while the panel is closed, at the end of its tab bar while it is open. */
const opener = () => screen.getByRole('button', { name: 'Open the side panel' })
const closer = () => screen.getByRole('button', { name: 'Close the side panel' })
const panel = () => screen.queryByRole('region', { name: 'Side panel' })
/** The list of what the panel can show, while no tab is open. */
const entry = (name: string) => within(screen.getByRole('list', { name: 'What the panel can show' })).getByRole('button', { name: new RegExp(`^${name}`) })
const tabs = () => screen.queryAllByRole('tab').map(tab => tab.textContent)
const tab = (name: string) => screen.getByRole('tab', { name })
/** What the panel shows: the region its shown tab is drawn in. */
const body = () => screen.getAllByRole('region').find(region => region.getAttribute('aria-label') !== 'Side panel')
const kept = (page: string) => (JSON.parse(localStorage.getItem('oa.panes') ?? '{"pages":{}}') as { pages: Record<string, { open: string[]; active?: string; shown?: boolean }> }).pages[page]

/** Open the panel and, from its list, one tab. */
function openTab(name: string) {
  if (!panel()) fireEvent.click(opener())
  if (screen.queryByRole('list', { name: 'What the panel can show' })) fireEvent.click(entry(name))
  else {
    openMenu(screen.getByRole('button', { name: 'Open a tab' }))
    fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(`^${name}`) }))
  }
}

describe('the panel icon', () => {
  test('a page with a panel has the icon in its top bar, the panel closed until it is pressed', async () => {
    render(<Page />)
    expect(opener().getAttribute('aria-pressed')).toBe('false')
    expect(panel()).toBeNull()
    expect((await hoverTooltip(opener())).textContent).toBe('Open panel')
  })

  test('a page with no panel has no icon, reads no documents, and is drawn as it is', () => {
    render(<Page enabled={false} />)
    expect(screen.queryByRole('button', { name: 'Open the side panel' })).toBeNull()
    expect(onDocs).not.toHaveBeenCalled()
    expect(screen.getByText('the chat')).toBeTruthy()
  })

  test('it opens the panel, then stands at the end of the panel\'s tab bar and closes it; the browser remembers it for this agent', () => {
    render(<Page />)
    fireEvent.click(opener())
    expect(panel()).not.toBeNull()
    expect(within(panel()!).getByRole('button', { name: 'Close the side panel' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByRole('button', { name: 'Open the side panel' })).toBeNull()
    expect(kept('p1/r1')!.shown).toBe(true)
    fireEvent.click(closer())
    expect(panel()).toBeNull()
    expect(opener()).toBeTruthy()
  })
})

describe('the panel with no tab open', () => {
  test('lists what it can show, the modules\' panes then Docs once the project has a document, each with its shortcut', async () => {
    render(<Page />)
    fireEvent.click(opener())
    await waitFor(() => expect(entry('Docs')).toBeTruthy())
    const list = screen.getByRole('list', { name: 'What the panel can show' })
    expect(within(list).getAllByRole('button').map(button => button.textContent)).toEqual([`Changes${shortcutKeys('changesTab').join('')}`, `Files${shortcutKeys('filesTab').join('')}`, 'Browser', 'Docs'])
  })

  test('a project with no document has no Docs, and a project without a module has none of its panes', async () => {
    onDocs.mockResolvedValue([])
    render(<Page />, [FILES])
    fireEvent.click(opener())
    await waitFor(() => expect(onDocs).toHaveBeenCalled())
    expect(within(screen.getByRole('list', { name: 'What the panel can show' })).getAllByRole('button').map(button => button.textContent)).toEqual([`Files${shortcutKeys('filesTab').join('')}`])
  })

  test('says what a pane holds beside its name, as the shell counts it', () => {
    render(<Page counts={{ '@openagt/ui-pane-changes/changes': <span>+5 −1</span> }} />)
    fireEvent.click(opener())
    expect(entry('Changes').textContent).toContain('+5 −1')
  })
})

describe('tabs', () => {
  test('an entry opens its pane in a tab; tabs stand in the order they were opened, the last opened shown', () => {
    render(<Page />)
    openTab('Files')
    expect(tabs()).toEqual(['Files'])
    expect(within(body()!).getByText('the files')).toBeTruthy()
    openTab('Changes')
    expect(tabs()).toEqual(['Files', 'Changes'])
    expect(tab('Changes').getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByText('the files')).toBeNull()
    fireEvent.click(tab('Files'))
    expect(within(body()!).getByText('the files')).toBeTruthy()
    expect(kept('p1/r1')).toMatchObject({ open: ['@openagt/ui-pane-files/files', '@openagt/ui-pane-changes/changes'], active: '@openagt/ui-pane-files/files' })
  })

  test('a tab\'s ✕ closes it, handing its place to the tab before it; the last closed leaves the list', () => {
    render(<Page />)
    openTab('Files')
    openTab('Changes')
    fireEvent.click(screen.getByRole('button', { name: 'Close Changes' }))
    expect(tabs()).toEqual(['Files'])
    expect(within(body()!).getByText('the files')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close Files' }))
    expect(tabs()).toEqual([])
    expect(screen.getByRole('list', { name: 'What the panel can show' })).toBeTruthy()
  })

  test('the "+" opens any pane in a tab', () => {
    render(<Page />)
    openTab('Files')
    openTab('Browser')
    expect(tabs()).toEqual(['Files', 'Browser'])
    expect(within(body()!).getByText('the browser')).toBeTruthy()
  })

  test('closed and opened again, the panel has the tabs it had', () => {
    render(<Page />)
    openTab('Files')
    fireEvent.click(closer())
    fireEvent.click(opener())
    expect(tabs()).toEqual(['Files'])
  })

  test('each page has its own: what is open on one agent\'s page is not on the next one\'s, nor on the "New agent session" page', () => {
    const { rerender } = render(<Page />)
    openTab('Files')
    rerender(<Page agentId="r2" />)
    expect(panel()).toBeNull()
    rerender(<Page agentId={null} />)
    expect(panel()).toBeNull()
    rerender(<Page />)
    expect(tabs()).toEqual(['Files'])
  })

  test('a tab left open whose module is gone is not drawn', () => {
    setPaneOpen('p1/r1', '@openagt/ui-pane-files/files', true)
    render(<Page />, [CHANGES])
    expect(tabs()).toEqual([])
    expect(screen.getByRole('list', { name: 'What the panel can show' })).toBeTruthy()
  })

  test('a module\'s pane on one of the run\'s copied repos is a tab of its own, named for the repo, and is given the repo', () => {
    render(<Page />)
    act(() => setPaneOpen('p1/r1', `@openagt/ui-pane-files/files#${'oa-newuser'}`, true))
    expect(tabs()).toEqual(['Files · oa-newuser'])
    expect((shown.mock.lastCall![0] as UiPaneProps).repo).toBe('oa-newuser')
  })

  test('the shortcuts open their pane\'s tab: ⌘ or Ctrl with Shift, D for Changes, F for Files', () => {
    render(<Page />)
    fireEvent.keyDown(window, { key: 'D', metaKey: true, shiftKey: true })
    expect(tabs()).toEqual(['Changes'])
    fireEvent.keyDown(window, { key: 'F', ctrlKey: true, shiftKey: true })
    expect(tabs()).toEqual(['Changes', 'Files'])
    // Without Shift, the key is another: nothing.
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true })
    expect(tabs()).toEqual(['Changes', 'Files'])
  })
})

describe('what a module\'s pane is given', () => {
  test('the project, the run, how far its feed is, and the Context\'s files alone', () => {
    render(<Page files={['a.ts', 'b.ts']} context={new Set(['a.ts', '/some/project'])} activity={7} />)
    openTab('Files')
    const props = shown.mock.lastCall![0] as UiPaneProps
    expect(props.projectId).toBe('p1')
    expect(props.agentId).toBe('r1')
    expect(props.activity).toBe(7)
    expect(props.repo).toBeUndefined()
    // A project path the launcher put in the Context is no file.
    expect([...props.context.files]).toEqual(['a.ts'])
  })

  test('on the "New agent session" page it is given no run', () => {
    render(<Page agentId={null} activity={7} />)
    openTab('Files')
    const props = shown.mock.lastCall![0] as UiPaneProps
    expect(props.agentId).toBeUndefined()
    expect(props.activity).toBeUndefined()
  })

  test('a pane that throws breaks only itself', () => {
    const broken: MountedPanel = { ...FILES, View: () => { throw new Error('boom') } }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<Page />, [broken, BROWSER])
    openTab('Files')
    expect(within(body()!).getByRole('alert').textContent).toContain('boom')
    openTab('Browser')
    expect(within(body()!).getByText('the browser')).toBeTruthy()
    expect(screen.getByText('the chat')).toBeTruthy()
  })
})

describe('a panel that fills the page', () => {
  const wrapper = () => panel()!.parentElement!

  test('its button lays it over the whole page where it is, and the same button brings it back; closed, it fills it no more', () => {
    render(<Page />)
    openTab('Files')
    expect(wrapper().className.split(' ')).not.toContain('absolute')
    fireEvent.click(screen.getByRole('button', { name: 'Let the panel fill the page' }))
    for (const cls of ['absolute', 'inset-0', 'z-30', 'bg-background']) expect(wrapper().className.split(' ')).toContain(cls)
    expect(screen.getByText('the chat')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Bring the panel back to its place' }))
    expect(wrapper().className.split(' ')).not.toContain('absolute')
    fireEvent.click(screen.getByRole('button', { name: 'Let the panel fill the page' }))
    fireEvent.click(closer())
    fireEvent.click(opener())
    expect(wrapper().className.split(' ')).not.toContain('absolute')
  })

  test('with no tab open there is nothing to fill the page with', () => {
    render(<Page />)
    fireEvent.click(opener())
    expect(screen.queryByRole('button', { name: 'Let the panel fill the page' })).toBeNull()
  })
})

describe('how the room is shared', () => {
  type Dragged = HTMLElement & { layoutChanged(layout: Record<string, number>, meta: { isUserInteraction: boolean }): void }
  const groups = (container: HTMLElement) => [...container.querySelectorAll<Dragged>('[data-group]')]
  const holds = (el: Element) => (el.id.includes('@', 1) ? el.id.slice(0, el.id.lastIndexOf('@')) : el.id)
  const part = (id: string) => [...document.querySelectorAll('[data-panel]')].find(el => holds(el) === id)!
  const share = (id: string) => part(id).getAttribute('data-default-size')
  const laidOut = (group: Dragged, shares: Record<string, number>, isUserInteraction = true) =>
    act(() => group.layoutChanged(Object.fromEntries(Object.entries(shares).map(([id, value]) => [part(id).id, value])), { isUserInteraction }))

  test('with the panel closed the page has all the room: no column and no line', () => {
    const { container } = render(<Page />)
    expect(container.querySelectorAll('[data-panel]')).toHaveLength(1)
    expect(screen.queryByRole('separator')).toBeNull()
    expect(document.getElementById('chat')!.textContent).toBe('the chat')
  })

  test('the open panel is a column beside the page, a line between the two, half the room until a person sets it', () => {
    const { container } = render(<Page />)
    fireEvent.click(opener())
    expect(screen.getAllByRole('separator').map(line => line.getAttribute('aria-label'))).toEqual(['The width of the chat and the side panel'])
    expect(share('panes')).toBe('50%')
    laidOut(groups(container)[0]!, { chat: 40, panes: 60 })
    cleanup()
    render(<Page agentId="r2" />)
    fireEvent.click(opener())
    // An agent never sized starts with the last share set on any.
    expect(share('panes')).toBe('60%')
  })

  test('a layout the group came to by itself is not a person\'s: it is not kept', () => {
    const { container } = render(<Page />)
    fireEvent.click(opener())
    laidOut(groups(container)[0]!, { chat: 40, panes: 60 }, false)
    expect(localStorage.getItem('oa.panes')).not.toContain('workspace')
  })

  test('a room too narrow for the chat and the panel at their least lays the panel over the chat, as on a phone', () => {
    const narrow = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 512 } as DOMRect)
    const { container } = render(<Page />)
    fireEvent.click(opener())
    narrow.mockRestore()
    expect(container.querySelectorAll('[data-panel]')).toHaveLength(1)
    expect(within(panel()!).getByRole('button', { name: 'Back to the chat' })).toBeTruthy()
  })
})

describe('asked for from the chat', () => {
  test('a changed file opens the Changes tab and hands it the file; another page\'s ask opens nothing here', () => {
    render(<Page />)
    act(() => revealChange('p1/r2', 'x.ts'))
    expect(panel()).toBeNull()
    act(() => revealChange('p1/r1', 'src/a.ts'))
    expect(tabs()).toEqual(['Changes'])
    expect(within(body()!).getByText('changes: src/a.ts')).toBeTruthy()
  })

  test('each ask opens the tab once: closed since, it stays closed on coming back to the page', () => {
    const { rerender } = render(<Page />)
    act(() => revealChange('p1/r1', 'src/a.ts'))
    fireEvent.click(screen.getByRole('button', { name: 'Close Changes' }))
    rerender(<Page agentId="r2" />)
    rerender(<Page />)
    expect(tabs()).toEqual([])
  })

  test('a file opens the Files tab and hands it the file as the agent named it', () => {
    render(<Page />)
    act(() => revealFile('p1/r1', './src/a.ts'))
    expect(tabs()).toEqual(['Files'])
    expect((shown.mock.lastCall![0] as UiPaneProps).show?.path).toBe('./src/a.ts')
  })

  test('a live screen opens the Browser tab', () => {
    render(<Page />)
    act(() => revealScreen('p1/r1'))
    expect(tabs()).toEqual(['Browser'])
  })

  test('with no pane that takes it, nothing opens', () => {
    render(<Page />, [FILES])
    act(() => revealChange('p1/r1', 'src/a.ts'))
    expect(panel()).toBeNull()
  })
})

describe("a run's background tasks", () => {
  test('a run that left something running or started subagents has a Background tasks tab in the panel\'s list, after the modules\' and Docs, saying how many run', async () => {
    render(<Page background={<div>the background</div>} counts={{ background: <span>2 running</span> }} />)
    fireEvent.click(opener())
    await waitFor(() => expect(entry('Docs')).toBeTruthy())
    expect(entry('Background tasks').textContent).toBe('Background tasks2 running')
    fireEvent.click(entry('Background tasks'))
    expect(within(body()!).getByText('the background')).toBeTruthy()
  })

  test('a subagent asked for from the chat opens the tab; an ask on a run with none opens nothing', () => {
    const { rerender } = render(<Page />)
    act(() => revealSubagent('p1/r1', 'call-1'))
    expect(panel()).toBeNull()
    rerender(<Page background={<div>the background</div>} />)
    act(() => revealSubagent('p1/r1', 'call-2'))
    expect(tabs()).toEqual(['Background tasks'])
  })
})

describe('on a phone', () => {
  let wide: () => void
  beforeEach(() => {
    wide = phoneScreen()
  })
  afterEach(() => wide())

  test('the open panel lies over the whole page under its top bar, its way out an arrow back to the chat; the icon stays in the top bar', () => {
    render(<PageWithItsBar />)
    fireEvent.click(opener())
    expect(within(panel()!).getByRole('button', { name: 'Back to the chat' })).toBeTruthy()
    expect(screen.queryByRole('separator')).toBeNull()
    expect(screen.getByText('the chat')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back to the chat' }))
    expect(panel()).toBeNull()
  })

  test('leaving the page closes its panel: no page is found covered on coming back', () => {
    const { rerender } = render(<Page />)
    fireEvent.click(opener())
    rerender(<Page agentId="r2" />)
    rerender(<Page />)
    expect(panel()).toBeNull()
  })
})
