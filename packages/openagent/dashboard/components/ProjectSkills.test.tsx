import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import type { ProjectSkills } from '../rpc/skills.js'

const onProjectSkills = vi.hoisted(() => vi.fn())
const sendChangeSkills = vi.hoisted(() => vi.fn())
const sendCommitSkills = vi.hoisted(() => vi.fn())
vi.mock('../rpc/skills.js', () => ({ onProjectSkills, sendChangeSkills, sendCommitSkills }))

const { ProjectSkillsLine } = await import('./ProjectSkills.js')

afterEach(() => {
  cleanup()
  onProjectSkills.mockReset()
  sendChangeSkills.mockReset()
  sendCommitSkills.mockReset()
})

type Standing = ProjectSkills['groups'][number]['skills'][number]['standing']
const skill = (name: string, standing: Standing = 'absent', waiting = false) => ({ name, description: `What ${name} does.`, standing, waiting })

/** A project's skills as the daemon answers them; `over` changes the parts a test is about. */
function skills(over: Partial<ProjectSkills> = {}): ProjectSkills {
  return {
    groups: [
      { title: 'Tickets and queue', ticked: true, skills: [skill('tickets'), skill('queue')] },
      { title: 'Needs its own setup', ticked: false, skills: [skill('browser')] },
    ],
    scheduler: false,
    startBranch: 'main',
    uncommitted: 0,
    git: true,
    remote: true,
    ...over,
  }
}

/** The line with the door the project's ⋮ menu holds: a button here stands in for the menu's "Skills…". */
function WithDoor(props: { projectId: string; onChanged?: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}>Skills…</button>
      <ProjectSkillsLine {...props} door={{ open, onClose: () => setOpen(false) }} />
    </>
  )
}

const box = (name: string): HTMLElement => screen.getByRole('checkbox', { name })
const isTicked = (name: string): boolean => box(name).getAttribute('aria-checked') === 'true'

