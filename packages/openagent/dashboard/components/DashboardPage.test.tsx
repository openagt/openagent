import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ActiveAgent, Intervention } from '../../src/index.js'

// The Overview's own layout: what needs a person beside who is working now, then the packages'
// cards. The cards are tested on their own; here they are stand-ins, and the page's read is stubbed.
const onDashboard = vi.hoisted(() => vi.fn())
vi.mock('../rpc/reads.js', () => ({ onDashboard }))
vi.mock('./Quota.js', () => ({ Quota: () => <div>usage</div> }))
vi.mock('./OnboardingChecklist.js', () => ({ OnboardingChecklist: () => <div>onboarding</div> }))
vi.mock('./ModuleCards.js', () => ({ ModuleCards: () => <div>a package's card</div> }))
vi.mock('../lib/preferences.js', () => ({ usePreferences: () => ({ onboardingDismissed: true }) }))

const { DashboardPage } = await import('./DashboardPage.js')

const active = (agentId: string, projectId = 'p1'): ActiveAgent => ({ projectId, projectName: projectId, agentId, cwd: `/repos/${agentId}`, status: 'running', updatedAt: '2026-07-25T10:00:00.000Z', intent: `working on ${agentId}` })
const show = (scope: string | null = null) => render(<DashboardPage onSelectProject={() => {}} onSelectAgent={() => {}} onAgentStarted={() => {}} interventions={[]} projects={[]} scope={scope} />)

beforeEach(() => onDashboard.mockReset())
afterEach(cleanup)

describe('the Overview', () => {
  test('with no agent at work there is no Agents card: what needs you takes the whole row, and nothing says "No agents working"', async () => {
    onDashboard.mockResolvedValue({ active: [] })
    show()
    const queue = await screen.findByText('Human Queue')
    await vi.waitFor(() => expect(onDashboard).toHaveBeenCalled())
    expect(screen.queryByText('Agents currently working')).toBeNull()
    expect(screen.queryByText(/No agents working/)).toBeNull()
    expect(queue.closest('.grid')!.className).not.toContain('lg:grid-cols-2')
    // The row's one column may shrink below its content, so a long row never pushes a card past a phone's edge.
    expect(queue.closest('.grid')!.className).toContain('grid-cols-[minmax(0,1fr)]')
    expect(screen.getByText("a package's card")).toBeTruthy()
  })

  test('while an agent works its card sits beside what needs you; with a project picked, only that project\'s agents count', async () => {
    onDashboard.mockResolvedValue({ active: [active('r1', 'p1')] })
    show()
    expect(await screen.findByText('working on r1')).toBeTruthy()
    expect(screen.getByText('Human Queue').closest('.grid')!.className).toContain('lg:grid-cols-2')
    cleanup()
    show('p2')
    await screen.findByText('Human Queue')
    await vi.waitFor(() => expect(onDashboard).toHaveBeenCalledTimes(2))
    expect(screen.queryByText('working on r1')).toBeNull()
    expect(screen.queryByText('Agents currently working')).toBeNull()
  })

  test("the packages' cards fill two columns, each card kept whole", async () => {
    onDashboard.mockResolvedValue({ active: [] })
    show()
    const cards = (await screen.findByText("a package's card")).parentElement!
    expect(cards.className).toContain('lg:columns-2')
    expect(cards.className).toContain('[&>*]:break-inside-avoid')
  })

  test('the Human Queue: work left uncommitted says so and opens its run; a request a run opened opens that run, one opened elsewhere links the git host', async () => {
    onDashboard.mockResolvedValue({ active: [] })
    const onSelectAgent = vi.fn()
    const item = (over: Partial<Intervention>): Intervention => ({ projectId: 'p1', projectName: 'test-project', kind: 'pr', title: 't', ...over })
    const interventions = [
      item({ kind: 'uncommitted', title: 'Create test.md', agentId: 'r1', branch: 'agent-r1', files: 1 }),
      item({ number: 6, title: 'Add DESCRIPTION.md', url: 'https://x/pull/6', agentId: 'r6' }),
      item({ number: 8, title: 'Condense README', url: 'https://x/pull/8' }),
    ]
    render(<DashboardPage onSelectProject={() => {}} onSelectAgent={onSelectAgent} onAgentStarted={() => {}} interventions={interventions} projects={[]} scope={null} />)
    expect(screen.getByText('Not committed')).toBeTruthy()
    expect(screen.getByText('1 file')).toBeTruthy()
    fireEvent.click(screen.getByText('Create test.md'))
    fireEvent.click(screen.getByText('Add DESCRIPTION.md'))
    expect(onSelectAgent.mock.calls).toEqual([['p1', 'r1'], ['p1', 'r6']])
    expect(screen.getByText('Condense README').closest('a')?.getAttribute('href')).toBe('https://x/pull/8')
    expect(screen.getByText('Add DESCRIPTION.md').closest('a')).toBeNull()
  })
})
