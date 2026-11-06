import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { AgentWorktree, OpenAgentEvent } from '../../src/index.js'

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
} as unknown as Record<string, OpenAgentEvent[]>
const DIRTY: AgentWorktree = { checkout: { path: '/w', dirty: true, sizeBytes: 5 * 1024 * 1024 }, branch: 'agent-dark-mode', pr: { number: 7, url: 'https://github.com/o/r/pull/7', state: 'OPEN', title: 'Dark mode' } }

const lastSession = () => menus.filter(menu => menu['agentId'] !== undefined).at(-1)!

describe('AgentActionBar', () => {
  test.each(Object.keys(AGENTS))('a %s agent with a dirty checkout: the name as its menu, then the project\'s; no status word, no clean or dirty, no branch, no project or place', kind => {
    const { container } = render(<AgentActionBar projectId="p1" agentId="run-1" events={AGENTS[kind]!} label="Dark mode" checkout={DIRTY} />)
    // All the bar says, word for word: nothing of the agent's state, of its tree, of its branch.
    expect(container.textContent).toBe('[Dark mode ⌄][⋮]')
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })

  test('the project\'s ⋮ stands where the "New agent session" page has it: past the spacer, just before the panes\' icons, acting on the project', () => {
    const removed = () => {}
    const error = { kind: 'error', message: 'The push was rejected' }
    const { container } = render(<AgentActionBar projectId="p1" agentId="run-1" events={[...AGENTS.running!, error] as OpenAgentEvent[]} label="Dark mode" checkout={DIRTY} onProjectRemoved={removed} />)
    const project = menus.at(-1)!
    expect(project['agentId']).toBeUndefined()
    expect(project['projectId']).toBe('p1')
    expect(project['events']).toEqual([])
    expect(project['onProjectRemoved']).toBe(removed)
    // The session's own menu keeps the session, and offers no removal of the project.
    const session = menus.at(-2)!
    expect(session['agentId']).toBe('run-1')
    expect(session['onProjectRemoved']).toBeUndefined()
    const [name, ...rest] = [...container.firstElementChild!.children]
    expect(name!.textContent).toBe('[Dark mode ⌄]')
    expect(rest.map(child => child.textContent)).toEqual(['', '1 error', '[⋮]'])
    expect(rest[0]!.className).toContain('grow')
  })

  test('the count of errors is still said, for a running agent and for one that ended, at the bar\'s end', () => {
    const error = { kind: 'error', message: 'The push was rejected' }
    for (const kind of ['running', 'finished', 'stopped']) {
      const { container } = render(<AgentActionBar projectId="p1" agentId="run-1" events={[...AGENTS[kind]!.slice(0, 2), error, ...AGENTS[kind]!.slice(2)] as OpenAgentEvent[]} label="Dark mode" checkout={DIRTY} />)
      expect(screen.getByRole('alert').textContent).toBe('1 error')
      expect(container.textContent).toBe('[Dark mode ⌄]1 error[⋮]')
      cleanup()
    }
  })

  test('the worktree\'s size is handed to the session\'s menu, not said in the bar; before the agent\'s own reads have answered there is none, and no count', () => {
    const withError = [...AGENTS.failed!.slice(0, 2), { kind: 'error', message: 'The push was rejected' }, ...AGENTS.failed!.slice(2)] as OpenAgentEvent[]
    const { container, rerender } = render(<AgentActionBar projectId="p1" agentId="run-1" events={withError} label="Dark mode" checkout={DIRTY} ready={false} />)
    expect(container.textContent).toBe('[Dark mode ⌄][⋮]')
    expect(lastSession()['size']).toBe('')
    rerender(<AgentActionBar projectId="p1" agentId="run-1" events={AGENTS.finished!} label="Dark mode" checkout={DIRTY} />)
    expect(lastSession()['size']).toBe('5 MB')
    expect(container.textContent).not.toContain('5 MB')
  })

  test('on a phone the bar keeps its start free for the menu\'s button; its end is its own, for the panes\' icons', () => {
    const { container } = render(<AgentActionBar projectId="p1" agentId="run-1" events={AGENTS.finished!} label="Dark mode" checkout={DIRTY} />)
    const row = container.firstElementChild!.className.split(' ')
    for (const cls of ['pr-2', 'md:pl-4', 'max-md:pl-11']) expect(row).toContain(cls)
    expect(row).not.toContain('pr-12')
    // As tall as the "New agent session" page's row and an open pane's header, so the three stand level;
    // unlike a pane's header, no line under it.
    expect(row).toContain('h-11')
    expect(row.join(' ')).not.toMatch(/border/)
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
