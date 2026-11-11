import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

vi.mock('../rpc/projects.js', () => ({ sendRemoveProject: vi.fn() }))
const { RemoveProjectDialog } = await import('./RemoveProjectDialog.js')

afterEach(cleanup)

test("it opens on Cancel, not on the box that also deletes OpenAgent's files", async () => {
  render(<RemoveProjectDialog projectId="p1" open onOpenChange={vi.fn()} onRemoved={vi.fn()} />)
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' })))
  expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('false')
})
