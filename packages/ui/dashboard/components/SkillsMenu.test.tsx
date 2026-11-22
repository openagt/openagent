import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { forgetRemembered } from '../lib/use-async.js'
import { hoverTooltip, openMenu } from '../test-utils.js'

// The plugins on in the project: ask and readability, each with its skill, and notify, with a step alone.
const CHOICES = vi.hoisted(() => ({
  core: [],
  plugins: [
    { name: 'ask', skills: ['ask'] },
    { name: 'readability', skills: ['readability'] },
    { name: 'notify', skills: [] },
  ],
}))
const onSkillChoices = vi.hoisted(() => vi.fn())
// The project's own skills, by name, as a run's checkout has them.
const onProjectSkillNames = vi.hoisted(() => vi.fn())
vi.mock('../rpc/skill-choices.js', () => ({ onSkillChoices, onProjectSkillNames }))
vi.mock('../rpc/profiles.js', () => ({
  onProfilesList: async () => ({
    profiles: [
      { id: 'default', name: 'Default', options: {} },
      { id: 'quiet', name: 'Quiet', options: { skills: { project: 'none' } } },
      { id: 'lean', name: 'Lean', options: { plugins: { without: ['readability'] } } },
    ],
    claude: [],
    codex: [],
    plugins: ['ask', 'readability', 'notify'],
  }),
}))
const openSettings = vi.hoisted(() => vi.fn())
vi.mock('../lib/host-services.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/host-services.js')>()
  return { ...actual, INERT_HOST_SERVICES: { ...actual.INERT_HOST_SERVICES, openSettings } }
})

const { NO_PICKS, SkillsMenu, SkillsOff, profilePicks, sessionSkills, skillPicksSaid } = await import('./SkillsMenu.js')

beforeEach(() => {
  onSkillChoices.mockResolvedValue(CHOICES)
})

afterEach(() => {
  cleanup()
  forgetRemembered()
  localStorage.clear()
  onProjectSkillNames.mockReset()
  onSkillChoices.mockReset()
  openSettings.mockReset()
})

const PROJECT = ['tickets', 'plan']

function renderMenu(over: Partial<Parameters<typeof SkillsMenu>[0]> = {}) {
  const onChange = vi.fn()
  render(<SkillsMenu projectId="p1" picks={NO_PICKS} onChange={onChange} busy={false} {...over} />)
  return onChange
}
const checked = (name: string) => screen.getByRole('menuitemcheckbox', { name }).getAttribute('aria-checked')

