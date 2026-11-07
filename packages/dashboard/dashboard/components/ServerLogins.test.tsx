import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { forgetRemembered } from '../lib/use-async.js'
import { openMenu } from '../test-utils.js'

const accounts = vi.hoisted(() => ({ onAgentAccounts: vi.fn() }))
vi.mock('../rpc/accounts.js', () => accounts)
const logins = vi.hoisted(() => ({ onAgentState: vi.fn(), sendAgentFix: vi.fn(), onGitHosts: vi.fn(), sendGitHostInstall: vi.fn(), sendGitHostLogin: vi.fn(), sendStopGitHostLogin: vi.fn(), sendUseGitHostAccount: vi.fn(), sendForgetGitHostAccount: vi.fn() }))
vi.mock('../rpc/logins.js', () => logins)
const servers = vi.hoisted(() => ({ onServerLogins: vi.fn(), sendUseLoginsOn: vi.fn(), sendAllowLogins: vi.fn(), sendSettleLogin: vi.fn() }))
vi.mock('../rpc/server-logins.js', () => servers)

const { AccountsList } = await import('./Accounts.js')
const { AccountWhere, ServersProvider } = await import('./ServerLogins.js')

// The person's servers that use this computer's logins, on the Permissions page: each account's row
// says where it works, a chip per server with its press there; above the accounts, only what a
// server asks of the person. On the server itself: whose computer's logins it uses. The accounts
// themselves are the skill's card, tested there; here, the line the page fills under each.

const NOW = Date.parse('2026-10-24T12:00:00Z')
const ID = 'https://203.0.113.5'
const LABEL = '203.0.113.5'

const own = { id: 'This computer', name: 'Suleiman', own: true, windows: [{ label: 'week', percent: 62 }] }

function views(claude: object[], codex: object[] = [], extra: object = {}): void {
  accounts.onAgentAccounts.mockImplementation(async (agent: string) => ({ now: NOW, computer: 'Studio', accounts: agent === 'codex' ? codex : claude, ...extra }))
}

function server(over: object): void {
  servers.onServerLogins.mockResolvedValue({ computer: 'Studio', servers: [{ machineId: ID, label: LABEL, on: true, reachable: true, logins: [], left: [], ...over }] })
}

/** Where a Claude account works: the line under its row. */
const where = (name = 'Suleiman', isOwn = true) =>
  render(
    <ServersProvider>
      <AccountWhere account={{ kind: 'claude', own: isOwn, name }} />
    </ServersProvider>,
  )

/** A chip with no press: its words are its name. */
const chip = (label: string) => screen.findByRole('listitem', { name: new RegExp(`^${label}: `) })

/** A chip's dot colour. */
const dot = (element: Element) => element.querySelector('span[aria-hidden]')!.className

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

