import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { PublishPick } from '../../src/client.js'
import { GearMenu, openSetupLine, setupLine } from '../test-utils.js'
import { AutoMenu, autoSaid } from './AutoMenu.js'

afterEach(cleanup)

const ALL: PublishPick[] = ['nothing', 'commit', 'branch', 'pr', 'merge']

function renderMenu(over: Partial<Parameters<typeof AutoMenu>[0]> = {}) {
  const onPublish = vi.fn()
  const view = render(<GearMenu lines={<AutoMenu publish="nothing" picks={ALL} onPublish={onPublish} {...over} />} />)
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
    expect(autoSaid('nothing')).toBe('Auto off')
    expect(autoSaid('merge')).toBe('Merge on green')
    expect(autoSaid('pr', { into: 'login-page' })).toBe('Open PR → login-page')
    expect(autoSaid('commit', { into: 'login-page' })).toBe('Commit')
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

  test('only the offered picks are listed', async () => {
    renderMenu({ publish: 'commit', picks: ['nothing', 'commit'] })
    await openSetupLine('When it finishes')
    expect(screen.getAllByRole('menuitemradio').map(item => item.getAttribute('aria-checked'))).toEqual(['false', 'true'])
  })

  test('picking an option reports it', async () => {
    const { onPublish } = renderMenu()
    await openSetupLine('When it finishes')
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^Merge on green/ }))
    expect(onPublish).toHaveBeenCalledWith('merge')
  })

  test('a target: the line names it and the list offers its branches at the levels that open a request, and a pick reports the branch', async () => {
    const onPick = vi.fn()
    const target = { into: 'login-page', picks: ['login-page', 'main'], onPick }
    expect(await label({ publish: 'pr', target })).toBe('When it finishes: Open PR → login-page')
    expect(await label({ publish: 'merge', target: { ...target, into: 'main' } })).toBe('When it finishes: Merge on green → main')
    expect(await label({ publish: 'commit', target })).toBe('When it finishes: Commit')
    cleanup()
    renderMenu({ publish: 'pr', target })
    await openSetupLine('When it finishes')
    expect(screen.getByText('The pull request goes into')).toBeTruthy()
    const row = (name: string) => screen.getByRole('menuitemradio', { name })
    expect(row('login-page').getAttribute('aria-checked')).toBe('true')
    expect(row('main').getAttribute('aria-checked')).toBe('false')
    fireEvent.click(row('main'))
    expect(onPick).toHaveBeenCalledWith('main')
  })

  test('no section: at a level that opens no request, with no target, and on a session, whose line still names its target', async () => {
    renderMenu({ publish: 'commit', target: { into: 'login-page', picks: ['login-page', 'main'] } })
    await openSetupLine('When it finishes')
    expect(screen.queryByText('The pull request goes into')).toBeNull()
    cleanup()
    renderMenu({ publish: 'pr' })
    await openSetupLine('When it finishes')
    expect(screen.queryByText('The pull request goes into')).toBeNull()
    cleanup()
    renderMenu({ publish: 'pr', target: { into: 'login-page' } })
    expect((await openSetupLine('When it finishes')).textContent).toBe('When it finishes: Open PR → login-page')
    expect(screen.queryByText('The pull request goes into')).toBeNull()
  })
})
