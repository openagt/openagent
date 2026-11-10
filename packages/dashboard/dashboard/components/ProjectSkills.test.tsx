import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { onSkillsSaved, skillsSaved } from '../lib/skills-saved.js'
import type { ProjectSkills } from '../rpc/skills.js'

const onProjectSkills = vi.hoisted(() => vi.fn())
const sendChangeSkills = vi.hoisted(() => vi.fn())
const sendProjectSkills = vi.hoisted(() => vi.fn())
vi.mock('../rpc/skills.js', () => ({ onProjectSkills, sendChangeSkills, sendProjectSkills }))

const { ProjectSkillsLine, SkillsSettings } = await import('./ProjectSkills.js')

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
      { title: 'Tickets and queue', skills: [skill('tickets'), skill('queue')] },
      { title: 'Needs its own setup', skills: [skill('browser')] },
      { title: 'Automations', skills: [skill('scheduler')] },
    ],
    startBranch: 'main',
    uncommitted: [], held: [],
    git: true,
    remote: 'GitHub',
    local: false,
    ...over,
  }
}

/** A project with no remote: `remote` is absent, as the daemon answers it. */
function noRemote(over: Partial<ProjectSkills> = {}): ProjectSkills {
  const { remote: _none, ...rest } = skills(over)
  return rest
}

const box = (name: string): HTMLElement => screen.getByRole('checkbox', { name })
const isTicked = (name: string): boolean => box(name).getAttribute('aria-checked') === 'true'
/** Nothing is ticked in a project with no skills: a test ticks what it saves. */
const tick = (...names: string[]): void => {
  for (const name of names) fireEvent.click(box(name))
}

