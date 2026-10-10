import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ModuleHostContext, type ModuleCommandResult, type ModuleHost, type ModuleProject } from '@openagt/dashboard/module'
import { DevicesSettings, WARNING } from './DevicesSettings.js'

const PROJECT = { id: 'p1', name: 'gemstack', gitHost: true }
const OTHER = { id: 'p2', name: 'other', gitHost: false }

const OFF = { on: false, listening: false, devices: [] }
const OPEN = { on: true, listening: true, addresses: { name: 'http://adas-macbook.local:4201', number: 'http://192.168.1.23:4201' }, devices: [] }
const PHONE = { id: 'abc123def456', name: 'iPhone, Safari', added: new Date(Date.now() - 3 * 60_000).toISOString(), seen: new Date(Date.now() - 60_000).toISOString() }
const LINK = { url: 'http://adas-macbook.local:4201/_remote-access/enter#code', numberUrl: 'http://192.168.1.23:4201/_remote-access/enter#code', expires: new Date(Date.now() + 5 * 60_000).toISOString() }

/** A host whose `remote-access` command answers what `answer` says for its arguments. */
function door(answer: (args: string[]) => ModuleCommandResult) {
  const runCommand = vi.fn(async (_projectId: string, args: string[]) => answer(args))
  const host: ModuleHost = {
    package: '@openagt/remote-access',
    runCommand,
    act: runCommand,
    read: vi.fn(async () => ({ ok: false as const, error: 'no server part' })),
    openAgent: vi.fn(),
    openPage: vi.fn(),
    startRun: vi.fn(async () => ({ ok: false as const, error: 'not here' })),
    configureRun: vi.fn(),
    agents: vi.fn(async () => []),
  }
  return { host, runCommand }
}

function show(host: ModuleHost, projects: ModuleProject[] = [PROJECT, OTHER]) {
  return render(
    <ModuleHostContext.Provider value={host}>
      <DevicesSettings projects={projects} everyMs={40} />
    </ModuleHostContext.Provider>,
  )
}

const ok = (output: unknown): ModuleCommandResult => ({ ok: true, output })
const theSwitch = (): Promise<HTMLElement> => screen.findByRole('switch', { name: 'Phone on Wi-Fi' })
const qrPath = (): string => screen.getByRole('img', { name: 'The code a new device scans' }).querySelector('path')!.getAttribute('d')!

afterEach(cleanup)

