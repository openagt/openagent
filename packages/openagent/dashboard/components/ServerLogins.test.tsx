import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { forgetRemembered } from '../lib/use-async.js'

const accounts = vi.hoisted(() => ({ onAgentAccounts: vi.fn(), sendAddAgentAccount: vi.fn(), sendAgentAccountCode: vi.fn(), sendRemoveAgentAccount: vi.fn(), sendUseAgentAccountFirst: vi.fn() }))
vi.mock('../rpc/accounts.js', () => accounts)
const logins = vi.hoisted(() => ({ onAgentState: vi.fn(), sendAgentFix: vi.fn(), onGitHosts: vi.fn(), sendGitHostInstall: vi.fn(), sendGitHostLogin: vi.fn(), sendUseGitHostAccount: vi.fn(), sendForgetGitHostAccount: vi.fn() }))
vi.mock('../rpc/logins.js', () => logins)
const servers = vi.hoisted(() => ({ onServerLogins: vi.fn(), sendUseLoginsOn: vi.fn(), sendAllowLogins: vi.fn(), sendSettleLogin: vi.fn() }))
vi.mock('../rpc/server-logins.js', () => servers)

const { AccountsSettings } = await import('./Accounts.js')

// Settings › Accounts with a server of the person's that uses this computer's logins: a bar above
// the accounts, a note on each row, and the person's answer for what the server has that they left.
// On the server itself: whose computer's logins it uses, and a login on a device with no browser here.

const NOW = Date.parse('2026-10-24T12:00:00Z')
const ID = 'https://203.0.113.5'
const LABEL = '203.0.113.5'

const own = { id: 'This computer', name: 'Suleiman', own: true, windows: [{ label: 'week', percent: 62 }] }
const dani = { id: 'Dani', name: 'Dani', own: false, added: '2026-10-22T09:00:00Z', windows: [] }

function views(claude: object[], codex: object[] = [], extra: object = {}): void {
  accounts.onAgentAccounts.mockImplementation(async (agent: string) => ({ now: NOW, computer: 'Studio', accounts: agent === 'codex' ? codex : claude, ...extra }))
}

function server(over: object): void {
  servers.onServerLogins.mockResolvedValue({ computer: 'Studio', servers: [{ machineId: ID, label: LABEL, on: true, reachable: true, logins: [], left: [], ...over }] })
}

beforeEach(() => {
  logins.onAgentState.mockImplementation(async (driver: string) => ({ driver, ready: true }))
  logins.onGitHosts.mockResolvedValue({ hosts: [] })
  servers.onServerLogins.mockResolvedValue({ computer: 'Studio', servers: [] })
  for (const fn of [servers.sendUseLoginsOn, servers.sendAllowLogins, servers.sendSettleLogin, accounts.sendAgentAccountCode]) fn.mockResolvedValue({ ok: true })
})

afterEach(() => {
  cleanup()
  forgetRemembered()
  for (const group of [accounts, logins, servers]) for (const fn of Object.values(group)) fn.mockReset()
})

