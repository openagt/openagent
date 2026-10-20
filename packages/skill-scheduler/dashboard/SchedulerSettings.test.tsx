import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ModuleHostContext, type ModuleCommandResult, type ModuleHost, type ModuleProject } from '@openagt/dashboard/module'
import { SchedulerSettings } from './SchedulerSettings.js'
import { STATUS, hostAnswering } from './fixtures.js'

const GEMSTACK = { id: 'p1', name: 'gemstack', gitHost: true }
const OTHER = { id: 'p2', name: 'other', gitHost: false }

function show(host: ModuleHost, projects: ModuleProject[] = [GEMSTACK]) {
  return render(
    <ModuleHostContext.Provider value={host}>
      <SchedulerSettings projects={projects} />
    </ModuleHostContext.Provider>,
  )
}

/** A host whose `status` answers {@link STATUS} and whose saves are answered by `saved`. */
function scheduler(saved: (projectId: string, args: string[]) => ModuleCommandResult = () => ({ ok: true, output: { ok: true } })) {
  return hostAnswering((projectId, args) => (args[0] === 'status' ? { ok: true, output: STATUS } : saved(projectId, args)))
}

afterEach(cleanup)

describe('Settings → Scheduler', () => {
  test('no project with the package, no section', () => {
    const { host } = scheduler()
    const { container } = show(host, [])
    expect(container.textContent).toBe('')
  })

  test('the section holds the spend offset alone: no scheduled command is listed, switched or given a publish level here', async () => {
    const { host } = scheduler()
    show(host, [GEMSTACK, OTHER])
    expect(await screen.findByLabelText('Spend offset')).toBeTruthy()
    expect(screen.getByText(/What a project starts by itself is on the Automations page\./)).toBeTruthy()
    expect(screen.getByText(/The handle on the usage bar moves the same number/)).toBeTruthy()
    expect(screen.queryByText(/work-queue/)).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  test('the spend offset shows the loosest one, and a typed one is saved in every project once it rests, held to the reach of the bar', async () => {
    const { host, runCommand } = hostAnswering((projectId, args) => (args[0] === 'status' ? { ok: true, output: { ...STATUS, spendOffset: projectId === 'p1' ? 7.1428 : -3 } } : { ok: true, output: { ok: true } }))
    show(host, [GEMSTACK, OTHER])
    const offset = (await screen.findByLabelText('Spend offset')) as HTMLInputElement
    expect(offset.value).toBe('7.1')
    // A minus sign alone is no number yet: it stays in the field and saves nothing.
    fireEvent.change(offset, { target: { value: '-' } })
    fireEvent.change(offset, { target: { value: '-2' } })
    fireEvent.change(offset, { target: { value: '-200' } })
    fireEvent.blur(offset)
    expect(offset.value).toBe('-50')
    await waitFor(() => expect(runCommand).toHaveBeenCalledWith('p2', ['offset', '--', '-50']))
    expect(runCommand).toHaveBeenCalledWith('p1', ['offset', '--', '-50'])
    // Typing is several changes: only the resting value is saved.
    expect(runCommand.mock.calls.filter(([, args]) => args[0] === 'offset')).toHaveLength(2)
  })

  test('an offset the command refused says why, and the number shown is the saved one again', async () => {
    const { host } = scheduler(() => ({ ok: false, error: 'not inside a git repository' }))
    show(host)
    const offset = (await screen.findByLabelText('Spend offset')) as HTMLInputElement
    fireEvent.change(offset, { target: { value: '20' } })
    fireEvent.blur(offset)
    expect((await screen.findByRole('alert')).textContent).toBe('The spend offset was not saved: gemstack: not inside a git repository')
    expect(offset.value).toBe('7')
  })

  test('projects holding different offsets: the loosest is shown and each other one is named with its own; projects that agree are not', async () => {
    const offsets: Record<string, number> = { p1: 7, p2: -10.04 }
    const { host } = hostAnswering((projectId, args) => (args[0] === 'status' ? { ok: true, output: { ...STATUS, spendOffset: offsets[projectId] } } : { ok: true, output: { ok: true } }))
    show(host, [GEMSTACK, OTHER])
    await screen.findByLabelText('Spend offset')
    expect(screen.getByText(/Shown: the loosest\. other is at -10; saving sets each of them to the same number\./)).toBeTruthy()
    cleanup()
    const { host: agreeing } = scheduler()
    show(agreeing, [GEMSTACK, OTHER])
    await screen.findByLabelText('Spend offset')
    expect(screen.queryByText(/Shown: the loosest/)).toBeNull()
  })

  test('an offset save that could not even be asked says why, and the next one still saves', async () => {
    let down = true
    const { host, runCommand } = hostAnswering((projectId, args) => {
      if (args[0] === 'status') return { ok: true, output: STATUS }
      if (down) throw new Error('Failed to fetch')
      return { ok: true, output: { ok: true } }
    })
    show(host)
    const offset = (await screen.findByLabelText('Spend offset')) as HTMLInputElement
    fireEvent.change(offset, { target: { value: '20' } })
    expect((await screen.findByRole('alert', undefined, { timeout: 3000 })).textContent).toBe('The spend offset was not saved: Failed to fetch')
    down = false
    fireEvent.change(offset, { target: { value: '21' } })
    await waitFor(() => expect(runCommand.mock.calls.filter(([, args]) => args[0] === 'offset').map(([, args]) => args[2])).toEqual(['20', '21']), { timeout: 3000 })
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  test('a project whose scheduler cannot be read is named with the reason, and the offset of the others still shows', async () => {
    const { host } = hostAnswering(projectId => (projectId === 'p1' ? { ok: true, output: STATUS } : { ok: false, error: 'not inside a git repository' }))
    show(host, [GEMSTACK, OTHER])
    expect((await screen.findByRole('alert')).textContent).toBe('The scheduler of other could not be read: not inside a git repository')
    expect((screen.getByLabelText('Spend offset') as HTMLInputElement).value).toBe('7')
    cleanup()
    // No project answered: no number to show, only why.
    const { host: none } = hostAnswering(() => ({ ok: false, error: 'not inside a git repository' }))
    show(none)
    expect((await screen.findByRole('alert')).textContent).toBe('The scheduler of gemstack could not be read: not inside a git repository')
    expect(screen.queryByLabelText('Spend offset')).toBeNull()
  })
})
