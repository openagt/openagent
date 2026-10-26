import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ModuleHostContext, forgetRemembered, type ModuleHost, type ModuleMachine, type ModuleMachines } from '@openagt/dashboard/module'
import { DevicesCard } from './DevicesCard.js'

// The Overview's Devices card: this computer and its saved machines, each with whether it answers
// and how it stands, and one line for the phones in at this computer's door. Read from the
// machines' pings and the door alone: never a server's SSH.

const GB = 1024 ** 3
const NOW = new Date()

/** A host with these machines saved and this door, whose every other service is not here. */
function hostWith(machines: ModuleMachines, devices: unknown[] = []): ModuleHost {
  const none = vi.fn(async () => ({ ok: false as const, error: 'not here' }))
  return {
    package: '@openagt/devices',
    machines: vi.fn(async () => machines),
    runComputerCommand: vi.fn(async (args: string[]) => (args[0] === 'status' ? { ok: true as const, output: { on: true, listening: true, devices, persons: [] } } : { ok: false as const, error: 'not here' })),
    openSettings: vi.fn(),
    runCommand: none,
    act: none,
    runComputerCommandOn: none,
  } as unknown as ModuleHost
}

const show = (host: ModuleHost) =>
  render(
    <ModuleHostContext.Provider value={host}>
      <DevicesCard projects={[]} />
    </ModuleHostContext.Provider>,
  )

afterEach(() => {
  cleanup()
  // What one test read would show at once in the next: kept in memory, and stored for the next visit.
  forgetRemembered()
  localStorage.clear()
})

test('this computer and each saved machine: whether it answers, its memory and disk in use, and an OpenAgent behind this one marked', async () => {
  const server: ModuleMachine = { id: 'https://203.0.113.5', label: 'droplet', url: 'https://203.0.113.5', version: '0.36.0', health: { memory: { total: 4 * GB, used: 3.6 * GB }, disk: { total: 50 * GB, used: 10 * GB }, load: 40 } }
  const gone: ModuleMachine = { id: 'http://studio.local:4201', label: 'studio', url: 'http://studio.local:4201' }
  const host = hostWith({ version: '0.37.0', name: 'Adas-MacBook', health: { memory: { total: 16 * GB, used: 8 * GB } }, machines: [server, gone] }, [
    { id: 'p1', name: 'iPhone, Safari', added: NOW.toISOString(), seen: NOW.toISOString() },
    { id: 'c1', name: 'OpenAgent on studio', added: NOW.toISOString() },
  ])
  show(host)
  const items = await screen.findAllByRole('listitem')
  expect(items.map(item => item.querySelector('.font-medium')!.textContent)).toEqual(['Adas-MacBook', 'droplet', 'studio'])
  expect(within(items[0]!).getByText('this computer')).toBeTruthy()
  expect(within(items[0]!).getByRole('meter', { name: 'RAM' }).getAttribute('aria-valuenow')).toBe('50')
  // The server: online, its RAM near full in amber, its disk, how busy, and behind this computer's OpenAgent.
  const droplet = within(items[1]!)
  expect(droplet.getByLabelText('online')).toBeTruthy()
  expect(droplet.getByRole('meter', { name: 'RAM' }).getAttribute('aria-valuenow')).toBe('90')
  expect(droplet.getByText('90').className).toContain('text-warning')
  expect(droplet.getByRole('meter', { name: 'Disk' }).getAttribute('aria-valuenow')).toBe('20')
  expect(droplet.getByRole('meter', { name: 'CPU' }).getAttribute('aria-valuenow')).toBe('40')
  expect(droplet.getByText('OpenAgent 0.36.0: update it')).toBeTruthy()
  // One that does not answer: offline, and nothing said of how it stands.
  expect(within(items[2]!).getByLabelText('offline')).toBeTruthy()
  expect(within(items[2]!).queryByRole('meter')).toBeNull()
  // The phones: the iPhone, not the computer that got in by itself.
  fireEvent.click(screen.getByText(/1 phone or browser in/))
  expect(host.openSettings).toHaveBeenCalledWith('devices')
  // Never a server's SSH: only the door's own status.
  expect(vi.mocked(host.runComputerCommand).mock.calls.map(call => call[0])).toEqual([['status']])
})

test('each machine is said as the "Run on" menu says it: its own name, then what it is and where, never the address that stands for it', async () => {
  const via = 'https://165.245.244.10/_devices/via/8687ab858ef6'
  const machines: ModuleMachine[] = [
    { id: 'https://165.245.244.10', label: '165.245.244.10', url: 'https://165.245.244.10', version: '0.39.1' },
    { id: via, label: 'experiment (through 165.245.244.10)', url: via, version: '0.39.1' },
    { id: 'https://203.0.113.5/_devices/via/b0x1', label: 'rom-desktop (through 203.0.113.5)', url: 'https://203.0.113.5/_devices/via/b0x1', owner: 'rom' },
  ]
  show(hostWith({ version: '0.39.1', name: 'Adas-MacBook', machines }))
  const items = await screen.findAllByRole('listitem')
  const said = items.map(item => [item.querySelector('.font-medium')!.textContent, item.querySelector('.text-xs.text-muted-foreground')?.textContent])
  expect(said.slice(1)).toEqual([
    ['165.245.244.10', 'Server'],
    ['experiment', 'Server at home, through 165.245.244.10'],
    ['rom-desktop', 'offline'],
  ])
  expect(items[2]!.querySelector('svg.lucide-house')).toBeTruthy()
  expect(items[1]!.querySelector('svg.lucide-server')).toBeTruthy()
  expect(document.body.textContent).not.toContain('_devices')
})
