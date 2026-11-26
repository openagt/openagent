import type { ReactElement } from 'react'
import type { AgentMeta, ProjectSummary, Waiting } from '../../src/index.js'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { SidebarProvider } from './ui/sidebar.js'
import { hoverTooltip, openMenu, phoneScreen } from '../test-utils.js'
import { PagesBar } from './PhoneBar.js'
import { projectLabels, ProjectLabelsContext } from '../lib/project-labels.js'

// AgentHistory pulls in AddProjectPanel, which imports the projects RPC stubs; stub them so
// nothing fetches a daemon that is not there. Import AgentHistory after the mock is in place.
// Resolves to an empty list: AddProjectPanel (reachable from the rail) reads projects on demand.
const onProjects = vi.hoisted(() => vi.fn(() => Promise.resolve([])))
const sendAddProject = vi.hoisted(() => vi.fn())
const sendPickProjectDirectory = vi.hoisted(() => vi.fn())
// The project picker at the top reads the repos on this computer: none here.
const onRepos = vi.hoisted(() => vi.fn(() => Promise.resolve({ repos: [], canAddFolder: false })))
// The hosts beside this computer each project's modules bring (`run.host`): Claude Code on the web in p1.
const onRunHosts = vi.fn(async (projectId: string) => (projectId === 'p1' ? [{ id: 'web', label: 'Claude Code on the web' }] : []))
vi.mock('../rpc/projects.js', () => ({ onProjects, sendAddProject, sendPickProjectDirectory, onRepos, onRunHosts, sendAddRepoFolder: vi.fn(), onCloneTarget: vi.fn(), sendAddProjectFromAddress: vi.fn() }))
// An ended agent's log, read as the pointer reaches its row.
const onAgent = vi.hoisted(() => vi.fn((_projectId: string, _agentId: string) => Promise.resolve([])))
vi.mock('../rpc/reads.js', () => ({ onAgent }))
// The git host's accounts behind the people of the rows.
const onPeople = vi.hoisted(() => vi.fn(async (_projectId: string, _emails: string[]) => [] as { email: string; login: string; avatar?: string }[]))
vi.mock('../rpc/people.js', () => ({ onPeople }))

// The rail also carries the person's menu at its foot (#772 follow-up). Its theme row pulls the
// preferences into jsdom, which this suite deliberately avoids. It is about the agents list, not
// the menu (each has its own suite), so stub it out, and the person is a name.
vi.mock('./ThemeSubmenu.js', () => ({ ThemeSubmenu: () => null }))
const onPerson = vi.hoisted(() => vi.fn(async () => ({ name: 'Ada Lovelace' }) as { name: string; email?: string; avatar?: string }))
vi.mock('../rpc/person.js', () => ({ onPerson }))

// The rail asks the person's preferences two things: whether a run is named, which decides whether a
// row waits for that name or prints the prompt, and the order of the list, which it also writes.
const preferences = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))
const updatePreferences = vi.hoisted(() => vi.fn())
vi.mock('../lib/preferences.js', async importOriginal => ({ ...(await importOriginal<object>()), usePreferences: () => preferences.current, updatePreferences }))

// The coding agents as each says itself: its name and its mark; and whether this computer names its runs.
const LOGO = '<svg viewBox="0 0 1 1"><path d="M0 0h1v1z"/></svg>'
const namesRuns = vi.hoisted(() => ({ current: true }))
vi.mock('../rpc/agents.js', () => ({
  onCodingAgents: async () => [
    { id: 'claude-code', label: 'Claude Code', logo: LOGO, models: { models: [{ id: 'opus', name: 'Opus 5.5' }] } },
    { id: 'codex', label: 'Codex', logo: LOGO, models: { models: [] } },
  ],
  onNamesRuns: async () => namesRuns.current,
}))

const { AgentHistory } = await import('./AgentHistory.js')
const { forgetRemembered } = await import('../lib/use-async.js')

afterEach(() => {
  cleanup()
  forgetRemembered()
  localStorage.clear()
  namesRuns.current = true
  preferences.current = {}
  updatePreferences.mockReset()
})

function agent(over: Partial<AgentMeta> = {}): AgentMeta {
  return {
    status: 'running',
    id: 'run-1',
    startedAt: '2026-07-19T16:05:44.756Z',
    updatedAt: '2026-07-19T16:06:21.000Z',
    intent: "replace 'Hello, world!' with 'Welcome!'",
    ...over,
  }
}

/** What waits on the person, as the list of it says: five other runs' questions first, so the runs a test marks stay in the Log. */
const waitingOn = (...work: { run: string; words: string; detail: string; mark: 'changes' | 'branch' }[]): Waiting[] => [
  ...[1, 2, 3, 4, 5].map(n => ({ projectId: 'p0', projectName: 'p0', kind: 'waiting' as const, module: 'ask', scope: 'run' as const, run: `q${n}`, id: `q${n}`, words: 'Needs answer', title: `Question ${n}`, mark: 'question' as const })),
  ...work.map(({ run, ...said }) => ({ projectId: 'p1', projectName: 'p1', kind: 'waiting' as const, module: 'git-branches', scope: 'run' as const, run, id: `${said.mark}:${run}`, title: run, ...said })),
]

// AgentHistory renders the shadcn <Sidebar>, which reads SidebarProvider context; wrap every render.
const renderRail = (ui: ReactElement) => render(<SidebarProvider>{ui}</SidebarProvider>)

