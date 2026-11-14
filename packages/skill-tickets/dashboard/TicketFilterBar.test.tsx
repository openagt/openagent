import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { WorkspaceTicket } from './lib/types.js'
import { defaultView, type TicketRow, type TicketsView } from './lib/ticket-filter.js'
import { TicketFilterBar } from './TicketFilterBar.js'

const row = (file: string, over: Partial<WorkspaceTicket> = {}, projectId = 'p1'): TicketRow => ({
  projectId,
  projectName: projectId === 'p1' ? 'Alpha' : 'Beta',
  ticket: { file, title: file, summary: '', date: '2026-01-01T00:00:00.000Z', planned: false, ...over },
})

const renderBar = (rows: TicketRow[], view: TicketsView = defaultView()) => {
  const onChange = vi.fn()
  render(<TicketFilterBar view={view} rows={rows} onChange={onChange} />)
  return { onChange }
}

afterEach(cleanup)

describe('TicketFilterBar (#1144)', () => {
  test('the priority facet offers buckets with counts, a range slider, and "No priority" when real', async () => {
    const { onChange } = renderBar([row('a.md', { priority: '9' }), row('b.md', { priority: '4' }), row('c.md')])
    fireEvent.click(screen.getByRole('button', { name: /priority/i }))
    // Counts ride each option, so a pick's yield is visible before it is made.
    const critical = await screen.findByLabelText('Critical (8–10)')
    expect(screen.getByText('Critical (8–10)').parentElement?.textContent).toContain('1')
    fireEvent.click(critical)
    expect(onChange).toHaveBeenCalled()
    const next = onChange.mock.calls[0]![0] as TicketsView
    expect(next.filters.priority.buckets).toEqual(['critical'])
    // The fine-grained slider sits under the buckets (#1144: bucket + slider + none).
    expect(screen.getByText(/range: any/i)).toBeTruthy()
    expect(screen.getByLabelText('No priority')).toBeTruthy()
  })

  test('"No priority" hides when every ticket names one', () => {
    renderBar([row('a.md', { priority: '9' })])
    fireEvent.click(screen.getByRole('button', { name: /priority/i }))
    expect(screen.queryByLabelText('No priority')).toBeNull()
  })

  test('the effort and uncertainty facets only exist once some plan recorded the numbers', () => {
    renderBar([row('a.md')])
    expect(screen.queryByRole('button', { name: /effort/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /uncertainty/i })).toBeNull()
    cleanup()
    renderBar([row('a.md', { effort: 2, uncertainty: 7 })])
    expect(screen.getByRole('button', { name: /effort/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /uncertainty/i })).toBeTruthy()
  })

  test('the topics facet lists case-deduped topics with counts, busiest first', async () => {
    const { onChange } = renderBar([row('a.md', { topics: ['UX'] }), row('b.md', { topics: ['ux', 'dx'] })])
    fireEvent.click(screen.getByRole('button', { name: /topics/i }))
    fireEvent.click(await screen.findByLabelText('ux'))
    const next = onChange.mock.calls[0]![0] as TicketsView
    expect(next.filters.topics).toEqual(['ux'])
  })

  test('the stage facet counts claimed as the lock, composing with planned', async () => {
    renderBar([row('a.md', { planned: true, locked: true }), row('b.md')])
    fireEvent.click(screen.getByRole('button', { name: /stage/i }))
    const claimed = (await screen.findByText('Claimed')).parentElement
    expect(claimed?.textContent).toContain('1')
  })

  test('Clear appears once anything is active and resets the filters, keeping sort/group', () => {
    const view = defaultView()
    view.filters.q = 'lock'
    view.sort = { key: 'priority', dir: 'desc' }
    const { onChange } = renderBar([row('a.md')], view)
    fireEvent.click(screen.getByRole('button', { name: /clear/i }))
    const next = onChange.mock.calls[0]![0] as TicketsView
    expect(next.filters).toEqual(defaultView().filters)
    expect(next.sort).toEqual({ key: 'priority', dir: 'desc' })
  })

  test('picking a new sort key starts at its natural direction; the active key is a no-op', async () => {
    const { onChange } = renderBar([row('a.md')])
    fireEvent.click(screen.getByRole('button', { name: /sort: date/i }))
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Priority' }))
    expect((onChange.mock.calls[0]![0] as TicketsView).sort).toEqual({ key: 'priority', dir: 'desc' })
    onChange.mockClear()
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Date' }))
    expect(onChange).not.toHaveBeenCalled()
  })

  test('the asc/desc pair sits in the menu, labeled by meaning, the applied one checked', async () => {
    const { onChange } = renderBar([row('a.md')])
    fireEvent.click(screen.getByRole('button', { name: /sort: date/i }))
    const desc = await screen.findByRole('menuitemcheckbox', { name: 'Newest first' })
    expect(desc.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Oldest first' }))
    expect((onChange.mock.calls[0]![0] as TicketsView).sort).toEqual({ key: 'date', dir: 'asc' })
  })

  test('a contiguous bucket selection mirrors onto the slider instead of dimming it', async () => {
    const view = defaultView()
    view.filters.priority = { buckets: ['critical', 'medium'], range: null, none: false }
    renderBar([row('a.md', { priority: '9' })], view)
    fireEvent.click(screen.getByRole('button', { name: /priority/i }))
    await screen.findByLabelText('Critical (8–10)')
    expect(document.querySelector('[data-dimmed]')).toBeNull()
    // Adjacent buckets are one span, so the readout (and the thumbs) sit on the union.
    expect(screen.getByText(/range: 5–10/i)).toBeTruthy()
  })

  test('only a selection no single range can express dims the slider', async () => {
    const view = defaultView()
    view.filters.priority = { buckets: ['critical', 'low'], range: null, none: false }
    renderBar([row('a.md', { priority: '9' })], view)
    fireEvent.click(screen.getByRole('button', { name: /priority/i }))
    await screen.findByLabelText('Critical (8–10)')
    expect(document.querySelector('[data-dimmed]')).toBeTruthy()
    expect(screen.getByText(/range: not one span/i)).toBeTruthy()
  })

  test('the "/" keycap chip steps aside once the search field is focused', () => {
    renderBar([row('a.md')])
    expect(screen.getByText('/')).toBeTruthy()
    fireEvent.focus(screen.getByRole('textbox', { name: /search tickets/i }))
    expect(screen.queryByText('/')).toBeNull()
  })

  test('"Group by project" unticks into the flat list', async () => {
    const { onChange } = renderBar([row('a.md')])
    fireEvent.click(screen.getByRole('button', { name: /sort: date/i }))
    fireEvent.click(await screen.findByText('Group by project'))
    const next = onChange.mock.calls[0]![0] as TicketsView
    expect(next.group).toBe('none')
  })

  test('"/" focuses the search field unless something is already being typed into', () => {
    renderBar([row('a.md')])
    const search = screen.getByRole('textbox', { name: /search tickets/i })
    fireEvent.keyDown(window, { key: '/' })
    expect(document.activeElement).toBe(search)
  })
})
