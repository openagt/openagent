import { afterEach, expect, test, vi } from 'vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('../rpc/projects.js', () => ({ sendRemoveProject: vi.fn(async () => ({ ok: true })) }))
const { RemoveProjectDialog } = await import('./RemoveProjectDialog.js')

afterEach(cleanup)

test("it opens on Cancel, not on the box that also deletes OpenAgent's files", async () => {
  render(<RemoveProjectDialog projectId="p1" open onOpenChange={vi.fn()} onRemoved={vi.fn()} />)
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' })))
  expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('false')
})

test('Done puts the keyboard on the project picker, where the next project is picked', async () => {
  function Shell() {
    const [open, setOpen] = useState(true)
    return (
      <>
        <button type="button" data-project-picker>
          Project: All projects
        </button>
        <RemoveProjectDialog projectId="p1" open={open} onOpenChange={setOpen} onRemoved={vi.fn()} />
      </>
    )
  }
  render(<Shell />)
  fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Done' }))
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Project: All projects' })))
})
