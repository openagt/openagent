import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Waiting } from '../../src/index.js'
import { WaitingList, holdsBack } from './WaitingList.js'

afterEach(cleanup)

// What waits on the person, as the modules say it (`app.attention`'s `waiting` items), in the project p1.
const item = (over: Partial<Waiting>): Waiting => ({ kind: 'waiting', module: 'github', scope: 'project', words: 'Needs merge', projectId: 'p1', projectName: 'test-project', title: 't', ...over })
const asks = (run: string, title: string, question: string, over: Partial<Waiting> = {}) => item({ module: 'ask', scope: 'run', run, id: `${run}:q`, words: 'Needs answer', title, detail: question, mark: 'question', ...over })
const uncommitted = (run: string, title = 't', files?: number) => item({ module: 'git-branches', scope: 'run', run, id: `uncommitted:${run}`, words: 'Needs commit', title, ...(files ? { detail: files === 1 ? '1 file' : `${files} files` } : {}), mark: 'changes' })
const unpushed = (run: string, title: string, commits: number) =>
  item({ module: 'git-branches', scope: 'run', run, id: `unpushed:${run}`, words: 'Needs push', title, detail: commits === 1 ? '1 commit' : `${commits} commits`, mark: 'branch' })
const request = (number: number, title: string, url: string, run?: string) =>
  item({ module: 'github', ...(run ? { scope: 'run' as const, run } : {}), id: url, words: 'Needs merge', title, detail: `#${number}`, mark: 'pull-request', fix: { label: `Open PR #${number}`, href: url } })

