import type { AgentMeta, OpenAgentEvent } from '../../src/index.js'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useMemo, useState, type ReactNode } from 'react'

const onAgent = vi.hoisted(() => vi.fn())
vi.mock('../rpc/reads.js', () => ({ onAgent }))
vi.mock('../rpc/models.js', () => ({ onModels: () => new Promise(() => {}) }))

const { SubagentPanel } = await import('./SubagentPanel.js')
const { PaneHeaderContext } = await import('./PaneHeader.js')
const { forgetRevealedChanges, revealSubagent } = await import('../lib/reveal-change.js')
const { forgetRemembered } = await import('@openagt/skill-ui/module')

beforeEach(() => {
  forgetRevealedChanges()
  forgetRemembered()
  onAgent.mockReset().mockResolvedValue([])
})
afterEach(cleanup)

/** A pane's card as far as the panel needs one: the places in its header it puts its name and its buttons. */
function Card({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState<HTMLElement | null>(null)
  const [actions, setActions] = useState<HTMLElement | null>(null)
  const slots = useMemo(() => ({ title, actions }), [title, actions])
  return (
    <>
      <header>
        <div data-testid="title" ref={setTitle} />
        <div ref={setActions} />
      </header>
      <PaneHeaderContext.Provider value={slots}>{children}</PaneHeaderContext.Provider>
    </>
  )
}

const panel = (props: { events?: OpenAgentEvent[]; subagents?: AgentMeta[]; live?: boolean; onOpenAgent?: (id: string) => void }) => (
  <Card>
    <SubagentPanel projectId="p1" agentId="main" events={props.events ?? []} subagents={props.subagents ?? []} live={props.live ?? true} onOpenAgent={props.onOpenAgent} />
  </Card>
)

describe('the Subagent pane', () => {
  test("a subagent of the coding agent's own: its model, that it has no branch, its whole prompt, then what it said and did, out of the main agent's log", () => {
    const events: OpenAgentEvent[] = [
      { kind: 'driver', event: { type: 'action', label: 'Agent', detail: 'Map the pages', id: 'toolu_a' }, at: '2026-10-01T10:00:10.000Z' },
      { kind: 'driver', event: { type: 'subagent', id: 'toolu_a', status: 'working', name: 'Map the pages', role: 'Explore', model: 'claude-haiku-5-5', prompt: 'Read how the pages are served.\nStart at server.ts.' }, at: '2026-10-01T10:00:10.000Z' },
      { kind: 'driver', event: { type: 'action', label: 'Read', detail: 'src/server.ts', id: 'toolu_b', subagent: 'toolu_a' }, at: '2026-10-01T10:00:12.000Z' },
      { kind: 'driver', event: { type: 'text', text: 'The pages are served by server.ts.', subagent: 'toolu_a' }, at: '2026-10-01T10:00:20.000Z' },
      { kind: 'driver', event: { type: 'text', text: 'The main agent’s own words.' }, at: '2026-10-01T10:00:30.000Z' },
    ]
    render(panel({ events }))
    act(() => revealSubagent('p1/main', 'call:toolu_a'))
    expect(screen.getByTestId('title').textContent).toBe('Map the pages')
    expect(screen.getByText('claude-haiku-5-5')).toBeTruthy()
    expect(screen.getByText('Explore')).toBeTruthy()
    expect(screen.getByText('no branch: it works in this run’s checkout')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Its prompt' }).textContent).toContain('Read how the pages are served.\nStart at server.ts.')
    expect(screen.getByText('The pages are served by server.ts.')).toBeTruthy()
    expect(screen.getByText('server.ts')).toBeTruthy()
    expect(screen.queryByText('The main agent’s own words.')).toBeNull()
    // It has no page of its own to open.
    expect(screen.queryByRole('button', { name: 'Open its page' })).toBeNull()
  })

  test('a subagent that is a run of its own: its model, its cost and its branch, its prompt, then its own log; its page is one click away', async () => {
    onAgent.mockResolvedValue([{ kind: 'driver', event: { type: 'text', text: 'I wrote the docs.' }, at: '2026-10-01T10:02:00.000Z' }] satisfies OpenAgentEvent[])
    const opened: string[] = []
    const sub: AgentMeta = {
      status: 'done',
      id: '2026-10-01T10-01-00-000Z',
      startedAt: '2026-10-01T10:01:00.000Z',
      updatedAt: '2026-10-01T10:03:00.000Z',
      endedAt: '2026-10-01T10:02:07.000Z',
      parent: 'main',
      title: 'Write the docs',
      intent: 'Write the README.\n\nYou are a subagent.',
      model: 'claude-sonnet-5-5',
      cost: 0.36,
      branch: 'agent-2026-10-01T10-01-00-000Z',
    }
    render(panel({ subagents: [sub], onOpenAgent: id => opened.push(id) }))
    act(() => revealSubagent('p1/main', `run:${sub.id}`))
    expect(screen.getByTestId('title').textContent).toBe('Write the docs')
    expect(screen.getByText('done')).toBeTruthy()
    expect(screen.getByText('1m 7s')).toBeTruthy()
    expect(screen.getByText('$0.36')).toBeTruthy()
    expect(screen.getByText(`on ${sub.branch}`)).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Its prompt' }).textContent).toContain('You are a subagent.')
    await waitFor(() => expect(screen.getByText('I wrote the docs.')).toBeTruthy())
    expect(onAgent).toHaveBeenCalledWith('p1', sub.id)
    fireEvent.click(screen.getByRole('button', { name: 'Open its page' }))
    expect(opened).toEqual([sub.id])
  })

  test('it says it has nothing to show only once the read answered, and a log read before is there from the first frame', async () => {
    const sub: AgentMeta = { status: 'done', id: '2026-10-01T10-05-00-000Z', startedAt: '2026-10-01T10:05:00.000Z', updatedAt: '2026-10-01T10:06:00.000Z', endedAt: '2026-10-01T10:06:00.000Z', parent: 'main', title: 'Fix the typo', intent: 'Fix it.' }
    let answer: (events: OpenAgentEvent[]) => void = () => {}
    onAgent.mockReturnValue(new Promise(resolve => (answer = resolve)))
    render(panel({ subagents: [sub] }))
    act(() => revealSubagent('p1/main', `run:${sub.id}`))
    expect(screen.queryByText('It left nothing to show.')).toBeNull()
    await act(async () => answer([{ kind: 'driver', event: { type: 'text', text: 'Fixed it.' }, at: '2026-10-01T10:05:30.000Z' }]))
    expect(screen.getByText('Fixed it.')).toBeTruthy()
    // Opened again, with a read that has not answered yet: what was read before is shown at once.
    cleanup()
    onAgent.mockReturnValue(new Promise(() => {}))
    render(panel({ subagents: [sub] }))
    expect(screen.getByText('Fixed it.')).toBeTruthy()
  })

  test('a subagent that is not one of this run’s says so', () => {
    render(panel({}))
    act(() => revealSubagent('p1/main', 'run:gone'))
    expect(screen.getByText('This subagent is not one of this run’s.')).toBeTruthy()
  })
})
