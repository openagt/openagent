import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ModuleHostContext, type MachineAdded, type MachineRemoved, type ModuleCommandResult, type ModuleHost, type ModuleMachines } from '@openagt/dashboard/module'
import { MachinesSettings, olderThan } from './MachinesSettings.js'
import type { DeviceRow, LoginRow, ServerRow, StepState } from './servers.js'

const LABELS = { login: 'Log in', user: 'The user openagent', tools: 'git, gh, Node and Chrome', name: 'Your name and email for git', openagent: 'OpenAgent', agent: 'Claude Code', service: 'The service', door: 'The door' }
const LINK = { url: 'https://203.0.113.5/_remote-access/enter#code.pin', expires: new Date(Date.now() + 5 * 60_000).toISOString() }
const NONE: LoginRow = { there: false, working: false }

/** A server whose steps are in these states, in the install's order; the rest have not started. It has no login unless said. */
function server(states: StepState[], over: Partial<ServerRow> = {}): ServerRow {
  const steps = Object.entries(LABELS).map(([id, label], index) => ({ id, label, state: states[index] ?? ('waiting' as const) }))
  return { address: '203.0.113.5', url: 'https://203.0.113.5', user: 'root', working: false, adding: true, steps, logins: { github: NONE, claude: NONE }, ...over }
}
const ALL_DONE: StepState[] = ['done', 'done', 'done', 'done', 'done', 'done', 'done', 'done']
const NO_GH: ModuleCommandResult = { ok: true, output: { problem: 'There is no GitHub login to copy from this computer. `gh` is not on this computer.' } }
const OCTOCAT: ModuleCommandResult = { ok: true, output: { account: 'octocat' } }

/**
 * A host whose `servers` command answers what `answer` says for its arguments, with these machines saved.
 * This computer's own `gh` answers `own` when asked whose login it holds: nobody's, unless said.
 * A server's door answers `devices` when asked who is in, and when one is taken out: nobody, unless said.
 */
function dashboard(
  answer: (args: string[]) => ModuleCommandResult,
  saved: ModuleMachines = { version: '1.2.3', machines: [] },
  added: MachineAdded = { ok: true },
  own: ModuleCommandResult = NO_GH,
  devices: (args: string[]) => ModuleCommandResult = () => ({ ok: true, output: { devices: [] } }),
) {
  const runComputerCommand = vi.fn(async (args: string[]) => (args[0] === 'github' ? own : args[0] === 'devices' || args[0] === 'remove-device' ? devices(args) : answer(args)))
  const inProject = vi.fn(async () => ({ ok: false as const, error: 'the servers are no project\'s' }))
  const machines = vi.fn(async () => saved)
  const addMachine = vi.fn(async (_link: string, _label?: string) => added)
  const removeMachine = vi.fn(async (_id: string): Promise<MachineRemoved> => ({ ok: true }))
  const host: ModuleHost = {
    package: '@openagt/servers',
    runCommand: inProject,
    act: inProject,
    runComputerCommand,
    read: vi.fn(async () => ({ ok: false as const, error: 'no server part' })),
    openAgent: vi.fn(),
    openPage: vi.fn(),
    startRun: vi.fn(async () => ({ ok: false as const, error: 'not here' })),
    configureRun: vi.fn(),
    agents: vi.fn(async () => []),
    machines,
    addMachine,
    removeMachine,
    watchScreen: vi.fn(async () => undefined),
    sendToScreen: vi.fn(async () => false),
  }
  // What was asked of the `servers` command, without the reads a row makes again and again by itself.
  const ran = (): string[] => runComputerCommand.mock.calls.map(([args]) => args.join(' ')).filter(line => !line.startsWith('devices '))
  return { host, runComputerCommand, machines, addMachine, removeMachine, ran }
}

function show(host: ModuleHost) {
  return render(
    <ModuleHostContext.Provider value={host}>
      <MachinesSettings everyMs={40} devicesEveryMs={60} />
    </ModuleHostContext.Provider>,
  )
}

const ok = (output: unknown): ModuleCommandResult => ({ ok: true, output })
const stepNames = (): string[] => within(screen.getByRole('list', { name: 'The install on 203.0.113.5' })).getAllByRole('listitem').map(item => item.getAttribute('aria-label')!)

afterEach(cleanup)

