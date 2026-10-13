import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react'
import { hoverTooltip, phoneScreen } from '../test-utils.js'
import type { ReactElement, ReactNode } from 'react'
import type { AgentView } from '../lib/live-state.js'
import { ModulesContext, type MountedModules, type MountedPanel } from '../lib/use-modules.js'
import type { ModulePanelProps } from '../module/index.js'

// The rail reads its content panels itself now (#1146), so it can tell an empty one from a full
// one. Stub the reads: the default project has docs and a log, so every tab is earned and the
// tests below are about what the rail does with them. Tickets moved to its own page (#1144) and
// is no longer one of the rail's reads.
const onDocs = vi.hoisted(() => vi.fn())
vi.mock('../rpc/reads.js', () => ({ onDocs }))

// The panels themselves are rendered elsewhere; here they are stand-ins. The Docs one names the
// documents it was handed.
vi.mock('./DocsPanel.js', () => ({ DocsPanel: ({ docs }: { docs: { name: string }[] }) => <div>docs: {docs.map(d => d.name).join(', ')}</div> }))

const { RightRail } = await import('./RightRail.js')
const { forgetRemembered } = await import('../lib/use-async.js')

// An installed module's tab, as the Files module brings one: it shows what it was given.
const shown = vi.fn()
const FILES: MountedPanel = {
  id: 'files',
  label: 'Files',
  help: 'The project’s files',
  count: ({ context }) => context.files.size,
  Panel: (props: ModulePanelProps) => {
    shown(props)
    return <div>files</div>
  },
  package: '@openagt/files',
  projects: ['p1'],
}
const mounted = (panels: MountedPanel[]): MountedModules => ({ pages: [], cards: [], linkActions: [], panels, runSlots: [], settings: [], loaded: true })

/** Render with the given module tabs installed (the Files module's by default). */
function render(ui: ReactElement, panels: MountedPanel[] = [FILES]) {
  const wrap = (node: ReactNode) => <ModulesContext.Provider value={mounted(panels)}>{node}</ModulesContext.Provider>
  const result = rtlRender(wrap(ui))
  return { ...result, rerender: (next: ReactNode) => result.rerender(wrap(next)) }
}

beforeEach(() => {
  // Open, as the person left it, on the agent's page and on the "New agent" page: the tests below
  // are about what an open rail shows.
  localStorage.setItem('oa.side-panel', JSON.stringify(['p1/r1', 'new']))
  forgetRemembered()
  onDocs.mockReset().mockResolvedValue([{ name: 'PLAN.md', content: '# plan' }])
})

afterEach(cleanup)

const view: AgentView = { id: 'v1', title: 'Plan', markdown: '# hello' } as AgentView

const baseProps = {
  projectId: 'p1',
  agentId: 'r1',
  views: [],
  files: [],
  context: new Set<string>(),
  toggleContext: () => {},
}

// The rail holds one fixed width for every tab: switching to a pushed view no longer widens it
// (the per-tab wide mode from #862 was dropped so the tabs read as one stable column).
describe('RightRail width', () => {
  const rail = (container: HTMLElement) => container.querySelector('aside')!

  test('a list-shaped tab is half the page wide', () => {
    const { container } = render(<RightRail {...baseProps} />)
    expect(rail(container).className).toContain('w-1/2')
  })

  test('a pushed view keeps the same width — no expand', () => {
    const { container } = render(<RightRail {...baseProps} views={[view]} />)
    // The first view pulls the rail to the Views tab on its own, but the width does not change.
    expect(rail(container).className).toContain('w-1/2')
  })

  test('the width is unchanged after switching away from a view', async () => {
    const { container } = render(<RightRail {...baseProps} views={[view]} />)
    fireEvent.click(await screen.findByRole('tab', { name: /docs/i }))
    expect(rail(container).className).toContain('w-1/2')
  })

  test('no project means no rail', () => {
    const { container } = render(<RightRail {...baseProps} projectId={null} />)
    expect(container.querySelector('aside')).toBeNull()
  })
})

// The loop's verdict is pinned under the tabs rather than being one of them: it is a standing fact
// about the agent, so it stays put while you move between panels.
describe('RightRail tab labels (#1145)', () => {
  test('a tab says what it holds when hovered', async () => {
    render(<RightRail {...baseProps} />)
    const tab = await screen.findByRole('tab', { name: /docs/i })
    expect((await hoverTooltip(tab)).textContent).toContain('PLAN/TODO')
  })
})

