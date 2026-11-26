import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { forgetRemembered, type ModuleCommandResult } from '@openagt/ui/module'
import { fakeHost, renderWithHost } from '@openagt/ui/module/testing'
import { AccountsCard, ConnectAgent, OverviewAccounts } from './AccountsCard.js'

const HOUR = 3_600_000

type Agents = { claude: unknown[]; codex: unknown[] }

/**
 * The card on a host whose server part and command answer by their words, a read by its name: the
 * card reads through the one, in no project, and changes the accounts through the other. What it
 * ran through the command is answered.
 */
function hostFor(answer: (args: string[], input?: string) => Promise<ModuleCommandResult>) {
  const runComputerCommand = vi.fn(async (args: string[], _command?: string, input?: string) => answer(args, input))
  // What each agent needs to run here, read by an agent's row with no account: every agent can run, unless the test answers `states` itself.
  const callComputer = vi.fn(async (name: string, _input: object) => (name === 'states' ? answer([name]).then(said => (said.ok && Array.isArray(said.output) ? said : { ok: true as const, output: [] })) : answer([name])))
  return { host: fakeHost('@openagt/agent-driver', { runComputerCommand, callComputer }), runComputerCommand, callComputer }
}

function renderCard(list: (args: string[]) => ModuleCommandResult, usage: Agents | Promise<Agents> = { claude: [], codex: [] }) {
  const { host, runComputerCommand } = hostFor(async args => (args[0] === 'usage' ? { ok: true, output: await usage } : list(args)))
  renderWithHost(<AccountsCard />, host)
  return runComputerCommand
}

/** A card with one account each on a computer where `adding` answers what the test says, recording what was asked. */
function renderAdding(addingNow: () => Record<string, unknown>, more: (args: string[], input: string | undefined) => ModuleCommandResult = () => ({ ok: true, output: {} }), list: Agents = { claude: [{ name: 'This computer', who: 'Ada', own: true }], codex: [] }) {
  const calls: { args: string[]; input: string | undefined }[] = []
  const { host } = hostFor(async (args, input) => {
    calls.push({ args, input })
    if (args[0] === 'list') return { ok: true, output: list }
    if (args[0] === 'usage') return { ok: true, output: { claude: [], codex: [] } }
    if (args[0] === 'adding') return { ok: true, output: addingNow() }
    return more(args, input)
  })
  renderWithHost(<AccountsCard />, host)
  return calls
}

/** Press "Add" at the card's title and pick the agent the account is for: its dialog opens, named for the account. */
const add = async (agent: 'Claude Code' | 'Codex'): Promise<HTMLElement> => {
  const trigger = await screen.findByRole('button', { name: 'Add an account' })
  await waitFor(() => {
    if (trigger.getAttribute('aria-expanded') !== 'true') fireEvent.click(trigger)
    if (trigger.getAttribute('aria-expanded') !== 'true') throw new Error('the menu did not open')
  })
  fireEvent.click(await screen.findByRole('menuitem', { name: agent === 'Claude Code' ? 'Add a Claude account' : 'Add a Codex account' }))
  return await screen.findByRole('dialog', { name: agent === 'Claude Code' ? 'Add a Claude account' : 'Add a Codex account' })
}

/** Open an account's row, where what can be done with it is. */
const openRow = async (name: string): Promise<void> => void fireEvent.click(await screen.findByRole('button', { name: `Details of ${name}` }))

const listed = (claude: unknown[], codex: unknown[] = []) => (): ModuleCommandResult => ({ ok: true, output: { claude, codex } })

