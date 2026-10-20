import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import type { ProjectSkills } from '../rpc/skills.js'

const onProjectSkills = vi.hoisted(() => vi.fn())
const sendChangeSkills = vi.hoisted(() => vi.fn())
const sendProjectSkills = vi.hoisted(() => vi.fn())
vi.mock('../rpc/skills.js', () => ({ onProjectSkills, sendChangeSkills, sendProjectSkills }))

const { ProjectSkillsLine } = await import('./ProjectSkills.js')

afterEach(() => {
  cleanup()
  onProjectSkills.mockReset()
  sendChangeSkills.mockReset()
  sendProjectSkills.mockReset()
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
    uncommitted: [],
    git: true,
    remote: 'GitHub',
    local: false,
    ...over,
  }
}

/** The line with its door: a button here stands in for "Skills" under the launcher's box. */
function WithDoor(props: { projectId: string; onChanged?: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}>Skills…</button>
      <ProjectSkillsLine {...props} door={{ open, onClose: () => setOpen(false) }} />
    </>
  )
}

/** A project with no remote: `remote` is absent, as the daemon answers it. */
function noRemote(over: Partial<ProjectSkills> = {}): ProjectSkills {
  const { remote: _none, ...rest } = skills(over)
  return rest
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

  test('a project that picked no skill has no line either: every run gets the default skills, and the list opens from the project\'s menu', async () => {
    onProjectSkills.mockResolvedValue(skills())
    const { container } = render(<ProjectSkillsLine projectId="p1" />)
    await waitFor(() => expect(onProjectSkills.mock.results[0]?.type).toBe('return'))
    expect(container.textContent).toBe('')
    expect(screen.queryByRole('button', { name: 'Add skills' })).toBeNull()
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

  test('a newer version is told by name, and Update writes those skills again and sends them, nothing else', async () => {
    onProjectSkills.mockResolvedValue(
      skills({ groups: [{ title: 'Tickets and queue', ticked: true, skills: [skill('tickets', 'newer'), skill('queue', 'newer'), skill('plan', 'changed')] }] }),
    )
    sendChangeSkills.mockResolvedValue({ ok: true, written: ['tickets', 'queue'], removed: [], left: [] })
    sendProjectSkills.mockResolvedValue({ ok: true, sent: 'pushed', branch: 'main' })
    const onChanged = vi.fn()
    const { container } = render(<ProjectSkillsLine projectId="p1" onChanged={onChanged} />)
    await screen.findByRole('button', { name: 'Update' })
    expect(container.textContent).toContain('The tickets and queue skills have newer versions.')
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))
    await waitFor(() => expect(sendChangeSkills).toHaveBeenCalledWith('p1', { write: ['tickets', 'queue'] }))
    await waitFor(() => expect(sendProjectSkills).toHaveBeenCalledWith('p1', ['tickets', 'queue']))
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
  })

  test('one skill with a newer version is named alone', async () => {
    onProjectSkills.mockResolvedValue(skills({ groups: [{ title: 'Subagents', ticked: true, skills: [skill('orchestration', 'newer')] }] }))
    const { container } = render(<ProjectSkillsLine projectId="p1" />)
    await screen.findByRole('button', { name: 'Update' })
    expect(container.textContent).toContain('The orchestration skill has a newer version.')
  })

  test('skills on this computer only are told with the one press that sends them; once agents have them the card is gone', async () => {
    const tickets = { title: 'Tickets and queue', ticked: true, skills: [skill('tickets', 'current', true), skill('queue', 'current', true), skill('plan', 'current')] }
    onProjectSkills.mockResolvedValueOnce(skills({ groups: [tickets], uncommitted: ['tickets'] })).mockResolvedValue(skills({ groups: [{ ...tickets, skills: tickets.skills.map(one => ({ ...one, waiting: false })) }] }))
    sendProjectSkills.mockResolvedValue({ ok: true, sent: 'pushed', branch: 'main' })
    const { container } = render(<ProjectSkillsLine projectId="p1" />)
    await screen.findByRole('button', { name: 'Send to GitHub' })
    expect(container.textContent).toContain('The tickets and queue skills are on this computer only, so your agents do not have them yet.')
    expect(container.textContent).not.toContain('My local branch')
    fireEvent.click(screen.getByRole('button', { name: 'Send to GitHub' }))
    await waitFor(() => expect(sendProjectSkills).toHaveBeenCalledWith('p1'))
    await waitFor(() => expect(container.textContent).toBe(''))
  })

  test('skills committed on the folder\'s branch only point to starting from it', async () => {
    onProjectSkills.mockResolvedValue(skills({ groups: [{ title: 'Tickets and queue', ticked: true, skills: [skill('tickets', 'current', true)] }], local: true }))
    const { container } = render(<ProjectSkillsLine projectId="p1" />)
    await screen.findByRole('button', { name: 'Send to GitHub' })
    expect(container.textContent).toContain('The tickets skill is on this computer only, so your agents do not have it yet. Or pick My local branch when you start an agent.')
  })

  test('a send that is refused says why and keeps the button', async () => {
    onProjectSkills.mockResolvedValue(skills({ uncommitted: ['tickets'] }))
    sendProjectSkills.mockResolvedValue({ ok: false, error: 'the remote took no push: Permission denied' })
    render(<ProjectSkillsLine projectId="p1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Send to GitHub' }))
    expect(await screen.findByText('the remote took no push: Permission denied')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Send to GitHub' })).toBeTruthy()
  })

  test('with no remote the press is a commit, which is all agents need', async () => {
    onProjectSkills.mockResolvedValue(noRemote({ uncommitted: ['tickets'] }))
    const { container } = render(<ProjectSkillsLine projectId="p1" />)
    await screen.findByRole('button', { name: 'Commit' })
    expect(container.textContent).toContain('The tickets skill is not committed, so your agents do not have it yet.')
  })

  test('skills on the branch a send left, where no pull request could be opened, are told to merge it, and offered no send', async () => {
    onProjectSkills.mockResolvedValue(skills({ groups: [{ title: 'Tickets and queue', ticked: true, skills: [skill('tickets', 'current', true)] }], remote: 'GitLab', branch: 'openagent/skills' }))
    const { container } = render(<ProjectSkillsLine projectId="p1" />)
    await waitFor(() => expect(container.textContent).toContain('The tickets skill is on the branch openagent/skills on GitLab. Merge it into main, and your agents get it.'))
    expect(screen.queryByRole('button', { name: 'Send to GitLab' })).toBeNull()
  })

  test('skills in a pull request are told with it; many are counted, not named', async () => {
    onProjectSkills.mockResolvedValue(
      skills({ groups: [{ title: 'Tickets and queue', ticked: true, skills: ['tickets', 'queue', 'plan', 'triage', 'ux'].map(name => skill(name, 'current', true)) }], request: { number: 12, url: 'https://example.com/pull/12' } }),
    )
    const { container } = render(<ProjectSkillsLine projectId="p1" />)
    const open = await screen.findByRole('link', { name: 'Open #12' })
    expect(open.getAttribute('href')).toBe('https://example.com/pull/12')
    expect(container.textContent).toContain('5 skills are in pull request #12. Your agents get them once it is merged.')
    expect(screen.queryByRole('button', { name: 'Send to GitHub' })).toBeNull()
  })
})

describe('Add skills', () => {
  test('in a project with no skills yet the default picks are ticked: every group but the one that needs a setup of its own, and the scheduler', async () => {
    onProjectSkills.mockResolvedValue(skills())
    sendChangeSkills.mockResolvedValue({ ok: true, written: ['tickets', 'queue'], removed: [], left: [], scheduler: 'on' })
    sendProjectSkills.mockResolvedValue({ ok: true, sent: 'pushed', branch: 'main' })
    const onChanged = vi.fn()
    render(<WithDoor projectId="p1" onChanged={onChanged} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Skills…' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Tickets and queue')).toBeTruthy()
    expect(within(dialog).getByText('What tickets does.')).toBeTruthy()
    expect([isTicked('tickets'), isTicked('queue'), isTicked('browser'), isTicked('scheduler')]).toEqual([true, true, false, true])
    expect(within(dialog).getByText('2 skills to write, the scheduler on.')).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save and send to GitHub' }))
    await waitFor(() => expect(sendChangeSkills).toHaveBeenCalledWith('p1', { write: ['tickets', 'queue'], remove: [], scheduler: true }))
    expect(await within(dialog).findByText(/Wrote 2 skills in/)).toBeTruthy()
    expect(dialog.textContent).toContain('tickets, queue')
    // The same press sends what it wrote, and nothing else.
    await waitFor(() => expect(sendProjectSkills).toHaveBeenCalledWith('p1', ['tickets', 'queue']))
    expect(await within(dialog).findByText('Sent to GitHub, on main. Your agents get this change from their next start.')).toBeTruthy()
    expect(dialog.textContent).toContain('The scheduler is on for this project, on this machine. Every automation starts switched off.')
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  test('opened again the ticks show what the project has; a tick removed deletes, a tick added writes, and the scheduler is left alone', async () => {
    onProjectSkills.mockResolvedValue(
      skills({ groups: [{ title: 'Tickets and queue', ticked: true, skills: [skill('tickets', 'current'), skill('queue', 'changed'), skill('plan')] }, { title: 'Needs its own setup', ticked: false, skills: [skill('browser')] }] }),
    )
    sendChangeSkills.mockResolvedValue({ ok: true, written: ['browser'], removed: ['tickets'], left: [{ path: '.agents/skills/tickets', reason: 'it holds other files' }] })
    sendProjectSkills.mockResolvedValue({ ok: true, sent: 'pushed', branch: 'main' })
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
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save and send to GitHub' }))
    await waitFor(() => expect(sendChangeSkills).toHaveBeenCalledWith('p1', { write: ['browser'], remove: ['tickets'] }))
    await waitFor(() => expect(sendProjectSkills).toHaveBeenCalledWith('p1', ['browser', 'tickets']))
    expect(await within(dialog).findByText(/Deleted 1 skill/)).toBeTruthy()
    expect(dialog.textContent).toContain('Left as it is: .agents/skills/tickets (it holds other files).')
  })

  test('a default branch that takes no push: the screen points to the pull request the change went to', async () => {
    onProjectSkills.mockResolvedValue(skills())
    sendChangeSkills.mockResolvedValue({ ok: true, written: ['tickets', 'queue'], removed: [], left: [] })
    sendProjectSkills.mockResolvedValue({ ok: true, sent: 'request', request: { number: 12, url: 'https://example.com/pull/12' } })
    render(<WithDoor projectId="p1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Skills…' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save and send to GitHub' }))
    const link = await within(dialog).findByRole('link', { name: 'pull request #12' })
    expect(link.getAttribute('href')).toBe('https://example.com/pull/12')
    expect(dialog.textContent).toContain('GitHub took no push to main, so the change is in pull request #12. Your agents get it once it is merged.')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  test('a send that is refused after the save says the files are saved, and offers to send again', async () => {
    onProjectSkills.mockResolvedValue(skills())
    sendChangeSkills.mockResolvedValue({ ok: true, written: ['tickets', 'queue'], removed: [], left: [] })
    sendProjectSkills.mockResolvedValueOnce({ ok: false, error: 'could not reach the remote: network down' }).mockResolvedValue({ ok: true, sent: 'pushed', branch: 'main' })
    render(<WithDoor projectId="p1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Skills…' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save and send to GitHub' }))
    expect(await within(dialog).findByText("Saved in the project's folder, not sent: could not reach the remote: network down")).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send again' }))
    expect(await within(dialog).findByText(/Sent to GitHub, on main\./)).toBeTruthy()
    expect(sendProjectSkills).toHaveBeenLastCalledWith('p1', ['tickets', 'queue'])
    expect(within(dialog).queryByRole('button', { name: 'Send again' })).toBeNull()
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
    expect(sendProjectSkills).not.toHaveBeenCalled()
    expect(within(dialog).queryByRole('button', { name: 'Send again' })).toBeNull()
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
    onProjectSkills.mockResolvedValue(noRemote())
    sendChangeSkills.mockResolvedValue({ ok: true, written: ['tickets', 'queue'], removed: [], left: [] })
    sendProjectSkills.mockResolvedValue({ ok: true, sent: 'committed' })
    render(<WithDoor projectId="p1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Skills…' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('Save commits the change.')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save and commit' }))
    expect(await within(dialog).findByText('Committed. Your agents get this change from their next start.')).toBeTruthy()
  })
})
