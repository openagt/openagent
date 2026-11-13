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

test('an update that worked says the version it installed, and the old line does not come back while the list is read again', async () => {
  let answer: (value: unknown) => void = () => {}
  models.onAgentUpdates.mockResolvedValueOnce([{ agent: 'codex', installed: '0.144.4', latest: '0.166.0' }]).mockReturnValue(new Promise(resolve => (answer = resolve)))
  models.sendAgentUpdate.mockResolvedValue({ ok: true, version: '0.166.0' })
  models.onModels.mockResolvedValue({ 'claude-code': { models: [] }, codex: { models: [] } })
  render(<AgentUpdates />)
  fireEvent.click(await screen.findByRole('button', { name: 'Update Codex' }))
  expect((await screen.findByRole('status')).textContent).toBe('Codex is now 0.166.0.')
  expect(screen.queryByText(/is out/)).toBeNull()
  answer([])
  await waitFor(() => expect(models.onAgentUpdates).toHaveBeenCalledTimes(2))
  expect(screen.getByRole('status').textContent).toBe('Codex is now 0.166.0.')
})

test('a failed update says what failed and what to do before the program\'s line; the press keeps the focus throughout', async () => {
  models.onAgentUpdates.mockResolvedValue([{ agent: 'claude-code', installed: '2.1.300', latest: '2.1.314' }])
  let fail: (value: unknown) => void = () => {}
  models.sendAgentUpdate.mockReturnValue(new Promise(resolve => (fail = resolve)))
  render(<AgentUpdates />)
  const press = await screen.findByRole('button', { name: 'Update Claude Code' })
  press.focus()
  fireEvent.click(press)
  expect(await screen.findByRole('button', { name: 'Updating…' })).toBe(document.activeElement)
  fail({ ok: false, error: "Error: EACCES: permission denied, mkdir '/usr/lib/node_modules/@anthropic-ai'" })
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toBe("Claude Code could not be updated. Run claude update in a terminal to see why, or try again.Error: EACCES: permission denied, mkdir '/usr/lib/node_modules/@anthropic-ai'")
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Update Claude Code' }))
})

test('once the focused press worked, the focus is on the line that says the version it installed', async () => {
  models.onAgentUpdates.mockResolvedValueOnce([{ agent: 'codex', installed: '0.144.4', latest: '0.166.0' }]).mockResolvedValue([])
  models.sendAgentUpdate.mockResolvedValue({ ok: true, version: '0.166.0' })
  models.onModels.mockResolvedValue({ 'claude-code': { models: [] }, codex: { models: [] } })
  render(<AgentUpdates />)
  const press = await screen.findByRole('button', { name: 'Update Codex' })
  press.focus()
  fireEvent.click(press)
  expect(await screen.findByRole('status')).toBe(document.activeElement)
})

test('a focus put elsewhere while the update runs stays there once it worked', async () => {
  models.onAgentUpdates.mockResolvedValueOnce([{ agent: 'codex', installed: '0.144.4', latest: '0.166.0' }]).mockResolvedValue([])
  let done: (value: unknown) => void = () => {}
  models.sendAgentUpdate.mockReturnValue(new Promise(resolve => (done = resolve)))
  models.onModels.mockResolvedValue({ 'claude-code': { models: [] }, codex: { models: [] } })
  render(
    <>
      <AgentUpdates />
      <button type="button">Elsewhere</button>
    </>,
  )
  const press = await screen.findByRole('button', { name: 'Update Codex' })
  press.focus()
  fireEvent.click(press)
  const elsewhere = screen.getByRole('button', { name: 'Elsewhere' })
  elsewhere.focus()
  done({ ok: true, version: '0.166.0' })
  expect((await screen.findByRole('status')).textContent).toBe('Codex is now 0.166.0.')
  expect(document.activeElement).toBe(elsewhere)
})

test('nothing when every agent is up to date', async () => {
  models.onAgentUpdates.mockResolvedValue([])
  const { container } = render(<AgentUpdates />)
  await waitFor(() => expect(models.onAgentUpdates).toHaveBeenCalled())
  expect(container.textContent).toBe('')
})