describe('AgentHistory (#785)', () => {
  test('what waits on the person is its own part over the Log: a run\'s name and how long it has waited, what it needs under them, quiet; five, then a row that opens the Overview', () => {
    const asks = (n: number) => ({ projectId: 'p1', projectName: 'p1', kind: 'waiting' as const, module: 'ask', scope: 'run' as const, run: `r${n}`, id: `r${n}:q${n}`, words: 'Needs answer', title: `Run ${n}`, mark: 'question' as const, since: new Date(Date.now() - 3 * 60_000).toISOString() })
    const onSelectRecent = vi.fn()
    const onDashboard = vi.fn()
    renderRail(
      <AgentHistory projectId="p1" scope="p1" agents={[]} selectedAgentId={null} onSelect={() => {}} onSelectRecent={onSelectRecent} onDashboard={onDashboard} homeHref="/p1" waiting={[1, 2, 3, 4, 5, 6].map(asks)} hrefOf={route => `/${route.projectId}/${route.agentId}`} />,
    )
    expect(screen.getByText('Waiting on you')).toBeTruthy()
    const row = screen.getByRole('link', { name: 'Run 1 · Needs answer' })
    expect(row.getAttribute('href')).toBe('/p1/r1')
    // Two lines: the name and its age, then what it needs, in the waiting colour.
    expect([...row.firstElementChild!.children].map(line => line.textContent)).toEqual(['Run 13m', 'Needs answer'])
    expect(row.firstElementChild!.lastElementChild!.className).toContain('text-muted-foreground')
    // The row is known by its run as it travels between the two lists.
    expect([row.getAttribute('data-glide'), row.getAttribute('data-glide-part')]).toEqual(['p1:r1', 'waiting'])
    fireEvent.click(row)
    expect(onSelectRecent).toHaveBeenCalledWith('p1', 'r1')
    expect(screen.queryByRole('link', { name: /^Run 6/ })).toBeNull()
    fireEvent.click(screen.getByRole('link', { name: '1 more' }))
    expect(onDashboard).toHaveBeenCalled()
    // The Overview row carries the Human Queue's count.
    expect(screen.getByRole('link', { name: /^Overview/ }).textContent).toBe('Overview6')
  })

  test('a run waiting on the person is listed once, under "Waiting on you", picked there while it is the page shown; the Log lists the others', () => {
    const asked = { projectId: 'p1', projectName: 'p1', kind: 'waiting' as const, module: 'ask', scope: 'run' as const, run: 'run-2', id: 'run-2:q1', words: 'Needs answer', title: 'Pick a colour', mark: 'question' as const, since: new Date().toISOString() }
    renderRail(
      <AgentHistory projectId="p1" scope="p1" agents={[agent({ intent: 'Make the cart', status: 'done' }), agent({ id: 'run-2', intent: 'Pick a colour', status: 'waiting' })]} selectedAgentId="run-2" onSelect={() => {}} waiting={[asked]} hrefOf={route => `/${route.projectId}/${route.agentId}`} />,
    )
    expect(screen.getAllByRole('link', { name: /Pick a colour/ }).map(link => link.getAttribute('aria-label'))).toEqual(['Pick a colour · Needs answer'])
    expect(screen.getByRole('link', { name: 'Pick a colour · Needs answer' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: /Make the cart/ })).toBeTruthy()
  })

  test('what waits has its mark in the colour of what it needs, as the Overview\'s Human Queue says it: an answer yellow, a merge green; its words quiet', () => {
    const base = { projectId: 'p1', projectName: 'p1', kind: 'waiting' as const, module: 'ask', scope: 'run' as const, since: new Date().toISOString() }
    const asked = { ...base, run: 'run-2', id: 'run-2:q1', words: 'Needs answer', title: 'Pick a colour', mark: 'question' as const }
    const merge = { ...base, module: 'github', run: 'run-3', id: 'run-3:pr', words: 'Needs merge', title: 'Fix the cart', mark: 'pull-request' as const }
    renderRail(
      <AgentHistory projectId="p1" scope="p1" agents={[agent({ id: 'run-2', intent: 'Pick a colour', status: 'waiting' }), agent({ id: 'run-3', intent: 'Fix the cart', status: 'done' })]} selectedAgentId={null} onSelect={() => {}} waiting={[asked, merge]} hrefOf={route => `/${route.projectId}/${route.agentId}`} />,
    )
    const tones = (name: string) => {
      const row = screen.getByRole('link', { name })
      return [row.querySelector('svg')!.getAttribute('class')!.includes(name.endsWith('answer') ? 'text-warning' : 'text-success'), screen.getAllByText(name.split(' · ')[1]!).some(word => word.className.includes('text-muted-foreground'))]
    }
    // The mark in colour, the words quiet.
    expect(tones('Pick a colour · Needs answer')).toEqual([true, true])
    expect(tones('Fix the cart · Needs merge')).toEqual([true, true])
  })

  test('everything under the project select is one scroll: the pages, what waits and the Log; scrolled past what waits, the Log\'s label is held, fades the rows under it and says how many wait', () => {
    const asks = (n: number) => ({ projectId: 'p1', projectName: 'p1', kind: 'waiting' as const, module: 'ask', scope: 'run' as const, run: `r${n}`, id: `r${n}:q`, words: 'Needs answer', title: `Run ${n}`, mark: 'question' as const, since: new Date().toISOString() })
    renderRail(<AgentHistory projectId="p1" scope="p1" agents={[agent({ status: 'done' })]} selectedAgentId={null} onSelect={() => {}} waiting={[asks(1), asks(2)]} />)
    const viewport = document.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')!
    for (const name of [/^New agent session/, /^Overview/, 'Run 1 · Needs answer', /· done ·/]) expect(viewport.contains(screen.getByRole('link', { name }))).toBe(true)
    // The person's row at the foot, and the project select, stay out of it.
    for (const slot of ['sidebar-header', 'sidebar-footer']) expect(viewport.contains(document.querySelector(`[data-slot="${slot}"]`)!)).toBe(false)
    const part = (name: string) => document.querySelector<HTMLElement>(`[data-rail-part="${name}"]`)!
    const held = (name: string) => part(name).querySelector('[data-stuck]') !== null
    expect([held('waiting'), held('log')]).toEqual([false, false])
    expect(screen.queryByRole('button', { name: '2 waiting' })).toBeNull()
    // jsdom lays nothing out: the parts stand where the test says, against a scroll whose top is 0.
    const place = (el: HTMLElement, top: number, bottom: number) => (el.getBoundingClientRect = () => ({ top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON: () => ({}) }))
    const scrollTo = (scrollTop: number, waiting: [number, number], log: [number, number]) => {
      place(part('waiting'), ...waiting)
      place(part('log'), ...log)
      viewport.scrollTop = scrollTop
      act(() => void fireEvent.scroll(viewport))
    }
    // Scrolled past the pages: what waits is at the top, its label held.
    scrollTo(220, [-20, 80], [80, 400])
    expect([held('waiting'), held('log')]).toEqual([true, false])
    expect(screen.queryByRole('button', { name: '2 waiting' })).toBeNull()
    // Scrolled past what waits: the Log's label takes its place and says how many wait.
    scrollTo(400, [-200, -100], [-100, 220])
    expect([held('waiting'), held('log')]).toEqual([false, true])
    const chip = screen.getByRole('button', { name: '2 waiting' })
    const intoView = vi.fn()
    part('waiting').scrollIntoView = intoView
    fireEvent.click(chip)
    expect(intoView).toHaveBeenCalled()
    // Back at the top, nothing is held.
    scrollTo(0, [240, 340], [340, 660])
    expect([held('waiting'), held('log')]).toEqual([false, false])
    expect(screen.queryByRole('button', { name: '2 waiting' })).toBeNull()
  })

  test('with nothing waiting there is no "Waiting on you" part', () => {
    renderRail(<AgentHistory projectId="p1" scope="p1" agents={[agent()]} selectedAgentId={null} onSelect={() => {}} />)
    expect(screen.queryByText('Waiting on you')).toBeNull()
  })

  test('a row and a nav item are links to their pages: a plain click goes there in place, a Ctrl+click is the browser\'s, for a new tab', () => {
    const onSelect = vi.fn()
    const onPage = vi.fn()
    renderRail(<AgentHistory projectId="p1" scope="p1" agents={[agent({ status: 'done' })]} selectedAgentId={null} onSelect={onSelect} pages={[{ segment: 'logs', label: 'Logs' }]} onPage={onPage} hrefOf={route => `/${route.scope ?? route.projectId}/${route.page ?? route.agentId}`} />)
    const row = screen.getByRole('link', { name: /Welcome/ })
    const logs = screen.getByRole('link', { name: 'Logs' })
    expect([row.getAttribute('href'), logs.getAttribute('href')]).toEqual(['/p1/run-1', '/p1/logs'])
    expect(fireEvent.click(row, { ctrlKey: true })).toBe(true)
    expect(fireEvent.click(logs, { button: 1 })).toBe(true)
    expect([onSelect.mock.calls, onPage.mock.calls]).toEqual([[], []])
    expect(fireEvent.click(row)).toBe(false)
    expect(fireEvent.click(logs)).toBe(false)
    expect([onSelect.mock.calls, onPage.mock.calls]).toEqual([[['run-1']], [['logs']]])
  })

  test('while the modules\' pages are not known, what stands under them waits, then fades in at its place; known from the start, it is there at once', () => {
    const rail = (pages: { segment: string; label: string }[] | null) => <AgentHistory projectId="p1" scope="p1" agents={[agent({ status: 'done' })]} selectedAgentId={null} onSelect={() => {}} pages={pages} />
    const { rerender, unmount } = renderRail(rail(null))
    expect([screen.queryByRole('link', { name: 'Permissions' }), screen.queryByText('Log'), screen.queryByRole('link', { name: /Welcome/ })]).toEqual([null, null, null])
    rerender(<SidebarProvider>{rail([{ segment: 'logs', label: 'Logs' }])}</SidebarProvider>)
    expect(screen.getByRole('link', { name: 'Logs' }).parentElement?.className).toContain('starting:opacity-0')
    expect(screen.getByRole('link', { name: /Welcome/ })).toBeTruthy()
    unmount()
    renderRail(rail([]))
    expect(screen.getByRole('link', { name: 'Permissions' }).parentElement?.className).not.toContain('starting:opacity-0')
  })

  test('a failed run\'s mark is the failed hexagon, still', () => {
    const { container } = renderRail(<AgentHistory projectId="p1" scope="p1" agents={[agent({ status: 'failed' })]} selectedAgentId={null} onSelect={() => {}} />)
    expect(screen.getByLabelText('failed').getAttribute('data-state')).toBe('failed')
    expect(container.querySelector('.motion-safe\\:animate-pulse')).toBeNull()
  })

  test('a working run reads as working and animates', () => {
    // One line: the circle says what the row used to print as a word, and the row's name says it too.
    const { container } = renderRail(<AgentHistory projectId="p1" scope="p1" agents={[agent()]} selectedAgentId={null} onSelect={() => {}} />)
    expect(screen.getByLabelText('working')).toBeTruthy()
    expect(screen.getByRole('link', { name: /· working ·/ })).toBeTruthy()
    expect(screen.getByLabelText('working').getAttribute('data-state')).toBe('working')
    expect(container.querySelector('.motion-safe\\:animate-pulse')).toBeTruthy()
  })

  test('a row is its mark, its name and its age until more is asked for: no person, no logo, no project, and its name still says them', async () => {
    renderRail(<AgentHistory projectId="p1" scope="p1" agents={[agent({ status: 'done', driver: 'codex', person: 'ada@x.dev' }), agent({ id: 'r2', status: 'done', driver: 'claude-code', person: 'rom@y.dev' })]} selectedAgentId={null} onSelect={() => {}} />)
    expect(screen.queryByLabelText('Codex')).toBeNull()
    expect(screen.queryByRole('img', { name: 'ada@x.dev' })).toBeNull()
    await waitFor(() => expect(screen.getAllByRole('link', { name: /· done ·/ }).map(row => row.getAttribute('aria-label'))).toEqual([expect.stringMatching(/ada@x\.dev · Codex/), expect.stringMatching(/rom@y\.dev · Claude Code/)]))
  })

  test('asked for from the menu beside "Log", a row shows which coding agent ran it, and whose run it is; with both, the logo rides on the picture', async () => {
    const agents = [agent({ status: 'done', driver: 'codex', person: 'ada@x.dev', model: 'gpt-5' })]
    preferences.current = { recentsAgent: true }
    renderRail(<AgentHistory projectId="p1" scope="p1" agents={agents} selectedAgentId={null} onSelect={() => {}} />)
    expect((await screen.findByLabelText('Codex · gpt-5')).closest('.rounded-full')).toBeNull()
    expect(screen.queryByRole('img', { name: 'ada@x.dev' })).toBeNull()
    cleanup()
    preferences.current = { recentsAgent: true, recentsPerson: true }
    renderRail(<AgentHistory projectId="p1" scope="p1" agents={agents} selectedAgentId={null} onSelect={() => {}} />)
    const person = screen.getByRole('img', { name: 'ada@x.dev' })
    // One mark for the two: the logo on a small disc at the picture's corner.
    expect(person.parentElement!.contains(await screen.findByLabelText('Codex · gpt-5'))).toBe(true)
    expect(screen.getByLabelText('Codex · gpt-5').parentElement!.className).toContain('absolute')
  })

  test('a row ends with how long ago its run started, in a word', () => {
    const startedAt = new Date(Date.now() - 12 * 60_000 - 5_000).toISOString()
    renderRail(<AgentHistory projectId="p1" scope="p1" agents={[agent({ title: 'Login page', startedAt })]} selectedAgentId={null} onSelect={() => {}} />)
    expect(screen.getByRole('link', { name: /^Login page/ }).textContent).toBe('Login page12m')
  })

  test('a named run reads by its name, not by the words the person typed', () => {
    renderRail(<AgentHistory projectId="p1" scope="p1" agents={[agent({ title: 'Welcome message' })]} selectedAgentId={null} onSelect={() => {}} />)
    expect(screen.getByText('Welcome message')).toBeTruthy()
    expect(screen.queryByText("replace 'Hello, world!' with 'Welcome!'")).toBeNull()
  })

  test('a run that ended on its question reads as needing an answer, its mark in the waiting colour', () => {
    // It asked and waits for the answer: its mark is a working run's in another colour.
    const { container } = renderRail(
      <AgentHistory projectId="p1" scope="p1" agents={[agent({ status: 'waiting' })]} selectedAgentId={null} onSelect={() => {}} />,
    )
    expect(screen.getByLabelText('needs answer')).toBeTruthy()
    expect(screen.queryByLabelText('working')).toBeNull()
    expect(container.querySelector('svg.text-warning')).toBeTruthy()
    expect(container.querySelector('svg.text-info')).toBeNull()
    expect(screen.getByLabelText('needs answer').getAttribute('data-state')).toBe('waiting')
  })

  test('an ended run the daemon marks saving reads as saving… (#1455)', () => {
    const { container } = renderRail(
      <AgentHistory projectId="p1" scope="p1" agents={[agent({ status: 'done', saving: true })]} selectedAgentId={null} onSelect={() => {}} />,
    )
    expect(screen.getByLabelText('saving…')).toBeTruthy()
    expect(screen.queryByLabelText('done')).toBeNull()
    expect(container.querySelector('.motion-safe\\:animate-pulse')).toBeTruthy()
  })

  test('an ended run without the mark reads as plain done (#1455)', () => {
    renderRail(<AgentHistory projectId="p1" scope="p1" agents={[agent({ status: 'done' })]} selectedAgentId={null} onSelect={() => {}} />)
    expect(screen.queryByLabelText('saving…')).toBeNull()
    expect(screen.getByLabelText('done')).toBeTruthy()
  })

  test('a session selected before its row lands highlights the starting row (#784)', () => {
    // Start navigates to the run's id right away; its card, and so its row, arrives a beat
    // later. The highlight belongs on the optimistic row standing in for it, not on the home row.
    const { container, rerender } = renderRail(
      <AgentHistory projectId="p1" scope="p1" agents={[]} selectedAgentId={null} onSelect={() => {}} startTick={0} startIntent="" />,
    )
    rerender(
      <SidebarProvider>
        <AgentHistory projectId="p1" scope="p1" agents={[]} selectedAgentId="run-2" onSelect={() => {}} startTick={1} startIntent="add dark mode" />
      </SidebarProvider>,
    )
    const rows = [...container.querySelectorAll('a, button')]
    const home = rows.find(row => row.textContent?.trim() === 'New agent session')
    const starting = rows.find(row => row.hasAttribute('data-stand-in'))
    expect(starting?.classList.contains('bg-foreground/8')).toBe(true)
    expect(home?.classList.contains('bg-foreground/8')).toBe(false)
  })

  test('the stand-in row reads as the run’s own row will: working, the project and "just now" where every project shows, the name on its way, not dimmed', () => {
    const { container, rerender } = renderRail(
      <AgentHistory projectId="p1" scope={null} agents={[]} recentAgents={[]} selectedAgentId={null} onSelect={() => {}} startTick={0} startIntent="" />,
    )
    rerender(
      <SidebarProvider>
        <AgentHistory projectId="p1" scope={null} agents={[]} recentAgents={[]} selectedAgentId="run-2" onSelect={() => {}} startTick={1} startIntent="add dark mode" startId="run-2" startProjectName="alpha" />
      </SidebarProvider>,
    )
    const row = [...container.querySelectorAll('a, button')].find(row => row.hasAttribute('data-stand-in'))!
    // The run's own row will carry a name seconds from now, so this one holds the place: printing
    // the prompt here is what made the rail flicker, the prompt swapped for the name a beat later.
    // Alone in the list, its project tells it from no other row: the row's name says it.
    expect(row.querySelector('.rail-title')!.textContent).toBe('')
    expect(row.textContent).toBe('now')
    expect(row.querySelector('.rail-title .animate-pulse')).toBeTruthy()
    expect(row.getAttribute('aria-label')).toBe('Naming this session · working · alpha · just now')
    expect(row.textContent).not.toContain('starting…')
    expect(row.className).not.toContain('opacity-70')
  })

  test('with one project picked the stand-in row says the time alone, as a real row does there', () => {
    const { container, rerender } = renderRail(
      <AgentHistory projectId="p1" scope="p1" agents={[]} selectedAgentId={null} onSelect={() => {}} startTick={0} startIntent="" />,
    )
    rerender(
      <SidebarProvider>
        <AgentHistory projectId="p1" scope="p1" agents={[]} selectedAgentId="run-3" onSelect={() => {}} startTick={1} startIntent="add a footer" startId="run-3" startProjectName="alpha" />
      </SidebarProvider>,
    )
    const standInRow = [...container.querySelectorAll('a, button')].find(row => row.hasAttribute('data-stand-in'))!
    expect(standInRow.querySelector('.rail-title')!.textContent).toBe('')
    expect(standInRow.getAttribute('aria-label')).toBe('Naming this session · working · just now')
  })

  test('with naming turned off the stand-in row prints the prompt: no name is coming to replace it', async () => {
    namesRuns.current = false
    const { container, rerender } = renderRail(
      <AgentHistory projectId="p1" scope="p1" agents={[]} selectedAgentId={null} onSelect={() => {}} startTick={0} startIntent="" />,
    )
    rerender(
      <SidebarProvider>
        <AgentHistory projectId="p1" scope="p1" agents={[]} selectedAgentId="run-4" onSelect={() => {}} startTick={1} startIntent="add a footer" startId="run-4" />
      </SidebarProvider>,
    )
    const row = [...container.querySelectorAll('a, button')].find(row => row.hasAttribute('data-stand-in'))!
    await waitFor(() => expect(row.querySelector('.rail-title')!.textContent).toBe('add a footer'))
    expect(row.querySelector('.rail-title .animate-pulse')).toBeNull()
  })

  test('the starting row retires when the run it stands in for lands, even if it never ran', () => {
    // The agents list polls every 2s, so a session that starts and fails inside one interval is never
    // once observed `running`. The stand-in used to wait for a running row to hand over to, so it
    // sat beside the finished session's own row claiming a second session was starting, until a
    // 20s deadline swept it. Landing is the handover, whatever status the agent landed in.
    const { container, rerender } = renderRail(
      <AgentHistory projectId="p1" scope="p1" agents={[]} selectedAgentId={null} onSelect={() => {}} startTick={0} startIntent="" />,
    )
    rerender(
      <SidebarProvider>
        <AgentHistory projectId="p1" scope="p1" agents={[]} selectedAgentId={null} onSelect={() => {}} startTick={1} startIntent="hi" startId="run-9" />
      </SidebarProvider>,
    )
    expect([...container.querySelectorAll('a, button')].some(row => row.hasAttribute('data-stand-in'))).toBe(true)

    // The poll catches up: the agent is already over, and was never seen running.
    rerender(
      <SidebarProvider>
        <AgentHistory
          projectId="p1" scope="p1"
          agents={[agent({ id: 'run-9', status: 'failed', intent: 'hi' })]}
          selectedAgentId={null}
          onSelect={() => {}}
          startTick={1}
          startIntent="hi"
          startId="run-9"
        />
      </SidebarProvider>,
    )
    const rows = [...container.querySelectorAll('a, button')]
    expect(rows.some(row => row.hasAttribute('data-stand-in'))).toBe(false)
    expect(rows.some(row => row.getAttribute('aria-label')?.includes('failed'))).toBe(true)
  })

  test('the starting row survives a run that was already there when Start was clicked', () => {
    // The guard against retiring the stand-in on the wrong evidence: an older session in the list
    // is not the one being waited for, so its presence must not count as the handover.
    const older = agent({ id: 'run-old', status: 'done', intent: 'earlier work' })
    const { container, rerender } = renderRail(
      <AgentHistory projectId="p1" scope="p1" agents={[older]} selectedAgentId={null} onSelect={() => {}} startTick={0} startIntent="" />,
    )
    rerender(
      <SidebarProvider>
        <AgentHistory projectId="p1" scope="p1" agents={[older]} selectedAgentId={null} onSelect={() => {}} startTick={1} startIntent="hi" startId="run-new" />
      </SidebarProvider>,
    )
    expect([...container.querySelectorAll('a, button')].some(row => row.hasAttribute('data-stand-in'))).toBe(true)
  })

  test('a start while another agent works has its starting row at once, marked as the page it opened, until its own row lands', () => {
    // Any run at work used to count as the one just started: with another agent working, the usual
    // day, the new run had no row until its own landed seconds later, and nothing in the list was marked.
    const atWork = agent({ id: 'run-old', status: 'running', intent: 'earlier work' })
    const { container, rerender } = renderRail(
      <AgentHistory projectId="p1" scope="p1" agents={[atWork]} selectedAgentId={null} onSelect={() => {}} startTick={0} startIntent="" />,
    )
    const standIn = () => [...container.querySelectorAll('a, button')].find(row => row.hasAttribute('data-stand-in'))
    rerender(
      <SidebarProvider>
        <AgentHistory projectId="p1" scope="p1" agents={[atWork]} selectedAgentId="run-new" onSelect={() => {}} startTick={1} startIntent="hi" startId="run-new" />
      </SidebarProvider>,
    )
    expect(standIn()?.classList.contains('bg-foreground/8')).toBe(true)
    expect(screen.getByRole('link', { name: /earlier work · working/ }).classList.contains('bg-foreground/8')).toBe(false)
    rerender(
      <SidebarProvider>
        <AgentHistory projectId="p1" scope="p1" agents={[agent({ id: 'run-new', intent: 'hi' }), atWork]} selectedAgentId="run-new" onSelect={() => {}} startTick={1} startIntent="hi" startId="run-new" />
      </SidebarProvider>,
    )
    expect(standIn()).toBeUndefined()
    expect(screen.getByRole('link', { name: /hi · working/ }).classList.contains('bg-foreground/8')).toBe(true)
  })

  test('the starting row of a start that brought no run goes after twenty seconds, while another agent works too', () => {
    vi.useFakeTimers()
    try {
      const atWork = agent({ id: 'run-old', status: 'running', intent: 'earlier work' })
      const { container, rerender } = renderRail(
        <AgentHistory projectId="p1" scope="p1" agents={[atWork]} selectedAgentId={null} onSelect={() => {}} startTick={0} startIntent="" />,
      )
      const standIn = () => [...container.querySelectorAll('a, button')].some(row => row.hasAttribute('data-stand-in'))
      rerender(
        <SidebarProvider>
          <AgentHistory projectId="p1" scope="p1" agents={[atWork]} selectedAgentId={null} onSelect={() => {}} startTick={1} startIntent="hi" startId="run-gone" />
        </SidebarProvider>,
      )
      expect(standIn()).toBe(true)
      act(() => void vi.advanceTimersByTime(19_000))
      expect(standIn()).toBe(true)
      act(() => void vi.advanceTimersByTime(1_000))
      // Not kept for the moment the other agent ends, to come up then for a run that never was.
      expect(standIn()).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  test('a run the list already holds when its start comes back gets no starting row, running or ended', () => {
    // A start takes seconds, and the list polls every 2s: the run's own row is often there
    // before the start reports its id. That row is the run; a stand-in beside it would be a second one.
    const running = agent({ id: 'run-7', status: 'running', intent: 'hi' })
    const { container, rerender } = renderRail(
      <AgentHistory projectId="p1" scope="p1" agents={[running]} selectedAgentId={null} onSelect={() => {}} startTick={0} startIntent="" />,
    )
    const standIn = () => [...container.querySelectorAll('a, button')].some(row => row.hasAttribute('data-stand-in'))
    rerender(
      <SidebarProvider>
        <AgentHistory projectId="p1" scope="p1" agents={[running]} selectedAgentId="run-7" onSelect={() => {}} startTick={1} startIntent="hi" startId="run-7" />
      </SidebarProvider>,
    )
    expect(standIn()).toBe(false)
    rerender(
      <SidebarProvider>
        <AgentHistory projectId="p1" scope="p1" agents={[{ ...running, status: 'done' }]} selectedAgentId="run-7" onSelect={() => {}} startTick={1} startIntent="hi" startId="run-7" />
      </SidebarProvider>,
    )
    expect(standIn()).toBe(false)
  })
})

// The rail is the shadcn Sidebar now (shared shell), a fixed-width in-flow column rather than the
// bespoke collapsing <aside> of #862 — the shadcn Sidebar owns collapse, and the shell never drove
// the old prop, so those strip/float tests are retired with it.
describe('AgentHistory rows', () => {
  test('the marks of a row stand in one order: where it runs, its pull requests and the work it left, its age, then who and which agent', async () => {
    preferences.current = { recentsAgent: true }
    const main = agent({ id: 'main', status: 'done', target: 'web', driver: 'codex', pr: { number: 3, url: 'u' }, prState: 'open' })
    renderRail(<AgentHistory projectId="p1" scope="p1" agents={[main]} waiting={waitingOn({ run: 'main', words: 'Needs push', detail: '1 commit', mark: 'branch' })} selectedAgentId={null} onSelect={() => {}} />)
    const row = (await screen.findByLabelText('Runs on Claude Code on the web')).closest('a')!
    expect([...row.querySelectorAll('[aria-label]')].map(mark => mark.getAttribute('aria-label'))).toEqual(['done', 'Runs on Claude Code on the web', 'PR #3 open', 'Needs push · 1 commit', 'Codex'])
    // Where it runs, the request and the work stand in one box with the age, set to its right, 4 from the age's word.
    const box = screen.getByLabelText('PR #3 open').parentElement!
    expect(box).toBe(screen.getByLabelText('Runs on Claude Code on the web').parentElement)
    expect(box.className.split(' ')).toEqual(expect.arrayContaining(['justify-end', 'gap-1', 'min-w-7']))
    expect(box.lastElementChild!.textContent).toMatch(/^\d+[a-z]$/)
  })

  test('a run another machine started says whose it is; this daemon\'s own does not (#1067, #1648)', () => {
    const rows = [
      { projectId: 'p', projectName: 'gemstack', agent: agent({ id: 'theirs', host: 'rom-thinkpad-x280', otherHost: true }) },
      { projectId: 'p', projectName: 'gemstack', agent: agent({ id: 'mine', host: 'this-mac' }) },
    ]
    renderRail(<AgentHistory projectId={null} agents={[]} recentAgents={rows} selectedAgentId={null} onSelect={() => {}} />)
    expect(screen.getByLabelText('Started on rom-thinkpad-x280')).toBeTruthy()
    expect(screen.queryByLabelText('Started on this-mac')).toBeNull()
  })

  test('work that never left the machine is the mark of what waits on its run, in gray, where a pull request would be: a branch for commits, a file for files left uncommitted', async () => {
    const agents = [agent({ id: 'waits', status: 'done', driver: 'claude-code' }), agent({ id: 'one', status: 'done' }), agent({ id: 'left', status: 'done' }), agent({ id: 'none', status: 'done' })]
    const waiting = waitingOn(
      { run: 'waits', words: 'Needs push', detail: '2 commits', mark: 'branch' },
      { run: 'one', words: 'Needs push', detail: '1 commit', mark: 'branch' },
      { run: 'left', words: 'Needs commit', detail: '1 file', mark: 'changes' },
    )
    renderRail(<AgentHistory projectId="p1" scope="p1" agents={agents} waiting={waiting} selectedAgentId={null} onSelect={() => {}} />)
    const glyph = screen.getByLabelText('Needs push · 2 commits').querySelector('svg')!.getAttribute('class')
    expect(glyph).toContain('lucide-git-branch')
    expect(glyph).toContain('text-muted-foreground')
    expect(screen.getByLabelText('Needs push · 1 commit')).toBeTruthy()
    expect(screen.getAllByLabelText(/^Needs push/)).toHaveLength(2)
    expect(screen.getByLabelText('Needs commit · 1 file').querySelector('svg')!.getAttribute('class')).toContain('lucide-file-pen')
    // The row's own sentence says it too.
    expect(screen.getByLabelText('Needs push · 2 commits').closest('a')!.getAttribute('aria-label')).toContain('Needs push · 2 commits')
  })

  test('a run\'s pull request is a glyph before its age, its shape and colour by how it stands', async () => {
    const agents = [
      agent({ id: 'open', status: 'done', driver: 'claude-code', pr: { number: 12, url: 'u' }, prState: 'open' }),
      agent({ id: 'draft', status: 'done', pr: { number: 13, url: 'u' }, prState: 'draft' }),
      agent({ id: 'merged', status: 'done', pr: { number: 14, url: 'u' }, prState: 'merged' }),
      agent({ id: 'closed', status: 'done', pr: { number: 15, url: 'u' }, prState: 'closed' }),
      agent({ id: 'unread', status: 'done', pr: { number: 16, url: 'u' } }),
      agent({ id: 'none', status: 'done' }),
    ]
    renderRail(<AgentHistory projectId="p1" scope="p1" agents={agents} selectedAgentId={null} onSelect={() => {}} />)
    const glyph = (label: string) => `${screen.getByLabelText(label).querySelector('svg')!.getAttribute('class')} ${screen.getByLabelText(label).querySelector('[data-pr]')!.className}`
    expect(glyph('PR #12 open')).toContain('lucide-git-pull-request')
    expect(glyph('PR #12 open')).toContain('text-success')
    expect(glyph('PR #13 draft')).toContain('lucide-git-pull-request-draft')
    expect(glyph('PR #14 merged')).toContain('lucide-git-merge')
    expect(glyph('PR #14 merged')).toContain('text-merged')
    expect(glyph('PR #15 closed')).toContain('lucide-git-pull-request-closed')
    expect(glyph('PR #15 closed')).toContain('text-danger')
    // A request whose state is not known has no mark, which would read as one more state; its number stays in the row's sentence.
    expect(screen.getAllByLabelText(/^PR #/)).toHaveLength(4)
    expect(screen.getByRole('link', { name: /PR #16$/ })).toBeTruthy()
    expect(screen.getByLabelText('PR #12 open').closest('a')!.getAttribute('aria-label')).toContain('PR #12 open')
  })

  test('a run with several pull requests: those that stand alike are one glyph with their count at its corner, those that differ stand side by side', () => {
    const earlierPrs = [{ number: 7, url: 'a', state: 'merged' as const }, { number: 8, url: 'b', state: 'merged' as const }, { number: 9, url: 'c', state: 'open' as const }]
    renderRail(<AgentHistory projectId="p1" scope="p1" agents={[agent({ status: 'done', earlierPrs, pr: { number: 9, url: 'c' }, prState: 'open' })]} selectedAgentId={null} onSelect={() => {}} />)
    // The request it has now is among the earlier ones too: said once.
    const marks = screen.getByLabelText('PRs #7 merged, #8 merged, #9 open')
    expect([...marks.querySelectorAll('[data-pr]')].map(mark => [mark.getAttribute('data-pr'), mark.textContent])).toEqual([['merged', '2'], ['open', '']])
  })

  // The shared shell: the rail is present on the home/Overview too (no project selected), showing
  // the New launcher rather than vanishing.
  test('with no project and no recents it still renders New and an empty hint', () => {
    renderRail(<AgentHistory projectId={null} agents={[]} recentAgents={[]} selectedAgentId={null} onSelect={() => {}} />)
    expect(screen.getByText('New agent session')).toBeTruthy()
    expect(screen.getByText('No sessions yet.')).toBeTruthy()
  })

  // On the Overview the rail pools every project's sessions; a row names its project and jumps in.
  test('on the Overview it lists cross-project recents and selecting one jumps into its project', () => {
    let picked: [string, string] | null = null
    const recentAgents = [
      { projectId: 'proj-a', projectName: 'alpha', agent: agent({ id: 'r-a', intent: 'fix login' }) },
      { projectId: 'proj-b', projectName: 'beta', agent: agent({ id: 'r-b', status: 'done', intent: 'add tests' }) },
    ]
    renderRail(
      <AgentHistory
        projectId={null}
        agents={[]}
        recentAgents={recentAgents}
        onSelectRecent={(pid, rid) => (picked = [pid, rid])}
        selectedAgentId={null}
        onSelect={() => {}}
      />,
    )
    expect(screen.getByText('fix login')).toBeTruthy()
    // Which project a row belongs to is in the row's own name now, not printed under it.
    expect(screen.getByRole('link', { name: /fix login · working · alpha/ })).toBeTruthy()
    fireEvent.click(screen.getByText('add tests'))
    expect(picked).toEqual(['proj-b', 'r-b'])
  })
})

describe('whose run a row is', () => {
  afterEach(() => {
    forgetRemembered()
    localStorage.clear()
    onPeople.mockReset()
    onPeople.mockResolvedValue([])
  })

  const ada = { email: 'ada@x.dev', login: 'ada', avatar: 'https://avatars.githubusercontent.com/u/1' }
  const row = (name: RegExp) => screen.getByRole('link', { name })
  // The person asked for it, from the menu beside "Log".
  beforeEach(() => {
    preferences.current = { recentsPerson: true, recentsAgent: true }
  })

  test("two letters at first, the person's picture once the git host said, the agent's logo on it", async () => {
    onPeople.mockResolvedValue([ada])
    renderRail(
      <AgentHistory
        projectId="p1"
        scope="p1"
        agents={[agent({ id: 'r1', title: 'Hers', person: 'ada@x.dev', driver: 'codex' }), agent({ id: 'r2', title: 'His', person: 'rom@y.dev' })]}
        selectedAgentId={null}
        onSelect={() => {}}
      />,
    )
    // The letters are there from the row's first frame: nothing moves when the picture lands.
    expect(within(row(/^Hers/)).getByText('AD')).toBeTruthy()
    await waitFor(() => expect(row(/^Hers/).querySelector('img')?.getAttribute('src')).toBe(ada.avatar))
    const mark = within(row(/^Hers/)).getByRole('img', { name: 'ada@x.dev · ada' })
    expect(mark.compareDocumentPosition(within(row(/^Hers/)).getByLabelText('Codex')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // The host knows nobody for this email: the letters stay, and the mark says the email.
    expect(row(/^His/).querySelector('img')).toBeNull()
    expect(within(row(/^His/)).getByRole('img', { name: 'rom@y.dev' }).textContent).toBe('RO')
    // The row's own sentence says it too.
    expect(row(/^Hers/).getAttribute('aria-label')).toContain('ada@x.dev · ada')
  })

  test("your own run where no git host answers, a session with no project say: your own picture, as the sidebar's foot shows it", async () => {
    onPerson.mockResolvedValue({ name: 'Ada Lovelace', email: 'ada@x.dev', avatar: 'https://avatars.githubusercontent.com/u/9' })
    try {
      renderRail(<AgentHistory projectId="session" scope="session" agents={[agent({ id: 'r1', title: 'Hi five', person: 'Ada@x.dev' }), agent({ id: 'r2', title: 'His', person: 'rom@y.dev' })]} selectedAgentId={null} onSelect={() => {}} />)
      await waitFor(() => expect(row(/^Hi five/).querySelector('img')?.getAttribute('src')).toBe('https://avatars.githubusercontent.com/u/9'))
      expect(row(/^His/).querySelector('img')).toBeNull()
      // Until the picture lands, the letters are your name's, as the foot has them, not your email's.
      expect(within(row(/^Hi five/)).getByRole('img', { name: /Ada@x\.dev/ }).textContent).toBe('AL')
    } finally {
      onPerson.mockResolvedValue({ name: 'Ada Lovelace' })
    }
  })

  test("a session with no project shows its person as a project's git host knows them on another row: one person, one picture down the list", async () => {
    onPeople.mockImplementation(async projectId => (projectId === 'p1' ? [ada] : []))
    const recent = (projectId: string, id: string, person: string) => ({ projectId, projectName: projectId, agent: agent({ id, title: `${projectId} ${id}`, person }) })
    renderRail(<AgentHistory projectId={null} scope={null} agents={[]} recentAgents={[recent('p1', 'r1', 'ada@x.dev'), recent('session', 'r2', 'Ada@x.dev'), recent('session', 'r3', 'rom@y.dev')]} selectedAgentId={null} onSelect={() => {}} />)
    await waitFor(() => expect(row(/^p1 r1/).querySelector('img')?.getAttribute('src')).toBe(ada.avatar))
    await waitFor(() => expect(row(/^session r2/).querySelector('img')?.getAttribute('src')).toBe(ada.avatar))
    // Nobody's host knows this one: the letters stay.
    expect(row(/^session r3/).querySelector('img')).toBeNull()
  })

  test('a run that names nobody has no mark', () => {
    renderRail(<AgentHistory projectId="p1" scope="p1" agents={[agent({ title: 'Very old' })]} selectedAgentId={null} onSelect={() => {}} />)
    expect(row(/^Very old/).querySelector('[class*="rounded-full"][class*="size-3.5"]')).toBeNull()
    expect(onPeople).not.toHaveBeenCalled()
  })

  test("the rail of every project asks each project of its own people, once, whatever is polled; a project's picture is not another's", async () => {
    onPeople.mockImplementation(async projectId => (projectId === 'p1' ? [ada] : []))
    const recent = (projectId: string, id: string, person: string) => ({ projectId, projectName: projectId, agent: agent({ id, title: `${projectId} ${id}`, person }) })
    const rail = (recentAgents: ReturnType<typeof recent>[]) => <SidebarProvider><AgentHistory projectId={null} scope={null} agents={[]} recentAgents={recentAgents} selectedAgentId={null} onSelect={() => {}} /></SidebarProvider>
    const { rerender } = render(rail([recent('p1', 'r1', 'ada@x.dev'), recent('p1', 'r2', 'ada@x.dev'), recent('p2', 'r3', 'ada@x.dev'), recent('p2', 'r4', 'rom@y.dev')]))
    await waitFor(() => expect(row(/^p1 r1/).querySelector('img')).toBeTruthy())
    expect(row(/^p1 r2/).querySelector('img')).toBeTruthy()
    expect(row(/^p2 r3/).querySelector('img')).toBeNull()
    expect(onPeople.mock.calls.map(([projectId, emails]) => [projectId, emails])).toEqual([
      ['p1', ['ada@x.dev']],
      ['p2', ['ada@x.dev', 'rom@y.dev']],
    ])
    // The list read again, with the same people, in a new order.
    rerender(rail([recent('p2', 'r4', 'rom@y.dev'), recent('p2', 'r3', 'ada@x.dev'), recent('p1', 'r2', 'ada@x.dev'), recent('p1', 'r1', 'ada@x.dev')]))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(onPeople).toHaveBeenCalledTimes(2)
  })

  test("a row of the picked project's list on a page of no project still asks that project", async () => {
    onPeople.mockResolvedValue([ada])
    renderRail(<AgentHistory projectId={null} scope="p1" agents={[agent({ title: 'Hers', person: 'ada@x.dev' }), agent({ id: 'r2', title: 'His', person: 'rom@y.dev' })]} selectedAgentId={null} onSelect={() => {}} />)
    await waitFor(() => expect(row(/^Hers/).querySelector('img')).toBeTruthy())
    expect(onPeople).toHaveBeenCalledWith('p1', ['ada@x.dev', 'rom@y.dev'])
  })

  test("the row of a run just started holds the mark's place, with no one in it yet", () => {
    const listed = [agent({ id: 'a', status: 'done', person: 'ada@x.dev' }), agent({ id: 'b', status: 'done', person: 'rom@y.dev' })]
    const rail = (startTick: number) => <AgentHistory projectId="p1" scope="p1" agents={listed} selectedAgentId="r1" onSelect={() => {}} startTick={startTick} startIntent="add dark mode" startId="r1" />
    const { container, rerender } = render(<SidebarProvider>{rail(0)}</SidebarProvider>)
    rerender(<SidebarProvider>{rail(1)}</SidebarProvider>)
    const standIn = container.querySelector('[data-stand-in]')!
    expect(standIn.querySelector('[aria-hidden="true"][class*="size-5"].rounded-full')).toBeTruthy()
  })
})

const proj = (id: string, name: string): ProjectSummary => ({ id, path: `/${id}`, name })

describe('AgentHistory New button (#new-button)', () => {
  test('with no project, New starts a session with no project', () => {
    let started: string | null = null
    renderRail(
      <AgentHistory
        projectId={null}
        agents={[]}
        recentAgents={[]}
        projects={[]}
        onNewAgentInProject={id => (started = id)}
        selectedAgentId={null}
        onSelect={() => {}}
      />,
    )
    fireEvent.click(screen.getByText('New agent session'))
    expect(started).toBe('session')
  })

  test('with projects and none picked, New is one click to a session with no project: where it works is picked on its page', () => {
    let started: string | null = null
    renderRail(
      <AgentHistory
        projectId={null}
        agents={[]}
        recentAgents={[]}
        projects={[proj('p1', 'alpha'), proj('p2', 'beta')]}
        onNewAgentInProject={id => (started = id)}
        selectedAgentId={null}
        onSelect={() => {}}
      />,
    )
    const button = screen.getByRole('link', { name: 'New agent session' })
    expect(button.getAttribute('aria-haspopup')).toBeNull()
    fireEvent.click(button)
    expect(started).toBe('session')
  })

  test('inside a project, New starts another session in that project', () => {
    let started: string | null = null
    renderRail(
      <AgentHistory
        projectId="p9" scope="p9"
        agents={[]}
        projects={[proj('p1', 'alpha'), proj('p9', 'nine')]}
        onNewAgentInProject={id => (started = id)}
        selectedAgentId={null}
        onSelect={() => {}}
      />,
    )
    fireEvent.click(screen.getByText('New agent session'))
    expect(started).toBe('p9')
  })

})

describe('runs on another host on the rail (#1263, #2394)', () => {
  test("a run on a host beside this computer's carries the host's mark, named as its project's module names it, and still names its agent", async () => {
    renderRail(
      <AgentHistory
        projectId="p1" scope="p1"
        agents={[agent({ status: 'running', target: 'web', driver: 'claude-code' }), agent({ id: 'r2', status: 'done', driver: 'codex' })]}
        selectedAgentId={null}
        onSelect={() => {}}
      />,
    )
    expect(await screen.findByLabelText('Runs on Claude Code on the web')).toBeTruthy()
    // Where it runs is the host, not the agent: it is Claude Code.
    expect(screen.getByRole('link', { name: /· working ·/ }).getAttribute('aria-label')).toMatch(/Claude Code · runs on Claude Code on the web/)
    // At work over there for as long as its record says so.
    expect(screen.getByLabelText('working')).toBeTruthy()
  })

  test("a host its project's modules no longer bring is still another host", async () => {
    renderRail(<AgentHistory projectId="p2" scope="p2" agents={[agent({ status: 'done', target: 'web', driver: 'claude-code' })]} selectedAgentId={null} onSelect={() => {}} />)
    expect(await screen.findByLabelText('Runs on another host')).toBeTruthy()
    expect(screen.getByLabelText('done')).toBeTruthy()
  })

  test('a run on this computer gets no host mark', () => {
    renderRail(<AgentHistory projectId="p1" scope="p1" agents={[agent({ status: 'done', driver: 'claude-code' })]} selectedAgentId={null} onSelect={() => {}} />)
    expect(screen.getByLabelText('done')).toBeTruthy()
    expect(screen.queryByLabelText(/^Runs on /)).toBeNull()
  })
})

describe('AgentHistory row hover', () => {
  test('pointed at, a row says all of it beside itself: its whole name and how it stands, a chip per thing known of where it is, and at the foot who started it and what ran it', async () => {
    const long = 'refactor the queue promotion sweep so drains claim tickets through lock files'
    const recentAgents = [{ projectId: 'p1', projectName: 'shop', agent: agent({ status: 'done', intent: long, driver: 'codex', model: 'gpt-5', effort: 'xhigh', base: 'next', person: 'ada@x.dev', pr: { number: 5, url: 'https://x/pull/5' }, prState: 'open' }) }]
    renderRail(<AgentHistory projectId={null} agents={[]} recentAgents={recentAgents} waiting={waitingOn({ run: 'run-1', words: 'Needs push', detail: '2 commits', mark: 'branch' })} selectedAgentId={null} onSelect={() => {}} />)
    const tip = await hoverTooltip(screen.getByRole('link', { name: new RegExp(`^${long}`) }))
    expect(tip.querySelector('[data-card="name"]')!.textContent).toBe(long)
    expect(tip.querySelector('[data-card="state"]')!.textContent).toMatch(/^Done · /)
    // No table of labels: what is known of where the run is, a chip each, the branch with its project.
    expect(within(tip).getAllByRole('listitem').map(chip => chip.getAttribute('aria-label'))).toEqual(['Project: shop · next', 'PR: #5 · Open', 'Work: Needs push · 2 commits'])
    // The foot: the person by name over their address, and the model by its maker's logo with how hard it thought, the coding agent's name not written.
    const foot = tip.querySelector('[data-card="foot"]')!
    expect(foot.textContent).toBe('ADadaada@x.devgpt-5· Extra high')
    expect(within(foot as HTMLElement).getByRole('img', { name: 'Codex · gpt-5 · Extra high' })).toBeTruthy()
    expect(tip.textContent).not.toContain('Codex')
    // One width for every row.
    expect(tip.className).toContain('w-75')
  })

  test('a row with nothing but its name says its state and when it started, and has no foot', async () => {
    renderRail(<AgentHistory projectId="p1" scope="p1" agents={[agent({ title: 'Plain', status: 'failed', startedAt: new Date().toISOString() })]} selectedAgentId={null} onSelect={() => {}} />)
    const tip = await hoverTooltip(screen.getByRole('link', { name: /^Plain/ }))
    expect(tip.querySelector('[data-card="state"]')!.textContent).toBe('Failed · just now')
    expect(within(tip).queryAllByRole('listitem')).toEqual([])
    expect(tip.querySelector('[data-card="foot"]')).toBeNull()
  })

  test("a run whose record names no model shows its coding agent's logo alone, named for a reader", async () => {
    renderRail(<AgentHistory projectId="p1" scope="p1" agents={[agent({ title: 'Plain', status: 'done', driver: 'claude-code' })]} selectedAgentId={null} onSelect={() => {}} />)
    const tip = await hoverTooltip(screen.getByRole('link', { name: /^Plain/ }))
    const foot = tip.querySelector('[data-card="foot"]') as HTMLElement
    expect(within(foot).getByRole('img', { name: 'Claude Code' })).toBeTruthy()
    expect(foot.textContent).toBe('')
  })

  test('what waits on the person says its name whole, what it needs in words and what that is about', async () => {
    const asked = { projectId: 'p1', projectName: 'shop', kind: 'waiting' as const, module: 'ask', scope: 'run' as const, run: 'r1', id: 'r1:q', words: 'Needs answer', title: 'Pick a colour', detail: 'Blue or green?', mark: 'question' as const, since: new Date().toISOString() }
    renderRail(<AgentHistory projectId={null} agents={[]} recentAgents={[]} selectedAgentId={null} onSelect={() => {}} waiting={[asked]} />)
    const tip = await hoverTooltip(screen.getByRole('link', { name: 'Pick a colour · Needs answer' }))
    expect([...tip.children].map(line => line.textContent)).toEqual(['Pick a colour', 'Needs answer · Blue or green? · shop'])
  })
})

describe('the rows by project (#1513)', () => {
  const stranded: ProjectSummary = {
    id: 'p1',
    path: '/repos/p1',
    name: 'alpha',
    errors: [{ id: 'store-git-branch:data-sync', title: 'Not syncing with the remote', message: 'the data branch could not be pushed: Permission denied (publickey)', since: '2026-08-20T10:00:00.000Z' }],
  }
  const idle: ProjectSummary = { id: 'p2', path: '/repos/p2', name: 'beta' }

  test('two projects with the same name: the Overview\'s rows say which folder each is in', () => {
    const work: ProjectSummary = { id: 'shop-1', path: '/home/me/work/shop', name: 'shop' }
    const clients: ProjectSummary = { id: 'shop-2', path: '/home/me/clients/shop', name: 'shop' }
    const projects = [work, clients, idle]
    const recentAgents = [
      { projectId: 'shop-2', projectName: 'shop', agent: agent({ id: 'b1', status: 'done', intent: 'second' }) },
      { projectId: 'shop-1', projectName: 'shop', agent: agent({ id: 'a1', status: 'done', intent: 'first' }) },
    ]
    renderRail(
      <ProjectLabelsContext.Provider value={projectLabels(projects)}>
        <AgentHistory projectId={null} scope={null} agents={[]} recentAgents={recentAgents} selectedAgentId={null} onSelect={() => {}} projects={projects} />
      </ProjectLabelsContext.Provider>,
    )
    expect(screen.getByRole('link', { name: /^second/ }).getAttribute('aria-label')).toContain('clients/shop')
  })

  test('with all projects showing, the row of the agent on screen is the highlighted one', () => {
    const recentAgents = [
      { projectId: 'p1', projectName: 'alpha', agent: agent({ id: 'a1', status: 'done', intent: 'first' }) },
      { projectId: 'p2', projectName: 'beta', agent: agent({ id: 'b1', status: 'done', intent: 'second' }) },
    ]
    renderRail(<AgentHistory projectId="p2" agents={[]} recentAgents={recentAgents} selectedAgentId="b1" onSelect={() => {}} projects={[stranded, idle]} />)
    expect(screen.getByText('second').closest('a')?.classList.contains('bg-foreground/8')).toBe(true)
    expect(screen.getByText('first').closest('a')?.classList.contains('bg-foreground/8')).toBe(false)
  })

  test('with all projects showing, New opens a session with no project even on a project\'s own page', () => {
    let started: string | null = null
    renderRail(<AgentHistory projectId="p2" agents={[]} recentAgents={[]} selectedAgentId={null} onSelect={() => {}} projects={[stranded, idle]} onNewAgentInProject={id => (started = id)} />)
    fireEvent.click(screen.getByRole('link', { name: 'New agent session' }))
    expect(started).toBe('session')
  })
})

describe('the rail marks the page that is open', () => {
  const PAGES = [{ segment: 'logs', label: 'Logs' }]
  /** The person's row at the rail's foot, which opens their menu with Settings in it. */
  const person = () => screen.getByRole('button', { name: /settings$/i })
  /** Which of the rail's ways somewhere say they are the page open now: the rows at its top, and the person's row at its foot. */
  const current = () => [['Overview', screen.getByRole('link', { name: 'Overview' })], ['Logs', screen.getByRole('link', { name: 'Logs' })], ['Settings', person()]].filter(([, row]) => (row as HTMLElement).getAttribute('aria-current') === 'page').map(([name]) => name)

  test('with no project, no page and no Settings open, the Overview row is the one marked', () => {
    renderRail(<AgentHistory projectId={null} agents={[]} recentAgents={[]} selectedAgentId={null} onSelect={() => {}} pages={PAGES} />)
    expect(current()).toEqual(['Overview'])
    // Not marked is no attribute at all, on a row as on the person's.
    expect(screen.getByRole('link', { name: 'Logs' }).hasAttribute('aria-current')).toBe(false)
    expect(person().hasAttribute('aria-current')).toBe(false)
  })

  test('on a module\'s page its row is the one marked, and inside a project none is', () => {
    const { unmount } = renderRail(<AgentHistory projectId={null} agents={[]} recentAgents={[]} selectedAgentId={null} onSelect={() => {}} pages={PAGES} activePage="logs" />)
    expect(current()).toEqual(['Logs'])
    unmount()
    renderRail(<AgentHistory projectId="p1" scope="p1" agents={[]} selectedAgentId={null} onSelect={() => {}} pages={PAGES} />)
    expect(current()).toEqual([])
  })

  test("the person's menu opens Settings", async () => {
    const onSettings = vi.fn()
    renderRail(<AgentHistory projectId={null} agents={[]} recentAgents={[]} selectedAgentId={null} onSelect={() => {}} pages={PAGES} onSettings={onSettings} />)
    await screen.findByRole('button', { name: 'Ada Lovelace: settings' })
    fireEvent.click(person())
    fireEvent.click(screen.getByRole('menuitem', { name: 'Settings' }))
    expect(onSettings).toHaveBeenCalledTimes(1)
  })
})

describe('AgentHistory reads a log ahead', () => {
  afterEach(() => {
    onAgent.mockClear()
    forgetRemembered()
  })

  test('the pointer reaching an ended agent\'s row reads its log before any click, once', () => {
    renderRail(<AgentHistory projectId="p1" scope="p1" agents={[agent({ status: 'done' })]} selectedAgentId={null} onSelect={() => {}} />)
    const row = screen.getByText("replace 'Hello, world!' with 'Welcome!'").closest('a')!
    expect(onAgent).not.toHaveBeenCalled()
    fireEvent.pointerEnter(row)
    fireEvent.pointerEnter(row)
    expect(onAgent.mock.calls).toEqual([['p1', 'run-1']])
  })

  test('the keyboard reaching the row reads it too', () => {
    renderRail(<AgentHistory projectId="p1" scope="p1" agents={[agent({ status: 'failed' })]} selectedAgentId={null} onSelect={() => {}} />)
    fireEvent.focus(screen.getByText("replace 'Hello, world!' with 'Welcome!'").closest('a')!)
    expect(onAgent.mock.calls).toEqual([['p1', 'run-1']])
  })

  test('a working agent\'s row reads nothing: its page shows the live feed, not a saved log', () => {
    renderRail(<AgentHistory projectId="p1" scope="p1" agents={[agent()]} selectedAgentId={null} onSelect={() => {}} />)
    fireEvent.pointerEnter(screen.getByText("replace 'Hello, world!' with 'Welcome!'").closest('a')!)
    expect(onAgent).not.toHaveBeenCalled()
  })

  test('with every project shown, a row reads the log in its own project', () => {
    const recent = { projectId: 'p2', projectName: 'other', agent: agent({ status: 'done' }) }
    renderRail(<AgentHistory projectId={null} scope={null} agents={[]} recentAgents={[recent]} selectedAgentId={null} onSelect={() => {}} />)
    fireEvent.pointerEnter(screen.getByText("replace 'Hello, world!' with 'Welcome!'").closest('a')!)
    expect(onAgent.mock.calls).toEqual([['p2', 'run-1']])
  })
})

// The accounts the agents work with: a page of the dashboard's own, under the modules' pages.
test('Permissions is a row of the rail, after the modules\u2019 pages, and opens its page; the one open is the active one', () => {
  const onPage = vi.fn()
  const { rerender } = render(
    <SidebarProvider>
      <AgentHistory projectId={null} agents={[]} selectedAgentId={null} onSelect={vi.fn()} pages={[{ segment: 'logs', label: 'Logs' }]} onPage={onPage} />
    </SidebarProvider>,
  )
  const labels = screen.getAllByRole('link').map(link => link.textContent)
  expect(labels.indexOf('Permissions')).toBe(labels.indexOf('Logs') + 1)
  fireEvent.click(screen.getByRole('link', { name: 'Permissions' }))
  expect(onPage).toHaveBeenCalledWith('permissions')
  rerender(
    <SidebarProvider>
      <AgentHistory projectId={null} agents={[]} selectedAgentId={null} onSelect={vi.fn()} pages={[{ segment: 'logs', label: 'Logs' }]} onPage={onPage} activePage="permissions" />
    </SidebarProvider>,
  )
  expect(screen.getByRole('link', { name: 'Permissions' }).getAttribute('aria-current')).toBe('page')
})

// A phone has no width for the rail beside the page (#1824): it is a sheet over the page.
describe('AgentHistory on a phone', () => {
  test('the rail is closed until the menu\'s button is pressed, and going somewhere from it closes it', async () => {
    const wide = phoneScreen()
    try {
      const onPage = vi.fn()
      const onSelect = vi.fn()
      const ui = (
        <SidebarProvider>
          <PagesBar pages={[]} activePage={null} overviewActive={false} overviewHref="/" onOverview={() => {}} pageHref={segment => `/${segment}`} onPage={() => {}} newHref="/new" newActive={false} onNew={() => {}} waiting={0} />
          <AgentHistory projectId={null} scope="p1" agents={[agent({ status: 'done' })]} selectedAgentId={null} onSelect={onSelect} pages={[{ segment: 'logs', label: 'Logs' }]} onPage={onPage} />
        </SidebarProvider>
      )
      render(ui)
      expect(screen.queryByRole('link', { name: 'Logs' })).toBeNull()

      fireEvent.click(screen.getByRole('button', { name: 'More' }))
      fireEvent.click(await screen.findByRole('link', { name: 'Logs' }))
      expect(onPage).toHaveBeenCalledWith('logs')
      await waitFor(() => expect(screen.queryByRole('link', { name: 'Logs' })).toBeNull())

      // An agent's row closes it too.
      fireEvent.click(screen.getByRole('button', { name: 'More' }))
      fireEvent.click(await screen.findByText("replace 'Hello, world!' with 'Welcome!'"))
      expect(onSelect).toHaveBeenCalledWith('run-1')
      await waitFor(() => expect(screen.queryByText("replace 'Hello, world!' with 'Welcome!'")).toBeNull())
    } finally {
      wide()
    }
  })

  test('on a wide screen the rail is a column, always there', () => {
    renderRail(<AgentHistory projectId={null} scope="p1" agents={[]} selectedAgentId={null} onSelect={() => {}} pages={[{ segment: 'logs', label: 'Logs' }]} />)
    expect(screen.getByRole('link', { name: 'Logs' })).toBeTruthy()
  })

  test('the list is in the order picked beside "Log": by creation unless picked otherwise, whatever order it was given in', async () => {
    const agents = [
      // The server lists a run that holds a checkout first: an old one just answered.
      agent({ id: 'old', status: 'waiting', startedAt: '2026-10-18T10:00:00Z', updatedAt: '2026-10-20T09:00:00Z', title: 'Old question' }),
      agent({ id: 'new', status: 'done', startedAt: '2026-10-20T08:00:00Z', updatedAt: '2026-10-20T08:01:00Z', title: 'New work' }),
    ]
    const names = () => screen.getAllByRole('link', { name: / · / }).map(row => row.getAttribute('aria-label')!.split(' · ')[0])
    renderRail(<AgentHistory projectId="p1" scope="p1" agents={agents} selectedAgentId={null} onSelect={() => {}} />)
    expect(names()).toEqual(['New work', 'Old question'])
    cleanup()
    preferences.current = { recentsSort: 'updated' }
    renderRail(<AgentHistory projectId="p1" scope="p1" agents={agents} selectedAgentId={null} onSelect={() => {}} />)
    expect(names()).toEqual(['Old question', 'New work'])
    await openMenu(screen.getByRole('button', { name: 'Sort and view' }))
    // The pick is said as a radio's, checked or not, not only drawn.
    expect((await screen.findAllByRole('menuitemradio')).map(item => [item.textContent, item.getAttribute('aria-checked')])).toEqual([
      ['Date created', 'false'],
      ['Last updated', 'true'],
      ['Name', 'false'],
      // One project's list has no projects to cut it by.
      ['Nothing', 'true'],
      ['Day', 'false'],
    ])
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Name' }))
    expect(updatePreferences).toHaveBeenCalledWith({ recentsSort: 'name' })
  })

  test('the menu beside "Log" also picks what a row shows and what the list is cut by, each kept as the person\'s', async () => {
    const recentAgents = [{ projectId: 'p1', projectName: 'shop', agent: agent({ status: 'done' }) }]
    preferences.current = { recentsPerson: true, recentsGroup: 'project' }
    renderRail(<AgentHistory projectId={null} agents={[]} recentAgents={recentAgents} selectedAgentId={null} onSelect={() => {}} />)
    await openMenu(screen.getByRole('button', { name: 'Sort and view' }))
    expect((await screen.findAllByRole('menuitemcheckbox')).map(item => [item.textContent, item.getAttribute('aria-checked')])).toEqual([['Who started it', 'true'], ['Coding agent', 'false']])
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Coding agent' }))
    expect(updatePreferences).toHaveBeenCalledWith({ recentsAgent: true })
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Who started it' }))
    expect(updatePreferences).toHaveBeenCalledWith({ recentsPerson: false })
    // Every project's list can be cut by project.
    expect(screen.getByRole('menuitemradio', { name: 'Project' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Day' }))
    expect(updatePreferences).toHaveBeenCalledWith({ recentsGroup: 'day' })
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Nothing' }))
    expect(updatePreferences).toHaveBeenCalledWith({ recentsGroup: 'none' })
  })

  test('cut by project, each project\'s runs stand under its line, those with no project under "No project"; cut by day, under the day they started', () => {
    // A second apart, so the two of today are in a known order whatever the hour.
    const at = (daysAgo: number, secondsAgo = 0) => new Date(Date.now() - daysAgo * 86_400_000 - secondsAgo * 1000).toISOString()
    const recentAgents = [
      { projectId: 'p1', projectName: 'shop', agent: agent({ id: 'a', status: 'done', title: 'Cart', startedAt: at(0) }) },
      { projectId: 'session', projectName: 'session', agent: agent({ id: 'b', status: 'done', title: 'Chat', startedAt: at(0, 1) }) },
      { projectId: 'p1', projectName: 'shop', agent: agent({ id: 'c', status: 'done', title: 'Login', startedAt: at(1) }) },
    ]
    const lines = () => [...document.querySelector('[data-rail-part="log"] ul')!.children].map(item => (item.getAttribute('role') === 'presentation' ? `— ${item.textContent}` : item.firstElementChild!.getAttribute('aria-label')!.split(' · ')[0]))
    preferences.current = { recentsGroup: 'project' }
    renderRail(<AgentHistory projectId={null} agents={[]} recentAgents={recentAgents} selectedAgentId={null} onSelect={() => {}} />)
    expect(lines()).toEqual(['— shop', 'Cart', 'Login', '— No project', 'Chat'])
    cleanup()
    preferences.current = { recentsGroup: 'day' }
    renderRail(<AgentHistory projectId={null} agents={[]} recentAgents={recentAgents} selectedAgentId={null} onSelect={() => {}} />)
    expect(lines()).toEqual(['— Today', 'Cart', 'Chat', '— Yesterday', 'Login'])
    cleanup()
    // By name there are no days to cut by, and one project's list has no projects: one list, no line.
    preferences.current = { recentsGroup: 'day', recentsSort: 'name' }
    renderRail(<AgentHistory projectId={null} agents={[]} recentAgents={recentAgents} selectedAgentId={null} onSelect={() => {}} />)
    expect(lines()).toEqual(['Cart', 'Chat', 'Login'])
  })

  test('a session with no project that has a copy of a project stands under that project, in each one\'s group, and opens on its own page', () => {
    const at = (secondsAgo: number) => new Date(Date.now() - secondsAgo * 1000).toISOString()
    const under = [{ id: 'p1', name: 'shop' }, { id: 'p2', name: 'blog' }]
    const recentAgents = [
      { projectId: 'p1', projectName: 'shop', agent: agent({ id: 'a', status: 'done', title: 'Cart', startedAt: at(0) }) },
      { projectId: 'session', projectName: 'session', agent: agent({ id: 'b', status: 'done', title: 'Both apps', startedAt: at(1), under }) },
      { projectId: 'p2', projectName: 'blog', agent: agent({ id: 'c', status: 'done', title: 'Post', startedAt: at(2) }) },
    ]
    const lines = () => [...document.querySelector('[data-rail-part="log"] ul')!.children].map(item => (item.getAttribute('role') === 'presentation' ? `— ${item.textContent}` : item.firstElementChild!.getAttribute('aria-label')!.split(' · ')[0]))
    preferences.current = { recentsGroup: 'project' }
    renderRail(<AgentHistory projectId={null} agents={[]} recentAgents={recentAgents} selectedAgentId={null} onSelect={() => {}} />)
    expect(lines()).toEqual(['— shop', 'Cart', 'Both apps', '— blog', 'Both apps', 'Post'])
    expect(screen.getAllByRole('link', { name: /^Both apps/ }).map(link => link.getAttribute('href'))).toEqual(['/session/b', '/session/b'])
    cleanup()
    // One project's list: the session is listed there, and opens as the sessions' own.
    const onSelectRecent = vi.fn()
    preferences.current = {}
    renderRail(<AgentHistory projectId="p1" scope="p1" agents={[agent({ id: 'b', status: 'done', title: 'Both apps', startedAt: at(1), under })]} selectedAgentId={null} onSelect={() => {}} onSelectRecent={onSelectRecent} />)
    const link = screen.getByRole('link', { name: /^Both apps/ })
    expect(link.getAttribute('href')).toBe('/session/b')
    fireEvent.click(link)
    expect(onSelectRecent).toHaveBeenCalledWith('session', 'b')
  })
})
