import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { forgetRemembered, tellNextRunPicked, type ModuleCallResult, type UiComposerControlProps } from '@openagt/ui/module'
import { GearMenu, fakeHost, gear, hoverTooltip, openMenu, openSetupLine, renderWithHost } from '@openagt/ui/module/testing'
import { SkillsControl, sessionSkills, skillPicksSaid } from './SkillsControl.js'
import type { SkillChoices } from './calls.js'

// The gear's Skills line, drawn in the shell's gear, its server part's answers as a test gives them.
// The plugins on in the project: ask and readability, each with its skill, and notify, with a step alone.

const PLUGINS = [
  { name: 'ask', skills: ['ask'] },
  { name: 'readability', skills: ['readability'] },
  { name: 'notify', skills: [] },
]
const PROFILES: Record<string, SkillChoices['profile']> = { default: {}, quiet: { project: 'none' }, lean: { without: ['readability'] } }
let choices: Omit<SkillChoices, 'profile'>
let picked = 'default'
const answer = async (_projectId: string, name: string, input: object): Promise<ModuleCallResult> => {
  if (name !== 'skillChoices') return { ok: false, error: `no ${name} here` }
  const { profile } = input as { profile?: string }
  return { ok: true, output: { ...choices, profile: PROFILES[profile ?? picked] ?? {} } }
}
const call = vi.fn(answer)
const host = fakeHost('@openagt/skills', { call })
const say = vi.fn()

beforeEach(() => {
  choices = { core: [], plugins: PLUGINS, project: ['tickets', 'plan'] }
  picked = 'default'
})
afterEach(() => {
  cleanup()
  forgetRemembered()
  localStorage.clear()
  call.mockClear()
  call.mockImplementation(answer)
  say.mockClear()
  host.openSettings.mockClear()
})

function draw({ projectId = 'p1', ...props }: Partial<Omit<UiComposerControlProps, 'projectId'>> & { projectId?: string | null } = {}) {
  const onChange = vi.fn()
  const all: UiComposerControlProps = { in: 'launcher', ...(projectId !== null ? { projectId } : {}), options: {}, onChange, busy: false, say, ...props }
  const view = renderWithHost(<GearMenu lines={<SkillsControl {...all} />} />, host)
  return { onChange, view }
}
/** The gear's "Skills" line, once it counts `count`; a session's says why it stays after the count. */
const counting = async (count: number, session = false): Promise<HTMLElement> => {
  await openMenu(gear())
  return await waitFor(() => {
    const line = screen.getAllByRole('menuitem').find(item => (session ? item.textContent!.startsWith(`Skills: ${count}.`) : item.textContent === `Skills: ${count}`))
    if (!line) throw new Error(`no "Skills: ${count}" line`)
    return line
  })
}
const openCounting = async (count: number): Promise<void> => openMenu(await counting(count))
const checked = (name: string) => screen.getByRole('menuitemcheckbox', { name }).getAttribute('aria-checked')

