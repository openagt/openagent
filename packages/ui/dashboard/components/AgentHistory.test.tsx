import type { ReactElement } from 'react'
import type { AgentMeta, ProjectSummary } from '../../src/index.js'
import { afterEach, describe, expect, test, vi } from 'vitest'
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
const onGitHostPeople = vi.hoisted(() => vi.fn(async (_projectId: string, _emails: string[]) => [] as { email: string; login: string; avatar?: string }[]))
vi.mock('../rpc/people.js', () => ({ onGitHostPeople }))

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

const { AgentHistory } = await import('./AgentHistory.js')
const { forgetRemembered } = await import('../lib/use-async.js')

afterEach(() => {
  cleanup()
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

// AgentHistory renders the shadcn <Sidebar>, which reads SidebarProvider context; wrap every render.
const renderRail = (ui: ReactElement) => render(<SidebarProvider>{ui}</SidebarProvider>)

describe('AgentHistory (#785)', () => {
  test('what waits on the person is its own part over the Log: a run\'s name and how long it has waited, what it needs under them, five, then a row that opens the Overview; the Overview row has no count', () => {
    const asks = (n: number) => ({ projectId: 'p1', projectName: 'p1', kind: 'waiting' as const, module: 'ask', scope: 'run' as const, run: `r${n}`, id: `r${n}:q${n}`, words: 'Needs answer', title: `Run ${n}`, mark: 'question' as const, since: new Date(Date.now() - 3 * 60_000).toISOString() })
    const onSelectRecent = vi.fn()
    const onDashboard = vi.fn()
    renderRail(
      <AgentHistory projectId="p1" scope="p1" agents={[]} selectedAgentId={null} onSelect={() => {}} onSelectRecent={onSelectRecent} onDashboard={onDashboard} homeHref="/p1" waiting={[1, 2, 3, 4, 5, 6].map(asks)} hrefOf={route => `/${route.projectId}/${route.agentId}`} />,
    )
    expect(screen.getByText('Waiting on you')).toBeTruthy()
    const row = screen.getByRole('link', { name: 'Run 1 · Needs answer' })
    expect(row.getAttribute('href')).toBe('/p1/r1')
    // Two lines: the name and its age, then what it needs.
    expect([...row.firstElementChild!.children].map(line => line.textContent)).toEqual(['Run 13m', 'Needs answer'])
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
    expect([screen.queryByRole('link', { name: 'Agent profiles' }), screen.queryByText('Log'), screen.queryByRole('link', { name: /Welcome/ })]).toEqual([null, null, null])
    rerender(<SidebarProvider>{rail([{ segment: 'logs', label: 'Logs' }])}</SidebarProvider>)
    expect(screen.getByRole('link', { name: 'Logs' }).parentElement?.className).toContain('starting:opacity-0')
    expect(screen.getByRole('link', { name: /Welcome/ })).toBeTruthy()
    unmount()
    renderRail(rail([]))
    expect(screen.getByRole('link', { name: 'Agent profiles' }).parentElement?.className).not.toContain('starting:opacity-0')
  })

  test('a failed run\'s mark is the failed hexagon, still', () => {
    const { container } = renderRail(<AgentHistory projectId="p1" scope="p1" agents={[agent({ status: 'failed' })]} selectedAgentId={null} onSelect={() => {}} />)
    expect(screen.getByLabelText('failed').getAttribute('data-state')).toBe('failed')
    expect(container.querySelector('.motion-safe\\:animate-spin')).toBeNull()
  })

  test('a working run reads as working and animates', () => {
    // One line: the circle says what the row used to print as a word, and the row's name says it too.
    const { container } = renderRail(<AgentHistory projectId="p1" scope="p1" agents={[agent()]} selectedAgentId={null} onSelect={() => {}} />)
    expect(screen.getByLabelText('working')).toBeTruthy()
    expect(screen.getByRole('link', { name: /· working ·/ })).toBeTruthy()
    expect(screen.getByLabelText('working').getAttribute('data-state')).toBe('working')
    expect(container.querySelector('.motion-safe\\:animate-spin')).toBeTruthy()
  })

  test("where the listed runs were run by different coding agents, each row's agent is a logo at its end", () => {
    renderRail(<AgentHistory projectId="p1" scope="p1" agents={[agent({ driver: 'codex' }), agent({ id: 'r2', driver: 'claude-code' })]} selectedAgentId={null} onSelect={() => {}} />)
    expect(screen.getByLabelText('Codex')).toBeTruthy()
    expect(screen.getByLabelText('Claude Code')).toBeTruthy()
  })

  test('where every listed run shares its person and its coding agent, no row marks them, and each row still says them', () => {
    renderRail(<AgentHistory projectId="p1" scope="p1" agents={[agent({ status: 'done', driver: 'codex', person: 'ada@x.dev' }), agent({ id: 'r2', status: 'done', driver: 'codex', person: 'ada@x.dev' })]} selectedAgentId={null} onSelect={() => {}} />)
    expect(screen.queryByLabelText('Codex')).toBeNull()
    expect(screen.queryByRole('img', { name: 'ada@x.dev' })).toBeNull()
    for (const row of screen.getAllByRole('link', { name: /· done ·/ })) expect(row.getAttribute('aria-label')).toMatch(/ada@x\.dev · Codex/)
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

  test('a run that ended on its question reads as needing an answer, with the still mark', () => {
    // It asked and waits for the answer: its mark stays still, where a working run's turns.
    const { container } = renderRail(
      <AgentHistory projectId="p1" scope="p1" agents={[agent({ status: 'waiting' })]} selectedAgentId={null} onSelect={() => {}} />,
    )
    expect(screen.getByLabelText('needs answer')).toBeTruthy()
    expect(screen.queryByLabelText('working')).toBeNull()
    expect(container.querySelector('.motion-safe\\:animate-spin')).toBeNull()
    expect(screen.getByLabelText('needs answer').getAttribute('data-state')).toBe('waiting')
  })

  test('an ended run the daemon marks saving reads as saving… (#1455)', () => {
    const { container } = renderRail(
      <AgentHistory projectId="p1" scope="p1" agents={[agent({ status: 'done', saving: true })]} selectedAgentId={null} onSelect={() => {}} />,
    )
    expect(screen.getByLabelText('saving…')).toBeTruthy()
    expect(screen.queryByLabelText('done')).toBeNull()
    expect(container.querySelector('.motion-safe\\:animate-spin')).toBeTruthy()
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

  test('the name, once the daemon has it, comes into the stand-in row letter by letter, before the run\u2019s own row is in', () => {
    const { container, rerender } = renderRail(
      <AgentHistory projectId="p1" scope="p1" agents={[]} selectedAgentId={null} onSelect={() => {}} startTick={0} startIntent="" />,
    )
    const started = (startTitle?: string) => (
      <SidebarProvider>
        <AgentHistory projectId="p1" scope="p1" agents={[]} selectedAgentId="run-5" onSelect={() => {}} startTick={1} startIntent="fix the flaky login test" startId="run-5" {...(startTitle !== undefined ? { startTitle } : {})} />
      </SidebarProvider>
    )
    rerender(started())
    const standIn = () => [...container.querySelectorAll('a, button')].find(row => row.hasAttribute('data-stand-in'))!
    expect(standIn().querySelector('.rail-title .animate-pulse')).toBeTruthy()
    rerender(started('Fix flaky login test'))
    expect(standIn().querySelector('.rail-title .animate-pulse')).toBeNull()
    expect(standIn().getAttribute('aria-label')).toBe('Fix flaky login test · working · just now')
    expect(standIn().querySelectorAll('.letter-in').length).toBeGreaterThan(0)
  })

  test('with naming turned off the stand-in row prints the prompt: no name is coming to replace it', () => {
    preferences.current = { nameRuns: false }
    const { container, rerender } = renderRail(
      <AgentHistory projectId="p1" scope="p1" agents={[]} selectedAgentId={null} onSelect={() => {}} startTick={0} startIntent="" />,
    )
    rerender(
      <SidebarProvider>
        <AgentHistory projectId="p1" scope="p1" agents={[]} selectedAgentId="run-4" onSelect={() => {}} startTick={1} startIntent="add a footer" startId="run-4" />
      </SidebarProvider>,
    )
    const row = [...container.querySelectorAll('a, button')].find(row => row.hasAttribute('data-stand-in'))!
    expect(row.querySelector('.rail-title')!.textContent).toBe('add a footer')
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
  test('the coding agent\'s logo is the last mark of every row, after the host\'s glyph, so the logos stand in one column', async () => {
    const main = agent({ id: 'main', target: 'web', driver: 'codex' })
    renderRail(<AgentHistory projectId="p1" scope="p1" agents={[main, agent({ id: 'other', driver: 'claude-code' })]} selectedAgentId={null} onSelect={() => {}} />)
    const row = (await screen.findByLabelText('Runs on Claude Code on the web')).closest('a')!
    const marks = [...row.querySelectorAll('[aria-label]')].map(mark => mark.getAttribute('aria-label'))
    expect(marks.at(-1)).toBe('Codex')
    expect(marks.indexOf('Runs on Claude Code on the web')).toBeLessThan(marks.indexOf('Codex'))
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

  test('work that never left the machine is the Human Queue\'s mark in gray, where a pull request would be: a branch for commits, a file for files left uncommitted', async () => {
    const agents = [
      agent({ id: 'waits', status: 'done', driver: 'claude-code', unpublished: 2 }),
      agent({ id: 'one', status: 'done', unpublished: 1 }),
      agent({ id: 'left', status: 'done', uncommitted: 1, unpublished: 3 }),
      agent({ id: 'none', status: 'done' }),
    ]
    renderRail(<AgentHistory projectId="p1" scope="p1" agents={agents} selectedAgentId={null} onSelect={() => {}} />)
    const glyph = screen.getByLabelText('Needs PR · 2 commits').querySelector('svg')!.getAttribute('class')
    expect(glyph).toContain('lucide-git-branch')
    expect(glyph).toContain('text-muted-foreground')
    expect(screen.getByLabelText('Needs PR · 1 commit')).toBeTruthy()
    expect(screen.getAllByLabelText(/^Needs PR/)).toHaveLength(2)
    // Files left uncommitted come first: committing them is the run's next step.
    expect(screen.getByLabelText('Needs commit · 1 file').querySelector('svg')!.getAttribute('class')).toContain('lucide-file-pen')
    // Just before the logo, where a pull request's mark stands.
    const row = screen.getByLabelText('Needs PR · 2 commits').closest('a')!
    const marks = [...row.querySelectorAll('[aria-label]')].map(mark => mark.getAttribute('aria-label'))
    expect(marks.slice(-2)).toEqual(['Needs PR · 2 commits', 'Claude Code'])
    expect(row.getAttribute('aria-label')).toContain('Needs PR · 2 commits')
  })

  test('on a page of no project, the picked project\'s rows say what its git host allows, as on its own pages', () => {
    const shop: ProjectSummary = { id: 'p1', path: '/p1', name: 'shop', activated: true, gitHost: false }
    renderRail(<AgentHistory projectId={null} scope="p1" projects={[shop]} agents={[agent({ id: 'one', status: 'done', unpublished: 1 })]} selectedAgentId={null} onSelect={() => {}} />)
    expect(screen.getByLabelText('Needs push · 1 commit')).toBeTruthy()
  })

  test('a run\'s pull request is a glyph before the logo, its shape and colour by how it stands, and the hover says which', async () => {
    const agents = [
      agent({ id: 'open', status: 'done', driver: 'claude-code', pr: { number: 12, url: 'u' }, prState: 'open' }),
      agent({ id: 'draft', status: 'done', pr: { number: 13, url: 'u' }, prState: 'draft' }),
      agent({ id: 'merged', status: 'done', pr: { number: 14, url: 'u' }, prState: 'merged' }),
      agent({ id: 'closed', status: 'done', pr: { number: 15, url: 'u' }, prState: 'closed' }),
      agent({ id: 'unread', status: 'done', pr: { number: 16, url: 'u' } }),
      agent({ id: 'none', status: 'done' }),
    ]
    renderRail(<AgentHistory projectId="p1" scope="p1" agents={agents} selectedAgentId={null} onSelect={() => {}} />)
    const glyph = (label: string) => screen.getByLabelText(label).querySelector('svg')!.getAttribute('class')
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
    // Just before the logo, so the PR marks stand in one column.
    const row = screen.getByLabelText('PR #12 open').closest('a')!
    const marks = [...row.querySelectorAll('[aria-label]')].map(mark => mark.getAttribute('aria-label'))
    expect(marks.slice(-2)).toEqual(['PR #12 open', 'Claude Code'])
    expect(row.getAttribute('aria-label')).toContain('PR #12 open')
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
    onGitHostPeople.mockReset()
    onGitHostPeople.mockResolvedValue([])
  })

  const ada = { email: 'ada@x.dev', login: 'ada', avatar: 'https://avatars.githubusercontent.com/u/1' }
  const row = (name: RegExp) => screen.getByRole('link', { name })

  test("two letters at first, the person's picture once the git host said, before the agent's logo; pointed at, it says who", async () => {
    onGitHostPeople.mockResolvedValue([ada])
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

  test('a run that names nobody has no mark', () => {
    renderRail(<AgentHistory projectId="p1" scope="p1" agents={[agent({ title: 'Very old' })]} selectedAgentId={null} onSelect={() => {}} />)
    expect(row(/^Very old/).querySelector('[class*="rounded-full"][class*="size-3.5"]')).toBeNull()
    expect(onGitHostPeople).not.toHaveBeenCalled()
  })

  test("the rail of every project asks each project of its own people, once, whatever is polled; a project's picture is not another's", async () => {
    onGitHostPeople.mockImplementation(async projectId => (projectId === 'p1' ? [ada] : []))
    const recent = (projectId: string, id: string, person: string) => ({ projectId, projectName: projectId, agent: agent({ id, title: `${projectId} ${id}`, person }) })
    const rail = (recentAgents: ReturnType<typeof recent>[]) => <SidebarProvider><AgentHistory projectId={null} scope={null} agents={[]} recentAgents={recentAgents} selectedAgentId={null} onSelect={() => {}} /></SidebarProvider>
    const { rerender } = render(rail([recent('p1', 'r1', 'ada@x.dev'), recent('p1', 'r2', 'ada@x.dev'), recent('p2', 'r3', 'ada@x.dev'), recent('p2', 'r4', 'rom@y.dev')]))
    await waitFor(() => expect(row(/^p1 r1/).querySelector('img')).toBeTruthy())
    expect(row(/^p1 r2/).querySelector('img')).toBeTruthy()
    expect(row(/^p2 r3/).querySelector('img')).toBeNull()
    expect(onGitHostPeople.mock.calls.map(([projectId, emails]) => [projectId, emails])).toEqual([
      ['p1', ['ada@x.dev']],
      ['p2', ['ada@x.dev', 'rom@y.dev']],
    ])
    // The list read again, with the same people, in a new order.
    rerender(rail([recent('p2', 'r4', 'rom@y.dev'), recent('p2', 'r3', 'ada@x.dev'), recent('p1', 'r2', 'ada@x.dev'), recent('p1', 'r1', 'ada@x.dev')]))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(onGitHostPeople).toHaveBeenCalledTimes(2)
  })

  test("a row of the picked project's list on a page of no project still asks that project", async () => {
    onGitHostPeople.mockResolvedValue([ada])
    renderRail(<AgentHistory projectId={null} scope="p1" agents={[agent({ title: 'Hers', person: 'ada@x.dev' }), agent({ id: 'r2', title: 'His', person: 'rom@y.dev' })]} selectedAgentId={null} onSelect={() => {}} />)
    await waitFor(() => expect(row(/^Hers/).querySelector('img')).toBeTruthy())
    expect(onGitHostPeople).toHaveBeenCalledWith('p1', ['ada@x.dev', 'rom@y.dev'])
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

const proj = (id: string, name: string): ProjectSummary => ({ id, path: `/${id}`, name, activated: true, gitHost: false })

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
    expect(screen.getByLabelText('Claude Code')).toBeTruthy()
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
  test('pointed at, a row shows its whole title beside it, and under it what its marks would say', async () => {
    const long = 'refactor the queue promotion sweep so drains claim tickets through lock files'
    renderRail(<AgentHistory projectId="p1" scope="p1" agents={[agent({ intent: long, driver: 'codex' })]} selectedAgentId={null} onSelect={() => {}} />)
    const tip = await hoverTooltip((await screen.findByText(long)).closest('.rail-title') as HTMLElement)
    expect(tip.textContent).toContain(long)
    expect(tip.textContent).toContain('Codex')
  })

  test('each mark at the row\'s end says what it is', async () => {
    renderRail(<AgentHistory projectId="p1" scope="p1" agents={[agent({ status: 'done', driver: 'claude-code', pr: { number: 5, url: 'https://x/pull/5' }, prState: 'open' })]} selectedAgentId={null} onSelect={() => {}} />)
    expect((await hoverTooltip(screen.getByLabelText('PR #5 open'))).textContent).toBe('PR #5 open')
  })

  test('the coding agent\'s logo says the agent and the model it ran on', async () => {
    renderRail(<AgentHistory projectId="p1" scope="p1" agents={[agent({ status: 'done', driver: 'claude-code', model: 'claude-opus-5-5' }), agent({ id: 'r2', driver: 'codex' })]} selectedAgentId={null} onSelect={() => {}} />)
    // No list of models read here: the model is said by its id.
    expect((await hoverTooltip(screen.getByLabelText('Claude Code · claude-opus-5-5'))).textContent).toBe('Claude Code · claude-opus-5-5')
  })
})

describe('the project select (#1513)', () => {
  const stranded: ProjectSummary = {
    id: 'p1',
    path: '/repos/p1',
    name: 'alpha',
    activated: true,
    gitHost: false,
    errors: [{ id: 'store-git-branch:data-sync', title: 'Not syncing with the remote', message: 'the data branch could not be pushed: Permission denied (publickey)', since: '2026-08-20T10:00:00.000Z' }],
  }
  const idle: ProjectSummary = { id: 'p2', path: '/repos/p2', name: 'beta', activated: false, gitHost: false }

  test('it names the picked project, or "All projects" when none is picked', () => {
    const { unmount } = renderRail(<AgentHistory projectId={null} scope="p2" agents={[]} selectedAgentId={null} onSelect={() => {}} projects={[stranded, idle]} />)
    expect(screen.getByRole('combobox', { name: 'Project: beta' })).toBeTruthy()
    unmount()
    renderRail(<AgentHistory projectId={null} agents={[]} recentAgents={[]} selectedAgentId={null} onSelect={() => {}} projects={[stranded, idle]} />)
    expect(screen.getByRole('combobox', { name: 'Project: All projects' })).toBeTruthy()
  })

  test('two projects with the same name say which folder each is in, on the button, in the menu and on the rows', async () => {
    const work: ProjectSummary = { id: 'shop-1', path: '/home/me/work/shop', name: 'shop', activated: true, gitHost: false }
    const clients: ProjectSummary = { id: 'shop-2', path: '/home/me/clients/shop', name: 'shop', activated: true, gitHost: false }
    const projects = [work, clients, idle]
    const recentAgents = [
      { projectId: 'shop-2', projectName: 'shop', agent: agent({ id: 'b1', status: 'done', intent: 'second' }) },
      { projectId: 'shop-1', projectName: 'shop', agent: agent({ id: 'a1', status: 'done', intent: 'first' }) },
    ]
    const rail = (scope: string | null) => (
      <ProjectLabelsContext.Provider value={projectLabels(projects)}>
        <AgentHistory projectId={null} scope={scope} agents={[]} recentAgents={recentAgents} selectedAgentId={null} onSelect={() => {}} projects={projects} />
      </ProjectLabelsContext.Provider>
    )
    const { unmount } = renderRail(rail('shop-1'))
    await openMenu(screen.getByRole('combobox', { name: 'Project: work/shop' }))
    // The folder is muted, the name as any other's.
    expect(within(screen.getByRole('option', { name: /clients\/shop/ })).getByText('clients/').className).toContain('text-muted-foreground')
    expect(screen.getByRole('option', { name: /beta/ })).toBeTruthy()
    unmount()
    renderRail(rail(null))
    // The Overview's rows name their project the same way.
    expect(screen.getByText('clients/shop')).toBeTruthy()
  })

  test('while the project the address names is not read, neither "All projects" nor "No sessions yet." shows', () => {
    renderRail(<AgentHistory projectId={null} scopePending listLoaded={false} agents={[]} recentAgents={[]} selectedAgentId={null} onSelect={() => {}} />)
    expect(screen.getByRole('combobox', { name: 'Project: loading' })).toBeTruthy()
    expect(screen.queryByText('All projects')).toBeNull()
    expect(screen.queryByText('No sessions yet.')).toBeNull()
    // The heading stays, so the column does not jump once the list lands.
    expect(screen.getByText('Log')).toBeTruthy()
  })

  test('picking a project, or all of them, reports the pick and marks the current one', async () => {
    const picks: (string | null)[] = []
    renderRail(
      <AgentHistory projectId={null} scope="p1" onScope={id => picks.push(id)} agents={[]} selectedAgentId={null} onSelect={() => {}} projects={[stranded, idle]} />,
    )
    await openMenu(screen.getByRole('combobox', { name: 'Project: alpha' }))
    expect(screen.getByRole('option', { name: /alpha/ }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('option', { name: /beta/ }).getAttribute('aria-selected')).toBe('false')
    fireEvent.click(screen.getByRole('option', { name: /beta/ }))
    await openMenu(screen.getByRole('combobox', { name: 'Project: alpha' }))
    fireEvent.click(screen.getByRole('option', { name: /All projects/ }))
    expect(picks).toEqual(['p2', null])
  })

  test('pinned to the window beside a page that scrolls, its project menu is placed against the window too, and does not jump as the page scrolls', async () => {
    // The menu's positioner: the nearest element above the list placed by Base UI.
    const positionOf = () => {
      let at: HTMLElement | null = screen.getByRole('listbox')
      while (at && at.style.position !== 'fixed' && at.style.position !== 'absolute') at = at.parentElement
      return at?.style.position
    }
    renderRail(<AgentHistory projectId={null} pageScrolls agents={[]} selectedAgentId={null} onSelect={() => {}} projects={[stranded, idle]} />)
    await openMenu(screen.getByRole('combobox', { name: 'Project: All projects' }))
    expect(positionOf()).toBe('fixed')
    cleanup()
    // In the page's flow, it scrolls with the page: so does its menu.
    renderRail(<AgentHistory projectId={null} agents={[]} selectedAgentId={null} onSelect={() => {}} projects={[stranded, idle]} />)
    await openMenu(screen.getByRole('combobox', { name: 'Project: All projects' }))
    expect(positionOf()).toBe('absolute')
  })

  test('a project the daemon recorded an error for gets a red dot and the error in words; one not activated says so', async () => {
    renderRail(<AgentHistory projectId={null} agents={[]} recentAgents={[]} selectedAgentId={null} onSelect={() => {}} projects={[stranded, idle]} />)
    await openMenu(screen.getByRole('combobox', { name: 'Project: All projects' }))
    const broken = screen.getByRole('option', { name: /alpha/ })
    expect(broken.querySelector('.bg-danger')).toBeTruthy()
    expect(within(broken).getByText('Not syncing with the remote').getAttribute('title')).toContain('Permission denied (publickey)')
    const quiet = screen.getByRole('option', { name: /beta/ })
    expect(quiet.querySelector('.bg-danger')).toBeNull()
    expect(within(quiet).getByText('Not activated')).toBeTruthy()
  })

  test('an activated project whose repository has no remote says so in grey, with no red dot', async () => {
    const local = { ...idle, id: 'p3', name: 'gamma', activated: true, local: 'no-remote' as const }
    const kept = { ...idle, id: 'p4', name: 'delta', activated: true, local: 'kept' as const }
    renderRail(<AgentHistory projectId={null} agents={[]} recentAgents={[]} selectedAgentId={null} onSelect={() => {}} projects={[stranded, local, kept]} />)
    await openMenu(screen.getByRole('combobox', { name: 'Project: All projects' }))
    // A project with a remote whose records the person keeps says that instead, as quietly.
    expect(within(screen.getByRole('option', { name: /delta/ })).getByText('Records kept on this machine').className).toContain('text-muted-foreground')
    const item = screen.getByRole('option', { name: /gamma/ })
    expect(item.querySelector('.bg-danger')).toBeNull()
    expect(within(item).getByText('Local only, no remote').className).toContain('text-muted-foreground')
    expect(within(screen.getByRole('option', { name: /alpha/ })).queryByText('Local only, no remote')).toBeNull()
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
test('Agent profiles and Permissions are rows of the rail, after the modules\u2019 pages, and open their pages; the one open is the active one', () => {
  const onPage = vi.fn()
  const { rerender } = render(
    <SidebarProvider>
      <AgentHistory projectId={null} agents={[]} selectedAgentId={null} onSelect={vi.fn()} pages={[{ segment: 'logs', label: 'Logs' }]} onPage={onPage} />
    </SidebarProvider>,
  )
  const labels = screen.getAllByRole('link').map(link => link.textContent)
  expect(labels.indexOf('Agent profiles')).toBe(labels.indexOf('Logs') + 1)
  expect(labels.indexOf('Permissions')).toBe(labels.indexOf('Agent profiles') + 1)
  fireEvent.click(screen.getByRole('link', { name: 'Agent profiles' }))
  expect(onPage).toHaveBeenCalledWith('profiles')
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
    await openMenu(screen.getByRole('button', { name: 'Sort agents' }))
    // The pick is said as a radio's, checked or not, not only drawn.
    expect((await screen.findAllByRole('menuitemradio')).map(item => [item.textContent, item.getAttribute('aria-checked')])).toEqual([
      ['Date created', 'false'],
      ['Last updated', 'true'],
      ['Name', 'false'],
    ])
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Name' }))
    expect(updatePreferences).toHaveBeenCalledWith({ recentsSort: 'name' })
  })
})
