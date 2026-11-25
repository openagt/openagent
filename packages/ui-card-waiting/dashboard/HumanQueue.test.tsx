import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, screen } from '@testing-library/react'
import type { ReadState, WaitingItem } from '@openagt/ui/module'
import { fakeHost, renderWithHost } from '@openagt/ui/module/testing'

// What waits on the person as the shell read it, a test's: the card reads the shell's read, never one of its own.
const shell = vi.hoisted(() => ({ items: [] as WaitingItem[], state: 'fresh' as ReadState }))
vi.mock('@openagt/ui/module', async original => ({
  ...(await original<typeof import('@openagt/ui/module')>()),
  useWaiting: () => ({ items: shell.items, state: shell.state }),
}))

const { HumanQueue } = await import('./HumanQueue.js')

const project = (id: string) => ({ id, name: id, remote: 'github.com/me/project' })
const question = (projectId: string, run: string, words = 'Which way?'): WaitingItem => ({ kind: 'waiting', module: 'ask', scope: 'run', run, id: `${run}:q`, words: 'Needs answer', title: `Run ${run}`, detail: words, mark: 'question', projectId, projectName: projectId })
const request = (projectId: string, number: number): WaitingItem => ({
  kind: 'waiting',
  module: 'github',
  scope: 'project',
  id: `https://github.com/me/${projectId}/pull/${number}`,
  words: 'Needs merge',
  title: 'Opened by hand',
  detail: `#${number}`,
  mark: 'pull-request',
  fix: { label: `Open PR #${number}`, href: `https://github.com/me/${projectId}/pull/${number}` },
  projectId,
  projectName: projectId,
})

beforeEach(() => {
  shell.items = []
  shell.state = 'fresh'
})
afterEach(cleanup)

describe('the Human Queue', () => {
  test('lists what the shell read waits, in its order, each project named when there are several; a session with no project is listed too', () => {
    // A session with no project is of none of the projects the card is given: the sidebar lists its question, and so does the card.
    shell.items = [question('shop', 'r1'), request('blog', 7), { ...question('session', 'r9', 'Tea or coffee?'), projectName: '' }]
    const host = fakeHost('@openagt/ui-card-waiting')
    renderWithHost(<HumanQueue projects={[project('shop'), project('blog')]} />, host)
    expect(screen.getAllByRole('listitem').map(row => row.textContent)).toEqual(['Needs answerRun r1Which way?shop', 'Needs mergeOpened by hand#7blog', 'Needs answerRun r9Tea or coffee?'])
    // A row about a run opens it here; a request no run opened, on its git host.
    const [asked, opened] = screen.getAllByRole('link') as HTMLAnchorElement[]
    expect(asked!.getAttribute('href')).toBe('/shop/r1')
    act(() => asked!.click())
    expect(host.openAgent).toHaveBeenCalledWith('shop', 'r1')
    expect([opened!.getAttribute('href'), opened!.getAttribute('target')]).toEqual(['https://github.com/me/blog/pull/7', '_blank'])
  })

  test('says that nothing waits once it is read, and until then waits in a sentence’s room', () => {
    shell.state = 'unknown'
    const { rerender } = renderWithHost(<HumanQueue projects={[project('shop')]} />, fakeHost('@openagt/ui-card-waiting'))
    expect(screen.queryByText("AI doesn't need you.")).toBeNull()
    shell.state = 'fresh'
    rerender(<HumanQueue projects={[project('shop')]} />)
    expect(screen.getByText("AI doesn't need you.")).toBeTruthy()
  })

  test('says how many wait in all once it holds some back', () => {
    shell.items = Array.from({ length: 7 }, (_, at) => question('shop', `r${at}`))
    renderWithHost(<HumanQueue projects={[project('shop')]} />, fakeHost('@openagt/ui-card-waiting'))
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
    expect(screen.getByText('Show 2 more')).toBeTruthy()
    expect(screen.getByText('7')).toBeTruthy()
  })
})
