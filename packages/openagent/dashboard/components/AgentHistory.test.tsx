import type { ReactElement } from 'react'
import type { AgentMeta, ProjectSummary } from '../../src/index.js'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { SidebarProvider } from './ui/sidebar.js'
import { hoverTooltip, openMenu, phoneScreen } from '../test-utils.js'
import { MenuButton } from './PhoneBar.js'

// AgentHistory pulls in AddProjectPanel, which imports the projects RPC stubs; stub them so
// nothing fetches a daemon that is not there. Import AgentHistory after the mock is in place.
// Resolves to an empty list: AddProjectPanel (reachable from the rail) reads projects on demand.
const onProjects = vi.hoisted(() => vi.fn(() => Promise.resolve([])))
const sendAddProject = vi.hoisted(() => vi.fn())
const sendPickProjectDirectory = vi.hoisted(() => vi.fn())
vi.mock('../rpc/projects.js', () => ({ onProjects, sendAddProject, sendPickProjectDirectory, onCloneTarget: vi.fn(), sendAddProjectFromAddress: vi.fn() }))
// An ended agent's log, read as the pointer reaches its row.
const onAgent = vi.hoisted(() => vi.fn((_projectId: string, _agentId: string) => Promise.resolve([])))
vi.mock('../rpc/reads.js', () => ({ onAgent }))

// The rail also carries the person's menu at its foot (#772 follow-up). Its theme and notifications
// rows pull the preferences into jsdom, which this suite deliberately avoids. It is about the agents
// list, not the menu (each has its own suite), so stub them out, and the person is a name.
vi.mock('./ThemeSubmenu.js', () => ({ ThemeSubmenu: () => null }))
vi.mock('./NotificationsSubmenu.js', () => ({ NotificationsSubmenu: () => null }))
vi.mock('../rpc/person.js', () => ({ onPerson: () => Promise.resolve({ name: 'Ada Lovelace' }) }))

// The rail asks the person's preferences one thing: whether a run is named, which decides whether a
// row waits for that name or prints the prompt.
const preferences = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))
vi.mock('../lib/preferences.js', async importOriginal => ({ ...(await importOriginal<object>()), usePreferences: () => preferences.current }))

const { AgentHistory } = await import('./AgentHistory.js')
const { forgetRemembered } = await import('../lib/use-async.js')