describe('Settings → Machines', () => {
  test('an address and a user name, root unless said: Connect installs this computer\'s own OpenAgent there, in no project', async () => {
    const { host, ran } = dashboard(() => ok({ servers: [] }))
    show(host)
    // The section is there once this computer said it is no server itself.
    const connect = (await screen.findByRole('button', { name: 'Connect' })) as HTMLButtonElement
    expect(connect.disabled).toBe(true)
    expect((screen.getByLabelText('User name') as HTMLInputElement).value).toBe('root')
    await waitFor(() => expect(host.machines).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText("The server's address"), { target: { value: ' 203.0.113.5 ' } })
    await waitFor(() => expect(connect.disabled).toBe(false))
    fireEvent.click(connect)
    await waitFor(() => expect(ran()).toContain('connect 203.0.113.5 root 1.2.3'))
    expect(host.runCommand).not.toHaveBeenCalled()
    // The server is in the list from here on: the field is free for the next one.
    await waitFor(() => expect((screen.getByLabelText("The server's address") as HTMLInputElement).value).toBe(''))
  })

  test('Connect waits until this computer has said which OpenAgent it runs: that is the one the server gets', async () => {
    const { host, machines, ran } = dashboard(() => ok({ servers: [] }))
    let say: (saved: ModuleMachines) => void = () => {}
    machines.mockImplementation(() => new Promise<ModuleMachines>(resolve => (say = resolve)))
    show(host)
    fireEvent.change(await screen.findByLabelText("The server's address"), { target: { value: '203.0.113.5' } })
    await waitFor(() => expect(ran()).toContain('status'))
    const connect = screen.getByRole('button', { name: 'Connect' }) as HTMLButtonElement
    expect(connect.disabled).toBe(true)
    say({ version: '1.2.3', machines: [] })
    await waitFor(() => expect(connect.disabled).toBe(false))
  })

  test('an install at work lists its steps with their state, and shows the key the server was first met with', async () => {
    const { host } = dashboard(() => ok({ servers: [server(['done', 'done', 'running'], { working: true, fingerprint: 'SHA256:abc' })] }))
    show(host)
    expect(await screen.findByText('OpenAgent is being installed.')).toBeTruthy()
    expect(stepNames()).toEqual(['Log in: done', 'The user openagent: done', 'git, gh, Node and Chrome: running', 'Your name and email for git: not started', 'OpenAgent: not started', 'Claude Code: not started', 'The service: not started', 'The door: not started'])
    expect(screen.getByText("The server's key: SHA256:abc")).toBeTruthy()
    // Nothing to press on a server that is being installed.
    for (const name of ['Try 203.0.113.5 again', 'Update 203.0.113.5', 'Remove 203.0.113.5']) expect(screen.queryByRole('button', { name })).toBeNull()
  })

  test('a step that failed shows what the server said, and Try again starts the install over as the same user', async () => {
    const failed = server(['done', 'done', 'failed'], { user: 'ubuntu' })
    failed.steps[2]!.said = 'E: Unable to locate package git'
    const { host, ran, addMachine } = dashboard(() => ok({ servers: [failed] }))
    show(host)
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
    const { host, ran, addMachine } = dashboard(args => {
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

  test('an installed server gives a code for a phone or a browser, asked of its door; the code leaves with Done and with its time, and a door that does not answer is told', async () => {
    const saved: ModuleMachines = { version: '1.2.3', machines: [{ id: 'https://203.0.113.5', label: '203.0.113.5', url: 'https://203.0.113.5', version: '1.2.3' }] }
    let link: ModuleCommandResult = ok(LINK)
    const { host, ran } = dashboard(args => (args[0] === 'link' ? link : ok({ servers: [server(ALL_DONE, { adding: false })] })), saved)
    show(host)
    const code = () => screen.queryByRole('img', { name: 'The code a new device scans to get into 203.0.113.5' })
    fireEvent.click(await screen.findByRole('button', { name: 'Add a device to 203.0.113.5' }))
    await waitFor(() => expect(code()).toBeTruthy())
    expect(ran().filter(line => line === 'link 203.0.113.5')).toHaveLength(1)
    expect(screen.getByText(/it opens OpenAgent on the server, from anywhere\. The code works once, for five minutes\./)).toBeTruthy()
    // A new tab that knows nothing of this page: the code is the server's to take, not this page's to hand on.
    const opens = screen.getByRole('link', { name: 'Let this browser in instead' }) as HTMLAnchorElement
    expect([opens.href, opens.target, opens.rel]).toEqual([LINK.url, '_blank', 'noreferrer'])
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(code()).toBeNull()

    link = ok({ ...LINK, expires: new Date(Date.now() + 80).toISOString() })
    fireEvent.click(screen.getByRole('button', { name: 'Add a device to 203.0.113.5' }))
    await waitFor(() => expect(code()).toBeTruthy())
    await waitFor(() => expect(code()).toBeNull())

    link = { ok: false, error: 'The server did not answer.' }
    fireEvent.click(screen.getByRole('button', { name: 'Add a device to 203.0.113.5' }))
    expect((await screen.findByRole('alert')).textContent).toBe('The server did not answer.')
    expect(code()).toBeNull()
  })

  test('Log in to GitHub has the server get a login of its own: the row shows the code to type at GitHub, with a way there and a way to start over', async () => {
    const saved: ModuleMachines = { version: '1.2.3', machines: [{ id: 'https://203.0.113.5', label: '203.0.113.5', url: 'https://203.0.113.5', version: '1.2.3' }] }
    let github: LoginRow = NONE
    const { host, ran } = dashboard(args => {
      if (args[0] === 'login') github = { there: false, working: true, asking: true, code: 'ABCD-1234' }
      return ok({ servers: [server(ALL_DONE, { adding: false, logins: { github, claude: NONE } })] })
    }, saved)
    show(host)
    // No GitHub login on this computer: nothing to copy, and the server can still get one of its own.
    expect(((await screen.findByRole('button', { name: 'Copy my GitHub login to 203.0.113.5' })) as HTMLButtonElement).disabled).toBe(true)
    const own = screen.getByRole('button', { name: 'Log in to GitHub for 203.0.113.5' }) as HTMLButtonElement
    expect([own.disabled, own.textContent]).toEqual([false, 'Log in to GitHub'])
    fireEvent.click(own)
    await waitFor(() => expect(ran()).toContain('login 203.0.113.5 github own'))
    expect(await screen.findByText('GitHub: type the code ABCD-1234 at github.com/login/device, and say yes there.')).toBeTruthy()
    const there = screen.getByRole('link', { name: 'Open GitHub' }) as HTMLAnchorElement
    expect([there.href, there.target, there.rel]).toEqual(['https://github.com/login/device', '_blank', 'noreferrer'])
    // While the server waits for the person a second press is the person starting over.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Log in to GitHub for 203.0.113.5' }).textContent).toBe('Start over'))
    expect((screen.getByRole('button', { name: 'Log in to GitHub for 203.0.113.5' }) as HTMLButtonElement).disabled).toBe(false)

    github = { there: true, working: false, account: 'octocat', since: '2026-10-12T10:00:00.000Z' }
    expect(await screen.findByText(/^GitHub: logged in as octocat since /)).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Open GitHub' })).toBeNull()
  })

  test('a server that is not installed yet gives no code', async () => {
    const { host } = dashboard(() => ok({ servers: [server(['done', 'done', 'failed'])] }))
    show(host)
    await screen.findByRole('button', { name: 'Try 203.0.113.5 again' })
    expect(screen.queryByRole('button', { name: 'Add a device to 203.0.113.5' })).toBeNull()
  })

  test('a server that could not be saved says why, and is tried again on a press, not by itself', async () => {
    const { host, ran, addMachine } = dashboard(args => (args[0] === 'link' ? ok(LINK) : ok({ servers: [server(ALL_DONE)] })), { version: '1.2.3', machines: [] }, { ok: false, error: 'this code no longer works' })
    show(host)
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
    expect((await screen.findByRole('alert')).textContent).toBe('the dashboard did not answer')
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(addMachine).toHaveBeenCalledTimes(1)
  })

  test('a server made anew at the same address is among the machines and does not answer: it gets in again, with a new link', async () => {
    const stale: ModuleMachines = { version: '1.2.3', machines: [{ id: 'https://203.0.113.5', label: '203.0.113.5', url: 'https://203.0.113.5' }] }
    let adding = true
    const { host, ran, addMachine } = dashboard(args => {
      if (args[0] === 'link') return ok(LINK)
      if (args[0] === 'added') adding = false
      return ok({ servers: [server(ALL_DONE, { adding })] })
    }, stale)
    show(host)
    await waitFor(() => expect(addMachine).toHaveBeenCalledWith(LINK.url, '203.0.113.5'))
    await waitFor(() => expect(ran()).toContain('added 203.0.113.5'))
    // Afterwards it is a press: the page does not ask a server that is down for a link at every look.
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(addMachine).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Connect 203.0.113.5 again' }).textContent).toBe('Connect again')
  })

  test('a server that is among the machines shows its OpenAgent; one that fell behind this computer says so and has Update', async () => {
    const saved = (version?: string): ModuleMachines => ({ version: '1.2.3', machines: [{ id: 'https://203.0.113.5', label: '203.0.113.5', url: 'https://203.0.113.5', ...(version ? { version } : {}) }] })
    const same = dashboard(() => ok({ servers: [server(ALL_DONE, { adding: false })] }), saved('1.2.3'))
    show(same.host)
    expect(await screen.findByText('OpenAgent 1.2.3.')).toBeTruthy()
    expect(stepNames().at(-1)).toBe('Runs can be sent to it: done')
    expect(screen.queryByRole('button', { name: 'Update 203.0.113.5' })).toBeNull()
    expect(same.addMachine).not.toHaveBeenCalled()
    cleanup()

    const behind = dashboard(() => ok({ servers: [server(ALL_DONE, { adding: false, user: 'ubuntu' })] }), saved('1.2.0'))
    show(behind.host)
    expect(await screen.findByText('OpenAgent 1.2.0: behind this computer, which runs 1.2.3.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Update 203.0.113.5' }))
    await waitFor(() => expect(behind.ran()).toContain('connect 203.0.113.5 ubuntu 1.2.3'))
    cleanup()

    const silent = dashboard(() => ok({ servers: [server(ALL_DONE, { adding: false })] }), saved())
    show(silent.host)
    expect(await screen.findByText('Does not answer right now.')).toBeTruthy()
  })

  test('on a computer that is itself a server the section lists its machines and offers no server to connect: servers are connected from a person\'s own computer', async () => {
    let fails = false
    // A person's own computer, reached by the line it keeps open to this server: saved by the address that stands for it here.
    const saved: ModuleMachines = { version: '1.2.3', machines: [{ id: 'http://127.0.0.1:4210', label: 'MacBook', url: 'http://127.0.0.1:4210', version: '1.2.3' }] }
    const { host, ran, addMachine, removeMachine } = dashboard(() => (fails ? { ok: false, error: 'the command could not be run' } : { ok: true, output: { server: true, servers: [server(ALL_DONE)] } }), saved)
    const { container } = show(host)
    // Nothing before this computer said which it is: a server never offers to connect one for a moment.
    expect(container.textContent).toBe('')
    const row = await screen.findByRole('listitem', { name: 'MacBook' })
    expect(within(row).getByText('Your computer. It keeps a line open to this server. Removed here, it is back when it calls again: to take it out, remove it under Devices.')).toBeTruthy()
    expect(within(row).queryByText('http://127.0.0.1:4210')).toBeNull()
    expect(within(row).getByText('Online')).toBeTruthy()
    expect(screen.getByText('The other computers that run OpenAgent, where a run can be sent from here.')).toBeTruthy()
    // Nothing of a server to connect, and what this computer's own file holds of servers is not listed.
    expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull()
    expect(screen.queryByLabelText("The server's address")).toBeNull()
    expect(screen.queryByRole('listitem', { name: '203.0.113.5' })).toBeNull()
    // A read that fails later does not bring any of it back.
    fails = true
    const before = ran().length
    await waitFor(() => expect(ran().length).toBeGreaterThan(before + 1))
    expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    // Only the question itself was asked: no GitHub login, no server's devices, and a server it holds is not added to anything.
    expect(new Set(ran())).toEqual(new Set(['status']))
    expect(host.runComputerCommand).not.toHaveBeenCalledWith(['github'])
    expect(host.runComputerCommand).not.toHaveBeenCalledWith(['devices', '203.0.113.5'])
    expect(addMachine).not.toHaveBeenCalled()
    // Its own computer can be taken off the list like any machine.
    fireEvent.click(within(row).getByRole('button', { name: 'Remove MacBook' }))
    await waitFor(() => expect(removeMachine).toHaveBeenCalledWith('http://127.0.0.1:4210'))
  })

  test('a person\'s own computer that cannot be read shows the section, with why', async () => {
    const { host } = dashboard(() => ({ ok: false, error: 'the command could not be run' }))
    show(host)
    expect(await screen.findByRole('button', { name: 'Add machine' })).toBeTruthy()
    expect((await screen.findByRole('alert')).textContent).toContain('the command could not be run')
  })

  test('a server installed before this computer\'s OpenAgent got a new step shows it as not started, and has Update to run it, behind or not', async () => {
    const saved: ModuleMachines = { version: '1.2.3', machines: [{ id: 'https://203.0.113.5', label: '203.0.113.5', url: 'https://203.0.113.5', version: '1.2.3' }] }
    const { host, ran } = dashboard(() => ok({ servers: [server(['done', 'done', 'done', 'waiting', 'done', 'done', 'done', 'done'], { adding: false, user: 'ubuntu' })] }), saved)
    show(host)
    expect(await screen.findByText('OpenAgent 1.2.3.')).toBeTruthy()
    expect(stepNames()).toContain('Your name and email for git: not started')
    fireEvent.click(screen.getByRole('button', { name: 'Update 203.0.113.5' }))
    await waitFor(() => expect(ran()).toContain('connect 203.0.113.5 ubuntu 1.2.3'))
  })

  test('a server that is not among the machines is not put back by itself; Remove takes it off this list', async () => {
    const { host, ran, addMachine, removeMachine } = dashboard(() => ok({ servers: [server(ALL_DONE, { adding: false })] }))
    show(host)
    expect(await screen.findByText('Installed. A run cannot be sent to it yet.')).toBeTruthy()
    await new Promise(resolve => setTimeout(resolve, 120))
    expect(addMachine).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Finish connecting 203.0.113.5' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove 203.0.113.5' }))
    await waitFor(() => expect(ran()).toContain('forget 203.0.113.5'))
    expect(removeMachine).not.toHaveBeenCalled()
  })

  test('a server is listed once, with the machines that are no server after it; Remove takes this computer out of the server and the server off the list, and not while a run is at work there', async () => {
    const BOX = { id: 'https://203.0.113.5', label: '203.0.113.5', url: 'https://203.0.113.5', version: '1.2.3' }
    const STUDIO = { id: 'http://192.168.1.5:4200', label: 'Studio', url: 'http://192.168.1.5:4200', version: '1.2.0' }
    const OFF = { id: 'http://box.tail.ts:4200', label: 'Old box', url: 'http://box.tail.ts:4200' }
    const { host, ran, removeMachine } = dashboard(() => ok({ servers: [server(ALL_DONE, { adding: false })] }), { version: '1.2.3', machines: [STUDIO, BOX, OFF] })
    show(host)
    const studio = await screen.findByRole('listitem', { name: 'Studio' })
    expect(within(screen.getByRole('list', { name: 'Machines' })).getAllByRole('listitem').filter(item => ['203.0.113.5', 'Studio', 'Old box'].includes(item.getAttribute('aria-label') ?? '')).map(item => item.getAttribute('aria-label'))).toEqual(['203.0.113.5', 'Studio', 'Old box'])
    // A machine added with a link: where it answers, whether it does, and no word about being behind.
    expect(within(studio).getByText(STUDIO.url)).toBeTruthy()
    expect(within(studio).getByText('Online')).toBeTruthy()
    expect(within(screen.getByRole('listitem', { name: 'Old box' })).getByText('Offline')).toBeTruthy()
    expect(screen.getAllByText('203.0.113.5')).toHaveLength(1)

    removeMachine.mockResolvedValueOnce({ ok: false, error: 'An agent is working on 203.0.113.5. Stop it, or wait until it ends, then remove the machine.' })
    fireEvent.click(screen.getByRole('button', { name: 'Remove 203.0.113.5' }))
    expect(await screen.findByText(/^An agent is working on 203\.0\.113\.5\./)).toBeTruthy()
    expect(ran()).not.toContain('forget 203.0.113.5')

    fireEvent.click(screen.getByRole('button', { name: 'Remove 203.0.113.5' }))
    await waitFor(() => expect(ran()).toContain('forget 203.0.113.5'))
    expect(removeMachine.mock.calls.map(([id]) => id)).toEqual([BOX.id, BOX.id])
    // What was said of the first try is gone with the second.
    expect(screen.queryByText(/^An agent is working/)).toBeNull()

    fireEvent.click(within(studio).getByRole('button', { name: 'Remove Studio' }))
    await waitFor(() => expect(removeMachine).toHaveBeenLastCalledWith(STUDIO.id))
    expect(ran().filter(line => line.startsWith('forget '))).toHaveLength(1)
  })

  test('before this computer said which machines it has, the section does not claim there are none; once it has, it says so, and Add machine asks for the link another machine gives', async () => {
    const { host, machines } = dashboard(() => ok({ servers: [] }))
    let say: (saved: ModuleMachines) => void = () => {}
    machines.mockImplementationOnce(() => new Promise<ModuleMachines>(resolve => (say = resolve)))
    show(host)
    await screen.findByRole('button', { name: 'Connect' })
    expect(screen.queryByText(/No machines saved/)).toBeNull()
    say({ version: '1.2.3', machines: [] })
    expect(await screen.findByText('No machines saved. To add one that already runs OpenAgent, use the link it gives: its Settings, Devices, Add device.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add machine' }))
    expect(await screen.findByText(/On the other machine, open Settings, find Devices, and press Add device\./)).toBeTruthy()
  })

  test('an installed server lists the devices that are in on it, with when each was last there; Remove takes one out there, and this computer\'s own line is not taken out as a device is', async () => {
    // This computer says which of the server's devices its own OpenAgent is: the id it is listed under there.
    const saved: ModuleMachines = { version: '1.2.3', machines: [{ id: 'https://203.0.113.5', label: '203.0.113.5', url: 'https://203.0.113.5', version: '1.2.3', device: 'c1b2c3d4e5f6' }] }
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
    const list = await screen.findByRole('list', { name: 'The devices that are in on 203.0.113.5' })
    const rows = (): string[] => within(list).getAllByRole('listitem').map(item => item.textContent ?? '')
    expect(rows()).toHaveLength(6)
    expect(rows()[0]).toMatch(/^iPhone, SafariAdded 3d ago, last seen 5m ago/)
    // A device that never came back after it got in says only when it was added.
    expect(rows()[1]).toMatch(/^Mac, ChromeAdded 2d ago(?!, last seen)/)
    // This computer's own line is named as such, and has no Remove: it is ended from this row.
    expect(rows()[2]).toContain('This computer, by the line it keeps open to the server. The switch above says what the server may do through it.')
    expect(screen.queryByRole('button', { name: 'Remove MacBook from 203.0.113.5' })).toBeNull()
    expect(rows()[3]).toContain('A computer that keeps a line open to the server')
    expect(screen.getByRole('button', { name: 'Remove Studio from 203.0.113.5' })).toBeTruthy()
    // This computer's own OpenAgent there is named as such too, and has no Remove; its older key, named alike, has one.
    expect(rows()[4]).toContain("This computer's OpenAgent: it sends runs to the server and reads them with this. To take it out, remove the server from this list.")
    expect(rows()[5]).not.toContain("This computer's OpenAgent")
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

  test('this computer is one row among the server\'s devices, its OpenAgent and its line together, with no Remove; another computer\'s row has one', async () => {
    const saved: ModuleMachines = { version: '1.2.3', machines: [{ id: 'https://203.0.113.5', label: '203.0.113.5', url: 'https://203.0.113.5', version: '1.2.3', device: 'c1b2c3d4e5f6' }] }
    const now = new Date().toISOString()
    // As the server lists a computer: one row, under one id, with what else it holds there.
    const MINE: DeviceRow = { id: 'c1b2c3d4e5f6', name: 'MacBook', added: now, seen: now, line: true, also: ['0f9e8d7c6b5a'], own: true }
    // Listed under its line's id, with its OpenAgent's beside: this computer's all the same.
    const OTHER: DeviceRow = { id: '112233445566', name: 'Studio', added: now, line: true, also: ['aabbccddeeff'] }
    const { host } = dashboard(() => ok({ servers: [server(ALL_DONE, { adding: false, reach: 'full' })] }), saved, { ok: true }, NO_GH, () => ok({ devices: [MINE, OTHER] }))
    show(host)
    const list = await screen.findByRole('list', { name: 'The devices that are in on 203.0.113.5' })
    const rows = within(list).getAllByRole('listitem').map(item => item.textContent ?? '')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toContain('This computer: its OpenAgent, and the line it keeps open to the server. The switch above says what the server may do through the line. To take this computer out, remove the server from this list.')
    expect(screen.queryByRole('button', { name: 'Remove MacBook from 203.0.113.5' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Remove Studio from 203.0.113.5' })).toBeTruthy()
    cleanup()

    const under: ModuleMachines = { version: '1.2.3', machines: [{ ...saved.machines[0]!, device: '0f9e8d7c6b5a' }] }
    const second = dashboard(() => ok({ servers: [server(ALL_DONE, { adding: false, reach: 'full' })] }), under, { ok: true }, NO_GH, () => ok({ devices: [{ ...MINE, own: undefined }, OTHER] }))
    show(second.host)
    await screen.findByText(/This computer's OpenAgent: it sends runs to the server and reads them with this\./)
    expect(screen.queryByRole('button', { name: 'Remove MacBook from 203.0.113.5' })).toBeNull()
  })

  test('a server that no longer lets this computer in for its line: the switch reads off and says why, and turning it on asks for the line anew', async () => {
    const saved: ModuleMachines = { version: '1.2.3', machines: [{ id: 'https://203.0.113.5', label: '203.0.113.5', url: 'https://203.0.113.5', version: '1.2.3' }] }
    let lineRefused = true
    const { host, ran } = dashboard(() => ok({ servers: [server(ALL_DONE, { adding: false, reach: 'full' })] }), saved, { ok: true }, NO_GH, () => ok({ devices: [], lineRefused }))
    show(host)
    await screen.findByText('Off: 203.0.113.5 no longer lets this computer in for its line. Turn it on to set the line up again: "Run on" on 203.0.113.5\'s page then offers this computer.')
    const theSwitch = screen.getByRole('switch', { name: 'Start runs on this computer from 203.0.113.5' })
    expect(theSwitch.getAttribute('aria-checked')).toBe('false')
    // The server's own file still says "full": what the door says of the line is what counts.
    fireEvent.click(theSwitch)
    await waitFor(() => expect(ran()).toContain('reach 203.0.113.5 full'))
    // At once, before the next look at the server's devices says so too.
    await screen.findByText(/On: on 203\.0\.113\.5's page, "Run on" offers this computer/)
    expect(screen.getByRole('switch', { name: 'Start runs on this computer from 203.0.113.5' }).getAttribute('aria-checked')).toBe('true')
    // What the door says at each look is what the switch reads: a door that still says refused after the press is believed, and the switch is off again.
    await screen.findByText(/^Off: 203\.0\.113\.5 no longer lets this computer in for its line\./)
    expect(screen.getByRole('switch', { name: 'Start runs on this computer from 203.0.113.5' }).getAttribute('aria-checked')).toBe('false')
    // And once the door says the line is let in, it is on with nothing pressed.
    lineRefused = false
    await screen.findByText(/On: on 203\.0\.113\.5's page, "Run on" offers this computer/)
    expect(screen.getByRole('switch', { name: 'Start runs on this computer from 203.0.113.5' }).getAttribute('aria-checked')).toBe('true')
  })

  test('a server with no device says so; one whose devices cannot be read says why, and goes on showing the last it read; one never read says only that; a server that is not installed is not asked', async () => {
    const saved: ModuleMachines = { version: '1.2.3', machines: [{ id: 'https://203.0.113.5', label: '203.0.113.5', url: 'https://203.0.113.5', version: '1.2.3' }] }
    let answer: ModuleCommandResult = ok({ devices: [] })
    const { host } = dashboard(() => ok({ servers: [server(ALL_DONE, { adding: false })] }), saved, { ok: true }, NO_GH, () => answer)
    show(host)
    expect(await screen.findByText('No device is in on the server. Add device gives a code for a phone or a browser.')).toBeTruthy()
    answer = ok({ devices: [{ id: 'a1b2c3d4e5f6', name: 'iPhone, Safari', added: new Date().toISOString() }] })
    expect(await screen.findByText('iPhone, Safari')).toBeTruthy()
    answer = { ok: false, error: 'ssh: connect to host 203.0.113.5 port 22: Connection refused' }
    expect((await screen.findByRole('alert')).textContent).toBe('ssh: connect to host 203.0.113.5 port 22: Connection refused')
    // The list it read before stays, with its Remove: one read that fails takes nothing off the page.
    expect(screen.getByText('iPhone, Safari')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove iPhone, Safari from 203.0.113.5' })).toBeTruthy()
    expect(screen.queryByText('The devices that are in on the server could not be read.')).toBeNull()
    cleanup()

    const never = dashboard(() => ok({ servers: [server(ALL_DONE, { adding: false })] }), saved, { ok: true }, NO_GH, () => answer)
    show(never.host)
    expect(await screen.findByText('The devices that are in on the server could not be read.')).toBeTruthy()
    expect((await screen.findByRole('alert')).textContent).toBe('ssh: connect to host 203.0.113.5 port 22: Connection refused')
    cleanup()

    const installing = dashboard(() => ok({ servers: [server(['done', 'running'], { working: true })] }))
    show(installing.host)
    await screen.findByRole('list', { name: 'The install on 203.0.113.5' })
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(installing.runComputerCommand).not.toHaveBeenCalledWith(['devices', '203.0.113.5'])
  })

  test('a server is asked for its devices one read at a time: a read that takes long is not joined by the next', async () => {
    const saved: ModuleMachines = { version: '1.2.3', machines: [{ id: 'https://203.0.113.5', label: '203.0.113.5', url: 'https://203.0.113.5', version: '1.2.3' }] }
    const { host, runComputerCommand } = dashboard(() => ok({ servers: [server(ALL_DONE, { adding: false })] }), saved)
    let answer: (result: ModuleCommandResult) => void = () => {}
    const slow = new Promise<ModuleCommandResult>(resolve => (answer = resolve))
    const asked = (): number => runComputerCommand.mock.calls.filter(([args]) => args[0] === 'devices').length
    const usual = runComputerCommand.getMockImplementation()!
    runComputerCommand.mockImplementation(async (args: string[]) => (args[0] === 'devices' && asked() === 1 ? slow : usual(args)))
    show(host)
    await waitFor(() => expect(asked()).toBe(1))
    // Many looks later the server was still asked once: its answer has not come.
    await new Promise(resolve => setTimeout(resolve, 400))
    expect(asked()).toBe(1)
    answer(ok({ devices: [{ id: 'a1b2c3d4e5f6', name: 'iPhone, Safari', added: new Date().toISOString() }] }))
    expect(await screen.findByText('iPhone, Safari')).toBeTruthy()
    await waitFor(() => expect(asked()).toBeGreaterThan(1))
  })

  test('a device that was taken out stays off the page when the read made after it fails; a tab nobody looks at asks the server nothing', async () => {
    const saved: ModuleMachines = { version: '1.2.3', machines: [{ id: 'https://203.0.113.5', label: '203.0.113.5', url: 'https://203.0.113.5', version: '1.2.3' }] }
    const PHONE: DeviceRow = { id: 'a1b2c3d4e5f6', name: 'iPhone, Safari', added: new Date().toISOString() }
    const MAC: DeviceRow = { id: 'b1b2c3d4e5f6', name: 'Mac, Chrome', added: new Date().toISOString() }
    let fails = false
    const { host, runComputerCommand } = dashboard(() => ok({ servers: [server(ALL_DONE, { adding: false })] }), saved, { ok: true }, NO_GH, args => {
      if (args[0] === 'remove-device') {
        // The server takes the device out, and from then on does not answer.
        fails = true
        return ok({ devices: [MAC] })
      }
      return fails ? { ok: false, error: 'ssh: connect to host 203.0.113.5 port 22: Connection refused' } : ok({ devices: [PHONE, MAC] })
    })
    const asked = (): number => runComputerCommand.mock.calls.filter(([args]) => args[0] === 'devices').length
    show(host)
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

  test('a server whose login is being changed is not removed: nothing of it is taken out before it can be forgotten', async () => {
    const saved: ModuleMachines = { version: '1.2.3', machines: [{ id: 'https://203.0.113.5', label: '203.0.113.5', url: 'https://203.0.113.5', version: '1.2.3' }] }
    let github: LoginRow = { there: false, working: true, asking: true, code: 'ABCD-1234' }
    const { host, ran, removeMachine } = dashboard(() => ok({ servers: [server(ALL_DONE, { adding: false, logins: { github, claude: NONE } })] }), saved)
    show(host)
    const remove = (await screen.findByRole('button', { name: 'Remove 203.0.113.5' })) as HTMLButtonElement
    expect(remove.disabled).toBe(true)
    expect(remove.title).toBe('One of its logins is being changed right now: wait until that ends.')
    fireEvent.click(remove)
    github = NONE
    await waitFor(() => expect((screen.getByRole('button', { name: 'Remove 203.0.113.5' }) as HTMLButtonElement).disabled).toBe(false))
    expect(removeMachine).not.toHaveBeenCalled()
    expect(ran()).not.toContain('forget 203.0.113.5')
  })

  test('a look that could not read the servers says so, and takes no row off the page', async () => {
    const saved: ModuleMachines = { version: '1.2.3', machines: [{ id: 'https://203.0.113.5', label: '203.0.113.5', url: 'https://203.0.113.5', version: '1.2.3' }] }
    let fails = false
    const { host } = dashboard(() => (fails ? { ok: false, error: 'servers printed no JSON' } : ok({ servers: [server(ALL_DONE, { adding: false })] })), saved)
    show(host)
    await screen.findByText('OpenAgent 1.2.3.')
    fails = true
    expect(await screen.findByText('The servers could not be read: servers printed no JSON')).toBeTruthy()
    // Still the server's own row, with all that is on it, and not a machine with a Remove of another kind.
    expect(screen.getByText('OpenAgent 1.2.3.')).toBeTruthy()
    expect(screen.getByRole('list', { name: 'The install on 203.0.113.5' })).toBeTruthy()
    expect(screen.getAllByText('203.0.113.5')).toHaveLength(1)
  })

  test('a code leaves the page once a device got in with it', async () => {
    const saved: ModuleMachines = { version: '1.2.3', machines: [{ id: 'https://203.0.113.5', label: '203.0.113.5', url: 'https://203.0.113.5', version: '1.2.3' }] }
    const LAPTOP: DeviceRow = { id: '0f9e8d7c6b5a', name: 'OpenAgent on MacBook', added: new Date().toISOString() }
    let listed = [LAPTOP]
    const { host } = dashboard(args => (args[0] === 'link' ? ok(LINK) : ok({ servers: [server(ALL_DONE, { adding: false })] })), saved, { ok: true }, NO_GH, () => ok({ devices: listed }))
    show(host)
    await screen.findByText('OpenAgent on MacBook')
    const code = () => screen.queryByRole('img', { name: 'The code a new device scans to get into 203.0.113.5' })
    fireEvent.click(screen.getByRole('button', { name: 'Add a device to 203.0.113.5' }))
    await waitFor(() => expect(code()).toBeTruthy())
    // The devices that were in when the code came on the page are no reason for it to leave.
    await new Promise(resolve => setTimeout(resolve, 200))
    expect(code()).toBeTruthy()
    listed = [LAPTOP, { id: 'a1b2c3d4e5f6', name: 'iPhone, Safari', added: new Date().toISOString() }]
    await waitFor(() => expect(code()).toBeNull())
    expect(screen.getByText('iPhone, Safari')).toBeTruthy()

    // A computer that gets in again is a new id under the row it had, and no new row: the code is spent all the same.
    fireEvent.click(screen.getByRole('button', { name: 'Add a device to 203.0.113.5' }))
    await waitFor(() => expect(code()).toBeTruthy())
    await new Promise(resolve => setTimeout(resolve, 200))
    expect(code()).toBeTruthy()
    listed = [{ ...LAPTOP, also: ['c1b2c3d4e5f6'] }, listed[1]!]
    await waitFor(() => expect(code()).toBeNull())
  })

  test('a command that refuses says why; servers that cannot be read say so', async () => {
    const refusing = dashboard(args => (args[0] === 'connect' ? { ok: false, error: 'nope is not a server\'s number or name' } : ok({ servers: [] })))
    show(refusing.host)
    fireEvent.change(await screen.findByLabelText("The server's address"), { target: { value: 'nope' } })
    await waitFor(() => expect((screen.getByRole('button', { name: 'Connect' }) as HTMLButtonElement).disabled).toBe(false))
    await waitFor(() => expect(refusing.machines).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(await screen.findByText("nope is not a server's number or name")).toBeTruthy()
    // What was refused stays in the field, to be corrected.
    expect((screen.getByLabelText("The server's address") as HTMLInputElement).value).toBe('nope')
    cleanup()

    const unread = dashboard(() => ({ ok: false, error: 'servers printed no JSON' }))
    show(unread.host)
    expect(await screen.findByText('The servers could not be read: servers printed no JSON')).toBeTruthy()
  })

  test('the tick names whose GitHub login would be copied, and Connect then asks for the copy; with no login on this computer there is nothing to tick', async () => {
    const { host, ran } = dashboard(() => ok({ servers: [] }), undefined, undefined, OCTOCAT)
    show(host)
    expect(await screen.findByText('Copy my GitHub login (octocat) to the server.')).toBeTruthy()
    const tick = screen.getByRole('checkbox', { name: 'Copy my GitHub login to the server' })
    // Set by the person, never for them.
    expect(tick.getAttribute('aria-checked')).toBe('false')
    fireEvent.change(screen.getByLabelText("The server's address"), { target: { value: '203.0.113.5' } })
    await waitFor(() => expect((screen.getByRole('button', { name: 'Connect' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(tick)
    await waitFor(() => expect(tick.getAttribute('aria-checked')).toBe('true'))
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(ran()).toContain('connect 203.0.113.5 root 1.2.3 github'))
    cleanup()

    const none = dashboard(() => ok({ servers: [] }))
    show(none.host)
    expect(await screen.findByText('There is no GitHub login to copy from this computer. `gh` is not on this computer.')).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: 'Copy my GitHub login to the server' }).hasAttribute('data-disabled')).toBe(true)
    fireEvent.change(screen.getByLabelText("The server's address"), { target: { value: '203.0.113.5' } })
    await waitFor(() => expect((screen.getByRole('button', { name: 'Connect' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(none.ran()).toContain('connect 203.0.113.5 root 1.2.3'))
  })

  test('a server that is being installed has no logins to press yet; a GitHub login that was ticked waits in the list', async () => {
    const { host } = dashboard(() => ok({ servers: [server(['done', 'running'], { working: true, logins: { github: { there: false, working: true }, claude: NONE } })] }))
    show(host)
    expect(await screen.findByText('OpenAgent is being installed.')).toBeTruthy()
    expect(stepNames().at(-1)).toBe('Your GitHub login: not copied yet')
    expect(screen.queryByRole('list', { name: 'The logins on 203.0.113.5' })).toBeNull()
  })

  test('an installed server lists its two logins: the GitHub one is copied on a press and removed on a press', async () => {
    let github: LoginRow = NONE
    const { host, ran } = dashboard(
      args => {
        if (args[0] === 'login') github = { there: true, working: false, account: 'octocat', since: '2026-10-11T12:00:00.000Z' }
        if (args[0] === 'logout') github = NONE
        return ok({ servers: [server(ALL_DONE, { adding: false, logins: { github, claude: NONE } })] })
      },
      undefined,
      undefined,
      OCTOCAT,
    )
    show(host)
    const logins = within(await screen.findByRole('list', { name: 'The logins on 203.0.113.5' }))
    expect(logins.getByText('GitHub: no login on the server.')).toBeTruthy()
    expect(logins.getByText('Claude: not logged in on the server.')).toBeTruthy()
    expect(logins.queryByRole('button', { name: 'Remove the GitHub login from 203.0.113.5' })).toBeNull()
    const copy = logins.getByRole('button', { name: 'Copy my GitHub login to 203.0.113.5' }) as HTMLButtonElement
    await waitFor(() => expect(copy.disabled).toBe(false))
    fireEvent.click(copy)
    await waitFor(() => expect(ran()).toContain('login 203.0.113.5 github'))
    expect(await logins.findByText(/^GitHub: logged in as octocat since .*2026\.$/)).toBeTruthy()
    expect(copy.textContent).toBe('Copy again')
    fireEvent.click(logins.getByRole('button', { name: 'Remove the GitHub login from 203.0.113.5' }))
    await waitFor(() => expect(ran()).toContain('logout 203.0.113.5 github'))
    expect(await logins.findByText('GitHub: no login on the server.')).toBeTruthy()
  })

  test('with no GitHub login on this computer there is none to copy; a copy that failed at the install\'s end says why', async () => {
    const failed: LoginRow = { there: false, working: false, said: 'error validating token: HTTP 401: Bad credentials' }
    const { host } = dashboard(() => ok({ servers: [server(ALL_DONE, { adding: false, logins: { github: failed, claude: NONE } })] }))
    show(host)
    const logins = within(await screen.findByRole('list', { name: 'The logins on 203.0.113.5' }))
    expect(logins.getByRole('alert').textContent).toBe('error validating token: HTTP 401: Bad credentials')
    expect(logins.getByText('GitHub: the last try did not go through.')).toBeTruthy()
    expect((logins.getByRole('button', { name: 'Copy my GitHub login to 203.0.113.5' }) as HTMLButtonElement).disabled).toBe(true)
    // What a failed try left on the server is not always known here: it can be taken off all the same.
    expect(logins.getByRole('button', { name: 'Remove the GitHub login from 203.0.113.5' })).toBeTruthy()
    expect(logins.queryByRole('button', { name: 'Remove the Claude login from 203.0.113.5' })).toBeNull()
  })

  test('while the server is being told there is nothing to press, and an older failure is not shown', async () => {
    const told: LoginRow = { there: true, working: true, account: 'octocat', since: '2026-10-11T12:00:00.000Z', said: 'an older failure' }
    const { host } = dashboard(() => ok({ servers: [server(ALL_DONE, { adding: false, logins: { github: told, claude: { there: false, working: true } } })] }), undefined, undefined, OCTOCAT)
    show(host)
    const logins = within(await screen.findByRole('list', { name: 'The logins on 203.0.113.5' }))
    expect(logins.getByText('GitHub: one moment, the server is being told.')).toBeTruthy()
    expect(logins.getByText('Claude: one moment, the server is being told.')).toBeTruthy()
    expect(logins.queryByRole('alert')).toBeNull()
    await waitFor(() => expect(host.runComputerCommand).toHaveBeenCalledWith(['github']))
    expect((logins.getByRole('button', { name: 'Copy my GitHub login to 203.0.113.5' }) as HTMLButtonElement).disabled).toBe(true)
    // Only a login that still waits for the person is started over; one on its way to the server arrives.
    expect((logins.getByRole('button', { name: 'Log in to Claude for 203.0.113.5' }) as HTMLButtonElement).disabled).toBe(true)
    for (const name of ['Remove the GitHub login from 203.0.113.5', 'Remove the Claude login from 203.0.113.5']) expect(logins.queryByRole('button', { name })).toBeNull()
  })

  test('a press makes a Claude login for the server: the page says where to say yes, then until when it is good; it is removed on a press', async () => {
    let claude: LoginRow = NONE
    const { host, ran } = dashboard(args => {
      if (args[0] === 'login') claude = { there: false, working: true, asking: true }
      if (args[0] === 'logout') claude = NONE
      return ok({ servers: [server(ALL_DONE, { adding: false, logins: { github: NONE, claude } })] })
    })
    show(host)
    const logins = within(await screen.findByRole('list', { name: 'The logins on 203.0.113.5' }))
    const press = logins.getByRole('button', { name: 'Log in to Claude for 203.0.113.5' })
    expect(press.textContent).toBe('Log in to Claude')
    fireEvent.click(press)
    await waitFor(() => expect(ran()).toContain('login 203.0.113.5 claude'))
    expect(await logins.findByText("Claude: say yes in the page this computer's browser opened.")).toBeTruthy()
    // A page that was closed is no dead end.
    expect(press.textContent).toBe('Start over')
    expect(logins.queryByRole('button', { name: 'Remove the Claude login from 203.0.113.5' })).toBeNull()

    claude = { there: true, working: false, since: '2026-10-11T12:00:00.000Z', ends: '2027-10-11T12:00:00.000Z' }
    expect(await logins.findByText(/^Claude: logged in since .*2026, good until about .*2027\.$/)).toBeTruthy()
    expect(press.textContent).toBe('Log in again')
    fireEvent.click(logins.getByRole('button', { name: 'Remove the Claude login from 203.0.113.5' }))
    await waitFor(() => expect(ran()).toContain('logout 203.0.113.5 claude'))
    expect(await logins.findByText('Claude: not logged in on the server.')).toBeTruthy()
  })

  test('a Claude login that was not made says why, and a login that could not be removed says why', async () => {
    const failed: LoginRow = { there: false, working: false, said: 'No yes came from the browser in 10 minutes.' }
    const { host } = dashboard(args => (args[0] === 'logout' ? { ok: false, error: 'The server did not answer.' } : ok({ servers: [server(ALL_DONE, { adding: false, logins: { github: { there: true, working: false, account: 'octocat', since: '2026-10-11T12:00:00.000Z' }, claude: failed } })] })))
    show(host)
    const logins = within(await screen.findByRole('list', { name: 'The logins on 203.0.113.5' }))
    expect(logins.getByRole('alert').textContent).toBe('No yes came from the browser in 10 minutes.')
    fireEvent.click(logins.getByRole('button', { name: 'Remove the GitHub login from 203.0.113.5' }))
    expect(await screen.findByText('The server did not answer.')).toBeTruthy()
  })

  test('a server among the machines has the switch that lets it start runs on this computer: off until set, on asks for the line, off again leaves it only watching', async () => {
    const saved: ModuleMachines = { version: '1.2.3', machines: [{ id: 'https://203.0.113.5', label: '203.0.113.5', url: 'https://203.0.113.5', version: '1.2.3' }] }
    let row = server(ALL_DONE, { adding: false })
    const { host, ran } = dashboard(args => {
      if (args[0] === 'reach') row = { ...row, reach: args[2] as 'full' | 'watch' }
      return ok({ servers: [row] })
    }, saved)
    show(host)
    const theSwitch = await screen.findByRole('switch', { name: 'Start runs on this computer from 203.0.113.5' })
    expect(theSwitch.getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText(/Off\. Turn it on to pick this computer under "Run on" on 203\.0\.113\.5's page, from your phone\./)).toBeTruthy()
    fireEvent.click(theSwitch)
    await waitFor(() => expect(ran()).toContain('reach 203.0.113.5 full'))
    await screen.findByText(/On: on 203\.0\.113\.5's page, "Run on" offers this computer, and a run started there runs here\. This computer must be on\./)
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Start runs on this computer from 203.0.113.5' }).getAttribute('aria-checked')).toBe('true'))
    fireEvent.click(screen.getByRole('switch', { name: 'Start runs on this computer from 203.0.113.5' }))
    await waitFor(() => expect(ran()).toContain('reach 203.0.113.5 watch'))
    await screen.findByText(/Off: 203\.0\.113\.5's page shows this computer's runs\. It cannot start one here, or say anything to one\./)
  })

  test('a server that is not among the machines, or still being installed, has no such switch; a line that could not be set up says why', async () => {
    const { host } = dashboard(() => ok({ servers: [server(['done', 'running'], { working: true })] }))
    show(host)
    await screen.findByRole('list', { name: 'The install on 203.0.113.5' })
    expect(screen.queryByRole('switch')).toBeNull()
    cleanup()
    const saved: ModuleMachines = { version: '1.2.3', machines: [{ id: 'https://203.0.113.5', label: '203.0.113.5', url: 'https://203.0.113.5', version: '1.2.3' }] }
    const refusing = dashboard(args => (args[0] === 'reach' ? { ok: false, error: 'The server did not give a line: this door gives no line: only a server does' } : ok({ servers: [server(ALL_DONE, { adding: false })] })), saved)
    show(refusing.host)
    fireEvent.click(await screen.findByRole('switch', { name: 'Start runs on this computer from 203.0.113.5' }))
    await screen.findByText('The server did not give a line: this door gives no line: only a server does')
  })

  test('older is by the three numbers of a version', () => {
    expect(olderThan('1.2.0', '1.2.3')).toBe(true)
    expect(olderThan('0.9.9', '0.10.0')).toBe(true)
    expect(olderThan('1.2.3', '1.2.3')).toBe(false)
    expect(olderThan('2.0.0', '1.9.9')).toBe(false)
    expect(olderThan('unknown', '1.2.3')).toBe(false)
  })
})
