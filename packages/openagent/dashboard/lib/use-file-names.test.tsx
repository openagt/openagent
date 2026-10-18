import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { HostServicesContext, INERT_HOST_SERVICES } from './host-services.js'
import { ModulesContext, type MountedModules } from './use-modules.js'
import { pathsIn, useFileNames } from './use-file-names.js'
import { useSchedule } from './use-schedule.js'

const NOTHING: MountedModules = { pages: [], cards: [], linkActions: [], panels: [], runSlots: [], settings: [], loaded: true }

afterEach(cleanup)

describe('pathsIn', () => {
  test('the paths into a project\'s files a text names: a page-shaped first segment, then a slash and more', () => {
    expect(pathsIn('Create tickets/2026-08-01_login-page.plan.md')).toEqual(['tickets/2026-08-01_login-page.plan.md'])
    expect(pathsIn('[Login page](tickets/2026-08-01_login-page.md) and a note')).toEqual(['tickets/2026-08-01_login-page.md'])
    expect(pathsIn('Read tickets/a.md, then tickets/b.md.')).toEqual(['tickets/a.md', 'tickets/b.md'])
    expect(pathsIn('Twice: tickets/a.md tickets/a.md')).toEqual(['tickets/a.md'])
  })

  test('a web address, an absolute path, and words with no slash are no such path', () => {
    expect(pathsIn('Tidy the loader')).toEqual([])
    expect(pathsIn('See https://github.com/x/y/issues/1')).toEqual([])
    expect(pathsIn('Mail a@b.io/c and ./tickets/a.md')).toEqual([])
    expect(pathsIn('Fix /etc/hosts')).toEqual([])
  })
})

describe('useFileNames', () => {
  function Names({ asked, path }: { asked: { projectId: string; paths: string[] }[]; path: string }) {
    const names = useFileNames(asked)
    const name = names('p1', path)
    return name ? <button onClick={name.open}>{name.title}</button> : <span>no name</span>
  }

  test('the page that owns a path\'s first segment is asked for its name, through its own package, only in a project that has it; the name opens that page', async () => {
    const openPage = vi.fn()
    const names = vi.fn(async (_host: unknown, _projectId: string, paths: string[]) => Object.fromEntries(paths.map(path => [path, { title: `Title of ${path}` }])))
    const modules: MountedModules = { ...NOTHING, pages: [{ segment: 'tickets', label: 'Tickets', Page: () => null, package: 'a-tickets', projects: ['p1'], names }] }
    render(
      <HostServicesContext.Provider value={{ ...INERT_HOST_SERVICES, openPage }}>
        <ModulesContext.Provider value={modules}>
          <Names asked={[{ projectId: 'p1', paths: ['tickets/a.md', 'docs/b.md'] }, { projectId: 'p2', paths: ['tickets/c.md'] }]} path="tickets/a.md" />
        </ModulesContext.Provider>
      </HostServicesContext.Provider>,
    )
    const name = await screen.findByRole('button', { name: 'Title of tickets/a.md' })
    expect(names).toHaveBeenCalledTimes(1)
    expect(names).toHaveBeenCalledWith(expect.objectContaining({ package: 'a-tickets' }), 'p1', ['tickets/a.md'])
    name.click()
    expect(openPage).toHaveBeenCalledWith('tickets', ['a.md'], 'p1')
  })

  test('a name may open another path than the one asked about; a path no page names, or a page that fails, has no name', async () => {
    const openPage = vi.fn()
    const modules: MountedModules = {
      ...NOTHING,
      pages: [
        { segment: 'tickets', label: 'Tickets', Page: () => null, package: 'a-tickets', projects: ['p1'], names: async () => ({ 'tickets/a.plan.md': { title: 'Plan: A', href: 'tickets/a.md' } }) },
        { segment: 'docs', label: 'Docs', Page: () => null, package: 'a-docs', projects: ['p1'], names: async () => Promise.reject(new Error('no')) },
      ],
    }
    const { rerender } = render(
      <HostServicesContext.Provider value={{ ...INERT_HOST_SERVICES, openPage }}>
        <ModulesContext.Provider value={modules}>
          <Names asked={[{ projectId: 'p1', paths: ['tickets/a.plan.md', 'tickets/gone.md', 'docs/b.md'] }]} path="tickets/a.plan.md" />
        </ModulesContext.Provider>
      </HostServicesContext.Provider>,
    )
    ;(await screen.findByRole('button', { name: 'Plan: A' })).click()
    expect(openPage).toHaveBeenCalledWith('tickets', ['a.md'], 'p1')
    for (const path of ['tickets/gone.md', 'docs/b.md']) {
      rerender(
        <HostServicesContext.Provider value={{ ...INERT_HOST_SERVICES, openPage }}>
          <ModulesContext.Provider value={modules}>
            <Names asked={[{ projectId: 'p1', paths: ['tickets/a.plan.md', 'tickets/gone.md', 'docs/b.md'] }]} path={path} />
          </ModulesContext.Provider>
        </HostServicesContext.Provider>,
      )
      expect(screen.getByText('no name')).toBeTruthy()
    }
  })
})

