import type { AgentMeta } from '../../src/index.js'
import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SubagentsBar } from './SubagentLine.js'

afterEach(cleanup)

const sub = (id: string, over: Partial<AgentMeta> = {}): AgentMeta => ({
  status: 'running',
  id,
  startedAt: '2026-10-01T10:01:00.000Z',
  updatedAt: '2026-10-01T10:01:00.000Z',
  parent: 'main',
  intent: `task ${id}`,
  ...over,
})

// The line above the message box: there while a subagent works, gone once none does.
describe('SubagentsBar', () => {
  test('while a subagent works it says how many of them are, and opens to one line per subagent', () => {
    const opened: string[] = []
    render(<SubagentsBar subagents={[sub('c1'), sub('c2', { status: 'done', endedAt: '2026-10-01T10:01:40.000Z' }), sub('c3')]} doing={{ c1: { doing: 'Edit login.ts', tool: 'Edit', calls: 2 } }} onOpen={key => opened.push(key)} />)
    // Centered at the transcript's column width.
    expect(screen.getByText(/Subagents · 2 of 3 running/).closest('.max-w-3xl')!.className).toContain('mx-auto')
    const toggle = screen.getByRole('button', { name: 'Subagents · 2 of 3 running' })
    expect(screen.queryByText(/task c1/)).toBeNull()
    fireEvent.click(toggle)
    expect(screen.getByText('Edit · 2 calls')).toBeTruthy()
    expect(screen.getByText('done')).toBeTruthy()
    expect(screen.getByText('40s')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open the subagent: task c3' }))
    expect(opened).toEqual(['run:c3'])
  })

  test('with no subagent working there is no line: none at all, all ended, or one only waiting', () => {
    const { container, rerender } = render(<SubagentsBar subagents={[]} doing={{}} />)
    expect(container.textContent).toBe('')
    rerender(<SubagentsBar subagents={[sub('c1', { status: 'done' }), sub('c2', { status: 'waiting' })]} doing={{}} />)
    expect(container.textContent).toBe('')
  })
})