describe("the launcher's Skills line", () => {
  test("it counts what the next run gets, the plugins' skills and the project's, and says it for the gear's hover; its list ticks each plugin on, lists the project's skills, and opens both in Settings", async () => {
    draw()
    await openCounting(4)
    expect(call).toHaveBeenCalledWith('p1', 'skillChoices', {})
    expect(say).toHaveBeenLastCalledWith({ words: '4 skills' })
    expect(screen.getByText('Plugins, this session')).toBeTruthy()
    expect(['ask', 'readability', 'notify', 'tickets', 'plan'].map(checked)).toEqual(['true', 'true', 'true', 'true', 'true'])
    expect(screen.getByRole('menuitemradio', { name: 'All' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Project skills in Settings…' }))
    expect(host.openSettings).toHaveBeenCalledWith('skills', 'p1')
    await waitFor(() => expect(screen.queryByRole('menu') === null && !gear().hasAttribute('data-popup-open')).toBe(true))
    await openSetupLine('Skills')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Plugins in Settings…' }))
    expect(host.openSettings).toHaveBeenLastCalledWith('plugins', 'p1')
  })

  test('a plugin unticked is one the run goes without, its skills with it; ticked again, it is back', async () => {
    const { onChange } = draw()
    await openCounting(4)
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'ask' }))
    expect(onChange).toHaveBeenLastCalledWith({ plugins: { without: ['ask'] } })
    cleanup()
    const again = draw({ options: { plugins: { without: ['ask', 'notify'] } } })
    await openCounting(3)
    expect([checked('ask'), checked('notify')]).toEqual(['false', 'false'])
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'ask' }))
    expect(again.onChange).toHaveBeenLastCalledWith({ plugins: { without: ['notify'] } })
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'notify' }))
    cleanup()
    const last = draw({ options: { plugins: { without: ['notify'] } } })
    await openCounting(4)
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'notify' }))
    expect(last.onChange).toHaveBeenLastCalledWith({})
  })

  test("the project's skills: None, All, or each; the last one unticked is None, every one ticked is All", async () => {
    const { onChange } = draw()
    await openCounting(4)
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'None' }))
    expect(onChange).toHaveBeenLastCalledWith({ skills: { project: 'none' } })
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'plan' }))
    expect(onChange).toHaveBeenLastCalledWith({ skills: { project: ['tickets'] } })
    cleanup()
    const fromOne = draw({ options: { skills: { project: ['tickets'] } } })
    await openCounting(3)
    expect(checked('plan')).toBe('false')
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'tickets' }))
    expect(fromOne.onChange).toHaveBeenLastCalledWith({ skills: { project: 'none' } })
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'plan' }))
    expect(fromOne.onChange).toHaveBeenLastCalledWith({})
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'All' }))
    expect(fromOne.onChange).toHaveBeenLastCalledWith({})
  })

  test("the run starts from the profile picked for every next run: its picks are the line's until one is made here, and a pick back to every one is said over it; a new profile picked is read at once", async () => {
    picked = 'lean'
    const { onChange } = draw()
    await openCounting(3)
    expect(checked('readability')).toBe('false')
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'readability' }))
    expect(onChange).toHaveBeenLastCalledWith({ plugins: { without: [] } })
    cleanup()
    picked = 'quiet'
    const quiet = draw()
    await openCounting(2)
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'All' }))
    expect(quiet.onChange).toHaveBeenLastCalledWith({ skills: { project: 'all' } })
    // The profile picked for every next run changes in the profile's line: this one reads again at once.
    picked = 'default'
    tellNextRunPicked()
    await waitFor(() => expect(say).toHaveBeenLastCalledWith({ words: '4 skills' }))
  })

  test('a session with no project has the plugins alone, and nothing to set in Settings; a project with no skills yet says so', async () => {
    choices = { core: [], plugins: PLUGINS, project: [] }
    draw({ projectId: null })
    await openCounting(2)
    expect(call).toHaveBeenCalledWith('session', 'skillChoices', {})
    expect(screen.queryByText('Project skills')).toBeNull()
    expect(screen.queryByText('Plugins in Settings…')).toBeNull()
    cleanup()
    draw()
    await openCounting(2)
    expect(screen.getByText('None yet')).toBeTruthy()
    expect(screen.queryByRole('menuitemradio', { name: 'All' })).toBeNull()
  })

  test("a project with no plugin on says so, and counts its core modules' skills; a plugin's skill the project holds too is counted once", async () => {
    choices = { core: ['github'], plugins: [], project: [] }
    draw()
    await openCounting(1)
    expect(screen.getByText('None on')).toBeTruthy()
    cleanup()
    choices = { core: [], plugins: PLUGINS, project: ['ask', 'plan'] }
    draw()
    expect(await counting(3)).toBeTruthy()
  })

  test('no line, and nothing said, until what it picks from is read', async () => {
    call.mockImplementationOnce(() => new Promise(() => {}))
    draw()
    await openMenu(gear())
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(screen.queryAllByRole('menuitem')).toEqual([])
    expect(say).not.toHaveBeenCalledWith(expect.objectContaining({ words: expect.any(String) }))
  })
})