afterEach(() => {
  cleanup()
  preferences.current = {}
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
  test('a working run reads as running and animates', () => {
    // One line: the circle says what the row used to print as a word, and the row's name says it too.
    const { container } = renderRail(<AgentHistory projectId="p1" scope="p1" agents={[agent()]} selectedAgentId={null} onSelect={() => {}} />)
    expect(screen.getByLabelText('running')).toBeTruthy()
    expect(screen.getByRole('button', { name: /· running ·/ })).toBeTruthy()
    expect(container.querySelector('.animate-pulse')).toBeTruthy()
  })

  test("the agent that ran it is a logo at the row's end", () => {
    renderRail(<AgentHistory projectId="p1" scope="p1" agents={[agent({ driver: 'codex' })]} selectedAgentId={null} onSelect={() => {}} />)
    expect(screen.getByLabelText('Codex')).toBeTruthy()
  })

  test('a named run reads by its name, not by the words the person typed', () => {
    renderRail(<AgentHistory projectId="p1" scope="p1" agents={[agent({ title: 'Welcome message' })]} selectedAgentId={null} onSelect={() => {}} />)
    expect(screen.getByText('Welcome message')).toBeTruthy()
    expect(screen.queryByText("replace 'Hello, world!' with 'Welcome!'")).toBeNull()
  })

  test('a run that ended on its question reads as waiting, with the still dot', () => {
    // It asked and waits for the answer: its dot stays, still, where a working run's pulses.
    const { container } = renderRail(
      <AgentHistory projectId="p1" scope="p1" agents={[agent({ status: 'waiting' })]} selectedAgentId={null} onSelect={() => {}} />,
    )
    expect(screen.getByLabelText('waiting')).toBeTruthy()
    expect(screen.queryByLabelText('running')).toBeNull()
    expect(container.querySelector('.animate-pulse')).toBeNull()
    expect(container.querySelector('.rounded-full.bg-warning')).toBeTruthy()
  })

  test('an ended run the daemon marks saving reads as saving… (#1455)', () => {
    const { container } = renderRail(
      <AgentHistory projectId="p1" scope="p1" agents={[agent({ status: 'done', saving: true })]} selectedAgentId={null} onSelect={() => {}} />,
    )
    expect(screen.getByLabelText('saving…')).toBeTruthy()
    expect(screen.queryByLabelText('done')).toBeNull()
    expect(container.querySelector('.animate-pulse')).toBeTruthy()
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
    const rows = [...container.querySelectorAll('button')]
    const home = rows.find(row => row.textContent?.trim() === 'New agent')
    const starting = rows.find(row => row.hasAttribute('data-stand-in'))
    expect(starting?.className).toContain('bg-accent')
    expect(home?.className).not.toContain('bg-accent')
  })

  test('the stand-in row reads as the run’s own row will: running, the project and "just now" where every project shows, the name on its way, not dimmed', () => {
    const { container, rerender } = renderRail(
      <AgentHistory projectId="p1" scope={null} agents={[]} recentAgents={[]} selectedAgentId={null} onSelect={() => {}} startTick={0} startIntent="" />,
    )
    rerender(
      <SidebarProvider>
        <AgentHistory projectId="p1" scope={null} agents={[]} recentAgents={[]} selectedAgentId="run-2" onSelect={() => {}} startTick={1} startIntent="add dark mode" startId="run-2" startProjectName="alpha" />
      </SidebarProvider>,
    )
    const row = [...container.querySelectorAll('button')].find(row => row.hasAttribute('data-stand-in'))!
    // The run's own row will carry a name seconds from now, so this one holds the place: printing
    // the prompt here is what made the rail flicker, the prompt swapped for the name a beat later.
    expect(row.textContent).toBe('alpha')
    expect(row.querySelector('.rail-title .animate-pulse')).toBeTruthy()
    expect(row.getAttribute('aria-label')).toBe('Naming this session · running · alpha · just now')
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
    const standInRow = [...container.querySelectorAll('button')].find(row => row.hasAttribute('data-stand-in'))!
    expect(standInRow.textContent).toBe('')
    expect(standInRow.getAttribute('aria-label')).toBe('Naming this session · running · just now')
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
    const row = [...container.querySelectorAll('button')].find(row => row.hasAttribute('data-stand-in'))!
    expect(row.textContent).toBe('add a footer')
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
    expect([...container.querySelectorAll('button')].some(row => row.hasAttribute('data-stand-in'))).toBe(true)

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
    const rows = [...container.querySelectorAll('button')]
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
    expect([...container.querySelectorAll('button')].some(row => row.hasAttribute('data-stand-in'))).toBe(true)
  })

  test('a run the list already holds when its start comes back gets no starting row, running or ended', () => {
    // The start hook takes seconds, and the list polls every 2s: the run's own row is often there
    // before the start reports its id. That row is the run; a stand-in beside it would be a second one.
    const running = agent({ id: 'run-7', status: 'running', intent: 'hi' })
    const { container, rerender } = renderRail(
      <AgentHistory projectId="p1" scope="p1" agents={[running]} selectedAgentId={null} onSelect={() => {}} startTick={0} startIntent="" />,
    )
    const standIn = () => [...container.querySelectorAll('button')].some(row => row.hasAttribute('data-stand-in'))
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
  test('a run on a saved machine shows a machine glyph naming the machine (#1067)', () => {
    renderRail(<AgentHistory projectId="p1" scope="p1" agents={[agent({ target: 'remote', remoteLabel: 'my-laptop' })]} selectedAgentId={null} onSelect={() => {}} />)
    expect(screen.getByLabelText('Runs on my-laptop')).toBeTruthy()
  })

  test('the coding agent\'s logo is the last mark of every row, after the machine glyph and the subagents\' count, so the logos stand in one column', () => {
    const main = agent({ id: 'main', target: 'remote', remoteLabel: 'my-laptop', driver: 'codex' })
    const sub = agent({ id: 'sub', parent: 'main', status: 'done', driver: 'codex' })
    renderRail(<AgentHistory projectId="p1" scope="p1" agents={[main, sub]} selectedAgentId={null} onSelect={() => {}} />)
    const row = screen.getByLabelText('Runs on my-laptop').closest('button')!
    const marks = [...row.querySelectorAll('[aria-label]')].map(mark => mark.getAttribute('aria-label'))
    expect(marks.at(-1)).toBe('Codex')
    expect(marks.indexOf('Runs on my-laptop')).toBeLessThan(marks.indexOf('Codex'))
    const fold = marks.findIndex(label => label?.startsWith('1 agent'))
    expect(fold).toBeGreaterThanOrEqual(0)
    expect(fold).toBeLessThan(marks.indexOf('Codex'))
  })

  test('a run on a person\'s own computer, reached by its line, shows a computer where a server\'s run shows a server, with the same words', () => {
    const agents = [agent({ id: 'on-computer', target: 'remote', remoteLabel: 'MacBook', remoteByLine: true }), agent({ id: 'on-server', target: 'remote', remoteLabel: 'Server' })]
    renderRail(<AgentHistory projectId="p1" scope="p1" agents={agents} selectedAgentId={null} onSelect={() => {}} />)
    expect(screen.getByLabelText('Runs on MacBook').getAttribute('class')).toContain('lucide-laptop')
    expect(screen.getByLabelText('Runs on Server').getAttribute('class')).toContain('lucide-server')
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

  test('a local run has no machine glyph (#1067)', () => {
    renderRail(<AgentHistory projectId="p1" scope="p1" agents={[agent()]} selectedAgentId={null} onSelect={() => {}} />)
    expect(screen.queryByLabelText(/Runs on/)).toBeNull()
  })

  // The shared shell: the rail is present on the home/Overview too (no project selected), showing
  // the New launcher rather than vanishing.
  test('with no project and no recents it still renders New and an empty hint', () => {
    renderRail(<AgentHistory projectId={null} agents={[]} recentAgents={[]} selectedAgentId={null} onSelect={() => {}} />)
    expect(screen.getByText('New agent')).toBeTruthy()
    expect(screen.getByText('No agents yet.')).toBeTruthy()
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
    expect(screen.getByRole('button', { name: /fix login · running · alpha/ })).toBeTruthy()
    fireEvent.click(screen.getByText('add tests'))
    expect(picked).toEqual(['proj-b', 'r-b'])
  })
})

// A run started for another run is its subagent: it sits under its main agent, not in the list.
describe('subagents on the rail', () => {
  const main = agent({ id: 'main', status: 'done', intent: 'split the login work' })
  const sub = (id: string, over: Partial<AgentMeta> = {}) => agent({ id, parent: 'main', status: 'done', intent: `task ${id}\n\nYou are a subagent: another agent started you.`, ...over })

  test('while a subagent works the list is open under its main agent, each row named by its task', () => {
    renderRail(<AgentHistory projectId="p1" scope="p1" agents={[sub('c2', { status: 'running' }), sub('c1'), main]} selectedAgentId={null} onSelect={() => {}} />)
    const fold = screen.getByRole('button', { name: /2 agents · 1 running/ })
    expect(fold.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('task c1')).toBeTruthy()
    expect(screen.getByText('task c2')).toBeTruthy()
    expect(screen.queryByText(/You are a subagent/)).toBeNull()
    // Under the main agent, oldest first, whatever the list's own order.
    const titles = screen.getAllByText(/^(split the login work|task c\d)$/).map(el => el.textContent)
    expect(titles).toEqual(['split the login work', 'task c1', 'task c2'])
  })

  test('a main agent whose own turn is over reads as running while a subagent works, and as done once none does', () => {
    const { container, rerender } = renderRail(<AgentHistory projectId="p1" scope="p1" agents={[sub('c1', { status: 'running' }), { ...main, saving: true }]} selectedAgentId={null} onSelect={() => {}} />)
    expect(screen.getAllByLabelText('running')).toHaveLength(2)
    expect(screen.queryByLabelText('done')).toBeNull()
    // One circle and one word: not "saving…" as well.
    expect(screen.queryByLabelText('saving…')).toBeNull()
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(2)
    rerender(<SidebarProvider><AgentHistory projectId="p1" scope="p1" agents={[sub('c1', { status: 'waiting' }), main]} selectedAgentId={null} onSelect={() => {}} /></SidebarProvider>)
    expect(screen.queryByLabelText('running')).toBeNull()
    expect(screen.getByLabelText('done')).toBeTruthy()
  })

  test('a main agent reads as running for the moment after a subagent ended: it is about to go on', () => {
    renderRail(<AgentHistory projectId="p1" scope="p1" agents={[sub('c1', { endedAt: new Date().toISOString() }), main]} selectedAgentId={null} onSelect={() => {}} />)
    expect(screen.getByLabelText('running')).toBeTruthy()
    cleanup()
    renderRail(<AgentHistory projectId="p1" scope="p1" agents={[sub('c1', { endedAt: '2026-07-19T16:10:00.000Z' }), main]} selectedAgentId={null} onSelect={() => {}} />)
    expect(screen.queryByLabelText('running')).toBeNull()
  })

  test("the count of subagents is on the main agent's own row, and a click on it folds the list without opening the agent", () => {
    let picked: string | null = null
    renderRail(<AgentHistory projectId="p1" scope="p1" agents={[sub('c2'), sub('c1'), main]} selectedAgentId={null} onSelect={id => (picked = id)} />)
    const fold = screen.getByRole('button', { name: '2 agents' })
    expect(fold.closest('button')?.textContent).toContain('split the login work')
    fireEvent.click(fold)
    expect(screen.getByText('task c1')).toBeTruthy()
    expect(picked).toBeNull()
    fireEvent.keyDown(fold, { key: 'Enter' })
    expect(screen.queryByText('task c1')).toBeNull()
    expect(picked).toBeNull()
  })

  test('a main agent that failed or was stopped keeps its own word while a subagent works', () => {
    renderRail(<AgentHistory projectId="p1" scope="p1" agents={[sub('c1', { status: 'running' }), { ...main, status: 'failed' }]} selectedAgentId={null} onSelect={() => {}} />)
    expect(screen.getByLabelText('failed')).toBeTruthy()
    expect(screen.getAllByLabelText('running')).toHaveLength(1)
  })

  test('a subagent stopped on a question keeps the list open too', () => {
    renderRail(<AgentHistory projectId="p1" scope="p1" agents={[sub('c1', { status: 'waiting' }), main]} selectedAgentId={null} onSelect={() => {}} />)
    expect(screen.getByRole('button', { name: '1 agent' }).getAttribute('aria-expanded')).toBe('true')
  })

  test('once every subagent has ended the list folds to its count, and a click opens it and folds it again', () => {
    renderRail(<AgentHistory projectId="p1" scope="p1" agents={[sub('c2'), sub('c1'), main]} selectedAgentId={null} onSelect={() => {}} />)
    const fold = screen.getByRole('button', { name: '2 agents' })
    expect(fold.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('task c1')).toBeNull()
    fireEvent.click(fold)
    expect(screen.getByText('task c1')).toBeTruthy()
    fireEvent.click(fold)
    expect(screen.queryByText('task c1')).toBeNull()
  })

  test('the reader folding the list of a working subagent wins over it being open by itself', () => {
    renderRail(<AgentHistory projectId="p1" scope="p1" agents={[sub('c1', { status: 'running' }), main]} selectedAgentId={null} onSelect={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /1 agent · 1 running/ }))
    expect(screen.queryByText('task c1')).toBeNull()
  })

  test('the list of an ended subagent whose page is open is open, and a click on a subagent selects it', () => {
    let picked: string | null = null
    renderRail(<AgentHistory projectId="p1" scope="p1" agents={[sub('c2'), sub('c1'), main]} selectedAgentId="c1" onSelect={id => (picked = id)} />)
    expect(screen.getByRole('button', { name: '2 agents' }).getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByText('task c2'))
    expect(picked).toBe('c2')
  })

  test('a subagent whose main agent is not in the list, and a run with no subagents, are plain rows', () => {
    renderRail(<AgentHistory projectId="p1" scope="p1" agents={[agent({ id: 'c9', parent: 'gone', intent: 'orphan task' }), agent({ id: 'solo', intent: 'alone' })]} selectedAgentId={null} onSelect={() => {}} />)
    expect(screen.getByText('orphan task')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^\d+ agents?/ })).toBeNull()
  })

  test('on the Overview a subagent sits under its main agent of the same project', () => {
    const recentAgents = [
      { projectId: 'proj-a', projectName: 'alpha', agent: sub('c1', { status: 'running' }) },
      { projectId: 'proj-b', projectName: 'beta', agent: agent({ id: 'main', status: 'done', intent: 'other project' }) },
      { projectId: 'proj-a', projectName: 'alpha', agent: main },
    ]
    renderRail(<AgentHistory projectId={null} agents={[]} recentAgents={recentAgents} selectedAgentId={null} onSelect={() => {}} />)
    expect(screen.getAllByRole('button', { name: /1 agent/ })).toHaveLength(1)
    // The subagent's row does not name the project again: it is its main agent's.
    expect(screen.getAllByRole('button', { name: /alpha/ })).toHaveLength(1)
    const titles = screen.getAllByText(/^(split the login work|task c1|other project)$/).map(el => el.textContent)
    expect(titles).toEqual(['other project', 'split the login work', 'task c1'])
  })
})

const proj = (id: string, name: string): ProjectSummary => ({ id, path: `/${id}`, name, activated: true, gitHost: false })

describe('AgentHistory New button (#new-button)', () => {
  test('with one project, New starts a session in it', () => {
    let started: string | null = null
    renderRail(
      <AgentHistory
        projectId={null}
        agents={[]}
        recentAgents={[]}
        projects={[proj('p1', 'alpha')]}
        onNewAgentInProject={id => (started = id)}
        selectedAgentId={null}
        onSelect={() => {}}
      />,
    )
    fireEvent.click(screen.getByText('New agent'))
    expect(started).toBe('p1')
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
    fireEvent.click(screen.getByText('New agent'))
    expect(started).toBe('p9')
  })

  test('with several projects and none selected, New is a picker menu', () => {
    renderRail(
      <AgentHistory
        projectId={null}
        agents={[]}
        recentAgents={[]}
        projects={[proj('p1', 'alpha'), proj('p2', 'beta')]}
        onNewAgentInProject={() => {}}
        selectedAgentId={null}
        onSelect={() => {}}
      />,
    )
    // The trigger opens a menu rather than starting immediately (aria-haspopup marks it).
    expect(screen.getByLabelText('New agent').getAttribute('aria-haspopup')).toBeTruthy()
  })
})

describe('cloud sessions on the rail (#1263/#1264)', () => {
  test('a finished web run reads as in cloud, not done: the session is still working over there', () => {
    renderRail(
      <AgentHistory
        projectId="p1" scope="p1"
        agents={[agent({ status: 'done', target: 'web', driver: 'claude-web', startedAt: new Date().toISOString() })]}
        selectedAgentId={null}
        onSelect={() => {}}
      />,
    )
    expect(screen.getByLabelText('in cloud')).toBeTruthy()
    expect(screen.queryByLabelText('done')).toBeNull()
  })

  test('a web run stopped early is just stopped: nothing is working anywhere', () => {
    renderRail(
      <AgentHistory
        projectId="p1" scope="p1"
        agents={[agent({ status: 'stopped', target: 'web', driver: 'claude-web' })]}
        selectedAgentId={null}
        onSelect={() => {}}
      />,
    )
    expect(screen.getByLabelText('stopped')).toBeTruthy()
    expect(screen.queryByLabelText('in cloud')).toBeNull()
  })

  test('a web run parked on a question the bridge reported reads as waiting (#1668)', () => {
    renderRail(
      <AgentHistory
        projectId="p1" scope="p1"
        agents={[agent({ status: 'done', target: 'web', driver: 'claude-web', startedAt: new Date().toISOString(), cloudWaiting: true })]}
        selectedAgentId={null}
        onSelect={() => {}}
      />,
    )
    expect(screen.getByLabelText('waiting')).toBeTruthy()
    expect(screen.queryByLabelText('in cloud')).toBeNull()
  })

  test('adopted cloud work reads done (its PR badge says the rest) or merged; an old run with nothing adopted is done (#1668)', () => {
    const fresh = new Date().toISOString()
    const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
    renderRail(
      <AgentHistory
        projectId="p1" scope="p1"
        agents={[
          agent({ id: 'pr', status: 'done', target: 'web', driver: 'claude-web', startedAt: fresh, pr: { number: 1, url: 'u' } }),
          agent({ id: 'merged', status: 'done', target: 'web', driver: 'claude-web', startedAt: old, pr: { number: 2, url: 'u' }, mergeOutcome: 'merged' }),
          agent({ id: 'stale', status: 'done', target: 'web', driver: 'claude-web', startedAt: old }),
        ]}
        selectedAgentId={null}
        onSelect={() => {}}
      />,
    )
    expect(screen.getByLabelText('merged')).toBeTruthy()
    expect(screen.getAllByLabelText('done')).toHaveLength(2)
    expect(screen.queryByLabelText('in cloud')).toBeNull()
  })

  test('a web run shows the cloud glyph and still names its agent (#1263)', () => {
    renderRail(
      <AgentHistory
        projectId="p1" scope="p1"
        agents={[agent({ status: 'done', target: 'web', driver: 'claude-web' })]}
        selectedAgentId={null}
        onSelect={() => {}}
      />,
    )
    expect(screen.getByLabelText('Runs as a Claude Code cloud session')).toBeTruthy()
    // claude-web is still Claude: where it runs is the target, not the agent.
    expect(screen.getByLabelText('Claude Code')).toBeTruthy()
  })

  test('a local finished run keeps its plain done badge and gets no cloud glyph', () => {
    renderRail(
      <AgentHistory projectId="p1" scope="p1" agents={[agent({ status: 'done', driver: 'claude-code' })]} selectedAgentId={null} onSelect={() => {}} />,
    )
    expect(screen.getByLabelText('done')).toBeTruthy()
    expect(screen.queryByLabelText('Runs as a Claude Code cloud session')).toBeNull()
  })
})

describe('AgentHistory title tooltip (#1494)', () => {
  // jsdom gives every element zero widths, so the overflow measure needs stubbed getters to see
  // a title wider than its rail slot.
  test('a title that overflows the rail shows its full prompt in a tooltip', async () => {
    const long = 'refactor the queue promotion sweep so drains claim tickets through lock files'
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockReturnValue(240)
    const clientSpy = vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(120)
    try {
      renderRail(<AgentHistory projectId="p1" scope="p1" agents={[agent({ intent: long })]} selectedAgentId={null} onSelect={() => {}} />)
      const row = (await screen.findByText(long)).closest('button')!
      const tip = await hoverTooltip(row)
      expect(tip.textContent).toContain(long)
    } finally {
      scrollSpy.mockRestore()
      clientSpy.mockRestore()
    }
  })

  test('a title that fits is not repeated in the hover: the hover says what the row no longer prints', async () => {
    renderRail(<AgentHistory projectId="p1" scope="p1" agents={[agent()]} selectedAgentId={null} onSelect={() => {}} />)
    const row = screen.getByText("replace 'Hello, world!' with 'Welcome!'").closest('button')!
    const tip = await hoverTooltip(row)
    expect(tip.textContent).toContain('running')
    expect(tip.textContent).not.toContain("replace 'Hello, world!'")
  })
})

describe('the project select (#1513)', () => {
  const stranded: ProjectSummary = {
    id: 'p1',
    path: '/repos/p1',
    name: 'alpha',
    activated: true,
    gitHost: false,
    errors: [{ code: 'data-sync', message: 'the data branch could not be pushed: Permission denied (publickey)', since: '2026-08-20T10:00:00.000Z' }],
  }
  const idle: ProjectSummary = { id: 'p2', path: '/repos/p2', name: 'beta', activated: false, gitHost: false }

  test('it names the picked project, or "All projects" when none is picked', () => {
    const { unmount } = renderRail(<AgentHistory projectId={null} scope="p2" agents={[]} selectedAgentId={null} onSelect={() => {}} projects={[stranded, idle]} />)
    expect(screen.getByRole('button', { name: 'Project: beta' })).toBeTruthy()
    unmount()
    renderRail(<AgentHistory projectId={null} agents={[]} recentAgents={[]} selectedAgentId={null} onSelect={() => {}} projects={[stranded, idle]} />)
    expect(screen.getByRole('button', { name: 'Project: All projects' })).toBeTruthy()
  })

  test('picking a project, or all of them, reports the pick and marks the current one', async () => {
    const picks: (string | null)[] = []
    renderRail(
      <AgentHistory projectId={null} scope="p1" onScope={id => picks.push(id)} agents={[]} selectedAgentId={null} onSelect={() => {}} projects={[stranded, idle]} />,
    )
    await openMenu(screen.getByRole('button', { name: 'Project: alpha' }))
    const current = screen.getByRole('menuitem', { name: /alpha/ })
    expect(within(current).getByLabelText('selected')).toBeTruthy()
    expect(within(screen.getByRole('menuitem', { name: /beta/ })).queryByLabelText('selected')).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: /beta/ }))
    await openMenu(screen.getByRole('button', { name: 'Project: alpha' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /All projects/ }))
    expect(picks).toEqual(['p2', null])
  })

  test('a project the daemon recorded an error for gets a red dot and the error in words; one not activated says so', async () => {
    renderRail(<AgentHistory projectId={null} agents={[]} recentAgents={[]} selectedAgentId={null} onSelect={() => {}} projects={[stranded, idle]} />)
    await openMenu(screen.getByRole('button', { name: 'Project: All projects' }))
    const broken = screen.getByRole('menuitem', { name: /alpha/ })
    expect(broken.querySelector('.bg-danger')).toBeTruthy()
    expect(within(broken).getByText('Not syncing with the remote').getAttribute('title')).toContain('Permission denied (publickey)')
    const quiet = screen.getByRole('menuitem', { name: /beta/ })
    expect(quiet.querySelector('.bg-danger')).toBeNull()
    expect(within(quiet).getByText('Not activated')).toBeTruthy()
  })

  test('an activated project whose repository has no remote says so in grey, with no red dot', async () => {
    const local = { ...idle, id: 'p3', name: 'gamma', activated: true, local: 'no-remote' as const }
    const kept = { ...idle, id: 'p4', name: 'delta', activated: true, local: 'kept' as const }
    renderRail(<AgentHistory projectId={null} agents={[]} recentAgents={[]} selectedAgentId={null} onSelect={() => {}} projects={[stranded, local, kept]} />)
    await openMenu(screen.getByRole('button', { name: 'Project: All projects' }))
    // A project with a remote whose records the person keeps says that instead, as quietly.
    expect(within(screen.getByRole('menuitem', { name: /delta/ })).getByText('Records kept on this machine').className).toContain('text-muted-foreground')
    const item = screen.getByRole('menuitem', { name: /gamma/ })
    expect(item.querySelector('.bg-danger')).toBeNull()
    expect(within(item).getByText('Local only, no remote').className).toContain('text-muted-foreground')
    expect(within(screen.getByRole('menuitem', { name: /alpha/ })).queryByText('Local only, no remote')).toBeNull()
  })

  test('with all projects showing, the row of the agent on screen is the highlighted one', () => {
    const recentAgents = [
      { projectId: 'p1', projectName: 'alpha', agent: agent({ id: 'a1', status: 'done', intent: 'first' }) },
      { projectId: 'p2', projectName: 'beta', agent: agent({ id: 'b1', status: 'done', intent: 'second' }) },
    ]
    renderRail(<AgentHistory projectId="p2" agents={[]} recentAgents={recentAgents} selectedAgentId="b1" onSelect={() => {}} projects={[stranded, idle]} />)
    expect(screen.getByText('second').closest('button')?.className).toContain('bg-accent')
    expect(screen.getByText('first').closest('button')?.className).not.toContain('bg-accent ')
  })

  test('with all projects showing, New asks which project even on a project\'s own page', () => {
    renderRail(<AgentHistory projectId="p2" agents={[]} recentAgents={[]} selectedAgentId={null} onSelect={() => {}} projects={[stranded, idle]} />)
    expect(screen.getByLabelText('New agent').getAttribute('aria-haspopup')).toBeTruthy()
  })
})

