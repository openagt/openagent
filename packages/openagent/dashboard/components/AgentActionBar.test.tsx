import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { AgentWorktree, OpenAgentEvent } from '../../src/index.js'

// The two menus read the daemon and have tests of their own: here each is a stand-in that says
// which menu it is and what it was handed, so what the bar lays out, and what it leaves out, is
// checked on what is really on screen.
const menus = vi.hoisted(() => [] as Record<string, unknown>[])
vi.mock('./AgentActionsMenu.js', () => ({
  AgentActionsMenu: (props: { part?: string; label?: string; size?: string; details?: { open: boolean; onToggle: () => void } }) => {
    menus.push(props)
    return props.part === 'session' ? (
      <button type="button" onClick={props.details?.onToggle}>
        [{props.label ?? 'no name'} ⌄]
      </button>
    ) : (
      <button type="button">[⋮]</button>
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

const lastSession = () => menus.filter(menu => menu['part'] === 'session').at(-1)!

describe('AgentActionBar', () => {
  test.each(Object.keys(AGENTS))('a %s agent with a dirty checkout: the name as its menu, the chip, the project\'s menu; no status word, no clean or dirty, no branch', kind => {
    const { container } = render(<AgentActionBar projectId="p1" agentId="run-1" events={AGENTS[kind]!} label="Dark mode" projectName="gemstack" checkout={DIRTY} />)
    // All the bar says, word for word: nothing of the agent's state, of its tree, of its branch.
    expect(container.textContent).toBe('[Dark mode ⌄]This machine · gemstack[⋮]')
  })

  test('the name comes first, then the chip with where the agent runs and its project, and the project\'s menu last', () => {
    render(<AgentActionBar projectId="p1" agentId="run-1" events={AGENTS.finished!} label="Dark mode" projectName="gemstack" runsOn="Studio" checkout={DIRTY} />)
    const chip = screen.getByTestId('runs-on')
    expect(chip.textContent).toBe('Studio · gemstack')
    expect(chip.getAttribute('title')).toBe('Studio · gemstack')
    const [name, project] = screen.getAllByRole('button')
    expect(name!.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(chip.compareDocumentPosition(project!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // The chip is the part a narrow bar drops, and it is cut at a cap: the name keeps its room.
    // Shown unless the bar is narrow: never hidden by itself.
    expect(chip.className.split(' ')).toContain('@max-md:hidden')
    for (const shown of ['hidden', 'inline', 'inline-block', 'block']) expect(chip.className.split(' ')).not.toContain(shown)
    expect(chip.className).toContain('truncate')
  })

  test('with no project named, the chip says where the agent runs alone; by itself it says this machine', () => {
    render(<AgentActionBar projectId="p1" agentId="run-1" events={AGENTS.finished!} label="Dark mode" checkout={DIRTY} />)
    expect(screen.getByTestId('runs-on').textContent).toBe('This machine')
  })

  test('on a page opened from somewhere else than the computer it is on, this machine goes by the name the page was reached at', () => {
    const page = (globalThis as unknown as { jsdom: { reconfigure(to: { url: string }): void } }).jsdom
    const own = window.location.href
    page.reconfigure({ url: 'https://165.245.244.10/' })
    try {
      render(<AgentActionBar projectId="p1" agentId="run-1" events={AGENTS.finished!} label="Dark mode" projectName="gemstack" checkout={DIRTY} />)
      expect(screen.getByTestId('runs-on').textContent).toBe('165.245.244.10 · gemstack')
    } finally {
      page.reconfigure({ url: own })
    }
  })

  test('the count of errors is still said, for a running agent and for one that ended, before the project\'s menu', () => {
    const error = { kind: 'error', message: 'The push was rejected' }
    for (const kind of ['running', 'finished', 'stopped']) {
      const { container } = render(<AgentActionBar projectId="p1" agentId="run-1" events={[...AGENTS[kind]!.slice(0, 2), error, ...AGENTS[kind]!.slice(2)] as OpenAgentEvent[]} label="Dark mode" checkout={DIRTY} />)
      expect(screen.getByRole('alert').textContent).toBe('1 error')
      expect(container.textContent).toBe('[Dark mode ⌄]This machine1 error[⋮]')
      cleanup()
    }
  })

  test('the worktree\'s size is handed to the session\'s menu, not said in the bar; before the agent\'s own reads have answered there is none, and no count', () => {
    const withError = [...AGENTS.failed!.slice(0, 2), { kind: 'error', message: 'The push was rejected' }, ...AGENTS.failed!.slice(2)] as OpenAgentEvent[]
    const { container, rerender } = render(<AgentActionBar projectId="p1" agentId="run-1" events={withError} label="Dark mode" checkout={DIRTY} ready={false} />)
    expect(container.textContent).toBe('[Dark mode ⌄]This machine[⋮]')
    expect(lastSession()['size']).toBe('')
    rerender(<AgentActionBar projectId="p1" agentId="run-1" events={AGENTS.finished!} label="Dark mode" checkout={DIRTY} />)
    expect(lastSession()['size']).toBe('5 MB')
    expect(container.textContent).not.toContain('5 MB')
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