// The project's documents are the rail's "Docs" tab on the "New agent" page exactly as on an
// agent's page: the launcher shows none of its own.
describe('RightRail Docs with no agent selected', () => {
  const settle = () => act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })

  test('the "New agent" page offers the Docs tab and shows the document', async () => {
    render(<RightRail {...baseProps} agentId={null} />, [])
    await settle()
    expect(onDocs).toHaveBeenCalledWith('p1')
    expect(screen.getByRole('tab', { name: /docs/i }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('docs: PLAN.md')).toBeTruthy()
  })

  test('beside a module\'s tab, the Docs tab is there too and opens the document', async () => {
    render(<RightRail {...baseProps} agentId={null} />)
    await settle()
    expect(screen.getByRole('tab', { name: /files/i })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: /docs/i }))
    expect(screen.getByText('docs: PLAN.md')).toBeTruthy()
  })

  test('with no document and no module tab, the "New agent" page has no rail', async () => {
    onDocs.mockResolvedValue([])
    const { container } = render(<RightRail {...baseProps} agentId={null} />, [])
    await settle()
    expect(onDocs).toHaveBeenCalledWith('p1')
    expect(container.querySelector('aside')).toBeNull()
  })
})

// Every tab is earned by its content (#1146): a panel that can only say "nothing yet" costs a tab
// nobody wants, and when none of them has anything the rail itself is noise.
describe('RightRail empty panels (#1146)', () => {
  const settle = () => act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })

  test('no docs, no Docs tab — and with nothing else, no rail at all', async () => {
    onDocs.mockResolvedValue([])
    const { container } = render(<RightRail {...baseProps} agentId={null} />, [])
    await settle()
    expect(screen.queryByRole('tab', { name: /docs/i })).toBeNull()
    expect(container.querySelector('aside')).toBeNull()
  })

  test('a live surface keeps the rail even when every read comes back empty', async () => {
    onDocs.mockResolvedValue([])
    const { container } = render(<RightRail {...baseProps} views={[view]} />)
    await settle()
    expect(container.querySelector('aside')).toBeTruthy()
    expect(screen.getByRole('tab', { name: /views/i })).toBeTruthy()
  })

  test('with no other tab, Docs holds the rail while the first read is still out, so switching projects does not blink it out', () => {
    onDocs.mockReturnValue(new Promise(() => {}))
    const { container } = render(<RightRail {...baseProps} />, [])
    // Not yet known to be empty is not the same as known to be empty.
    expect(container.querySelector('aside')).toBeTruthy()
    expect(screen.getByRole('tab', { name: /docs/i })).toBeTruthy()
  })

  test('beside other tabs, Docs waits for its first read: it never shows and then goes', async () => {
    let answer: (docs: unknown[]) => void = () => {}
    onDocs.mockReturnValue(new Promise(resolve => (answer = resolve)))
    render(<RightRail {...baseProps} />)
    expect(screen.getByRole('tab', { name: /files/i })).toBeTruthy()
    expect(screen.queryByRole('tab', { name: /docs/i })).toBeNull()
    await act(async () => answer([]))
    expect(screen.queryByRole('tab', { name: /docs/i })).toBeNull()
  })

  test('a project seen before shows its Docs tab from the first frame', async () => {
    const first = render(<RightRail {...baseProps} />)
    await settle()
    expect(screen.getByRole('tab', { name: /docs/i })).toBeTruthy()
    first.unmount()
    onDocs.mockReturnValue(new Promise(() => {}))
    render(<RightRail {...baseProps} />)
    expect(screen.getByRole('tab', { name: /docs/i })).toBeTruthy()
  })

  test('the open tab losing its content falls back to one that still has some', async () => {
    const { rerender } = render(<RightRail {...baseProps} views={[view]} />)
    await settle()
    // Picked by hand, so nothing auto-defaults away from it; then the agent ends and the views
    // go with it, leaving the remembered tab pointing at something that is no longer there.
    fireEvent.click(screen.getByRole('tab', { name: /views/i }))
    expect(screen.getByRole('tab', { name: /views/i }).getAttribute('aria-selected')).toBe('true')
    rerender(<RightRail {...baseProps} views={[]} />)
    await settle()
    expect(screen.queryByRole('tab', { name: /views/i })).toBeNull()
    // Not an empty panel: the rail falls back to the first tab that still has content.
    expect(screen.getByRole('tab', { name: /files/i }).getAttribute('aria-selected')).toBe('true')
  })

  test("a module's tab is always offered: the tab itself says when it has nothing", async () => {
    onDocs.mockResolvedValue([])
    render(<RightRail {...baseProps} />)
    await settle()
    expect(screen.getByRole('tab', { name: /files/i })).toBeTruthy()
  })
})

