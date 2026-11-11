import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AgentWorkBar } from './AgentWorkBar.js'
import { useWorkBarAway } from '../lib/work-bar-away.js'

afterEach(cleanup)

const noop = () => {}

/** The bar as a session's page holds it: put away by its ✕ for its run, at what it is about. */
function Bar({ run = 'r1', state }: { run?: string; state: string }) {
  const workBar = useWorkBarAway(run, state)
  return <AgentWorkBar checkout={{ branch: 'agent-fix-header' }} summary={<span>2 commits</span>} actions={<button type="button">Open PR</button>} show away={workBar.away} onHide={workBar.hide} />
}

describe('AgentWorkBar', () => {
  test('it says the branch, what the branch holds and the next step, in one row', () => {
    render(<AgentWorkBar checkout={{ branch: 'agent-fix-header' }} summary={<span>2 commits</span>} actions={<button type="button">Open PR</button>} show away={false} onHide={noop} />)
    const bar = screen.getByRole('group', { name: "This session's work" })
    // The branch as it is named.
    expect(bar.textContent).toBe('agent-fix-header2 commitsOpen PR')
    expect(screen.getByRole('button', { name: 'Open PR' })).toBeTruthy()
  })

  test('the ✕ puts the bar away, and new work brings it back', () => {
    const bar = (state: string) => <Bar state={state} />
    const { container, rerender } = render(bar('two-commits'))
    fireEvent.click(screen.getByRole('button', { name: 'Hide this bar' }))
    expect(container.textContent).toBe('')
    // The same work again: still away. The agent commits once more: the bar is back, unasked.
    rerender(bar('two-commits'))
    expect(container.textContent).toBe('')
    rerender(bar('three-commits'))
    expect(screen.getByRole('group', { name: "This session's work" })).toBeTruthy()
  })

  test('a bar put away stays away after a reload, for its run alone', () => {
    const bar = (run: string) => <Bar run={run} state="two-commits" />
    render(bar('r2'))
    fireEvent.click(screen.getByRole('button', { name: 'Hide this bar' }))
    cleanup()
    const { container } = render(bar('r2'))
    expect(container.textContent).toBe('')
    render(bar('r3'))
    expect(screen.getByRole('group', { name: "This session's work" })).toBeTruthy()
  })

  test('a browser that keeps nothing still puts the bar away on this page, until the work moves on', () => {
    const refuse = () => {
      throw new DOMException('The storage is off', 'SecurityError')
    }
    const refused = (['getItem', 'setItem'] as const).map(method => vi.spyOn(Storage.prototype, method).mockImplementation(refuse))
    try {
      const bar = (state: string) => <Bar run="r4" state={state} />
      const { container, rerender } = render(bar('two-commits'))
      fireEvent.click(screen.getByRole('button', { name: 'Hide this bar' }))
      expect(container.textContent).toBe('')
      rerender(bar('two-commits'))
      expect(container.textContent).toBe('')
      rerender(bar('three-commits'))
      expect(screen.getByRole('group', { name: "This session's work" })).toBeTruthy()
    } finally {
      for (const spy of refused) spy.mockRestore()
    }
  })

  test('a step that failed says why on a line of its own, and the next step stays', () => {
    render(<AgentWorkBar checkout={{ branch: 'agent-1' }} summary={<span>+1 −0</span>} actions={<button type="button">Open PR</button>} error="gh is not logged in" show away={false} onHide={noop} />)
    expect(screen.getByRole('alert').textContent).toBe('gh is not logged in')
    expect(screen.getByRole('button', { name: 'Open PR' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Hide this bar' })).toBeTruthy()
  })

  test('with nothing to say there is no bar', () => {
    const { container } = render(<AgentWorkBar checkout={{ branch: 'agent-1' }} summary={<span>2 commits</span>} actions={<span>Merged into main.</span>} show={false} away={false} onHide={noop} />)
    expect(container.textContent).toBe('')
  })

  test("the branch's pull request is a link, with its state", () => {
    render(<AgentWorkBar checkout={{ branch: 'agent-1', pr: { number: 12, url: 'https://github.com/o/r/pull/12', state: 'OPEN', title: 'Fix it' } }} show away={false} onHide={noop} />)
    const link = screen.getByRole('link', { name: /PR #12/ })
    expect(link.getAttribute('href')).toBe('https://github.com/o/r/pull/12')
    expect(link.textContent).toContain('open')
  })

  test('before the branch is known there is no bar', () => {
    const { container, rerender } = render(<AgentWorkBar checkout={null} actions={<button type="button">Open PR</button>} show away={false} onHide={noop} />)
    expect(container.textContent).toBe('')
    rerender(<AgentWorkBar checkout={{}} show away={false} onHide={noop} />)
    expect(container.textContent).toBe('')
  })
})
