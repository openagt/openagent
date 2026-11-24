import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

// The Overview's line for a newer OpenAgent, with the command that updates it.

const agents = vi.hoisted(() => ({ onOpenAgentUpdate: vi.fn() }))
vi.mock('../rpc/agents.js', () => agents)
const { OpenAgentUpdate } = await import('./OpenAgentUpdate.js')

afterEach(() => {
  cleanup()
  agents.onOpenAgentUpdate.mockReset()
})

test('a newer OpenAgent is said with both versions and the command that updates it; none, and nothing is said', async () => {
  agents.onOpenAgentUpdate.mockResolvedValue({ installed: '0.65.0', latest: '0.66.0', command: 'npx @openagt/install@latest' })
  render(<OpenAgentUpdate />)
  expect(await screen.findByText('OpenAgent 0.66.0 is out. This computer runs 0.65.0.')).toBeTruthy()
  expect(screen.getByText('npx @openagt/install@latest')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Copy the command' })).toBeTruthy()
  cleanup()
  agents.onOpenAgentUpdate.mockResolvedValue(null)
  const { container } = render(<OpenAgentUpdate />)
  await waitFor(() => expect(agents.onOpenAgentUpdate).toHaveBeenCalledTimes(2))
  expect(container.textContent).toBe('')
})