describe('what a server asks, above the accounts', () => {
  const asks = () => screen.findByRole('region', { name: `Your logins on ${LABEL}` })

  test('one not told yet is offered them, with one press', async () => {
    views([own])
    server({ on: false })
    render(<AccountsList />)
    const bar = await asks()
    expect(bar.textContent).toContain(`Use your logins on ${LABEL}?`)
    expect(bar.textContent).toContain('its page follows your settings')
    fireEvent.click(within(bar).getByRole('button', { name: 'Use them' }))
    await waitFor(() => expect(servers.sendUseLoginsOn).toHaveBeenCalledWith(ID))
  })

  test('what waits for the press is said, with the press for all of it', async () => {
    views([own])
    server({ logins: [{ kind: 'claude', source: 'own', name: 'Suleiman', state: 'allow' }, { kind: 'claude', source: 'Dani', name: 'Dani', state: 'there' }] })
    render(<AccountsList />)
    const bar = await asks()
    expect(bar.textContent).toContain(`${LABEL} uses your logins: 1 of 2 there`)
    expect(bar.textContent).toContain('Suleiman needs your yes once')
    fireEvent.click(within(bar).getByRole('button', { name: 'Allow 1 login' }))
    await waitFor(() => expect(servers.sendAllowLogins).toHaveBeenCalledWith(ID))
  })

  test('one that did not get there is counted out and named', async () => {
    views([own])
    server({ logins: [{ kind: 'claude', source: 'own', name: 'Suleiman', state: 'there' }, { kind: 'git', host: 'github.com', source: 'octo-agent', name: 'octo-agent', state: 'failed', error: 'no' }] })
    render(<AccountsList />)
    const bar = await asks()
    expect(bar.textContent).toContain(`${LABEL} uses your logins: 1 of 2 there`)
    expect(bar.textContent).toContain('octo-agent did not get there')
  })

  test('a server with everything there asks nothing: the accounts say where they work', async () => {
    views([own])
    server({ logins: [{ kind: 'claude', source: 'own', name: 'Suleiman', state: 'there' }] })
    render(<AccountsList />)
    await waitFor(() => expect(servers.onServerLogins).toHaveBeenCalled())
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(screen.queryByRole('region', { name: `Your logins on ${LABEL}` })).toBeNull()
  })

  test('the login being made says where to say yes, with its link to copy for a private window, and the page keeps what it read meanwhile', async () => {
    views([own])
    server({ logins: [{ kind: 'claude', source: 'own', name: 'Suleiman', state: 'allow' }], allowing: { name: 'Suleiman', url: 'https://claude.com/cai/oauth/authorize?x' } })
    render(<AccountsList />)
    const bar = await asks()
    expect(bar.textContent).toContain(`Making Suleiman's login for ${LABEL}`)
    expect(within(bar).getByRole('button', { name: 'Copy link' })).toBeTruthy()
    // The server then answers nothing for a while: what was read stays.
    servers.onServerLogins.mockReturnValue(new Promise(() => {}))
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(screen.getByText(`Making Suleiman's login for ${LABEL}`)).toBeTruthy()
  })

  test("one this computer no longer has is kept there, or taken off, on the person's word", async () => {
    views([own])
    server({ logins: [{ kind: 'claude', source: 'own', name: 'Suleiman', state: 'there' }], left: [{ kind: 'claude', source: 'Dani', name: 'Dani' }] })
    render(<AccountsList />)
    const row = await screen.findByRole('listitem', { name: `Dani on ${LABEL}` })
    expect(row.textContent).toContain('no longer on Studio')
    fireEvent.click(within(row).getByRole('button', { name: 'Take it off' }))
    await waitFor(() => expect(servers.sendSettleLogin).toHaveBeenCalledWith(ID, { kind: 'claude', source: 'Dani' }, false))
    await waitFor(() => expect((within(row).getByRole('button', { name: 'Keep it there' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(within(row).getByRole('button', { name: 'Keep it there' }))
    await waitFor(() => expect(servers.sendSettleLogin).toHaveBeenCalledWith(ID, { kind: 'claude', source: 'Dani' }, true))
  })
})

describe('where an account works, under its row', () => {
  test('this computer, then a chip per server: green where it is there, amber where it waits, red where it did not get there, grey where the server does not take these logins', async () => {
    views([own])
    servers.onServerLogins.mockResolvedValue({
      computer: 'Studio',
      servers: [
        { machineId: 'a', label: 'Box', on: true, reachable: true, left: [], logins: [{ kind: 'claude', source: 'own', name: 'Suleiman', state: 'there' }] },
        { machineId: 'b', label: 'Lab', on: true, reachable: true, left: [], logins: [{ kind: 'claude', source: 'own', name: 'Suleiman', state: 'failed', error: 'no room' }] },
        { machineId: 'c', label: 'Old', on: false, reachable: true, left: [], logins: [] },
        { machineId: 'd', label: 'Far', on: true, reachable: false, left: [], logins: [] },
      ],
    })
    where()
    expect(dot(await chip('This computer'))).toContain('bg-success')
    expect(dot(await chip('Box'))).toContain('bg-success')
    expect((await chip('Lab')).getAttribute('aria-label')).toBe('Lab: Not connected: no room')
    expect(dot(await chip('Lab'))).toContain('bg-danger')
    expect((await chip('Old')).getAttribute('aria-label')).toBe('Old: Old does not use your logins')
    expect(dot(await chip('Far'))).toContain('bg-muted-foreground')
  })

  test('another account is matched by its name, the own login by being the own', async () => {
    servers.onServerLogins.mockResolvedValue({ computer: 'Studio', servers: [{ machineId: ID, label: LABEL, on: true, reachable: true, left: [], logins: [{ kind: 'claude', source: 'Dani', name: 'Dani', state: 'there' }] }] })
    where('Dani', false)
    expect(dot(await chip(LABEL))).toContain('bg-success')
    cleanup()
    where('Suleiman', true)
    expect((await chip(LABEL)).getAttribute('aria-label')).toBe(`${LABEL}: Not on ${LABEL}`)
  })

  test('one waiting for the yes is amber, and its chip has the Allow', async () => {
    server({ logins: [{ kind: 'claude', source: 'own', name: 'Suleiman', state: 'allow' }] })
    where()
    const press = await screen.findByRole('button', { name: LABEL })
    expect(dot(press)).toContain('bg-warning')
    await openMenu(press)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Allow' }))
    await waitFor(() => expect(servers.sendAllowLogins).toHaveBeenCalledWith(ID))
  })

  test('while its login is being made for the server, the chip spins', async () => {
    server({ logins: [{ kind: 'claude', source: 'own', name: 'Suleiman', state: 'allow' }], allowing: { name: 'Suleiman' } })
    where()
    const press = await screen.findByRole('button', { name: LABEL })
    expect(press.querySelector('.animate-spin')).not.toBeNull()
    expect((press as HTMLButtonElement).disabled).toBe(true)
  })

  test('Take off only where its login was made for that server; one that goes as it is has none', async () => {
    const has = (anew: boolean) => [{ kind: 'claude', source: 'own', name: 'Suleiman', state: 'there', ...(anew ? { anew } : {}) }]
    servers.onServerLogins.mockResolvedValue({ computer: 'Studio', servers: [{ machineId: 'https://Box', label: 'Box', on: true, reachable: true, left: [], logins: has(true) }, { machineId: 'https://Studio PC', label: 'Studio PC', on: true, reachable: true, left: [], logins: has(false) }] })
    where()
    await chip('Studio PC')
    await openMenu(await screen.findByRole('button', { name: 'Box' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Take off' }))
    await waitFor(() => expect(servers.sendSettleLogin).toHaveBeenCalledWith('https://Box', { kind: 'claude', source: 'own' }, false))
  })

  test('another account logged in here: the server keeps the one left meanwhile, and the person picks on its chip', async () => {
    server({ logins: [{ kind: 'claude', source: 'own', name: 'Work', state: 'switched', was: 'Suleiman' }] })
    where('Work', true)
    await openMenu(await screen.findByRole('button', { name: LABEL }))
    expect(document.body.textContent).toContain('Still runs on Suleiman, the account you left on Studio.')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Keep Suleiman' }))
    await waitFor(() => expect(servers.sendSettleLogin).toHaveBeenCalledWith(ID, { kind: 'claude', source: 'own' }, true))
    await openMenu(await screen.findByRole('button', { name: LABEL }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Use Work there' }))
    await waitFor(() => expect(servers.sendAllowLogins).toHaveBeenCalledWith(ID))
  })

  test('with no server of the person\'s there is no line at all', async () => {
    where()
    await waitFor(() => expect(servers.onServerLogins).toHaveBeenCalled())
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(screen.queryByRole('list', { name: 'Where it works' })).toBeNull()
  })
})

describe('on the server itself', () => {
  test("it says whose computer's logins it uses", async () => {
    views([{ id: 'Suleiman', name: 'Suleiman', own: false, from: 'Suleimans-MacBook-Pro', comesBack: true, windows: [] }], [], { from: 'Suleimans-MacBook-Pro' })
    render(<AccountsList />)
    expect(await screen.findByText('Your logins and settings from Suleimans-MacBook-Pro')).toBeTruthy()
  })
})
