import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('../lib/models.js', () => ({
  useModels: () => ({ 'claude-code': { models: [{ id: 'opus', name: 'Opus 5.5', resolvedId: 'claude-opus-5-5' }] } }),
  modelName: (models: { models: { id: string; name: string; resolvedId?: string }[] } | undefined, id: string) =>
    models?.models.find(m => m.id === id || m.resolvedId === id)?.name ?? id,
}))

const { SessionLine } = await import('./SessionLine.js')

afterEach(cleanup)

const setup = { workspace: '/repo/.branches/agent-1', branch: 'agent-1', driver: 'claude-code', model: 'claude-opus-5-5' }

describe('SessionLine', () => {
  test('it is one folded line saying the session was set up', () => {
    render(<SessionLine setup={setup} />)
    expect(screen.getByRole('button', { name: 'Initialized session' }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('/repo/.branches/agent-1')).toBeNull()
  })

  test('opened, it says the checkout, the branch, and the coding agent with its model by name', () => {
    const { container } = render(<SessionLine setup={setup} />)
    fireEvent.click(screen.getByRole('button', { name: 'Initialized session' }))
    expect(Array.from(container.querySelectorAll('.border > div')).map(n => n.textContent)).toEqual([
      'Made the checkout/repo/.branches/agent-1',
      'Made the branchagent-1',
      'Started Claude CodeOpus 5.5',
    ])
    // A green check in front of each step that was done.
    expect(container.querySelectorAll('.border svg.text-success')).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: 'Initialized session' }))
    expect(container.querySelector('.border')).toBeNull()
  })

  test('an agent started from a branch other than the main one says so, in one sentence under its branch', () => {
    const { container } = render(<SessionLine setup={{ ...setup, base: 'my/work' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Initialized session' }))
    expect(Array.from(container.querySelectorAll('.border > div')).map(n => n.textContent)).toEqual([
      'Made the checkout/repo/.branches/agent-1',
      'Made the branchagent-1',
      'Started from the branch my/work, not from the main branch.',
      'Started Claude CodeOpus 5.5',
    ])
  })

  test('what Auto adds after each message is the last row, word for word; an agent with nothing added has no such row', () => {
    const { container, rerender } = render(<SessionLine setup={setup} added="When you finish, if you changed any file, commit your work." />)
    fireEvent.click(screen.getByRole('button', { name: 'Initialized session' }))
    expect(Array.from(container.querySelectorAll('.border > div')).map(n => n.textContent).at(-1)).toBe(
      'Auto adds after each message: “When you finish, if you changed any file, commit your work.”',
    )
    rerender(<SessionLine setup={setup} />)
    expect(screen.queryByText(/Auto adds/)).toBeNull()
  })

  test('an agent started from the main branch has no such sentence', () => {
    render(<SessionLine setup={setup} />)
    fireEvent.click(screen.getByRole('button', { name: 'Initialized session' }))
    expect(screen.queryByText(/Started from the branch/)).toBeNull()
  })

  test('a fact the card does not say is no line, and a coding agent with no model is named alone', () => {
    const { container } = render(<SessionLine setup={{ driver: 'codex' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Initialized session' }))
    expect(Array.from(container.querySelectorAll('.border > div')).map(n => n.textContent)).toEqual(['Started Codex'])
  })

  test('a card that says none of them draws nothing', () => {
    const { container } = render(<SessionLine setup={{}} />)
    expect(container.firstChild).toBeNull()
  })

  test('an agent at work whose card is not read yet says "Initialized session" at once, with nothing to open; the button comes with the card', () => {
    const { rerender } = render(<SessionLine setup={{}} working />)
    expect(screen.getByText('Initialized session')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    rerender(<SessionLine setup={setup} working />)
    expect(screen.getByRole('button', { name: 'Initialized session' })).toBeTruthy()
  })

  test('an agent at work elsewhere, whose card may never say them, draws nothing', () => {
    const { container } = render(<SessionLine setup={{ elsewhere: true }} working />)
    expect(container.firstChild).toBeNull()
  })

  test('while the session is set up it is one moving line naming the step going on, with the seconds, and no button', () => {
    const since = new Date(Date.now() - 3_000).toISOString()
    const { rerender } = render(<SessionLine setup={{}} live={{ since }} />)
    // No card yet.
    expect(screen.getByRole('status').textContent).toBe('Starting session3s')
    expect(screen.queryByRole('button')).toBeNull()
    // The card is there and names the coding agent: its checkout is being made.
    rerender(<SessionLine setup={{ driver: 'claude-code' }} live={{ since }} />)
    expect(screen.getByRole('status').textContent).toBe('Making the checkout3s')
    // An agent that runs elsewhere has no checkout made here.
    rerender(<SessionLine setup={{ driver: 'claude-code', elsewhere: true }} live={{ since }} />)
    expect(screen.getByRole('status').textContent).toBe('Starting session3s')
    // The card names the branch: the checkout is made, the coding agent is being started.
    rerender(<SessionLine setup={{ driver: 'claude-code', branch: 'agent-1' }} live={{ since }} />)
    expect(screen.getByRole('status').textContent).toBe('Starting Claude Code3s')
    // Set up: the folded line.
    rerender(<SessionLine setup={{ driver: 'claude-code', branch: 'agent-1' }} />)
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByRole('button', { name: 'Initialized session' })).toBeTruthy()
  })

  test('with no time to count from, the moving line has no seconds', () => {
    render(<SessionLine setup={{}} live={{}} />)
    expect(screen.getByRole('status').textContent).toBe('Starting session')
  })
})
