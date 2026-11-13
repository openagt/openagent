import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { forgetRemembered } from '../lib/use-async.js'

const onAgentsList = vi.hoisted(() => vi.fn())
vi.mock('../rpc/agents.js', () => ({ onAgentsList }))

const { YourAgentsTile } = await import('./YourAgentsTile.js')

afterEach(() => {
  cleanup()
  forgetRemembered()
  window.history.pushState(null, '', '/')
})

describe('the Your agents tile', () => {
  test('how many agents, by name, and their page a press away', async () => {
    onAgentsList.mockResolvedValue({ agents: [{ id: 'default', name: 'Default' }, { id: 'reviewer', name: 'Reviewer' }], skills: [], claude: [], codex: [] })
    render(<YourAgentsTile />)
    expect(await screen.findByText('Default, Reviewer')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Your agents/ }).getAttribute('href')).toBe('/agents')
    fireEvent.click(screen.getByRole('link', { name: /Your agents/ }))
    expect(window.location.pathname).toBe('/agents')
  })

  test('no count before the list is read', async () => {
    onAgentsList.mockReturnValue(new Promise(() => {}))
    render(<YourAgentsTile />)
    expect(screen.getByRole('link', { name: /Your agents/ }).textContent).toBe('Your agents\u00a0Loading…')
  })
})
