import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ModuleHostContext, type ModuleCommandResult, type ModuleHost } from '@openagt/dashboard/module'
import { DevicesSettings, WARNING } from './DevicesSettings.js'

const OFF = { on: false, listening: false, devices: [] }
const OPEN = { on: true, listening: true, addresses: { name: 'http://adas-macbook.local:4201', number: 'http://192.168.1.23:4201' }, devices: [] }
const PHONE = { id: 'abc123def456', name: 'iPhone, Safari', added: new Date(Date.now() - 3 * 60_000).toISOString(), seen: new Date(Date.now() - 60_000).toISOString() }
const LINK = { url: 'http://adas-macbook.local:4201/_remote-access/enter#code', numberUrl: 'http://192.168.1.23:4201/_remote-access/enter#code', expires: new Date(Date.now() + 5 * 60_000).toISOString() }

/** A host whose `remote-access` command answers what `answer` says for its arguments. */
function door(answer: (args: string[]) => ModuleCommandResult) {
  const runComputerCommand = vi.fn(async (args: string[]) => answer(args))
  const inProject = vi.fn(async () => ({ ok: false as const, error: 'the door is no project\'s' }))
  const host: ModuleHost = {
    package: '@openagt/remote-access',
    runCommand: inProject,
    act: inProject,
    runComputerCommand,
    read: vi.fn(async () => ({ ok: false as const, error: 'no server part' })),
    openAgent: vi.fn(),
    openPage: vi.fn(),
    pageHref: (segment: string) => `/${segment}`,
    startRun: vi.fn(async () => ({ ok: false as const, error: 'not here' })),
    configureRun: vi.fn(),
    agents: vi.fn(async () => []),
    machines: vi.fn(async () => ({ version: '0.0.0', machines: [] })),
    addMachine: vi.fn(async () => ({ ok: false as const, error: 'not here' })),
    removeMachine: vi.fn(async () => ({ ok: false as const, error: 'not here' })),
    watchScreen: vi.fn(async () => undefined),
    sendToScreen: vi.fn(async () => false),
  }
  return { host, runComputerCommand }
}

function show(host: ModuleHost) {
  return render(
    <ModuleHostContext.Provider value={host}>
      <DevicesSettings everyMs={40} />
    </ModuleHostContext.Provider>,
  )
}

const ok = (output: unknown): ModuleCommandResult => ({ ok: true, output })
const theSwitch = (): Promise<HTMLElement> => screen.findByRole('switch', { name: 'Phone on Wi-Fi' })
/** Add device, there whether a device can be added now or not: disabled, it says what to do first. */
const addButton = (): HTMLButtonElement => screen.getByRole('button', { name: 'Add device' }) as HTMLButtonElement
/** Press Add device, and pick "Me" on the dialog's first step. */
async function addForMe(): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: 'Add device' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))
}
const qrPath = (): string => screen.getByRole('img', { name: 'The code a new device scans' }).querySelector('path')!.getAttribute('d')!

afterEach(cleanup)

