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
  updatedAt: '2026-07-25T10:00:00.000Z',
  intent: `working on ${agentId}`,
  ...over,
})

describe('Agents (#1139)', () => {
  test('lists the working sessions under the "currently working" description, with no Current/Recent split', () => {
    render(<Agents working={[active('r1')]} onSelectAgent={vi.fn()} />)
    expect(screen.getByText('Agents currently working')).toBeTruthy()
    expect(screen.getByText('working on r1')).toBeTruthy()
    // The columns are gone: no "Current" eyebrow, and no "Recent" list — the sidebar's session
    // list already carries the finished sessions.
    expect(screen.queryByText('Current')).toBeNull()
    expect(screen.queryByText('Recent')).toBeNull()
  })

  test('clicking a working agent opens that session', () => {
    const onSelectAgent = vi.fn()
    render(<Agents working={[active('r1')]} onSelectAgent={onSelectAgent} />)
    fireEvent.click(screen.getByText('working on r1'))
    // Project *and* run: a project alone would land on the launcher, which is the regression (#1189).
    expect(onSelectAgent).toHaveBeenCalledWith('p1', 'r1')
  })



  test('a working session with no intent still gets a label', () => {
    // ActiveAgent carries no branch or start time to fall back on, so an unlabelled row would be a
    // blank line you cannot tell apart from its neighbours: the scope, else the project, names it.
    render(
      <Agents
        working={[active('r1', { intent: '   ', scope: 'oauth-work' })]}
       
        onSelectAgent={vi.fn()}
      />,
    )
    expect(screen.getByText('oauth-work')).toBeTruthy()
  })
})

describe('Agents (#1648)', () => {
  test('a run on another computer says which; this computer\'s own does not', () => {
    render(<Agents working={[active('theirs', { computer: { name: 'rom-thinkpad-x280' } }), active('mine')]} onSelectAgent={vi.fn()} />)
    expect(screen.getByText('on rom-thinkpad-x280')).toBeTruthy()
    expect(screen.getAllByText(/^on /)).toHaveLength(1)
    // A computer whose kind is not known is drawn a laptop; a server as a server.
    expect(document.querySelector('.lucide-laptop')).toBeTruthy()
    cleanup()
    render(<Agents working={[active('sent', { computer: { name: 'Droplet', kind: 'server' } })]} onSelectAgent={vi.fn()} />)
    expect(screen.getByText('on Droplet')).toBeTruthy()
    expect(document.querySelector('.lucide-server')).toBeTruthy()
  })
})
