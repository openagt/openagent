import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { SkillHostContext, forgetRemembered, type ModuleCommandResult, type SkillHost } from '@openagt/skill-ui/module'
import { AccountsCard } from './AccountsCard.js'

const HOUR = 3_600_000

type Agents = { claude: unknown[]; codex: unknown[] }

function renderCard(list: (args: string[]) => ModuleCommandResult, usage: Agents | Promise<Agents> = { claude: [], codex: [] }) {
  const runComputerCommand = vi.fn(async (args: string[]): Promise<ModuleCommandResult> => (args[0] === 'usage' ? { ok: true, output: await usage } : list(args)))
  const host: SkillHost = { package: '@openagt/skill-account-rotation', runCommand: async () => ({ ok: false, error: 'not in a project' }), runComputerCommand }
  render(
    <SkillHostContext.Provider value={host}>
      <AccountsCard projects={[]} />
    </SkillHostContext.Provider>,
  )
  return runComputerCommand
}

const listed = (claude: unknown[], codex: unknown[] = []) => (): ModuleCommandResult => ({ ok: true, output: { claude, codex } })

describe('AccountsCard', () => {
  afterEach(() => {
    cleanup()
    forgetRemembered()
    localStorage.clear()
  })

  test('says how full each account is as Settings does, by its longest window, with a press on all but the first', async () => {
    renderCard(listed([{ name: 'Work', own: false, limitedUntil: Date.now() + 3 * HOUR }, { name: 'This computer', who: 'Ada', own: true, computer: 'Mac' }, { name: 'Spare', own: false }, { name: 'Old', own: false }], [{ name: 'This computer', who: 'Ada C', own: true }]), {
      claude: [
        { name: 'Work', windows: [{ window: 'five_hour', percentUsed: 100 }] },
        { name: 'This computer', windows: [{ window: 'five_hour', percentUsed: 2 }, { window: 'seven_day', percentUsed: 61 }] },
        { name: 'Spare', windows: [] },
        { name: 'Old', windows: [{ window: 'five_hour', percentUsed: 40 }], at: new Date(2026, 9, 31, 14, 5).getTime() },
      ],
      codex: [{ name: 'This computer', windows: [{ window: 'thirty_day', percentUsed: 10 }] }],
    })
    expect(await screen.findByText('61% this week')).toBeTruthy()
    expect(screen.getByText('limited, free in 3 h')).toBeTruthy()
    expect(screen.getByText('not used yet')).toBeTruthy()
    expect(screen.getByText(/^40% of 5 h · as of /)).toBeTruthy()
    expect(screen.getByText('Codex')).toBeTruthy()
    expect(screen.getByText('10% this month')).toBeTruthy()
    // Work is at its limit, so the next two are the ones runs take.
    expect(within(screen.getByRole('region', { name: 'Claude Code' })).getByText('in use').closest('li')!.textContent).toContain('Ada')
    expect(screen.getByText('next').closest('li')!.textContent).toContain('Spare')
    expect(screen.getByText('login on Mac')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Use Work first' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Use Spare first' })).toBeTruthy()
  })

  test('an answer an earlier version of the card kept in the browser still draws', async () => {
    const first = renderCard(listed([{ name: 'This computer', who: 'Ada', own: true }]))
    expect(await screen.findByText('Ada')).toBeTruthy()
    await waitFor(() => expect(first).toHaveBeenCalledWith(['list']))
    const kept = Object.entries(localStorage).find(([key]) => key.includes('account-rotation:list'))
    expect(kept).toBeTruthy()
    // The shape 0.1.0's card kept: a change of it crashes the card on the next visit, before any read.
    expect(JSON.parse(kept![1] as string).value ?? JSON.parse(kept![1] as string)).toMatchObject({ ok: true, accounts: { claude: [{ name: 'This computer' }] } })
  })

  test('the accounts show at once, and how full they are when that is read', async () => {
    let answer!: (usage: Agents) => void
    renderCard(listed([{ name: 'This computer', who: 'Ada', own: true }]), new Promise<Agents>(resolve => (answer = resolve)))
    expect(await screen.findByText('Ada')).toBeTruthy()
    expect(screen.queryByText(/this week/)).toBeNull()
    answer({ claude: [{ name: 'This computer', windows: [{ window: 'seven_day', percentUsed: 7 }] }], codex: [] })
    expect(await screen.findByText('7% this week')).toBeTruthy()
  })

  test("the person's own login with nothing read says no usage at all, and nothing false", async () => {
    renderCard(listed([{ name: 'This computer', who: 'Ada', own: true }]), { claude: [{ name: 'This computer', windows: [] }], codex: [] })
    expect(await screen.findByText('Ada')).toBeTruthy()
    await waitFor(() => expect(document.querySelector('[data-slot="skeleton"], .animate-pulse')).toBeNull())
    expect(screen.queryByText(/used/i)).toBeNull()
  })

  test('one account has no order to say, and a bar only with a reading', async () => {
    renderCard(listed([{ name: 'This computer', who: 'Ada', own: true }]), { claude: [{ name: 'This computer', windows: [] }], codex: [] })
    expect(await screen.findByText('Ada')).toBeTruthy()
    expect(screen.queryByText('in use')).toBeNull()
  })

  test('an agent with no login is left out, and with none at all it says so', async () => {
    renderCard(listed([{ name: 'This computer', who: 'Ada', own: true }], [{ name: 'This computer', signedOut: true, own: true }]))
    expect(await screen.findByText('Ada')).toBeTruthy()
    expect(screen.queryByText('Codex')).toBeNull()
    cleanup()
    forgetRemembered()
    localStorage.clear()
    renderCard(listed([{ name: 'This computer', signedOut: true, own: true }], [{ name: 'This computer', signedOut: true, own: true }]))
    expect(await screen.findByText('No coding agent is logged in on this computer.')).toBeTruthy()
  })

  test("calls the person's own login who it is, and the press still names it as the command knows it", async () => {
    const run = renderCard(listed([{ name: 'Work', own: false }, { name: 'This computer', who: 'Ada', own: true }]))
    fireEvent.click(await screen.findByRole('button', { name: 'Use Ada first' }))
    expect(screen.queryByText('This computer')).toBeNull()
    await waitFor(() => expect(run).toHaveBeenCalledWith(['use-first', 'claude', 'This computer']))
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
