import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useRef, useState } from 'react'
import { Dialog } from './dialog.js'

afterEach(cleanup)

describe('Dialog', () => {
  function Named({ disabled = false }: { disabled?: boolean }) {
    const [open, setOpen] = useState(false)
    const field = useRef<HTMLInputElement>(null)
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Add
        </button>
        <Dialog open={open} onOpenChange={setOpen} title="Add one" initialFocus={field}>
          {open && <input ref={field} aria-label="Name" disabled={disabled} />}
        </Dialog>
      </>
    )
  }

  test('it opens on its field, and closing it gives the focus back to the press that opened it', async () => {
    render(<Named />)
    const press = screen.getByRole('button', { name: 'Add' })
    press.focus()
    fireEvent.click(press)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Name' })))
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(press))
  })

  test('a field it cannot focus leaves the focus to the first thing in it that takes it', async () => {
    render(<Named disabled />)
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' })))
  })
})