describe('the rows of what waits on the person', () => {
  test('each row says what it needs, the run\'s name, then what it is about', () => {
    render(
      <WaitingList
        items={[
          asks('r1', 'Interactive question', 'What kind of work?'),
          uncommitted('r2', 'Create test.md file', 1),
          unpushed('r3', 'AI essay', 2),
          unpushed('r4', 'Local only', 1),
          request(2, 'Add README sentence', 'u2', 'r5'),
        ]}
        onOpenAgent={() => {}}
      />,
    )
    // Each row's link says what is needed first, as the row shows it, so the keyboard meets it there.
    const links = screen.getAllByRole('link').map(link => link.textContent)
    expect(links).toEqual([
      'Needs answerInteractive questionWhat kind of work?',
      'Needs commitCreate test.md file1 file',
      'Needs pushAI essay2 commits',
      'Needs pushLocal only1 commit',
      'Needs mergeAdd README sentence#2',
    ])
    // Each row's mark is the sidebar's waiting hexagon, pulsing, in the colour of what it needs; the words are quiet.
    const marks = screen.getAllByRole('listitem').map(row => row.querySelector('svg')!.getAttribute('class')!)
    expect(marks.map(mark => ['text-warning', 'text-info', 'text-success'].find(tone => mark.split(' ').includes(tone)))).toEqual(['text-warning', 'text-info', 'text-info', 'text-info', 'text-success'])
    for (const mark of marks) expect(mark).toContain('motion-safe:animate-pulse')
    expect(screen.getByText('Needs merge').className).toContain('text-muted-foreground')
    // A request to merge has its mark after the name, as a sidebar row has it; no other row has one.
    const rows = screen.getAllByRole('listitem')
    expect(rows.map(row => row.querySelector('.lucide-git-pull-request') !== null)).toEqual([false, false, false, false, true])
    expect(screen.getByText('Add README sentence').nextElementSibling!.getAttribute('class')).toContain('lucide-git-pull-request')
  })

  test('a row is one line that ends with how long ago and an arrow to where it goes', () => {
    const since = new Date(Date.now() - 2 * 86_400_000).toISOString()
    render(<WaitingList items={[asks('r1', 'Asks', 'q?', { since })]} onOpenAgent={() => {}} />)
    const row = screen.getByRole('listitem')
    expect(row.textContent).toBe('Needs answerAsksq?2d ago')
    expect(row.querySelector('.lucide-arrow-right')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    // No rule between rows and no panel around them.
    expect(row.closest('ul')!.parentElement!.className).not.toMatch(/border|rounded-lg|bg-card/)
  })

  test('nothing waits: nothing, unless the place says so in a sentence', () => {
    const { container, rerender } = render(<WaitingList items={[]} onOpenAgent={() => {}} />)
    expect(container.innerHTML).toBe('')
    rerender(<WaitingList items={[]} onOpenAgent={() => {}} empty="Nothing waits." />)
    expect(container.textContent).toBe('Nothing waits.')
  })

  test('the project is named only when the rows are of several projects', () => {
    const { rerender } = render(<WaitingList items={[uncommitted('r1'), uncommitted('r2')]} onOpenAgent={() => {}} />)
    expect(screen.queryByText('test-project')).toBeNull()
    rerender(<WaitingList items={[uncommitted('r1'), { ...uncommitted('r2'), projectId: 'p2', projectName: 'shop' }]} onOpenAgent={() => {}} />)
    expect(screen.getByText('test-project')).toBeTruthy()
    expect(screen.getByText('shop')).toBeTruthy()
  })

  test("an item that names no mark has the waiting hexagon in the waiting colour; one about no run and with no page to open says what waits, and is no press", () => {
    render(<WaitingList items={[item({ module: 'tickets', id: 't1', words: 'Needs triage', title: 'Three new tickets' })]} onOpenAgent={() => {}} />)
    const row = screen.getByRole('listitem')
    expect(row.textContent).toBe('Needs triageThree new tickets')
    expect(row.querySelector('svg')!.getAttribute('class')!.split(' ')).toContain('text-warning')
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  test('the first five show, and a line offers the rest, and then fewer again', () => {
    const items = Array.from({ length: 8 }, (_, i) => uncommitted(`r${i}`, `run ${i}`))
    render(<WaitingList items={items} onOpenAgent={() => {}} />)
    expect(holdsBack(items)).toBe(true)
    // Five rows, and the line under them offers the rest.
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
    fireEvent.click(screen.getByRole('button', { name: 'Show 3 more' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(8)
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
  })

  test('six: the sixth shows too, since a line offering one more is as tall as the row it hides', () => {
    const items = Array.from({ length: 6 }, (_, i) => uncommitted(`r${i}`, `run ${i}`))
    render(<WaitingList items={items} onOpenAgent={() => {}} />)
    expect(holdsBack(items)).toBe(false)
    expect(screen.getAllByRole('listitem')).toHaveLength(6)
    expect(screen.queryByRole('button', { name: /more|fewer/ })).toBeNull()
  })

  test('five or fewer: no line offers more', () => {
    render(<WaitingList items={[uncommitted('r1')]} onOpenAgent={() => {}} />)
    expect(screen.queryByRole('button', { name: /more|fewer/ })).toBeNull()
  })

  test('a row opens the session it is about; a request opened elsewhere opens on the git host', () => {
    const onOpenAgent = vi.fn()
    render(
      <WaitingList
        items={[
          asks('r1', 'Asks', 'q?'),
          request(6, 'Opened by a run', 'https://x/pull/6', 'r6'),
          request(8, 'Opened by hand', 'https://x/pull/8'),
        ]}
        onOpenAgent={onOpenAgent}
      />,
    )
    fireEvent.click(screen.getByText('Asks'))
    fireEvent.click(screen.getByText('Opened by a run'))
    expect(onOpenAgent.mock.calls).toEqual([['p1', 'r1'], ['p1', 'r6']])
    expect(screen.getByText('Opened by hand').closest('a')?.getAttribute('href')).toBe('https://x/pull/8')
  })

  test('a row is a link to its session: a Ctrl+click or a middle click is the browser\'s, for a new tab', () => {
    const onOpenAgent = vi.fn()
    render(<WaitingList items={[asks('r1', 'Asks', 'q?')]} onOpenAgent={onOpenAgent} />)
    const row = screen.getByText('Asks').closest('a')!
    expect(row.getAttribute('href')).toBe('/p1/r1')
    expect(fireEvent.click(row, { ctrlKey: true })).toBe(true)
    expect(fireEvent.click(row, { button: 1 })).toBe(true)
    expect(onOpenAgent).not.toHaveBeenCalled()
  })
})
