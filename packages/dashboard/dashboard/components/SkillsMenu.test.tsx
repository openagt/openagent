import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { skillsSaved } from '../lib/skills-saved.js'
import { forgetRemembered } from '../lib/use-async.js'
import { hoverTooltip, openMenu } from '../test-utils.js'

const onProjectSkills = vi.hoisted(() => vi.fn())
vi.mock('../rpc/skills.js', () => ({ onProjectSkills }))
vi.mock('../rpc/agents.js', () => ({ onAgentsList: async () => ({ agents: [{ id: 'default', name: 'Default', skills: ['ask', 'github', 'readability'], accounts: {}, projectSkills: true }], skills: [], claude: [], codex: [] }) }))
const openSettings = vi.hoisted(() => vi.fn())
vi.mock('../lib/use-route.js', () => ({ openSettings }))

const { NO_PICKS, SkillsMenu, SkillsOff, agentPicks, sessionSkills, skillPicksSaid } = await import('./SkillsMenu.js')

afterEach(() => {
  cleanup()
  forgetRemembered()
  localStorage.clear()
  onProjectSkills.mockReset()
})

const REVIEWER = { id: 'reviewer', name: 'Reviewer', skills: ['ask', 'readability'], accounts: {}, projectSkills: true }
const GROUPS = [
  { title: 'Every agent starts with', skills: [{ name: 'ask', description: '' }, { name: 'github', description: '' }] },
  { title: 'Code reviews', skills: [{ name: 'readability', description: '' }, { name: 'ux', description: '' }] },
]
const PROJECT = { groups: [{ title: 'Tickets and queue', skills: [{ name: 'tickets', standing: 'current', waiting: false }, { name: 'queue', standing: 'absent', waiting: false }] }], uncommitted: [], git: true, local: false, held: ['tickets', 'plan'] }

function renderMenu(over: Partial<Parameters<typeof SkillsMenu>[0]> = {}) {
  const onChange = vi.fn()
  render(<SkillsMenu projectId="p1" agent={REVIEWER} groups={GROUPS} picks={NO_PICKS} onChange={onChange} busy={false} {...over} />)
  return onChange
}
const checked = (name: string) => screen.getByRole('menuitemcheckbox', { name }).getAttribute('aria-checked')

