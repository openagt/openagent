import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { forgetRemembered, type ModuleCallResult } from '@openagt/ui/module'
import { fakeHost, renderWithHost } from '@openagt/ui/module/testing'
import { checked, choices, closeList, offered, openList, pick, showing } from '../../../ui/dashboard/test-controls.js'
import { AgentSettings } from './AgentSettings.js'

// Settings › Coding agent: the agent and model every next run is on, and whether runs are named.

afterEach(() => {
  cleanup()
  forgetRemembered()
  localStorage.clear()
})

// The coding agents' own lists, as the server part asked them: Claude Code answered, Codex could not.
const AGENTS = [
  { id: 'claude-code', label: 'Claude Code', list: 'claude', models: { models: [{ id: 'opus', name: 'Opus 5.5' }, { id: 'claude-fable-5-1', name: 'Fable 5.1' }] } },
  { id: 'codex', label: 'Codex', list: 'codex', models: { models: [], error: 'not logged in' } },
]

/** Settings' section on a server part holding `picked`, which a pick changes. */
function open({ picked = {}, states = [] }: { picked?: object; states?: unknown[] } = {}) {
  let held = picked
  let naming = true
  const callComputer = vi.fn(async (name: string, input: object): Promise<ModuleCallResult> => {
    if (name === 'pick') held = input
    if (name === 'setNaming') naming = (input as { on: boolean }).on
    const output = { agents: AGENTS, states, picked: held, naming, pick: null, setNaming: null }[name]
    return output === undefined ? { ok: false, error: `no ${name}` } : { ok: true, output }
  })
  const host = fakeHost('@openagt/agent-driver', { callComputer })
  renderWithHost(<AgentSettings />, host)
  const saves = () => callComputer.mock.calls.filter(([name]) => name === 'pick' || name === 'setNaming').map(([name, input]) => [name, input])
  return { host, saves }
}

const select = (label: string) => screen.getByRole('combobox', { name: label })

describe('Settings › Coding agent', () => {
  test('a coding agent that is not installed says so in its row, with the way to Permissions, where it is installed', async () => {
    const { host } = open({ states: [{ agent: 'claude-code', label: 'Claude Code', ready: false, problem: 'not found', fix: { kind: 'install', command: 'curl …', problem: 'not found' } }] })
    expect(await screen.findByText('Claude Code is not installed on this computer.')).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: 'Install it on Permissions' }))
    expect(host.openPage).toHaveBeenCalledWith('permissions')
  })

  test("the Model row offers the agent's own list, after the agent's own default; each saved by its id, the default as none", async () => {
    const { saves } = open()
    await waitFor(async () =>
      expect(await offered(select('Model'))).toEqual([
        ['Default', false],
        ['Opus 5.5', false],
        ['Fable 5.1', false],
      ]),
    )
    expect(showing(select('Model'))).toBe('Default')
    await pick(select('Model'), 'Opus 5.5')
    await waitFor(() => expect(showing(select('Model'))).toBe('Opus 5.5'))
    await pick(select('Model'), 'Default')
    await waitFor(() => expect(showing(select('Model'))).toBe('Default'))
    expect(saves()).toEqual([
      ['pick', { model: 'opus' }],
      ['pick', {}],
    ])
  })

  test('a saved model the agent does not list is kept, by its id, since a start is still given it', async () => {
    open({ picked: { driver: 'claude-code', model: 'fable' } })
    await waitFor(() => expect(showing(select('Model'))).toBe('fable'))
    expect(await choices(select('Model'))).toEqual(['Default', 'Opus 5.5', 'Fable 5.1', 'fable'])
    // The line is the saved id itself, not only its words: it is the one the list marks as the pick.
    const lines = within(await openList(select('Model'))).getAllByRole('option')
    expect(lines.map(line => line.getAttribute('aria-selected'))).toEqual(['false', 'false', 'false', 'true'])
    await closeList(select('Model'))
  })

  test('an agent that could not list its models says why, in a line that cannot be picked', async () => {
    open({ picked: { driver: 'codex' } })
    await waitFor(() => expect(showing(select('Coding agent'))).toBe('Codex'))
    expect(await offered(select('Model'))).toEqual([
      ['Default', false],
      ['not logged in', true],
    ])
  })

  test("picking another agent leaves the model unpinned: a model is one agent's own", async () => {
    const { saves } = open({ picked: { driver: 'claude-code', model: 'opus' } })
    await waitFor(() => expect(showing(select('Model'))).toBe('Opus 5.5'))
    expect(await choices(select('Coding agent'))).toEqual(['Claude Code', 'Codex'])
    await pick(select('Coding agent'), 'Codex')
    await waitFor(() => expect(showing(select('Coding agent'))).toBe('Codex'))
    expect(showing(select('Model'))).toBe('Default')
    expect(saves()).toEqual([['pick', { driver: 'codex' }]])
  })

  test('"Name each run" is a switch, on until turned off; switching it, or a click on its name, saves it at once', async () => {
    const { saves } = open()
    const row = () => screen.getByRole('switch', { name: 'Name each run' })
    await waitFor(() => expect(checked(row())).toBe(true))
    fireEvent.click(row())
    await waitFor(() => expect(checked(row())).toBe(false))
    fireEvent.click(screen.getByText('Name each run'))
    await waitFor(() => expect(checked(row())).toBe(true))
    expect(saves()).toEqual([
      ['setNaming', { on: false }],
      ['setNaming', { on: true }],
    ])
  })
})
