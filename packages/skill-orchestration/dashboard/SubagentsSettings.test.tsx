import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { ModuleHostContext, type ModuleCommandResult, type ModuleHost } from '@openagt/dashboard/module'
import { SubagentsSettings } from './SubagentsSettings.js'
import { runnerChoices, runnerOf, runnerValue } from './choices.js'
import { choices, offered, pick, showing } from '../../openagent/dashboard/test-controls.js'

// The coding agents' own lists, as the dashboard asked them: Claude Code answered, Codex listed one.
vi.mock('../../openagent/dashboard/rpc/models.js', () => ({
  onModels: vi.fn(async () => ({
    'claude-code': { models: [{ id: 'opus', name: 'Opus 5.5' }] },
    codex: { models: [{ id: 'gpt-5.6-luna', name: 'GPT-5.6-Luna' }] },
  })),
}))

const PROJECTS = [
  { id: 'p1', name: 'gemstack', gitHost: true },
  { id: 'p2', name: 'other', gitHost: true },
]

/** A host whose `orchestration settings` keeps what it was given per project, as the command does. */
function fakeHost(saved: Record<string, unknown> = {}, refuse?: (projectId: string) => string | undefined, files: Record<string, unknown> = { p1: saved, p2: saved }) {
  const runCommand = vi.fn(async (projectId: string, args: string[]): Promise<ModuleCommandResult> => {
    const refused = refuse?.(projectId)
    if (refused !== undefined) return { ok: false, error: refused }
    if (args.length === 2) files[projectId] = JSON.parse(args[1]!)
    return { ok: true, output: { ok: true, ...(files[projectId] as object) } }
  })
  const host: ModuleHost = {
    package: '@openagt/skill-orchestration',
    runCommand,
    act: runCommand,
    runComputerCommand: vi.fn(async () => ({ ok: false as const, error: 'not the computer\'s' })),
    read: vi.fn(async () => ({ ok: false as const, error: 'no server part' })),
    openAgent: vi.fn(),
    openPage: vi.fn(),
    startRun: vi.fn(async () => ({ ok: false as const, error: 'not here' })),
    configureRun: vi.fn(),
    agents: vi.fn(async () => []),
    machines: vi.fn(async () => ({ version: '0.0.0', machines: [] })),
    addMachine: vi.fn(async () => ({ ok: false as const, error: 'not here' })),
    removeMachine: vi.fn(async () => ({ ok: false as const, error: 'not here' })),
    watchScreen: vi.fn(async () => undefined),
    sendToScreen: vi.fn(async () => false),
  }
  return { host, runCommand, files }
}

function show(host: ModuleHost, projects = PROJECTS) {
  return render(
    <ModuleHostContext.Provider value={host}>
      <SubagentsSettings projects={projects} />
    </ModuleHostContext.Provider>,
  )
}

/** A row's menu, by its label: the button that shows its pick, in the words the list has for it, and opens the list. */
const menu = (label: string) => screen.getByRole('combobox', { name: label })
/** Wait until the coding agents answered with their models: a list holds a model's line only from then on. */
const modelsListed = () => waitFor(async () => expect(await choices(menu('Hard tasks'))).toContain('Claude Code · Opus 5.5'))

afterEach(cleanup)

