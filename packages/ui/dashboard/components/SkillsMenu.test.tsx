import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { forgetRemembered } from '../lib/use-async.js'
import { hoverTooltip, openMenu } from '../test-utils.js'

// Every run gets ask and readability; github and ux are the others carried.
const CHOICES = vi.hoisted(() => ({
  everyRun: [{ name: 'ask', description: '' }, { name: 'readability', description: '' }],
  more: [{ title: 'Code reviews', skills: [{ name: 'github', description: '' }, { name: 'ux', description: '' }] }],
}))
const onSkillChoices = vi.hoisted(() => vi.fn())
// The project's own skills, by name, as a run's checkout has them.
const onProjectSkillNames = vi.hoisted(() => vi.fn())
vi.mock('../rpc/skill-choices.js', () => ({ onSkillChoices, onProjectSkillNames }))
vi.mock('../rpc/presets.js', () => ({ onPresetsList: async () => ({ presets: [{ id: 'default', name: 'Default', options: {} }, { id: 'quiet', name: 'Quiet', options: { skills: { project: 'none' } } }], claude: [], codex: [] }) }))
const openSettings = vi.hoisted(() => vi.fn())
vi.mock('../lib/host-services.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/host-services.js')>()
  return { ...actual, INERT_HOST_SERVICES: { ...actual.INERT_HOST_SERVICES, openSettings } }
})

const { NO_PICKS, SkillsMenu, SkillsOff, presetPicks, sessionSkills, skillPicksSaid } = await import('./SkillsMenu.js')

beforeEach(() => {
  onSkillChoices.mockResolvedValue(CHOICES)
})

afterEach(() => {
  cleanup()
  forgetRemembered()
  localStorage.clear()
  onProjectSkillNames.mockReset()
  onSkillChoices.mockReset()
})

const PROJECT = ['tickets', 'plan']

function renderMenu(over: Partial<Parameters<typeof SkillsMenu>[0]> = {}) {
  const onChange = vi.fn()
  render(<SkillsMenu projectId="p1" picks={NO_PICKS} onChange={onChange} busy={false} {...over} />)
  return onChange
}
const checked = (name: string) => screen.getByRole('menuitemcheckbox', { name }).getAttribute('aria-checked')