describe('ProjectSkillsLine', () => {
  test('a project with its skills in order has no line: nothing to say', async () => {
    onProjectSkills.mockResolvedValue(skills({ groups: [{ title: 'Tickets and queue', skills: [skill('tickets', 'current'), skill('queue')] }] }))
    const { container } = render(<ProjectSkillsLine projectId="p1" />)
    await waitFor(() => expect(onProjectSkills).toHaveBeenCalledWith('p1'))
    await waitFor(() => expect(onProjectSkills.mock.results[0]?.type).toBe('return'))
    expect(container.textContent).toBe('')
    expect(screen.queryByRole('status')).toBeNull()
  })

  test('a project that picked no skill has no line either: every run gets the default skills', async () => {
    onProjectSkills.mockResolvedValue(skills())
    const { container } = render(<ProjectSkillsLine projectId="p1" />)
    await waitFor(() => expect(onProjectSkills.mock.results[0]?.type).toBe('return'))
    expect(container.textContent).toBe('')
    expect(screen.queryByRole('button', { name: 'Add skills' })).toBeNull()
  })

  test('a project whose skills cannot be read shows no line', async () => {
    onProjectSkills.mockRejectedValue(new Error('EACCES'))
    const { container } = render(<ProjectSkillsLine projectId="p1" />)
    await waitFor(() => expect(onProjectSkills).toHaveBeenCalled())
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(container.textContent).toBe('')
  })

  test('a save on the Skills page, over the line, is read at once: the card says it before the next read', async () => {
    const tickets = { title: 'Tickets and queue', skills: [skill('tickets', 'current', true)] }
    onProjectSkills.mockResolvedValueOnce(skills()).mockResolvedValue(skills({ groups: [tickets], uncommitted: ['tickets'] }))
    const { container } = render(<ProjectSkillsLine projectId="p1" />)
    await waitFor(() => expect(onProjectSkills.mock.results[0]?.type).toBe('return'))
    expect(container.textContent).toBe('')
    skillsSaved()
    await screen.findByRole('button', { name: 'Send to GitHub' })
  })

  test('a project that is unknown here shows no line', async () => {
    onProjectSkills.mockResolvedValue(null)
    const { container } = render(<ProjectSkillsLine projectId="gone" />)
    await waitFor(() => expect(onProjectSkills).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  test('a newer version is told by name, and Update writes those skills again and sends them, nothing else', async () => {
    onProjectSkills.mockResolvedValue(
      skills({ groups: [{ title: 'Tickets and queue', skills: [skill('tickets', 'newer'), skill('queue', 'newer'), skill('plan', 'changed')] }] }),
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
    onProjectSkills.mockResolvedValue(skills({ groups: [{ title: 'Subagents', skills: [skill('orchestration', 'newer')] }] }))
    const { container } = render(<ProjectSkillsLine projectId="p1" />)
    await screen.findByRole('button', { name: 'Update' })
    expect(container.textContent).toContain('The orchestration skill has a newer version.')
  })

  test('skills on this computer only are told with the one press that sends them; once agents have them the card is gone', async () => {
    const tickets = { title: 'Tickets and queue', skills: [skill('tickets', 'current', true), skill('queue', 'current', true), skill('plan', 'current')] }
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
    onProjectSkills.mockResolvedValue(skills({ groups: [{ title: 'Tickets and queue', skills: [skill('tickets', 'current', true)] }], local: true }))
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
    onProjectSkills.mockResolvedValue(skills({ groups: [{ title: 'Tickets and queue', skills: [skill('tickets', 'current', true)] }], remote: 'GitLab', branch: 'openagent/skills' }))
    const { container } = render(<ProjectSkillsLine projectId="p1" />)
    await waitFor(() => expect(container.textContent).toContain('The tickets skill is on the branch openagent/skills on GitLab. Merge it into main, and your agents get it.'))
    expect(screen.queryByRole('button', { name: 'Send to GitLab' })).toBeNull()
  })

  test('skills in a pull request are told with it; many are counted, not named', async () => {
    onProjectSkills.mockResolvedValue(
      skills({ groups: [{ title: 'Tickets and queue', skills: ['tickets', 'queue', 'plan', 'triage', 'ux'].map(name => skill(name, 'current', true)) }], request: { number: 12, url: 'https://example.com/pull/12' } }),
    )
    const { container } = render(<ProjectSkillsLine projectId="p1" />)
    const open = await screen.findByRole('link', { name: 'Open #12' })
    expect(open.getAttribute('href')).toBe('https://example.com/pull/12')
    expect(container.textContent).toContain('5 skills are in pull request #12. Your agents get them once it is merged.')
    expect(screen.queryByRole('button', { name: 'Send to GitHub' })).toBeNull()
  })
})

describe('the Skills page', () => {
  const card = (name: string): HTMLElement => box(name).closest('label')!

  test('in a project with no skills yet nothing is ticked: the person picks what it needs', async () => {
    onProjectSkills.mockResolvedValue(skills())
    sendChangeSkills.mockResolvedValue({ ok: true, written: ['tickets', 'queue', 'scheduler'], removed: [], left: [], scheduler: 'on' })
    sendProjectSkills.mockResolvedValue({ ok: true, sent: 'pushed', branch: 'main' })
    const told = vi.fn()
    const stop = onSkillsSaved(told)
    render(<SkillsSettings projectId="p1" />)
    expect(await screen.findByText('Tickets and queue')).toBeTruthy()
    expect(screen.getByText('What tickets does.')).toBeTruthy()
    expect([isTicked('tickets'), isTicked('queue'), isTicked('browser'), isTicked('scheduler')]).toEqual([false, false, false, false])
    tick('tickets', 'queue', 'scheduler')
    expect(screen.getByText('3 skills to write.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Save and send to GitHub' }))
    await waitFor(() => expect(sendChangeSkills).toHaveBeenCalledWith('p1', { write: ['tickets', 'queue', 'scheduler'], remove: [] }))
    expect(await screen.findByText(/Wrote 3 skills in/)).toBeTruthy()
    expect(document.body.textContent).toContain('tickets, queue, scheduler')
    // The same press sends what it wrote, and nothing else.
    await waitFor(() => expect(sendProjectSkills).toHaveBeenCalledWith('p1', ['tickets', 'queue', 'scheduler']))
    expect(await screen.findByText('Sent to GitHub, on main. Your agents get this change from their next start.')).toBeTruthy()
    expect(document.body.textContent).toContain('The scheduler is on for this project, on this machine. Every automation starts switched off.')
    // What shows the same skills under Settings is told: of the write, and again of the send.
    await waitFor(() => expect(told).toHaveBeenCalledTimes(2))
    stop()
  })

  test('each skill is a card of its own: a press anywhere on it ticks it, and it says how its text stands', async () => {
    onProjectSkills.mockResolvedValue(
      skills({ groups: [{ title: 'Tickets and queue', skills: [skill('tickets', 'newer'), skill('queue', 'changed', true), skill('plan', 'own'), skill('triage')] }] }),
    )
    render(<SkillsSettings projectId="p1" />)
    await screen.findByText('Tickets and queue')
    expect(card('tickets').textContent).toBe('ticketsa newer version is thereWhat tickets does.')
    expect(card('queue').textContent).toBe('queuechanged by hand · waiting to reach mainWhat queue does.')
    expect(card('plan').textContent).toBe('planyour own textWhat plan does.')
    expect(card('triage').textContent).toBe('triageWhat triage does.')
    expect(isTicked('triage')).toBe(false)
    fireEvent.click(screen.getByText('What triage does.'))
    expect(isTicked('triage')).toBe(true)
  })

  test('opened again the ticks show what the project has; a tick removed deletes, a tick added writes', async () => {
    onProjectSkills.mockResolvedValue(
      skills({ groups: [{ title: 'Tickets and queue', skills: [skill('tickets', 'current'), skill('queue', 'changed'), skill('plan')] }, { title: 'Needs its own setup', skills: [skill('browser')] }] }),
    )
    sendChangeSkills.mockResolvedValue({ ok: true, written: ['browser'], removed: ['tickets'], left: [{ path: '.agents/skills/tickets', reason: 'it holds other files' }] })
    sendProjectSkills.mockResolvedValue({ ok: true, sent: 'pushed', branch: 'main' })
    render(<SkillsSettings projectId="p1" />)
    await screen.findByText('Tickets and queue')
    expect([isTicked('tickets'), isTicked('queue'), isTicked('plan'), isTicked('browser')]).toEqual([true, true, false, false])
    expect(screen.getByText('Nothing to change.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(box('tickets'))
    fireEvent.click(box('browser'))
    expect(screen.getByText('1 skill to write, 1 skill to delete.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save and send to GitHub' }))
    await waitFor(() => expect(sendChangeSkills).toHaveBeenCalledWith('p1', { write: ['browser'], remove: ['tickets'] }))
    await waitFor(() => expect(sendProjectSkills).toHaveBeenCalledWith('p1', ['browser', 'tickets']))
    expect(await screen.findByText(/Deleted 1 skill/)).toBeTruthy()
    expect(document.body.textContent).toContain('Left as it is: .agents/skills/tickets (it holds other files).')
  })

  test('a default branch that takes no push: the page points to the pull request the change went to; Done is the cards, read again', async () => {
    onProjectSkills.mockResolvedValueOnce(skills()).mockResolvedValue(skills({ groups: [{ title: 'Tickets and queue', skills: [skill('tickets', 'current', true), skill('queue', 'current', true)] }] }))
    sendChangeSkills.mockResolvedValue({ ok: true, written: ['tickets', 'queue'], removed: [], left: [] })
    sendProjectSkills.mockResolvedValue({ ok: true, sent: 'request', request: { number: 12, url: 'https://example.com/pull/12' } })
    render(<SkillsSettings projectId="p1" />)
    await screen.findByText('Tickets and queue')
    tick('tickets', 'queue')
    fireEvent.click(screen.getByRole('button', { name: 'Save and send to GitHub' }))
    const link = await screen.findByRole('link', { name: 'pull request #12' })
    expect(link.getAttribute('href')).toBe('https://example.com/pull/12')
    expect(document.body.textContent).toContain('GitHub took no push to main, so the change is in pull request #12. Your agents get it once it is merged.')
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    await screen.findByText('Tickets and queue')
    expect(onProjectSkills).toHaveBeenCalledTimes(2)
    expect(card('tickets').textContent).toContain('waiting to reach main')
    expect(screen.getByText('Nothing to change.')).toBeTruthy()
  })

  test('a send that is refused after the save says the files are saved, and offers to send again', async () => {
    onProjectSkills.mockResolvedValue(skills())
    sendChangeSkills.mockResolvedValue({ ok: true, written: ['tickets', 'queue'], removed: [], left: [] })
    sendProjectSkills.mockResolvedValueOnce({ ok: false, error: 'could not reach the remote: network down' }).mockResolvedValue({ ok: true, sent: 'pushed', branch: 'main' })
    render(<SkillsSettings projectId="p1" />)
    await screen.findByText('Tickets and queue')
    tick('tickets', 'queue')
    fireEvent.click(screen.getByRole('button', { name: 'Save and send to GitHub' }))
    expect(await screen.findByText("Saved in the project's folder, not sent: could not reach the remote: network down")).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Send again' }))
    expect(await screen.findByText(/Sent to GitHub, on main\./)).toBeTruthy()
    expect(sendProjectSkills).toHaveBeenLastCalledWith('p1', ['tickets', 'queue'])
    expect(screen.queryByRole('button', { name: 'Send again' })).toBeNull()
  })

  test('a save that is refused says why and keeps the ticks; Cancel puts them back and writes nothing; a folder that is no repository is offered no commit', async () => {
    // A folder that is no repository: nothing to commit, and no branch agents start from.
    const { startBranch: _none, ...noRepository } = skills({ git: false, groups: [{ title: 'Tickets and queue', skills: [skill('tickets', 'current'), skill('queue')] }] })
    onProjectSkills.mockResolvedValue(noRepository)
    sendChangeSkills.mockResolvedValueOnce({ ok: false, error: 'EACCES: permission denied' }).mockResolvedValue({ ok: true, written: ['queue'], removed: [], left: [], schedulerError: 'hooks.yml: unreadable' })
    render(<SkillsSettings projectId="p1" />)
    await screen.findByText('Tickets and queue')
    const cancel = screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement
    // Nothing to cancel yet.
    expect(cancel.disabled).toBe(true)
    fireEvent.click(box('queue'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('EACCES: permission denied')).toBeTruthy()
    expect(isTicked('queue')).toBe(true)
    fireEvent.click(cancel)
    expect(isTicked('queue')).toBe(false)
    expect(screen.queryByText('EACCES: permission denied')).toBeNull()
    expect(screen.getByText('Nothing to change.')).toBeTruthy()
    expect(sendChangeSkills).toHaveBeenCalledTimes(1)

    fireEvent.click(box('queue'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('This folder is not a git repository, so there is nothing to commit.')).toBeTruthy()
    expect(document.body.textContent).toContain('The scheduler was not switched: hooks.yml: unreadable')
    expect(sendProjectSkills).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Send again' })).toBeNull()
  })

  test('skills that cannot be read, or a project unknown here, are said in place of the cards', async () => {
    onProjectSkills.mockRejectedValue(new Error('EACCES'))
    render(<SkillsSettings projectId="p1" />)
    expect((await screen.findByRole('alert')).textContent).toBe('This project’s skills could not be read.')
    cleanup()
    onProjectSkills.mockReset().mockResolvedValue(null)
    render(<SkillsSettings projectId="gone" />)
    expect((await screen.findByRole('alert')).textContent).toBe('This project’s skills could not be read.')
  })

  test('a project only another computer has: its skills are read by its id, and a save, which that computer does not take from here, says so and keeps the ticks', async () => {
    onProjectSkills.mockResolvedValue(skills())
    sendChangeSkills.mockResolvedValue({ ok: false, error: 'this project has no local path on this server' })
    render(<SkillsSettings projectId="shop~m1" />)
    await screen.findByText('Tickets and queue')
    tick('tickets', 'queue')
    expect(onProjectSkills).toHaveBeenCalledWith('shop~m1')
    fireEvent.click(screen.getByRole('button', { name: 'Save and send to GitHub' }))
    expect((await screen.findByRole('alert')).textContent).toBe('this project has no local path on this server')
    expect(isTicked('tickets')).toBe(true)
    expect(sendProjectSkills).not.toHaveBeenCalled()
  })
})

describe('the Skills page, over time', () => {
  test('the page a person has open keeps the project as it stood when it opened: no later read changes it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      onProjectSkills.mockResolvedValueOnce(skills()).mockResolvedValue(skills({ groups: [{ title: 'Tickets and queue', skills: [skill('tickets', 'current'), skill('queue')] }] }))
      render(<SkillsSettings projectId="p1" />)
      await screen.findByText('Tickets and queue')
      tick('tickets', 'queue', 'scheduler')
      expect(screen.getByText('3 skills to write.')).toBeTruthy()
      // The project now holds tickets (written in a terminal, say), and a minute passes.
      await vi.advanceTimersByTimeAsync(60_000)
      expect(onProjectSkills).toHaveBeenCalledTimes(1)
      expect(screen.getByText('3 skills to write.')).toBeTruthy()
      expect(screen.queryByText(/to delete/)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  test('in a project with no remote a commit is all agents need, and the page says so', async () => {
    onProjectSkills.mockResolvedValue(noRemote())
    sendChangeSkills.mockResolvedValue({ ok: true, written: ['tickets', 'queue'], removed: [], left: [] })
    sendProjectSkills.mockResolvedValue({ ok: true, sent: 'committed' })
    render(<SkillsSettings projectId="p1" />)
    expect((await screen.findByText(/Save commits the change\./)).textContent).toContain('Save commits the change.')
    tick('tickets', 'queue')
    fireEvent.click(screen.getByRole('button', { name: 'Save and commit' }))
    expect(await screen.findByText('Committed. Your agents get this change from their next start.')).toBeTruthy()
  })
})
