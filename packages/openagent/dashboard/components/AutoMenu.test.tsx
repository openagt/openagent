import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { PublishPick } from '../../src/client.js'
import { hoverTooltip, openMenu } from '../test-utils.js'
import { AutoMenu } from './AutoMenu.js'

afterEach(cleanup)

const ALL: PublishPick[] = ['nothing', 'commit', 'branch', 'pr', 'merge']

function renderMenu(over: Partial<Parameters<typeof AutoMenu>[0]> = {}) {
  const onPublish = vi.fn()
  const onCleanup = vi.fn()
  const view = render(
    <AutoMenu publish="nothing" picks={ALL} onPublish={onPublish} cleanup={undefined} onCleanup={onCleanup} busy={false} {...over} />,
  )
  return { onPublish, onCleanup, ...view }
}

const trigger = () => screen.getByRole('button', { name: 'Auto' })
/** What the button reads with the menu shut. */
const label = (over: Partial<Parameters<typeof AutoMenu>[0]>): string => {
  cleanup()
  renderMenu(over)
  return trigger().textContent ?? ''
}

describe('AutoMenu', () => {
  test('the button reads what will happen: the publish pick, and the cleanup when ticked', () => {
    expect(label({ publish: 'nothing' })).toBe('Auto: Off')
    expect(label({ publish: 'commit' })).toBe('Auto: Commit')
    expect(label({ publish: 'branch' })).toBe('Auto: Publish branch')
    expect(label({ publish: 'pr' })).toBe('Auto: Open PR')
    expect(label({ publish: 'merge' })).toBe('Auto: Merge on green')
    expect(label({ publish: 'pr', cleanup: false })).toBe('Auto: Open PR')
    expect(label({ publish: 'pr', cleanup: true })).toBe('Auto: Open PR · cleanup')
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

  test('the cleanup item shows the tick, reports a toggle, and keeps the menu open', async () => {
    const { onCleanup } = renderMenu({ cleanup: true })
    await openMenu(trigger())
    const item = screen.getByRole('menuitemcheckbox', { name: /^Post-merge cleanup/ })
    expect(item.getAttribute('aria-checked')).toBe('true')
    expect(item.textContent).toBe(
      'Post-merge cleanupOnce the agent ends done with a pull request, a fresh agent runs /post-merge-cleanup on its branch; the merge waits for it.',
    )
    fireEvent.click(item)
    expect(onCleanup.mock.calls[0]![0]).toBe(false)
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
  })

  test('an unticked cleanup item reports the tick', async () => {
    const { onCleanup } = renderMenu({ cleanup: false })
    await openMenu(trigger())
    const item = screen.getByRole('menuitemcheckbox', { name: /^Post-merge cleanup/ })
    expect(item.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(item)
    expect(onCleanup.mock.calls[0]![0]).toBe(true)
  })

  test('without the cleanup offered the menu has no cleanup item', async () => {
    renderMenu()
    await openMenu(trigger())
    expect(screen.queryByRole('menuitemcheckbox')).toBeNull()
  })

  test('the tooltip says what the menu is for, and the button is off while busy', async () => {
    renderMenu()
    expect((await hoverTooltip(trigger())).textContent).toBe('What the agent does by itself when it finishes.')
    cleanup()
    renderMenu({ busy: true })
    expect((trigger() as HTMLButtonElement).disabled).toBe(true)
  })
})