describe('a server that uses this computer\'s logins', () => {
  test('one not told yet is offered them, with one press', async () => {
    views([own])
    server({ on: false })
    render(<AccountsSettings />)
    const bar = await screen.findByRole('region', { name: `Your logins on ${LABEL}` })
    expect(bar.textContent).toContain(`Use your logins on ${LABEL}?`)
    expect(bar.textContent).toContain('its page follows your settings')
    fireEvent.click(within(bar).getByRole('button', { name: 'Use them' }))
    await waitFor(() => expect(servers.sendUseLoginsOn).toHaveBeenCalledWith(ID))
  })

  test('what waits for the press is said in the bar and on its row; what is there is ticked on its row', async () => {
    views([own, dani])
    server({
      logins: [
        { kind: 'claude', source: 'own', name: 'Suleiman', state: 'allow' },
        { kind: 'claude', source: 'Dani', name: 'Dani', state: 'there' },
      ],
    })
    render(<AccountsSettings />)
    const bar = await screen.findByRole('region', { name: `Your logins on ${LABEL}` })
    expect(bar.textContent).toContain(`${LABEL} uses your logins: 1 of 2 there`)
    expect(bar.textContent).toContain('Suleiman needs your yes once')
    const card = screen.getByRole('region', { name: 'Claude Code' })
    await waitFor(() => expect(within(card).getByRole('listitem', { name: 'Suleiman' }).textContent).toContain(`not on ${LABEL} yet`))
    expect(within(card).getByRole('listitem', { name: 'Dani' }).textContent).toContain(`✓ on ${LABEL}`)
    fireEvent.click(within(bar).getByRole('button', { name: 'Allow 1 login' }))
    await waitFor(() => expect(servers.sendAllowLogins).toHaveBeenCalledWith(ID))
  })

  test('one that did not get there is counted out and named in the bar, which points to its row for why: the reason is said once, not in every bar', async () => {
    views([own])
    server({
      logins: [
        { kind: 'claude', source: 'own', name: 'Suleiman', state: 'there' },
        { kind: 'git', host: 'github.com', source: 'octo-agent', name: 'octo-agent', state: 'failed', error: "the login gh keeps for octo-agent is octo's on GitHub" },
      ],
    })
    render(<AccountsSettings />)
    const bar = await screen.findByRole('region', { name: `Your logins on ${LABEL}` })
    expect(bar.textContent).toContain(`${LABEL} uses your logins: 1 of 2 there`)
    expect(bar.textContent).toContain('octo-agent did not get there: see its row below. Tried again every minute.')
    expect(bar.textContent).not.toContain("is octo's on GitHub")
    expect(within(bar).queryByRole('alert')).toBeNull()
  })

  test('on its row, under its name: the servers that have it on one line, and why it is not on the others, once for every server it failed on alike', async () => {
    views([own, dani])
    const reason = 'the login is not one of yours'
    servers.onServerLogins.mockResolvedValue({
      computer: 'Studio',
      servers: ['Box', 'Studio PC'].map(label => ({ machineId: `https://${label}`, label, on: true, reachable: true, left: [], logins: [{ kind: 'claude', source: 'own', name: 'Suleiman', state: 'there' }, { kind: 'claude', source: 'Dani', name: 'Dani', state: 'failed', error: reason }] })),
    })
    render(<AccountsSettings />)
    const card = await screen.findByRole('region', { name: 'Claude Code' })
    await waitFor(() => expect(within(card).getByRole('listitem', { name: 'Suleiman' }).textContent).toContain('✓ on Box · Studio PC'))
    const daniRow = within(card).getByRole('listitem', { name: 'Dani' })
    expect(daniRow.textContent).toContain(`Not on Box · Studio PC: ${reason}`)
    expect(daniRow.textContent!.split(reason)).toHaveLength(2)
  })

  test('a server with all of them there has no bar: the rows say where each is', async () => {
    views([own])
    server({ logins: [{ kind: 'claude', source: 'own', name: 'Suleiman', state: 'there' }] })
    render(<AccountsSettings />)
    const card = await screen.findByRole('region', { name: 'Claude Code' })
    await waitFor(() => expect(within(card).getByRole('listitem', { name: 'Suleiman' }).textContent).toContain(`✓ on ${LABEL}`))
    expect(screen.queryByRole('region', { name: `Your logins on ${LABEL}` })).toBeNull()
  })

  test('while a press starts and ends, the page keeps what it read: the rows and the bar never blank out between two reads', async () => {
    views([own, dani])
    const rows = (suleiman: string) => [{ kind: 'claude', source: 'own', name: 'Suleiman', state: suleiman, anew: true }, { kind: 'claude', source: 'Dani', name: 'Dani', state: 'there' }]
    server({ logins: rows('allow') })
    render(<AccountsSettings />)
    const card = await screen.findByRole('region', { name: 'Claude Code' })
    await waitFor(() => expect(within(card).getByRole('listitem', { name: 'Dani' }).textContent).toContain(`✓ on ${LABEL}`))
    // The press: the server says it is under way, then answers nothing more for a while.
    servers.onServerLogins.mockResolvedValueOnce({ computer: 'Studio', servers: [{ machineId: ID, label: LABEL, on: true, reachable: true, logins: rows('allow'), left: [], allowing: { name: 'Suleiman' } }] })
    fireEvent.click(await screen.findByRole('button', { name: 'Allow 1 login' }))
    servers.onServerLogins.mockReturnValue(new Promise(() => {}))
    expect(await screen.findByText(`Making Suleiman's login for ${LABEL}`)).toBeTruthy()
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(screen.getByText(`Making Suleiman's login for ${LABEL}`)).toBeTruthy()
    expect(within(card).getByRole('listitem', { name: 'Dani' }).textContent).toContain(`✓ on ${LABEL}`)
  })

  test('a login made for the server with a press is taken off there from its row, and waits for the press again; one that goes as it is has no such menu', async () => {
    views([own, dani])
    server({ logins: [{ kind: 'claude', source: 'own', name: 'Suleiman', state: 'there', anew: true }, { kind: 'claude', source: 'Dani', name: 'Dani', state: 'there' }] })
    render(<AccountsSettings />)
    const card = await screen.findByRole('region', { name: 'Claude Code' })
    const trigger = await within(card).findByRole('button', { name: `Suleiman on ${LABEL}` })
    expect(within(card).queryByRole('button', { name: `Dani on ${LABEL}` })).toBeNull()
    expect(within(card).getByRole('listitem', { name: 'Dani' }).textContent).toContain(`✓ on ${LABEL}`)
    server({ logins: [{ kind: 'claude', source: 'own', name: 'Suleiman', state: 'allow', anew: true }, { kind: 'claude', source: 'Dani', name: 'Dani', state: 'there' }] })
    fireEvent.click(trigger)
    fireEvent.click(await screen.findByRole('menuitem', { name: `Take off ${LABEL}` }))
    await waitFor(() => expect(servers.sendSettleLogin).toHaveBeenCalledWith(ID, { kind: 'claude', source: 'own' }, false))
    await waitFor(() => expect(within(card).getByRole('listitem', { name: 'Suleiman' }).textContent).toContain(`not on ${LABEL} yet`))
    expect((await screen.findByRole('region', { name: `Your logins on ${LABEL}` })).textContent).toContain('Allow 1 login')
  })

  test('the login being made says where to say yes, with its link to copy for a private window', async () => {
    views([own])
    server({ logins: [{ kind: 'claude', source: 'own', name: 'Suleiman', state: 'allow' }], allowing: { name: 'Suleiman', url: 'https://claude.com/cai/oauth/authorize?x' } })
    render(<AccountsSettings />)
    const bar = await screen.findByRole('region', { name: `Your logins on ${LABEL}` })
    expect(bar.textContent).toContain(`Making Suleiman's login for ${LABEL}`)
    expect(within(bar).getByRole('button', { name: 'Copy link' })).toBeTruthy()
  })

  test('another account logged in here: the server keeps the one left meanwhile, and the person picks', async () => {
    views([{ ...own, name: 'Work' }])
    server({ logins: [{ kind: 'claude', source: 'own', name: 'Work', state: 'switched', was: 'Suleiman' }] })
    render(<AccountsSettings />)
    const card = await screen.findByRole('region', { name: 'Claude Code' })
    const asked = await within(card).findByText(`${LABEL} still runs on Suleiman, the account you left on Studio.`)
    const notice = asked.parentElement!
    fireEvent.click(within(notice).getByRole('button', { name: 'Keep Suleiman' }))
    await waitFor(() => expect(servers.sendSettleLogin).toHaveBeenCalledWith(ID, { kind: 'claude', source: 'own' }, true))
    fireEvent.click(within(notice).getByRole('button', { name: 'Use Work there' }))
    await waitFor(() => expect(servers.sendAllowLogins).toHaveBeenCalledWith(ID))
  })

  test('one this computer no longer has is kept there, or taken off, on the person\'s word', async () => {
    views([own])
    server({ logins: [{ kind: 'claude', source: 'own', name: 'Suleiman', state: 'there' }], left: [{ kind: 'claude', source: 'Dani', name: 'Dani' }] })
    render(<AccountsSettings />)
    const card = await screen.findByRole('region', { name: 'Claude Code' })
    const asked = await within(card).findByText(`${LABEL} still has Dani, which is no longer on Studio.`)
    fireEvent.click(within(asked.parentElement!).getByRole('button', { name: 'Take it off' }))
    await waitFor(() => expect(servers.sendSettleLogin).toHaveBeenCalledWith(ID, { kind: 'claude', source: 'Dani' }, false))
    fireEvent.click(within(asked.parentElement!).getByRole('button', { name: 'Keep it there' }))
    await waitFor(() => expect(servers.sendSettleLogin).toHaveBeenCalledWith(ID, { kind: 'claude', source: 'Dani' }, true))
  })
})

