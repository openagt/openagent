import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { Laptop } from 'lucide-react'
import { ModulesContext, mountedOf } from '../lib/use-modules.js'
import type { UiWorkProps } from '../module/index.js'

const { ActivityPanel } = await import('./ActivityPanel.js')

afterEach(cleanup)

const work: UiWorkProps = { projectId: 'p1', agentId: 'r1', working: false, ended: true, saving: false }
const base = { runsOn: 'This machine', runsOnIcon: Laptop, background: [], subagents: [], work }
const part = (name: string) => screen.getByRole('region', { name })
const rows = (name: string) => [...part(name).querySelectorAll('.truncate')].map(row => row.textContent)

describe("a session's Activity panel", () => {
  test('its Environment, as Claude Code\'s: where it runs, the project as its repository names it, the copied repos the modules list, then the branch', () => {
    const Copies = () => <p>suleimansh/oa-newuser</p>
    render(
      <ModulesContext.Provider value={mountedOf({ views: { 'chat.environment': [{ place: 'chat.environment', id: 'copies', View: Copies, package: '@openagt/git-branches', projects: ['p1'] }] } })}>
        <ActivityPanel {...base} project={{ name: 'test-project', address: 'github.com/suleimansh/test-project' }} branch="agent-2026-11-24T15-37-40-716Z" />
      </ModulesContext.Provider>,
    )
    expect(part('Environment').textContent).toBe('EnvironmentThis machinesuleimansh/test-projectsuleimansh/oa-newuseragent-2026-11-24T15-37-40-716Z')
  })

  test('a project with no remote is named by its name; a session with no project has no project row', () => {
    render(<ActivityPanel {...base} project={{ name: 'notes' }} />)
    expect(rows('Environment')).toEqual(['This machine', 'notes'])
    cleanup()
    render(<ActivityPanel {...base} />)
    expect(rows('Environment')).toEqual(['This machine'])
  })

  test('how full its context is, with a bar, as its last turn left it; none when nobody can measure it', () => {
    render(<ActivityPanel {...base} context={{ used: 62_000, size: 200_000 }} />)
    expect(part('Context').textContent).toBe('Context31% used62.0k / 200kAs of the last turn.')
    expect(within(part('Context')).getByRole('img', { name: '31% of the context used' })).toBeTruthy()
    cleanup()
    render(<ActivityPanel {...base} />)
    expect(screen.queryByRole('region', { name: 'Context' })).toBeNull()
  })

  test('what runs in the background, while anything does: its subagents, which open, then its background commands', () => {
    const open = vi.fn()
    render(<ActivityPanel {...base} subagents={[{ key: 'call:a', name: 'Count README lines' }]} background={[{ id: 't1', description: 'pnpm test', since: new Date().toISOString() }]} onOpenSubagent={open} />)
    expect(rows('Background tasks')).toEqual(['Count README lines', 'pnpm test'])
    fireEvent.click(within(part('Background tasks')).getByText('Count README lines'))
    expect(open).toHaveBeenCalledWith('call:a')
    cleanup()
    render(<ActivityPanel {...base} />)
    expect(screen.queryByRole('region', { name: 'Background tasks' })).toBeNull()
  })

  test("its Changes hold the modules' rows, told the session's work", () => {
    const Row = (props: UiWorkProps) => <div data-work-row>{`${props.projectId} ${props.agentId} ${props.ended}`}</div>
    render(
      <ModulesContext.Provider value={mountedOf({ views: { 'chat.work': [{ place: 'chat.work', id: 'project', View: Row, package: '@openagt/git-branches', projects: ['p1'] }] } })}>
        <ActivityPanel {...base} />
      </ModulesContext.Provider>,
    )
    expect(within(part('Changes')).getByText('p1 r1 true')).toBeTruthy()
  })
})
