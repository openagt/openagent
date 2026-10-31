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

/** A card with one account each on a computer where `adding` answers what the test says, recording what was asked. */
function renderAdding(addingNow: () => Record<string, unknown>, more: (args: string[], input: string | undefined) => ModuleCommandResult = () => ({ ok: true, output: {} })) {
  const calls: { args: string[]; input: string | undefined }[] = []
  const runComputerCommand = vi.fn(async (args: string[], _command?: string, input?: string): Promise<ModuleCommandResult> => {
    calls.push({ args, input })
    if (args[0] === 'list') return { ok: true, output: { claude: [{ name: 'This computer', who: 'Ada', own: true }], codex: [] } }
    if (args[0] === 'usage') return { ok: true, output: { claude: [], codex: [] } }
    if (args[0] === 'adding') return { ok: true, output: addingNow() }
    return more(args, input)
  })
  const host: SkillHost = { package: '@openagt/skill-account-rotation', runCommand: async () => ({ ok: false, error: 'not in a project' }), runComputerCommand }
  render(
    <SkillHostContext.Provider value={host}>
      <AccountsCard projects={[]} />
    </SkillHostContext.Provider>,
  )
  return calls
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

  test('an agent with no login has no row, and still its press: a fresh server adds its first account here', async () => {
    renderCard(listed([{ name: 'This computer', who: 'Ada', own: true }], [{ name: 'This computer', signedOut: true, own: true }]))
    expect(await screen.findByText('Ada')).toBeTruthy()
    const codex = screen.getByRole('region', { name: 'Codex' })
    expect(within(codex).queryByText('This computer')).toBeNull()
    expect(within(codex).getByRole('button', { name: 'Add account' })).toBeTruthy()
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

  test('adding asks whose account it is, starts the sign-in, follows it, and shows the account once it ended', async () => {
    let now: Record<string, unknown> = { claude: {}, codex: {} }
    const calls = renderAdding(() => now, args => {
      if (args[0] === 'add') now = { claude: { adding: { name: 'Dani' } }, codex: {} }
      return { ok: true, output: {} }
    })
    fireEvent.click(within(await screen.findByRole('region', { name: 'Claude Code' })).getByRole('button', { name: 'Add account' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Whose account' }), { target: { value: 'Dani' } })
    fireEvent.click(screen.getByRole('button', { name: 'Log in to Claude' }))
    expect(await screen.findByText(/Adding Dani's account: say yes/)).toBeTruthy()
    expect(calls.some(call => call.args.join(' ') === 'add claude Dani')).toBe(true)
    expect(within(screen.getByRole('region', { name: 'Claude Code' })).queryByRole('button', { name: 'Add account' })).toBeNull()
    const listsBefore = calls.filter(call => call.args[0] === 'list').length
    now = { claude: {}, codex: {} }
    await waitFor(() => expect(screen.queryByText(/Adding Dani's account/)).toBeNull(), { timeout: 5000 })
    await waitFor(() => expect(calls.filter(call => call.args[0] === 'list').length).toBeGreaterThan(listsBefore))
  })

  test("says the command's refusal of a name, and keeps asking", async () => {
    renderAdding(() => ({ claude: {}, codex: {} }), () => ({ ok: false, error: 'There is an account named Dani already.' }))
    fireEvent.click(within(await screen.findByRole('region', { name: 'Claude Code' })).getByRole('button', { name: 'Add account' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Whose account' }), { target: { value: 'Dani' } })
    fireEvent.click(screen.getByRole('button', { name: 'Log in to Claude' }))
    expect(await screen.findByText('There is an account named Dani already.')).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Whose account' })).toBeTruthy()
  })

  test('on a server, Claude: the page to open, and the code goes to the command on standard input, never among its arguments', async () => {
    const calls = renderAdding(() => ({ claude: { adding: { name: 'Dani', url: 'https://claude.example/sign-in', paste: true } }, codex: {} }))
    const link = await screen.findByRole('link', { name: /Open Claude and press Authorize/ })
    expect(link.getAttribute('href')).toBe('https://claude.example/sign-in')
    fireEvent.change(screen.getByRole('textbox', { name: 'Code from Claude' }), { target: { value: 'the-code' } })
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(calls.find(call => call.args[0] === 'add-code')).toEqual({ args: ['add-code', 'claude'], input: 'the-code' }))
  })

  test('Done says the code is being checked, and a code Claude did not take is said, with the box ready for another', async () => {
    let now: Record<string, unknown> = { claude: { adding: { name: 'Dani', url: 'https://claude.example/sign-in', paste: true, checking: true } }, codex: {} }
    renderAdding(() => now)
    const checking = await screen.findByRole('button', { name: 'Checking…' })
    expect((checking as HTMLButtonElement).disabled).toBe(true)
    cleanup()
    forgetRemembered()
    now = { claude: { adding: { name: 'Dani', url: 'https://claude.example/sign-in', paste: true, refused: true } }, codex: {} }
    renderAdding(() => now)
    expect(await screen.findByText(/Claude didn't take that code/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy()
  })

  test('on a server, Codex: the code to type, and where', async () => {
    renderAdding(() => ({ claude: { adding: { name: 'Dani', url: 'https://auth.example/device', code: 'ABCD-1234' } }, codex: {} }))
    expect(await screen.findByText('ABCD-1234')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'auth.example/device' })).toBeTruthy()
  })

  test('Cancel stops the sign-in, and why the last one did not go through is said', async () => {
    const calls = renderAdding(() => ({ claude: { adding: { name: 'Dani' } }, codex: {} }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(calls.some(call => call.args.join(' ') === 'add-cancel claude')).toBe(true))
    cleanup()
    forgetRemembered()
    localStorage.clear()
    renderAdding(() => ({ claude: { failed: 'Nobody signed in in time.' }, codex: {} }))
    expect(await screen.findByText('Nobody signed in in time.')).toBeTruthy()
  })

  test('what adding answers is never kept in the browser: it may hold a page to sign in at', async () => {
    renderAdding(() => ({ claude: { adding: { name: 'Dani', url: 'https://claude.example/secret-sign-in', paste: true } }, codex: {} }))
    await screen.findByRole('link', { name: /Open Claude/ })
    expect(JSON.stringify({ ...localStorage })).not.toContain('secret-sign-in')
  })
})
