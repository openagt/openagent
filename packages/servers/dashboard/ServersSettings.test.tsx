import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ModuleHostContext, type MachineAdded, type ModuleCommandResult, type ModuleHost, type ModuleMachines, type ModuleProject } from '@openagt/dashboard/module'
import { ServersSettings, olderThan } from './ServersSettings.js'
import type { ServerRow, StepState } from './servers.js'

const PROJECT = { id: 'p1', name: 'gemstack', gitHost: true }
const OTHER = { id: 'p2', name: 'other', gitHost: false }
const LABELS = { login: 'Log in', user: 'The user openagent', tools: 'git, Node and Chrome', openagent: 'OpenAgent', agent: 'Claude Code', service: 'The service', door: 'The door' }
const LINK = { url: 'https://203.0.113.5/_remote-access/enter#code.pin', expires: new Date(Date.now() + 5 * 60_000).toISOString() }

/** A server whose steps are in these states, in the install's order; the rest have not started. */
function server(states: StepState[], over: Partial<ServerRow> = {}): ServerRow {
  const steps = Object.entries(LABELS).map(([id, label], index) => ({ id, label, state: states[index] ?? ('waiting' as const) }))
  return { address: '203.0.113.5', url: 'https://203.0.113.5', user: 'root', working: false, adding: true, steps, ...over }
}
const ALL_DONE: StepState[] = ['done', 'done', 'done', 'done', 'done', 'done', 'done']

/** A host whose `servers` command answers what `answer` says for its arguments, with these machines saved. */
function dashboard(answer: (args: string[]) => ModuleCommandResult, saved: ModuleMachines = { version: '1.2.3', machines: [] }, added: MachineAdded = { ok: true }) {
  const runCommand = vi.fn(async (_projectId: string, args: string[]) => answer(args))
  const machines = vi.fn(async () => saved)
  const addMachine = vi.fn(async (_link: string, _label?: string) => added)
  const host: ModuleHost = {
    package: '@openagt/servers',
    runCommand,
    act: runCommand,
    read: vi.fn(async () => ({ ok: false as const, error: 'no server part' })),
    openAgent: vi.fn(),
    openPage: vi.fn(),
    startRun: vi.fn(async () => ({ ok: false as const, error: 'not here' })),
    configureRun: vi.fn(),
    agents: vi.fn(async () => []),
    machines,
    addMachine,
  }
  const ran = (): string[] => runCommand.mock.calls.map(([, args]) => args.join(' '))
  return { host, runCommand, machines, addMachine, ran }
}

function show(host: ModuleHost, projects: ModuleProject[] = [PROJECT, OTHER]) {
  return render(
    <ModuleHostContext.Provider value={host}>
      <ServersSettings projects={projects} everyMs={40} />
    </ModuleHostContext.Provider>,
  )
}

const ok = (output: unknown): ModuleCommandResult => ({ ok: true, output })
const stepNames = (): string[] => within(screen.getByRole('list', { name: 'The install on 203.0.113.5' })).getAllByRole('listitem').map(item => item.getAttribute('aria-label')!)

afterEach(cleanup)

