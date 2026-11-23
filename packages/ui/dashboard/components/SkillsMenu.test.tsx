import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { forgetRemembered } from '../lib/use-async.js'
import { GearMenu, gear, hoverTooltip, openMenu, openSetupLine, setupLine } from '../test-utils.js'

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

const { NO_PICKS, SkillsMenu, SkillsOff, profilePicks, sessionSkills, skillPicksSaid, useRecordedSkillCount, useSkillCount } = await import('./SkillsMenu.js')

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
  render(<GearMenu lines={<SkillsMenu projectId="p1" picks={NO_PICKS} onChange={onChange} {...over} />} />)
  return onChange
}
/** The gear's "Skills" line, once it counts `count`. */
const counting = async (count: number): Promise<HTMLElement> => {
  await openMenu(gear())
  return await waitFor(() => {
    const line = screen.getAllByRole('menuitem').find(item => item.textContent === `Skills: ${count}`)
    if (!line) throw new Error(`no "Skills: ${count}" line`)
    return line
  })
}
/** Its list, open. */
const openCounting = async (count: number): Promise<void> => openMenu(await counting(count))
const checked = (name: string) => screen.getByRole('menuitemcheckbox', { name }).getAttribute('aria-checked')

describe("the Skills line of the launcher's gear menu", () => {
  test("the line holds its place while the project's skills are read, with no count: it never draws the others' count alone and then changes it", async () => {
    let read: (v: unknown) => void = () => {}
    onProjectSkillNames.mockReturnValue(new Promise(resolve => (read = resolve)))
    renderMenu()
    const held = await setupLine('Skills')
    expect(held.textContent).toBe('Skills: ')
    await act(async () => read(PROJECT))
    expect(await counting(4)).toBeTruthy()
  })

  test("the line counts what the session gets: the skills of the plugins on and the project's; its list ticks each plugin on, lists the project's skills, and opens both in Settings", async () => {
    onProjectSkillNames.mockResolvedValue(PROJECT)
    renderMenu()
    await openCounting(4)
    expect(onSkillChoices).toHaveBeenCalledWith('p1')
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
    await waitFor(() => expect(screen.queryByRole('menu') === null && !gear().hasAttribute('data-popup-open')).toBe(true))
    await openSetupLine('Skills')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Plugins in Settings…' }))
    expect(openSettings).toHaveBeenLastCalledWith('plugins', 'p1')
  })

  test('a plugin unticked is one the session goes without, its skills with it; ticked again, it is back', async () => {
    onProjectSkillNames.mockResolvedValue(PROJECT)
    const onChange = renderMenu()
    await openCounting(4)
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'ask' }))
    expect(onChange).toHaveBeenLastCalledWith({ without: ['ask'] })
    cleanup()
    const again = renderMenu({ picks: { without: ['ask', 'notify'] } })
    await openCounting(3)
    expect(checked('ask')).toBe('false')
    expect(checked('notify')).toBe('false')
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'ask' }))
    expect(again).toHaveBeenLastCalledWith({ without: ['notify'] })
  })

  test("the project's skills: None, All, or each; the last one unticked is None, every one ticked is All", async () => {
    onProjectSkillNames.mockResolvedValue(PROJECT)
    const onChange = renderMenu()
    await openCounting(4)
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'None' }))
    expect(onChange).toHaveBeenLastCalledWith({ without: [], project: 'none' })
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'plan' }))
    expect(onChange).toHaveBeenLastCalledWith({ without: [], project: ['tickets'] })
    cleanup()
    const fromOne = renderMenu({ picks: { without: [], project: ['tickets'] } })
    await openCounting(3)
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
    await openCounting(2)
    expect(onSkillChoices).toHaveBeenCalledWith('session')
    expect(screen.queryByText('Project skills')).toBeNull()
    expect(screen.queryByText('Project skills in Settings…')).toBeNull()
    expect(screen.queryByText('Plugins in Settings…')).toBeNull()
    expect(onProjectSkillNames).not.toHaveBeenCalled()
    cleanup()
    onProjectSkillNames.mockResolvedValue([])
    renderMenu()
    await openCounting(2)
    await waitFor(() => expect(screen.getByText('None yet')).toBeTruthy())
    expect(screen.queryByRole('menuitemradio', { name: 'All' })).toBeNull()
  })

  test('a project with no plugin on says so, and counts its core modules\' skills', async () => {
    onSkillChoices.mockResolvedValue({ core: ['github'], plugins: [] })
    onProjectSkillNames.mockResolvedValue([])
    renderMenu()
    await openCounting(1)
    expect(screen.getByText('None on')).toBeTruthy()
  })

  test("a plugin's skill that the project holds too is counted once", async () => {
    onProjectSkillNames.mockResolvedValue(['ask', 'plan'])
    renderMenu()
    expect(await counting(3)).toBeTruthy()
  })

  test('no line until the plugins to pick from are read', async () => {
    onProjectSkillNames.mockResolvedValue(PROJECT)
    onSkillChoices.mockReturnValue(new Promise(() => {}))
    renderMenu()
    await openMenu(gear())
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(screen.queryAllByRole('menuitem')).toEqual([])
  })
})

