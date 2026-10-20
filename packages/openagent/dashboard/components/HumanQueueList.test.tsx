import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Intervention } from '../../src/index.js'
import { HumanQueueList, needsWord } from './HumanQueueList.js'

afterEach(cleanup)

const item = (over: Partial<Intervention>): Intervention => ({ projectId: 'p1', projectName: 'test-project', kind: 'pr', title: 't', ...over })

describe('the Human Queue\'s rows', () => {
  test('each row says what it needs, the run\'s name, then what it is about', () => {
    render(
      <HumanQueueList
        items={[
          item({ kind: 'awaiting', title: 'Interactive question', question: 'What kind of work?', agentId: 'r1', awaitId: 'q' }),
          item({ kind: 'uncommitted', title: 'Create test.md file', files: 1, agentId: 'r2' }),
          item({ kind: 'unpushed', title: 'AI essay', commits: 2, gitHost: true, agentId: 'r3' }),
          item({ kind: 'unpushed', title: 'Local only', commits: 1, gitHost: false, agentId: 'r4' }),
          item({ kind: 'pr', title: 'Add README sentence', number: 2, url: 'u2', agentId: 'r5' }),
        ]}
        onOpenAgent={() => {}}
      />,
    )
    const rows = screen.getAllByRole('listitem').map(row => row.textContent)
    expect(rows).toEqual([
      'Needs answerInteractive questionWhat kind of work?',
      'Needs commitCreate test.md file1 file',
      'Needs PRAI essay2 commits',
      'Needs pushLocal only1 commit',
      'Needs mergeAdd README sentence#2',
    ])
  })

  test('a row ends with how long ago, and an arrow to where it goes', () => {
    const since = new Date(Date.now() - 2 * 86_400_000).toISOString()
    render(<HumanQueueList items={[item({ kind: 'awaiting', title: 'Asks', question: 'q?', agentId: 'r1', awaitId: 'q', createdAt: since })]} onOpenAgent={() => {}} />)
    const row = screen.getByRole('listitem')
    expect(row.textContent).toBe('Needs answerAsksq?2d ago')
    expect(row.querySelector('.lucide-arrow-right')).toBeTruthy()
    expect(row.querySelector('.lucide-circle-help')).toBeTruthy()
  })

  test('the project is named only when the rows are of several projects', () => {
    const { rerender } = render(<HumanQueueList items={[item({ kind: 'uncommitted', agentId: 'r1' }), item({ kind: 'uncommitted', agentId: 'r2' })]} onOpenAgent={() => {}} />)
    expect(screen.queryByText('test-project')).toBeNull()
    rerender(<HumanQueueList items={[item({ kind: 'uncommitted', agentId: 'r1' }), item({ kind: 'uncommitted', agentId: 'r2', projectId: 'p2', projectName: 'shop' })]} onOpenAgent={() => {}} />)
    expect(screen.getByText('test-project')).toBeTruthy()
    expect(screen.getByText('shop')).toBeTruthy()
  })

  test('the words are one rule, for every list that shows these rows', () => {
    expect(['awaiting', 'uncommitted', 'unpushed', 'pr'].map(kind => needsWord(kind as Intervention['kind']))).toEqual(['Needs answer', 'Needs commit', 'Needs PR', 'Needs merge'])
    expect(needsWord('unpushed', false)).toBe('Needs push')
  })

  test('the first five show, and a line offers the rest, and then fewer again', () => {
    const items = Array.from({ length: 8 }, (_, i) => item({ kind: 'uncommitted', title: `run ${i}`, agentId: `r${i}` }))
    render(<HumanQueueList items={items} onOpenAgent={() => {}} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
    fireEvent.click(screen.getByRole('button', { name: 'Show 3 more' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(8)
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
  })

  test('five or fewer: no line offers more', () => {
    render(<HumanQueueList items={[item({ kind: 'uncommitted', agentId: 'r1' })]} onOpenAgent={() => {}} />)
    expect(screen.queryByRole('button', { name: /more|fewer/ })).toBeNull()
  })

  test('a row opens the session it is about; a request opened elsewhere opens on the git host', () => {
    const onOpenAgent = vi.fn()
    render(
      <HumanQueueList
        items={[
          item({ kind: 'awaiting', title: 'Asks', question: 'q?', agentId: 'r1', awaitId: 'q' }),
          item({ number: 6, title: 'Opened by a run', url: 'https://x/pull/6', agentId: 'r6' }),
          item({ number: 8, title: 'Opened by hand', url: 'https://x/pull/8' }),
        ]}
        onOpenAgent={onOpenAgent}
      />,
    )
    fireEvent.click(screen.getByText('Asks'))
    fireEvent.click(screen.getByText('Opened by a run'))
    expect(onOpenAgent.mock.calls).toEqual([['p1', 'r1'], ['p1', 'r6']])
    expect(screen.getByText('Opened by hand').closest('a')?.getAttribute('href')).toBe('https://x/pull/8')
  })
})
