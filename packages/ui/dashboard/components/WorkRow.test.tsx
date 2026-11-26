import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'

const { WorkRow } = await import('./WorkRow.js')

afterEach(cleanup)

describe("a repo's row in the session's changes", () => {
  test('one line: the repo, its pull request\'s number, what it holds, and at its end its next step', () => {
    render(
      <>
        <WorkRow project name="test-project" branch="agent-fix-footer" summary={<span>+42 −7</span>} pr={{ number: 45, url: 'https://github.com/o/r/pull/45', state: 'OPEN', title: 'Fix the footer' }} actions={<button type="button">Merge PR</button>} />
        <WorkRow name="oa-newuser" branch="agent-fix-footer" summary={<span>+15 −3</span>} actions={<button type="button">Open PR</button>} error="Could not open the pull request." />
      </>,
    )
    const project = screen.getByRole('group', { name: 'test-project: its work' })
    expect(within(project).getByText('test-project')).toBeTruthy()
    expect(within(project).getByText('+42 −7')).toBeTruthy()
    expect(within(project).getByRole('link', { name: '#45' }).getAttribute('href')).toBe('https://github.com/o/r/pull/45')
    expect(within(project).getByRole('button', { name: 'Merge PR' })).toBeTruthy()
    const copy = screen.getByRole('group', { name: 'oa-newuser: its work' })
    expect(within(copy).queryByRole('link')).toBeNull()
    expect(within(copy).getByRole('button', { name: 'Open PR' })).toBeTruthy()
    expect(within(copy).getByRole('alert').textContent).toBe('Could not open the pull request.')
  })

  test("a pull request's mark is in its state's colour: open green, merged purple, closed red; a draft, or one not read yet, grey", () => {
    const tone = (state: string) => {
      const { container, unmount } = render(<WorkRow name="r" branch="b" pr={{ number: 1, url: 'u', state }} />)
      const mark = container.querySelector('svg')!.getAttribute('class')!
      unmount()
      return mark
    }
    expect(tone('OPEN')).toContain('text-success')
    expect(tone('MERGED')).toContain('text-merged')
    expect(tone('CLOSED')).toContain('text-danger')
    // GitHub could not be asked yet: no green that says it is open.
    expect(tone('UNKNOWN')).toContain('text-muted-foreground')
    expect(tone('DRAFT')).toContain('text-muted-foreground')
  })
})

test("a row's count opens its repo's changes: the project's, or the copy's own tab", async () => {
  const { OpenChanges } = await import('./WorkRow.js')
  const opened: (string | undefined)[] = []
  render(
    <OpenChanges.Provider value={repo => opened.push(repo)}>
      <WorkRow project name="test-project" branch="b" summary={<span>+1 −0</span>} />
      <WorkRow name="oa-newuser" branch="b" summary={<span>+3 −1</span>} />
    </OpenChanges.Provider>,
  )
  screen.getByRole('button', { name: 'test-project: its changes' }).click()
  screen.getByRole('button', { name: 'oa-newuser: its changes' }).click()
  expect(opened).toEqual([undefined, 'oa-newuser'])
})