describe('ProjectSkillsLine', () => {
  test('a project with its skills in order has no line: nothing to say, and the list opens from the project\'s menu', async () => {
    onProjectSkills.mockResolvedValue(skills({ groups: [{ title: 'Tickets and queue', ticked: true, skills: [skill('tickets', 'current'), skill('queue')] }] }))
    const { container } = render(<ProjectSkillsLine projectId="p1" />)
    await waitFor(() => expect(onProjectSkills).toHaveBeenCalledWith('p1'))
    await waitFor(() => expect(onProjectSkills.mock.results[0]?.type).toBe('return'))
    expect(container.textContent).toBe('')
    expect(screen.queryByRole('status')).toBeNull()
  })

  test('a project with no skill yet says so, with the door to the list in plain sight', async () => {
    onProjectSkills.mockResolvedValue(skills())
    render(<ProjectSkillsLine projectId="p1" />)
    expect(await screen.findByText(/This project has no skills yet\./)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add skills' }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Update' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Commit' })).toBeNull()
    expect(screen.queryByText(/waiting to reach/)).toBeNull()
  })

  test('"Skills…" in the project\'s menu opens the list, also when the line has nothing to say; closing the list tells the menu\'s side', async () => {
    onProjectSkills.mockResolvedValue(skills())
    render(<WithDoor projectId="p1" />)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Skills…' }))
    // Named as the menu names it: the list is where skills are added, updated and removed.
    const dialog = await screen.findByRole('dialog', { name: 'Skills' })
    expect(screen.queryByRole('status')).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    // Closed for the menu's side too: the same pick opens it again.
    fireEvent.click(screen.getByRole('button', { name: 'Skills…' }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })

  test('"Skills…" picked for a project whose skills cannot be read says so, in place of doing nothing; unasked, such a project shows no line', async () => {
    onProjectSkills.mockRejectedValue(new Error('EACCES'))
    const { container } = render(<ProjectSkillsLine projectId="p1" />)
    await waitFor(() => expect(onProjectSkills).toHaveBeenCalled())
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(container.textContent).toBe('')
    cleanup()
    render(<WithDoor projectId="p1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Skills…' }))
    expect((await screen.findByRole('alert')).textContent).toBe('This project\u2019s skills could not be read.')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  test('a project that is unknown here shows no line', async () => {
    onProjectSkills.mockResolvedValue(null)
    const { container } = render(<ProjectSkillsLine projectId="gone" />)
    await waitFor(() => expect(onProjectSkills).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  test('a newer text is told, and Update writes those skills again and nothing else', async () => {
    onProjectSkills.mockResolvedValue(
      skills({ groups: [{ title: 'Tickets and queue', ticked: true, skills: [skill('tickets', 'newer'), skill('queue', 'newer'), skill('plan', 'changed')] }] }),
    )
    sendChangeSkills.mockResolvedValue({ ok: true, written: ['tickets', 'queue'], removed: [], left: [] })
    const onChanged = vi.fn()
    render(<ProjectSkillsLine projectId="p1" onChanged={onChanged} />)
    expect(await screen.findByText(/2 skills have a newer text\./)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))
    await waitFor(() => expect(sendChangeSkills).toHaveBeenCalledWith('p1', { write: ['tickets', 'queue'] }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
  })

  test('files not committed are told, Commit commits them, and the line then says nothing was pushed', async () => {
    onProjectSkills.mockResolvedValueOnce(skills({ uncommitted: 2 })).mockResolvedValue(skills({ uncommitted: 0 }))
    sendCommitSkills.mockResolvedValue({ ok: true, committed: true, commit: 'abc1234' })
    render(<ProjectSkillsLine projectId="p1" />)
    expect(await screen.findByText(/2 skill files are not committed\./)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Commit' }))
    await waitFor(() => expect(sendCommitSkills).toHaveBeenCalledWith('p1'))
    expect(await screen.findByText('Committed as abc1234. Nothing was pushed.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Commit' })).toBeNull()
  })

  test('a commit that is refused says why and keeps the button', async () => {
    onProjectSkills.mockResolvedValue(skills({ uncommitted: 1 }))
    sendCommitSkills.mockResolvedValue({ ok: false, error: 'git ignores .claude/skills/tickets: an ignore rule of this project, or of yours, covers it' })
    render(<ProjectSkillsLine projectId="p1" />)
    expect(await screen.findByText(/1 skill file is not committed\./)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Commit' }))
    expect(await screen.findByText(/git ignores \.claude\/skills\/tickets/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Commit' })).toBeTruthy()
  })

  test('skills in the folder that are not yet on the branch agents start from are named as waiting', async () => {
    onProjectSkills.mockResolvedValue(skills({ groups: [{ title: 'Tickets and queue', ticked: true, skills: [skill('tickets', 'current', true), skill('queue', 'current', true), skill('plan', 'current')] }] }))
    const { container } = render(<ProjectSkillsLine projectId="p1" />)
    await screen.findByText(/waiting to reach/)
    // What it holds is not counted on the line any more: only what is to know of them.
    expect(container.textContent).not.toContain('This project has')
    expect(container.textContent).toContain('tickets, queue: waiting to reach main. An agent started from main does not have them.')
  })

  test('many waiting skills are counted, not named', async () => {
    onProjectSkills.mockResolvedValue(skills({ groups: [{ title: 'Tickets and queue', ticked: true, skills: ['tickets', 'queue', 'plan', 'triage', 'ux'].map(name => skill(name, 'current', true)) }] }))
    const { container } = render(<ProjectSkillsLine projectId="p1" />)
    await screen.findByText(/waiting to reach/)
    expect(container.textContent).toContain('5 skills: waiting to reach main. An agent started from main does not have them.')
  })
})

describe('Add skills', () => {
  test('in a project with no skills yet the default picks are ticked: every group but the one that needs a setup of its own, and the scheduler', async () => {
    onProjectSkills.mockResolvedValue(skills())
    sendChangeSkills.mockResolvedValue({ ok: true, written: ['tickets', 'queue'], removed: [], left: [], scheduler: 'on' })
    const onChanged = vi.fn()
    render(<WithDoor projectId="p1" onChanged={onChanged} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Skills…' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Tickets and queue')).toBeTruthy()
    expect(within(dialog).getByText('What tickets does.')).toBeTruthy()
    expect([isTicked('tickets'), isTicked('queue'), isTicked('browser'), isTicked('scheduler')]).toEqual([true, true, false, true])
    expect(within(dialog).getByText('2 skills to write, the scheduler on.')).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sendChangeSkills).toHaveBeenCalledWith('p1', { write: ['tickets', 'queue'], remove: [], scheduler: true }))
    expect(await within(dialog).findByText(/Wrote 2 skills in/)).toBeTruthy()
    expect(dialog.textContent).toContain('tickets, queue')
    expect(dialog.textContent).toContain('Your agents get these skills once they are on main.')
    expect(dialog.textContent).toContain('The scheduler is on for this project, on this machine. Every automation starts switched off.')
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  test('opened again the ticks show what the project has; a tick removed deletes, a tick added writes, and the scheduler is left alone', async () => {
    onProjectSkills.mockResolvedValue(
      skills({ groups: [{ title: 'Tickets and queue', ticked: true, skills: [skill('tickets', 'current'), skill('queue', 'changed'), skill('plan')] }, { title: 'Needs its own setup', ticked: false, skills: [skill('browser')] }] }),
    )
    sendChangeSkills.mockResolvedValue({ ok: true, written: ['browser'], removed: ['tickets'], left: [{ path: '.agents/skills/tickets', reason: 'it holds other files' }] })
    render(<WithDoor projectId="p1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Skills…' }))
    const dialog = await screen.findByRole('dialog')
    expect([isTicked('tickets'), isTicked('queue'), isTicked('plan'), isTicked('browser'), isTicked('scheduler')]).toEqual([true, true, false, false, false])
    expect(dialog.textContent).toContain('queue (changed by hand)')
    expect(within(dialog).getByText('Nothing to change.')).toBeTruthy()
    expect((within(dialog).getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(box('tickets'))
    fireEvent.click(box('browser'))
    expect(within(dialog).getByText('1 skill to write, 1 skill to delete.')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sendChangeSkills).toHaveBeenCalledWith('p1', { write: ['browser'], remove: ['tickets'] }))
    expect(await within(dialog).findByText(/Deleted 1 skill/)).toBeTruthy()
    expect(dialog.textContent).toContain('Left as it is: .agents/skills/tickets (it holds other files).')
  })

  test('after a save the commit is offered: one press commits the files, and the screen says nothing was pushed', async () => {
    onProjectSkills.mockResolvedValue(skills())
    sendChangeSkills.mockResolvedValue({ ok: true, written: ['tickets', 'queue'], removed: [], left: [] })
    sendCommitSkills.mockResolvedValue({ ok: true, committed: true, commit: 'abc1234' })
    render(<WithDoor projectId="p1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Skills…' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByText(/not committed\. A commit holds these files alone/)).toBeTruthy()
    expect(sendCommitSkills).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Commit these files' }))
    await waitFor(() => expect(sendCommitSkills).toHaveBeenCalledWith('p1', ['tickets', 'queue']))
    expect(await within(dialog).findByText(/Committed as abc1234, these files alone\. Nothing was pushed/)).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: 'Commit these files' })).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  test('a save that is refused says why and keeps the list; Cancel writes nothing; a folder that is no repository is offered no commit', async () => {
    // A folder that is no repository: nothing to commit, and no branch agents start from.
    const { startBranch: _none, ...noRepository } = skills({ git: false })
    onProjectSkills.mockResolvedValue(noRepository)
    sendChangeSkills.mockResolvedValueOnce({ ok: false, error: 'EACCES: permission denied' }).mockResolvedValue({ ok: true, written: ['tickets', 'queue'], removed: [], left: [], schedulerError: 'hooks.yml: unreadable' })
    render(<WithDoor projectId="p1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Skills…' }))
    let dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByText('EACCES: permission denied')).toBeTruthy()
    expect(box('tickets')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(sendChangeSkills).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Skills…' }))
    dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByText('This folder is not a git repository, so there is nothing to commit.')).toBeTruthy()
    expect(dialog.textContent).toContain('The scheduler was not switched: hooks.yml: unreadable')
    expect(within(dialog).queryByRole('button', { name: 'Commit these files' })).toBeNull()
    expect(dialog.textContent).not.toContain('Your agents get these skills')
  })
})

describe('the skills line, over time', () => {
  test('the list a person has open keeps the project as it stood when it opened, whatever a later read says', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      onProjectSkills.mockResolvedValueOnce(skills()).mockResolvedValue(skills({ groups: [{ title: 'Tickets and queue', ticked: true, skills: [skill('tickets', 'current'), skill('queue')] }] }))
      render(<WithDoor projectId="p1" />)
      fireEvent.click(await screen.findByRole('button', { name: 'Skills…' }))
      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByText('2 skills to write, the scheduler on.')).toBeTruthy()
      // The next read lands while the list is open: the project now holds tickets (written in a terminal, say).
      await vi.advanceTimersByTimeAsync(16_000)
      await waitFor(() => expect(onProjectSkills.mock.calls.length).toBeGreaterThanOrEqual(2))
      expect(within(dialog).getByText('2 skills to write, the scheduler on.')).toBeTruthy()
      expect(within(dialog).queryByText(/to delete/)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  test('in a project with no remote a commit is all agents need, and the screen says so', async () => {
    onProjectSkills.mockResolvedValue(skills({ remote: false }))
    sendChangeSkills.mockResolvedValue({ ok: true, written: ['tickets', 'queue'], removed: [], left: [] })
    sendCommitSkills.mockResolvedValue({ ok: true, committed: true, commit: 'abc1234' })
    render(<WithDoor projectId="p1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Skills…' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Commit these files' }))
    expect(await within(dialog).findByText('Committed as abc1234, these files alone. Your agents have these skills from their next start.')).toBeTruthy()
    expect(dialog.textContent).not.toContain('push it')
    expect(dialog.textContent).not.toContain('once they are on main')
  })
})
