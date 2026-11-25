import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { forgetRemembered } from '@openagt/ui/module'
import type { HostAccounts } from '@openagt/hooks'
import { github, renderCalling } from './test-host.js'

// The press of the module that adds an account, which says the module it was pressed for.
const shell = vi.hoisted(() => ({ added: [] as string[] }))
vi.mock('@openagt/ui/module', async original => ({
  ...(await original<typeof import('@openagt/ui/module')>()),
  ModuleFixPress: ({ fix }: { fix: { module: string; label: string } }) => (
    <button type="button" onClick={() => shell.added.push(fix.module)}>
      {fix.label}
    </button>
  ),
}))

const { BackupNotice } = await import('./BackupNotice.js')

const PERSONAL = { kind: 'personal', address: 'github.com/me/agent', url: 'https://github.com/me/agent', host: 'github.com', waiting: 3 }
const SHOP = { kind: 'project', projectId: 'p1', project: 'shop', address: 'github.com/acme/shop', url: 'https://github.com/acme/shop', host: 'github.com' }

let gaps: unknown[]
let hosts: HostAccounts[]
let backUp: (input: Record<string, unknown>) => unknown
const render = () => renderCalling(<BackupNotice />, (name, input) => (name === 'backup' ? { gaps, hosts } : name === 'backUp' ? backUp(input) : undefined))

beforeEach(() => {
  gaps = [PERSONAL]
  backUp = () => ({ ok: true })
  hosts = [github([])]
  shell.added = []
})

afterEach(() => {
  cleanup()
  forgetRemembered()
})

/** A line read whole: its address is a link inside it. */
const line = (text: string) => (_: string, element: Element | null) => (element?.tagName === 'LI' || element?.tagName === 'P') && element.textContent === text

describe('what is not backed up, at the top of Settings › Your agent data', () => {
  test('everything backed up: nothing is said', async () => {
    gaps = []
    const { container, callComputer } = render()
    await waitFor(() => expect(callComputer).toHaveBeenCalledWith('backup', {}))
    expect(container.textContent).toBe('')
  })

  test('with no account of OpenAgent at the host: what waits, and the press that adds one, here', async () => {
    render()
    expect(await screen.findByText('Not backed up')).toBeTruthy()
    expect(await screen.findByText(line('Your agent data to github.com/me/agent · 3 changes waiting'))).toBeTruthy()
    expect(screen.getByText(/OpenAgent backs up to github.com with an account of its own, never your own login/)).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: 'Add a GitHub account' }))
    expect(shell.added).toEqual(['github'])
    expect(screen.queryByRole('button', { name: 'Back up' })).toBeNull()
  })

  test('with accounts: the person picks one, the one runs use first, and Back up sends as it', async () => {
    gaps = [PERSONAL, SHOP]
    hosts = [github(['other', 'me-agent'], 'me-agent')]
    const { sent } = render()
    expect(await screen.findByText(line('Your agent data to github.com/me/agent · 3 changes waiting'))).toBeTruthy()
    expect(screen.getByText(line('shop’s shared data to github.com/acme/shop'))).toBeTruthy()
    const picks = await screen.findAllByRole('combobox', { name: 'Back up as' })
    expect(picks[0]!.textContent).toContain('@me-agent')
    gaps = [SHOP]
    fireEvent.click(screen.getAllByRole('button', { name: 'Back up' })[0]!)
    await waitFor(() => expect(sent('backUp')).toEqual([{ kind: 'personal', login: 'me-agent' }]))
    // Read again: the folder is backed up now, the project still waits.
    await waitFor(() => expect(screen.queryByText(line('Your agent data to github.com/me/agent · 3 changes waiting'))).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Back up' }))
    await waitFor(() => expect(sent('backUp').at(-1)).toEqual({ kind: 'project', projectId: 'p1', login: 'me-agent' }))
  })

  test('a back-up the host refuses says why, and the notice stays', async () => {
    backUp = () => ({ ok: false, error: '@me-agent cannot push to github.com/me/agent' })
    hosts = [github(['me-agent'], 'me-agent')]
    render()
    fireEvent.click(await screen.findByRole('button', { name: 'Back up' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe('@me-agent cannot push to github.com/me/agent')
    expect(screen.getByText('Not backed up')).toBeTruthy()
  })
})