describe('Settings → Servers', () => {
  test('no project, no section', () => {
    const { host } = dashboard(() => ok({ servers: [] }))
    expect(show(host, []).container.textContent).toBe('')
  })

  test('an address and a user name, root unless said: Connect installs this computer\'s own OpenAgent there, in one project', async () => {
    const { host, runCommand, ran } = dashboard(() => ok({ servers: [] }))
    show(host)
    const connect = screen.getByRole('button', { name: 'Connect' }) as HTMLButtonElement
    expect(connect.disabled).toBe(true)
    expect((screen.getByLabelText('User name') as HTMLInputElement).value).toBe('root')
    await waitFor(() => expect(host.machines).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText("The server's address"), { target: { value: ' 203.0.113.5 ' } })
    await waitFor(() => expect(connect.disabled).toBe(false))
    fireEvent.click(connect)
    await waitFor(() => expect(ran()).toContain('connect 203.0.113.5 root 1.2.3'))
    expect(runCommand.mock.calls.every(([projectId]) => projectId === 'p1')).toBe(true)
    // The server is in the list from here on: the field is free for the next one.
    await waitFor(() => expect((screen.getByLabelText("The server's address") as HTMLInputElement).value).toBe(''))
  })

  test('Connect waits until this computer has said which OpenAgent it runs: that is the one the server gets', async () => {
    const { host, machines, ran } = dashboard(() => ok({ servers: [] }))
    let say: (saved: ModuleMachines) => void = () => {}
    machines.mockImplementation(() => new Promise<ModuleMachines>(resolve => (say = resolve)))
    show(host)
    fireEvent.change(screen.getByLabelText("The server's address"), { target: { value: '203.0.113.5' } })
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
    expect(stepNames()).toEqual(['Log in: done', 'The user openagent: done', 'git, Node and Chrome: running', 'OpenAgent: not started', 'Claude Code: not started', 'The service: not started', 'The door: not started'])
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
    fireEvent.click(screen.getByRole('button', { name: 'Try 203.0.113.5 again' }))
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
  })

  test('a server that could not be saved says why, and is tried again on a press, not by itself', async () => {
    const { host, ran, addMachine } = dashboard(args => (args[0] === 'link' ? ok(LINK) : ok({ servers: [server(ALL_DONE)] })), { version: '1.2.3', machines: [] }, { ok: false, error: 'this code no longer works' })
    show(host)
    expect((await screen.findByRole('alert')).textContent).toBe('this code no longer works')
    expect(stepNames().at(-1)).toBe('Among your machines: failed')
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(addMachine).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Add 203.0.113.5 to Machines' }))
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
    expect(screen.getByRole('button', { name: 'Add 203.0.113.5 to Machines' }).textContent).toBe('Add again')
  })

  test('a server that is among the machines shows its OpenAgent; one that fell behind this computer says so and has Update', async () => {
    const saved = (version?: string): ModuleMachines => ({ version: '1.2.3', machines: [{ id: 'https://203.0.113.5', label: '203.0.113.5', url: 'https://203.0.113.5', ...(version ? { version } : {}) }] })
    const same = dashboard(() => ok({ servers: [server(ALL_DONE, { adding: false })] }), saved('1.2.3'))
    show(same.host)
    expect(await screen.findByText('OpenAgent 1.2.3.')).toBeTruthy()
    expect(stepNames().at(-1)).toBe('Among your machines: done')
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

  test('a server taken out of the machines is not put back by itself; Remove takes it off this list', async () => {
    const { host, ran, addMachine } = dashboard(() => ok({ servers: [server(ALL_DONE, { adding: false })] }))
    show(host)
    expect(await screen.findByText('Installed, and not among your machines.')).toBeTruthy()
    await new Promise(resolve => setTimeout(resolve, 120))
    expect(addMachine).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Add 203.0.113.5 to Machines' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove 203.0.113.5' }))
    await waitFor(() => expect(ran()).toContain('forget 203.0.113.5'))
  })

  test('a command that refuses says why; servers that cannot be read say so', async () => {
    const refusing = dashboard(args => (args[0] === 'connect' ? { ok: false, error: 'nope is not a server\'s number or name' } : ok({ servers: [] })))
    show(refusing.host)
    fireEvent.change(screen.getByLabelText("The server's address"), { target: { value: 'nope' } })
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

  test('older is by the three numbers of a version', () => {
    expect(olderThan('1.2.0', '1.2.3')).toBe(true)
    expect(olderThan('0.9.9', '0.10.0')).toBe(true)
    expect(olderThan('1.2.3', '1.2.3')).toBe(false)
    expect(olderThan('2.0.0', '1.9.9')).toBe(false)
    expect(olderThan('unknown', '1.2.3')).toBe(false)
  })
})
