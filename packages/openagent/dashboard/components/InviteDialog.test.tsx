import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { InviteDialog, type InviteAnswer } from './InviteDialog.js'

const code = (url: string): InviteAnswer => ({ ok: true, value: { url, expires: new Date(Date.now() + 5 * 60_000).toISOString() } })

afterEach(cleanup)

describe('InviteDialog', () => {
  test('asks for a code as it opens, once, and shows it as a QR code and a link that copies', async () => {
    const ask = vi.fn(async () => code('https://203.0.113.5/_devices/enter#one'))
    const onCode = vi.fn()
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<InviteDialog title="Invite" ask={ask} scan="Scan it." onCode={onCode} onClose={vi.fn()} />)
    expect(screen.getByText('Asking for a code…')).toBeTruthy()
    await screen.findByRole('img', { name: 'The code a new device scans' })
    expect(ask).toHaveBeenCalledTimes(1)
    expect(onCode).toHaveBeenLastCalledWith(expect.objectContaining({ url: 'https://203.0.113.5/_devices/enter#one' }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://203.0.113.5/_devices/enter#one'))
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy()
  })

  test('the name of a device that got in takes the code\'s place; Add another asks anew, and an answer to an older ask is no code', async () => {
    let answer: (value: InviteAnswer) => void = () => {}
    const ask = vi.fn(() => new Promise<InviteAnswer>(resolve => (answer = resolve)))
    const onCode = vi.fn()
    const { rerender, unmount } = render(<InviteDialog title="Invite" ask={ask} scan="Scan it." onCode={onCode} onClose={vi.fn()} />)
    answer(code('https://a/#first'))
    await screen.findByRole('img', { name: 'The code a new device scans' })
    rerender(<InviteDialog title="Invite" ask={ask} scan="Scan it." joined="iPhone, Safari" onCode={onCode} onClose={vi.fn()} />)
    expect(screen.getByText('iPhone, Safari is in.')).toBeTruthy()
    expect(screen.queryByRole('img', { name: 'The code a new device scans' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Add another' }))
    // The page forgets who got in once it is told a new code is asked for.
    expect(onCode).toHaveBeenLastCalledWith(undefined)
    rerender(<InviteDialog title="Invite" ask={ask} scan="Scan it." onCode={onCode} onClose={vi.fn()} />)
    expect(ask).toHaveBeenCalledTimes(2)
    // Closed before the server answered: what it answers later is put on no page.
    const late = answer
    unmount()
    late(code('https://a/#late'))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(onCode).not.toHaveBeenCalledWith(expect.objectContaining({ url: 'https://a/#late' }))
  })
})