describe('on the server itself', () => {
  test('it says whose computer\'s logins it uses; their rows say where from and are not removed here; its own login, logged out, has no row', async () => {
    views([{ id: 'Suleiman', name: 'Suleiman', own: false, from: 'Suleimans-MacBook-Pro', windows: [{ label: 'week', percent: 62 }], asOf: NOW - 60_000 }, { id: 'This computer', name: 'Claude login on droplet', own: true, windows: [] }], [], { from: 'Suleimans-MacBook-Pro' })
    logins.onAgentState.mockImplementation(async (driver: string) => ({ driver, ready: true, ...(driver === 'claude-code' ? { ownLoggedOut: true } : {}) }))
    render(<AccountsSettings />)
    expect(await screen.findByText('Your logins and settings from Suleimans-MacBook-Pro')).toBeTruthy()
    const card = screen.getByRole('region', { name: 'Claude Code' })
    const row = await within(card).findByRole('listitem', { name: 'Suleiman' })
    expect(row.textContent).toContain('from Suleimans-MacBook-Pro')
    expect(row.textContent).toContain('62% this week')
    expect(within(row).queryByRole('button', { name: /Remove/ })).toBeNull()
    expect(within(card).queryByRole('listitem', { name: 'Claude login on droplet' })).toBeNull()
  })

  test('with no browser here, Claude\'s page opens on the person\'s device and its code is pasted back; Codex\'s code is typed at its page', async () => {
    views([], [], {})
    accounts.onAgentAccounts.mockImplementation(async (agent: string) => ({
      now: NOW,
      computer: 'droplet',
      accounts: [],
      adding: agent === 'claude' ? { name: 'Dani', url: 'https://claude.com/cai/oauth/authorize?x', paste: true } : { name: 'Dani', url: 'https://auth.openai.com/codex/device', code: 'KQ7M-4XPD' },
    }))
    render(<AccountsSettings />)
    const claude = await screen.findByRole('region', { name: 'Claude Code' })
    const open = await within(claude).findByRole('link', { name: /Open Claude and press Authorize/ })
    expect(open.getAttribute('href')).toBe('https://claude.com/cai/oauth/authorize?x')
    fireEvent.change(within(claude).getByRole('textbox', { name: 'Code from Claude' }), { target: { value: 'abc#def-123' } })
    fireEvent.click(within(claude).getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(accounts.sendAgentAccountCode).toHaveBeenCalledWith('claude', 'abc#def-123'))
    const codex = screen.getByRole('region', { name: 'Codex' })
    expect(within(codex).getByText('KQ7M-4XPD')).toBeTruthy()
    expect(within(codex).getByRole('link').getAttribute('href')).toBe('https://auth.openai.com/codex/device')
  })
})
