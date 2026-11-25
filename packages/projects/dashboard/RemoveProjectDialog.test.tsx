import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { fakeHost, onProjectsChanged, renderWithHost, ShellProjectsContext } from '@openagt/ui/module/testing'
import { RemoveProjectDialog } from './RemoveProjectDialog.js'

afterEach(cleanup)

const PROJECTS = [{ id: 'p1', name: 'app', path: '/repos/app', addedAt: '2026-11-01T00:00:00.000Z' }]

/** The dialog as the project's menu opens it, for the project p1, with what the module's server answers a removal. */
function opened(answer: unknown = { ok: true }) {
  const host = fakeHost('@openagt/projects', { callComputer: vi.fn(async () => ({ ok: true as const, output: answer })) })
  const onDone = vi.fn()
  const changes: unknown[] = []
  const stop = onProjectsChanged(change => void changes.push(change))
  renderWithHost(
    <ShellProjectsContext.Provider value={PROJECTS as never}>
      <button type="button" data-project-picker>
        Project: All projects
      </button>
      <RemoveProjectDialog on={{ projectId: 'p1' }} onDone={onDone} />
    </ShellProjectsContext.Provider>,
    host,
  )
  return { host, onDone, changes, stop }
}

test('it says nothing in the folder is deleted and what stays; the box, not ticked, says what it would delete only once it is', async () => {
  const { stop } = opened()
  try {
    const dialog = screen.getByRole('alertdialog')
    expect(dialog.textContent).toMatch(/Nothing in the folder is deleted/)
    for (const kept of ['.openagent', '.branches', '.agent-runner', '~/.openagent', 'agent-data']) expect(dialog.textContent).toContain(kept)
    expect(dialog.textContent).toMatch(/Add the folder again to bring\s+the project back/)
    expect(dialog.textContent).toContain('Also delete OpenAgent’s files in this folder')
    expect(dialog.textContent).not.toMatch(/This deletes/)
    fireEvent.click(screen.getByRole('checkbox'))
    await waitFor(() => expect(dialog.textContent).toMatch(/This deletes, on this machine/))
    expect(dialog.textContent).not.toMatch(/Nothing in the folder is deleted/)
    expect(dialog.textContent).toMatch(/Your files and your commits stay\./)
    expect(dialog.textContent).toMatch(/An agent that waits for your answer cannot be\s+continued after this/)
    expect(dialog.textContent).toMatch(/A tool that\s+worked in the project removes its own files too/)
    expect(dialog.textContent).toMatch(/A scheduler\s+you set to keep running is not stopped/)
    expect(dialog.textContent).toMatch(/The agents’ conversations go with them/)
    expect(dialog.textContent).toMatch(/this is\s+their only copy/)
    expect(dialog.textContent).toMatch(/It never touches the remote, your files, your commits, a branch with work on it, or a file git tracks/)
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
  } finally {
    stop()
  }
})

test("it names the project and opens on Cancel, not on the box that also deletes OpenAgent's files; Cancel removes nothing", async () => {
  const { host, onDone, stop } = opened()
  try {
    expect(screen.getByRole('alertdialog').textContent).toMatch(/Remove the project app\?/)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' })))
    expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith())
    expect(host.callComputer).not.toHaveBeenCalled()
  } finally {
    stop()
  }
})

test('"Project removed" stays until Done, which tells the shell the project is gone and puts the keyboard on the project picker', async () => {
  const { host, onDone, changes, stop } = opened()
  try {
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(screen.getByRole('alertdialog').textContent).toMatch(/Project removed/))
    expect(screen.getByRole('alertdialog').textContent).toMatch(/nothing in the folder was deleted\. Add the folder again to bring the project back/)
    expect(host.callComputer).toHaveBeenCalledWith('removeProject', { projectId: 'p1', files: false })
    expect(changes).toEqual([])
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Done' })))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ ok: true }))
    expect(changes).toEqual([{ removed: 'p1' }])
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Project: All projects' })))
  } finally {
    stop()
  }
})

test('with the box ticked, the report says what each module deleted, kept, and could not clean', async () => {
  const cleanup = { removed: ['.branches', '.openagent'], kept: [{ path: '.agent-runner/config.yml', reason: 'your settings for agent-runner' }], failed: ['scheduled-agents: the scheduler is running here'] }
  const { host, stop } = opened({ ok: true, cleanup })
  try {
    fireEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByText('This deletes, on this machine:')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove and delete' }))
    await waitFor(() => expect(screen.getByText('Deleted')).toBeTruthy())
    expect(host.callComputer).toHaveBeenCalledWith('removeProject', { projectId: 'p1', files: true })
    expect(screen.getByText('.agent-runner/config.yml: your settings for agent-runner')).toBeTruthy()
    expect(screen.getByText('scheduled-agents: the scheduler is running here')).toBeTruthy()
  } finally {
    stop()
  }
})

test('a refusal is said in the question, which stays open', async () => {
  const { onDone, changes, stop } = opened({ ok: false, error: 'An agent is working in this project. Stop it, then remove the project.' })
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(await screen.findByText('An agent is working in this project. Stop it, then remove the project.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy()
    expect(onDone).not.toHaveBeenCalled()
    expect(changes).toEqual([])
  } finally {
    stop()
  }
})
