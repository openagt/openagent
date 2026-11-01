import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ModuleHostContext, forgetRemembered, type ModuleCommandResult, type ModuleHost } from '@openagt/dashboard/module'
import { AccountsCard } from './AccountsCard.js'

const HOUR = 3_600_000

type Agents = { claude: unknown[]; codex: unknown[] }

function renderCard(list: (args: string[]) => ModuleCommandResult, usage: Agents | Promise<Agents> = { claude: [], codex: [] }) {
  const runComputerCommand = vi.fn(async (args: string[]): Promise<ModuleCommandResult> => (args[0] === 'usage' ? { ok: true, output: await usage } : list(args)))
  const host: Pick<ModuleHost, 'package' | 'runCommand' | 'runComputerCommand'> = { package: '@openagt/skill-account-rotation', runCommand: async () => ({ ok: false, error: 'not in a project' }), runComputerCommand }
  render(
    <ModuleHostContext.Provider value={host as ModuleHost}>
      <AccountsCard projects={[]} />
    </ModuleHostContext.Provider>,
  )
  return runComputerCommand
}

/** A card with one account each on a computer where `adding` answers what the test says, recording what was asked. */
function renderAdding(addingNow: () => Record<string, unknown>, more: (args: string[], input: string | undefined) => ModuleCommandResult = () => ({ ok: true, output: {} }), list: Agents = { claude: [{ name: 'This computer', who: 'Ada', own: true }], codex: [] }) {
  const calls: { args: string[]; input: string | undefined }[] = []
  const runComputerCommand = vi.fn(async (args: string[], _command?: string, input?: string): Promise<ModuleCommandResult> => {
    calls.push({ args, input })
    if (args[0] === 'list') return { ok: true, output: list }
    if (args[0] === 'usage') return { ok: true, output: { claude: [], codex: [] } }
    if (args[0] === 'adding') return { ok: true, output: addingNow() }
    return more(args, input)
  })
  const host: Pick<ModuleHost, 'package' | 'runCommand' | 'runComputerCommand'> = { package: '@openagt/skill-account-rotation', runCommand: async () => ({ ok: false, error: 'not in a project' }), runComputerCommand }
  render(
    <ModuleHostContext.Provider value={host as ModuleHost}>
      <AccountsCard projects={[]} />
    </ModuleHostContext.Provider>,
  )
  return calls
}

