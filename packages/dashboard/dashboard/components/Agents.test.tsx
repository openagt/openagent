import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ActiveAgent } from '../../src/index.js'
import { Agents } from './Agents.js'

// The Overview's Agents card (#1139), which replaced Working now — since trimmed to the sessions
// working right now, the finished ones being the sidebar session list's job. Everything it renders
// arrives as props, so there is no RPC in its import graph and no mock to set up.
//
// What these pin is the click: #1189 made an Overview row open the session it names instead of
// dropping the reader on the project launcher, and the tests that held that line went with
// WorkingNow.tsx when #1190 deleted it.

afterEach(cleanup)

const active = (agentId: string, over: Partial<ActiveAgent> = {}): ActiveAgent => ({
  projectId: 'p1',
  projectName: 'gemstack',
  agentId: agentId,
  cwd: `/repos/gemstack/.openagent/worktrees/${agentId}`,
  status: 'running',
  startedAt: '2026-07-25T09:00:00.000Z',
  updatedAt: '2026-07-25T10:00:00.000Z',
  intent: `working on ${agentId}`,
  ...over,
})

describe('Agents (#1139)', () => {
  test('lists the working sessions under the "currently working" description, with no Current/Recent split', () => {
    render(<Agents loaded working={[active('r1')]} namesRuns onSelectAgent={vi.fn()} />)
    expect(screen.getByText('Agents currently working')).toBeTruthy()
    expect(screen.getByText('working on r1')).toBeTruthy()
    // The columns are gone: no "Current" eyebrow, and no "Recent" list — the sidebar's session
    // list already carries the finished sessions.
    expect(screen.queryByText('Current')).toBeNull()
    expect(screen.queryByText('Recent')).toBeNull()
  })

  test('clicking a working agent opens that session', () => {
    const onSelectAgent = vi.fn()
    render(<Agents loaded working={[active('r1')]} namesRuns onSelectAgent={onSelectAgent} />)
    fireEvent.click(screen.getByText('working on r1'))
    // Project *and* run: a project alone would land on the launcher, which is the regression (#1189).
    expect(onSelectAgent).toHaveBeenCalledWith('p1', 'r1')
  })



  test("a working agent's row is a link to its session: a Ctrl+click is the browser's, for a new tab", () => {
    const onSelectAgent = vi.fn()
    render(<Agents loaded working={[active('r1')]} namesRuns onSelectAgent={onSelectAgent} />)
    const row = screen.getByRole('link', { name: /working on r1/ })
    expect(row.getAttribute('href')).toBe('/p1/r1')
    fireEvent.click(row, { ctrlKey: true })
    expect(onSelectAgent).not.toHaveBeenCalled()
  })

  test('a working session with no intent still gets a label', () => {
    // An unlabelled row would be a blank line you cannot tell apart from its neighbours: the
    // scope, else the project, names it.
    render(<Agents loaded working={[active('r1', { intent: '   ', scope: 'oauth-work' })]} namesRuns onSelectAgent={vi.fn()} />)
    expect(screen.getByText('oauth-work')).toBeTruthy()
  })

  test('a run goes by the name the sidebar gives it, and holds its place only while its card says that name is being asked', () => {
    const now = new Date().toISOString()
    render(<Agents loaded working={[active('named', { title: 'Cart page' }), active('new', { startedAt: now, naming: true }), active('command', { startedAt: now })]} namesRuns onSelectAgent={vi.fn()} />)
    expect(screen.getByText('Cart page')).toBeTruthy()
    expect(screen.queryByText('working on named')).toBeNull()
    expect(screen.getByText('Naming this session')).toBeTruthy()
    expect(screen.queryByText('working on new')).toBeNull()
    expect(screen.getByText('working on command')).toBeTruthy()
  })
})

describe('Agents (#1648)', () => {
  test('a run on another computer says which; this computer\'s own does not', () => {
    render(<Agents loaded working={[active('theirs', { computer: { name: 'rom-thinkpad-x280' } }), active('mine')]} namesRuns onSelectAgent={vi.fn()} />)
    expect(screen.getByText('on rom-thinkpad-x280')).toBeTruthy()
    expect(screen.getAllByText(/^on /)).toHaveLength(1)
    // A computer whose kind is not known is drawn a laptop; a server as a server.
    expect(document.querySelector('.lucide-laptop')).toBeTruthy()
    cleanup()
    render(<Agents loaded working={[active('sent', { computer: { name: 'Droplet', kind: 'server' } })]} namesRuns onSelectAgent={vi.fn()} />)
    expect(screen.getByText('on Droplet')).toBeTruthy()
    expect(document.querySelector('.lucide-server')).toBeTruthy()
  })
})

test('says it is loading until the agents are read, then that none is at work', () => {
  const { rerender } = render(<Agents working={[]} loaded={false} namesRuns onSelectAgent={vi.fn()} />)
  expect(screen.getByText('Loading…')).toBeTruthy()
  expect(screen.queryByText('No agent is at work.')).toBeNull()
  rerender(<Agents working={[]} loaded namesRuns onSelectAgent={vi.fn()} />)
  expect(screen.getByText('No agent is at work.')).toBeTruthy()
  expect(screen.queryByText('Loading…')).toBeNull()
})
