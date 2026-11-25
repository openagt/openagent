import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'

const { AgentWorkPanel, WorkRow } = await import('./AgentWorkPanel.js')

afterEach(cleanup)

describe('the session\'s work panel', () => {
  test('a row says the repo, and under it its branch, what it holds and its pull request; its next step stands at its end', () => {
    render(
      <AgentWorkPanel>
        <WorkRow project name="test-project" branch="agent-fix-footer" summary={<span>+42 −7</span>} pr={{ number: 45, url: 'https://github.com/o/r/pull/45', state: 'OPEN', title: 'Fix the footer' }} actions={<button type="button">Merge PR</button>} />
        <WorkRow name="oa-newuser" branch="agent-fix-footer" summary={<span>+15 −3</span>} actions={<button type="button">Open PR</button>} error="Could not open the pull request." />
      </AgentWorkPanel>,
    )
    const panel = screen.getByRole('group', { name: "This session's work" })
    const [project, copy] = within(panel).getAllByRole('listitem')
    expect(project!.getAttribute('aria-label')).toBe('test-project: its work')
    expect(within(project!).getByText('test-project')).toBeTruthy()
    expect(within(project!).getByText('+42 −7')).toBeTruthy()
    expect(within(project!).getByRole('link', { name: /PR #45/ }).getAttribute('href')).toBe('https://github.com/o/r/pull/45')
    expect(within(project!).getByRole('button', { name: 'Merge PR' })).toBeTruthy()
    expect(within(copy!).getByText('oa-newuser')).toBeTruthy()
    expect(within(copy!).queryByRole('link')).toBeNull()
    expect(within(copy!).getByRole('button', { name: 'Open PR' })).toBeTruthy()
    expect(within(copy!).getByRole('alert').textContent).toBe('Could not open the pull request.')
  })

  test('with no row the panel holds nothing', () => {
    render(<AgentWorkPanel>{null}</AgentWorkPanel>)
    expect(screen.getByRole('group', { name: "This session's work" }).querySelector('ul')!.childElementCount).toBe(0)
  })
})
