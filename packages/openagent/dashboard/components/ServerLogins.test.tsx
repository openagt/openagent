import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { forgetRemembered } from '@openagt/skill-ui/module'

const accounts = vi.hoisted(() => ({ onAgentAccounts: vi.fn() }))
vi.mock('../rpc/accounts.js', () => accounts)
const logins = vi.hoisted(() => ({ onAgentState: vi.fn(), sendAgentFix: vi.fn(), onGitHosts: vi.fn(), sendGitHostInstall: vi.fn(), sendGitHostLogin: vi.fn(), sendUseGitHostAccount: vi.fn(), sendForgetGitHostAccount: vi.fn() }))
vi.mock('../rpc/logins.js', () => logins)
const servers = vi.hoisted(() => ({ onServerLogins: vi.fn(), sendUseLoginsOn: vi.fn(), sendAllowLogins: vi.fn(), sendSettleLogin: vi.fn() }))
vi.mock('../rpc/server-logins.js', () => servers)

const { AccountsSettings } = await import('./Accounts.js')

// Settings › Accounts with a server of the person's that uses this computer's logins: how they stand
// there, a row for each login, and the person's answer for what the server has that they left. On the
// server itself: whose computer's logins it uses. The accounts themselves are the skill's card, tested there.

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
  for (const fn of [servers.sendUseLoginsOn, servers.sendAllowLogins, servers.sendSettleLogin]) fn.mockResolvedValue({ ok: true })
})

afterEach(() => {
  cleanup()
  forgetRemembered()
  for (const group of [accounts, logins, servers]) for (const fn of Object.values(group)) fn.mockReset()
})