describe('useSchedule', () => {
  const alpha = { id: 'p1', name: 'alpha', gitHost: true }
  const beta = { id: 'p2', name: 'beta', gitHost: true }
  function Shown() {
    const schedule = useSchedule([alpha, beta])
    return (
      <button onClick={schedule.open}>
        {schedule.page ? `${schedule.page.label} at ${schedule.page.href}` : 'no page'}: {JSON.stringify(schedule.commands)}
      </button>
    )
  }
  const show = (modules: MountedModules, openPage = vi.fn()) =>
    render(
      <HostServicesContext.Provider value={{ ...INERT_HOST_SERVICES, openPage }}>
        <ModulesContext.Provider value={modules}>
          <Shown />
        </ModulesContext.Provider>
      </HostServicesContext.Provider>,
    )

  test('until the installed modules are known, nothing is known of any project: no project is said to have nothing starting', async () => {
    show({ ...NOTHING, loaded: false })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(screen.getByRole('button').textContent).toBe('no page: {}')
  })

  test('with no module that schedules anything, every project is known to have nothing that starts by itself, and there is no page to send a person to', async () => {
    show(NOTHING)
    await waitFor(() => expect(screen.getByRole('button').textContent).toBe('no page: {"p1":[],"p2":[]}'))
  })

  test('the scheduling module is asked per project that has it, through its own package; a project it is not in has nothing; its page is named by its sidebar label and opened', async () => {
    const openPage = vi.fn()
    const read = vi.fn(async () => [{ command: 'work-queue', on: true, note: 'Starts when there is work' }])
    show(
      {
        ...NOTHING,
        pages: [{ segment: 'automations', label: 'Automations', Page: () => null, package: 'a-scheduler', projects: ['p1'] }],
        schedule: { page: 'automations', read, package: 'a-scheduler', projects: ['p1'] },
      },
      openPage,
    )
    const shown = screen.getByRole('button')
    await waitFor(() => expect(shown.textContent).toBe('Automations at /automations: {"p1":[{"command":"work-queue","on":true,"note":"Starts when there is work"}],"p2":[]}'))
    expect(read).toHaveBeenCalledTimes(1)
    expect(read).toHaveBeenCalledWith(expect.objectContaining({ package: 'a-scheduler' }), alpha)
    shown.click()
    await waitFor(() => expect(openPage).toHaveBeenCalledWith('automations'))
  })

  test('a project whose read fails stays unknown, while the others are answered', async () => {
    const read = vi.fn(async (_host: unknown, project: { id: string }) => {
      if (project.id === 'p1') throw new Error('not inside a git repository')
      return [{ command: 'work-queue', on: false }]
    })
    show({ ...NOTHING, schedule: { page: 'automations', read, package: 'a-scheduler', projects: ['p1', 'p2'] } })
    await waitFor(() => expect(screen.getByRole('button').textContent).toBe('automations at /automations: {"p2":[{"command":"work-queue","on":false}]}'))
  })
})
