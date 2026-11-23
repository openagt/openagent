import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ProjectSummary } from '../../src/index.js'
import { ContextMenu } from './ContextMenu.js'

afterEach(cleanup)

const proj = (id: string, name: string, path: string) => ({ id, name, path }) as ProjectSummary
const others = [proj('a', 'api', '/w/api'), proj('b', 'ui', '/w/ui')]

function open(over: Partial<Parameters<typeof ContextMenu>[0]> = {}) {
  const onToggle = vi.fn()
  render(
    <ContextMenu
      otherProjects={others}
      context={new Set(['/w/api'])}
      contextFiles={[]}
      summary=""
      busy={false}
      onToggle={onToggle}
      {...over}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: /Context/ }))
  return { onToggle }
}

// #1046: the Context picker moved from an inline disclosure to a dropdown, now beside the gear in the row under the box.
describe('ContextMenu (#1046)', () => {
  test('lists the other repos and reflects which are already in context', () => {
    open()
    const api = screen.getByRole('menuitemcheckbox', { name: 'api' })
    const ui = screen.getByRole('menuitemcheckbox', { name: 'ui' })
    expect(api.getAttribute('aria-checked')).toBe('true')
    expect(ui.getAttribute('aria-checked')).toBe('false')
  })

  test('toggling a repo reports its path', () => {
    const { onToggle } = open()
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'ui' }))
    expect(onToggle).toHaveBeenCalledWith('/w/ui')
  })

  test('the trigger carries the summary', () => {
    render(
      <ContextMenu otherProjects={others} context={new Set()} contextFiles={[]} summary="2 projects" busy={false} onToggle={() => {}} />,
    )
    const trigger = screen.getByRole('button', { name: 'Context: 2 projects' })
    expect(trigger.textContent).toBe('Context · 2 projects')
  })

  test('with nothing picked the trigger is named "Context", and its word is drawn at every width, a narrow box too', () => {
    render(<ContextMenu otherProjects={others} context={new Set()} contextFiles={[]} summary="" busy={false} onToggle={() => {}} />)
    const trigger = screen.getByRole('button', { name: 'Context' })
    expect(trigger.textContent).toBe('Context')
    expect(trigger.querySelector('svg')).toBeTruthy()
    expect(trigger.innerHTML).not.toContain('sr-only')
  })

  test('shows picked files, removable, and the empty hint otherwise', () => {
    const onToggle = vi.fn()
    open({ contextFiles: ['DECISIONS.md'], onToggle })
    expect(screen.getByText('DECISIONS.md')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Remove DECISIONS\.md/ }))
    expect(onToggle).toHaveBeenCalledWith('DECISIONS.md')
  })

  test('empty Files hint when nothing is picked', () => {
    open()
    expect(screen.getByText(/None yet/)).toBeTruthy()
  })
})