describe('a server that uses this computer\'s logins', () => {
  const there = () => screen.findByRole('region', { name: `Your logins on ${LABEL}` })

  test('one not told yet is offered them, with one press', async () => {
    views([own])
    server({ on: false })
    render(<AccountsSettings />)
    const bar = await there()
    expect(bar.textContent).toContain(`Use your logins on ${LABEL}?`)
    expect(bar.textContent).toContain('its page follows your settings')
    fireEvent.click(within(bar).getByRole('button', { name: 'Use them' }))
    await waitFor(() => expect(servers.sendUseLoginsOn).toHaveBeenCalledWith(ID))
  })

  test('what waits for the press is said over the server\'s rows and on its row; what is there says so on its row', async () => {
    views([own, dani])
    server({
      logins: [
        { kind: 'claude', source: 'own', name: 'Suleiman', state: 'allow' },
        { kind: 'claude', source: 'Dani', name: 'Dani', state: 'there' },
      ],
    })
    render(<AccountsSettings />)
    const block = await there()
    expect(block.textContent).toContain(`${LABEL} uses your logins: 1 of 2 there`)
    expect(block.textContent).toContain('Suleiman needs your yes once')
    expect(within(block).getByRole('listitem', { name: `Suleiman on ${LABEL}` }).textContent).toBe('SuleimanNeeds your yesAllow')
    expect(within(block).getByRole('listitem', { name: `Dani on ${LABEL}` }).textContent).toBe('DaniConnected')
    fireEvent.click(within(block).getByRole('button', { name: 'Allow 1 login' }))
    await waitFor(() => expect(servers.sendAllowLogins).toHaveBeenCalledWith(ID))
  })

  test('one that did not get there is counted out and named over the rows, and its own row says why', async () => {
    views([own])
    const reason = "the login gh keeps for octo-agent is octo's on GitHub"
    server({
      logins: [
        { kind: 'claude', source: 'own', name: 'Suleiman', state: 'there' },
        { kind: 'git', host: 'github.com', source: 'octo-agent', name: 'octo-agent', state: 'failed', error: reason },
      ],
    })
    render(<AccountsSettings />)
    const block = await there()
    expect(block.textContent).toContain(`${LABEL} uses your logins: 1 of 2 there`)
    expect(block.textContent).toContain('octo-agent did not get there: its row says why. Tried again every minute.')
    expect(within(block).getByRole('listitem', { name: `octo-agent on ${LABEL}` }).textContent).toBe(`octo-agentNot connected: ${reason}`)
    expect(block.textContent!.split(reason)).toHaveLength(2)
    expect(within(block).queryByRole('alert')).toBeNull()
  })

  test('each server has its own block, with a row for each login', async () => {
    views([own, dani])
    servers.onServerLogins.mockResolvedValue({
      computer: 'Studio',
      servers: ['Box', 'Studio PC'].map(label => ({ machineId: `https://${label}`, label, on: true, reachable: true, left: [], logins: [{ kind: 'claude', source: 'own', name: 'Suleiman', state: 'there' }, { kind: 'claude', source: 'Dani', name: 'Dani', state: 'there' }] })),
    })
    render(<AccountsSettings />)
    for (const label of ['Box', 'Studio PC']) {
      const block = await screen.findByRole('region', { name: `Your logins on ${label}` })
      expect(within(block).getByRole('listitem', { name: `Suleiman on ${label}` }).textContent).toBe('SuleimanConnected')
      expect(within(block).getByRole('listitem', { name: `Dani on ${label}` }).textContent).toBe('DaniConnected')
    }
  })

  test('a server with all of them there says so quietly, and its rows say each one', async () => {
    views([own])
    server({ logins: [{ kind: 'claude', source: 'own', name: 'Suleiman', state: 'there' }] })
    render(<AccountsSettings />)
    const block = await there()
    expect(within(block).getByText('Uses your logins: all 1 there')).toBeTruthy()
    expect(within(block).getByRole('listitem', { name: `Suleiman on ${LABEL}` }).textContent).toBe('SuleimanConnected')
  })

  test('with no server of the person\'s there is no card of them', async () => {
    views([own])
    render(<AccountsSettings />)
    await waitFor(() => expect(servers.onServerLogins).toHaveBeenCalled())
    expect(screen.queryByText('On your servers')).toBeNull()
  })

  test('while a press starts and ends, the page keeps what it read: the rows never blank out between two reads', async () => {
    views([own, dani])
    const rows = (suleiman: string) => [{ kind: 'claude', source: 'own', name: 'Suleiman', state: suleiman, anew: true }, { kind: 'claude', source: 'Dani', name: 'Dani', state: 'there' }]
    server({ logins: rows('allow') })
    render(<AccountsSettings />)
    const block = await there()
    // The press: the server says it is under way, then answers nothing more for a while.
    servers.onServerLogins.mockResolvedValueOnce({ computer: 'Studio', servers: [{ machineId: ID, label: LABEL, on: true, reachable: true, logins: rows('allow'), left: [], allowing: { name: 'Suleiman' } }] })
    fireEvent.click(await screen.findByRole('button', { name: 'Allow 1 login' }))
    servers.onServerLogins.mockReturnValue(new Promise(() => {}))
    expect(await screen.findByText(`Making Suleiman's login for ${LABEL}`)).toBeTruthy()
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(screen.getByText(`Making Suleiman's login for ${LABEL}`)).toBeTruthy()
    expect(within(block).getByRole('listitem', { name: `Dani on ${LABEL}` }).textContent).toBe('DaniConnected')
  })

  test('a login made for the server with a press is taken off there from its row, which spins until the server answers, and waits for the press again; one that goes as it is has no Take off', async () => {
    views([own, dani])
    server({ logins: [{ kind: 'claude', source: 'own', name: 'Suleiman', state: 'there', anew: true }, { kind: 'claude', source: 'Dani', name: 'Dani', state: 'there' }] })
    render(<AccountsSettings />)
    const block = await there()
    const takeOff = within(within(block).getByRole('listitem', { name: `Suleiman on ${LABEL}` })).getByRole('button', { name: 'Take off' }) as HTMLButtonElement
    expect(within(within(block).getByRole('listitem', { name: `Dani on ${LABEL}` })).queryByRole('button')).toBeNull()
    let answer: (value: { ok: true }) => void = () => {}
    servers.sendSettleLogin.mockImplementation(() => new Promise(resolve => (answer = resolve)))
    fireEvent.click(takeOff)
    await waitFor(() => expect(takeOff.textContent).toBe('Taking off…'))
    expect(takeOff.disabled).toBe(true)
    expect(takeOff.querySelector('.animate-spin')).not.toBeNull()
    expect(servers.sendSettleLogin).toHaveBeenCalledWith(ID, { kind: 'claude', source: 'own' }, false)
    server({ logins: [{ kind: 'claude', source: 'own', name: 'Suleiman', state: 'allow', anew: true }, { kind: 'claude', source: 'Dani', name: 'Dani', state: 'there' }] })
    answer({ ok: true })
    await waitFor(() => expect(within(block).getByRole('listitem', { name: `Suleiman on ${LABEL}` }).textContent).toBe('SuleimanNeeds your yesAllow'))
    expect(block.textContent).toContain('Allow 1 login')
  })

  test('one account on two servers: Take off is only where its login was made for that server', async () => {
    views([own])
    const has = (anew: boolean) => [{ kind: 'claude', source: 'own', name: 'Suleiman', state: 'there', ...(anew ? { anew } : {}) }]
    servers.onServerLogins.mockResolvedValue({ computer: 'Studio', servers: [{ machineId: 'https://Box', label: 'Box', on: true, reachable: true, left: [], logins: has(true) }, { machineId: 'https://Studio PC', label: 'Studio PC', on: true, reachable: true, left: [], logins: has(false) }] })
    render(<AccountsSettings />)
    expect(within(await screen.findByRole('listitem', { name: 'Suleiman on Box' })).getByRole('button', { name: 'Take off' })).toBeTruthy()
    expect(within(screen.getByRole('listitem', { name: 'Suleiman on Studio PC' })).queryByRole('button')).toBeNull()
  })

  test('Allow on a login\'s row makes the login there, and spins while the browser\'s yes is awaited', async () => {
    views([own])
    server({ logins: [{ kind: 'claude', source: 'own', name: 'Suleiman', state: 'allow' }] })
    render(<AccountsSettings />)
    const row = await screen.findByRole('listitem', { name: `Suleiman on ${LABEL}` })
    server({ logins: [{ kind: 'claude', source: 'own', name: 'Suleiman', state: 'allow' }], allowing: { name: 'Suleiman' } })
    fireEvent.click(within(row).getByRole('button', { name: 'Allow' }))
    await waitFor(() => expect(servers.sendAllowLogins).toHaveBeenCalledWith(ID))
    // The press answered, the server makes it: the row still spins until the login is there.
    await new Promise(resolve => setTimeout(resolve, 100))
    const allowing = screen.getByRole('button', { name: 'Allowing…' })
    expect((allowing as HTMLButtonElement).disabled).toBe(true)
    expect(allowing.querySelector('.animate-spin')).not.toBeNull()
  })

  test('the login being made says where to say yes, with its link to copy for a private window', async () => {
    views([own])
    server({ logins: [{ kind: 'claude', source: 'own', name: 'Suleiman', state: 'allow' }], allowing: { name: 'Suleiman', url: 'https://claude.com/cai/oauth/authorize?x' } })
    render(<AccountsSettings />)
    const block = await there()
    expect(block.textContent).toContain(`Making Suleiman's login for ${LABEL}`)
    expect(within(block).getByRole('button', { name: 'Copy link' })).toBeTruthy()
  })

  test('another account logged in here: the server keeps the one left meanwhile, and the person picks', async () => {
    views([{ ...own, name: 'Work' }])
    server({ logins: [{ kind: 'claude', source: 'own', name: 'Work', state: 'switched', was: 'Suleiman' }] })
    render(<AccountsSettings />)
    const row = await screen.findByRole('listitem', { name: `Work on ${LABEL}` })
    expect(row.textContent).toContain('Still runs on Suleiman, the account you left on Studio.')
    fireEvent.click(within(row).getByRole('button', { name: 'Keep Suleiman' }))
    await waitFor(() => expect(servers.sendSettleLogin).toHaveBeenCalledWith(ID, { kind: 'claude', source: 'own' }, true))
    await waitFor(() => expect((within(row).getByRole('button', { name: 'Use Work there' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(within(row).getByRole('button', { name: 'Use Work there' }))
    await waitFor(() => expect(servers.sendAllowLogins).toHaveBeenCalledWith(ID))
  })

  test('one this computer no longer has is kept there, or taken off, on the person\'s word', async () => {
    views([own])
    server({ logins: [{ kind: 'claude', source: 'own', name: 'Suleiman', state: 'there' }], left: [{ kind: 'claude', source: 'Dani', name: 'Dani' }] })
    render(<AccountsSettings />)
    const row = await screen.findByRole('listitem', { name: `Dani on ${LABEL}` })
    expect(row.textContent).toContain('No longer on Studio')
    fireEvent.click(within(row).getByRole('button', { name: 'Take it off' }))
    await waitFor(() => expect(servers.sendSettleLogin).toHaveBeenCalledWith(ID, { kind: 'claude', source: 'Dani' }, false))
    await waitFor(() => expect((within(row).getByRole('button', { name: 'Keep it there' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(within(row).getByRole('button', { name: 'Keep it there' }))
    await waitFor(() => expect(servers.sendSettleLogin).toHaveBeenCalledWith(ID, { kind: 'claude', source: 'Dani' }, true))
  })
})

describe('on the server itself', () => {
  test('it says whose computer\'s logins it uses', async () => {
    views([{ id: 'Suleiman', name: 'Suleiman', own: false, from: 'Suleimans-MacBook-Pro', comesBack: true, windows: [] }], [], { from: 'Suleimans-MacBook-Pro' })
    render(<AccountsSettings />)
    expect(await screen.findByText('Your logins and settings from Suleimans-MacBook-Pro')).toBeTruthy()
  })
})
