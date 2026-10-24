import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ModuleHostContext, type MachineAdded, type MachineRemoved, type ModuleCommandResult, type ModuleComputersThrough, type ModuleHost, type ModuleMachinePerson, type ModuleMachines } from '@openagt/dashboard/module'
import { DevicesSettings } from './DevicesSettings.js'
import { olderThan } from './parts.js'
import type { DeviceRow, ServerRow, StepState } from './servers.js'

// The servers in Settings › Devices: a server this computer installed OpenAgent on, a computer at
// home set up as one, a server set up elsewhere or shared by someone, another person's computer.
// Each is a row of the list, and a page of its own with its install and its people.

const LABELS = { login: 'Log in', user: 'A user of its own, openagent', tools: 'git, gh, Node and Chrome', name: 'Your name and email for git', openagent: 'OpenAgent', agent: 'Claude Code', service: 'Starts by itself', door: 'The door' }
const LINK = { url: 'https://203.0.113.5/_devices/enter#K7P4QX9M.pin', where: '203.0.113.5', code: 'K7P4-QX9M', expires: new Date(Date.now() + 10 * 60_000).toISOString() }
/** The server's people, with its owner named. */
const OWNED = (): ModuleCommandResult => ({ ok: true, output: { devices: [], persons: [{ name: 'Ada', owner: true }] } })
/** Invite, then their name, then the code. */
async function invite(name: string): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: 'Invite to 203.0.113.5' }))
  fireEvent.change(await screen.findByRole('textbox', { name: 'Their name' }), { target: { value: name } })
  fireEvent.click(screen.getByRole('button', { name: 'Make the code' }))
}
/** A Test connection that went through. */
const TESTED_OK = { ok: true, system: 'Ubuntu 24.04.1 LTS, x86_64' }
/** This computer's door, shut, with nobody in. */
const DOOR_SHUT = { on: false, listening: false, devices: [], persons: [], lines: [] }

/** A server whose steps are in these states, in the install's order; the rest have not started. */
function server(states: StepState[], over: Partial<ServerRow> = {}): ServerRow {
  const steps = Object.entries(LABELS).map(([id, label], index) => ({ id, label, state: states[index] ?? ('waiting' as const) }))
  return { address: '203.0.113.5', url: 'https://203.0.113.5', user: 'root', working: false, adding: true, steps, ...over }
}
const ALL_DONE: StepState[] = ['done', 'done', 'done', 'done', 'done', 'done', 'done', 'done']
const NO_GH: ModuleCommandResult = { ok: true, output: { problem: 'There is no GitHub login to copy from this computer. `gh` is not on this computer.' } }
const OCTOCAT: ModuleCommandResult = { ok: true, output: { account: 'octocat' } }
/** The server saved among the machines, running this OpenAgent unless said: `version: undefined` for one that does not answer. */
function BOX_SAVED(over: { version?: string | undefined; device?: string } = {}): ModuleMachines {
  const version = 'version' in over ? over.version : '1.2.3'
  return { version: '1.2.3', machines: [{ id: 'https://203.0.113.5', label: '203.0.113.5', url: 'https://203.0.113.5', ...(version !== undefined ? { version } : {}), ...(over.device !== undefined ? { device: over.device } : {}) }] }
}

/**
 * A host whose `devices server` command answers what `answer` says for its words, with these machines saved.
 * This computer's own `gh` answers `own` when asked whose login it holds: nobody's, unless said.
 * A server's door answers `devices` when asked who is in, and when one is taken out: nobody, unless said.
 * This computer's door answers `door`: shut, with nobody in, unless said.
 */
function dashboard(
  answer: (args: string[]) => ModuleCommandResult,
  saved: ModuleMachines = { version: '1.2.3', machines: [] },
  added: MachineAdded = { ok: true },
  own: ModuleCommandResult = NO_GH,
  devices: (args: string[]) => ModuleCommandResult = () => ({ ok: true, output: { devices: [] } }),
  door: (args: string[]) => ModuleCommandResult = () => ({ ok: true, output: DOOR_SHUT }),
  tested: (args: string[]) => ModuleCommandResult = () => ({ ok: true, output: TESTED_OK }),
) {
  const runComputerCommand = vi.fn(async (args: string[]) => (args[0] === 'github' ? own : args[0] === 'devices' || args[0] === 'remove-device' ? devices(args) : args[0] === 'test' ? tested(args) : answer(args)))
  const doorCommand = vi.fn(async (args: string[]) => door(args))
  const inProject = vi.fn(async () => ({ ok: false as const, error: 'the servers are no project\'s' }))
  const machines = vi.fn(async () => saved)
  const addMachine = vi.fn(async (_link: string, _label?: string) => added)
  const removeMachine = vi.fn(async (_id: string): Promise<MachineRemoved> => ({ ok: true }))
  const computersThrough = vi.fn(async (_id: string): Promise<ModuleComputersThrough> => ({ ok: true, computers: [] }))
  const addComputerThrough = vi.fn(async (_id: string, _computer: string): Promise<MachineAdded> => ({ ok: true }))
  const useLoginsOn = vi.fn(async (_id: string): Promise<MachineAdded> => ({ ok: true }))
  // No machine says who this computer's person is there, unless a test says otherwise.
  const machinePerson = vi.fn(async (_id: string): Promise<ModuleMachinePerson> => ({ ok: false, error: 'not said', unknown: true }))
  const removeMachineDevice = vi.fn(async (_id: string, _device: string): Promise<ModuleMachinePerson> => ({ ok: false, error: 'not said' }))
  const runComputerCommandOn = vi.fn(async (_machine: string, _args: string[]): Promise<ModuleCommandResult> => ({ ok: false, error: 'not there' }))
  // The page asks `devices server …` of a server, and `devices …` of this computer's door.
  const host: ModuleHost = {
    package: '@openagt/devices',
    runCommand: inProject,
    act: inProject,
    runComputerCommand: vi.fn(async (args: string[]) => (args[0] === 'server' ? runComputerCommand(args.slice(1)) : doorCommand(args))),
    runComputerCommandOn: vi.fn(async (machine: string, args: string[]) => runComputerCommandOn(machine, args[0] === 'server' ? args.slice(1) : ['not-asked-as-server', ...args])),
    read: vi.fn(async () => ({ ok: false as const, error: 'no server part' })),
    openAgent: vi.fn(),
    openPage: vi.fn(),
    pageHref: (segment: string) => `/${segment}`,
    startRun: vi.fn(async () => ({ ok: false as const, error: 'not here' })),
    configureRun: vi.fn(),
    agents: vi.fn(async () => []),
    machines,
    addMachine,
    removeMachine,
    renameMachine: vi.fn(async () => ({ ok: true as const })),
    letMachineIn: vi.fn(async () => ({ ok: true as const })),
    machineCode: vi.fn(async () => ({ ok: false as const, error: 'not here' })),
    computersThrough,
    addComputerThrough,
    machinePerson,
    removeMachineDevice,
    useLoginsOn,
    watchScreen: vi.fn(async () => undefined),
    sendToScreen: vi.fn(async () => false),
  }
  // What was asked of the `devices server` command, without the reads a page makes again and again by itself.
  const ran = (): string[] => runComputerCommand.mock.calls.map(([args]) => args.join(' ')).filter(line => !line.startsWith('devices '))
  return { host, runComputerCommand, runComputerCommandOn, doorCommand, machines, addMachine, removeMachine, computersThrough, addComputerThrough, machinePerson, removeMachineDevice, useLoginsOn, ran }
}

function show(host: ModuleHost) {
  return render(
    <ModuleHostContext.Provider value={host}>
      <DevicesSettings everyMs={40} devicesEveryMs={60} />
    </ModuleHostContext.Provider>,
  )
}

const ok = (output: unknown): ModuleCommandResult => ({ ok: true, output })
/** Open a device's page from the list, by its name. */
const open = async (name: string): Promise<void> => void fireEvent.click(within(await screen.findByRole('listitem', { name })).getByRole('button'))
/** Pick one of a page's tabs. */
const tab = async (name: string): Promise<void> => void fireEvent.click(await screen.findByRole('tab', { name }))
/** Open the server setup, as a person does: from the start page's card, or Add device › Server. */
async function openConnect(): Promise<void> {
  const press = await screen.findByRole('button', { name: /^(Set up a server|Add device)$/ })
  fireEvent.click(press)
  if (press.textContent === 'Set up a server') return
  fireEvent.click(await screen.findByRole('radio', { name: /^Server/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
}
/** Remove, said yes to. */
async function confirm(trigger: string, yes = 'Remove'): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: trigger }))
  fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: yes }))
}
const stepNames = (): string[] => within(screen.getByRole('list', { name: 'The install on 203.0.113.5' })).getAllByRole('listitem').map(item => item.getAttribute('aria-label')!)

afterEach(cleanup)

