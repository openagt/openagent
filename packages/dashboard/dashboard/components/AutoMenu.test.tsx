import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { PublishPick } from '../../src/client.js'
import { hoverTooltip, openMenu } from '../test-utils.js'
import { AutoMenu } from './AutoMenu.js'

afterEach(cleanup)

const ALL: PublishPick[] = ['nothing', 'commit', 'branch', 'pr', 'merge']

function renderMenu(over: Partial<Parameters<typeof AutoMenu>[0]> = {}) {
  const onPublish = vi.fn()
  const view = render(<AutoMenu publish="nothing" picks={ALL} onPublish={onPublish} busy={false} {...over} />)
  return { onPublish, ...view }
}

const trigger = () => screen.getByRole('button', { name: 'Auto' })
/** What the button reads with the menu shut. */
const label = (over: Partial<Parameters<typeof AutoMenu>[0]>): string => {
  cleanup()
  renderMenu(over)
  return trigger().textContent ?? ''
}

describe('AutoMenu', () => {
  test('the button reads what will happen: the publish pick', () => {
    expect(label({ publish: 'nothing' })).toBe('Auto: Off')
    expect(label({ publish: 'commit' })).toBe('Auto: Commit')
    expect(label({ publish: 'branch' })).toBe('Auto: Publish branch')
    expect(label({ publish: 'pr' })).toBe('Auto: Open PR')
    expect(label({ publish: 'merge' })).toBe('Auto: Merge on green')
  })

  test('the menu lists the offered picks under its heading, each with its description, and the check is on the current one', async () => {
    renderMenu({ publish: 'pr' })
    await openMenu(trigger())
    expect(screen.getByText('When the agent finishes')).toBeTruthy()
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual([
      'OffAdds nothing to your message. The agent decides, and usually commits.',
      'CommitIt commits its work on its branch.',
      'Publish branchIt commits and pushes its branch.',
      'Open PRIt commits, pushes its branch and opens a pull request.',
      'Merge on greenIt commits, pushes its branch and opens a pull request set to merge once its checks pass.',
    ])
    expect(screen.getAllByRole('menuitem').map(item => item.getAttribute('aria-current'))).toEqual(['false', 'false', 'false', 'true', 'false'])
    // The drawn check follows the same pick.
    expect(screen.getAllByRole('menuitem').map(item => item.querySelector('svg')!.classList.contains('opacity-100'))).toEqual([false, false, false, true, false])
  })

  test('only the offered picks are listed', async () => {
    renderMenu({ publish: 'commit', picks: ['nothing', 'commit'] })
    await openMenu(trigger())
    expect(screen.getAllByRole('menuitem').map(item => item.getAttribute('aria-current'))).toEqual(['false', 'true'])
  })

  test('picking an option reports it', async () => {
    const { onPublish } = renderMenu()
    await openMenu(trigger())
    fireEvent.click(screen.getByRole('menuitem', { name: /^Merge on green/ }))
    expect(onPublish).toHaveBeenCalledWith('merge')
  })

  test('a target: the button names it and the menu offers its branches at the levels that open a request, and a pick reports the branch', async () => {
    const onPick = vi.fn()
    const target = { into: 'login-page', picks: ['login-page', 'main'], onPick }
    expect(label({ publish: 'pr', target })).toBe('Auto: Open PR → login-page')
    expect(label({ publish: 'merge', target: { ...target, into: 'main' } })).toBe('Auto: Merge on green → main')
    expect(label({ publish: 'commit', target })).toBe('Auto: Commit')
    cleanup()
    renderMenu({ publish: 'pr', target })
    await openMenu(trigger())
    expect(screen.getByText('The pull request goes into')).toBeTruthy()
    const row = (name: string) => screen.getByRole('menuitem', { name })
    expect(row('login-page').getAttribute('aria-current')).toBe('true')
    expect(row('main').getAttribute('aria-current')).toBe('false')
    fireEvent.click(row('main'))
    expect(onPick).toHaveBeenCalledWith('main')
  })

  test('no section: at a level that opens no request, with no target, and on a session, whose button still names its target', async () => {
    renderMenu({ publish: 'commit', target: { into: 'login-page', picks: ['login-page', 'main'] } })
    await openMenu(trigger())
    expect(screen.queryByText('The pull request goes into')).toBeNull()
    cleanup()
    renderMenu({ publish: 'pr' })
    await openMenu(trigger())
    expect(screen.queryByText('The pull request goes into')).toBeNull()
    cleanup()
    renderMenu({ publish: 'pr', target: { into: 'login-page' } })
    expect(trigger().textContent).toBe('Auto: Open PR → login-page')
    await openMenu(trigger())
    expect(screen.queryByText('The pull request goes into')).toBeNull()
  })

  test('a name too long for the button is whole in the tooltip', async () => {
    renderMenu({ publish: 'pr', target: { into: 'feature/a-long-name' } })
    expect(trigger().className).toContain('max-w-[20rem]!')
    expect((await hoverTooltip(trigger())).textContent).toBe('What the agent does by itself when it finishes. The pull request goes into feature/a-long-name.')
  })

  test('the tooltip says what the menu is for, and the button is off while busy', async () => {
    renderMenu()
    expect((await hoverTooltip(trigger())).textContent).toBe('What the agent does by itself when it finishes.')
    cleanup()
    renderMenu({ busy: true })
    expect((trigger() as HTMLButtonElement).disabled).toBe(true)
  })
})