describe("the count the gear's hover says", () => {
  /** The two counts, as a page reads them. */
  function Counts({ projectId, picks, recorded }: { projectId: string | undefined; picks?: Parameters<typeof useSkillCount>[1]; recorded?: { profile?: string; pluginsWithout?: string[]; projectSkills?: 'all' | 'none' | string[] } }) {
    const picked = useSkillCount(projectId, picks ?? NO_PICKS)
    const kept = useRecordedSkillCount(projectId, recorded?.profile, recorded?.pluginsWithout, recorded?.projectSkills)
    return <output data-testid="counts">{`${picked ?? 'none'}/${kept ?? 'none'}`}</output>
  }
  const counts = () => screen.getByTestId('counts').textContent

  test("the launcher's: as its line counts the picks, and none until the plugins and the project's skills are read", async () => {
    let read: (v: unknown) => void = () => {}
    onProjectSkillNames.mockReturnValue(new Promise(resolve => (read = resolve)))
    render(<Counts projectId="p1" picks={{ without: ['ask'], project: ['tickets'] }} />)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(counts()).toMatch(/^none\//)
    await act(async () => read(PROJECT))
    // readability's, and one of the project's two.
    await waitFor(() => expect(counts()).toMatch(/^2\//))
    cleanup()
    // A session with no project counts the plugins' alone, and reads no project's skills.
    onProjectSkillNames.mockClear()
    render(<Counts projectId={undefined} />)
    await waitFor(() => expect(counts()).toMatch(/^2\//))
    expect(onProjectSkillNames).not.toHaveBeenCalled()
  })

  test("a session's: as its record keeps its picks, its profile's where it picked none", async () => {
    onProjectSkillNames.mockResolvedValue(['tickets', 'queue'])
    render(<Counts projectId="p1" recorded={{ pluginsWithout: ['readability'], projectSkills: ['tickets'] }} />)
    await waitFor(() => expect(counts()).toMatch(/\/2$/))
    cleanup()
    render(<Counts projectId="p1" recorded={{ profile: 'quiet' }} />)
    await waitFor(() => expect(counts()).toMatch(/\/2$/))
    cleanup()
    render(<Counts projectId="p1" recorded={{ profile: 'lean' }} />)
    await waitFor(() => expect(counts()).toMatch(/\/3$/))
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

/** The session's Skills line of the gear's menu, found as a screen reader meets it: "Skills: ", the count, then why it stays. */
const skillsSaid = async (count: number): Promise<HTMLElement> => {
  await openMenu(gear())
  return await waitFor(() => {
    const line = screen.getAllByRole('menuitem').find(item => item.textContent!.startsWith(`Skills: ${count}.`))
    if (!line) throw new Error(`no "Skills: ${count}." line`)
    return line
  })
}
const renderOff = (props: Parameters<typeof SkillsOff>[0]) => render(<GearMenu lines={<SkillsOff {...props} />} />)

describe("a session's Skills in the gear's menu, said and not offered", () => {
  test('a line that opens no list, counted as the launcher counts, its hover saying what the session got', async () => {
    onProjectSkillNames.mockResolvedValue(['tickets', 'queue'])
    renderOff({ projectId: 'p1', profile: undefined, pluginsWithout: ['readability'], projectSkills: ['tickets'] })
    // The plugins' two less readability's, and one of the project's two.
    const said = await skillsSaid(2)
    expect(said.getAttribute('aria-haspopup')).toBeNull()
    expect(said.getAttribute('aria-disabled')).toBe('true')
    expect((await hoverTooltip(said)).textContent).toBe('This session got the skills of every plugin on but readability, and the project skills tickets')
    cleanup()
    renderOff({ projectId: undefined, profile: 'default' })
    const alone = await skillsSaid(2)
    expect((await hoverTooltip(alone)).textContent).toBe('This session got the skills of every plugin on, and no project skill')
  })

  test("a session that picked no project skills got its profile's", async () => {
    onProjectSkillNames.mockResolvedValue(['tickets', 'queue'])
    renderOff({ projectId: 'p1', profile: 'quiet' })
    const said = await skillsSaid(2)
    expect((await hoverTooltip(said)).textContent).toBe('This session got the skills of every plugin on, and no project skill')
    cleanup()
    renderOff({ projectId: 'p1', profile: 'quiet', projectSkills: 'all' })
    expect(await skillsSaid(4)).toBeTruthy()
  })

  test("a session that picked no plugins went without its profile's; one that picked none of them got every plugin on", async () => {
    onProjectSkillNames.mockResolvedValue(['tickets', 'queue'])
    renderOff({ projectId: 'p1', profile: 'lean' })
    const said = await skillsSaid(3)
    expect((await hoverTooltip(said)).textContent).toBe('This session got the skills of every plugin on but readability, and every project skill')
    cleanup()
    renderOff({ projectId: 'p1', profile: 'lean', pluginsWithout: [] })
    expect(await skillsSaid(4)).toBeTruthy()
  })

  test("a plugin's skill that the project holds too is counted once, as the launcher counts it", async () => {
    onProjectSkillNames.mockResolvedValue(['ask', 'tickets'])
    renderOff({ projectId: 'p1', profile: 'default' })
    expect(await skillsSaid(3)).toBeTruthy()
  })

  test('a session opened again after a reload has its Skills line whole from this browser\'s store, before its reads answer', async () => {
    onProjectSkillNames.mockResolvedValue(['tickets'])
    renderOff({ projectId: 'p1', profile: 'default' })
    await skillsSaid(3)
    cleanup()
    // The reload: the page's memory gone, this browser's store as the last load left it, the reads not answered yet.
    forgetRemembered()
    onProjectSkillNames.mockReturnValue(new Promise(() => {}))
    onSkillChoices.mockReturnValue(new Promise(() => {}))
    renderOff({ projectId: 'p1', profile: 'default' })
    expect(await skillsSaid(3)).toBeTruthy()
  })
})