describe('Settings › Devices: a server this computer installed', () => {
  test('an install at work lists its steps with their state, and shows the key the server was first met with', async () => {
    const { host } = dashboard(() => ok({ servers: [server(['done', 'done', 'running'], { working: true, fingerprint: 'SHA256:abc' })] }))
    show(host)
    // Its row says so, and its page says which step.
    expect(within(await screen.findByRole('listitem', { name: '203.0.113.5' })).getByText('Installing…')).toBeTruthy()
    await open('203.0.113.5')
    expect(await screen.findByText('Installing: step 3 of 8')).toBeTruthy()
    expect(stepNames()).toEqual(['Log in: done', 'A user of its own, openagent: done', 'git, gh, Node and Chrome: running', 'Your name and email for git: not started', 'OpenAgent: not started', 'Claude Code: not started', 'Starts by itself: not started', 'The door: not started'])
    expect(screen.getByText("The server's key: SHA256:abc")).toBeTruthy()
    // Nothing to press on a server that is being installed.
    for (const name of ['Try 203.0.113.5 again', 'Update 203.0.113.5', 'Remove 203.0.113.5']) expect(screen.queryByRole('button', { name })).toBeNull()
  })

  test('a step that failed shows what the server said, and Try again starts the install over as the same user', async () => {
    const failed = server(['done', 'done', 'failed'], { user: 'ubuntu' })
    failed.steps[2]!.said = 'E: Unable to locate package git'
    const { host, ran, addMachine } = dashboard(() => ok({ servers: [failed] }))
    show(host)
    await open('203.0.113.5')
    expect((await screen.findByRole('alert')).textContent).toBe('E: Unable to locate package git')
    // The press waits, as Connect does, until this computer said which OpenAgent it runs.
    const again = screen.getByRole('button', { name: 'Try 203.0.113.5 again' }) as HTMLButtonElement
    await waitFor(() => expect(again.disabled).toBe(false))
    fireEvent.click(again)
    await waitFor(() => expect(ran()).toContain('connect 203.0.113.5 ubuntu 1.2.3'))
    expect(addMachine).not.toHaveBeenCalled()
  })

  test('once every step is done the server\'s door is asked for a link, the server is saved among the machines with it, and the command is told', async () => {
    let adding = true
    const { host, ran, addMachine, useLoginsOn } = dashboard(args => {
      if (args[0] === 'link') return ok(LINK)
      if (args[0] === 'added') adding = false
      return ok({ servers: [server(ALL_DONE, { adding })] })
    })
    show(host)
    await waitFor(() => expect(addMachine).toHaveBeenCalledWith(LINK.url, '203.0.113.5'))
    await waitFor(() => expect(ran()).toContain('added 203.0.113.5'))
    // Once: a look at the page asks for no second link.
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(ran().filter(line => line === 'link 203.0.113.5')).toHaveLength(1)
    expect(addMachine).toHaveBeenCalledTimes(1)
    // A server just connected is let start runs on this computer, once, without a press.
    expect(ran().filter(line => line.startsWith('reach '))).toEqual(['reach 203.0.113.5 full'])
    // Its logins are the person's pick in Set up a server: none was made here.
    expect(useLoginsOn).not.toHaveBeenCalled()
  })

  test('an update leaves the switch as the person set it: a server that was told to only watch is not let start runs again by itself', async () => {
    let adding = true
    const { host, ran } = dashboard(args => {
      if (args[0] === 'link') return ok(LINK)
      if (args[0] === 'added') adding = false
      return ok({ servers: [server(ALL_DONE, { adding, reach: 'watch' })] })
    })
    show(host)
    await waitFor(() => expect(ran()).toContain('added 203.0.113.5'))
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(ran().filter(line => line.startsWith('reach '))).toEqual([])
  })

  test('Invite gives someone else where and a code to type, asked of the server for them; their phone scans it as a QR code instead; the code runs out, and a server that does not answer is told', async () => {
    let link: ModuleCommandResult = ok(LINK)
    const { host, ran } = dashboard(args => (args[0] === 'link' ? link : ok({ servers: [server(ALL_DONE, { adding: false })] })), BOX_SAVED(), { ok: true }, NO_GH, OWNED)
    show(host)
    await open('203.0.113.5')
    // Its logins are on its page in Settings › Accounts.
    expect(screen.queryByRole('tab', { name: 'Logins' })).toBeNull()
    await tab('People')
    const card = () => screen.queryByRole('group', { name: 'The code' })
    await invite(' Rom  Brillout ')
    await waitFor(() => expect(card()).toBeTruthy())
    expect(ran().filter(line => line === 'link 203.0.113.5 --for Rom Brillout')).toHaveLength(1)
    expect(screen.getByText('Rom Brillout gets a user of their own on 203.0.113.5: their own runs, with their own logins. Send them this:')).toBeTruthy()
    expect(card()!.textContent).toContain('203.0.113.5')
    expect(card()!.textContent).toContain('K7P4-QX9M')
    expect(screen.getByRole('timer').textContent).toMatch(/^Works once, for (10:00|9:\d\d) more\.$/)
    // Copy both: what Join with a code reads back from one paste.
    const writeText = vi.fn(async (_text: string) => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    fireEvent.click(screen.getByRole('button', { name: 'Copy both' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Where: 203.0.113.5\nCode: K7P4-QX9M'))
    // On their phone: the same code as a QR code.
    fireEvent.click(screen.getByRole('button', { name: 'show a QR code' }))
    expect(screen.getByRole('img', { name: 'The code a new device scans' })).toBeTruthy()
    expect(card()).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByText('Invite to 203.0.113.5', { selector: 'h2' })).toBeNull())

    // A code that runs out says so, and a new one is a press away.
    link = ok({ ...LINK, expires: new Date(Date.now() + 80).toISOString() })
    await invite('Rom')
    expect(await screen.findByText('The code ran out. A new one works for ten minutes more.', {}, { timeout: 2500 })).toBeTruthy()
    expect(card()).toBeNull()
    link = ok(LINK)
    fireEvent.click(screen.getByRole('button', { name: 'New code' }))
    await waitFor(() => expect(card()).toBeTruthy())
    expect(ran().filter(line => line === 'link 203.0.113.5 --for Rom')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))

    link = { ok: false, error: 'The server did not answer.' }
    await invite('Rom')
    expect((await screen.findByRole('alert')).textContent).toBe('No code: The server did not answer.')
    expect(card()).toBeNull()
  })

  test('a server that is not installed yet gives no code, and has no people to show', async () => {
    const { host } = dashboard(() => ok({ servers: [server(['done', 'done', 'failed'])] }))
    show(host)
    await open('203.0.113.5')
    await screen.findByRole('button', { name: 'Try 203.0.113.5 again' })
    expect(screen.queryByRole('tab', { name: 'People' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Invite to 203.0.113.5' })).toBeNull()
  })

  test('a server that could not be saved says why, and is tried again on a press, not by itself', async () => {
    const { host, ran, addMachine } = dashboard(args => (args[0] === 'link' ? ok(LINK) : ok({ servers: [server(ALL_DONE)] })), { version: '1.2.3', machines: [] }, { ok: false, error: 'this code no longer works' })
    show(host)
    await open('203.0.113.5')
    expect((await screen.findByRole('alert')).textContent).toBe('this code no longer works')
    expect(stepNames().at(-1)).toBe('Runs can be sent to it: failed')
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(addMachine).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Finish connecting 203.0.113.5' }))
    await waitFor(() => expect(addMachine).toHaveBeenCalledTimes(2))
    expect(ran()).not.toContain('added 203.0.113.5')
  })

  test('a failure that is thrown, not answered, is told too, and is not tried again at every look', async () => {
    const { host, addMachine } = dashboard(args => (args[0] === 'link' ? ok(LINK) : ok({ servers: [server(ALL_DONE)] })))
    addMachine.mockRejectedValue(new Error('the dashboard did not answer'))
    show(host)
    await open('203.0.113.5')
    expect((await screen.findByRole('alert')).textContent).toBe('the dashboard did not answer')
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(addMachine).toHaveBeenCalledTimes(1)
  })

  test('a server made anew at the same address is among the machines and does not answer: it gets in again, with a new link', async () => {
    let adding = true
    const { host, ran, addMachine } = dashboard(args => {
      if (args[0] === 'link') return ok(LINK)
      if (args[0] === 'added') adding = false
      return ok({ servers: [server(ALL_DONE, { adding })] })
    }, BOX_SAVED({ version: undefined }))
    show(host)
    await waitFor(() => expect(addMachine).toHaveBeenCalledWith(LINK.url, '203.0.113.5'))
    await waitFor(() => expect(ran()).toContain('added 203.0.113.5'))
    // Afterwards it is a press: the page does not ask a server that is down for a link at every look.
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(addMachine).toHaveBeenCalledTimes(1)
    await open('203.0.113.5')
    expect((await screen.findByRole('button', { name: 'Connect 203.0.113.5 again' })).textContent).toBe('Connect again')
  })

  test('a server that is among the machines shows its OpenAgent; one that fell behind this computer says so on its row and its page, and has Update', async () => {
    const same = dashboard(() => ok({ servers: [server(ALL_DONE, { adding: false })] }), BOX_SAVED())
    show(same.host)
    await open('203.0.113.5')
    expect(await screen.findByText('OpenAgent 1.2.3')).toBeTruthy()
    // All set up: the steps fold into one line, and open on a press.
    expect(screen.queryByRole('list', { name: 'The install on 203.0.113.5' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Installed, as root' }))
    expect(stepNames().at(-1)).toBe('Runs can be sent to it: done')
    fireEvent.click(screen.getByRole('button', { name: 'Hide the steps' }))
    expect(screen.queryByRole('list', { name: 'The install on 203.0.113.5' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Update 203.0.113.5' })).toBeNull()
    expect(same.addMachine).not.toHaveBeenCalled()
    cleanup()

    const behind = dashboard(() => ok({ servers: [server(ALL_DONE, { adding: false, user: 'ubuntu' })] }), BOX_SAVED({ version: '1.2.0' }))
    show(behind.host)
    expect(within(await screen.findByRole('listitem', { name: '203.0.113.5' })).getByText('Update')).toBeTruthy()
    await open('203.0.113.5')
    expect(await screen.findByText('OpenAgent 1.2.0 runs there: behind this computer, which runs 1.2.3.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Update 203.0.113.5' }))
    await waitFor(() => expect(behind.ran()).toContain('connect 203.0.113.5 ubuntu 1.2.3'))
    cleanup()

    const silent = dashboard(() => ok({ servers: [server(ALL_DONE, { adding: false })] }), BOX_SAVED({ version: undefined }))
    show(silent.host)
    await open('203.0.113.5')
    expect(await screen.findByText('Does not answer right now')).toBeTruthy()
  })

  test('an update shows each step on its own as it runs: the folded steps open, the page says which step runs, and they fold again once all is done', async () => {
    let now: ServerRow = server(ALL_DONE, { adding: false })
    const { host, ran } = dashboard(args => {
      // The press starts the same steps over, each waiting until the install comes to it.
      if (args[0] === 'connect') now = server([], { adding: false, working: true })
      return ok({ servers: [now] })
    }, BOX_SAVED({ version: '1.2.0' }))
    show(host)
    await open('203.0.113.5')
    expect(await screen.findByText('OpenAgent 1.2.0 runs there: behind this computer, which runs 1.2.3.')).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'The install on 203.0.113.5' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Update 203.0.113.5' }))
    await waitFor(() => expect(ran()).toContain('connect 203.0.113.5 root 1.2.3'))
    expect(await screen.findByText('Updating: step 1 of 8')).toBeTruthy()
    expect(stepNames().slice(0, 2)).toEqual(['Log in: not started', 'A user of its own, openagent: not started'])
    now = server(['done', 'done', 'running'], { adding: false, working: true })
    expect(await screen.findByText('Updating: step 3 of 8')).toBeTruthy()
    expect(stepNames().slice(0, 4)).toEqual(['Log in: done', 'A user of its own, openagent: done', 'git, gh, Node and Chrome: running', 'Your name and email for git: not started'])
    // Nothing to press while it runs.
    expect(screen.queryByRole('button', { name: 'Update 203.0.113.5' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Remove 203.0.113.5' })).toBeNull()
    now = server(ALL_DONE, { adding: false })
    expect(await screen.findByRole('button', { name: 'Installed, as root' })).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'The install on 203.0.113.5' })).toBeNull()
  })

  test('on a computer that is itself a server the page lists its machines and offers no server to set up: servers are set up from a person\'s own computer', async () => {
    let fails = false
    // A person's own computer, reached by the line it keeps open to this server: saved by the address that stands for it here.
    const saved: ModuleMachines = { version: '1.2.3', machines: [{ id: 'http://127.0.0.1:4210', label: 'MacBook', url: 'http://127.0.0.1:4210', version: '1.2.3' }] }
    const { host, ran, addMachine, removeMachine } = dashboard(() => (fails ? { ok: false, error: 'the command could not be run' } : { ok: true, output: { server: true, servers: [server(ALL_DONE)] } }), saved)
    const { container } = show(host)
    // Nothing before this computer said which it is: a server never offers to set one up for a moment.
    expect(container.textContent).toBe('')
    const row = await screen.findByRole('listitem', { name: 'MacBook' })
    expect(row.textContent).toContain('keeps a line open here')
    expect(within(row).getByText('Online')).toBeTruthy()
    // Nothing of a server to set up, and what this computer's own file holds of servers is not listed.
    fireEvent.click(screen.getByRole('button', { name: 'Add device' }))
    expect(await screen.findByRole('radio', { name: /^Computer/ })).toBeTruthy()
    expect(screen.queryByRole('radio', { name: /^Server/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('listitem', { name: '203.0.113.5' })).toBeNull()
    // A read that fails later does not bring any of it back.
    fails = true
    const before = ran().length
    await waitFor(() => expect(ran().length).toBeGreaterThan(before + 1))
    expect(screen.queryByRole('listitem', { name: '203.0.113.5' })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    // Only the question itself was asked: no GitHub login, no server's devices, and a server it holds is not added to anything.
    expect(new Set(ran())).toEqual(new Set(['status']))
    expect(host.runComputerCommand).not.toHaveBeenCalledWith(['server', 'github'])
    expect(host.runComputerCommand).not.toHaveBeenCalledWith(['server', 'devices', '203.0.113.5'])
    expect(addMachine).not.toHaveBeenCalled()
    // Its own page says what it is, and it can be taken off the list like any machine.
    await open('MacBook')
    expect(await screen.findByText("Your computer. It keeps a line open to this server. Removed here, it is back when it calls again: to take it out, remove its device from the people's devices.")).toBeTruthy()
    expect(screen.queryByRole('switch', { name: 'MacBook can start runs here' })).toBeNull()
    await confirm('Remove MacBook')
    await waitFor(() => expect(removeMachine).toHaveBeenCalledWith('http://127.0.0.1:4210'))
  })

  test('a person\'s own computer whose servers cannot be read shows the page, with why', async () => {
    const { host } = dashboard(() => ({ ok: false, error: 'the command could not be run' }))
    show(host)
    expect(await screen.findByRole('button', { name: 'Set up a server' })).toBeTruthy()
    expect((await screen.findByRole('alert')).textContent).toContain('the command could not be run')
  })

  test('a server installed before this computer\'s OpenAgent got a new step shows it as not started, and has Update to run it, behind or not', async () => {
    const { host, ran } = dashboard(() => ok({ servers: [server(['done', 'done', 'done', 'waiting', 'done', 'done', 'done', 'done'], { adding: false, user: 'ubuntu' })] }), BOX_SAVED())
    show(host)
    await open('203.0.113.5')
    expect(await screen.findByText('OpenAgent 1.2.3')).toBeTruthy()
    expect(stepNames()).toContain('Your name and email for git: not started')
    fireEvent.click(screen.getByRole('button', { name: 'Update 203.0.113.5' }))
    await waitFor(() => expect(ran()).toContain('connect 203.0.113.5 ubuntu 1.2.3'))
  })

  test('a server that is not among the machines is not put back by itself; Remove takes it off this list', async () => {
    const { host, ran, addMachine, removeMachine } = dashboard(() => ok({ servers: [server(ALL_DONE, { adding: false })] }))
    show(host)
    await open('203.0.113.5')
    expect(await screen.findByText('Installed. A run cannot be sent to it yet')).toBeTruthy()
    await new Promise(resolve => setTimeout(resolve, 120))
    expect(addMachine).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Finish connecting 203.0.113.5' })).toBeTruthy()
    await confirm('Remove 203.0.113.5')
    await waitFor(() => expect(ran()).toContain('forget 203.0.113.5'))
    expect(removeMachine).not.toHaveBeenCalled()
  })

  test('each device is listed once, the server after the computers; Remove takes this computer out of the server and the server off the list, and not while a run is at work there', async () => {
    const BOX = { id: 'https://203.0.113.5', label: '203.0.113.5', url: 'https://203.0.113.5', version: '1.2.3' }
    const STUDIO = { id: 'http://192.168.1.5:4200', label: 'Studio', url: 'http://192.168.1.5:4200', version: '1.2.0' }
    const OFF = { id: 'http://box.tail.ts:4200', label: 'Old box', url: 'http://box.tail.ts:4200' }
    const { host, ran, removeMachine } = dashboard(() => ok({ servers: [server(ALL_DONE, { adding: false })] }), { version: '1.2.3', machines: [STUDIO, BOX, OFF] })
    show(host)
    const studio = await screen.findByRole('listitem', { name: 'Studio' })
    expect(within(screen.getByRole('list', { name: 'Your devices' })).getAllByRole('listitem').map(item => item.getAttribute('aria-label'))).toEqual(['Studio', 'Old box', '203.0.113.5'])
    // A computer saved with its link: whether it answers, and no word about being behind.
    expect(within(studio).getByText('Online')).toBeTruthy()
    expect(studio.textContent).not.toContain('Update')
    expect(within(screen.getByRole('listitem', { name: 'Old box' })).getByText('Offline')).toBeTruthy()

    await open('203.0.113.5')
    removeMachine.mockResolvedValueOnce({ ok: false, error: 'An agent is working on 203.0.113.5. Stop it, or wait until it ends, then remove the machine.' })
    await confirm('Remove 203.0.113.5')
    expect(await screen.findByText(/^An agent is working on 203\.0\.113\.5\./)).toBeTruthy()
    expect(ran()).not.toContain('forget 203.0.113.5')

    await confirm('Remove 203.0.113.5')
    await waitFor(() => expect(ran()).toContain('forget 203.0.113.5'))
    expect(removeMachine.mock.calls.map(([id]) => id)).toEqual([BOX.id, BOX.id])
    // What was said of the first try is gone with the second.
    expect(screen.queryByText(/^An agent is working/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Back to Devices' }))
    await open('Studio')
    await confirm('Remove Studio')
    await waitFor(() => expect(removeMachine).toHaveBeenLastCalledWith(STUDIO.id))
    expect(ran().filter(line => line.startsWith('forget '))).toHaveLength(1)
  })

  test('before this computer said which machines it has, the page does not claim there are none; once it has, a code someone gave is pasted with Join with a code', async () => {
    const { host, machines } = dashboard(() => ok({ servers: [] }))
    let say: (saved: ModuleMachines) => void = () => {}
    machines.mockImplementationOnce(() => new Promise<ModuleMachines>(resolve => (say = resolve)))
    show(host)
    await waitFor(() => expect(machines).toHaveBeenCalled())
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(screen.queryByText('Add your first device')).toBeNull()
    say({ version: '1.2.3', machines: [] })
    expect(await screen.findByText('Add your first device')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Join with a code' }))
    expect(await screen.findByText('Type what the other device shows.')).toBeTruthy()
  })

  test('an installed server lists the devices that are in on it, with when each was last there; Remove takes one out there, and this computer is not taken out as a device is', async () => {
    // This computer says which of the server's devices its own OpenAgent is: the id it is listed under there.
    const saved = BOX_SAVED({ device: 'c1b2c3d4e5f6' })
    const ago = (minutes: number): string => new Date(Date.now() - minutes * 60_000).toISOString()
    const PHONE: DeviceRow = { id: 'a1b2c3d4e5f6', name: 'iPhone, Safari', added: ago(3 * 24 * 60), seen: ago(5) }
    const NEVER: DeviceRow = { id: 'b1b2c3d4e5f6', name: 'Mac, Chrome', added: ago(2 * 24 * 60) }
    const MINE: DeviceRow = { id: '0f9e8d7c6b5a', name: 'MacBook', added: ago(60), seen: ago(1), line: true, own: true }
    const OTHER: DeviceRow = { id: '112233445566', name: 'Studio', added: ago(60), line: true }
    const KEY: DeviceRow = { id: 'c1b2c3d4e5f6', name: 'OpenAgent on MacBook', added: ago(90), seen: ago(1) }
    // An older key of the same computer, which opens nothing any more: named alike, and a device like any other.
    const DEAD: DeviceRow = { id: 'd1b2c3d4e5f6', name: 'OpenAgent on MacBook', added: ago(3 * 24 * 60), seen: ago(2 * 24 * 60) }
    let listed = [PHONE, NEVER, MINE, OTHER, KEY, DEAD]
    let refuses = false
    const { host, runComputerCommand } = dashboard(() => ok({ servers: [server(ALL_DONE, { adding: false, reach: 'full' })] }), saved, { ok: true }, NO_GH, args => {
      if (args[0] === 'remove-device') {
        if (refuses) return { ok: false, error: `no device has the id ${args[2]}` }
        listed = listed.filter(device => device.id !== args[2])
      }
      return ok({ devices: listed })
    })
    show(host)
    // This person's phones at the server are in their list too, through it.
    expect((await screen.findByRole('listitem', { name: 'iPhone, Safari' })).textContent).toContain('through 203.0.113.5')
    await open('203.0.113.5')
    await tab('People')
    const list = await screen.findByRole('list', { name: 'The devices that are in on 203.0.113.5' })
    const rows = (): string[] => within(list).getAllByRole('listitem').map(item => item.textContent ?? '')
    expect(rows()).toHaveLength(6)
    expect(rows()[0]).toMatch(/^iPhone, SafariAdded 3d ago, last seen 5m ago/)
    // A device that never came back after it got in says only when it was added.
    expect(rows()[1]).toMatch(/^Mac, ChromeAdded 2d ago(?!, last seen)/)
    // This computer's own line is named as such, and has no Remove: it goes with the server.
    expect(rows()[2]).toContain('This computer. To take it out, remove the server.')
    expect(screen.queryByRole('button', { name: 'Remove MacBook from 203.0.113.5' })).toBeNull()
    expect(rows()[3]).toContain('A computer that keeps a line open to the server')
    expect(screen.getByRole('button', { name: 'Remove Studio from 203.0.113.5' })).toBeTruthy()
    // This computer's own OpenAgent there is named as such too, and has no Remove; its older key, named alike, has one.
    expect(rows()[4]).toContain('This computer. To take it out, remove the server.')
    expect(rows()[5]).not.toContain('This computer')
    expect(screen.getAllByRole('button', { name: 'Remove OpenAgent on MacBook from 203.0.113.5' })).toHaveLength(1)
    expect(runComputerCommand).toHaveBeenCalledWith(['devices', '203.0.113.5'])

    fireEvent.click(screen.getByRole('button', { name: 'Remove iPhone, Safari from 203.0.113.5' }))
    await waitFor(() => expect(runComputerCommand).toHaveBeenCalledWith(['remove-device', '203.0.113.5', PHONE.id]))
    await waitFor(() => expect(rows()).toHaveLength(5))
    expect(screen.queryByText('iPhone, Safari')).toBeNull()

    // A device the server did not take out stays listed, with what the server said.
    refuses = true
    fireEvent.click(screen.getByRole('button', { name: 'Remove Mac, Chrome from 203.0.113.5' }))
    expect((await screen.findByRole('alert')).textContent).toBe(`no device has the id ${NEVER.id}`)
    expect(rows()).toHaveLength(5)
  })

  test('a server that no longer lets this computer in for its line: the switch under This computer reads off and says why, and turning it on asks for the line anew', async () => {
    let lineRefused = true
    const { host, ran } = dashboard(() => ok({ servers: [server(ALL_DONE, { adding: false, reach: 'full' })] }), BOX_SAVED(), { ok: true }, NO_GH, () => ok({ devices: [], lineRefused }))
    show(host)
    const theSwitch = () => screen.getByRole('switch', { name: 'From anywhere, through 203.0.113.5' })
    await screen.findByText('Off: 203.0.113.5 no longer lets this computer in for its line. Turn it on to set the line up again.')
    expect(theSwitch().getAttribute('aria-checked')).toBe('false')
    // The server's own file still says "full": what the door says of the line is what counts.
    fireEvent.click(theSwitch())
    await waitFor(() => expect(ran()).toContain('reach 203.0.113.5 full'))
    // At once, before the next look at the server's devices says so too.
    await waitFor(() => expect(theSwitch().getAttribute('aria-checked')).toBe('true'))
    // What the door says at each look is what the switch reads: a door that still says refused after the press is believed, and the switch is off again.
    await screen.findByText(/^Off: 203\.0\.113\.5 no longer lets this computer in for its line\./)
    expect(theSwitch().getAttribute('aria-checked')).toBe('false')
    // And once the door says the line is let in, it is on with nothing pressed.
    lineRefused = false
    await waitFor(() => expect(theSwitch().getAttribute('aria-checked')).toBe('true'))
  })

  test('a server with no device says so; one whose devices cannot be read says why, and goes on showing the last it read; one never read says only that; a server that is not installed is not asked', async () => {
    let answer: ModuleCommandResult = ok({ devices: [] })
    const { host } = dashboard(() => ok({ servers: [server(ALL_DONE, { adding: false })] }), BOX_SAVED(), { ok: true }, NO_GH, () => answer)
    show(host)
    await open('203.0.113.5')
    await tab('People')
    expect(await screen.findByText('Nobody yet. Invite gives someone a code; your own phone is added with Add device.')).toBeTruthy()
    answer = ok({ devices: [{ id: 'a1b2c3d4e5f6', name: 'iPhone, Safari', added: new Date().toISOString() }] })
    expect(await screen.findByText('iPhone, Safari')).toBeTruthy()
    answer = { ok: false, error: 'ssh: connect to host 203.0.113.5 port 22: Connection refused' }
    expect((await screen.findByRole('alert')).textContent).toBe('ssh: connect to host 203.0.113.5 port 22: Connection refused')
    // The list it read before stays, with its Remove: one read that fails takes nothing off the page.
    expect(screen.getByText('iPhone, Safari')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove iPhone, Safari from 203.0.113.5' })).toBeTruthy()
    expect(screen.queryByText('The devices that are in on the server could not be read.')).toBeNull()
    cleanup()

    const never = dashboard(() => ok({ servers: [server(ALL_DONE, { adding: false })] }), BOX_SAVED(), { ok: true }, NO_GH, () => answer)
    show(never.host)
    await open('203.0.113.5')
    await tab('People')
    expect(await screen.findByText('The devices that are in on the server could not be read.')).toBeTruthy()
    expect((await screen.findByRole('alert')).textContent).toBe('ssh: connect to host 203.0.113.5 port 22: Connection refused')
    cleanup()

    const installing = dashboard(() => ok({ servers: [server(['done', 'running'], { working: true })] }))
    show(installing.host)
    await open('203.0.113.5')
    await screen.findByRole('list', { name: 'The install on 203.0.113.5' })
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(installing.runComputerCommand).not.toHaveBeenCalledWith(['devices', '203.0.113.5'])
  })

  test('a server is asked for its devices one read at a time: a read that takes long is not joined by the next', async () => {
    const { host, runComputerCommand } = dashboard(() => ok({ servers: [server(ALL_DONE, { adding: false })] }), BOX_SAVED())
    let answer: (result: ModuleCommandResult) => void = () => {}
    const slow = new Promise<ModuleCommandResult>(resolve => (answer = resolve))
    const asked = (): number => runComputerCommand.mock.calls.filter(([args]) => args[0] === 'devices' && !args.includes('--last')).length
    const usual = runComputerCommand.getMockImplementation()!
    runComputerCommand.mockImplementation(async (args: string[]) =>
      args[0] === 'devices' && args.includes('--last') ? { ok: false, error: '203.0.113.5 was not listed here yet' } : args[0] === 'devices' && asked() === 1 ? slow : usual(args),
    )
    show(host)
    await waitFor(() => expect(asked()).toBe(1))
    // Many looks later the server was still asked once: its answer has not come.
    await new Promise(resolve => setTimeout(resolve, 400))
    expect(asked()).toBe(1)
    answer(ok({ devices: [{ id: 'a1b2c3d4e5f6', name: 'iPhone, Safari', added: new Date().toISOString() }] }))
    expect(await screen.findByText('iPhone, Safari')).toBeTruthy()
    await waitFor(() => expect(asked()).toBeGreaterThan(1))
  })

  test('while the server is slow to say who is in, the list as last told on this computer shows at once; the server\'s answer takes its place', async () => {
    const { host, runComputerCommand } = dashboard(() => ok({ servers: [server(ALL_DONE, { adding: false })] }), BOX_SAVED())
    let answer: (result: ModuleCommandResult) => void = () => {}
    const slow = new Promise<ModuleCommandResult>(resolve => (answer = resolve))
    const usual = runComputerCommand.getMockImplementation()!
    const added = new Date().toISOString()
    runComputerCommand.mockImplementation(async (args: string[]) =>
      args[0] === 'devices' && args.includes('--last') ? ok({ devices: [{ id: 'a1b2c3d4e5f6', name: 'iPhone, Safari', added }] }) : args[0] === 'devices' ? slow : usual(args),
    )
    show(host)
    expect(await screen.findByText('iPhone, Safari')).toBeTruthy()
    answer(ok({ devices: [{ id: 'b1b2c3d4e5f6', name: 'Mac, Chrome', added }] }))
    expect(await screen.findByText('Mac, Chrome')).toBeTruthy()
    expect(screen.queryByText('iPhone, Safari')).toBeNull()
  })

  test('a device that was taken out stays off the page when the read made after it fails; a tab nobody looks at asks the server nothing', async () => {
    const PHONE: DeviceRow = { id: 'a1b2c3d4e5f6', name: 'iPhone, Safari', added: new Date().toISOString() }
    const MAC: DeviceRow = { id: 'b1b2c3d4e5f6', name: 'Mac, Chrome', added: new Date().toISOString() }
    let fails = false
    const { host, runComputerCommand } = dashboard(() => ok({ servers: [server(ALL_DONE, { adding: false })] }), BOX_SAVED(), { ok: true }, NO_GH, args => {
      if (args[0] === 'remove-device') {
        // The server takes the device out, and from then on does not answer.
        fails = true
        return ok({ devices: [MAC] })
      }
      return fails ? { ok: false, error: 'ssh: connect to host 203.0.113.5 port 22: Connection refused' } : ok({ devices: [PHONE, MAC] })
    })
    const asked = (): number => runComputerCommand.mock.calls.filter(([args]) => args[0] === 'devices').length
    show(host)
    await open('203.0.113.5')
    await tab('People')
    fireEvent.click(await screen.findByRole('button', { name: 'Remove iPhone, Safari from 203.0.113.5' }))
    expect((await screen.findByRole('alert')).textContent).toBe('ssh: connect to host 203.0.113.5 port 22: Connection refused')
    await new Promise(resolve => setTimeout(resolve, 200))
    expect(screen.queryByText('iPhone, Safari')).toBeNull()
    expect(screen.getByText('Mac, Chrome')).toBeTruthy()

    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    try {
      await new Promise(resolve => setTimeout(resolve, 150))
      const before = asked()
      await new Promise(resolve => setTimeout(resolve, 300))
      expect(asked()).toBe(before)
    } finally {
      Object.defineProperty(document, 'hidden', { value: false, configurable: true })
    }
    const again = asked()
    await waitFor(() => expect(asked()).toBeGreaterThan(again))
  })

  test('a look that could not read the servers says so, and takes no row off the page', async () => {
    let fails = false
    const { host } = dashboard(() => (fails ? { ok: false, error: 'servers printed no JSON' } : ok({ servers: [server(ALL_DONE, { adding: false })] })), BOX_SAVED())
    show(host)
    const row = await screen.findByRole('listitem', { name: '203.0.113.5' })
    expect(within(row).getByText('Server')).toBeTruthy()
    fails = true
    expect(await screen.findByText('The servers could not be read: servers printed no JSON')).toBeTruthy()
    // Still the server's own row, and not a computer of another kind.
    expect(within(screen.getByRole('listitem', { name: '203.0.113.5' })).getByText('Server')).toBeTruthy()
    expect(screen.getAllByRole('listitem', { name: '203.0.113.5' })).toHaveLength(1)
  })

  test('a code leaves the page once a device got in with it', async () => {
    const LAPTOP: DeviceRow = { id: '0f9e8d7c6b5a', name: 'OpenAgent on MacBook', added: new Date().toISOString() }
    let listed = [LAPTOP]
    const { host } = dashboard(args => (args[0] === 'link' ? ok(LINK) : ok({ servers: [server(ALL_DONE, { adding: false })] })), BOX_SAVED(), { ok: true }, NO_GH, () => ok({ devices: listed, persons: [{ name: 'Ada', owner: true }] }))
    show(host)
    await open('203.0.113.5')
    await tab('People')
    await screen.findByText('OpenAgent on MacBook')
    const code = () => screen.queryByRole('group', { name: 'The code' })
    await invite('Rom')
    await waitFor(() => expect(code()).toBeTruthy())
    // The devices that were in when the code came on the page are no reason for it to leave.
    await new Promise(resolve => setTimeout(resolve, 200))
    expect(code()).toBeTruthy()
    listed = [LAPTOP, { id: 'a1b2c3d4e5f6', name: 'iPhone, Safari', added: new Date().toISOString() }]
    // The dialog says who got in, in place of the code.
    expect(await screen.findByText('iPhone, Safari is in, for Rom.')).toBeTruthy()
    expect(code()).toBeNull()

    // A computer that gets in again is a new id under the row it had, and no new row: the code is spent all the same.
    fireEvent.click(screen.getByRole('button', { name: 'New code' }))
    await waitFor(() => expect(code()).toBeTruthy())
    await new Promise(resolve => setTimeout(resolve, 200))
    expect(code()).toBeTruthy()
    listed = [{ ...LAPTOP, also: ['c1b2c3d4e5f6'] }, listed[1]!]
    expect(await screen.findByText('OpenAgent on MacBook is in, for Rom.')).toBeTruthy()
    expect(code()).toBeNull()
  })

  test('servers that cannot be read say so', async () => {
    const unread = dashboard(() => ({ ok: false, error: 'servers printed no JSON' }))
    show(unread.host)
    expect(await screen.findByText('The servers could not be read: servers printed no JSON')).toBeTruthy()
  })

  test('a server among the machines has a switch under This computer that lets it start runs here: off until set, on asks for the line, off again leaves it only watching', async () => {
    let row = server(ALL_DONE, { adding: false })
    const { host, ran } = dashboard(args => {
      if (args[0] === 'reach') row = { ...row, reach: args[2] as 'full' | 'watch' }
      return ok({ servers: [row] })
    }, BOX_SAVED())
    show(host)
    const card = within(await screen.findByRole('region', { name: 'This computer' }))
    const theSwitch = () => card.getByRole('switch', { name: 'From anywhere, through 203.0.113.5' })
    await waitFor(() => expect(theSwitch().getAttribute('aria-checked')).toBe('false'))
    expect(card.getByText('Your phone and your other computers start runs here from any internet. This computer must be on.')).toBeTruthy()
    fireEvent.click(theSwitch())
    await waitFor(() => expect(ran()).toContain('reach 203.0.113.5 full'))
    await waitFor(() => expect(theSwitch().getAttribute('aria-checked')).toBe('true'))
    fireEvent.click(theSwitch())
    await waitFor(() => expect(ran()).toContain('reach 203.0.113.5 watch'))
    await waitFor(() => expect(theSwitch().getAttribute('aria-checked')).toBe('false'))
  })

  test('a server that is not among the machines, or still being installed, has no such switch; a line that could not be set up says why', async () => {
    const { host } = dashboard(() => ok({ servers: [server(['done', 'running'], { working: true })] }))
    show(host)
    await screen.findByRole('listitem', { name: '203.0.113.5' })
    expect(screen.queryByRole('switch', { name: 'From anywhere, through 203.0.113.5' })).toBeNull()
    cleanup()
    const refusing = dashboard(args => (args[0] === 'reach' ? { ok: false, error: 'The server did not give a line: this door gives no line: only a server does' } : ok({ servers: [server(ALL_DONE, { adding: false })] })), BOX_SAVED())
    show(refusing.host)
    fireEvent.click(await screen.findByRole('switch', { name: 'From anywhere, through 203.0.113.5' }))
    await screen.findByText('The server did not give a line: this door gives no line: only a server does')
  })

  test('older is by the three numbers of a version', () => {
    expect(olderThan('1.2.0', '1.2.3')).toBe(true)
    expect(olderThan('0.9.9', '0.10.0')).toBe(true)
    expect(olderThan('1.2.3', '1.2.3')).toBe(false)
    expect(olderThan('2.0.0', '1.9.9')).toBe(false)
    expect(olderThan('unknown', '1.2.3')).toBe(false)
  })

  test('a server\'s Invite for someone else names the owner first, starting from the name git knows here, and its devices are listed by person', async () => {
    let persons: unknown[] = []
    const PHONE = { id: 'a1b2c3d4e5f6', name: 'Pixel, Chrome', added: new Date().toISOString() }
    const { host, runComputerCommand } = dashboard(
      args => {
        if (args[0] === 'link') return ok(LINK)
        if (args[0] === 'owner') return (persons = [{ name: args[2], owner: true }, { name: 'Rom' }]), ok({ devices: [{ ...PHONE, person: 'Rom' }], persons })
        if (args[0] === 'remove-person') return ok({ devices: [], persons: [persons[0]] })
        return ok({ servers: [server(ALL_DONE, { adding: false })] })
      },
      BOX_SAVED(),
      { ok: true },
      NO_GH,
      () => ok({ devices: persons.length ? [{ ...PHONE, person: 'Rom' }] : [], persons }),
      args => ok(args[0] === 'me' ? { name: 'Ada' } : DOOR_SHUT),
    )
    show(host)
    await open('203.0.113.5')
    await tab('People')
    await invite('Rom')
    const own = (await screen.findByRole('textbox', { name: 'First, your name?' })) as HTMLInputElement
    await waitFor(() => expect(own.value).toBe('Ada'))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText(/^Rom gets a user of their own on 203\.0\.113\.5/)).toBeTruthy()
    expect(runComputerCommand).toHaveBeenCalledWith(['owner', '203.0.113.5', 'Ada'])
    expect(runComputerCommand).toHaveBeenCalledWith(['link', '203.0.113.5', '--for', 'Rom'])
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))

    expect(await screen.findByText('Ada, the owner')).toBeTruthy()
    expect((await screen.findByRole('list', { name: 'Devices of Rom on 203.0.113.5' })).textContent).toContain('Pixel, Chrome')
    fireEvent.click(screen.getByRole('button', { name: 'Remove Rom from 203.0.113.5' }))
    // Said first: their user on the server goes with everything in it.
    expect((await screen.findByRole('alertdialog')).textContent).toContain('their own user on the server is deleted with everything in it')
    expect(runComputerCommand).not.toHaveBeenCalledWith(['remove-person', '203.0.113.5', 'Rom'])
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove person' }))
    await waitFor(() => expect(runComputerCommand).toHaveBeenCalledWith(['remove-person', '203.0.113.5', 'Rom']))
  })

  test('a server lists the computers that keep a line to it; Add saves one, reached through the server, and a computer saved so is listed through it', async () => {
    const through = { id: 'https://203.0.113.5/_devices/via/abc123def456', label: 'Studio (through 203.0.113.5)', url: 'https://203.0.113.5/_devices/via/abc123def456', version: '1.2.3' }
    const saved = BOX_SAVED()
    const { host, computersThrough, addComputerThrough } = dashboard(() => ok({ servers: [server(ALL_DONE, { adding: false })] }), saved)
    let added = false
    computersThrough.mockImplementation(async () => ({ ok: true, computers: [{ id: 'abc123def456', name: 'Studio', online: true, added }] }))
    addComputerThrough.mockImplementation(async () => ((added = true), saved.machines.push(through), { ok: true }))
    show(host)
    await open('203.0.113.5')
    const list = await screen.findByRole('list', { name: 'The computers on 203.0.113.5' })
    expect(list.textContent).toContain('Studio')
    expect(list.textContent).toContain('Online')
    fireEvent.click(screen.getByRole('button', { name: 'Add Studio through 203.0.113.5' }))
    await waitFor(() => expect(addComputerThrough).toHaveBeenCalledWith('https://203.0.113.5', 'abc123def456'))
    expect(await screen.findByText('In "Run on"')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back to Devices' }))
    expect((await screen.findByRole('listitem', { name: 'Studio (through 203.0.113.5)' }, { timeout: 15_000 })).textContent).toContain('through 203.0.113.5')
  })

  test('a server no computer keeps a line to shows no such list', async () => {
    const { host, computersThrough } = dashboard(() => ok({ servers: [server(ALL_DONE, { adding: false })] }), BOX_SAVED())
    show(host)
    await open('203.0.113.5')
    await waitFor(() => expect(computersThrough).toHaveBeenCalledWith('https://203.0.113.5'))
    expect(screen.queryByText('Computers on this server')).toBeNull()
  })

  test('a server someone invited this computer\'s person to is a server with that person\'s own line and devices, all through its door; nothing only its owner does', async () => {
    const SHARED = 'https://198.51.100.7'
    const saved: ModuleMachines = { version: '1.2.3', machines: [{ id: SHARED, label: '198.51.100.7', url: SHARED, version: '1.2.3', device: 'k1abcd' }] }
    const kept = { shared: [{ url: SHARED }] }
    const { host, runComputerCommand, runComputerCommandOn, machinePerson, removeMachineDevice, removeMachine } = dashboard(args => (args[0] === 'status' ? ok({ servers: [] }) : ok(kept)), saved)
    const PHONE = { id: 'p1abcd', name: 'iPhone, Safari', added: '2026-10-19T00:00:00.000Z' }
    machinePerson.mockImplementation(async () => ({ ok: true, said: { person: 'rom', owner: false, devices: [{ id: 'k1abcd', name: 'OpenAgent on Roms-Mac', added: '2026-10-19T00:00:00.000Z' }, PHONE] } }))
    removeMachineDevice.mockImplementation(async () => ({ ok: true, said: { person: 'rom', owner: false, devices: [] } }))
    show(host)
    // The line to it is a switch under This computer, as any server's.
    fireEvent.click(await screen.findByRole('switch', { name: 'From anywhere, through 198.51.100.7' }))
    await waitFor(() => expect(runComputerCommand).toHaveBeenCalledWith(['shared-reach', SHARED, 'full']))
    // The person's phone there is in their list, through it.
    expect((await screen.findByRole('listitem', { name: 'iPhone, Safari' })).textContent).toContain('through 198.51.100.7')

    await open('198.51.100.7')
    expect(await screen.findByText('You are in as rom.')).toBeTruthy()
    expect(screen.getByText('Your runs there are yours: they use your own GitHub and Claude logins.')).toBeTruthy()
    // What only the owner does is not there; its logins are in Settings › Accounts, and nothing is asked of the person's own OpenAgent there.
    expect(screen.queryByRole('button', { name: /^Invite/ })).toBeNull()
    expect(screen.queryByText(/Installed, as/)).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Logins' })).toBeNull()
    expect(runComputerCommandOn).not.toHaveBeenCalled()

    // The person's own devices, this computer's OpenAgent among them with no Remove.
    await tab('Your devices')
    const devices = await screen.findByRole('list', { name: 'Your devices on 198.51.100.7' })
    expect(devices.textContent).toContain('iPhone, Safari')
    expect(within(devices).queryByRole('button', { name: 'Remove OpenAgent on Roms-Mac from 198.51.100.7' })).toBeNull()
    fireEvent.click(within(devices).getByRole('button', { name: 'Remove iPhone, Safari from 198.51.100.7' }))
    await waitFor(() => expect(removeMachineDevice).toHaveBeenCalledWith(SHARED, 'p1abcd'))

    await tab('Overview')
    await confirm('Remove 198.51.100.7')
    await waitFor(() => expect(runComputerCommand).toHaveBeenCalledWith(['shared-forget', SHARED]))
    await waitFor(() => expect(removeMachine).toHaveBeenCalledWith(SHARED))
  })

  test('a server set up from another computer of this person\'s is theirs here too: it has its own switch under This computer, which only the computer that installed it had', async () => {
    const saved: ModuleMachines = { version: '1.2.3', machines: [{ id: 'https://198.51.100.7', label: 'Box', url: 'https://198.51.100.7', version: '1.2.3' }, { id: 'https://198.51.100.8', label: 'my-vps', url: 'https://198.51.100.8', version: '1.2.3' }] }
    const { host, runComputerCommand, machinePerson, runComputerCommandOn } = dashboard(args => (args[0] === 'status' ? ok({ servers: [] }) : ok({ shared: [{ url: 'https://198.51.100.8' }] })), saved)
    machinePerson.mockImplementation(async id => (id === 'https://198.51.100.8' ? { ok: true, said: { person: 'ada', owner: true, devices: [] } } : { ok: false, error: 'not said', unknown: true }))
    show(host)
    // Its owner's other computer: one switch, through it, as on the computer that set it up.
    const theSwitch = await screen.findByRole('switch', { name: 'From anywhere, through my-vps' })
    fireEvent.click(theSwitch)
    await waitFor(() => expect(runComputerCommand).toHaveBeenCalledWith(['shared-reach', 'https://198.51.100.8', 'full']))
    expect(within(await screen.findByRole('listitem', { name: 'my-vps' })).getByText('yours')).toBeTruthy()
    // A machine whose door does not say is a computer like any other, with no switch through it.
    expect(within(screen.getByRole('listitem', { name: 'Box' })).getByText('Computer')).toBeTruthy()
    expect(screen.queryByRole('switch', { name: 'From anywhere, through Box' })).toBeNull()
    await open('my-vps')
    expect(await screen.findByText('Yours, set up from another computer.')).toBeTruthy()
    expect(screen.queryByRole('tab', { name: 'Logins' })).toBeNull()
    expect(runComputerCommandOn).not.toHaveBeenCalled()
  })

  test('another person\'s computer on a server says whose it is in the server\'s list, and its page says which of this person\'s logins are there, each made here in place of a copy', async () => {
    const SERVER = 'https://203.0.113.5'
    const BOX = `${SERVER}/_devices/via/b0x1d2`
    const saved: ModuleMachines = { version: '1.2.3', machines: [{ id: SERVER, label: '203.0.113.5', url: SERVER, version: '1.2.3' }, { id: BOX, label: 'rom-desktop (through 203.0.113.5)', url: BOX, version: '1.2.3', owner: 'rom' }] }
    let logins: unknown = { github: { source: 'copied', from: 'vps-1', account: 'sul' } }
    const { host, runComputerCommand, computersThrough } = dashboard(
      args => (args[0] === 'status' ? ok({ servers: [] }) : args[0] === 'other' || args[0] === 'other-login' ? ok({ other: [{ url: BOX, logins, claude: { there: false, working: false } }] }) : ok({})),
      saved,
      { ok: true },
      OCTOCAT,
    )
    computersThrough.mockImplementation(async () => ({ ok: true, computers: [{ id: 'b0x1d2', name: 'rom-desktop', online: true, added: true, owner: 'rom' }] }))
    show(host)
    expect((await screen.findByRole('listitem', { name: 'rom-desktop (through 203.0.113.5)' })).textContent).toContain("rom's server")
    await open('203.0.113.5')
    const list = await screen.findByRole('list', { name: 'The computers on 203.0.113.5' })
    expect(list.textContent).toContain("rom-desktop· rom's · for everyone")
    fireEvent.click(screen.getByRole('button', { name: 'Back to Devices' }))

    await open('rom-desktop (through 203.0.113.5)')
    expect(await screen.findByText("rom's server, for everyone on 203.0.113.5. Your runs there use your own logins.")).toBeTruthy()
    const logins_ = await screen.findByRole('list', { name: 'Your logins on rom-desktop (through 203.0.113.5)' })
    await waitFor(() => expect(logins_.textContent).toContain('GitHub: copied from vps-1.'))
    expect(logins_.textContent).toContain('Claude: not on rom-desktop (through 203.0.113.5) yet: it is copied from 203.0.113.5 at your first run there.')

    logins = { github: { source: 'made', account: 'sul' } }
    fireEvent.click(screen.getByRole('button', { name: 'Log in to GitHub on rom-desktop (through 203.0.113.5) instead' }))
    await waitFor(() => expect(runComputerCommand).toHaveBeenCalledWith(['other-login', BOX, 'github']))
    await waitFor(() => expect(logins_.textContent).toContain('GitHub: made here.'))
    fireEvent.click(screen.getByRole('button', { name: 'Log in to Claude on rom-desktop (through 203.0.113.5) instead' }))
    await waitFor(() => expect(runComputerCommand).toHaveBeenCalledWith(['other-login', BOX, 'claude']))
  })
})

describe('Settings › Devices: a computer at home set up as a server, through a server', () => {
  const VPS = 'https://165.245.244.10'
  const VIA = `${VPS}/_devices/via/line12345678`
  const THROUGH_LABELS = { ...LABELS, door: undefined, line: 'Its line to 165.245.244.10' }
  /** Rom's computer at home, set up as a server through the server he is in at. */
  function box(over: Partial<ServerRow> = {}): ServerRow {
    const steps = Object.entries(THROUGH_LABELS)
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .map(([id, label]) => ({ id, label, state: 'done' as const }))
    return { address: '192.168.1.20', url: VIA, user: 'rom', working: false, adding: false, through: VPS, who: 'me', steps, ...over }
  }
  const SAVED: ModuleMachines = { version: '1.2.3', machines: [{ id: VPS, label: '165.245.244.10', url: VPS, version: '1.2.3' }, { id: VIA, label: 'rom-box', url: VIA, version: '1.2.3' }] }

  test('its page is a server at home, reached through another: who may start runs on it in place of an Invite, and no line from this computer', async () => {
    const { host, ran, machinePerson } = dashboard(() => ok({ servers: [box()] }), SAVED)
    machinePerson.mockImplementation(async id => (id === VPS ? { ok: true, said: { person: 'rom', owner: false, devices: [], persons: ['suleimansh', 'rom', 'dani'] } } : { ok: false, error: 'not said', unknown: true }))
    show(host)
    const row = await screen.findByRole('listitem', { name: 'rom-box' })
    expect(row.textContent).toContain('Server at home')
    expect(row.textContent).toContain('through 165.245.244.10')
    expect(screen.queryByRole('switch', { name: 'From anywhere, through rom-box' })).toBeNull()
    await open('rom-box')
    const group = await screen.findByRole('radiogroup', { name: 'Who can start runs on 192.168.1.20' })
    expect(within(group).getByRole('radio', { name: /Only me/ }).getAttribute('aria-checked')).toBe('true')
    expect(within(group).getByRole('radio', { name: /Nobody: its runs only show on 165\.245\.244\.10/ })).toBeTruthy()
    await waitFor(() => expect(within(group).getByRole('radio', { name: /Everyone on 165\.245\.244\.10 \(3 people\)/ })).toBeTruthy())
    expect(group.textContent).toContain("Each person's runs use their own logins, never yours.")
    expect(group.textContent).toContain('Their agents run on your home network.')
    expect(screen.queryByRole('button', { name: 'Invite to 192.168.1.20' })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'People' })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Logins' })).toBeNull()

    fireEvent.click(within(await screen.findByRole('radiogroup', { name: 'Who can start runs on 192.168.1.20' })).getByRole('radio', { name: /Everyone/ }))
    await waitFor(() => expect(ran()).toContain('who 192.168.1.20 everyone'))
  })

  test('from everyone to fewer, it asks first what becomes of the others\' users there: they go, or stay switched off', async () => {
    const persons = [{ name: 'rom', owner: true }, { name: 'suleimansh', from: VPS }, { name: 'dani', from: VPS }]
    const { host, ran } = dashboard(() => ok({ servers: [box({ who: 'everyone' })] }), SAVED, undefined, undefined, () => ok({ devices: [], persons }))
    show(host)
    await open('rom-box')
    const group = () => screen.getByRole('radiogroup', { name: 'Who can start runs on 192.168.1.20' })
    await screen.findByRole('radiogroup', { name: 'Who can start runs on 192.168.1.20' })
    fireEvent.click(within(group()).getByRole('radio', { name: /Only me/ }))
    expect(await screen.findByText('suleimansh and dani have their own users on 192.168.1.20.')).toBeTruthy()
    expect(screen.getByText('Work they did not push goes with them.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Keep them, switched off' }))
    await waitFor(() => expect(ran()).toContain('who 192.168.1.20 me'))
    expect(ran()).not.toContain('who 192.168.1.20 me remove')

    fireEvent.click(within(group()).getByRole('radio', { name: /Nobody/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Remove them, with their logins and projects' }))
    await waitFor(() => expect(ran()).toContain('who 192.168.1.20 nobody remove'))

    // Cancel changes nothing.
    fireEvent.click(within(group()).getByRole('radio', { name: /Only me/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByText(/have their own users/)).toBeNull())
    expect(ran().filter(line => line.startsWith('who '))).toEqual(['who 192.168.1.20 me', 'who 192.168.1.20 nobody remove'])
  })

  test('once installed it is saved through its server, by its line, and no link is asked of it', async () => {
    const { host, ran, addMachine } = dashboard(() => ok({ servers: [box({ adding: true, url: 'https://192.168.1.20' })] }), { version: '1.2.3', machines: [{ id: VPS, label: '165.245.244.10', url: VPS }] })
    show(host)
    await waitFor(() => expect(ran()).toContain('add-through 192.168.1.20'))
    expect(ran().some(line => line.startsWith('link '))).toBe(false)
    expect(addMachine).not.toHaveBeenCalled()
  })
})

describe('Settings › Devices: Set up a server, in steps', () => {
  const VPS = 'https://165.245.244.10'
  const VIA = `${VPS}/_devices/via/line12345678`
  const WITH_VPS: ModuleMachines = { version: '1.2.3', machines: [{ id: VPS, label: '165.245.244.10', url: VPS, version: '1.2.3' }] }
  const LINE = `sudo sh -c 'apt-get install -y openssh-server && echo the-rest'`
  const failed = (trouble: string, more: Record<string, unknown> = {}): ModuleCommandResult => ok({ ok: false, trouble, reached: trouble !== 'unreachable', said: `ssh said ${trouble}`, ...more })
  /** Which step the dialog is at, as its steps along the top say. */
  const now = (): string | null | undefined => screen.getByRole('list', { name: 'Steps' }).querySelector('[aria-current="step"]')?.getAttribute('aria-label')
  const button = (name: string): HTMLButtonElement => screen.getByRole('button', { name }) as HTMLButtonElement
  /** Where (a PC at home, when said), then Continue. */
  async function toConnect(home = false): Promise<void> {
    await openConnect()
    if (home) fireEvent.click(await screen.findByRole('radio', { name: /A PC at home/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))
    await screen.findByLabelText("The server's address")
  }
  /** Type the address, and the user when said, and press Test connection. */
  function testAs(address: string, user?: string): void {
    fireEvent.change(screen.getByLabelText("The server's address"), { target: { value: address } })
    if (user !== undefined) fireEvent.change(screen.getByLabelText('User name'), { target: { value: user } })
    fireEvent.click(button('Test connection'))
  }

  test('a cloud server: Where, a test that goes through, its logins, then Install starts this computer\'s own OpenAgent there, in no project', async () => {
    const { host, ran } = dashboard(() => ok({ servers: [] }))
    show(host)
    await openConnect()
    expect(now()).toBe('Where: now')
    // A PC at home goes through a cloud server: with none, it cannot be picked yet.
    expect((screen.getByRole('radio', { name: /A PC at home/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Set up a cloud server first.')).toBeTruthy()
    fireEvent.click(button('Continue'))
    expect(await screen.findByText('Its address')).toBeTruthy()
    expect(now()).toBe('Connect: now')
    expect((screen.getByLabelText('User name') as HTMLInputElement).value).toBe('root')
    expect(button('Continue').disabled).toBe(true)
    testAs(' 203.0.113.5 ')
    expect(await screen.findByText('Ubuntu 24.04.1 LTS, x86_64: OpenAgent installs there')).toBeTruthy()
    expect(screen.getByText('Reached 203.0.113.5')).toBeTruthy()
    expect(screen.getByText('Logged in as root')).toBeTruthy()
    expect(ran()).toContain('test 203.0.113.5 root')
    // Another address is not tested yet: Continue waits for its own test.
    fireEvent.change(screen.getByLabelText("The server's address"), { target: { value: '203.0.113.6' } })
    expect(screen.queryByRole('list', { name: 'What the test found' })).toBeNull()
    expect(button('Continue').disabled).toBe(true)
    fireEvent.change(screen.getByLabelText("The server's address"), { target: { value: '203.0.113.5' } })
    expect(button('Continue').disabled).toBe(false)
    fireEvent.click(button('Continue'))
    // The server uses this computer's logins unless said, in one box.
    expect((await screen.findByRole('checkbox', { name: 'Use my logins from this computer' })).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText("Runs on the server use the accounts you're logged into here. Logging in or out here updates the server.")).toBeTruthy()
    expect(screen.getByText('The server gets logins of its own. Nothing here is logged out, now or later.')).toBeTruthy()
    expect(screen.getByText('Unchecked: the server has no logins. You can turn it on later in Settings › Accounts.')).toBeTruthy()
    expect(screen.queryByRole('radiogroup')).toBeNull()
    expect(now()).toBe('Your logins: now')
    fireEvent.click(button('Install'))
    await waitFor(() => expect(ran()).toContain('connect 203.0.113.5 root 1.2.3'))
    expect(host.runCommand).not.toHaveBeenCalled()
    await waitFor(() => expect(now()).toBe('Install: now'))
    // Back to Where in another go: the dialog starts over.
    fireEvent.click(button('Close'))
    await openConnect()
    expect(now()).toBe('Where: now')
  })

  test('Install waits until this computer has said which OpenAgent it runs: that is the one the server gets', async () => {
    const { host, machines, ran } = dashboard(() => ok({ servers: [] }))
    let say: (saved: ModuleMachines) => void = () => {}
    machines.mockImplementation(() => new Promise<ModuleMachines>(resolve => (say = resolve)))
    show(host)
    await waitFor(() => expect(ran()).toContain('status'))
    // Nothing to press before then: the list is not known to be empty, and the server would get no version.
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(screen.queryByRole('button', { name: 'Set up a server' })).toBeNull()
    say({ version: '1.2.3', machines: [] })
    await toConnect()
    testAs('203.0.113.5')
    await waitFor(() => expect(button('Continue').disabled).toBe(false))
    fireEvent.click(button('Continue'))
    await waitFor(() => expect(button('Install').disabled).toBe(false))
  })

  test('what the test found is said by what to do about it: on a PC, the line to paste there once; a server pastes it in its own console', async () => {
    const writeText = vi.fn(async (_text: string) => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const answers: Record<string, ModuleCommandResult> = {
      '192.168.1.40': failed('key', { key: 'ssh-ed25519 AAAA mac', fix: LINE }),
      '192.168.1.41': failed('unreachable'),
      '192.168.1.42': failed('sudo', { key: 'ssh-ed25519 AAAA mac', fix: LINE }),
      '192.168.1.43': failed('no-key'),
      '192.168.1.44': failed('host-key'),
      '192.168.1.45': failed('system', { said: 'OpenAgent installs on Ubuntu and Debian. This server runs Fedora Linux 41.' }),
    }
    let fixed = false
    const { host, ran } = dashboard(() => ok({ servers: [] }), WITH_VPS, undefined, undefined, undefined, undefined, args => (fixed ? ok({ ok: true, system: 'Debian GNU/Linux 12 (bookworm), x86_64' }) : answers[args[1]!]!))
    show(host)
    await toConnect(true)
    expect(screen.getByText('Its address on its network')).toBeTruthy()
    // On a PC the user is the person's own there: nothing to test before it is typed.
    expect((screen.getByLabelText('User name') as HTMLInputElement).value).toBe('')
    fireEvent.change(screen.getByLabelText("The server's address"), { target: { value: '192.168.1.40' } })
    expect(button('Test connection').disabled).toBe(true)
    testAs('192.168.1.40', 'dani')
    expect(await screen.findByText('Your SSH key is not on it yet.')).toBeTruthy()
    expect(screen.getByText('Reached 192.168.1.40')).toBeTruthy()
    expect(screen.getByText('On the PC, open a terminal and paste this once. It lets this computer in, and nobody else:')).toBeTruthy()
    expect(screen.getByText(LINE)).toBeTruthy()
    expect(screen.getByText("It asks for the PC's password once: it turns SSH on, adds this computer's key, and lets dani install without a password. Then press Test connection again.")).toBeTruthy()
    fireEvent.click(button('Copy the line for the PC'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(LINE))
    expect(button('Continue').disabled).toBe(true)

    testAs('192.168.1.41')
    expect(await screen.findByText('Nothing answers at 192.168.1.41. Check the address, and that the PC is on and on this network.')).toBeTruthy()
    expect(screen.queryByText('Reached 192.168.1.41')).toBeNull()
    expect(screen.queryByText(LINE)).toBeNull()

    testAs('192.168.1.42')
    expect(await screen.findByText('dani cannot become root without a password.')).toBeTruthy()
    expect(screen.getByText('Logged in as dani')).toBeTruthy()
    expect(screen.getByText(LINE)).toBeTruthy()

    testAs('192.168.1.43')
    expect(await screen.findByText('This computer has no SSH key yet.')).toBeTruthy()
    expect(screen.getByText('ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519')).toBeTruthy()

    testAs('192.168.1.44')
    expect(await screen.findByText('It shows another key than the one this computer remembers for 192.168.1.44. Nothing was sent to it.')).toBeTruthy()
    expect(screen.getByText('ssh-keygen -R 192.168.1.44')).toBeTruthy()

    testAs('192.168.1.45')
    expect(await screen.findByText('OpenAgent installs on Ubuntu and Debian. This server runs Fedora Linux 41.')).toBeTruthy()
    expect(button('Continue').disabled).toBe(true)

    // The line pasted, Test connection again: it goes through.
    fixed = true
    testAs('192.168.1.40')
    expect(await screen.findByText('Debian GNU/Linux 12 (bookworm), x86_64: OpenAgent installs there')).toBeTruthy()
    expect(button('Continue').disabled).toBe(false)
    expect(ran().filter(line => line.startsWith('test '))).toEqual(['test 192.168.1.40 dani', 'test 192.168.1.41 dani', 'test 192.168.1.42 dani', 'test 192.168.1.43 dani', 'test 192.168.1.44 dani', 'test 192.168.1.45 dani', 'test 192.168.1.40 dani'])
    cleanup()

    // A server on the internet as root: its own console at the provider, and no password rule to add.
    const vps = dashboard(() => ok({ servers: [] }), undefined, undefined, undefined, undefined, undefined, () => failed('no-ssh', { key: 'ssh-ed25519 AAAA mac', fix: LINE }))
    show(vps.host)
    await toConnect()
    testAs('203.0.113.5')
    expect(await screen.findByText('SSH is not on there yet.')).toBeTruthy()
    expect(screen.getByText("Open the server's own console at your provider, and paste this once. It lets this computer in, and nobody else:")).toBeTruthy()
    expect(screen.getByText("It asks for the server's password once: it turns SSH on, adds this computer's key. Then press Test connection again.")).toBeTruthy()
  })

  test('an install that is refused says why in the dialog, which stays at its logins', async () => {
    const { host, ran } = dashboard(args => (args[0] === 'connect' ? { ok: false, error: 'OpenAgent is being installed on 203.0.113.5 right now' } : ok({ servers: [] })))
    show(host)
    await toConnect()
    testAs('203.0.113.5')
    await waitFor(() => expect(button('Continue').disabled).toBe(false))
    fireEvent.click(button('Continue'))
    await waitFor(() => expect(button('Install').disabled).toBe(false))
    fireEvent.click(button('Install'))
    expect(await screen.findByText('OpenAgent is being installed on 203.0.113.5 right now')).toBeTruthy()
    expect(ran()).toContain('connect 203.0.113.5 root 1.2.3')
    expect(now()).toBe('Your logins: now')
  })

  test('the install shows its steps; once it is saved among the machines it uses this computer\'s logins, as the box said; then Ready, and Invite people opens the server inviting', async () => {
    let row: ServerRow | undefined
    const { host, ran, useLoginsOn } = dashboard(
      args => {
        if (args[0] === 'connect') row = server(['done', 'running'], { working: true })
        if (args[0] === 'link') return ok(LINK)
        if (args[0] === 'added' && row) row = { ...row, adding: false }
        return ok({ servers: row ? [row] : [] })
      },
      BOX_SAVED(),
    )
    let used: (answer: MachineAdded) => void = () => {}
    useLoginsOn.mockImplementation(() => new Promise<MachineAdded>(resolve => (used = resolve)))
    show(host)
    await toConnect()
    testAs('203.0.113.5')
    await waitFor(() => expect(button('Continue').disabled).toBe(false))
    fireEvent.click(button('Continue'))
    fireEvent.click(button('Install'))
    const steps = await screen.findByRole('list', { name: 'The install on 203.0.113.5' })
    await waitFor(() => expect(within(steps).getByRole('listitem', { name: 'A user of its own, openagent: running' })).toBeTruthy())
    expect(within(steps).getByRole('listitem', { name: 'Uses your logins: not started' })).toBeTruthy()
    expect(screen.getByText('A few minutes. You can close this: it goes on, and its row shows how far it is.')).toBeTruthy()
    // Nothing is said of the logins before the server is saved among the machines.
    expect(useLoginsOn).not.toHaveBeenCalled()
    row = server(ALL_DONE)
    await waitFor(() => expect(ran()).toContain('added 203.0.113.5'))
    // A machine is saved by its address.
    await waitFor(() => expect(useLoginsOn).toHaveBeenCalledWith('https://203.0.113.5'))
    expect(await within(steps).findByRole('listitem', { name: 'Uses your logins: running' })).toBeTruthy()
    expect(within(steps).getByRole('listitem', { name: 'Runs can be sent to it: done' })).toBeTruthy()
    used({ ok: true })
    expect(await screen.findByText('203.0.113.5 is ready.')).toBeTruthy()
    expect(now()).toBe('Ready: now')
    // Once, however often the page looks.
    expect(useLoginsOn).toHaveBeenCalledTimes(1)
    fireEvent.click(button('Invite people'))
    expect(await screen.findByText('Invite to 203.0.113.5')).toBeTruthy()
    // Under it, the server's own page, on its people.
    expect(screen.getByRole('tab', { name: 'People', selected: true, hidden: true })).toBeTruthy()
  })

  test('logins that could not be used are said on their own line: the server is installed all the same, and Continue goes on to Ready', async () => {
    let row: ServerRow | undefined
    const { host, useLoginsOn } = dashboard(
      args => {
        if (args[0] === 'connect') row = server(ALL_DONE)
        if (args[0] === 'link') return ok(LINK)
        if (args[0] === 'added' && row) row = { ...row, adding: false }
        return ok({ servers: row ? [row] : [] })
      },
      BOX_SAVED(),
    )
    useLoginsOn.mockResolvedValue({ ok: false, error: 'That server is no longer saved.' })
    show(host)
    await toConnect()
    testAs('203.0.113.5')
    await waitFor(() => expect(button('Continue').disabled).toBe(false))
    fireEvent.click(button('Continue'))
    fireEvent.click(button('Install'))
    const steps = await screen.findByRole('list', { name: 'The install on 203.0.113.5' })
    const line = await within(steps).findByRole('listitem', { name: 'Uses your logins: failed' })
    expect(line.textContent).toContain('That server is no longer saved.')
    expect(within(steps).getByRole('listitem', { name: 'Runs can be sent to it: done' })).toBeTruthy()
    expect(screen.queryByText('203.0.113.5 is ready.')).toBeNull()
    fireEvent.click(button('Continue'))
    expect(await screen.findByText('203.0.113.5 is ready.')).toBeTruthy()
  })

  test('a PC at home: through a cloud server this computer is in at; Install sends it through that one, and Ready asks who else uses it', async () => {
    let row: ServerRow | undefined
    // Installed, and then saved through its server, by its line there.
    const done = (adding: boolean): ServerRow => ({ ...server(ALL_DONE, { address: '192.168.1.20', url: adding ? 'https://192.168.1.20' : VIA, user: 'rom', adding }), through: VPS, who: 'me' })
    const { host, ran, useLoginsOn } = dashboard(
      args => {
        if (args[0] === 'connect') row = done(true)
        if (args[0] === 'add-through') row = done(false)
        return ok({ servers: row ? [row] : [] })
      },
      { version: '1.2.3', machines: [...WITH_VPS.machines, { id: VIA, label: 'rom-box', url: VIA, version: '1.2.3' }] },
    )
    show(host)
    await toConnect(true)
    // Back to Where: it is still a PC at home, reached through the one cloud server.
    fireEvent.click(button('Back'))
    expect((await screen.findByRole('radio', { name: /A PC at home/ })).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('combobox', { name: 'The server it is reached through' }).textContent).toContain('165.245.244.10')
    fireEvent.click(button('Continue'))
    await screen.findByLabelText("The server's address")
    testAs('192.168.1.20', 'rom')
    await waitFor(() => expect(button('Continue').disabled).toBe(false))
    fireEvent.click(button('Continue'))
    // Unchecked: the server has no logins of this computer's.
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Use my logins from this computer' }))
    expect(screen.getByRole('checkbox', { name: 'Use my logins from this computer' }).getAttribute('aria-checked')).toBe('false')
    fireEvent.click(button('Install'))
    await waitFor(() => expect(ran()).toContain(`connect 192.168.1.20 rom 1.2.3 --through ${VPS}`))
    expect(await screen.findByText('rom-box is ready.')).toBeTruthy()
    expect(screen.getByText('Your runs can go there from here. Who else uses it?')).toBeTruthy()
    expect(screen.getByRole('radiogroup', { name: 'Who can start runs on 192.168.1.20' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Invite people' })).toBeNull()
    expect(ran()).toContain('add-through 192.168.1.20')
    expect(useLoginsOn).not.toHaveBeenCalled()
  })
})
