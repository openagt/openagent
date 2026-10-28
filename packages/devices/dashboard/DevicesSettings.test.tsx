import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ModuleHostContext, type ModuleCommandResult, type ModuleComputerThrough, type ModuleHost, type ModuleMachine, type ModuleMachines } from '@openagt/dashboard/module'
import { DevicesSettings } from './DevicesSettings.js'
import { WARNING } from './ThisComputer.js'

// Settings › Devices, this computer's side: how devices reach it, the start page, and every
// device once in one list. The servers' pages are ServerPage.test.tsx's.

const OFF = { on: false, listening: false, devices: [], persons: [] }
const OPEN = { on: true, listening: true, devices: [], persons: [] }
const PHONE = { id: 'abc123def456', name: 'iPhone, Safari', added: new Date(Date.now() - 3 * 60_000).toISOString(), seen: new Date(Date.now() - 60_000).toISOString() }
const LINK = { url: 'http://adas-macbook.local:4201/_devices/enter#code', numberUrl: 'http://192.168.1.23:4201/_devices/enter#code', expires: new Date(Date.now() + 5 * 60_000).toISOString() }

/**
 * A host whose `devices` command (this computer's door) answers what `answer` says for its words,
 * whose `devices server` command answers `server`'s (no server, unless said), with these machines saved.
 */
function door(answer: (args: string[], input?: string) => ModuleCommandResult | Promise<ModuleCommandResult>, saved: ModuleMachine[] = [], server: (args: string[]) => ModuleCommandResult = () => ok({ servers: [] })) {
  const runComputerCommand = vi.fn(async (args: string[], input?: string) => answer(args, input))
  const serverCommand = vi.fn(async (args: string[]) => server(args))
  const inProject = vi.fn(async () => ({ ok: false as const, error: 'the door is no project\'s' }))
  const machines = vi.fn(async (): Promise<ModuleMachines> => ({ version: '0.0.0', name: 'Adas-MacBook', machines: saved }))
  const host: ModuleHost = {
    package: '@openagt/devices',
    runCommand: inProject,
    act: inProject,
    runComputerCommand: vi.fn(async (args: string[], _command?: string, input?: string) => (args[0] === 'server' ? serverCommand(args.slice(1)) : input === undefined ? runComputerCommand(args) : runComputerCommand(args, input))),
    runComputerCommandOn: vi.fn(async () => ({ ok: false as const, error: 'not here' })),
    read: vi.fn(async () => ({ ok: false as const, error: 'no server part' })),
    openAgent: vi.fn(),
    openPage: vi.fn(),
    pageHref: (segment: string) => `/${segment}`,
    openSettings: vi.fn(),
    gitHostPeople: vi.fn(async () => []),
    startRun: vi.fn(async () => ({ ok: false as const, error: 'not here' })),
    configureRun: vi.fn(),
    agents: vi.fn(async () => []),
    machines,
    addMachine: vi.fn(async () => ({ ok: true as const })),
    removeMachine: vi.fn(async () => ({ ok: true as const })),
    renameMachine: vi.fn(async () => ({ ok: true as const })),
    letMachineIn: vi.fn(async () => ({ ok: true as const })),
    machineCode: vi.fn(async () => ({ ok: false as const, error: 'not here' })),
    computersThrough: vi.fn(async () => ({ ok: true as const, computers: [] })),
    machinePerson: vi.fn(async () => ({ ok: false as const, error: 'not here', unknown: true as const })),
    removeMachineDevice: vi.fn(async () => ({ ok: false as const, error: 'not here' })),
    useLoginsOn: vi.fn(async () => ({ ok: true as const })),
    addComputerThrough: vi.fn(async () => ({ ok: false as const, error: 'not here' })),
    watchScreen: vi.fn(async () => undefined),
    sendToScreen: vi.fn(async () => false),
  }
  return { host, runComputerCommand, serverCommand }
}

function show(host: ModuleHost) {
  return render(
    <ModuleHostContext.Provider value={host}>
      <DevicesSettings everyMs={40} />
    </ModuleHostContext.Provider>,
  )
}

