import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { UiProject } from '@openagt/hooks/ui'
import { GearMenu, openSetupLine, setupLine } from '../test-utils.js'
import { ModulesContext, mountedOf, type MountedOption } from '../lib/use-modules.js'
import { AutoMenu, autoSaid, useAutoLevels, type AutoLevel } from './AutoMenu.js'

afterEach(cleanup)

/** Every level, as a project with a remote on a git host is offered them: Off, git-branches' two, then the ones that open a pull request. */
const ALL: AutoLevel[] = [
  { id: 'nothing', label: 'Off', description: 'Adds nothing to your message. The agent decides, and usually commits.' },
  { id: 'commit', label: 'Commit', description: 'It commits its work on its branch.' },
  { id: 'branch', label: 'Publish branch', description: 'It commits and pushes its branch.' },
  { id: 'pr', label: 'Open PR', description: 'It commits, pushes its branch and opens a pull request.' },
  { id: 'merge', label: 'Merge on green', description: 'It commits, pushes its branch and opens a pull request set to merge once its checks pass.' },
]

function renderMenu(over: Partial<Parameters<typeof AutoMenu>[0]> = {}) {
  const onPublish = vi.fn()
  const view = render(<GearMenu lines={<AutoMenu publish="nothing" levels={ALL} onPublish={onPublish} {...over} />} />)
  return { onPublish, ...view }
}

/** What the gear's line reads, its menu open: "When it finishes: <the level>". */
const label = async (over: Partial<Parameters<typeof AutoMenu>[0]>): Promise<string> => {
  cleanup()
  renderMenu(over)
  return (await setupLine('When it finishes')).textContent ?? ''
}

describe('AutoMenu', () => {
  test('the line reads what will happen: the publish pick, and "Auto off" for Off, which alone would not say what is off', async () => {
    expect(await label({ publish: 'nothing' })).toBe('When it finishes: Auto off')
    expect(await label({ publish: 'commit' })).toBe('When it finishes: Commit')
    expect(await label({ publish: 'branch' })).toBe('When it finishes: Publish branch')
    expect(await label({ publish: 'pr' })).toBe('When it finishes: Open PR')
    expect(await label({ publish: 'merge' })).toBe('When it finishes: Merge on green')
  })

  test("the gear's hover says the level in the line's words", () => {
    expect(autoSaid('nothing', ALL)).toBe('Auto off')
    expect(autoSaid('merge', ALL)).toBe('Merge on green')
    expect(autoSaid('pr', ALL)).toBe('Open PR')
  })

  test('the line is set apart from the lines above it', async () => {
    renderMenu()
    const line = await setupLine('When it finishes')
    expect(line.previousElementSibling?.getAttribute('role')).toBe('separator')
  })

  test('the menu lists the offered picks under its heading, each with its description, and the check is on the current one', async () => {
    renderMenu({ publish: 'pr' })
    await openSetupLine('When it finishes')
    expect(screen.getByText('When the agent finishes')).toBeTruthy()
    expect(screen.getAllByRole('menuitemradio').map(item => item.textContent)).toEqual([
      'OffAdds nothing to your message. The agent decides, and usually commits.',
      'CommitIt commits its work on its branch.',
      'Publish branchIt commits and pushes its branch.',
      'Open PRIt commits, pushes its branch and opens a pull request.',
      'Merge on greenIt commits, pushes its branch and opens a pull request set to merge once its checks pass.',
    ])
    expect(screen.getAllByRole('menuitemradio').map(item => item.getAttribute('aria-checked'))).toEqual(['false', 'false', 'false', 'true', 'false'])
    // The drawn check follows the same pick: the tick at the row's end, on that row alone.
    expect(screen.getAllByRole('menuitemradio').map(item => item.lastElementChild!.classList.contains('lucide-check'))).toEqual([false, false, false, true, false])
  })

  test('only the offered levels are listed', async () => {
    renderMenu({ publish: 'commit', levels: ALL.slice(0, 2) })
    await openSetupLine('When it finishes')
    expect(screen.getAllByRole('menuitemradio').map(item => item.getAttribute('aria-checked'))).toEqual(['false', 'true'])
  })

  test('picking an option reports it', async () => {
    const { onPublish } = renderMenu()
    await openSetupLine('When it finishes')
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^Merge on green/ }))
    expect(onPublish).toHaveBeenCalledWith('merge')
  })

})

describe('useAutoLevels', () => {
  const option = (id: string, label: string, offered?: (project: UiProject | undefined) => boolean): MountedOption<'composer.auto'> => ({
    place: 'composer.auto',
    id,
    label,
    sentence: `${label}.`,
    ...(offered ? { offered } : {}),
    package: '@me/git',
    module: 'git',
    projects: ['p1'],
  })
  const levels = (project: UiProject | undefined, projectId = 'p1') => {
    const modules = mountedOf({
      options: {
        'composer.auto': [
          option('commit', 'Commit'),
          option('branch', 'Publish branch', on => on?.remote !== undefined),
          { ...option('pr', 'Open PR', on => on === undefined || on.remote?.startsWith('github.com/') === true), package: '@me/host', module: 'host' },
        ],
      },
    })
    const wrapper = ({ children }: { children: ReactNode }) => <ModulesContext.Provider value={modules}>{children}</ModulesContext.Provider>
    return renderHook(() => useAutoLevels(projectId, project), { wrapper }).result.current.map(level => level.id)
  }

  test("Off, then each module's level where it says it is offered", () => {
    expect(levels({ id: 'p1', name: 'shop', remote: 'github.com/me/shop' })).toEqual(['nothing', 'commit', 'branch', 'pr'])
    expect(levels({ id: 'p1', name: 'shop', remote: 'example.com/me/shop' })).toEqual(['nothing', 'commit', 'branch'])
    expect(levels({ id: 'p1', name: 'shop' })).toEqual(['nothing', 'commit'])
    // A project the modules are not on is offered none of their levels.
    expect(levels(undefined, 'p2')).toEqual(['nothing'])
  })
})