describe('the Skills menu under the launcher\'s box', () => {
  test('the button holds its place while the project\'s skills are read, with no count: it never draws the others\' count alone and then changes it', async () => {
    let read: (v: unknown) => void = () => {}
    onProjectSkillNames.mockReturnValue(new Promise(resolve => (read = resolve)))
    renderMenu()
    await new Promise(resolve => setTimeout(resolve, 20))
    const held = screen.getByRole('button', { name: 'Skills' })
    expect(held.hasAttribute('disabled') || held.getAttribute('aria-disabled') === 'true' || held.hasAttribute('data-disabled')).toBe(true)
    expect(held.textContent).not.toMatch(/\d/)
    read(PROJECT)
    expect(await screen.findByRole('button', { name: 'Skills: 4' })).toBeTruthy()
  })

  test('the button counts what the session gets: the skills every run gets and the project\'s; the menu ticks the former, lists the project\'s, and opens their list in Settings', async () => {
    onProjectSkillNames.mockResolvedValue(PROJECT)
    renderMenu()
    const trigger = await screen.findByRole('button', { name: 'Skills: 4' })
    expect((await hoverTooltip(trigger)).textContent).toBe('This session gets the skills every run gets, and every project skill')
    await openMenu(trigger)
    expect(screen.getByText('Skills, this session')).toBeTruthy()
    expect(checked('ask')).toBe('true')
    expect(checked('readability')).toBe('true')
    expect(screen.queryByRole('menuitemcheckbox', { name: 'ux' })).toBeNull()
    expect(screen.getByText('More skills')).toBeTruthy()
    expect(screen.getByText('Project skills')).toBeTruthy()
    expect(checked('tickets')).toBe('true')
    expect(checked('plan')).toBe('true')
    expect(screen.queryByRole('menuitemcheckbox', { name: 'queue' })).toBeNull()
    expect(screen.getByRole('menuitemradio', { name: 'All' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Project skills in Settings…' }))
    expect(openSettings).toHaveBeenCalledWith('skills', 'p1')
  })

  test('a skill every run gets, unticked, is off for this session; one of the others ticked is on; a tick on one that is on takes it back', async () => {
    onProjectSkillNames.mockResolvedValue(PROJECT)
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
    onProjectSkillNames.mockResolvedValue(PROJECT)
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

  test('a session with no project has the first part alone; a project with no skills yet says so', async () => {
    renderMenu({ projectId: undefined })
    await openMenu(await screen.findByRole('button', { name: 'Skills: 2' }))
    expect(screen.queryByText('Project skills')).toBeNull()
    expect(screen.queryByText('Project skills in Settings…')).toBeNull()
    expect(onProjectSkillNames).not.toHaveBeenCalled()
    cleanup()
    onProjectSkillNames.mockResolvedValue([])
    renderMenu()
    await openMenu(await screen.findByRole('button', { name: 'Skills: 2' }))
    await waitFor(() => expect(screen.getByText('None yet')).toBeTruthy())
    expect(screen.queryByRole('menuitemradio', { name: 'All' })).toBeNull()
  })

  test('a skill every run gets that the project holds too is counted once', async () => {
    onProjectSkillNames.mockResolvedValue(['ask', 'plan'])
    renderMenu()
    expect(await screen.findByRole('button', { name: 'Skills: 3' })).toBeTruthy()
  })

  test('nothing until the skills to pick from are read', () => {
    onProjectSkillNames.mockResolvedValue(PROJECT)
    onSkillChoices.mockReturnValue(new Promise(() => {}))
    renderMenu()
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('what the picks say', () => {
  test('a session starts from no pick on its preset, and from the project skills it names', () => {
    expect(presetPicks(undefined)).toBe(NO_PICKS)
    expect(presetPicks({ options: {} })).toBe(NO_PICKS)
    expect(presetPicks({ options: { skills: { project: 'all' } } })).toBe(NO_PICKS)
    expect(presetPicks({ options: { skills: { project: 'none' } } })).toEqual({ on: [], off: [], project: 'none' })
    expect(presetPicks({ options: { skills: { project: ['tickets'] } } })).toEqual({ on: [], off: [], project: ['tickets'] })
  })

  test('the skills a session gets of the ones every run gets: those less the ones off, then the ones on', () => {
    expect(sessionSkills(['ask', 'readability'], NO_PICKS)).toEqual(['ask', 'readability'])
    expect(sessionSkills(['ask', 'readability'], { on: ['ux', 'ask'], off: ['readability'] })).toEqual(['ask', 'ux'])
    expect(sessionSkills([], { on: ['ux'], off: [] })).toEqual(['ux'])
  })

  test('in words, for a hover', () => {
    expect(skillPicksSaid({})).toBe('the skills every run gets, and every project skill')
    expect(skillPicksSaid({ projectSkills: 'all' })).toBe('the skills every run gets, and every project skill')
    expect(skillPicksSaid({ skillsOn: ['ux'], skillsOff: ['ask', 'github'], projectSkills: 'none' })).toBe('the skills every run gets with ux, without ask, github, and no project skill')
    expect(skillPicksSaid({ projectSkills: ['tickets', 'plan'] })).toBe('the skills every run gets, and the project skills tickets, plan')
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
    onProjectSkillNames.mockResolvedValue(['tickets', 'queue'])
    render(<SkillsOff projectId="p1" preset={undefined} skillsOff={['readability']} projectSkills={['tickets']} />)
    // The two every run gets less readability, and one of the project's two.
    const said = await skillsSaid(2)
    expect(said.tabIndex).toBe(0)
    expect(screen.queryByRole('button')).toBeNull()
    expect((await hoverTooltip(said)).textContent).toBe('This session got the skills every run gets without readability, and the project skills tickets')
    cleanup()
    render(<SkillsOff projectId={undefined} preset="default" skillsOn={['plan']} />)
    const alone = await skillsSaid(3)
    expect((await hoverTooltip(alone)).textContent).toBe('This session got the skills every run gets with plan, and no project skill')
  })

  test("a session that picked no project skills got its preset's", async () => {
    onProjectSkillNames.mockResolvedValue(['tickets', 'queue'])
    render(<SkillsOff projectId="p1" preset="quiet" />)
    const said = await skillsSaid(2)
    expect((await hoverTooltip(said)).textContent).toBe('This session got the skills every run gets, and no project skill')
    cleanup()
    render(<SkillsOff projectId="p1" preset="quiet" projectSkills="all" />)
    expect(await skillsSaid(4)).toBeTruthy()
  })

  test('a skill every run gets that the project holds too is counted once, as the launcher counts it', async () => {
    onProjectSkillNames.mockResolvedValue(['ask', 'tickets'])
    render(<SkillsOff projectId="p1" preset="default" />)
    expect(await skillsSaid(3)).toBeTruthy()
  })

  test('a session opened again after a reload has its Skills from the first frame, so nothing after it in the row moves', async () => {
    onProjectSkillNames.mockResolvedValue(['tickets'])
    render(<SkillsOff projectId="p1" preset="default" />)
    await skillsSaid(3)
    cleanup()
    // The reload: the page's memory gone, this browser's store as the last load left it, the reads not answered yet.
    forgetRemembered()
    onProjectSkillNames.mockReturnValue(new Promise(() => {}))
    onSkillChoices.mockReturnValue(new Promise(() => {}))
    render(<SkillsOff projectId="p1" preset="default" />)
    expect(screen.getByText((_, el) => el?.getAttribute('tabindex') === '0' && el.textContent!.startsWith('Skills: 3.'))).toBeTruthy()
  })
})
