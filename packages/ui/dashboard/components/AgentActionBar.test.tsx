import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { AgentWorktree } from '../../src/index.js'
import type { RunEvent } from '@openagt/hooks'

// The menu reads the daemon and has tests of its own: here it is a stand-in that says what it was
// handed, so what the bar lays out, and what it leaves out, is checked on what is really on screen.
const menus = vi.hoisted(() => [] as Record<string, unknown>[])
vi.mock('./AgentActionsMenu.js', () => ({
  AgentActionsMenu: (props: { projectId: string; agentId?: string; label?: string; size?: string; details?: { open: boolean; onToggle: () => void } }) => {
    menus.push(props)
    return (
      <button type="button" onClick={props.details?.onToggle}>
        {props.agentId ? `[${props.label ?? 'no name'} ⌄]` : '[⋮]'}
      </button>
    )
  },
}))

const { AgentActionBar } = await import('./AgentActionBar.js')

afterEach(cleanup)

const session = { kind: 'session', driver: 'claude-code', workspace: '/w' }
const said = { kind: 'driver', event: { type: 'text', text: 'working' } }
const reason = "codex exited (1): You've hit your usage limit."
const AGENTS = {
  running: [session, said],
  finished: [session, said, { kind: 'end', ok: true }],
  failed: [session, said, { kind: 'end', ok: false, detail: reason }],
  stopped: [session, said, { kind: 'end', ok: false, stopped: true }],
  'waiting for an answer': [session, said, { kind: 'end', ok: false, waiting: true }],
} as unknown as Record<string, RunEvent[]>
const DIRTY: AgentWorktree = { checkout: { path: '/w', dirty: true, sizeBytes: 5 * 1024 * 1024 }, branch: 'agent-dark-mode', pr: { number: 7, url: 'https://github.com/o/r/pull/7', state: 'OPEN', title: 'Dark mode' } }

const lastSession = () => menus.filter(menu => menu['agentId'] !== undefined).at(-1)!

describe('AgentActionBar', () => {
  test.each(Object.keys(AGENTS))('a %s agent with a dirty checkout: the name as its menu, then the project\'s; no status word, no clean or dirty, no branch, no project or place', kind => {
    const { container } = render(<AgentActionBar projectId="p1" agentId="run-1" events={AGENTS[kind]!} label="Dark mode" checkout={DIRTY} />)
    // All the bar says, word for word: nothing of the agent's state, of its tree, of its branch.
    expect(container.textContent).toBe('[Dark mode ⌄][⋮]')
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })

  test('the run\'s state stands after its name, in the run table\'s word on its soft fill', () => {
    const { container } = render(<AgentActionBar projectId="p1" agentId="run-1" events={AGENTS.running!} label="Dark mode" checkout={DIRTY} status="running" />)
    expect(container.textContent).toBe('[Dark mode ⌄]Working[⋮]')
    // The mark is drawn in the pill's own colour, the state's.
    expect(container.querySelector('svg')!.getAttribute('class')).toContain('text-current')
    expect(container.querySelector('svg')!.parentElement!.className).toContain('text-info')
  })

  test('the project\'s ⋮ stands where the "New agent session" page has it: past the spacer, just before the panes\' icons, acting on the project', () => {
    const removed = () => {}
    const error = { kind: 'error', message: 'The push was rejected' }
    const { container } = render(<AgentActionBar projectId="p1" agentId="run-1" events={[...AGENTS.running!, error] as RunEvent[]} label="Dark mode" checkout={DIRTY} onProjectRemoved={removed} />)
    const project = menus.at(-1)!
    expect(project['agentId']).toBeUndefined()
    expect(project['projectId']).toBe('p1')
    expect(project['events']).toEqual([])
    expect(project['onProjectRemoved']).toBe(removed)
    // The session's own menu keeps the session, and offers no removal of the project.
    const session = menus.at(-2)!
    expect(session['agentId']).toBe('run-1')
    expect(session['onProjectRemoved']).toBeUndefined()
    const [name, ...rest] = [...container.firstElementChild!.firstElementChild!.children]
    expect(name!.textContent).toBe('[Dark mode ⌄]')
    expect(rest.map(child => child.textContent)).toEqual(['', '1 error', '[⋮]'])
    expect(rest[0]!.className).toContain('grow')
  })

  test('the count of errors is still said, for a running agent and for one that ended, at the bar\'s end', () => {
    const error = { kind: 'error', message: 'The push was rejected' }
    for (const kind of ['running', 'finished', 'stopped']) {
      const { container } = render(<AgentActionBar projectId="p1" agentId="run-1" events={[...AGENTS[kind]!.slice(0, 2), error, ...AGENTS[kind]!.slice(2)] as RunEvent[]} label="Dark mode" checkout={DIRTY} />)
      expect(screen.getByRole('alert').textContent).toBe('1 error')
      expect(container.textContent).toBe('[Dark mode ⌄]1 error[⋮]')
      cleanup()
    }
  })

  test('the bar starts 16 in on every screen, the sidebar opening from the bar of pages on a phone; its end is its own, for the panes\' icons', () => {
    const { container } = render(<AgentActionBar projectId="p1" agentId="run-1" events={AGENTS.finished!} label="Dark mode" checkout={DIRTY} />)
    const row = container.firstElementChild!.firstElementChild!.className.split(' ')
    for (const cls of ['pr-2', 'pl-4']) expect(row).toContain(cls)
    expect(row).not.toContain('pr-12')
    // As tall as the "New agent session" page's row and an open pane's header, so the three stand level;
    // unlike a pane's header, a line under it only while the chat is scrolled under it.
    expect(row).toContain('h-11')
    expect(row.join(' ')).not.toMatch(/border/)
    expect(container.firstElementChild!.className).toBe('shadow-[inset_0_-1px_0_var(--color-border)]')
    // The menu is the agent's own: it is handed the agent.
    expect(lastSession()['agentId']).toBe('run-1')
  })

  test('a name not known yet is still the session\'s menu, handed no name', () => {
    render(<AgentActionBar projectId="p1" agentId="run-1" events={[]} checkout={null} />)
    expect(screen.getByRole('button', { name: '[no name ⌄]' })).toBeTruthy()
  })

  test('the session\'s menu shows and hides the detail under the bar, when the page has one', () => {
    const onToggle = vi.fn()
    const { rerender } = render(<AgentActionBar projectId="p1" agentId="run-1" events={AGENTS.finished!} label="Dark mode" checkout={DIRTY} onToggle={onToggle} />)
    expect(lastSession()['details']).toMatchObject({ open: false })
    screen.getByRole('button', { name: '[Dark mode ⌄]' }).click()
    expect(onToggle).toHaveBeenCalledTimes(1)
    rerender(<AgentActionBar projectId="p1" agentId="run-1" events={AGENTS.finished!} label="Dark mode" checkout={DIRTY} onToggle={onToggle} expanded />)
    expect(lastSession()['details']).toMatchObject({ open: true })
    rerender(<AgentActionBar projectId="p1" agentId="run-1" events={AGENTS.finished!} label="Dark mode" checkout={DIRTY} />)
    expect(lastSession()['details']).toBeUndefined()
  })
})