describe('RightRail module tabs (#492)', () => {
  test('a module’s tab comes first and is open by default, given the project, the run and the Context’s files', async () => {
    render(<RightRail {...baseProps} files={['a.ts', 'b.ts']} context={new Set(['a.ts', '/some/project'])} />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs[0]!.textContent).toContain('Files')
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true')
    // The count is the Context's files only: a project path the launcher put there is no file.
    expect(tabs[0]!.textContent).toContain('1')
    const props = shown.mock.lastCall![0] as ModulePanelProps
    expect(props.projectId).toBe('p1')
    expect(props.agentId).toBe('r1')
    expect([...props.context.files]).toEqual(['a.ts'])
  })

  test('a project without the module has no tab of it', () => {
    render(<RightRail {...baseProps} projectId="p2" />)
    expect(screen.queryByRole('tab', { name: /files/i })).toBeNull()
  })

  test('a module’s tab that throws breaks only itself', async () => {
    const broken: MountedPanel = { ...FILES, Panel: () => { throw new Error('boom') } }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<RightRail {...baseProps} />, [broken])
    expect(screen.getByRole('alert').textContent).toContain('boom')
    expect(await screen.findByRole('tab', { name: /docs/i })).toBeTruthy()
  })
})

describe('RightRail open and closed', () => {
  test('it is closed until opened: one button, no tab and no panel; the button opens it and the browser remembers it for this agent', async () => {
    localStorage.removeItem('oa.side-panel')
    shown.mockClear()
    const { unmount } = render(<RightRail {...baseProps} />)
    const opener = screen.getByRole('button', { name: 'Open the side panel' })
    expect(opener.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.queryByText('files')).toBeNull()
    // A closed rail renders no panel, so nothing in it reads anything.
    expect(shown).not.toHaveBeenCalled()
    // Closed, it takes no column: its button lies over the page's top right corner, clear of the page's scroll bar.
    expect(opener.closest('aside')!.className.split(' ')).toEqual(expect.arrayContaining(['absolute', 'top-0', 'right-0', 'md:pr-4']))
    fireEvent.click(opener)
    expect(screen.getByRole('tab', { name: /Files/ })).toBeTruthy()
    expect(screen.getByText('files')).toBeTruthy()
    expect(localStorage.getItem('oa.side-panel')).toBe('["p1/r1"]')
    // The same agent's page, later: open from the first frame.
    unmount()
    render(<RightRail {...baseProps} />)
    expect(screen.getByRole('tab', { name: /Files/ })).toBeTruthy()
  })

  test('another agent starts closed, and coming back the first is as it was left', () => {
    localStorage.removeItem('oa.side-panel')
    const { rerender } = render(<RightRail {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open the side panel' }))
    rerender(<RightRail {...baseProps} agentId="r2" />)
    expect(screen.getByRole('button', { name: 'Open the side panel' })).toBeTruthy()
    expect(screen.queryByRole('tab')).toBeNull()
    rerender(<RightRail {...baseProps} />)
    expect(screen.getByRole('button', { name: 'Close the side panel' })).toBeTruthy()
    // Closing it on the other agent's page leaves this one open.
    rerender(<RightRail {...baseProps} agentId="r2" />)
    fireEvent.click(screen.getByRole('button', { name: 'Open the side panel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close the side panel' }))
    expect(localStorage.getItem('oa.side-panel')).toBe('["p1/r1"]')
  })

  test('the "New agent" page has its own, whatever the project', () => {
    localStorage.removeItem('oa.side-panel')
    const { rerender } = render(<RightRail {...baseProps} agentId={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open the side panel' }))
    expect(localStorage.getItem('oa.side-panel')).toBe('["new"]')
    rerender(<RightRail {...baseProps} />)
    expect(screen.getByRole('button', { name: 'Open the side panel' })).toBeTruthy()
    rerender(<RightRail {...baseProps} agentId={null} />)
    expect(screen.getByRole('button', { name: 'Close the side panel' })).toBeTruthy()
  })

  test('open, the same button closes it, and that is remembered too', () => {
    render(<RightRail {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close the side panel' }))
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.getByRole('button', { name: 'Open the side panel' })).toBeTruthy()
    expect(localStorage.getItem('oa.side-panel')).toBe('["new"]')
  })

  test('with no tab to show there is no button either', async () => {
    localStorage.removeItem('oa.side-panel')
    onDocs.mockResolvedValue([])
    const { container } = render(<RightRail {...baseProps} />, [])
    await waitFor(() => expect(onDocs).toHaveBeenCalled())
    await waitFor(() => expect(container.querySelector('aside')).toBeNull())
  })
})

// The row of a changed file in the chat asks for the file (`lib/reveal-change.ts`).
describe('RightRail, a changed file asked for from the chat', () => {
  const CHANGES: MountedPanel = {
    id: 'changes',
    label: 'Changes',
    help: 'What changed',
    changes: true,
    Panel: (props: ModulePanelProps) => <div>changes: {props.reveal?.path ?? 'none asked'}</div>,
    package: '@openagt/files',
    projects: ['p1'],
  }

  test('the ask opens a closed panel on the tab that lists changes and hands it the file; the other tabs are handed none', async () => {
    const { revealChange, forgetRevealedChanges } = await import('../lib/reveal-change.js')
    forgetRevealedChanges()
    localStorage.removeItem('oa.side-panel')
    render(<RightRail {...baseProps} />, [FILES, CHANGES])
    expect(screen.queryByRole('tablist')).toBeNull()
    act(() => revealChange('p1/r1', 'src/app.ts'))
    await waitFor(() => expect(screen.getByText('changes: src/app.ts')).toBeTruthy())
    expect(screen.getByRole('tab', { name: 'Changes' }).getAttribute('aria-selected')).toBe('true')
    shown.mockClear()
    fireEvent.click(screen.getByRole('tab', { name: /Files/ }))
    expect(shown).toHaveBeenCalled()
    expect(shown.mock.calls.every(([props]) => props.reveal === undefined)).toBe(true)
  })

  test('a tab picked by hand after the ask stays; a second ask for the same file shows the changes again', async () => {
    const { revealChange, forgetRevealedChanges } = await import('../lib/reveal-change.js')
    forgetRevealedChanges()
    render(<RightRail {...baseProps} />, [FILES, CHANGES])
    act(() => revealChange('p1/r1', 'src/app.ts'))
    await waitFor(() => expect(screen.getByText('changes: src/app.ts')).toBeTruthy())
    fireEvent.click(screen.getByRole('tab', { name: /Files/ }))
    expect(screen.getByText('files')).toBeTruthy()
    act(() => revealChange('p1/r1', 'src/app.ts'))
    await waitFor(() => expect(screen.getByText('changes: src/app.ts')).toBeTruthy())
  })

  test('an ask made on another agent\'s page is not this page\'s', async () => {
    const { revealChange, forgetRevealedChanges } = await import('../lib/reveal-change.js')
    forgetRevealedChanges()
    render(<RightRail {...baseProps} />, [FILES, CHANGES])
    act(() => revealChange('p1/other', 'src/app.ts'))
    fireEvent.click(screen.getByRole('tab', { name: 'Changes' }))
    expect(screen.getByText('changes: none asked')).toBeTruthy()
  })

  test('an ask moves the rail once: met again on coming back to its page, it does not undo a tab picked by hand', async () => {
    const { revealChange, forgetRevealedChanges } = await import('../lib/reveal-change.js')
    forgetRevealedChanges()
    localStorage.setItem('oa.side-panel', JSON.stringify(['p1/r1', 'p1/r2']))
    const { rerender } = render(<RightRail {...baseProps} />, [FILES, CHANGES])
    act(() => revealChange('p1/r1', 'src/app.ts'))
    await waitFor(() => expect(screen.getByText('changes: src/app.ts')).toBeTruthy())
    fireEvent.click(screen.getByRole('tab', { name: /Files/ }))
    rerender(<RightRail {...baseProps} agentId="r2" />)
    rerender(<RightRail {...baseProps} />)
    await act(async () => {})
    expect(screen.getByRole('tab', { name: /Files/ }).getAttribute('aria-selected')).toBe('true')
  })
})

// The row of a live screen in the chat asks for the screen (`lib/reveal-change.ts`).
describe('RightRail, a live screen asked for from the chat', () => {
  const BROWSER: MountedPanel = {
    id: 'browser',
    label: 'Browser',
    help: 'The agent\'s browser',
    screen: true,
    Panel: () => <div>the live screen</div>,
    package: '@openagt/skill-browser',
    projects: ['p1'],
  }

  test('the ask opens a closed panel on the tab that shows the screen, and a tab picked by hand after it stays', async () => {
    const { revealScreen, forgetRevealedChanges } = await import('../lib/reveal-change.js')
    forgetRevealedChanges()
    localStorage.removeItem('oa.side-panel')
    render(<RightRail {...baseProps} />, [FILES, BROWSER])
    expect(screen.queryByRole('tablist')).toBeNull()
    act(() => revealScreen('p1/r1'))
    await waitFor(() => expect(screen.getByText('the live screen')).toBeTruthy())
    expect(screen.getByRole('tab', { name: 'Browser' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('tab', { name: /Files/ }))
    expect(screen.getByText('files')).toBeTruthy()
    act(() => revealScreen('p1/other'))
    await act(async () => {})
    expect(screen.getByText('files')).toBeTruthy()
    act(() => revealScreen('p1/r1'))
    await waitFor(() => expect(screen.getByText('the live screen')).toBeTruthy())
  })
})

// A phone has no width for a column beside the page (#1824).
describe('RightRail on a phone', () => {
  let wide: () => void
  beforeEach(() => {
    wide = phoneScreen()
  })
  afterEach(() => wide())
  const rail = (container: HTMLElement) => container.querySelector('aside')!

  test('open, it covers the page instead of taking half of it', () => {
    const { container } = render(<RightRail {...baseProps} />)
    const classes = rail(container).className.split(' ')
    for (const cls of ['absolute', 'inset-0', 'bg-background']) expect(classes).toContain(cls)
    for (const cls of ['w-1/2', 'min-w-[22rem]', 'shrink-0']) expect(classes).not.toContain(cls)
    // Over the menu's button, which lies over the page's top left corner.
    expect(classes).toContain('z-20')
    // The way back to the page is in it.
    expect(screen.getByRole('button', { name: 'Close the side panel' })).toBeTruthy()
  })

  test('closed, it is its button over the page\'s top right corner, and takes no column', () => {
    localStorage.removeItem('oa.side-panel')
    const { container } = render(<RightRail {...baseProps} />)
    const classes = rail(container).className.split(' ')
    for (const cls of ['absolute', 'top-0', 'right-0']) expect(classes).toContain(cls)
    fireEvent.click(screen.getByRole('button', { name: 'Open the side panel' }))
    expect(rail(container).className.split(' ')).toContain('inset-0')
  })

  test('leaving the page closes it: no page is found covered on coming back', () => {
    const { rerender } = render(<RightRail {...baseProps} />)
    expect(screen.getByRole('button', { name: 'Close the side panel' })).toBeTruthy()
    rerender(<RightRail {...baseProps} agentId="r2" />)
    rerender(<RightRail {...baseProps} />)
    expect(screen.getByRole('button', { name: 'Open the side panel' })).toBeTruthy()
  })

  test('going to a page with no panel closes it too', () => {
    const { unmount } = render(<RightRail {...baseProps} />)
    unmount()
    expect(JSON.parse(localStorage.getItem('oa.side-panel') ?? '[]')).not.toContain('p1/r1')
  })

  test('a phone turned on its side, wide now, keeps its panel open', () => {
    const { container } = render(<RightRail {...baseProps} />)
    expect(rail(container).className.split(' ')).toContain('inset-0')
    act(() => wide())
    expect(rail(container).className.split(' ')).toContain('w-1/2')
    expect(screen.getByRole('button', { name: 'Close the side panel' })).toBeTruthy()
    expect(JSON.parse(localStorage.getItem('oa.side-panel') ?? '[]')).toContain('p1/r1')
  })

  test('on a wide screen leaving the page keeps it open, as the person left it', () => {
    wide()
    const { rerender } = render(<RightRail {...baseProps} />)
    rerender(<RightRail {...baseProps} agentId="r2" />)
    rerender(<RightRail {...baseProps} />)
    expect(screen.getByRole('button', { name: 'Close the side panel' })).toBeTruthy()
  })
})