describe("the Skills menu under the launcher's box", () => {
  test("the button holds its place while the project's skills are read, with no count: it never draws the others' count alone and then changes it", async () => {
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

  test("the button counts what the session gets: the skills of the plugins on and the project's; the menu ticks each plugin on, lists the project's skills, and opens both in Settings", async () => {
    onProjectSkillNames.mockResolvedValue(PROJECT)
    renderMenu()
    const trigger = await screen.findByRole('button', { name: 'Skills: 4' })
    expect(onSkillChoices).toHaveBeenCalledWith('p1')
    expect((await hoverTooltip(trigger)).textContent).toBe('This session gets the skills of every plugin on, and every project skill')
    await openMenu(trigger)
    expect(screen.getByText('Plugins, this session')).toBeTruthy()
    expect(checked('ask')).toBe('true')
    expect(checked('readability')).toBe('true')
    expect(checked('notify')).toBe('true')
    expect(screen.getByText('Project skills')).toBeTruthy()
    expect(checked('tickets')).toBe('true')
    expect(checked('plan')).toBe('true')
    expect(screen.getByRole('menuitemradio', { name: 'All' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Project skills in Settings…' }))
    expect(openSettings).toHaveBeenCalledWith('skills', 'p1')
    await openMenu(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Plugins in Settings…' }))
    expect(openSettings).toHaveBeenLastCalledWith('plugins', 'p1')
  })

  test('a plugin unticked is one the session goes without, its skills with it; ticked again, it is back', async () => {
    onProjectSkillNames.mockResolvedValue(PROJECT)
    const onChange = renderMenu()
    await openMenu(await screen.findByRole('button', { name: 'Skills: 4' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'ask' }))
    expect(onChange).toHaveBeenLastCalledWith({ without: ['ask'] })
    cleanup()
    const again = renderMenu({ picks: { without: ['ask', 'notify'] } })
    const trigger = await screen.findByRole('button', { name: 'Skills: 3' })
    expect((await hoverTooltip(trigger)).textContent).toBe('This session gets the skills of every plugin on but ask and notify, and every project skill')
    await openMenu(trigger)
    expect(checked('ask')).toBe('false')
    expect(checked('notify')).toBe('false')
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'ask' }))
    expect(again).toHaveBeenLastCalledWith({ without: ['notify'] })
  })

  test("the project's skills: None, All, or each; the last one unticked is None, every one ticked is All", async () => {
    onProjectSkillNames.mockResolvedValue(PROJECT)
    const onChange = renderMenu()
    await openMenu(await screen.findByRole('button', { name: 'Skills: 4' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'None' }))
    expect(onChange).toHaveBeenLastCalledWith({ without: [], project: 'none' })
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'plan' }))
    expect(onChange).toHaveBeenLastCalledWith({ without: [], project: ['tickets'] })
    cleanup()
    const fromOne = renderMenu({ picks: { without: [], project: ['tickets'] } })
    await openMenu(await screen.findByRole('button', { name: 'Skills: 3' }))
    expect(checked('plan')).toBe('false')
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'tickets' }))
    expect(fromOne).toHaveBeenLastCalledWith({ without: [], project: 'none' })
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'plan' }))
    expect(fromOne).toHaveBeenLastCalledWith({ without: [] })
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'All' }))
    expect(fromOne).toHaveBeenLastCalledWith({ without: [] })
  })

  test('a session with no project has the plugins alone, those of a session with no project, and nothing to set; a project with no skills yet says so', async () => {
    renderMenu({ projectId: undefined })
    await openMenu(await screen.findByRole('button', { name: 'Skills: 2' }))
    expect(onSkillChoices).toHaveBeenCalledWith('session')
    expect(screen.queryByText('Project skills')).toBeNull()
    expect(screen.queryByText('Project skills in Settings…')).toBeNull()
    expect(screen.queryByText('Plugins in Settings…')).toBeNull()
    expect(onProjectSkillNames).not.toHaveBeenCalled()
    cleanup()
    onProjectSkillNames.mockResolvedValue([])
    renderMenu()
    await openMenu(await screen.findByRole('button', { name: 'Skills: 2' }))
    await waitFor(() => expect(screen.getByText('None yet')).toBeTruthy())
    expect(screen.queryByRole('menuitemradio', { name: 'All' })).toBeNull()
  })

  test('a project with no plugin on says so, and counts its core modules\' skills', async () => {
    onSkillChoices.mockResolvedValue({ core: ['github'], plugins: [] })
    onProjectSkillNames.mockResolvedValue([])
    renderMenu()
    await openMenu(await screen.findByRole('button', { name: 'Skills: 1' }))
    expect(screen.getByText('None on')).toBeTruthy()
  })

  test("a plugin's skill that the project holds too is counted once", async () => {
    onProjectSkillNames.mockResolvedValue(['ask', 'plan'])
    renderMenu()
    expect(await screen.findByRole('button', { name: 'Skills: 3' })).toBeTruthy()
  })

  test('nothing until the plugins to pick from are read', () => {
    onProjectSkillNames.mockResolvedValue(PROJECT)
    onSkillChoices.mockReturnValue(new Promise(() => {}))
    renderMenu()
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('what the picks say', () => {
  test('a session starts on its profile with every plugin on but the ones it leaves out, and from the project skills it names', () => {
    expect(profilePicks(undefined)).toEqual(NO_PICKS)
    expect(profilePicks({ options: {} })).toEqual(NO_PICKS)
    expect(profilePicks({ options: { skills: { project: 'all' } } })).toEqual(NO_PICKS)
    expect(profilePicks({ options: { skills: { project: 'none' } } })).toEqual({ without: [], project: 'none' })
    expect(profilePicks({ options: { skills: { project: ['tickets'] } } })).toEqual({ without: [], project: ['tickets'] })
    expect(profilePicks({ options: { plugins: { without: ['ask'] }, skills: { project: 'none' } } })).toEqual({ without: ['ask'], project: 'none' })
  })

  test("the skills a session gets of its modules': the core modules', then those of each plugin it does not go without", () => {
    expect(sessionSkills(CHOICES, [])).toEqual(['ask', 'readability'])
    expect(sessionSkills(CHOICES, ['readability'])).toEqual(['ask'])
    expect(sessionSkills({ core: ['github'], plugins: CHOICES.plugins }, ['ask'])).toEqual(['github', 'readability'])
  })

  test('in words, for a hover', () => {
    expect(skillPicksSaid({})).toBe('the skills of every plugin on, and every project skill')
    expect(skillPicksSaid({ projectSkills: 'all' })).toBe('the skills of every plugin on, and every project skill')
    expect(skillPicksSaid({ pluginsWithout: ['ask', 'tickets', 'queue'], projectSkills: 'none' })).toBe('the skills of every plugin on but ask, tickets and queue, and no project skill')
    expect(skillPicksSaid({ projectSkills: ['tickets', 'plan'] })).toBe('the skills of every plugin on, and the project skills tickets and plan')
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
    render(<SkillsOff projectId="p1" profile={undefined} pluginsWithout={['readability']} projectSkills={['tickets']} />)
    // The plugins' two less readability's, and one of the project's two.
    const said = await skillsSaid(2)
    expect(said.tabIndex).toBe(0)
    expect(screen.queryByRole('button')).toBeNull()
    expect((await hoverTooltip(said)).textContent).toBe('This session got the skills of every plugin on but readability, and the project skills tickets')
    cleanup()
    render(<SkillsOff projectId={undefined} profile="default" />)
    const alone = await skillsSaid(2)
    expect((await hoverTooltip(alone)).textContent).toBe('This session got the skills of every plugin on, and no project skill')
  })

  test("a session that picked no project skills got its profile's", async () => {
    onProjectSkillNames.mockResolvedValue(['tickets', 'queue'])
    render(<SkillsOff projectId="p1" profile="quiet" />)
    const said = await skillsSaid(2)
    expect((await hoverTooltip(said)).textContent).toBe('This session got the skills of every plugin on, and no project skill')
    cleanup()
    render(<SkillsOff projectId="p1" profile="quiet" projectSkills="all" />)
    expect(await skillsSaid(4)).toBeTruthy()
  })

  test("a session that picked no plugins went without its profile's; one that picked none of them got every plugin on", async () => {
    onProjectSkillNames.mockResolvedValue(['tickets', 'queue'])
    render(<SkillsOff projectId="p1" profile="lean" />)
    const said = await skillsSaid(3)
    expect((await hoverTooltip(said)).textContent).toBe('This session got the skills of every plugin on but readability, and every project skill')
    cleanup()
    render(<SkillsOff projectId="p1" profile="lean" pluginsWithout={[]} />)
    expect(await skillsSaid(4)).toBeTruthy()
  })

  test("a plugin's skill that the project holds too is counted once, as the launcher counts it", async () => {
    onProjectSkillNames.mockResolvedValue(['ask', 'tickets'])
    render(<SkillsOff projectId="p1" profile="default" />)
    expect(await skillsSaid(3)).toBeTruthy()
  })

  test('a session opened again after a reload has its Skills from the first frame, so nothing after it in the row moves', async () => {
    onProjectSkillNames.mockResolvedValue(['tickets'])
    render(<SkillsOff projectId="p1" profile="default" />)
    await skillsSaid(3)
    cleanup()
    // The reload: the page's memory gone, this browser's store as the last load left it, the reads not answered yet.
    forgetRemembered()
    onProjectSkillNames.mockReturnValue(new Promise(() => {}))
    onSkillChoices.mockReturnValue(new Promise(() => {}))
    render(<SkillsOff projectId="p1" profile="default" />)
    expect(screen.getByText((_, el) => el?.getAttribute('tabindex') === '0' && el.textContent!.startsWith('Skills: 3.'))).toBeTruthy()
  })
})