const ok = (output: unknown): ModuleCommandResult => ({ ok: true, output })
const theSwitch = (): Promise<HTMLElement> => screen.findByRole('switch', { name: 'On this Wi-Fi' })
/** Add device › Phone or tablet, as a person picks it: the first of the kinds. */
async function addPhone(): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: /^(Add device|Add phone)$/ }))
  const go = screen.queryByRole('button', { name: 'Continue' })
  if (go) fireEvent.click(go)
}
/** What "Copy the link" puts on the clipboard. */
async function copiedLink(): Promise<string> {
  const writeText = vi.fn(async (_text: string) => {})
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  fireEvent.click(screen.getByRole('button', { name: /^Cop(y|ied) the link$/ }))
  await waitFor(() => expect(writeText).toHaveBeenCalled())
  return writeText.mock.calls.at(-1)![0]
}
const qrPath = (): string => screen.getByRole('img', { name: 'The code a new device scans' }).querySelector('path')!.getAttribute('d')!
/** A row's menu, then one of its items. */
async function fromMenu(row: string, item: string): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: `${row}: more` }))
  fireEvent.click(await screen.findByRole('menuitem', { name: item }))
}
const open = async (name: string): Promise<void> => void fireEvent.click(within(await screen.findByRole('listitem', { name })).getByRole('button'))
/** Add computer: from the start page's card, or Add device › Computer. */
async function addComputer(): Promise<void> {
  const press = await screen.findByRole('button', { name: /^(Add computer|Add device)$/ })
  fireEvent.click(press)
  if (press.textContent === 'Add computer') return
  fireEvent.click(await screen.findByRole('radio', { name: /^Computer/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
}

afterEach(cleanup)

describe('Settings › Devices: this computer, and how devices reach it', () => {
  test('with nothing in: this computer, nothing reaches it, and the three things to start with; the words say "same Wi-Fi" while there is no server', async () => {
    const { host, runComputerCommand } = door(() => ok(OFF))
    show(host)
    const card = within(await screen.findByRole('region', { name: 'This computer' }))
    expect(card.getByText('Adas-MacBook')).toBeTruthy()
    expect(card.getByText("Nothing reaches it yet: only this computer's own browser opens OpenAgent.")).toBeTruthy()
    expect(screen.getByText('Add your first device')).toBeTruthy()
    expect(screen.getByText('Start runs and answer your agents from your phone, on the same Wi-Fi as this computer.')).toBeTruthy()
    expect(screen.getByText('Run agents on your other Mac or PC, on the same Wi-Fi as this computer.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Set up a server' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Join with a code' })).toBeTruthy()
    // Only the server's card says "anywhere": nothing reaches this computer from anywhere yet.
    expect(screen.getByText('Always on. Your phone and computers reach each other from anywhere, and you can share it with people.')).toBeTruthy()
    expect(screen.queryByText(/^From anywhere/)).toBeNull()
    expect(runComputerCommand).toHaveBeenCalledWith(['status'])
    expect(host.runCommand).not.toHaveBeenCalled()
  })

  test('a phone on this Wi-Fi with the door shut: it is opened first, after saying the link is not locked', async () => {
    let state: object = OFF
    const { host, runComputerCommand } = door(args => {
      if (args[0] === 'on') state = OPEN
      return ok(args[0] === 'add' ? LINK : state)
    })
    show(host)
    await addPhone()
    expect(await screen.findByText(WARNING)).toBeTruthy()
    expect(runComputerCommand).not.toHaveBeenCalledWith(['on'])
    fireEvent.click(screen.getByRole('button', { name: 'Turn on and show the code' }))
    await waitFor(() => expect(runComputerCommand).toHaveBeenCalledWith(['on']))
    await screen.findByRole('img', { name: 'The code a new device scans' })
  })

  test('turning the Wi-Fi switch on says first that the link is not locked; Cancel changes nothing, Turn on opens the door', async () => {
    let state: object = { ...OFF, devices: [PHONE] }
    const { host, runComputerCommand } = door(args => {
      if (args[0] === 'on') state = { ...OPEN, devices: [PHONE] }
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
    await waitFor(async () => expect((await theSwitch()).getAttribute('aria-checked')).toBe('true'))
  })

  test('turning it off asks nothing first', async () => {
    let state: object = { ...OPEN, devices: [PHONE] }
    const { host, runComputerCommand } = door(args => {
      if (args[0] === 'off') state = { ...OFF, devices: [PHONE] }
      return ok(state)
    })
    show(host)
    await waitFor(async () => expect((await theSwitch()).getAttribute('aria-checked')).toBe('true'))
    fireEvent.click(await theSwitch())
    await waitFor(() => expect(runComputerCommand).toHaveBeenCalledWith(['off']))
    await waitFor(async () => expect((await theSwitch()).getAttribute('aria-checked')).toBe('false'))
    expect(screen.queryByText(WARNING)).toBeNull()
  })

  test('Add phone shows the code of the link by the name, and the number on request', async () => {
    const { host } = door(args => (args[0] === 'add' ? ok(LINK) : ok(OPEN)))
    show(host)
    await addPhone()
    await screen.findByRole('img', { name: 'The code a new device scans' })
    const byName = qrPath()
    expect(screen.getByRole('timer').textContent).toMatch(/^Waiting for the phone… works once, for [45]:\d\d\.$/)
    expect(screen.getByText("Open the phone's camera and point it at the code.")).toBeTruthy()
    expect(screen.getByText('Tap the link it shows. OpenAgent opens, and stays in.')).toBeTruthy()
    expect(await copiedLink()).toBe(LINK.url)
    fireEvent.click(screen.getByRole('button', { name: 'Phone does not open it? Use the number.' }))
    expect(qrPath()).not.toBe(byName)
    expect(await copiedLink()).toBe(LINK.numberUrl)
    expect(screen.queryByRole('button', { name: 'Phone does not open it? Use the number.' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('img', { name: 'The code a new device scans' })).toBeNull())
  })

  test('once a new device got in with the code the dialog says which, in place of the code; not for a read that tells an older list', async () => {
    let devices: object[] = [PHONE]
    const { host } = door(args => (args[0] === 'add' ? ok(LINK) : ok({ ...OPEN, devices })))
    show(host)
    await addPhone()
    await screen.findByRole('img', { name: 'The code a new device scans' })
    // A device fewer is no device got in: the code stays.
    devices = []
    await waitFor(() => expect(screen.queryByRole('listitem', { name: 'iPhone, Safari' })).toBeNull())
    expect(screen.getByRole('img', { name: 'The code a new device scans' })).toBeTruthy()
    devices = [{ id: 'new000new000', name: 'Android phone, Chrome', added: new Date().toISOString() }]
    expect(await screen.findByText('Android phone, Chrome is in.')).toBeTruthy()
    expect(screen.queryByRole('img', { name: 'The code a new device scans' })).toBeNull()
  })

  test('a removed device does not come back from a read that was on its way before the removal', async () => {
    let late: ((result: ModuleCommandResult) => void) | undefined
    let removed = false
    let reads = 0
    const { host } = door(() => ok(OPEN))
    const runComputerCommand = vi.fn(async (args: string[]): Promise<ModuleCommandResult> => {
      if (args[0] === 'server') return ok({ servers: [] })
      if (args[0] === 'remove') {
        removed = true
        // The read that was on its way lands now, telling the list from before.
        late?.(ok({ ...OPEN, devices: [PHONE] }))
        return ok(OPEN)
      }
      // Every read made after the removal is still on its way when the page is looked at.
      if (removed) return new Promise(() => {})
      if (late === undefined && ++reads > 1) return new Promise(resolve => (late = resolve))
      return ok({ ...OPEN, devices: [PHONE] })
    })
    show({ ...host, runComputerCommand })
    await screen.findByRole('listitem', { name: 'iPhone, Safari' })
    await waitFor(() => expect(late).toBeDefined())
    await fromMenu('iPhone, Safari', 'Remove')
    await waitFor(() => expect(screen.queryByRole('listitem', { name: 'iPhone, Safari' })).toBeNull())
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(screen.queryByRole('listitem', { name: 'iPhone, Safari' })).toBeNull()
  })

  test('on a server there is no switch: the card says where the door is open, a phone gets one link, and a missing certificate is said', async () => {
    const SERVER = { on: false, listening: true, https: { address: '203.0.113.5' }, devices: [], persons: [] }
    const link = { url: 'https://203.0.113.5/_devices/enter#code.pin', expires: LINK.expires }
    const { host } = door(args => (args[0] === 'add' ? ok(link) : ok(SERVER)), [], () => ok({ server: true, servers: [] }))
    const { unmount } = show(host)
    expect(await screen.findByText('On the internet')).toBeTruthy()
    expect(screen.getByText(/opens OpenAgent at https:\/\/203\.0\.113\.5 from anywhere/)).toBeTruthy()
    expect(screen.queryByRole('switch')).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: 'Add device' }))
    // A server sets up no server.
    expect(screen.queryByRole('radio', { name: /^Server/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    // Who it is for, on a computer several people use: "Me".
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))
    await screen.findByRole('img', { name: 'The code a new device scans' })
    expect(await copiedLink()).toBe(link.url)
    expect(screen.queryByRole('button', { name: 'Phone does not open it? Use the number.' })).toBeNull()
    unmount()

    const waiting = { on: false, listening: false, problem: 'No certificate for 203.0.113.5 yet: port 80 cannot be reached', https: { address: '203.0.113.5' }, devices: [], persons: [] }
    show(door(() => ok(waiting), [], () => ok({ server: true, servers: [] })).host)
    expect((await screen.findByRole('alert')).textContent).toBe('No certificate for 203.0.113.5 yet: port 80 cannot be reached')
  })

  test('On your Tailscale network: its switch puts the door behind Tailscale, the card says where, the Wi-Fi switch is gone, and a phone gets the link on Tailscale', async () => {
    const BEHIND = { on: false, listening: true, tailscale: { address: 'laptop.tail1234.ts.net' }, devices: [PHONE], persons: [] }
    const link = { url: 'https://laptop.tail1234.ts.net/_devices/enter#code', expires: LINK.expires }
    let state: unknown = OPEN
    const { host, runComputerCommand } = door(args => {
      if (args[0] === 'tailscale') state = args[1] === 'on' ? BEHIND : OPEN
      return args[0] === 'add' ? ok(link) : ok(state)
    })
    show(host)
    fireEvent.click(await screen.findByRole('switch', { name: 'On your Tailscale network' }))
    await waitFor(() => expect(runComputerCommand).toHaveBeenCalledWith(['tailscale', 'on']))
    expect(await screen.findByText(/open OpenAgent at https:\/\/laptop\.tail1234\.ts\.net, from anywhere/)).toBeTruthy()
    expect(screen.queryByRole('switch', { name: 'On this Wi-Fi' })).toBeNull()
    // The phones in reach it there now.
    expect(await screen.findByText(/on your Tailscale network/)).toBeTruthy()
    await addPhone()
    await screen.findByRole('img', { name: 'The code a new device scans' })
    expect(await copiedLink()).toBe(link.url)
  })

  test('with nothing in, the start page offers Tailscale too: one press puts the door behind it, and says why when it cannot', async () => {
    const BEHIND = { on: false, listening: true, tailscale: { address: 'laptop.tail1234.ts.net' }, devices: [], persons: [] }
    let state: unknown = OFF
    const { host, runComputerCommand } = door(args => {
      if (args[0] === 'tailscale') state = BEHIND
      return ok(state)
    })
    show(host)
    fireEvent.click(await screen.findByRole('button', { name: 'Reach this computer on your Tailscale network' }))
    await waitFor(() => expect(runComputerCommand).toHaveBeenCalledWith(['tailscale', 'on']))
    expect(await screen.findByText(/open OpenAgent at https:\/\/laptop\.tail1234\.ts\.net, from anywhere/)).toBeTruthy()
    expect(screen.getByText('None yet. Add device: a phone or a computer on your Tailscale network.')).toBeTruthy()
    cleanup()
    const signedOut = door(args => (args[0] === 'tailscale' ? { ok: false, error: 'Tailscale is not signed in on this computer. Sign in to Tailscale, then turn this on again.' } : ok(OFF)))
    show(signedOut.host)
    fireEvent.click(await screen.findByRole('button', { name: 'Reach this computer on your Tailscale network' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Tailscale is not signed in on this computer. Sign in to Tailscale, then turn this on again.')
  })

  test('behind Tailscale with Serve off for the network: what is in the way is said, with a press to the page in Tailscale that turns it on; Add phone says the same', async () => {
    const OFF_THERE = { on: false, listening: false, tailscale: { address: 'laptop.tail1234.ts.net' }, problem: 'Serve is off on your Tailscale network. Turn it on once in your Tailscale account; the door opens by itself then.', fixAt: 'https://login.tailscale.com/f/serve?node=n1', devices: [PHONE], persons: [] }
    show(door(() => ok(OFF_THERE)).host)
    expect((await screen.findByRole('alert')).textContent).toBe(OFF_THERE.problem)
    // Not open yet: where it will be, not that devices open it there.
    expect(screen.getByText('At https://laptop.tail1234.ts.net once Tailscale serves it.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Turn on Serve' }).getAttribute('href')).toBe('https://login.tailscale.com/f/serve?node=n1')
    await addPhone()
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(OFF_THERE.problem)).toBeTruthy()
    expect(within(dialog).getByRole('link', { name: 'Turn on Serve' }).getAttribute('href')).toBe('https://login.tailscale.com/f/serve?node=n1')
    cleanup()
    // Only Tailscale's own page is linked to.
    show(door(() => ok({ ...OFF_THERE, fixAt: 'https://evil.example/' })).host)
    await screen.findByRole('alert')
    expect(screen.queryByRole('link', { name: 'Turn on Serve' })).toBeNull()
  })

  test('a computer with no name offers no second code', async () => {
    const { host } = door(args => (args[0] === 'add' ? ok({ url: LINK.numberUrl, expires: LINK.expires }) : ok(OPEN)))
    show(host)
    await addPhone()
    await screen.findByRole('img', { name: 'The code a new device scans' })
    expect(screen.queryByRole('button', { name: 'Phone does not open it? Use the number.' })).toBeNull()
  })

  test('the devices that are in are listed, each with when it was last seen, and each is removed alone, also with the switch off', async () => {
    let state: object = { ...OFF, devices: [PHONE, { id: 'fff000fff000', name: 'Mac, Chrome', added: PHONE.added }] }
    const { host, runComputerCommand } = door(args => {
      if (args[0] === 'remove') state = { ...OFF, devices: [PHONE] }
      return ok(state)
    })
    show(host)
    const phone = await screen.findByRole('listitem', { name: 'iPhone, Safari' })
    expect(phone.textContent).toContain('Phone')
    expect(phone.textContent).toContain('on this Wi-Fi')
    expect(phone.textContent).toContain('last seen 1m ago')
    expect(screen.getByRole('listitem', { name: 'Mac, Chrome' }).textContent).toContain('Browser')
    expect(screen.getByRole('listitem', { name: 'Mac, Chrome' }).textContent).toContain('added 3m ago')
    await fromMenu('Mac, Chrome', 'Remove')
    await waitFor(() => expect(runComputerCommand).toHaveBeenCalledWith(['remove', 'fff000fff000']))
    await waitFor(() => expect(screen.queryByRole('listitem', { name: 'Mac, Chrome' })).toBeNull())
    expect(screen.getByRole('listitem', { name: 'iPhone, Safari' })).toBeTruthy()
  })

  test('a phone is renamed from its menu: the door calls it by the name picked', async () => {
    let name = PHONE.name
    const { host, runComputerCommand } = door(args => {
      if (args[0] === 'rename') name = args[2]!
      return ok({ ...OPEN, devices: [{ ...PHONE, name }] })
    })
    show(host)
    await fromMenu('iPhone, Safari', 'Rename')
    fireEvent.change(await screen.findByRole('textbox', { name: 'Name' }), { target: { value: ' My phone ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(runComputerCommand).toHaveBeenCalledWith(['rename', PHONE.id, 'My phone']))
    expect(await screen.findByRole('listitem', { name: 'My phone' })).toBeTruthy()
  })

  test('a door that could not open says why, and a command that failed says so', async () => {
    const { host } = door(args => (args[0] === 'status' ? ok({ on: true, listening: false, problem: 'Port 4201 is taken by another program on this computer.', devices: [PHONE], persons: [] }) : { ok: false, error: 'no device has the id abc123def456' }))
    show(host)
    expect(await screen.findByText('Port 4201 is taken by another program on this computer.')).toBeTruthy()
    await fromMenu('iPhone, Safari', 'Remove')
    expect(await screen.findByText('no device has the id abc123def456')).toBeTruthy()
  })

  test('a status that cannot be read is said, not shown as off', async () => {
    const { host } = door(() => ({ ok: false, error: 'devices printed no JSON' }))
    show(host)
    expect(await screen.findByText('The devices could not be read: devices printed no JSON')).toBeTruthy()
  })
})

describe('Settings › Devices: another computer, once', () => {
  const STUDIO: ModuleMachine = { id: 'http://studio.local:4201', label: 'Studio Mac', url: 'http://studio.local:4201', version: '1.2.3', listed: ['5d1234567890', 'ffeeddccbbaa'] }
  // The same computer in at this one's door: its OpenAgent says the same name as another computer would.
  const IN_HERE = { id: '5d1234567890', name: 'OpenAgent on Studio', added: PHONE.added, seen: PHONE.seen }

  test('a computer saved here and in at this door is one row, by the id it is listed under here; a computer that only says the same name is another', async () => {
    const LOOKALIKE = { id: 'aaaa00000000', name: 'OpenAgent on Studio', added: PHONE.added }
    const { host } = door(() => ok({ ...OPEN, devices: [IN_HERE, LOOKALIKE] }), [STUDIO])
    show(host)
    const studio = await screen.findByRole('listitem', { name: 'Studio Mac' })
    expect(studio.textContent).toContain('runs go both ways')
    expect(studio.textContent).toContain('Online')
    // The other one, named alike, starts runs here and is not saved: its own row, by its own name.
    const other = screen.getByRole('listitem', { name: 'Studio' })
    expect(other.textContent).toContain('starts runs here')
    expect(within(screen.getByRole('list', { name: 'Your devices' })).getAllByRole('listitem')).toHaveLength(2)
  })

  test('a computer only saved here: on its page, "can start runs here" turns on in one press: this door gives a link, and the computer saves it', async () => {
    let devices: object[] = []
    const { host, runComputerCommand } = door(args => {
      if (args[0] === 'add') return (devices = [IN_HERE]), ok(LINK)
      return ok({ ...OPEN, devices })
    }, [STUDIO])
    show(host)
    expect((await screen.findByRole('listitem', { name: 'Studio Mac' })).textContent).toContain('your runs go there')
    await open('Studio Mac')
    expect(await screen.findByText('Off. Turn it on: Studio Mac is told this computer\'s link, and saves it.')).toBeTruthy()
    fireEvent.click(screen.getByRole('switch', { name: 'Studio Mac can start runs here' }))
    await waitFor(() => expect(host.letMachineIn).toHaveBeenCalledWith(STUDIO.id, LINK.url))
    expect(runComputerCommand).toHaveBeenCalledWith(['add'])
    // The page stays open as the computer becomes both: its runs go both ways.
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Studio Mac can start runs here' }).getAttribute('aria-checked')).toBe('true'))
    expect(screen.getByText(/runs go both ways/)).toBeTruthy()
  })

  test('with the door shut, the computer cannot be let in, and the page says what to do first; off takes it out here, and Remove forgets both ways', async () => {
    let state: object = { ...OFF, devices: [IN_HERE] }
    const { host, runComputerCommand } = door(args => {
      if (args[0] === 'remove') state = { ...OFF, devices: [] }
      return ok(state)
    }, [STUDIO])
    show(host)
    await open('Studio Mac')
    const here = await screen.findByRole('switch', { name: 'Studio Mac can start runs here' })
    expect(here.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(here)
    await waitFor(() => expect(runComputerCommand).toHaveBeenCalledWith(['remove', IN_HERE.id]))
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Studio Mac can start runs here' }).getAttribute('aria-checked')).toBe('false'))
    fireEvent.click(screen.getByRole('switch', { name: 'Studio Mac can start runs here' }))
    expect(await screen.findByText('Turn on "On this Wi-Fi" first: the other computer gets in here through it.')).toBeTruthy()
    expect(host.letMachineIn).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Remove Studio Mac' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(host.removeMachine).toHaveBeenCalledWith(STUDIO.id))
  })

  test('a computer is renamed on its page: a saved one as OpenAgent saves it, one only in here as the door calls it', async () => {
    const { host, runComputerCommand } = door(() => ok({ ...OPEN, devices: [{ ...IN_HERE, id: 'bbbb00000000' }] }), [STUDIO])
    show(host)
    await open('Studio Mac')
    fireEvent.click(await screen.findByRole('button', { name: 'Rename' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Studio' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(host.renameMachine).toHaveBeenCalledWith(STUDIO.id, 'Studio'))
    fireEvent.click(screen.getByRole('button', { name: 'Back to Devices' }))

    await open('Studio')
    fireEvent.click(await screen.findByRole('button', { name: 'Rename' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Old iMac' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(runComputerCommand).toHaveBeenCalledWith(['rename', 'bbbb00000000', 'Old iMac']))
  })

  const FOUND = { name: 'Studio Mac', version: '0.36.0', url: 'http://192.168.1.5:4201' }
  /** The other computer's door as a computer here hears it: found, asked, then answered as `heard` says, look after look. */
  function pairing(status: object, heard: string[]) {
    return door((args, input) => {
      if (args[0] === 'find') return ok({ found: [FOUND, { name: "Dani's iMac", url: 'http://192.168.1.9:4301' }] })
      if (args[0] === 'ask') return ok({ number: '482913', secret: 's3cret', expires: new Date(Date.now() + 120_000).toISOString() })
      if (args[0] === 'ask-answer') {
        expect(input).toBe('s3cret')
        const state = heard.shift() ?? 'waiting'
        return ok(state === 'allowed' ? { state, link: 'http://studio.local:4201/_devices/enter#K7P4QX9M', numberLink: 'http://192.168.1.5:4201/_devices/enter#K7P4QX9M' } : { state })
      }
      if (args[0] === 'ask-cancel') return ok({ ok: true })
      return ok(args[0] === 'add' ? LINK : status)
    })
  }

  test('Add computer lists the computers found on this Wi-Fi; Connect shows the number to match there, and once allowed it is saved and let in here: runs go both ways', async () => {
    const { host, runComputerCommand } = pairing(OPEN, ['waiting', 'allowed'])
    show(host)
    await addComputer()
    const found = await screen.findByRole('list', { name: 'On this Wi-Fi' })
    expect(found.textContent).toContain('Studio MacOpenAgent 0.36.0')
    expect(screen.getByText('Looking on this Wi-Fi…')).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
    fireEvent.click(within(found).getByRole('button', { name: 'Connect Studio Mac' }))
    expect((await screen.findByLabelText('The number')).textContent).toBe('482 913')
    expect(screen.getByText('Waiting for Studio Mac…')).toBeTruthy()
    expect(runComputerCommand).toHaveBeenCalledWith(['ask', FOUND.url])
    // The secret goes on standard input, never among the words.
    expect(runComputerCommand).toHaveBeenCalledWith(['ask-answer', FOUND.url, '-'], 's3cret')
    await screen.findByText('Studio Mac is connected.')
    expect(host.addMachine).toHaveBeenCalledWith('http://studio.local:4201/_devices/enter#K7P4QX9M', 'Studio Mac')
    expect(host.letMachineIn).toHaveBeenCalledWith('http://studio.local:4201', LINK.url)
    expect(screen.getByText('Runs go both ways.')).toBeTruthy()
  })

  test('a computer that does not open by its name is saved by its number', async () => {
    const { host } = pairing(OPEN, ['allowed'])
    vi.mocked(host.addMachine).mockImplementation(async link => (link.includes('studio.local') ? { ok: false as const, error: 'getaddrinfo ENOTFOUND studio.local' } : { ok: true as const }))
    show(host)
    await addComputer()
    fireEvent.click(await screen.findByRole('button', { name: 'Connect Studio Mac' }))
    await screen.findByText('Studio Mac is connected.')
    expect(host.addMachine).toHaveBeenLastCalledWith('http://192.168.1.5:4201/_devices/enter#K7P4QX9M', 'Studio Mac')
    expect(host.letMachineIn).toHaveBeenCalledWith('http://192.168.1.5:4201', LINK.url)
  })

  test('with the door shut here the computer is saved one way only; with no server, somewhere else has nothing to join through', async () => {
    const { host } = pairing(OFF, ['allowed'])
    show(host)
    await addComputer()
    expect((await screen.findByRole('button', { name: 'Give it a code' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText("At the office, at a friend's: it joins through a server. Add a server first.")).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: 'Connect Studio Mac' }))
    await screen.findByText('Studio Mac is connected.')
    expect(host.letMachineIn).not.toHaveBeenCalled()
    expect(screen.getByText('Your runs can go there.')).toBeTruthy()
  })

  test('the box is read when the answer comes: unticked while it waits, the computer is saved one way only', async () => {
    let answer: (value: ModuleCommandResult) => void = () => {}
    const { host } = door(args => {
      if (args[0] === 'find') return ok({ found: [FOUND] })
      if (args[0] === 'ask') return ok({ number: '482913', secret: 's3cret', expires: new Date(Date.now() + 120_000).toISOString() })
      if (args[0] === 'ask-answer') return new Promise<ModuleCommandResult>(resolve => (answer = resolve))
      return ok(args[0] === 'add' ? LINK : OPEN)
    })
    show(host)
    await addComputer()
    fireEvent.click(await screen.findByRole('button', { name: 'Connect Studio Mac' }))
    const both = await screen.findByRole('checkbox', { name: 'Studio Mac can start runs on this computer too' })
    expect(both.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(both)
    answer(ok({ state: 'allowed', link: 'http://studio.local:4201/_devices/enter#K7P4QX9M' }))
    await screen.findByText('Studio Mac is connected.')
    expect(host.letMachineIn).not.toHaveBeenCalled()
  })

  test('said no, or no answer in time: the dialog says so; Cancel while it waits takes the ask away there', async () => {
    const denied = pairing(OPEN, ['denied'])
    show(denied.host)
    await addComputer()
    fireEvent.click(await screen.findByRole('button', { name: 'Connect Studio Mac' }))
    await screen.findByText('Studio Mac said no.')
    expect(denied.host.addMachine).not.toHaveBeenCalled()
    cleanup()

    const gone = pairing(OPEN, ['gone'])
    show(gone.host)
    await addComputer()
    fireEvent.click(await screen.findByRole('button', { name: 'Connect Studio Mac' }))
    await screen.findByText('Studio Mac did not answer. Try again.')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(gone.runComputerCommand.mock.calls.filter(([args]) => args[0] === 'ask')).toHaveLength(2))
    cleanup()

    const waiting = pairing(OPEN, [])
    show(waiting.host)
    await addComputer()
    fireEvent.click(await screen.findByRole('button', { name: 'Connect Studio Mac' }))
    await screen.findByLabelText('The number')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(waiting.runComputerCommand).toHaveBeenCalledWith(['ask-cancel', FOUND.url, '-'], 's3cret'))
    // Back at the list.
    expect(await screen.findByRole('list', { name: 'On this Wi-Fi' })).toBeTruthy()
  })

  test('the other computer refuses the ask: why is said', async () => {
    const { host } = door(args => {
      if (args[0] === 'find') return ok({ found: [FOUND] })
      if (args[0] === 'ask') return { ok: false, error: 'denied a moment ago: wait a minute to ask again' }
      return ok(OPEN)
    })
    show(host)
    await addComputer()
    fireEvent.click(await screen.findByRole('button', { name: 'Connect Studio Mac' }))
    expect(await screen.findByText('denied a moment ago: wait a minute to ask again')).toBeTruthy()
  })
})

describe('Settings › Devices: with a server', () => {
  const BOX = { address: '203.0.113.5', url: 'https://203.0.113.5', user: 'root', working: false, adding: false, steps: [{ id: 'login', label: 'Log in', state: 'done' }] }
  const SAVED: ModuleMachine = { id: 'https://203.0.113.5', label: 'my-vps', url: 'https://203.0.113.5', version: '0.0.0' }
  const SERVER_LINK = { url: 'https://203.0.113.5/_devices/enter#code.pin', expires: LINK.expires }

  test('a phone works from anywhere through the server, or only on this Wi-Fi: through the server, the code is the server\'s', async () => {
    const { host, runComputerCommand, serverCommand } = door(args => ok(args[0] === 'add' ? LINK : OFF), [SAVED], args => ok(args[0] === 'devices' ? { devices: [] } : { servers: [BOX] }))
    vi.mocked(host.machineCode).mockResolvedValue({ ok: true, value: { ...SERVER_LINK, where: '203.0.113.5', code: 'K7P4-QX9M' } })
    show(host)
    // With a server, the words say "anywhere", and the line to it is a switch of this computer's.
    expect(await screen.findByRole('switch', { name: 'From anywhere, through my-vps' })).toBeTruthy()
    expect(screen.getByText(/Only you can use this computer\. To share a computer with people on my-vps, set it up as a server/)).toBeTruthy()
    await addPhone()
    expect(await screen.findByText('Where should it work?')).toBeTruthy()
    expect(screen.getByRole('radio', { name: /Anywhere, through my-vps/ }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Show the code' }))
    await screen.findByRole('img', { name: 'The code a new device scans' })
    // Asked of the server's door with this computer's key there: no SSH, so any computer of the person's in at the server asks.
    expect(host.machineCode).toHaveBeenCalledWith(SAVED.id)
    expect(serverCommand).not.toHaveBeenCalledWith(expect.arrayContaining(['link']))
    expect(await copiedLink()).toBe(SERVER_LINK.url)
    expect(runComputerCommand).not.toHaveBeenCalledWith(['add'])
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await addPhone()
    fireEvent.click(await screen.findByRole('radio', { name: /Only on this Wi-Fi/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Show the code' }))
    // The door here is shut: it is opened first.
    expect(await screen.findByRole('button', { name: 'Turn on and show the code' })).toBeTruthy()
  })
})

describe('Settings › Devices: a computer several people use', () => {
  test('Someone else: the owner names themselves first, starting from the name git knows here, then the code is for the person typed, by their name', async () => {
    const SERVER = { on: false, listening: true, https: { address: '203.0.113.5' }, devices: [] }
    let persons: unknown[] = []
    let devices: unknown[] = []
    const { host, runComputerCommand } = door(
      args => {
        if (args[0] === 'me') return ok({ name: 'Ada Lovelace' })
        if (args[0] === 'owner') return (persons = [{ name: args[1], owner: true }]), ok({ ...SERVER, persons })
        if (args[0] === 'add') return ok(LINK)
        return ok({ ...SERVER, persons, devices })
      },
      [],
      () => ok({ server: true, servers: [] }),
    )
    show(host)
    await addPhone()
    fireEvent.click(await screen.findByRole('radio', { name: /Someone else/ }))
    const field = await screen.findByRole('textbox', { name: 'Their name' })
    fireEvent.change(field, { target: { value: '<not a name>' } })
    expect(screen.getByText('A name is letters and digits, with spaces, dots, apostrophes or dashes between, at most 40.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(field, { target: { value: ' Rom  Brillout ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    const own = (await screen.findByRole('textbox', { name: 'First, your name?' })) as HTMLInputElement
    await waitFor(() => expect(own.value).toBe('Ada Lovelace'))
    fireEvent.change(own, { target: { value: 'Ada' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('For Rom Brillout. Send them the link.')).toBeTruthy()
    expect(runComputerCommand).toHaveBeenCalledWith(['owner', 'Ada'])
    expect(runComputerCommand).toHaveBeenCalledWith(['add', '--for', 'Rom Brillout'])
    // The page goes on reading the list: the device that gets in with the code is told.
    devices = [{ ...PHONE, person: 'Rom Brillout' }]
    expect(await screen.findByText('iPhone, Safari is in.')).toBeTruthy()
  })

  test('with no name git knows here, the owner types theirs; nothing is named until they do', async () => {
    const SERVER = { on: false, listening: true, https: { address: '203.0.113.5' }, devices: [], persons: [] }
    const { host, runComputerCommand } = door(args => (args[0] === 'me' ? ok({}) : ok(SERVER)), [], () => ok({ server: true, servers: [] }))
    show(host)
    await addPhone()
    fireEvent.click(await screen.findByRole('radio', { name: /Someone else/ }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Their name' }), { target: { value: 'Rom' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    const own = (await screen.findByRole('textbox', { name: 'First, your name?' })) as HTMLInputElement
    await waitFor(() => expect(runComputerCommand).toHaveBeenCalledWith(['me']))
    expect(own.value).toBe('')
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true)
    expect(runComputerCommand.mock.calls.some(([args]) => args[0] === 'owner' || args[0] === 'add')).toBe(false)
  })

  test('once named, the owner is not asked again, and the devices are listed by person; a person is removed with their devices', async () => {
    const persons = [{ name: 'Ada', owner: true }, { name: 'Rom' }, { name: 'Eve' }]
    const devices = [{ ...PHONE, person: 'Ada' }, { ...PHONE, id: 'fed654cba321', name: 'Pixel, Chrome', person: 'Rom' }]
    const { host, runComputerCommand } = door(args => (args[0] === 'add' ? ok(LINK) : ok({ ...OPEN, persons, devices })))
    show(host)
    expect(await screen.findByText('Ada, the owner')).toBeTruthy()
    expect(screen.getByRole('list', { name: 'Devices of Rom' }).textContent).toContain('Pixel, Chrome')
    expect(screen.getByRole('list', { name: 'Devices of Ada' }).textContent).toContain('iPhone, Safari')
    expect(screen.getByText('No device yet.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Remove Ada' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Rom' }))
    // Said first: their user on this computer goes with everything in it.
    expect((await screen.findByRole('alertdialog')).textContent).toContain('their own user on this computer is deleted with everything in it')
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove person' }))
    await waitFor(() => expect(runComputerCommand).toHaveBeenCalledWith(['remove-person', 'Rom']))

    await addPhone()
    fireEvent.click(await screen.findByRole('radio', { name: /Someone else/ }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Their name' }), { target: { value: 'eve' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    // The name of a person here already, in other letters' case, is that person.
    expect(await screen.findByText('For eve. Send them the link.')).toBeTruthy()
    expect(runComputerCommand.mock.calls.some(([args]) => args[0] === 'me' || args[0] === 'owner')).toBe(false)
  })

  test('a person whose own user is being made, or could not be made, is said so under their name', async () => {
    const persons = [{ name: 'Ada', owner: true }, { name: 'Rom', working: true }, { name: 'Eve', problem: 'This server has no room for another user' }]
    const { host } = door(() => ok({ ...OPEN, persons, devices: [] }))
    show(host)
    expect(await screen.findByText("Making Rom's own user on this computer, with their own OpenAgent. This takes a minute or two.")).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe("Eve's own user on this computer could not be made: This server has no room for another user. Add a device for them again to try again.")
  })

  test('a person of a server that starts runs here through its line says so; one that server no longer has is marked, kept switched off, or removed', async () => {
    const from = 'https://165.245.244.10'
    let persons: object[] = [{ name: 'Rom', owner: true }, { name: 'Ada', ready: true, from }, { name: 'Kim', ready: true, from, removed: true }]
    const { host, runComputerCommand } = door(args => {
      if (args[0] === 'keep') persons = persons.map(person => ((person as { name: string }).name === args[1] ? { ...person, kept: true } : person))
      return ok({ ...OPEN, persons, devices: [] })
    })
    show(host)
    expect(await screen.findByText('Uses this computer through 165.245.244.10.')).toBeTruthy()
    // Their devices are the server's: none here is none missing. The owner's own none is said.
    expect(screen.getAllByText('No device yet.')).toHaveLength(1)
    const marked = screen.getByRole('group', { name: 'Kim was removed from 165.245.244.10' })
    expect(marked.textContent).toContain('Removed from 165.245.244.10.')
    // Remove asks first, as Remove person does.
    fireEvent.click(within(marked).getByRole('button', { name: 'Remove Kim' }))
    expect((await screen.findByRole('alertdialog')).textContent).toContain('their own user on this computer is deleted with everything in it')
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Kim was removed from 165.245.244.10' })).getByRole('button', { name: 'Keep, switched off' }))
    await waitFor(() => expect(runComputerCommand).toHaveBeenCalledWith(['keep', 'Kim']))
    expect(await screen.findByText('Removed from 165.245.244.10. Kept here, switched off.')).toBeTruthy()
    expect(screen.queryByRole('group', { name: 'Kim was removed from 165.245.244.10' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Remove Kim' }).textContent).toBe('Remove person')
  })

  test('on one person\'s own OpenAgent: only their devices, asked of the door, each removable; no switch, no Add device, no other person', async () => {
    const mine = { person: 'Rom', owner: false, devices: [{ ...PHONE, person: 'Rom' }, { ...PHONE, id: 'fed654cba321', name: 'OpenAgent on rom-laptop', line: true, person: 'Rom' }] }
    const fetched = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/_devices/me/remove') {
        expect([init?.method, init?.body]).toEqual(['POST', JSON.stringify({ id: 'fed654cba321' })])
        return new Response(JSON.stringify({ ...mine, devices: mine.devices.slice(0, 1) }), { status: 200 })
      }
      return new Response(JSON.stringify(mine), { status: 200 })
    })
    vi.stubGlobal('fetch', fetched)
    try {
      const { host } = door(() => ok({ ...OFF, persons: [], person: 'Rom' }))
      show(host)
      const list = await screen.findByRole('list', { name: 'Your devices' })
      expect(list.textContent).toContain('iPhone, Safari')
      expect(list.textContent).toContain('A computer of yours: runs can be started on it from here.')
      expect(screen.getByText(/you are on it as Rom/)).toBeTruthy()
      expect(screen.queryByRole('switch')).toBeNull()
      expect(screen.queryByRole('button', { name: 'Add device' })).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Remove OpenAgent on rom-laptop' }))
      await waitFor(() => expect(fetched).toHaveBeenCalledWith('/_devices/me/remove', expect.anything()))
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('Settings › Devices: a code typed on another computer', () => {
  const VPS: ModuleMachine = { id: 'https://203.0.113.10', label: 'my-vps', url: 'https://203.0.113.10', version: '0.0.0' }
  const STUDIO = { id: 'abc123def456', name: 'Studio', online: true, added: false }
  const ROMS = { id: 'f00f00f00f00', name: "Rom's PC", online: true, added: false, owner: 'rom' }

  test('Join with a code: where and the code, pasted both at once; this computer keeps its line there, and the person\'s own computers there are saved through it', async () => {
    const saved: ModuleMachine[] = []
    const { host, serverCommand } = door(() => ok(OFF), saved, args => ok(args[0] === 'shared' || args[0] === 'shared-reach' ? { shared: [] } : { servers: [] }))
    vi.mocked(host.addMachine).mockImplementation(async () => (saved.push(VPS), { ok: true }))
    vi.mocked(host.computersThrough).mockResolvedValue({ ok: true, computers: [STUDIO, ROMS] })
    vi.mocked(host.addComputerThrough).mockResolvedValue({ ok: true })
    show(host)
    fireEvent.click(await screen.findByRole('button', { name: 'Join with a code' }))
    const where = await screen.findByRole('textbox', { name: 'Where' })
    expect((screen.getByRole('button', { name: 'Join' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.paste(where, { clipboardData: { getData: () => 'Where: 203.0.113.10\nCode: K7P4-QX9M' } })
    expect((where as HTMLInputElement).value).toBe('203.0.113.10')
    expect((screen.getByRole('textbox', { name: 'Code' }) as HTMLInputElement).value).toBe('K7P4-QX9M')
    expect(screen.getByRole('checkbox', { name: 'Your other devices can start runs on this computer' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText('Through 203.0.113.10, while it is on.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Join' }))
    await waitFor(() => expect(host.addMachine).toHaveBeenCalledWith('https://203.0.113.10/_devices/enter#K7P4QX9M'))
    await waitFor(() => expect(serverCommand).toHaveBeenCalledWith(['shared-reach', 'https://203.0.113.10', 'full']))
    await waitFor(() => expect(host.addComputerThrough).toHaveBeenCalledWith(VPS.id, STUDIO.id))
    // Another person's computer there is theirs to share: never saved by itself.
    expect(host.addComputerThrough).not.toHaveBeenCalledWith(VPS.id, ROMS.id)
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Where' })).toBeNull())
  })

  test('Join with a code: a computer on Tailscale is saved by its link, asked for no line, and listed as on your Tailscale network', async () => {
    const OTHER_MAC: ModuleMachine = { id: 'https://studio.tail1234.ts.net', label: 'Studio', url: 'https://studio.tail1234.ts.net', version: '0.0.0' }
    const saved: ModuleMachine[] = []
    const { host, serverCommand } = door(() => ok(OFF), saved, args => ok(args[0] === 'shared' ? { shared: [] } : { servers: [] }))
    vi.mocked(host.addMachine).mockImplementation(async () => (saved.push(OTHER_MAC), { ok: true }))
    show(host)
    fireEvent.click(await screen.findByRole('button', { name: 'Join with a code' }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Where' }), { target: { value: 'https://studio.tail1234.ts.net/_devices/enter#K7P4QX9M' } })
    // Its door keeps no line for anyone: nothing to tick.
    expect(screen.queryByRole('checkbox', { name: 'Your other devices can start runs on this computer' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Join' }))
    await waitFor(() => expect(host.addMachine).toHaveBeenCalledWith('https://studio.tail1234.ts.net/_devices/enter#K7P4QX9M'))
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Where' })).toBeNull())
    expect(serverCommand).not.toHaveBeenCalledWith(['shared-reach', 'https://studio.tail1234.ts.net', 'full'])
    expect(host.computersThrough).not.toHaveBeenCalled()
    expect(await screen.findByText(/on your Tailscale network/)).toBeTruthy()
  })

  test('Join with a code: a link pasted whole is said by its address alone, never with the code it holds', async () => {
    const { host } = door(() => ok(OFF), [], () => ok({ servers: [] }))
    show(host)
    fireEvent.click(await screen.findByRole('button', { name: 'Join with a code' }))
    const where = await screen.findByRole('textbox', { name: 'Where' })
    fireEvent.change(where, { target: { value: 'https://203.0.113.10/_devices/enter#K7P4QX9M.secretpart' } })
    expect(screen.getByText('Through 203.0.113.10, while it is on.')).toBeTruthy()
    expect(document.body.textContent).not.toContain('K7P4QX9M')
  })

  test('Join with a code says why a code did not work, and keeps what was typed; unticked, this computer keeps no line there', async () => {
    const saved: ModuleMachine[] = []
    const { host, serverCommand } = door(() => ok(OFF), saved, () => ok({ servers: [] }))
    vi.mocked(host.addMachine).mockResolvedValueOnce({ ok: false, error: "That code doesn't work. A code works once, for ten minutes: check it, or make a new one on the other device." })
    show(host)
    fireEvent.click(await screen.findByRole('button', { name: 'Join with a code' }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Where' }), { target: { value: 'https://203.0.113.10/' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Code' }), { target: { value: 'k7p4 qx9m' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Your other devices can start runs on this computer' }))
    fireEvent.click(screen.getByRole('button', { name: 'Join' }))
    expect((await screen.findByRole('alert')).textContent).toContain("That code doesn't work.")
    expect(host.addMachine).toHaveBeenCalledWith('https://203.0.113.10/_devices/enter#K7P4QX9M')
    expect((screen.getByRole('textbox', { name: 'Code' }) as HTMLInputElement).value).toBe('k7p4 qx9m')
    vi.mocked(host.addMachine).mockImplementation(async () => (saved.push(VPS), { ok: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Join' }))
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Where' })).toBeNull())
    expect(serverCommand).not.toHaveBeenCalledWith(expect.arrayContaining(['shared-reach']))
  })

  test('Give it a code: where and a code from the server, for a computer somewhere else; once it keeps its line there it is saved here through the server, and runs go both ways', async () => {
    const { host } = door(() => ok(OPEN), [VPS], args => ok(args[0] === 'shared' ? { shared: [{ url: VPS.url, reach: 'full' }] } : { servers: [] }))
    vi.mocked(host.machineCode).mockResolvedValue({ ok: true, value: { url: 'https://203.0.113.10/_devices/enter#K7P4QX9M', where: '203.0.113.10', code: 'K7P4-QX9M', expires: new Date(Date.now() + 10 * 60_000).toISOString() } })
    vi.mocked(host.machinePerson).mockResolvedValue({ ok: true, said: { owner: true, devices: [] } })
    let there: ModuleComputerThrough[] = [ROMS]
    vi.mocked(host.computersThrough).mockImplementation(async () => ({ ok: true, computers: there }))
    vi.mocked(host.addComputerThrough).mockResolvedValue({ ok: true })
    show(host)
    await addComputer()
    expect(await screen.findByText("At the office, at a friend's: it joins through my-vps.")).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Give it a code' }))
    const card = await screen.findByRole('group', { name: 'The code' })
    expect(host.machineCode).toHaveBeenCalledWith(VPS.id)
    expect(card.textContent).toContain('203.0.113.10')
    expect(card.textContent).toContain('K7P4-QX9M')
    expect(screen.getByRole('timer').textContent).toMatch(/^Waiting… the code works once, for (10:00|9:\d\d)\. It joins as yours, through my-vps\.$/)
    // Another person's computer that comes on a line meanwhile is not the one that got in.
    there = [ROMS, STUDIO]
    expect(await screen.findByText('Studio is in.', {}, { timeout: 8000 })).toBeTruthy()
    expect(host.addComputerThrough).toHaveBeenCalledWith(VPS.id, STUDIO.id)
    expect(host.addComputerThrough).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Runs go both ways, through my-vps. The code is spent.')).toBeTruthy()
    expect(screen.queryByRole('group', { name: 'The code' })).toBeNull()
  })
})