describe('Settings → Devices', () => {
  test('off: Add device waits for the switch and says so, and the command is asked in no project', async () => {
    const { host, runComputerCommand } = door(() => ok(OFF))
    show(host)
    await waitFor(async () => expect((await theSwitch()).getAttribute('aria-checked')).toBe('false'))
    await waitFor(() => expect((screen.getByRole('switch', { name: 'Phone on Wi-Fi' }) as HTMLButtonElement).hasAttribute('data-disabled')).toBe(false))
    expect(addButton().disabled).toBe(true)
    expect(screen.getByText('Turn on Phone on Wi-Fi first: a device gets in on the same Wi-Fi as this computer.')).toBeTruthy()
    expect(runComputerCommand).toHaveBeenCalledWith(['status'])
    expect(host.runCommand).not.toHaveBeenCalled()
  })

  test('turning it on says first that the link is not locked; Cancel changes nothing, Turn on opens the door', async () => {
    let state: object = OFF
    const { host, runComputerCommand } = door(args => {
      if (args[0] === 'on') state = OPEN
      return ok(state)
    })
    show(host)
    await waitFor(async () => expect((await theSwitch()).hasAttribute('data-disabled')).toBe(false))
    fireEvent.click(await theSwitch())
    expect(screen.getByText(WARNING)).toBeTruthy()
    expect(runComputerCommand).not.toHaveBeenCalledWith(['on'])
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText(WARNING)).toBeNull()
    expect(runComputerCommand).not.toHaveBeenCalledWith(['on'])

    fireEvent.click(await theSwitch())
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }))
    await waitFor(() => expect(runComputerCommand).toHaveBeenCalledWith(['on']))
    await waitFor(() => expect(addButton().disabled).toBe(false))
    expect((await theSwitch()).getAttribute('aria-checked')).toBe('true')
  })

  test('turning it off asks nothing first', async () => {
    let state: object = OPEN
    const { host, runComputerCommand } = door(args => {
      if (args[0] === 'off') state = OFF
      return ok(state)
    })
    show(host)
    await waitFor(() => expect(addButton().disabled).toBe(false))
    fireEvent.click(await theSwitch())
    await waitFor(() => expect(runComputerCommand).toHaveBeenCalledWith(['off']))
    await waitFor(() => expect(addButton().disabled).toBe(true))
    expect(screen.queryByText(WARNING)).toBeNull()
  })

  test('Add device shows the code of the link by the name, and the number on request', async () => {
    const { host } = door(args => (args[0] === 'add' ? ok(LINK) : ok(OPEN)))
    show(host)
    await addForMe()
    await screen.findByRole('img', { name: 'The code a new device scans' })
    const byName = qrPath()
    expect(screen.getByRole('timer').textContent).toMatch(/^Works once, for [45]:\d\d more\.$/)
    // The same link as text, for another computer to paste where a phone scans.
    expect(screen.getByText('Another computer that runs OpenAgent? Paste the link there, in Settings › Machines › Add machine.')).toBeTruthy()
    const pasted = (): string => (screen.getByRole('textbox', { name: 'The link' }) as HTMLInputElement).value
    expect(pasted()).toBe(LINK.url)
    fireEvent.click(screen.getByRole('button', { name: 'Phone does not open it? Use the number.' }))
    expect(qrPath()).not.toBe(byName)
    expect(pasted()).toBe(LINK.numberUrl)
    expect(screen.queryByRole('button', { name: 'Phone does not open it? Use the number.' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByRole('img', { name: 'The code a new device scans' })).toBeNull())
  })

  test('once a new device got in with the code the dialog says which, in place of the code; not for a read that tells an older list', async () => {
    let devices: object[] = [PHONE]
    const { host } = door(args => (args[0] === 'add' ? ok(LINK) : ok({ ...OPEN, devices })))
    show(host)
    await addForMe()
    await screen.findByRole('img', { name: 'The code a new device scans' })
    // A device fewer is no device got in: the code stays.
    devices = []
    await waitFor(() => expect(screen.queryByText('iPhone, Safari')).toBeNull())
    expect(screen.getByRole('img', { name: 'The code a new device scans' })).toBeTruthy()
    devices = [{ id: 'new000new000', name: 'Android phone, Chrome', added: new Date().toISOString() }]
    expect(await screen.findByText('Android phone, Chrome', undefined)).toBeTruthy()
    expect(await screen.findByText('Android phone, Chrome is in.')).toBeTruthy()
    expect(screen.queryByRole('img', { name: 'The code a new device scans' })).toBeNull()

    // A computer that gets in again is a new id under the row it had, and no new row: the code is spent all the same.
    fireEvent.click(screen.getByRole('button', { name: 'Add another' }))
    await screen.findByRole('img', { name: 'The code a new device scans' })
    devices = [{ id: 'new000new000', name: 'Android phone, Chrome', added: new Date().toISOString(), also: ['again0again0'] }]
    expect(await screen.findByText('Android phone, Chrome is in.')).toBeTruthy()
    expect(screen.queryByRole('img', { name: 'The code a new device scans' })).toBeNull()
  })

  test('a removed device does not come back from a read that was on its way before the removal', async () => {
    let late: ((result: ModuleCommandResult) => void) | undefined
    let removed = false
    const runComputerCommand = vi.fn(async (args: string[]): Promise<ModuleCommandResult> => {
      if (args[0] === 'remove') {
        removed = true
        // The read that was on its way lands now, telling the list from before.
        late?.(ok({ ...OPEN, devices: [PHONE] }))
        return ok(OPEN)
      }
      // Every read made after the removal is still on its way when the page is looked at.
      if (removed) return new Promise(() => {})
      if (late === undefined && runComputerCommand.mock.calls.length > 1) return new Promise(resolve => (late = resolve))
      return ok({ ...OPEN, devices: [PHONE] })
    })
    const { host } = door(() => ok(OPEN))
    show({ ...host, runComputerCommand })
    const remove = await screen.findByRole('button', { name: 'Remove iPhone, Safari' })
    await waitFor(() => expect(late).toBeDefined())
    fireEvent.click(remove)
    await waitFor(() => expect(screen.queryByText('iPhone, Safari')).toBeNull())
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(screen.queryByText('iPhone, Safari')).toBeNull()
  })

  test('on a server there is no switch: the section says where the door is open, gives one link, and says why a certificate is missing', async () => {
    const SERVER = { on: false, listening: true, https: { address: '203.0.113.5' }, devices: [] }
    const link = { url: 'https://203.0.113.5/_remote-access/enter#code.pin', expires: LINK.expires }
    const { host } = door(args => (args[0] === 'add' ? ok(link) : ok(SERVER)))
    const { unmount } = show(host)
    expect(await screen.findByText('Open on the internet')).toBeTruthy()
    expect(screen.getByText(/opens OpenAgent at https:\/\/203\.0\.113\.5 from anywhere/)).toBeTruthy()
    expect(screen.queryByRole('switch')).toBeNull()
    await addForMe()
    await screen.findByRole('img', { name: 'The code a new device scans' })
    expect(screen.getByText("Scan it with the device's camera: it opens OpenAgent here, from anywhere.")).toBeTruthy()
    expect((screen.getByRole('textbox', { name: 'The link' }) as HTMLInputElement).value).toBe(link.url)
    expect(screen.queryByRole('button', { name: 'Phone does not open it? Use the number.' })).toBeNull()
    unmount()

    const waiting = { on: false, listening: false, problem: 'No certificate for 203.0.113.5 yet: port 80 cannot be reached', https: { address: '203.0.113.5' }, devices: [] }
    show(door(() => ok(waiting)).host)
    expect((await screen.findByRole('alert')).textContent).toBe('No certificate for 203.0.113.5 yet: port 80 cannot be reached')
    expect(addButton().disabled).toBe(true)
  })

  test('a computer with no name offers no second code', async () => {
    const { host } = door(args => (args[0] === 'add' ? ok({ url: LINK.numberUrl, expires: LINK.expires }) : ok(OPEN)))
    show(host)
    await addForMe()
    await screen.findByRole('img', { name: 'The code a new device scans' })
    expect(screen.queryByRole('button', { name: 'Phone does not open it? Use the number.' })).toBeNull()
  })

  test('a computer that keeps a line open here is listed by its own name, and says what it is', async () => {
    const { host } = door(() => ok({ ...OPEN, devices: [PHONE, { id: 'aaa111aaa111', name: 'Adas-MacBook', added: PHONE.added, line: true }] }))
    show(host)
    expect(await screen.findByText('Adas-MacBook')).toBeTruthy()
    expect(screen.getAllByText('A computer of yours: runs can be started on it from here. Remove it and it is no longer in "Run on".')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Remove Adas-MacBook' })).toBeTruthy()
  })

  test('the devices that are in are listed, and each is removed alone', async () => {
    let state: object = { ...OPEN, devices: [PHONE, { id: 'fff000fff000', name: 'Mac, Chrome', added: PHONE.added }] }
    const { host, runComputerCommand } = door(args => {
      if (args[0] === 'remove') state = { ...OPEN, devices: [PHONE] }
      return ok(state)
    })
    show(host)
    expect(await screen.findByText('iPhone, Safari')).toBeTruthy()
    expect(screen.getByText('Last seen 1m ago, added 3m ago')).toBeTruthy()
    expect(screen.getByText('Added 3m ago')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Mac, Chrome' }))
    await waitFor(() => expect(runComputerCommand).toHaveBeenCalledWith(['remove', 'fff000fff000']))
    await waitFor(() => expect(screen.queryByText('Mac, Chrome')).toBeNull())
    expect(screen.getByText('iPhone, Safari')).toBeTruthy()
  })

  test('the devices stay listed with the switch off, so one can still be removed', async () => {
    const { host } = door(() => ok({ ...OFF, devices: [PHONE] }))
    show(host)
    expect(await screen.findByRole('button', { name: 'Remove iPhone, Safari' })).toBeTruthy()
    expect(addButton().disabled).toBe(true)
  })

  test('a door that could not open says why, and a command that failed says so', async () => {
    const { host } = door(args => (args[0] === 'status' ? ok({ on: true, listening: false, problem: 'Port 4201 is taken by another program on this computer.', devices: [PHONE] }) : { ok: false, error: 'no device has the id abc123def456' }))
    show(host)
    expect(await screen.findByText('Port 4201 is taken by another program on this computer.')).toBeTruthy()
    expect(addButton().disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Remove iPhone, Safari' }))
    expect(await screen.findByText('no device has the id abc123def456')).toBeTruthy()
  })

  test('a status that cannot be read is said, not shown as off', async () => {
    const { host } = door(() => ({ ok: false, error: 'remote-access printed no JSON' }))
    show(host)
    expect(await screen.findByText('The devices could not be read: remote-access printed no JSON')).toBeTruthy()
    expect((await theSwitch()).hasAttribute('data-disabled')).toBe(true)
  })

  test('Someone else: the owner says who they are first, by this computer\'s GitHub account, then the code is for the person typed', async () => {
    let persons: unknown[] = []
    let devices: unknown[] = []
    const { host, runComputerCommand } = door(args => {
      if (args[0] === 'github') return ok({ account: 'ada' })
      if (args[0] === 'owner') return (persons = [{ account: args[1], owner: true }]), ok({ ...OPEN, persons })
      if (args[0] === 'add') return ok(LINK)
      return ok({ ...OPEN, persons, devices })
    })
    show(host)
    fireEvent.click(await screen.findByRole('button', { name: 'Add device' }))
    fireEvent.click(await screen.findByRole('radio', { name: /Someone else/ }))
    const field = await screen.findByRole('textbox', { name: 'Their GitHub account' })
    fireEvent.change(field, { target: { value: 'not an account!' } })
    expect(screen.getByText('That is not a GitHub account.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(field, { target: { value: '@Rom' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('First, who are you? This computer is logged in to GitHub as @ada.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: "Yes, that's me" }))
    expect(await screen.findByText('For @rom. Send them the link.')).toBeTruthy()
    expect(runComputerCommand).toHaveBeenCalledWith(['owner', 'ada'])
    expect(runComputerCommand).toHaveBeenCalledWith(['add', '--for', 'rom'])
    // The page goes on reading the list: the device that gets in with the code is told.
    devices = [{ ...PHONE, person: 'rom' }]
    expect(await screen.findByText('iPhone, Safari is in.')).toBeTruthy()
  })

  test('with no GitHub login here, the dialog says so and asks nobody to be named', async () => {
    const { host, runComputerCommand } = door(args => (args[0] === 'github' ? ok({ problem: 'gh is not logged in to github.com here: run gh auth login.' }) : ok(OPEN)))
    show(host)
    fireEvent.click(await screen.findByRole('button', { name: 'Add device' }))
    fireEvent.click(await screen.findByRole('radio', { name: /Someone else/ }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Their GitHub account' }), { target: { value: 'rom' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('gh is not logged in to github.com here: run gh auth login.')).toBeTruthy()
    expect(runComputerCommand.mock.calls.some(([args]) => args[0] === 'owner' || args[0] === 'add')).toBe(false)
  })

  test('once named, the owner is not asked again, and the devices are listed by person; a person is removed with their devices', async () => {
    const persons = [{ account: 'ada', owner: true }, { account: 'rom' }, { account: 'eve' }]
    const devices = [{ ...PHONE, person: 'ada' }, { ...PHONE, id: 'fed654cba321', name: 'Pixel, Chrome', person: 'rom' }]
    const { host, runComputerCommand } = door(args => (args[0] === 'add' ? ok(LINK) : ok({ ...OPEN, persons, devices })))
    show(host)
    expect(await screen.findByText('@ada, the owner')).toBeTruthy()
    expect(screen.getByRole('list', { name: 'Devices of @rom' }).textContent).toContain('Pixel, Chrome')
    expect(screen.getByRole('list', { name: 'Devices of @ada' }).textContent).toContain('iPhone, Safari')
    expect(screen.getByText('No device yet.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Remove @ada' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Remove @rom' }))
    await waitFor(() => expect(runComputerCommand).toHaveBeenCalledWith(['remove-person', 'rom']))

    await addForMe()
    fireEvent.click(await screen.findByRole('button', { name: 'Done' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Add device' }))
    fireEvent.click(await screen.findByRole('radio', { name: /Someone else/ }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Their GitHub account' }), { target: { value: 'eve' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('For @eve. Send them the link.')).toBeTruthy()
    expect(runComputerCommand.mock.calls.some(([args]) => args[0] === 'github' || args[0] === 'owner')).toBe(false)
  })
})