describe("a session's Skills line, said and not offered", () => {
  test('a line that opens no list, counted as the launcher counts, its hover saying what the session got', async () => {
    choices = { core: [], plugins: PLUGINS, project: ['tickets', 'queue'] }
    draw({ in: 'session', agentId: 'a1', options: { plugins: { without: ['readability'] }, skills: { project: ['tickets'] } } })
    const said = await counting(2, true)
    expect(call).toHaveBeenCalledWith('p1', 'skillChoices', { profile: 'default' })
    expect(said.getAttribute('aria-haspopup')).toBeNull()
    expect(said.getAttribute('aria-disabled')).toBe('true')
    expect((await hoverTooltip(said)).textContent).toBe('This session got the skills of every plugin on but readability, and the project skills tickets')
    cleanup()
    choices = { core: [], plugins: PLUGINS, project: [] }
    draw({ in: 'session', agentId: 'a1', projectId: null, options: {} })
    expect((await hoverTooltip(await counting(2, true))).textContent).toBe('This session got the skills of every plugin on, and no project skill')
  })

  test("a session that picked nothing got its profile's, as its record names it; one that picked got its picks", async () => {
    choices = { core: [], plugins: PLUGINS, project: ['tickets', 'queue'] }
    draw({ in: 'session', agentId: 'a1', options: { profiles: { profile: 'quiet' } } })
    expect((await hoverTooltip(await counting(2, true))).textContent).toBe('This session got the skills of every plugin on, and no project skill')
    cleanup()
    draw({ in: 'session', agentId: 'a1', options: { profiles: { profile: 'quiet' }, skills: { project: 'all' } } })
    expect(await counting(4, true)).toBeTruthy()
    cleanup()
    draw({ in: 'session', agentId: 'a1', options: { profiles: { profile: 'lean' } } })
    expect((await hoverTooltip(await counting(3, true))).textContent).toBe('This session got the skills of every plugin on but readability, and every project skill')
    cleanup()
    draw({ in: 'session', agentId: 'a1', options: { profiles: { profile: 'lean' }, plugins: { without: [] } } })
    expect(await counting(4, true)).toBeTruthy()
  })

  test("opened again after a reload, its line is whole from this browser's store, before its read answers", async () => {
    choices = { core: [], plugins: PLUGINS, project: ['tickets'] }
    draw({ in: 'session', agentId: 'a1', options: {} })
    await counting(3, true)
    cleanup()
    forgetRemembered()
    call.mockImplementation(() => new Promise(() => {}))
    draw({ in: 'session', agentId: 'a1', options: {} })
    expect(await counting(3, true)).toBeTruthy()
  })
})

describe("a profile's own skills, in its editor", () => {
  test("every plugin that gives runs something, its own picks over nothing: one ticked off is left out, ticked on again is not; its project skills all or none, said for its row", async () => {
    const { onChange } = draw({ in: 'profile', projectId: null, options: { plugins: { without: ['readability'] } } })
    await openMenu(gear())
    const line = await waitFor(() => screen.getAllByRole('menuitem').find(item => item.textContent?.startsWith('Skills: '))!)
    expect(call).toHaveBeenCalledWith('session', 'skillChoices', { every: true })
    expect(say).toHaveBeenLastCalledWith({ words: 'Without readability · Every project skill' })
    await openMenu(line)
    expect(screen.getByText('Plugins, this profile')).toBeTruthy()
    expect(['ask', 'readability', 'notify'].map(checked)).toEqual(['true', 'false', 'true'])
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'readability' }))
    expect(onChange).toHaveBeenLastCalledWith({})
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'ask' }))
    expect(onChange).toHaveBeenLastCalledWith({ plugins: { without: ['readability', 'ask'] } })
    // A profile is for any project: its project skills are all, none, or the ones it names.
    expect(screen.getByRole('menuitemradio', { name: 'All' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'None' }))
    expect(onChange).toHaveBeenLastCalledWith({ plugins: { without: ['readability'] }, skills: { project: 'none' } })
    expect(screen.queryByText('Project skills in Settings…')).toBeNull()
    cleanup()
    say.mockClear()
    draw({ in: 'profile', projectId: null, options: { skills: { project: ['tickets', 'plan'] } } })
    await openSetupLine('Skills')
    expect(say).toHaveBeenLastCalledWith({ words: 'The project skills tickets and plan' })
    expect(screen.getByText('Only tickets and plan')).toBeTruthy()
  })
})

describe('what the picks say', () => {
  test("the skills a run gets of its modules': the core modules', then those of each plugin it does not go without", () => {
    expect(sessionSkills({ core: [], plugins: PLUGINS }, [])).toEqual(['ask', 'readability'])
    expect(sessionSkills({ core: [], plugins: PLUGINS }, ['readability'])).toEqual(['ask'])
    expect(sessionSkills({ core: ['github'], plugins: PLUGINS }, ['ask'])).toEqual(['github', 'readability'])
  })

  test('in words, for a hover', () => {
    expect(skillPicksSaid({ without: [], project: undefined })).toBe('the skills of every plugin on, and every project skill')
    expect(skillPicksSaid({ without: [], project: 'all' })).toBe('the skills of every plugin on, and every project skill')
    expect(skillPicksSaid({ without: ['ask', 'tickets', 'queue'], project: 'none' })).toBe('the skills of every plugin on but ask, tickets and queue, and no project skill')
    expect(skillPicksSaid({ without: [], project: ['tickets', 'plan'] })).toBe('the skills of every plugin on, and the project skills tickets and plan')
  })
})
