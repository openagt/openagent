import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

// The launcher's line for a project folder behind its remote (#2421), and its press.

const projects = vi.hoisted(() => ({ onFolderBehind: vi.fn(), sendUpdateFolder: vi.fn() }))
vi.mock('../rpc/projects.js', () => projects)
const { FolderBehindLine } = await import('./FolderBehind.js')

afterEach(() => {
  cleanup()
  for (const fn of Object.values(projects)) fn.mockReset()
})

test('a folder behind is said with the count and the branch; up to date, nothing is said', async () => {
  projects.onFolderBehind.mockResolvedValue({ branch: 'main', behind: 1863 })
  render(<FolderBehindLine projectId="p1" />)
  expect(await screen.findByText('This project’s folder is 1,863 commits behind main.')).toBeTruthy()
  expect(projects.onFolderBehind).toHaveBeenCalledWith('p1')
  cleanup()
  projects.onFolderBehind.mockResolvedValue({ branch: 'main', behind: 1 })
  render(<FolderBehindLine projectId="p1" />)
  expect(await screen.findByText('This project’s folder is 1 commit behind main.')).toBeTruthy()
  cleanup()
  projects.onFolderBehind.mockReset().mockResolvedValue(null)
  const { container } = render(<FolderBehindLine projectId="p1" />)
  await waitFor(() => expect(projects.onFolderBehind).toHaveBeenCalled())
  expect(container.textContent).toBe('')
})

test('its press updates the folder, then the line goes', async () => {
  projects.onFolderBehind.mockResolvedValueOnce({ branch: 'main', behind: 2 }).mockResolvedValue(null)
  projects.sendUpdateFolder.mockResolvedValue({ ok: true })
  render(<FolderBehindLine projectId="p1" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Update folder' }))
  await waitFor(() => expect(screen.queryByText(/behind main/)).toBeNull())
  expect(projects.sendUpdateFolder).toHaveBeenCalledWith('p1')
})

test('an update git refuses says git’s words, and the line stays', async () => {
  projects.onFolderBehind.mockResolvedValue({ branch: 'main', behind: 2 })
  projects.sendUpdateFolder.mockResolvedValue({ ok: false, error: 'fatal: Not possible to fast-forward, aborting.' })
  render(<FolderBehindLine projectId="p1" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Update folder' }))
  expect((await screen.findByRole('alert')).textContent).toContain('fatal: Not possible to fast-forward, aborting.')
  expect(screen.getByText('This project’s folder is 2 commits behind main.')).toBeTruthy()
})
