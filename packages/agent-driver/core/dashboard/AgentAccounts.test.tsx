import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { forgetRemembered, type ModuleCallResult } from '@openagt/ui/module'
import { fakeHost, renderWithHost } from '@openagt/ui/module/testing'
import { AddedAccountsUsage, freeIn } from './AgentAccounts.js'
import { accountRows, firstAccount, runAccounts } from './accounts.js'
import { InstallAgent } from './setup.js'

const HOUR = 60 * 60_000
const NOW = Date.parse('2026-10-22T12:00:00Z')

afterEach(() => {
  cleanup()
  forgetRemembered()
  localStorage.clear()
})

/** A host whose server part answers each read by its name. */
function hostAnswering(answers: Record<string, unknown>) {
  const callComputer = vi.fn(async (name: string, _input: object): Promise<ModuleCallResult> => (name in answers ? { ok: true, output: typeof answers[name] === 'function' ? (answers[name] as () => unknown)() : answers[name] } : { ok: false, error: `no ${name}` }))
  return { host: fakeHost('@openagt/agent-driver', { callComputer }), callComputer }
}

describe('Agent accounts', () => {
  test('an agent whose program is not here: the press that installs it, with the command it runs, what it says while it does, and why it failed, an address in it a link', async () => {
    const missing = { agent: 'claude-code', label: 'Claude Code', list: 'claude', ready: false, problem: '`claude` not found', fix: { kind: 'install' as const, command: 'curl -fsSL https://claude.ai/install.sh | bash', problem: '`claude` not found' } }
    const { host, callComputer } = hostAnswering({ install: { ok: true } })
    const onChanged = vi.fn()
    const { rerender } = renderWithHost(<InstallAgent state={missing} onChanged={onChanged} />, host)
    expect(screen.getByText('curl -fsSL https://claude.ai/install.sh | bash')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Install Claude Code' }))
    await waitFor(() => expect(callComputer).toHaveBeenCalledWith('install', { agent: 'claude-code' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    rerender(<InstallAgent state={{ ...missing, fixing: 'install' }} onChanged={onChanged} />)
    expect(screen.getByRole('status').textContent).toBe('Installing Claude Code…')
    rerender(<InstallAgent state={{ ...missing, failed: 'See https://claude.ai/status\ncurl: (6) Could not resolve host' }} onChanged={onChanged} />)
    expect(screen.getByRole('link', { name: 'https://claude.ai/status' }).getAttribute('href')).toBe('https://claude.ai/status')
    expect(screen.getByRole('alert').textContent).toBe('See https://claude.ai/status\ncurl: (6) Could not resolve host')
    // An agent that is here, or whose fix is its log-in, has no install press: never a command of the computer's CLI run from the page.
    rerender(<InstallAgent state={{ ...missing, fix: { kind: 'log-in', command: 'claude auth login', problem: '`claude` is not logged in.' } }} onChanged={onChanged} />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  test("the usage card shows the added accounts under the person's own bar, and nothing with one account", async () => {
    const listed = { claude: [{ name: 'This computer', who: 'Suleiman', own: true }, { name: 'Dani', own: false }], codex: [], notInstalled: [] }
    const used = { claude: [{ name: 'This computer', windows: [{ window: 'seven_day', percentUsed: 22 }] }, { name: 'Dani', windows: [{ window: 'seven_day', percentUsed: 20 }], at: NOW - HOUR }], codex: [] }
    const { host } = hostAnswering({ list: listed, usage: used })
    const { unmount } = renderWithHost(<AddedAccountsUsage list="claude" label="Claude" />, host)
    const rows = await screen.findByLabelText('Other Claude accounts')
    expect(rows.textContent).toMatch(/^Dani20% this week·as of /)
    expect(rows.textContent).not.toContain('Suleiman')
    unmount()
    forgetRemembered()
    const alone = hostAnswering({ list: { ...listed, claude: [listed.claude[0]] }, usage: used })
    const { container } = renderWithHost(<AddedAccountsUsage list="claude" label="Claude" />, alone.host)
    await waitFor(() => expect(alone.callComputer).toHaveBeenCalledWith('usage', {}))
    expect(container.textContent).toBe('')
  })

  test('a limit says when it frees: the one limited is said so, the first free one is in use and the one after it next', () => {
    const rows = accountRows(
      [
        { name: 'This computer', who: 'Suleiman', own: true, limitedUntil: NOW + 2 * HOUR },
        { name: 'Dani', own: false },
        { name: 'Old', own: false, limitedUntil: NOW - HOUR },
      ],
      [{ name: 'Dani', windows: [{ window: 'five_hour', percentUsed: 3 }, { window: 'seven_day', percentUsed: 20 }] }],
      NOW,
    )
    expect(rows.map(row => [row.name, row.state, row.limitedUntil])).toEqual([
      ['Suleiman', 'limited', NOW + 2 * HOUR],
      ['Dani', 'in-use', undefined],
      ['Old', 'next', undefined],
    ])
    expect(rows[1]!.windows).toEqual([{ label: '5 h', percent: 3 }, { label: 'week', percent: 20 }])
  })

  test('how long until a limit frees, in hours and minutes', () => {
    expect(freeIn(NOW + 2 * HOUR + 10 * 60_000, NOW)).toBe('2 h 10 min')
    expect(freeIn(NOW + 3 * HOUR, NOW)).toBe('3 h')
    expect(freeIn(NOW + 30_000, NOW)).toBe('1 min')
    expect(freeIn(NOW + 20 * 24 * HOUR, NOW)).toBe('20 days')
  })

  test('the agent menu offers no login the agent does not have, and names the one runs really take; alone it stays', () => {
    const row = (name: string, own: boolean, more: object = {}) => ({ id: name, name, own, windows: [], ...more })
    const view = { now: 0, accounts: [row('Claude login on VPS', true, { loggedOut: true }), row('test', false), row('Suleiman', false)] }
    expect(runAccounts(view).map(account => account.name)).toEqual(['test', 'Suleiman'])
    expect(firstAccount(view)?.name).toBe('test')
    const alone = { now: 0, accounts: [row('Claude login on VPS', true, { loggedOut: true })] }
    expect(runAccounts(alone).map(account => account.name)).toEqual(['Claude login on VPS'])
  })
})