describe('the rail marks the page that is open', () => {
  const PAGES = [{ segment: 'logs', label: 'Logs' }]
  /** The person's row at the rail's foot, which opens their menu with Settings in it. */
  const person = () => screen.getByRole('button', { name: /settings$/i })
  /** Which of the rail's ways somewhere say they are the page open now: the rows at its top, and the person's row at its foot. */
  const current = () => [['Overview', screen.getByRole('button', { name: 'Overview' })], ['Logs', screen.getByRole('button', { name: 'Logs' })], ['Settings', person()]].filter(([, row]) => (row as HTMLElement).getAttribute('aria-current') === 'page').map(([name]) => name)

  test('with no project, no page and no Settings open, the Overview row is the one marked', () => {
    renderRail(<AgentHistory projectId={null} agents={[]} recentAgents={[]} selectedAgentId={null} onSelect={() => {}} pages={PAGES} />)
    expect(current()).toEqual(['Overview'])
    // Not marked is no attribute at all, on a row as on the person's.
    expect(screen.getByRole('button', { name: 'Logs' }).hasAttribute('aria-current')).toBe(false)
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
    const row = screen.getByText("replace 'Hello, world!' with 'Welcome!'").closest('button')!
    expect(onAgent).not.toHaveBeenCalled()
    fireEvent.pointerEnter(row)
    fireEvent.pointerEnter(row)
    expect(onAgent.mock.calls).toEqual([['p1', 'run-1']])
  })

  test('the keyboard reaching the row reads it too', () => {
    renderRail(<AgentHistory projectId="p1" scope="p1" agents={[agent({ status: 'failed' })]} selectedAgentId={null} onSelect={() => {}} />)
    fireEvent.focus(screen.getByText("replace 'Hello, world!' with 'Welcome!'").closest('button')!)
    expect(onAgent.mock.calls).toEqual([['p1', 'run-1']])
  })

  test('a working agent\'s row reads nothing: its page shows the live feed, not a saved log', () => {
    renderRail(<AgentHistory projectId="p1" scope="p1" agents={[agent()]} selectedAgentId={null} onSelect={() => {}} />)
    fireEvent.pointerEnter(screen.getByText("replace 'Hello, world!' with 'Welcome!'").closest('button')!)
    expect(onAgent).not.toHaveBeenCalled()
  })

  test('with every project shown, a row reads the log in its own project', () => {
    const recent = { projectId: 'p2', projectName: 'other', agent: agent({ status: 'done' }) }
    renderRail(<AgentHistory projectId={null} scope={null} agents={[]} recentAgents={[recent]} selectedAgentId={null} onSelect={() => {}} />)
    fireEvent.pointerEnter(screen.getByText("replace 'Hello, world!' with 'Welcome!'").closest('button')!)
    expect(onAgent.mock.calls).toEqual([['p2', 'run-1']])
  })
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
          <MenuButton />
          <AgentHistory projectId={null} scope="p1" agents={[agent({ status: 'done' })]} selectedAgentId={null} onSelect={onSelect} pages={[{ segment: 'logs', label: 'Logs' }]} onPage={onPage} />
        </SidebarProvider>
      )
      render(ui)
      expect(screen.queryByRole('button', { name: 'Logs' })).toBeNull()

      fireEvent.click(screen.getByRole('button', { name: 'Open the menu' }))
      fireEvent.click(await screen.findByRole('button', { name: 'Logs' }))
      expect(onPage).toHaveBeenCalledWith('logs')
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Logs' })).toBeNull())

      // An agent's row closes it too.
      fireEvent.click(screen.getByRole('button', { name: 'Open the menu' }))
      fireEvent.click(await screen.findByText("replace 'Hello, world!' with 'Welcome!'"))
      expect(onSelect).toHaveBeenCalledWith('run-1')
      await waitFor(() => expect(screen.queryByText("replace 'Hello, world!' with 'Welcome!'")).toBeNull())
    } finally {
      wide()
    }
  })

  test('on a wide screen the rail is a column, always there', () => {
    renderRail(<AgentHistory projectId={null} scope="p1" agents={[]} selectedAgentId={null} onSelect={() => {}} pages={[{ segment: 'logs', label: 'Logs' }]} />)
    expect(screen.getByRole('button', { name: 'Logs' })).toBeTruthy()
  })
})
