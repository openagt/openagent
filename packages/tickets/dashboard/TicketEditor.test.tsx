import { afterEach, describe, expect, test } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { openMenu } from '../../ui/dashboard/test-utils.js'
import { fakeHost, renderWithHost } from './test-host.js'
import { NewTicketPage } from './NewTicketPage.js'
import { TicketDetailPage } from './TicketDetailPage.js'

afterEach(cleanup)

const now = new Date()
const TODAY = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

describe('a ticket written by hand', () => {
  test('a new ticket is saved with put, named by today and its title, never over one already there, and opened', async () => {
    const host = fakeHost({ p1: { list: [{ file: `${TODAY}_dark-mode.md`, title: 'Dark mode', summary: '', date: TODAY, planned: false }] } })
    host.act.mockImplementation(async () => ({ ok: true, output: { ok: true } }))
    renderWithHost(<NewTicketPage projectId="p1" />, host)
    type('Title', 'Dark mode')
    type('Priority', '3')
    type('Topics', 'UI, ux')
    type('Text', 'A toggle in the header.')
    fireEvent.click(screen.getByRole('button', { name: 'Create ticket' }))
    const file = `${TODAY}_dark-mode-2.md`
    await waitFor(() => expect(host.act).toHaveBeenCalledWith('p1', ['put', file], undefined, 'Priority: 3\nTopics: [ui, ux]\n\n# Dark mode\n\nA toggle in the header.\n'))
    // In the form's place in the history: Back from it goes where New ticket was pressed, not to an empty form.
    await waitFor(() => expect(host.adjustPage).toHaveBeenCalledWith([file]))
  })

  test("Cancel goes back to the list by the dashboard's return, which is the browser's Back when the list opened the form", () => {
    const host = fakeHost()
    renderWithHost(<NewTicketPage projectId="p1" />, host)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(host.backToPage).toHaveBeenCalledWith('tickets')
    expect(host.openPage).not.toHaveBeenCalled()
  })

  test('no title, or a priority outside 0–10, is not saved: Create ticket says why where it is, and takes the keyboard there', async () => {
    const host = fakeHost()
    renderWithHost(<NewTicketPage projectId="p1" />, host)
    const create = screen.getByRole('button', { name: 'Create ticket' })
    expect(screen.queryByText('Give the ticket a title.')).toBeNull()
    // Pressed with no title, it says why, and the caret is in Title.
    screen.getByLabelText('Topics').focus()
    fireEvent.click(create)
    const title = screen.getByLabelText('Title')
    expect(document.activeElement).toBe(title)
    expect(title.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(title.getAttribute('aria-describedby')!)?.textContent).toBe('Give the ticket a title.')
    expect(host.act).not.toHaveBeenCalled()
    type('Title', 'Dark mode')
    expect(screen.queryByText('Give the ticket a title.')).toBeNull()
    type('Priority', '11')
    expect(screen.getByText(/whole number from 0 to 10/)).toBeTruthy()
    fireEvent.click(create)
    expect(document.activeElement).toBe(screen.getByLabelText('Priority'))
    expect(host.act).not.toHaveBeenCalled()
    // The field is marked wrong, and says why to whoever is on it.
    const field = screen.getByLabelText('Priority')
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(field.getAttribute('aria-describedby') && document.getElementById(field.getAttribute('aria-describedby')!)?.textContent).toBe('Priority is a whole number from 0 to 10, or empty for none.')
  })

  test('after Save, and on the page of a ticket just created, the focus is on the ticket\'s title', async () => {
    const slug = '2026-07-20_do-the-thing.md'
    const ticket = { file: slug, title: 'Do the thing', summary: '', date: '2026-07-20', planned: false, content: '# Do the thing\n' }
    const host = fakeHost({ p1: { [`show ${slug}`]: { ticket }, list: [] } })
    host.act.mockImplementation(async () => ({ ok: true, output: { ok: true } }))
    renderWithHost(<TicketDetailPage projectId="p1" slug={slug} />, host)
    await openMenu(await screen.findByRole('button', { name: 'More' }))
    fireEvent.click(await screen.findByText('Edit ticket'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Do the thing' })))
    cleanup()
    renderWithHost(<NewTicketPage projectId="p1" />, host)
    type('Title', 'Dark mode')
    fireEvent.click(screen.getByRole('button', { name: 'Create ticket' }))
    await waitFor(() => expect(host.adjustPage).toHaveBeenCalled())
    cleanup()
    const created = { ...ticket, file: `${TODAY}_dark-mode.md`, title: 'Dark mode', content: '# Dark mode\n' }
    renderWithHost(<TicketDetailPage projectId="p1" slug={created.file} />, fakeHost({ p1: { [`show ${created.file}`]: { ticket: created } } }))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Dark mode' })))
  })

  test('after Save, the page shows the ticket as saved from the moment the form closes', async () => {
    const slug = '2026-07-20_rate-limit.md'
    const ticket = { file: slug, title: 'Rate limit', summary: '', date: '2026-07-20', planned: false, priority: '3', content: 'Priority: 3\n\n# Rate limit\n' }
    const host = fakeHost({ p1: { [`show ${slug}`]: { ticket } } })
    // Saved, the ticket reads as saved, once the test lets that read land.
    let land = () => {}
    const landed = new Promise<void>(resolve => (land = resolve))
    host.act.mockImplementation(async () => {
      host.call.mockImplementation(async () => {
        await landed
        return { ok: true, output: { ticket: { ...ticket, priority: '5', content: 'Priority: 5\n\n# Rate limit\n' } } }
      })
      return { ok: true, output: { ok: true } }
    })
    renderWithHost(<TicketDetailPage projectId="p1" slug={slug} />, host)
    await openMenu(await screen.findByRole('button', { name: 'More' }))
    fireEvent.click(await screen.findByText('Edit ticket'))
    type('Priority', '5')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(host.act).toHaveBeenCalled())
    await act(() => new Promise(resolve => setTimeout(resolve, 50)))
    // The look says a priority as "P3", under the title and at the side.
    expect(screen.queryAllByText('P3')).toEqual([])
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeTruthy()
    land()
    expect((await screen.findAllByText('P5')).length).toBeGreaterThan(0)
    expect(screen.queryByRole('heading', { name: 'Edit ticket' })).toBeNull()
  })

  test('what a waiting ticket waits on is in its edit, and emptied, the wait is over: the line is gone, the rest kept', async () => {
    const slug = '2026-07-20_checkout.md'
    const content = 'Priority: 9\nWaiting: the design review\nIssue: [#4](https://example.com/issues/4)\n\n# Checkout\n'
    const ticket = { file: slug, title: 'Checkout', summary: '', date: '2026-07-20', planned: false, priority: '9', waiting: 'the design review', issue: { label: '#4', url: 'https://example.com/issues/4' }, content }
    const host = fakeHost({ p1: { [`show ${slug}`]: { ticket } } })
    host.act.mockImplementation(async () => ({ ok: true, output: { ok: true } }))
    renderWithHost(<TicketDetailPage projectId="p1" slug={slug} />, host)
    await openMenu(await screen.findByRole('button', { name: 'More' }))
    fireEvent.click(await screen.findByText('Edit ticket'))
    expect((screen.getByLabelText('Waiting on') as HTMLInputElement).value).toBe('the design review')
    type('Waiting on', '')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(host.act).toHaveBeenCalledWith('p1', ['put', slug], undefined, 'Priority: 9\nIssue: [#4](https://example.com/issues/4)\n\n# Checkout\n'))
  })

  test('Ctrl+Enter or ⌘+Enter in the text saves, as the press does; Enter alone is a new line', async () => {
    const host = fakeHost({ p1: { list: [] } })
    host.act.mockImplementation(async () => ({ ok: true, output: { ok: true } }))
    renderWithHost(<NewTicketPage projectId="p1" />, host)
    type('Title', 'Dark mode')
    const text = screen.getByLabelText('Text')
    fireEvent.keyDown(text, { key: 'Enter' })
    expect(host.act).not.toHaveBeenCalled()
    fireEvent.keyDown(text, { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(host.act).toHaveBeenCalledTimes(1))
    cleanup()
    renderWithHost(<NewTicketPage projectId="p1" />, host)
    type('Title', 'Light mode')
    fireEvent.keyDown(screen.getByLabelText('Text'), { key: 'Enter', metaKey: true })
    await waitFor(() => expect(host.act).toHaveBeenCalledTimes(2))
  })

  test('a refused save says why and stays on the form', async () => {
    const host = fakeHost({ p1: { list: [] } })
    host.act.mockImplementation(async () => ({ ok: true, output: { ok: false, reason: 'the push was refused' } }))
    renderWithHost(<NewTicketPage projectId="p1" />, host)
    type('Title', 'Dark mode')
    fireEvent.click(screen.getByRole('button', { name: 'Create ticket' }))
    expect(await screen.findByText(/Not saved: the push was refused/)).toBeTruthy()
    expect(host.adjustPage).not.toHaveBeenCalled()
  })

  test('an edit saves the whole ticket again, keeping the issue line, and says the issue may write it again', async () => {
    const slug = '2026-07-20_do-the-thing.md'
    const content = 'Priority: 8\nIssue: [#12](https://example.com/issues/12)\n\n# Do the thing\n\nThe thing is not done.\n'
    const ticket = { file: slug, title: 'Do the thing', summary: '', date: '2026-07-20', planned: false, priority: '8', issue: { label: '#12', url: 'https://example.com/issues/12' }, content }
    const host = fakeHost({ p1: { [`show ${slug}`]: { ticket } } })
    host.act.mockImplementation(async () => ({ ok: true, output: { ok: true } }))
    renderWithHost(<TicketDetailPage projectId="p1" slug={slug} />, host)
    await openMenu(await screen.findByRole('button', { name: 'More' }))
    fireEvent.click(await screen.findByText('Edit ticket'))
    // The issue may write the title and the text again: each of the two fields says so.
    const note = screen.getByText(/follows issue #12/)
    for (const field of ['Title', 'Text']) expect(screen.getByLabelText(field).getAttribute('aria-describedby')).toBe(note.id)
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
