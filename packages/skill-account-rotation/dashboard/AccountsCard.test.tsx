import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SkillHostContext, forgetRemembered, type ModuleCommandResult, type SkillHost } from '@openagt/skill-ui/module'
import { AccountsCard } from './AccountsCard.js'

const HOUR = 3_600_000

function renderCard(run: (args: string[]) => ModuleCommandResult) {
  const runComputerCommand = vi.fn(async (args: string[]) => run(args))
  const host: SkillHost = { package: '@openagt/skill-account-rotation', runCommand: async () => ({ ok: false, error: 'not in a project' }), runComputerCommand }
  render(
    <SkillHostContext.Provider value={host}>
      <AccountsCard projects={[]} />
    </SkillHostContext.Provider>,
  )
  return runComputerCommand
}

describe('AccountsCard', () => {
  afterEach(() => {
    cleanup()
    forgetRemembered()
    localStorage.clear()
  })

  test('says each account, how full it is and whether it is at its limit, with a press on all but the first', async () => {
    const now = Date.now()
    renderCard(() => ({
      ok: true,
      output: {
        claude: [
          { name: 'Work', own: false, limitedUntil: now + 3 * HOUR },
          { name: 'Mine', own: true, windows: [{ window: 'five_hour', percentUsed: 12, resetsAt: now + HOUR }, { window: 'seven_day', percentUsed: 61, resetsAt: now + 90 * HOUR }] },
          { name: 'Spare', own: false },
        ],
        codex: [{ name: 'This computer', own: true }],
      },
    }))
    expect(await screen.findByText('At its limit, frees in 3 h')).toBeTruthy()
    expect(screen.getByText('61% used, resets in 4 days')).toBeTruthy()
    expect(screen.getByText('No usage seen yet')).toBeTruthy()
    expect(screen.getByText('First')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Use Work first' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Use Spare first' })).toBeTruthy()
    // Codex's own login alone says nothing: this computer may not even have Codex.
    expect(screen.queryByText('Codex')).toBeNull()
  })

  test("calls the person's own login who it is, and the press still names it as the command knows it", async () => {
    const run = renderCard(() => ({ ok: true, output: { claude: [{ name: 'Work', own: false }, { name: 'This computer', who: 'Ada', own: true }], codex: [] } }))
    fireEvent.click(await screen.findByRole('button', { name: 'Use Ada first' }))
    expect(screen.queryByText('This computer')).toBeNull()
    await waitFor(() => expect(run).toHaveBeenCalledWith(['use-first', 'claude', 'This computer']))
  })

  test('a window that has reset says nothing', async () => {
    const now = Date.now()
    renderCard(() => ({ ok: true, output: { claude: [{ name: 'Mine', own: true, windows: [{ window: 'five_hour', percentUsed: 90, resetsAt: now - HOUR }] }], codex: [] } }))
    expect(await screen.findByText('No usage seen yet')).toBeTruthy()
    expect(screen.queryByText(/90%/)).toBeNull()
  })

  test('says so when there is only the own login of each agent', async () => {
    renderCard(() => ({ ok: true, output: { claude: [{ name: 'This computer', own: true }], codex: [{ name: 'This computer', own: true }] } }))
    expect(await screen.findByText("Only this computer's own logins, with no usage seen yet.")).toBeTruthy()
  })

  test('the press runs the command and shows the new order', async () => {
    let first = 'Work'
    const run = renderCard(args => {
      if (args[0] === 'use-first') first = args[2]!
      const accounts = ['Work', 'Spare'].sort(a => (a === first ? -1 : 1)).map(name => ({ name, own: false }))
      return { ok: true, output: { claude: accounts, codex: [] } }
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Use Spare first' }))
    expect(await screen.findByRole('button', { name: 'Use Work first' })).toBeTruthy()
    expect(run).toHaveBeenCalledWith(['use-first', 'claude', 'Spare'])
  })

  test("says the command's refusal, of the read and of the press", async () => {
    renderCard(args => (args[0] === 'list' ? { ok: true, output: { claude: [{ name: 'A', own: true }, { name: 'B', own: false }], codex: [] } } : { ok: false, error: 'There is no claude account named B.' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Use B first' }))
    expect(await screen.findByText('There is no claude account named B.')).toBeTruthy()
    cleanup()
    forgetRemembered()
    localStorage.clear()
    renderCard(() => ({ ok: false, error: 'account-rotation did not answer' }))
    await waitFor(() => expect(screen.getByText('account-rotation did not answer')).toBeTruthy())
  })
})
