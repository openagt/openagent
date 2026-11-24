import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { forgetRemembered } from '@openagt/ui/module'
import { fakeHost, renderWithHost } from '@openagt/ui/module/testing'
import { AgentUpdates } from './AgentUpdates.js'

// The Overview's notice for a coding agent with a newer version out, and its press.

/** The server part's `updates` and `update`, which the notice reads and presses through. */
const calls = { updates: vi.fn(), update: vi.fn() }

function render(ui: ReactElement) {
  const callComputer = vi.fn(async (name: string, input: object) => {
    if (name === 'updates') return { ok: true as const, output: await calls.updates() }
    if (name === 'update') return { ok: true as const, output: await calls.update(input) }
    return { ok: false as const, error: `no ${name}` }
  })
  return renderWithHost(ui, fakeHost('@openagt/agent-driver', { callComputer }))
}

const CODEX = { agent: 'codex', label: 'Codex', installed: '0.144.4', latest: '0.166.0', command: 'codex update' }
const CLAUDE = { agent: 'claude-code', label: 'Claude Code', installed: '2.1.300', latest: '2.1.314', command: 'claude update' }

afterEach(() => {
  cleanup()
  forgetRemembered()
  for (const fn of Object.values(calls)) fn.mockReset()
})

test('an agent behind is said with both versions; its press runs the update, then the line goes', async () => {
  calls.updates.mockResolvedValueOnce([CODEX]).mockResolvedValue([])
  calls.update.mockResolvedValue({ ok: true, version: '0.166.0' })
  render(<AgentUpdates />)
  expect(await screen.findByText('Codex 0.166.0 is out. This computer has 0.144.4.')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Update Codex' }))
  await waitFor(() => expect(screen.queryByText(/is out/)).toBeNull())
  expect(calls.update).toHaveBeenCalledWith({ agent: 'codex' })
})

test('an update that fails says why, and the line stays', async () => {
  calls.updates.mockResolvedValue([CLAUDE])
  calls.update.mockResolvedValue({ ok: false, error: 'Could not reach the update server' })
  render(<AgentUpdates />)
  fireEvent.click(await screen.findByRole('button', { name: 'Update Claude Code' }))
  expect(await screen.findByText('Could not reach the update server')).toBeTruthy()
  expect(screen.getByText('Claude Code 2.1.314 is out. This computer has 2.1.300.')).toBeTruthy()
})

test('an update that worked says the version it installed, and the old line does not come back while the list is read again', async () => {
  let answer: (value: unknown) => void = () => {}
  calls.updates.mockResolvedValueOnce([CODEX]).mockReturnValue(new Promise(resolve => (answer = resolve)))
  calls.update.mockResolvedValue({ ok: true, version: '0.166.0' })
  render(<AgentUpdates />)
  fireEvent.click(await screen.findByRole('button', { name: 'Update Codex' }))
  expect((await screen.findByRole('status')).textContent).toBe('Codex is now 0.166.0.')
  expect(screen.queryByText(/is out/)).toBeNull()
  answer([])
  await waitFor(() => expect(calls.updates).toHaveBeenCalledTimes(2))
  expect(screen.getByRole('status').textContent).toBe('Codex is now 0.166.0.')
})

test('a failed update says what failed and what to do before the program\'s line; the press keeps the focus throughout', async () => {
  calls.updates.mockResolvedValue([CLAUDE])
  let fail: (value: unknown) => void = () => {}
  calls.update.mockReturnValue(new Promise(resolve => (fail = resolve)))
  render(<AgentUpdates />)
  const press = await screen.findByRole('button', { name: 'Update Claude Code' })
  press.focus()
  fireEvent.click(press)
  expect(await screen.findByRole('button', { name: 'Updating…' })).toBe(document.activeElement)
  fail({ ok: false, error: "Error: EACCES: permission denied, mkdir '/usr/lib/node_modules/@anthropic-ai'" })
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toBe("Claude Code could not be updated. Run this in a terminal to see why, or try again:claude updateError: EACCES: permission denied, mkdir '/usr/lib/node_modules/@anthropic-ai'")
  // The command to run comes with the press that copies it, as every command on the page does.
  expect(within(alert).getByRole('button', { name: 'Copy the command' })).toBeTruthy()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Update Claude Code' }))
})

test('once the focused press worked, the focus is on the line that says the version it installed', async () => {
  calls.updates.mockResolvedValueOnce([CODEX]).mockResolvedValue([])
  calls.update.mockResolvedValue({ ok: true, version: '0.166.0' })
  render(<AgentUpdates />)
  const press = await screen.findByRole('button', { name: 'Update Codex' })
  press.focus()
  fireEvent.click(press)
  expect(await screen.findByRole('status')).toBe(document.activeElement)
})

test('a focus put elsewhere while the update runs stays there once it worked', async () => {
  calls.updates.mockResolvedValueOnce([CODEX]).mockResolvedValue([])
  let done: (value: unknown) => void = () => {}
  calls.update.mockReturnValue(new Promise(resolve => (done = resolve)))
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
  calls.updates.mockResolvedValue([])
  const { container } = render(<AgentUpdates />)
  await waitFor(() => expect(calls.updates).toHaveBeenCalled())
  expect(container.textContent).toBe('')
})

test('an update another tab or computer started says "Updating…" here too, and takes no second press', async () => {
  calls.updates.mockResolvedValue([{ ...CODEX, updating: true }])
  render(<AgentUpdates />)
  const press = await screen.findByRole('button', { name: 'Updating…' })
  fireEvent.click(press)
  expect(calls.update).not.toHaveBeenCalled()
})
