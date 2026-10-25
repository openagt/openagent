import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ProjectSkills } from '../rpc/skills.js'

// The Overview's Skills card: how each project's skills stand, said as the project's page says it
// (ProjectSkills.test.tsx), with the one press that brings them where they should be.

const skills = vi.hoisted(() => ({ onProjectSkills: vi.fn(), sendProjectSkills: vi.fn(), sendChangeSkills: vi.fn() }))
vi.mock('../rpc/skills.js', () => skills)
const modules = vi.hoisted(() => ({ runModuleCommand: vi.fn() }))
vi.mock('../rpc/modules.js', () => modules)
const { SkillsCard } = await import('./SkillsCard.js')

const skill = (name: string, over: Record<string, unknown> = {}) => ({ name, description: '', standing: 'current', waiting: false, ...over })
const state = (list: ReturnType<typeof skill>[], over: Partial<ProjectSkills> = {}): ProjectSkills =>
  ({ groups: [{ title: 'Skills', ticked: true, skills: list }], uncommitted: [], git: true, remote: 'GitHub', local: false, ...over }) as ProjectSkills
const project = (id: string) => ({ id, name: id, path: `/repos/${id}` }) as never

// No record says which skills were used, unless a test says.
beforeEach(() => modules.runModuleCommand.mockResolvedValue({ ok: false, error: 'no logs package' }))

afterEach(() => {
  cleanup()
  for (const fn of Object.values(skills)) fn.mockReset()
  modules.runModuleCommand.mockReset()
})

test('each project: how many skills it holds, and a newer version to take, skills to send, a pull request they wait in, or up to date', async () => {
  const read: Record<string, ProjectSkills> = {
    alpha: state([skill('queue', { standing: 'newer' }), skill('logs', { standing: 'newer' }), skill('tickets'), skill('plan', { standing: 'absent' })]),
    beta: state([skill('queue', { waiting: true })]),
    gamma: state([skill('queue'), skill('logs')]),
    empty: state([skill('queue', { standing: 'absent' })]),
    delta: state([skill('queue', { waiting: true })], { request: { number: 12, url: 'https://github.com/o/r/pull/12' } }),
  }
  skills.onProjectSkills.mockImplementation(async (id: string) => read[id] ?? null)
  skills.sendChangeSkills.mockResolvedValue({ ok: true, written: ['queue', 'logs'], removed: [], left: [] })
  skills.sendProjectSkills.mockResolvedValue({ ok: true })
  const onSelectProject = vi.fn()
  render(<SkillsCard projects={['alpha', 'beta', 'gamma', 'delta', 'empty', 'gone'].map(project)} onSelectProject={onSelectProject} />)
  const alpha = within(await screen.findByRole('listitem', { name: 'alpha' }))
  expect(alpha.getByText('3 skills')).toBeTruthy()
  expect(alpha.getByText('2 have newer versions: queue, logs')).toBeTruthy()
  expect(within(screen.getByRole('listitem', { name: 'gamma' })).getByText('up to date')).toBeTruthy()
  expect(within(screen.getByRole('listitem', { name: 'delta' })).getByRole('link', { name: 'in #12' }).getAttribute('href')).toBe('https://github.com/o/r/pull/12')
  expect(within(screen.getByRole('listitem', { name: 'gone' })).getByText('could not be read')).toBeTruthy()
  // A project with no skill is not "up to date": it has none, and Add opens its page to pick them.
  const empty = within(screen.getByRole('listitem', { name: 'empty' }))
  expect(empty.getByText('no skills yet')).toBeTruthy()
  expect(empty.queryByText('up to date')).toBeNull()
  fireEvent.click(empty.getByRole('button', { name: 'Add' }))
  expect(onSelectProject).toHaveBeenCalledWith('empty')
  // Update takes the newer versions, then sends them.
  fireEvent.click(alpha.getByRole('button', { name: 'Update 2' }))
  await waitFor(() => expect(skills.sendProjectSkills).toHaveBeenCalledWith('alpha', ['queue', 'logs']))
  expect(skills.sendChangeSkills).toHaveBeenCalledWith('alpha', { write: ['queue', 'logs'] })
  // Send sends what is on its way.
  fireEvent.click(within(screen.getByRole('listitem', { name: 'beta' })).getByRole('button', { name: 'Send to GitHub' }))
  await waitFor(() => expect(skills.sendProjectSkills).toHaveBeenCalledWith('beta'))
  // A project's name opens its page.
  fireEvent.click(screen.getByRole('button', { name: 'gamma' }))
  expect(onSelectProject).toHaveBeenCalledWith('gamma')
})

test('which skills the agents used in the last 30 days over the projects shown, the most used first, and the ones held that no agent used; Update all takes every project\'s newer versions', async () => {
  const read: Record<string, ProjectSkills> = {
    alpha: state([skill('tickets', { standing: 'newer' }), skill('queue'), skill('plan')]),
    beta: state([skill('tickets', { standing: 'newer' }), skill('research')]),
  }
  const used: Record<string, unknown[]> = {
    alpha: [{ skill: 'tickets', uses: 10, runs: 6, lastAt: '2026-10-25T00:00:00Z' }, { skill: 'queue', uses: 4, runs: 4, lastAt: '2026-10-24T00:00:00Z' }],
    beta: [{ skill: 'tickets', uses: 2, runs: 2, lastAt: '2026-10-20T00:00:00Z' }],
  }
  skills.onProjectSkills.mockImplementation(async (id: string) => read[id] ?? null)
  modules.runModuleCommand.mockImplementation(async (id: string, pkg: string, args: string[]) => (pkg === '@openagt/skill-logs' && args[0] === 'skills' ? { ok: true, output: used[id] } : { ok: false, error: 'no' }))
  skills.sendChangeSkills.mockResolvedValue({ ok: true, written: ['tickets'], removed: [], left: [] })
  skills.sendProjectSkills.mockResolvedValue({ ok: true })
  render(<SkillsCard projects={['alpha', 'beta'].map(project)} onSelectProject={() => {}} />)
  const usage = within(await screen.findByRole('region', { name: 'Most used' }))
  expect(usage.getAllByRole('listitem').map(item => [item.getAttribute('aria-label'), item.textContent?.match(/\d+$/)?.[0]])).toEqual([
    ['tickets', '12'],
    ['queue', '4'],
  ])
  expect(usage.getByText(/Not used:/).closest('p')!.textContent).toBe('Not used: plan, research')
  fireEvent.click(screen.getByRole('button', { name: 'Update all (2)' }))
  await waitFor(() => expect(skills.sendProjectSkills).toHaveBeenCalledTimes(2))
  expect(skills.sendChangeSkills.mock.calls).toEqual([
    ['alpha', { write: ['tickets'] }],
    ['beta', { write: ['tickets'] }],
  ])
})
