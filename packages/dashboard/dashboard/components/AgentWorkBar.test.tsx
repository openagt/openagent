import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AgentWorkBar } from './AgentWorkBar.js'

afterEach(cleanup)

describe('AgentWorkBar', () => {
  test('it says the branch, what the branch holds and the next step, in one row', () => {
    render(<AgentWorkBar checkout={{ branch: 'agent-fix-header' }} summary={<span>2 commits</span>} actions={<button type="button">Open PR</button>} show />)
    const bar = screen.getByRole('group', { name: "This agent's work" })
    // The branch as it is named.
    expect(bar.textContent).toBe('agent-fix-header2 commitsOpen PR')
    expect(screen.getByRole('button', { name: 'Open PR' })).toBeTruthy()
  })

  test('the ✕ puts the bar away, and new work brings it back', () => {
    const bar = (state: string) => <AgentWorkBar checkout={{ branch: 'agent-fix-header' }} summary={<span>2 commits</span>} actions={<button type="button">Open PR</button>} show state={state} />
    const { container, rerender } = render(bar('two-commits'))
    fireEvent.click(screen.getByRole('button', { name: 'Hide this bar' }))
    expect(container.textContent).toBe('')
    // The same work again: still away. The agent commits once more: the bar is back, unasked.
    rerender(bar('two-commits'))
    expect(container.textContent).toBe('')
    rerender(bar('three-commits'))
    expect(screen.getByRole('group', { name: "This agent's work" })).toBeTruthy()
  })

  test('a step that failed says why on a line of its own, and the next step stays', () => {
    render(<AgentWorkBar checkout={{ branch: 'agent-1' }} summary={<span>+1 −0</span>} actions={<button type="button">Open PR</button>} error="gh is not logged in" show />)
    expect(screen.getByRole('alert').textContent).toBe('gh is not logged in')
    expect(screen.getByRole('button', { name: 'Open PR' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Hide this bar' })).toBeTruthy()
  })

  test('with nothing to say there is no bar', () => {
    const { container } = render(<AgentWorkBar checkout={{ branch: 'agent-1' }} summary={<span>2 commits</span>} actions={<span>Merged into main.</span>} show={false} />)
    expect(container.textContent).toBe('')
  })

  test("the branch's pull request is a link, with its state", () => {
    render(<AgentWorkBar checkout={{ branch: 'agent-1', pr: { number: 12, url: 'https://github.com/o/r/pull/12', state: 'OPEN', title: 'Fix it' } }} show />)
    const link = screen.getByRole('link', { name: /PR #12/ })
    expect(link.getAttribute('href')).toBe('https://github.com/o/r/pull/12')
    expect(link.textContent).toContain('open')
  })

  test('before the branch is known there is no bar', () => {
    const { container, rerender } = render(<AgentWorkBar checkout={null} actions={<button type="button">Open PR</button>} show />)
    expect(container.textContent).toBe('')
    rerender(<AgentWorkBar checkout={{}} show />)
    expect(container.textContent).toBe('')
  })
})
