import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ModulesContext, type MountedLinkAction, type MountedModules } from '../lib/use-modules.js'

const runModuleCommand = vi.hoisted(() => vi.fn())
vi.mock('../rpc/modules.js', () => ({ runModuleCommand }))

const { LinkActions } = await import('./LinkActions.js')

/** One mounted action, the queue module's shape, whose `run` is a spy answering `result`. */
const mounted = (run: MountedLinkAction['run'], over: Partial<MountedLinkAction> = {}): MountedLinkAction => ({
  label: 'Add to queue',
  doneLabel: 'Queued',
  run,
  package: '@x/queue',
  projects: ['p1'],
  ...over,
})

const modules = (linkActions: MountedLinkAction[]): MountedModules => ({ pages: [], cards: [], linkActions, panels: [], runSlots: [], settings: [], everyPage: [], loaded: true })

const LINK = { text: 'Do the thing', href: 'tickets/t.md', priority: 7 }

afterEach(() => {
  cleanup()
  runModuleCommand.mockReset()
})

// The slot for the modules' link actions (#1774 Q3): a page shows links, a module acts on them, and
// this is where the dashboard puts the two together.
describe('LinkActions', () => {
  test('one button per mounted action whose package the project has; none for another project', () => {
    const run = vi.fn()
    const { rerender } = render(
      <ModulesContext.Provider value={modules([mounted(run)])}>
        <LinkActions projects={['p1']} targets={[{ projectId: 'p1', links: [LINK] }]} />
      </ModulesContext.Provider>,
    )
    expect(screen.getByRole('button', { name: 'Add to queue' })).toBeTruthy()
    rerender(
      <ModulesContext.Provider value={modules([mounted(run)])}>
        <LinkActions projects={['p2']} targets={[{ projectId: 'p2', links: [LINK] }]} />
      </ModulesContext.Provider>,
    )
    expect(screen.queryByRole('button')).toBeNull()
  })

  test('a click runs the action with the links, in order, per project, through a host bound to the module\'s package', async () => {
    const run = vi.fn().mockResolvedValue({ ok: true })
    render(
      <ModulesContext.Provider value={modules([mounted(run, { projects: ['p1', 'p2'] })])}>
        <LinkActions
          projects={['p1', 'p2']}
          targets={[
            { projectId: 'p1', links: [LINK, { text: 'Second' }] },
            { projectId: 'p2', links: [{ text: 'Third', href: 'tickets/c.md', priority: 5 }] },
          ]}
        />
      </ModulesContext.Provider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add to queue' }))
    await waitFor(() => expect(run).toHaveBeenCalledTimes(2))
    expect(run.mock.calls[0]![1]).toBe('p1')
    expect(run.mock.calls[0]![2]).toEqual([LINK, { text: 'Second' }])
    expect(run.mock.calls[1]![1]).toBe('p2')
    // The host runs only the module's own package's commands.
    runModuleCommand.mockResolvedValue({ ok: true, output: null })
    await run.mock.calls[0]![0].runCommand('p1', ['add', 'x'])
    // The last argument marks the command as an act, so the daemon converges the project's data and re-reads.
    expect(runModuleCommand).toHaveBeenCalledWith('p1', '@x/queue', ['add', 'x'], undefined, true)
    // Done: the button says so and rests.
    const rested = await screen.findByRole('button', { name: 'Queued' })
    expect((rested as HTMLButtonElement).disabled).toBe(true)
  })

  test('a project the action\'s package is not in is skipped, and an empty group runs nothing', async () => {
    const run = vi.fn().mockResolvedValue({ ok: true })
    render(
      <ModulesContext.Provider value={modules([mounted(run)])}>
        <LinkActions
          projects={['p1', 'p2']}
          targets={[
            { projectId: 'p2', links: [LINK] },
            { projectId: 'p1', links: [] },
          ]}
        />
      </ModulesContext.Provider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add to queue' }))
    await screen.findByRole('button', { name: 'Queued' })
    expect(run).not.toHaveBeenCalled()
  })

  test('the function form is resolved at click time, so a page can read what is already there first', async () => {
    const run = vi.fn().mockResolvedValue({ ok: true })
    const targets = vi.fn().mockResolvedValue([{ projectId: 'p1', links: [{ text: 'late' }] }])
    render(
      <ModulesContext.Provider value={modules([mounted(run)])}>
        <LinkActions projects={['p1']} targets={targets} />
      </ModulesContext.Provider>,
    )
    expect(targets).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Add to queue' }))
    await waitFor(() => expect(run).toHaveBeenCalledWith(expect.anything(), 'p1', [{ text: 'late' }]))
  })

  test('a failure shows the reason and leaves the button ready to try again', async () => {
    const run = vi.fn().mockResolvedValue({ ok: false, error: 'the repository has no remote' })
    render(
      <ModulesContext.Provider value={modules([mounted(run)])}>
        <LinkActions projects={['p1']} targets={[{ projectId: 'p1', links: [LINK] }]} />
      </ModulesContext.Provider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add to queue' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'the repository has no remote')
    expect(screen.queryByRole('button', { name: 'Queued' })).toBeNull()
    expect((screen.getByRole('button', { name: 'Add to queue' }) as HTMLButtonElement).disabled).toBe(false)
  })

  test('a rested button arms again when the set it acted on changes, and the label prop phrases the button', async () => {
    const run = vi.fn().mockResolvedValue({ ok: true })
    const page = (key: string) => (
      <ModulesContext.Provider value={modules([mounted(run)])}>
        <LinkActions projects={['p1']} targets={[{ projectId: 'p1', links: [LINK] }]} resetKey={key} label={a => `${a.label}: all 3 tickets`} />
      </ModulesContext.Provider>
    )
    const { rerender } = render(page('a'))
    fireEvent.click(screen.getByRole('button', { name: 'Add to queue: all 3 tickets' }))
    await screen.findByRole('button', { name: 'Queued' })
    rerender(page('b'))
    expect(await screen.findByRole('button', { name: 'Add to queue: all 3 tickets' })).toBeTruthy()
  })
})