describe('AccountsCard', () => {
  test('with one account an agent, nothing rotates: no word of what happens at a limit', async () => {
    renderCard(listed([{ name: 'This computer', who: 'Ada', own: true }], [{ name: 'This computer', who: 'Ada C', own: true }]))
    await screen.findByRole('button', { name: 'Details of Ada' })
    expect(screen.queryByRole('button', { name: "What happens at an account's limit" })).toBeNull()
  })

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
    // What the card does with the accounts, said by the card itself: behind an ⓘ, as an agent here has more than one.
    expect(await screen.findByText('Coding agent accounts')).toBeTruthy()
    expect(await screen.findByRole('button', { name: "What happens at an account's limit" })).toBeTruthy()
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
    renderCard(listed([{ name: 'This computer', who: 'Ada', own: true }]))
    expect(await screen.findByText('Ada')).toBeTruthy()
    await waitFor(() => expect(Object.keys(localStorage).some(key => key.includes('account-rotation:list'))).toBe(true))
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

  test('an agent with no account keeps its place on the card, as a row that adds one; "Add", at the card\u2019s title, lists both agents', async () => {
    renderCard(listed([{ name: 'This computer', who: 'Ada', own: true }], [{ name: 'This computer', signedOut: true, own: true }]))
    expect(await screen.findByText('Ada')).toBeTruthy()
    const codex = screen.getByRole('region', { name: 'Codex' })
    expect(codex.textContent).toContain('No account')
    // An agent has an account already: this press is not the page's primary.
    expect(within(codex).getByRole('button', { name: 'Add a Codex account' }).textContent).toBe('Add account')
    expect(within(codex).queryByRole('button', { name: /^Details of/ })).toBeNull()
    expect(await add('Codex')).toBeTruthy()
  })

  test('no account at all, a fresh server: a row an agent, each with its press that opens its dialog, and "Add" at the title as with accounts there', async () => {
    renderCard(listed([{ name: 'This computer', signedOut: true, own: true }], []))
    const claude = await screen.findByRole('region', { name: 'Claude Code' })
    const codex = screen.getByRole('region', { name: 'Codex' })
    expect([claude.textContent, codex.textContent]).toEqual(['Claude CodeNo accountAdd account', 'CodexNo accountAdd account'])
    expect(screen.getByRole('button', { name: 'Add an account' })).toBeTruthy()
    fireEvent.click(within(codex).getByRole('button', { name: 'Add a Codex account' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add a Codex account' })
    expect(within(dialog).getByRole('textbox', { name: 'Whose account' })).toBeTruthy()
    // The other way is said in the window, not on the page.
    expect(dialog.textContent).toContain('Or in a terminal: codex login')
    expect(codex.textContent).not.toContain('codex login')
  })

  test("with no account at all the first agent's press is the page's primary on the Permissions page, and no press is on the Overview, where the page has its own", async () => {
    renderCard(listed([], []))
    const claude = await screen.findByRole('button', { name: 'Add a Claude account' })
    const codex = screen.getByRole('button', { name: 'Add a Codex account' })
    expect(claude.className).not.toBe(codex.className)
    cleanup()
    forgetRemembered()
    localStorage.clear()
    const { host } = hostFor(async args => ({ ok: true, output: args[0] === 'adding' ? {} : { claude: [], codex: [] } }))
    renderWithHost(<OverviewAccounts />, host)
    const quietClaude = await screen.findByRole('button', { name: 'Add a Claude account' })
    expect(quietClaude.className).toBe(screen.getByRole('button', { name: 'Add a Codex account' }).className)
  })

  test('an agent whose program is not installed is offered no Add: its row says so, and with none installed there is no "Add" at the title', async () => {
    renderCard(() => ({ ok: true, output: { claude: [{ name: 'This computer', who: 'Ada', own: true }], codex: [{ name: 'This computer', signedOut: true, own: true }], notInstalled: ['codex'] } }))
    const trigger = await screen.findByRole('button', { name: 'Add an account' })
    await waitFor(() => {
      if (trigger.getAttribute('aria-expanded') !== 'true') fireEvent.click(trigger)
      if (trigger.getAttribute('aria-expanded') !== 'true') throw new Error('the menu did not open')
    })
    expect(await screen.findByRole('menuitem', { name: 'Add a Claude account' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'Add a Codex account' })).toBeNull()
    expect(screen.getByRole('region', { name: 'Codex', hidden: true }).textContent).toContain('Not installed')
    cleanup()
    forgetRemembered()
    localStorage.clear()
    renderCard(() => ({ ok: true, output: { claude: [{ name: 'This computer', signedOut: true, own: true }], codex: [{ name: 'This computer', signedOut: true, own: true }], notInstalled: ['claude', 'codex'] } }))
    expect((await screen.findByRole('region', { name: 'Claude Code' })).textContent).toContain('Not installed')
    expect(screen.queryByRole('button', { name: /^Add a/ })).toBeNull()
  })

  test('closing the dialog gives the focus back to the press that opened it', async () => {
    renderCard(listed([{ name: 'This computer', signedOut: true, own: true }], []))
    const press = await screen.findByRole('button', { name: 'Add a Claude account' })
    press.focus()
    fireEvent.click(press)
    const dialog = await screen.findByRole('dialog', { name: 'Add a Claude account' })
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('textbox', { name: 'Whose account' })))
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(press))
  })

  test('closing the dialog opened from the "Add" menu gives the focus back to "Add"', async () => {
    renderAdding(() => ({ claude: {}, codex: {} }))
    const dialog = await add('Claude Code')
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('textbox', { name: 'Whose account' })))
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add an account' })))
  })

  test("calls the person's own login who it is, and the press still names it as the command knows it", async () => {
    const run = renderCard(listed([{ name: 'Work', own: false }, { name: 'This computer', who: 'Ada', own: true }]))
    await openRow('Ada')
    fireEvent.click(screen.getByRole('button', { name: 'Use Ada first' }))
    expect(screen.queryByText('This computer')).toBeNull()
    await waitFor(() => expect(run).toHaveBeenCalledWith(['use-first', 'claude', 'This computer'], 'account-rotation'))
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
    await waitFor(() => expect(run).toHaveBeenCalledWith(['use-first', 'claude', 'Spare'], 'account-rotation'))
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
    const dialog = await add('Claude Code')
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Whose account' }), { target: { value: 'Dani' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Log in to Claude' }))
    // The sign-in is followed in the dialog, not in the card behind it.
    expect(await within(dialog).findByText(/Adding Dani's account: say yes/)).toBeTruthy()
    expect(calls.some(call => call.args.join(' ') === 'add claude Dani')).toBe(true)
    const listsBefore = calls.filter(call => call.args[0] === 'list').length
    now = { claude: {}, codex: {} }
    // The account is there: the dialog closes by itself, and nothing is given up.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 5000 })
    await waitFor(() => expect(calls.filter(call => call.args[0] === 'list').length).toBeGreaterThan(listsBefore))
    expect(calls.some(call => call.args[0] === 'add-cancel')).toBe(false)
  })

  test('once the sign-in ended, the dialog closes without drawing its form again', async () => {
    let now: Record<string, unknown> = { claude: {}, codex: {} }
    renderAdding(() => now, args => {
      if (args[0] === 'add') now = { claude: { adding: { name: 'Dani' } }, codex: {} }
      return { ok: true, output: {} }
    })
    const dialog = await add('Claude Code')
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Whose account' }), { target: { value: 'Dani' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Log in to Claude' }))
    expect(await within(dialog).findByText(/Adding Dani's account: say yes/)).toBeTruthy()
    const drawn: Node[] = []
    const watch = new MutationObserver(records => drawn.push(...records.flatMap(record => [...record.addedNodes])))
    watch.observe(document.body, { childList: true, subtree: true })
    now = { claude: {}, codex: {} }
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 5000 })
    watch.disconnect()
    expect(drawn.some(node => node instanceof Element && (node.matches('input[name="account-name"]') || node.querySelector('input[name="account-name"]') !== null))).toBe(false)
  })

  test('the press stays busy from the press until a read shows the sign-in under way', async () => {
    let now: Record<string, unknown> = { claude: {}, codex: {} }
    renderAdding(() => now)
    const dialog = await add('Claude Code')
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Whose account' }), { target: { value: 'Dani' } })
    const press = within(dialog).getByRole('button', { name: 'Log in to Claude' }) as HTMLButtonElement
    fireEvent.click(press)
    // The command answered, and the read after it does not show the sign-in yet.
    await waitFor(() => expect(press.disabled).toBe(true))
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(press.disabled).toBe(true)
    now = { claude: { adding: { name: 'Dani' } }, codex: {} }
    expect(await within(dialog).findByText(/Adding Dani's account/, undefined, { timeout: 5000 })).toBeTruthy()
  })

  test('a sign-in that does not go through keeps the dialog open with why, and asks again; closed, the card does not say it a second time', async () => {
    let now: Record<string, unknown> = { claude: {}, codex: {} }
    const calls = renderAdding(() => now, args => {
      if (args[0] === 'add') now = { claude: { adding: { name: 'Dani' } }, codex: {} }
      return { ok: true, output: {} }
    })
    const dialog = await add('Claude Code')
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Whose account' }), { target: { value: 'Dani' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Log in to Claude' }))
    expect(await within(dialog).findByText(/Adding Dani's account/)).toBeTruthy()
    now = { claude: { failed: 'Nobody signed in in time.' }, codex: {} }
    expect((await within(dialog).findByRole('alert', undefined, { timeout: 5000 })).textContent).toBe('Nobody signed in in time.')
    expect(within(dialog).getByRole('textbox', { name: 'Whose account' })).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.queryByRole('alert')).toBeNull()
    // Said in the dialog, it is forgotten by the command too: no other card or page says it again.
    await waitFor(() => expect(calls.some(call => call.args.join(' ') === 'add-cancel claude')).toBe(true))
    // Opened again, the old failure is not said: it is a new try.
    expect(within(await add('Claude Code')).queryByRole('alert')).toBeNull()
  }, 15_000)

  test('a sign-in that fails again with the same words gives the press back, saying why', async () => {
    // Each read a new answer, as one over the wire is. Started, the sign-in is under way; it fails before any read sees it, as the last one did.
    renderAdding(() => ({ claude: { failed: 'The sign-in service is not answering.' }, codex: {} }), args => (args[0] === 'add' ? { ok: true, output: { adding: { name: 'Dani' } } } : { ok: true, output: {} }))
    const dialog = await add('Claude Code')
    expect((await within(dialog).findByRole('alert')).textContent).toBe('The sign-in service is not answering.')
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Whose account' }), { target: { value: 'Dani' } })
    const press = within(dialog).getByRole('button', { name: 'Log in to Claude' }) as HTMLButtonElement
    fireEvent.click(press)
    await waitFor(() => expect(press.disabled).toBe(true))
    await waitFor(() => expect(press.disabled).toBe(false), { timeout: 5000 })
    expect(within(dialog).getByRole('alert').textContent).toBe('The sign-in service is not answering.')
  })

  test('a retry stays busy until its own command answers, though a read of the last failure lands meanwhile', async () => {
    let now: Record<string, unknown> = { claude: {}, codex: {} }
    let reads = 0
    let adds = 0
    let answer: ((done: ModuleCommandResult) => void) | undefined
    const { host } = hostFor(async (args): Promise<ModuleCommandResult> => {
      if (args[0] === 'list') return { ok: true, output: { claude: [{ name: 'This computer', who: 'Ada', own: true }], codex: [] } }
      if (args[0] === 'usage') return { ok: true, output: { claude: [], codex: [] } }
      // Each read a new answer, as one over the wire is.
      if (args[0] === 'adding') {
        reads++
        return { ok: true, output: structuredClone(now) }
      }
      if (args[0] !== 'add') return { ok: true, output: {} }
      if (++adds === 1) {
        now = { claude: { adding: { name: 'Dani' } }, codex: {} }
        return { ok: true, output: now['claude'] }
      }
      // The second try's command is slow to answer.
      return new Promise(resolve => (answer = resolve))
    })
    renderWithHost(<AccountsCard />, host)
    const dialog = await add('Claude Code')
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Whose account' }), { target: { value: 'Dani' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Log in to Claude' }))
    await within(dialog).findByText(/Adding Dani's account/)
    now = { claude: { failed: 'Nobody signed in in time.' }, codex: {} }
    expect((await within(dialog).findByRole('alert', undefined, { timeout: 5000 })).textContent).toBe('Nobody signed in in time.')
    const press = within(dialog).getByRole('button', { name: 'Log in to Claude' }) as HTMLButtonElement
    fireEvent.click(press)
    await waitFor(() => expect(adds).toBe(2))
    expect(press.disabled).toBe(true)
    // The tab is shown again, and reads the last try's failure once more.
    const before = reads
    fireEvent(document, new Event('visibilitychange'))
    await waitFor(() => expect(reads).toBeGreaterThan(before))
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(press.disabled).toBe(true)
    answer?.({ ok: false, error: 'Cancelled.' })
  }, 15_000)

  test("says the command's refusal of a name, and keeps asking", async () => {
    renderAdding(() => ({ claude: {}, codex: {} }), () => ({ ok: false, error: 'There is an account named Dani already.' }))
    await add('Claude Code')
    fireEvent.change(screen.getByRole('textbox', { name: 'Whose account' }), { target: { value: 'Dani' } })
    fireEvent.click(screen.getByRole('button', { name: 'Log in to Claude' }))
    expect(await screen.findByText('There is an account named Dani already.')).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Whose account' })).toBeTruthy()
  })

  test('with no browser here, Claude: the page to open, and the code goes to the command on standard input, never among its arguments', async () => {
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

  test('with no browser here, Codex: the code to type, and where', async () => {
    renderAdding(() => ({ claude: { adding: { name: 'Dani', url: 'https://auth.example/device', code: 'ABCD-1234' } }, codex: {} }))
    expect(await screen.findByText('ABCD-1234')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'auth.example/device' })).toBeTruthy()
  })

  test('with no browser here, signing in is said in its own words', async () => {
    renderAdding(() => ({ claude: { noBrowser: true }, codex: { noBrowser: true } }))
    await add('Codex')
    expect(await screen.findByText(/Gives you a code to type at ChatGPT's page/)).toBeTruthy()
  })

  test('an added account has Remove, and the press runs the command', async () => {
    const run = renderCard(listed([{ name: 'This computer', who: 'Ada', own: true, signedOut: true }, { name: 'Here', own: false }]))
    await openRow('Here')
    fireEvent.click(screen.getByRole('button', { name: "Remove Here's account" }))
    expect(screen.getAllByText(/its login is taken off this computer/).length).toBeGreaterThan(0)
    expect(run).not.toHaveBeenCalledWith(['remove', 'claude', 'Here'], 'account-rotation')
    fireEvent.click(within(screen.getByRole('group', { name: "Remove Here's account" })).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(run).toHaveBeenCalledWith(['remove', 'claude', 'Here'], 'account-rotation'))
  })

  test('Log out of the person\'s own login first says the terminal goes with it, and only the second press runs it', async () => {
    const run = renderCard(listed([{ name: 'This computer', who: 'Ada', own: true, computer: 'Mac' }, { name: 'Spare', own: false }]))
    await openRow('Ada')
    fireEvent.click(screen.getByRole('button', { name: 'Log out Ada' }))
    const asked = screen.getByRole('group', { name: 'Log out Ada' })
    expect(screen.getByText('Logs Claude Code out on Mac, your terminal too.')).toBeTruthy()
    expect(run).not.toHaveBeenCalledWith(['logout', 'claude'], 'account-rotation')
    fireEvent.click(within(asked).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('group', { name: 'Log out Ada' })).toBeNull()
    expect(run).not.toHaveBeenCalledWith(['logout', 'claude'], 'account-rotation')
    fireEvent.click(screen.getByRole('button', { name: 'Log out Ada' }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Log out Ada' })).getByRole('button', { name: 'Log out' }))
    await waitFor(() => expect(run).toHaveBeenCalledWith(['logout', 'claude'], 'account-rotation'))
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

  test('a sign-in found under way opens its dialog; Cancel stops it; why one did not go through while nobody watched is said in the card', async () => {
    const calls = renderAdding(() => ({ claude: { adding: { name: 'Dani' } }, codex: {} }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Add a Claude account' })).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(calls.some(call => call.args.join(' ') === 'add-cancel claude')).toBe(true))
    cleanup()
    forgetRemembered()
    localStorage.clear()
    renderAdding(() => ({ claude: { failed: 'Nobody signed in in time.' }, codex: {} }))
    expect((await screen.findByRole('alert')).textContent).toBe('Claude Code: Nobody signed in in time.')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  test('what adding answers is never kept in the browser: it may hold a page to sign in at', async () => {
    renderAdding(() => ({ claude: { adding: { name: 'Dani', url: 'https://claude.example/secret-sign-in', paste: true } }, codex: {} }))
    await screen.findByRole('link', { name: /Open Claude/ })
    expect(JSON.stringify({ ...localStorage })).not.toContain('secret-sign-in')
  })
})

describe('ConnectAgent', () => {
  afterEach(() => {
    cleanup()
    forgetRemembered()
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  /** The dashboard's own read of the person answers `name`. */
  const personIs = (name: string): void => {
    vi.stubGlobal('fetch', async (url: string) => new Response(JSON.stringify(url.endsWith('/onPerson') ? { ret: { name } } : { error: 'not here' }), { status: url.endsWith('/onPerson') ? 200 : 404 }))
  }

  test("the press is named for its agent and opens the window an account is added in, the person's own name in its field: one press starts the sign-in", async () => {
    personIs('Ada Lovelace')
    const calls: string[][] = []
    const { host } = hostFor(async args => {
      calls.push(args)
      return { ok: true, output: {} }
    })
    const onConnected = vi.fn()
    renderWithHost(<ConnectAgent agent="claude" primary onConnected={onConnected} />, host)
    const press = await screen.findByRole('button', { name: 'Connect Claude Code' })
    expect(press.textContent).toBe('Claude')
    // The person is read before the window opens: the field opens with their name.
    await new Promise(resolve => setTimeout(resolve, 0))
    fireEvent.click(press)
    const dialog = await screen.findByRole('dialog', { name: 'Add a Claude account' })
    expect((within(dialog).getByRole('textbox', { name: 'Whose account' }) as HTMLInputElement).value).toBe('Ada')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Log in to Claude' }))
    await waitFor(() => expect(calls).toContainEqual(['add', 'claude', 'Ada']))
  })

  test("the card's own window leaves the field empty where an account of the agent already goes by the person's name", async () => {
    personIs('Ada Lovelace')
    renderCard(listed([{ name: 'This computer', who: 'Ada', own: true }]))
    await new Promise(resolve => setTimeout(resolve, 0))
    const dialog = await add('Claude Code')
    expect((within(dialog).getByRole('textbox', { name: 'Whose account' }) as HTMLInputElement).value).toBe('')
    cleanup()
    const codex = await (async () => {
      renderCard(listed([{ name: 'This computer', who: 'Ada', own: true }]))
      await new Promise(resolve => setTimeout(resolve, 0))
      return add('Codex')
    })()
    expect((within(codex).getByRole('textbox', { name: 'Whose account' }) as HTMLInputElement).value).toBe('Ada')
  })

  test('a sign-in started from the press, beside the card on one page, is followed in its own window: the card opens no second one', async () => {
    let underWay = false
    const { host } = hostFor(async args => {
      if (args[0] === 'list') return { ok: true, output: { claude: [], codex: [] } }
      if (args[0] === 'usage') return { ok: true, output: { claude: [], codex: [] } }
      if (args[0] === 'adding') return { ok: true, output: underWay ? { claude: { adding: { name: 'Ada' } } } : {} }
      if (args[0] === 'add') underWay = true
      return { ok: true, output: {} }
    })
    renderWithHost(
      <>
        <ConnectAgent agent="claude" primary onConnected={() => {}} />
        <AccountsCard />
      </>,
      host,
    )
    await screen.findByRole('region', { name: 'Claude Code' })
    fireEvent.click(screen.getByRole('button', { name: 'Connect Claude Code' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add a Claude account' })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Whose account' }), { target: { value: 'Ada' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Log in to Claude' }))
    await screen.findByText(/Adding Ada's account/)
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })

  test('a sign-in found under way opens no window here: the card does, so one sign-in never opens two', async () => {
    const { host } = hostFor(async args => ({ ok: true, output: args[0] === 'adding' ? { codex: { adding: { name: 'Dani' } } } : {} }))
    renderWithHost(<ConnectAgent agent="codex" primary={false} onConnected={() => {}} />, host)
    await screen.findByRole('button', { name: 'Connect Codex' })
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('an added account signed out', () => {
  test('its row says so, in the warning colour, and opened, Sign in again opens the window named for it, its name in the field: the sign-in is its again', async () => {
    const calls = renderAdding(() => ({ claude: {} }), () => ({ ok: true, output: {} }), { claude: [{ name: 'This computer', who: 'Ada', own: true }, { name: 'Dani', own: false, signedOut: true }], codex: [] })
    const said = await screen.findByText('signed out: sign in again')
    expect(said.className).toContain('text-warning')
    await openRow('Dani')
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to Dani again' }))
    const window = await screen.findByRole('dialog', { name: 'Sign in to Dani again' })
    expect((within(window).getByRole('textbox') as HTMLInputElement).value).toBe('Dani')
    expect(calls.some(call => call.args[0] === 'add')).toBe(false)
  })
})