/** Open an account's row, where what can be done with it is. */
const openRow = async (name: string): Promise<void> => void fireEvent.click(await screen.findByRole('button', { name: `Details of ${name}` }))

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
    const ring = (row: string, label: string): string | null | undefined => within(screen.getByRole('button', { name: `Details of ${row}` })).queryByRole('meter', { name: label })?.getAttribute('aria-valuenow')
    await screen.findByRole('button', { name: 'Details of Ada' })
    await waitFor(() => expect(ring('Ada', 'week')).toBe('61'))
    expect(ring('Ada', '5 h')).toBe('2')
    expect(screen.getByText('limited, free in 3 h')).toBeTruthy()
    expect(ring('Old', '5 h')).toBe('40')
    expect(within(screen.getByRole('region', { name: 'Codex' })).getByRole('meter', { name: 'month' }).getAttribute('aria-valuenow')).toBe('10')
    // Work is at its limit, so Ada is the one runs take.
    expect(within(screen.getByRole('region', { name: 'Claude Code' })).getByText('in use').closest('li')!.textContent).toContain('Ada')
    // A row says where it comes from; its presses are behind it.
    expect(screen.getByRole('button', { name: 'Details of Ada' }).textContent).toContain('login on Mac')
    expect(screen.queryByRole('button', { name: 'Use Spare first' })).toBeNull()
    await openRow('Spare')
    expect(screen.getByText('Not used yet. Next in line.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Use Spare first' })).toBeTruthy()
    await openRow('Old')
    expect(screen.getByText(/^Usage as of /)).toBeTruthy()
    await openRow('Work')
    expect(screen.queryByRole('button', { name: 'Use Work first' })).toBeNull()
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
    expect(screen.queryByRole('meter')).toBeNull()
    answer({ claude: [{ name: 'This computer', windows: [{ window: 'seven_day', percentUsed: 7 }] }], codex: [] })
    expect((await screen.findByRole('meter', { name: 'week' })).getAttribute('aria-valuenow')).toBe('7')
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
    expect(within(screen.getByRole('region', { name: 'Codex' })).queryByText('This computer')).toBeNull()
    expect(screen.getByRole('button', { name: 'Add Codex account' })).toBeTruthy()
  })

  test("calls the person's own login who it is, and the press still names it as the command knows it", async () => {
    const run = renderCard(listed([{ name: 'Work', own: false }, { name: 'This computer', who: 'Ada', own: true }]))
    await openRow('Ada')
    fireEvent.click(screen.getByRole('button', { name: 'Use Ada first' }))
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
    await openRow('Spare')
    fireEvent.click(screen.getByRole('button', { name: 'Use Spare first' }))
    await waitFor(() => expect(run).toHaveBeenCalledWith(['use-first', 'claude', 'Spare']))
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^Details of / })[0]!.getAttribute('aria-label')).toBe('Details of Spare'))
  })

  test("says the command's refusal, of the read and of the press", async () => {
    renderCard(args => (args[0] === 'list' ? { ok: true, output: { claude: [{ name: 'A', own: true }, { name: 'B', own: false }], codex: [] } } : { ok: false, error: 'There is no claude account named B.' }))
    await openRow('B')
    fireEvent.click(screen.getByRole('button', { name: 'Use B first' }))
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
    fireEvent.click(await screen.findByRole('button', { name: 'Add Claude Code account' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Whose account' }), { target: { value: 'Dani' } })
    fireEvent.click(screen.getByRole('button', { name: 'Log in to Claude' }))
    expect(await screen.findByText(/Adding Dani's account: say yes/)).toBeTruthy()
    expect(calls.some(call => call.args.join(' ') === 'add claude Dani')).toBe(true)
    expect(screen.queryByRole('button', { name: 'Add Claude Code account' })).toBeNull()
    const listsBefore = calls.filter(call => call.args[0] === 'list').length
    now = { claude: {}, codex: {} }
    await waitFor(() => expect(screen.queryByText(/Adding Dani's account/)).toBeNull(), { timeout: 5000 })
    await waitFor(() => expect(calls.filter(call => call.args[0] === 'list').length).toBeGreaterThan(listsBefore))
  })

  test("says the command's refusal of a name, and keeps asking", async () => {
    renderAdding(() => ({ claude: {}, codex: {} }), () => ({ ok: false, error: 'There is an account named Dani already.' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Add Claude Code account' }))
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

  test('on a server using a computer\'s logins, adding there is said first, and signing in here is one press further', async () => {
    const calls = renderAdding(() => ({ claude: { noBrowser: true }, codex: { noBrowser: true } }), () => ({ ok: true, output: {} }), { claude: [], codex: [{ name: 'Sam', own: false, from: 'Studio' }] })
    const claude = await screen.findByRole('region', { name: 'Claude Code' })
    await openRow('Sam')
    expect(screen.getByRole('button', { name: 'Details of Sam' }).textContent).toContain('from Studio')
    fireEvent.click(screen.getByRole('button', { name: 'Add Claude Code account' }))
    // No Claude account came from Studio, yet this server uses Studio's logins.
    expect(within(claude).getByText('Easiest: add it on Studio, and it comes here by itself.')).toBeTruthy()
    expect(within(claude).queryByRole('textbox', { name: 'Whose account' })).toBeNull()
    fireEvent.click(within(claude).getByRole('button', { name: 'Sign in here instead' }))
    expect(within(claude).getByText(/press Authorize there.*paste the code/)).toBeTruthy()
    expect(within(claude).queryByText(/Opens this computer's browser/)).toBeNull()
    fireEvent.change(within(claude).getByRole('textbox', { name: 'Whose account' }), { target: { value: 'Dani' } })
    fireEvent.click(within(claude).getByRole('button', { name: 'Log in to Claude' }))
    await waitFor(() => expect(calls.some(call => call.args.join(' ') === 'add claude Dani')).toBe(true))
    // Pressed again, it starts from the easiest way.
    fireEvent.click(await screen.findByRole('button', { name: 'Add Claude Code account' }))
    expect(within(claude).getByText(/^Easiest:/)).toBeTruthy()
    fireEvent.click(within(claude).getByRole('button', { name: 'Cancel' }))
    // A Codex account made there waits for that computer's press: "by itself" would be false.
    const codex = screen.getByRole('region', { name: 'Codex' })
    fireEvent.click(screen.getByRole('button', { name: 'Add Codex account' }))
    expect(within(codex).getByText('Easiest: add it on Studio and press Allow there, and it comes here.')).toBeTruthy()
  })

  test('on a server with no computer\'s logins, signing in here is the only way, in its own words', async () => {
    renderAdding(() => ({ claude: { noBrowser: true }, codex: { noBrowser: true } }))
    fireEvent.click(await screen.findByRole('button', { name: 'Add Codex account' }))
    expect(screen.queryByText(/^Easiest:/)).toBeNull()
    expect(await screen.findByText(/Gives you a code to type at ChatGPT's page/)).toBeTruthy()
  })

  test('an added account has Remove; one a computer would only hand back has none; the press runs the command', async () => {
    const run = renderCard(
      listed([{ name: 'This computer', who: 'Ada', own: true, signedOut: true }, { name: 'Here', own: false }, { name: 'Back', own: false, from: 'Studio', comesBack: true }], [{ name: 'Sam', own: false, from: 'Studio' }]),
    )
    await openRow('Here')
    fireEvent.click(screen.getByRole('button', { name: "Remove Here's account" }))
    expect(screen.getByText(/take it back on claude.ai/)).toBeTruthy()
    expect(run).not.toHaveBeenCalledWith(['remove', 'claude', 'Here'])
    fireEvent.click(within(screen.getByRole('group', { name: "Remove Here's account" })).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(run).toHaveBeenCalledWith(['remove', 'claude', 'Here']))
    await openRow('Back')
    expect(screen.queryByRole('button', { name: "Remove Back's account" })).toBeNull()
    await openRow('Sam')
    fireEvent.click(screen.getByRole('button', { name: "Remove Sam's account" }))
    expect(screen.getByText(/It stays off until you press Allow on Studio\./)).toBeTruthy()
  })

  test('Log out of the person\'s own login first says the terminal goes with it, and only the second press runs it', async () => {
    const run = renderCard(listed([{ name: 'This computer', who: 'Ada', own: true, computer: 'Mac' }, { name: 'Spare', own: false }]))
    await openRow('Ada')
    fireEvent.click(screen.getByRole('button', { name: 'Log out Ada' }))
    const asked = screen.getByRole('group', { name: 'Log out Ada' })
    expect(screen.getByText('Logs Claude Code out on Mac, your terminal too.')).toBeTruthy()
    expect(run).not.toHaveBeenCalledWith(['logout', 'claude'])
    fireEvent.click(within(asked).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('group', { name: 'Log out Ada' })).toBeNull()
    expect(run).not.toHaveBeenCalledWith(['logout', 'claude'])
    fireEvent.click(screen.getByRole('button', { name: 'Log out Ada' }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Log out Ada' })).getByRole('button', { name: 'Log out' }))
    await waitFor(() => expect(run).toHaveBeenCalledWith(['logout', 'claude']))
    expect(screen.queryByRole('button', { name: "Remove Ada's account" })).toBeNull()
  })

  test('no reading has an empty ring with a dash: a row lines up, and claims no number', async () => {
    renderCard(listed([{ name: 'Fresh', own: false }, { name: 'Other', own: false }]))
    await screen.findByRole('button', { name: 'Details of Fresh' })
    await waitFor(() => expect(document.querySelector('.animate-pulse')).toBeNull())
    expect(screen.queryByRole('meter')).toBeNull()
    expect(screen.getByRole('button', { name: 'Details of Fresh' }).textContent).toContain('–')
    expect(screen.getByRole('button', { name: 'Details of Fresh' }).querySelector('[title="Not used yet"]')).toBeTruthy()
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