describe('Settings › Orchestration', () => {
  test('each level offers the main agent\'s own, then every coding agent by its default and its models; a pick is saved in every project', async () => {
    const { host, runCommand, files } = fakeHost({ hard: { driver: 'claude-code', model: 'opus' }, atOnce: 3 })
    show(host)
    await waitFor(() => expect(showing(menu('Hard tasks'))).toBe('Claude Code · Opus 5.5'))
    const simple = menu('Simple tasks')
    await waitFor(async () => expect(await choices(simple)).toEqual(['Same as the main agent', 'Claude Code · its own default', 'Claude Code · Opus 5.5', 'Codex · its own default', 'Codex · GPT-5.6-Luna']))
    expect(showing(simple)).toBe('Same as the main agent')
    expect(showing(menu('At once'))).toBe('3')
    expect(await choices(menu('At once'))).toEqual(['1', '2', '3', '4', '5', '6', '7', '8'])

    await pick(simple, 'Codex · GPT-5.6-Luna')
    const whole = { hard: { driver: 'claude-code', model: 'opus' }, atOnce: 3, simple: { driver: 'codex', model: 'gpt-5.6-luna' } }
    await waitFor(() => expect(files).toEqual({ p1: whole, p2: whole }))
    expect(runCommand).toHaveBeenCalledWith('p2', ['settings', JSON.stringify(whole)])
    expect(showing(simple)).toBe('Codex · GPT-5.6-Luna')
    // The main agent's own is a choice with no value: picked, the level is saved as not set.
    await pick(menu('Hard tasks'), 'Same as the main agent')
    await waitFor(() => expect(files['p1']).toEqual({ atOnce: 3, simple: { driver: 'codex', model: 'gpt-5.6-luna' } }))
    expect(showing(menu('Hard tasks'))).toBe('Same as the main agent')
    await pick(menu('At once'), '6')
    await waitFor(() => expect(files['p1']).toEqual({ atOnce: 6, simple: { driver: 'codex', model: 'gpt-5.6-luna' } }))
    expect(showing(menu('At once'))).toBe('6')
  })

  test('projects that hold a setting differently read "Mixed", each named with its own; a pick changes that one setting in each and keeps the rest of each', async () => {
    const { host, files } = fakeHost({}, undefined, { p1: { hard: { driver: 'claude-code', model: 'opus' }, atOnce: 2 }, p2: { atOnce: 2 } })
    show(host)
    await modelsListed()
    await waitFor(() => expect(showing(menu('Hard tasks'))).toBe('Mixed'))
    expect(screen.getByText(/A task the main agent marks hard\. gemstack: Claude Code · Opus 5\.5 · other: Same as the main agent\./)).toBeTruthy()
    // "Mixed" says what is held; it is no choice to make.
    expect((await offered(menu('Hard tasks')))[0]).toEqual(['Mixed', true])
    // The settings the projects agree on read as they are.
    expect(showing(menu('At once'))).toBe('2')
    expect(showing(menu('Simple tasks'))).toBe('Same as the main agent')
    await pick(menu('Simple tasks'), 'Codex · its own default')
    await waitFor(() => expect(files).toEqual({ p1: { hard: { driver: 'claude-code', model: 'opus' }, atOnce: 2, simple: { driver: 'codex' } }, p2: { atOnce: 2, simple: { driver: 'codex' } } }))
    await pick(menu('Hard tasks'), 'Codex · its own default')
    await waitFor(() => expect(showing(menu('Hard tasks'))).toBe('Codex · its own default'))
    expect(files['p2']).toEqual({ atOnce: 2, simple: { driver: 'codex' }, hard: { driver: 'codex' } })
  })

  test('one project: its own settings, saved to it alone', async () => {
    const { host, runCommand } = fakeHost({ atOnce: 5 })
    show(host, [PROJECTS[1]!])
    await waitFor(() => expect(showing(menu('At once'))).toBe('5'))
    await pick(menu('At once'), '3')
    await waitFor(() => expect(runCommand).toHaveBeenCalledWith('p2', ['settings', JSON.stringify({ atOnce: 3 })]))
    expect(runCommand.mock.calls.some(([projectId]) => projectId === 'p1')).toBe(false)
  })

  test('nothing saved reads as the main agent\'s own and 4 at once; a project that cannot be read leaves the others shown', async () => {
    const { host } = fakeHost({}, projectId => (projectId === 'p1' ? 'orchestration: command not found' : undefined))
    show(host)
    await waitFor(() => expect(host.runCommand).toHaveBeenCalledWith('p2', ['settings']))
    await waitFor(() => expect(showing(menu('At once'))).toBe('4'))
    expect(showing(menu('Simple tasks'))).toBe('Same as the main agent')
    expect(showing(menu('Hard tasks'))).toBe('Same as the main agent')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  test('a second pick made before the first is saved keeps the first; saves go one at a time, the latest waiting pick sent next', async () => {
    const { host, runCommand } = fakeHost()
    show(host)
    await modelsListed()
    const finish: Array<(value: ModuleCommandResult) => void> = []
    runCommand.mockImplementation((_projectId: string, args: string[]) => (args.length === 2 ? new Promise(resolve => finish.push(resolve)) : Promise.resolve({ ok: true, output: { ok: true } })))
    const saves = () => runCommand.mock.calls.filter(([, args]) => args.length === 2).map(([projectId, args]) => [projectId, JSON.parse(args[1]!)])
    await pick(menu('Simple tasks'), 'Codex · its own default')
    expect(showing(menu('Simple tasks'))).toBe('Codex · its own default')
    await pick(menu('Hard tasks'), 'Claude Code · Opus 5.5')
    await pick(menu('At once'), '2')
    // Only the first save is on its way, to both projects.
    expect(saves()).toEqual([
      ['p1', { simple: { driver: 'codex' } }],
      ['p2', { simple: { driver: 'codex' } }],
    ])
    for (const done of finish.splice(0)) done({ ok: true, output: { ok: true } })
    // Then the latest pick alone, built on both earlier ones.
    const latest = { simple: { driver: 'codex' }, hard: { driver: 'claude-code', model: 'opus' }, atOnce: 2 }
    await waitFor(() => expect(saves().slice(2)).toEqual([['p1', latest], ['p2', latest]]))
    for (const done of finish.splice(0)) done({ ok: true, output: { ok: true } })
    await waitFor(() => expect(screen.queryByText('Saving…')).toBeNull())
    expect(saves()).toHaveLength(4)
  })

  test('a refused save overtaken by a later one that is saved says nothing', async () => {
    const { host, runCommand } = fakeHost()
    show(host)
    await modelsListed()
    const finish: Array<(value: ModuleCommandResult) => void> = []
    runCommand.mockImplementation((_projectId: string, args: string[]) => (args.length === 2 ? new Promise(resolve => finish.push(resolve)) : Promise.resolve({ ok: true, output: { ok: true } })))
    await pick(menu('Simple tasks'), 'Codex · its own default')
    await pick(menu('Hard tasks'), 'Claude Code · Opus 5.5')
    for (const done of finish.splice(0)) done({ ok: false, error: 'busy' })
    await waitFor(() => expect(finish).toHaveLength(2))
    for (const done of finish.splice(0)) done({ ok: true, output: { ok: true } })
    await waitFor(() => expect(screen.queryByText('Saving…')).toBeNull())
    expect(screen.queryByRole('alert')).toBeNull()
  })

  test('a save a project refused says which and why, and the menu shows what is saved again; nothing read says why', async () => {
    const { host } = fakeHost()
    show(host)
    await screen.findByLabelText('Simple tasks')
    // The save is refused in one project, and the read after it does not come back: the menu
    // still goes back to what was read last, not the refused pick.
    ;(host.runCommand as ReturnType<typeof vi.fn>).mockImplementation(async (projectId: string, args: string[]) => {
      if (args.length === 1) throw new Error('the dashboard is not answering')
      return projectId === 'p2' ? { ok: false, error: 'atOnce is not a whole number' } : { ok: true, output: { ok: true } }
    })
    await pick(menu('Simple tasks'), 'Codex · its own default')
    expect((await screen.findByRole('alert')).textContent).toBe('The subagent settings were not saved: other: atOnce is not a whole number')
    await waitFor(() => expect(showing(menu('Simple tasks'))).toBe('Same as the main agent'))
    cleanup()

    const { host: broken } = fakeHost({}, () => 'orchestration: command not found')
    show(broken)
    expect((await screen.findByRole('alert')).textContent).toBe('The subagent settings could not be read: gemstack: orchestration: command not found')
  })

  test('no project with the package: no section', () => {
    const { host } = fakeHost()
    const { container } = show(host, [])
    expect(container.textContent).toBe('')
  })

  test('a choice is one coding agent and one model, and a saved model the agent does not list is kept', () => {
    expect(runnerValue(undefined)).toBe('')
    expect(runnerValue({ driver: 'codex' })).toBe('codex')
    expect(runnerValue({ driver: 'codex', model: 'gpt-5.5' })).toBe('codex gpt-5.5')
    expect(runnerOf('codex gpt-5.5')).toEqual({ driver: 'codex', model: 'gpt-5.5' })
    expect(runnerOf('claude-code')).toEqual({ driver: 'claude-code' })
    expect(runnerOf('')).toBeUndefined()
    const kept = runnerChoices([{ value: 'codex', label: 'Codex', models: [] }], { driver: 'codex', model: 'gpt-5.5' })
    expect(kept.map(o => [o.value, o.label])).toEqual([['', 'Same as the main agent'], ['codex', 'Codex · its own default'], ['codex gpt-5.5', 'Codex · gpt-5.5']])
  })
})
