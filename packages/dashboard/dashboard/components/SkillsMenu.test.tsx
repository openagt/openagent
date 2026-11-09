import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { forgetRemembered } from '../lib/use-async.js'
import { hoverTooltip, openMenu } from '../test-utils.js'

const onProjectSkills = vi.hoisted(() => vi.fn())
vi.mock('../rpc/skills.js', () => ({ onProjectSkills }))
const openSettings = vi.hoisted(() => vi.fn())
vi.mock('../lib/use-route.js', () => ({ openSettings }))

const { NO_PICKS, SkillsMenu, SkillsOff, agentPicks, sessionSkills, skillPicksSaid } = await import('./SkillsMenu.js')

afterEach(() => {
  cleanup()
  forgetRemembered()
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
    expect(screen.getByRole('menuitem', { name: 'All' }).getAttribute('aria-current')).toBe('true')
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
    fireEvent.click(screen.getByRole('menuitem', { name: 'None' }))
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
    fireEvent.click(screen.getByRole('menuitem', { name: 'All' }))
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
    expect(screen.queryByRole('menuitem', { name: 'All' })).toBeNull()
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

describe("the session page's Skills, off", () => {
  test('off, in the launcher\'s look, its hover saying what the session got', async () => {
    render(<SkillsOff skillsOff={['github']} projectSkills={['tickets']} />)
    const item = screen.getByRole('button', { name: 'Skills' }) as HTMLButtonElement
    expect(item.disabled).toBe(true)
    expect((await hoverTooltip(item.parentElement!)).textContent).toBe("This session got its agent's skills without github, and the project skills tickets")
    cleanup()
    render(<SkillsOff noProject />)
    expect((await hoverTooltip((screen.getByRole('button', { name: 'Skills' }) as HTMLButtonElement).parentElement!)).textContent).toBe("This session got its agent's skills, and no project skill")
  })
})
