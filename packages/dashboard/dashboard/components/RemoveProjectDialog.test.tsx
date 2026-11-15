import { afterEach, expect, test, vi } from 'vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ModulesContext, type MountedModules } from '../lib/use-modules.js'

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

test('its scheduler stops is said only for a project that has the scheduler', () => {
  const scheduler: MountedModules = { pages: [{ segment: 'automations', label: 'Automations', Page: () => null, package: '@openagt/skill-scheduler', projects: ['p1'] }], cards: [], linkActions: [], panels: [], runSlots: [], settings: [], everyPage: [], loaded: true }
  const { unmount } = render(
    <ModulesContext.Provider value={scheduler}>
      <RemoveProjectDialog projectId="p1" open onOpenChange={vi.fn()} onRemoved={vi.fn()} />
    </ModulesContext.Provider>,
  )
  expect(screen.getByText(/its scheduler stops unless you set it to keep running/)).toBeTruthy()
  unmount()
  render(
    <ModulesContext.Provider value={scheduler}>
      <RemoveProjectDialog projectId="p2" open onOpenChange={vi.fn()} onRemoved={vi.fn()} />
    </ModulesContext.Provider>,
  )
  expect(screen.getByText(/^It leaves the dashboard’s list\. /)).toBeTruthy()
  expect(screen.queryByText(/scheduler stops/)).toBeNull()
})
