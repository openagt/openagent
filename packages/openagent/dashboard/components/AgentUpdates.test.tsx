import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

// The Overview's line for a coding agent with a newer version out, and its press.

const models = vi.hoisted(() => ({ onAgentUpdates: vi.fn(), sendAgentUpdate: vi.fn(), onModels: vi.fn() }))
vi.mock('../rpc/models.js', () => models)
const { AgentUpdates } = await import('./AgentUpdates.js')

afterEach(() => {
  cleanup()
  for (const fn of Object.values(models)) fn.mockReset()
})

test('an agent behind is said with both versions; its press runs the update, then the line goes and its models are asked again', async () => {
  models.onAgentUpdates.mockResolvedValueOnce([{ agent: 'codex', installed: '0.144.4', latest: '0.166.0' }]).mockResolvedValue([])
  models.sendAgentUpdate.mockResolvedValue({ ok: true, version: '0.166.0' })
  models.onModels.mockResolvedValue({ 'claude-code': { models: [] }, codex: { models: [] } })
  render(<AgentUpdates />)
  expect(await screen.findByText('Codex 0.166.0 is out. This computer has 0.144.4.')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Update Codex' }))
  await waitFor(() => expect(screen.queryByText(/is out/)).toBeNull())
  expect(models.sendAgentUpdate).toHaveBeenCalledWith('codex')
  expect(models.onModels).toHaveBeenCalled()
})

test('an update that fails says why, and the line stays', async () => {
  models.onAgentUpdates.mockResolvedValue([{ agent: 'claude-code', installed: '2.1.300', latest: '2.1.314' }])
  models.sendAgentUpdate.mockResolvedValue({ ok: false, error: 'Could not reach the update server' })
  render(<AgentUpdates />)
  fireEvent.click(await screen.findByRole('button', { name: 'Update Claude Code' }))
  expect(await screen.findByText('Could not reach the update server')).toBeTruthy()
  expect(screen.getByText('Claude Code 2.1.314 is out. This computer has 2.1.300.')).toBeTruthy()
  expect(models.onModels).not.toHaveBeenCalled()
})

test('nothing when every agent is up to date', async () => {
  models.onAgentUpdates.mockResolvedValue([])
  const { container } = render(<AgentUpdates />)
  await waitFor(() => expect(models.onAgentUpdates).toHaveBeenCalled())
  expect(container.textContent).toBe('')
})