describe('Settings → Devices', () => {
  test('no project, no section', () => {
    const { host } = door(() => ok(OFF))
    expect(show(host, []).container.textContent).toBe('')
  })

  test('off: the switch alone, no Add device, and the command is asked in one project', async () => {
    const { host, runCommand } = door(() => ok(OFF))
    show(host)
    await waitFor(async () => expect((await theSwitch()).getAttribute('aria-checked')).toBe('false'))
    await waitFor(() => expect((screen.getByRole('switch', { name: 'Phone on Wi-Fi' }) as HTMLButtonElement).hasAttribute('data-disabled')).toBe(false))
    expect(screen.queryByRole('button', { name: 'Add device' })).toBeNull()
    expect(runCommand.mock.calls.every(([projectId]) => projectId === 'p1')).toBe(true)
  })

  test('turning it on says first that the link is not locked; Cancel changes nothing, Turn on opens the door', async () => {
    let state: object = OFF
    const { host, runCommand } = door(args => {
      if (args[0] === 'on') state = OPEN
      return ok(state)
    })
    show(host)
    await waitFor(async () => expect((await theSwitch()).hasAttribute('data-disabled')).toBe(false))
    fireEvent.click(await theSwitch())
    expect(screen.getByText(WARNING)).toBeTruthy()
    expect(runCommand).not.toHaveBeenCalledWith('p1', ['on'])
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText(WARNING)).toBeNull()
    expect(runCommand).not.toHaveBeenCalledWith('p1', ['on'])

    fireEvent.click(await theSwitch())
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }))
    await waitFor(() => expect(runCommand).toHaveBeenCalledWith('p1', ['on']))
    expect(await screen.findByRole('button', { name: 'Add device' })).toBeTruthy()
    expect((await theSwitch()).getAttribute('aria-checked')).toBe('true')
  })

  test('turning it off asks nothing first', async () => {
    let state: object = OPEN
    const { host, runCommand } = door(args => {
      if (args[0] === 'off') state = OFF
      return ok(state)
    })
    show(host)
    await screen.findByRole('button', { name: 'Add device' })
    fireEvent.click(await theSwitch())
    await waitFor(() => expect(runCommand).toHaveBeenCalledWith('p1', ['off']))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Add device' })).toBeNull())
    expect(screen.queryByText(WARNING)).toBeNull()
  })

  test('Add device shows the code of the link by the name, and the number on request', async () => {
    const { host } = door(args => (args[0] === 'add' ? ok(LINK) : ok(OPEN)))
    show(host)
    fireEvent.click(await screen.findByRole('button', { name: 'Add device' }))
    await screen.findByRole('img', { name: 'The code a new device scans' })
    const byName = qrPath()
    expect(screen.getByText(/The code works once, for five minutes\./)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Phone does not open it? Use the number.' }))
    expect(qrPath()).not.toBe(byName)
    expect(screen.queryByRole('button', { name: 'Phone does not open it? Use the number.' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('img', { name: 'The code a new device scans' })).toBeNull()
  })

  test('the code leaves the page once a new device got in with it, and not for a read that tells an older list', async () => {
    let devices: object[] = [PHONE]
    const { host } = door(args => (args[0] === 'add' ? ok(LINK) : ok({ ...OPEN, devices })))
    show(host)
    fireEvent.click(await screen.findByRole('button', { name: 'Add device' }))
    await screen.findByRole('img', { name: 'The code a new device scans' })
    // A device fewer is no device got in: the code stays.
    devices = []
    await waitFor(() => expect(screen.queryByText('iPhone, Safari')).toBeNull())
    expect(screen.getByRole('img', { name: 'The code a new device scans' })).toBeTruthy()
    devices = [{ id: 'new000new000', name: 'Android phone, Chrome', added: new Date().toISOString() }]
    expect(await screen.findByText('Android phone, Chrome', undefined)).toBeTruthy()
    expect(screen.queryByRole('img', { name: 'The code a new device scans' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Add device' })).toBeTruthy()
  })

  test('a removed device does not come back from a read that was on its way before the removal', async () => {
    let late: ((result: ModuleCommandResult) => void) | undefined
    let removed = false
    const runCommand = vi.fn(async (_projectId: string, args: string[]): Promise<ModuleCommandResult> => {
      if (args[0] === 'remove') {
        removed = true
        // The read that was on its way lands now, telling the list from before.
        late?.(ok({ ...OPEN, devices: [PHONE] }))
        return ok(OPEN)
      }
      // Every read made after the removal is still on its way when the page is looked at.
      if (removed) return new Promise(() => {})
      if (late === undefined && runCommand.mock.calls.length > 1) return new Promise(resolve => (late = resolve))
      return ok({ ...OPEN, devices: [PHONE] })
    })
    const { host } = door(() => ok(OPEN))
    show({ ...host, runCommand })
    const remove = await screen.findByRole('button', { name: 'Remove iPhone, Safari' })
    await waitFor(() => expect(late).toBeDefined())
    fireEvent.click(remove)
    await waitFor(() => expect(screen.queryByText('iPhone, Safari')).toBeNull())
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(screen.queryByText('iPhone, Safari')).toBeNull()
  })

  test('a project whose folder is gone does not block the section: the next project is asked', async () => {
    const runCommand = vi.fn(async (projectId: string): Promise<ModuleCommandResult> => (projectId === 'p1' ? { ok: false, error: 'remote-access failed: spawn node ENOENT' } : ok(OPEN)))
    const { host } = door(() => ok(OPEN))
    show({ ...host, runCommand })
    expect(await screen.findByRole('button', { name: 'Add device' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  test('a computer with no name offers no second code', async () => {
    const { host } = door(args => (args[0] === 'add' ? ok({ url: LINK.numberUrl, expires: LINK.expires }) : ok(OPEN)))
    show(host)
    fireEvent.click(await screen.findByRole('button', { name: 'Add device' }))
    await screen.findByRole('img', { name: 'The code a new device scans' })
    expect(screen.queryByRole('button', { name: 'Phone does not open it? Use the number.' })).toBeNull()
  })

  test('the devices that are in are listed, and each is removed alone', async () => {
    let state: object = { ...OPEN, devices: [PHONE, { id: 'fff000fff000', name: 'Mac, Chrome', added: PHONE.added }] }
    const { host, runCommand } = door(args => {
      if (args[0] === 'remove') state = { ...OPEN, devices: [PHONE] }
      return ok(state)
    })
    show(host)
    expect(await screen.findByText('iPhone, Safari')).toBeTruthy()
    expect(screen.getByText('Added 3m ago, last seen 1m ago')).toBeTruthy()
    expect(screen.getByText('Added 3m ago')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Mac, Chrome' }))
    await waitFor(() => expect(runCommand).toHaveBeenCalledWith('p1', ['remove', 'fff000fff000']))
    await waitFor(() => expect(screen.queryByText('Mac, Chrome')).toBeNull())
    expect(screen.getByText('iPhone, Safari')).toBeTruthy()
  })

  test('the devices stay listed with the switch off, so one can still be removed', async () => {
    const { host } = door(() => ok({ ...OFF, devices: [PHONE] }))
    show(host)
    expect(await screen.findByRole('button', { name: 'Remove iPhone, Safari' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add device' })).toBeNull()
  })

  test('a door that could not open says why, and a command that failed says so', async () => {
    const { host } = door(args => (args[0] === 'status' ? ok({ on: true, listening: false, problem: 'Port 4201 is taken by another program on this computer.', devices: [PHONE] }) : { ok: false, error: 'no device has the id abc123def456' }))
    show(host)
    expect(await screen.findByText('Port 4201 is taken by another program on this computer.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add device' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Remove iPhone, Safari' }))
    expect(await screen.findByText('no device has the id abc123def456')).toBeTruthy()
  })

  test('a status that cannot be read is said, not shown as off', async () => {
    const { host } = door(() => ({ ok: false, error: 'remote-access printed no JSON' }))
    show(host)
    expect(await screen.findByText('The devices could not be read: remote-access printed no JSON')).toBeTruthy()
    expect((await theSwitch()).hasAttribute('data-disabled')).toBe(true)
  })
})
