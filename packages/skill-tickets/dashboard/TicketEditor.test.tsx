import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { openMenu } from '../../dashboard/dashboard/test-utils.js'
import { fakeHost, renderWithHost } from './test-host.js'
import { NewTicketPage } from './NewTicketPage.js'
import { TicketDetailPage } from './TicketDetailPage.js'

afterEach(cleanup)

const now = new Date()
const TODAY = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

describe('a ticket written by hand', () => {
  test('a new ticket is saved with put, named by today and its title, never over one already there, and opened', async () => {
    const host = fakeHost({ p1: { 'list --local': [{ file: `${TODAY}_dark-mode.md`, title: 'Dark mode', summary: '', date: TODAY, planned: false }] } })
    host.act.mockImplementation(async () => ({ ok: true, output: { ok: true } }))
    renderWithHost(<NewTicketPage projectId="p1" />, host)
    type('Title', 'Dark mode')
    type('Priority', '3')
    type('Topics', 'UI, ux')
    type('Text', 'A toggle in the header.')
    fireEvent.click(screen.getByRole('button', { name: 'Create ticket' }))
    const file = `${TODAY}_dark-mode-2.md`
    await waitFor(() => expect(host.act).toHaveBeenCalledWith('p1', ['put', file], undefined, 'Priority: 3\nTopics: [ui, ux]\n\n# Dark mode\n\nA toggle in the header.\n'))
    await waitFor(() => expect(host.openPage).toHaveBeenCalledWith('tickets', [file], 'p1'))
  })

  test('no title, or a priority outside 0–10, is not saved', async () => {
    const host = fakeHost()
    renderWithHost(<NewTicketPage projectId="p1" />, host)
    const create = screen.getByRole('button', { name: 'Create ticket' }) as HTMLButtonElement
    expect(create.disabled).toBe(true)
    type('Title', 'Dark mode')
    expect(create.disabled).toBe(false)
    type('Priority', '11')
    expect(create.disabled).toBe(true)
    expect(screen.getByText(/whole number from 0 to 10/)).toBeTruthy()
  })

  test('a refused save says why and stays on the form', async () => {
    const host = fakeHost({ p1: { 'list --local': [] } })
    host.act.mockImplementation(async () => ({ ok: true, output: { ok: false, reason: 'the push was refused' } }))
    renderWithHost(<NewTicketPage projectId="p1" />, host)
    type('Title', 'Dark mode')
    fireEvent.click(screen.getByRole('button', { name: 'Create ticket' }))
    expect(await screen.findByText(/Not saved: the push was refused/)).toBeTruthy()
    expect(host.openPage).not.toHaveBeenCalled()
  })

  test('an edit saves the whole ticket again, keeping the issue line, and says the issue may write it again', async () => {
    const slug = '2026-07-20_do-the-thing.md'
    const content = 'Priority: 8\nIssue: [#12](https://example.com/issues/12)\n\n# Do the thing\n\nThe thing is not done.\n'
    const ticket = { file: slug, title: 'Do the thing', summary: '', date: '2026-07-20', planned: false, priority: '8', issue: { label: '#12', url: 'https://example.com/issues/12' }, content }
    const host = fakeHost({ p1: { [`show ${slug} --local`]: { ok: true, ticket } } })
    host.act.mockImplementation(async () => ({ ok: true, output: { ok: true } }))
    renderWithHost(<TicketDetailPage projectId="p1" slug={slug} />, host)
    await openMenu(await screen.findByRole('button', { name: 'More' }))
    fireEvent.click(await screen.findByText('Edit ticket'))
    expect(screen.getByText(/follows issue #12/)).toBeTruthy()
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Do the thing')
    type('Text', 'The thing is half done.')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(host.act).toHaveBeenCalledWith('p1', ['put', slug], undefined, 'Priority: 8\nIssue: [#12](https://example.com/issues/12)\n\n# Do the thing\n\nThe thing is half done.\n'),
    )
    // Saved, the page shows the ticket again.
    expect(await screen.findByRole('tab', { name: 'Ticket' })).toBeTruthy()
  })
})
