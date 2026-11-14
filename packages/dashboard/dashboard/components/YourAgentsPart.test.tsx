import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { forgetRemembered } from '../lib/use-async.js'

const onAgentsList = vi.hoisted(() => vi.fn())
vi.mock('../rpc/agents.js', () => ({ onAgentsList }))
const openPage = vi.hoisted(() => vi.fn())
vi.mock('../lib/host-services.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/host-services.js')>()
  return { ...actual, INERT_HOST_SERVICES: { ...actual.INERT_HOST_SERVICES, openPage } }
})

const { YourAgentsPart } = await import('./YourAgentsPart.js')

afterEach(() => {
  cleanup()
  forgetRemembered()
})

describe('the Overview line\'s part on the person\'s agents', () => {
  test('how many agents, by name on its hover, and their page a press away', async () => {
    onAgentsList.mockResolvedValue({ agents: [{ id: 'default', name: 'Default' }, { id: 'reviewer', name: 'Reviewer' }], skills: [], claude: [], codex: [] })
    render(<YourAgentsPart />)
    const part = await screen.findByRole('link', { name: '2 agents' })
    expect(part.getAttribute('title')).toBe('Default, Reviewer')
    expect(part.getAttribute('href')).toBe('/agents')
    fireEvent.click(part)
    expect(openPage).toHaveBeenCalledWith('agents')
  })

  test('no count before the list is read', async () => {
    onAgentsList.mockReturnValue(new Promise(() => {}))
    render(<YourAgentsPart />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('Loading…')).toBeTruthy()
  })
})