describe('the Skills menu under the launcher\'s box', () => {
  test('the button waits for the project\'s skills: it never draws the agent\'s count alone and then changes it', async () => {
    let read: (v: unknown) => void = () => {}
    onProjectSkills.mockReturnValue(new Promise(resolve => (read = resolve)))
    renderMenu()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(screen.queryByRole('button', { name: /^Skills/ })).toBeNull()
    read(PROJECT)
    expect(await screen.findByRole('button', { name: 'Skills: 4' })).toBeTruthy()
  })

  test('the button counts what the session gets: its agent\'s skills and the project\'s; the menu ticks the agent\'s, lists the project\'s, and opens its Skills page', async () => {
    onProjectSkills.mockResolvedValue(PROJECT)
    renderMenu()
    const trigger = await screen.findByRole('button', { name: 'Skills: 4' })
    expect((await hoverTooltip(trigger)).textContent).toBe("This session gets its agent's skills, and every project skill")
    await openMenu(trigger)
    expect(screen.getByText("Reviewer's skills, this session")).toBeTruthy()
    expect(checked('ask')).toBe('true')
    expect(checked('readability')).toBe('true')
    expect(screen.queryByRole('menuitemcheckbox', { name: 'ux' })).toBeNull()
    expect(screen.getByText('More skills')).toBeTruthy()
    expect(screen.getByText('Project skills')).toBeTruthy()
    expect(checked('tickets')).toBe('true')
    expect(checked('plan')).toBe('true')
    expect(screen.queryByRole('menuitemcheckbox', { name: 'queue' })).toBeNull()
    expect(screen.getByRole('menuitemradio', { name: 'All' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Manage project skills…' }))
    expect(openSettings).toHaveBeenCalledWith('skills', 'p1')
  })

  test('an agent\'s skill unticked is off for this session; one of the others ticked is on; a tick on one that is on takes it back', async () => {
    onProjectSkills.mockResolvedValue(PROJECT)
    const onChange = renderMenu()
    await openMenu(await screen.findByRole('button', { name: 'Skills: 4' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'ask' }))
    expect(onChange).toHaveBeenLastCalledWith({ on: [], off: ['ask'] })
    fireEvent.click(screen.getByText('More skills'))
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'ux' }))
    expect(onChange).toHaveBeenLastCalledWith({ on: ['ux'], off: [] })
    cleanup()
    const again = renderMenu({ picks: { on: ['ux'], off: ['ask'] } })
    await openMenu(await screen.findByRole('button', { name: 'Skills: 4' }))
    expect(checked('ask')).toBe('false')
    expect(checked('ux')).toBe('true')
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'ux' }))
    expect(again).toHaveBeenLastCalledWith({ on: [], off: ['ask'] })
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'ask' }))
    expect(again).toHaveBeenLastCalledWith({ on: ['ux'], off: [] })
  })

  test('the project\'s skills: None, All, or each; the last one unticked is None, every one ticked is All', async () => {
    onProjectSkills.mockResolvedValue(PROJECT)
    const onChange = renderMenu()
    await openMenu(await screen.findByRole('button', { name: 'Skills: 4' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'None' }))
    expect(onChange).toHaveBeenLastCalledWith({ on: [], off: [], project: 'none' })
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'plan' }))
    expect(onChange).toHaveBeenLastCalledWith({ on: [], off: [], project: ['tickets'] })
    cleanup()
    const fromOne = renderMenu({ picks: { on: [], off: [], project: ['tickets'] } })
    await openMenu(await screen.findByRole('button', { name: 'Skills: 3' }))
    expect(checked('plan')).toBe('false')
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'tickets' }))
    expect(fromOne).toHaveBeenLastCalledWith({ on: [], off: [], project: 'none' })
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'plan' }))
    expect(fromOne).toHaveBeenLastCalledWith({ on: [], off: [] })
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'All' }))
    expect(fromOne).toHaveBeenLastCalledWith({ on: [], off: [] })
  })

  test('a session with no project has the agent part alone; a project with no skills yet says so', async () => {
    renderMenu({ projectId: undefined })
    await openMenu(await screen.findByRole('button', { name: 'Skills: 2' }))
    expect(screen.queryByText('Project skills')).toBeNull()
    expect(screen.queryByText('Manage project skills…')).toBeNull()
    expect(onProjectSkills).not.toHaveBeenCalled()
    cleanup()
    onProjectSkills.mockResolvedValue({ ...PROJECT, groups: [], held: [] })
    renderMenu()
    await openMenu(await screen.findByRole('button', { name: 'Skills: 2' }))
    await waitFor(() => expect(screen.getByText('None yet')).toBeTruthy())
    expect(screen.queryByRole('menuitemradio', { name: 'All' })).toBeNull()
  })

  test('a skill the agent has and the project holds too is counted once', async () => {
    onProjectSkills.mockResolvedValue({ ...PROJECT, held: ['ask', 'plan'] })
    renderMenu()
    expect(await screen.findByRole('button', { name: 'Skills: 3' })).toBeTruthy()
  })

  test('a session opened again after a reload has its Skills from the first frame, so nothing after it in the row moves', async () => {
    onProjectSkills.mockResolvedValue({ held: ['tickets'] })
    render(<SkillsOff projectId="p1" agent="default" />)
    await skillsSaid(4)
    cleanup()
    // The reload: the page's memory gone, this browser's store as the last load left it, the reads not answered yet.
    forgetRemembered()
    onProjectSkills.mockReturnValue(new Promise(() => {}))
    render(<SkillsOff projectId="p1" agent="default" />)
    expect(screen.getByText((_, el) => el?.getAttribute('tabindex') === '0' && el.textContent!.startsWith('Skills: 4.'))).toBeTruthy()
  })

  test('a save on the Skills page is counted at once', async () => {
    onProjectSkills.mockResolvedValue(PROJECT)
    renderMenu()
    await screen.findByRole('button', { name: 'Skills: 4' })
    onProjectSkills.mockResolvedValue({ ...PROJECT, held: ['tickets', 'plan', 'queue'] })
    skillsSaved()
    expect(await screen.findByRole('button', { name: 'Skills: 5' })).toBeTruthy()
  })

  test('nothing until the agents are read', () => {
    onProjectSkills.mockResolvedValue(PROJECT)
    renderMenu({ agent: undefined })
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('what the picks say', () => {
  test('a session starts from no pick on its agent, and from no project skill on one set to never pick them up', () => {
    expect(agentPicks(REVIEWER)).toBe(NO_PICKS)
    expect(agentPicks(undefined)).toBe(NO_PICKS)
    expect(agentPicks({ projectSkills: false })).toEqual({ on: [], off: [], project: 'none' })
  })

  test('the skills a session gets of its agent\'s: the agent\'s less the ones off, then the ones on', () => {
    expect(sessionSkills(REVIEWER, NO_PICKS)).toEqual(['ask', 'readability'])
    expect(sessionSkills(REVIEWER, { on: ['ux', 'ask'], off: ['readability'] })).toEqual(['ask', 'ux'])
    expect(sessionSkills(undefined, { on: ['ux'], off: [] })).toEqual(['ux'])
  })

  test('in words, for a hover', () => {
    expect(skillPicksSaid({})).toBe("its agent's skills, and every project skill")
    expect(skillPicksSaid({ skillsOn: ['ux'], skillsOff: ['ask', 'github'], projectSkills: 'none' })).toBe("its agent's skills with ux, without ask, github, and no project skill")
    expect(skillPicksSaid({ projectSkills: ['tickets', 'plan'] })).toBe("its agent's skills, and the project skills tickets, plan")
  })
})

// What each item's hover says is on the page as a line, and its trigger is what holds the button.
vi.mock('./ui/tooltip.js', async () => {
  const actual = await vi.importActual<typeof import('./ui/tooltip.js')>('./ui/tooltip.js')
  return { ...actual, __esModule: true }
})

/** The session's Skills words, found as the keyboard and a screen reader meet them: "Skills: ", the count, then why they stay. */
const skillsSaid = (count: number) => screen.findByText((_, el) => el?.getAttribute('tabindex') === '0' && el.textContent!.startsWith(`Skills: ${count}.`))

describe("the session page's Skills, as words", () => {
  test('words the keyboard stops on, counted as the launcher counts, their hover saying what the session got', async () => {
    onProjectSkills.mockResolvedValue({ held: ['tickets', 'queue'] })
    render(<SkillsOff projectId="p1" agent={undefined} skillsOff={['github']} projectSkills={['tickets']} />)
    // The default agent's three less github, and one of the project's two.
    const said = await skillsSaid(3)
    expect(said.tabIndex).toBe(0)
    expect(screen.queryByRole('button')).toBeNull()
    expect((await hoverTooltip(said)).textContent).toBe("This session got its agent's skills without github, and the project skills tickets")
    cleanup()
    render(<SkillsOff projectId={undefined} agent="default" skillsOn={['plan']} />)
    const alone = await skillsSaid(4)
    expect((await hoverTooltip(alone)).textContent).toBe("This session got its agent's skills with plan, and no project skill")
  })

  test('a skill its agent has and the project holds too is counted once, as the launcher counts it', async () => {
    onProjectSkills.mockResolvedValue({ held: ['ask', 'tickets'] })
    render(<SkillsOff projectId="p1" agent="default" />)
    expect(await skillsSaid(4)).toBeTruthy()
  })

  test('a session opened again after a reload has its Skills from the first frame, so nothing after it in the row moves', async () => {
    onProjectSkills.mockResolvedValue({ held: ['tickets'] })
    render(<SkillsOff projectId="p1" agent="default" />)
    await skillsSaid(4)
    cleanup()
    // The reload: the page's memory gone, this browser's store as the last load left it, the reads not answered yet.
    forgetRemembered()
    onProjectSkills.mockReturnValue(new Promise(() => {}))
    render(<SkillsOff projectId="p1" agent="default" />)
    expect(screen.getByText((_, el) => el?.getAttribute('tabindex') === '0' && el.textContent!.startsWith('Skills: 4.'))).toBeTruthy()
  })

  test('a save on the Skills page is counted at once', async () => {
    onProjectSkills.mockResolvedValue({ held: ['tickets'] })
    render(<SkillsOff projectId="p1" agent="default" />)
    await skillsSaid(4)
    onProjectSkills.mockResolvedValue({ held: ['tickets', 'queue'] })
    skillsSaved()
    expect(await skillsSaid(5)).toBeTruthy()
  })
})
