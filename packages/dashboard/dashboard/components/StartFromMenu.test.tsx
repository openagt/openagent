import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { hoverTooltip, openMenu } from '../test-utils.js'
import { StartFromMenu } from './StartFromMenu.js'

afterEach(cleanup)

function renderMenu(over: Partial<Parameters<typeof StartFromMenu>[0]> = {}) {
  const onPick = vi.fn()
  const view = render(<StartFromMenu main="main" local="my/work" pick="main" onPick={onPick} busy={false} {...over} />)
  return { onPick, ...view }
}

const trigger = () => screen.getByRole('button', { name: 'The agent starts from' })
const items = () => screen.getAllByRole('menuitem')

describe('StartFromMenu', () => {
  test('the chip reads the branch the agent starts from: the main branch by its name, the local one marked as local', () => {
    renderMenu()
    expect(trigger().textContent).toBe('main')
    expect(trigger().querySelector('svg')).not.toBeNull()
    cleanup()
    renderMenu({ pick: 'local' })
    expect(trigger().textContent).toBe('my/work (local)')
    cleanup()
    renderMenu({ main: 'master', local: 'master', pick: 'local' })
    expect(trigger().textContent).toBe('master (local)')
  })

  test('the menu lists the two branches under its heading, each with its description, and the check is on the current one', async () => {
    renderMenu()
    await openMenu(trigger())
    expect(screen.getByText('The agent starts from')).toBeTruthy()
    expect(items().map(item => item.textContent)).toEqual([
      "mainThe project's main branch, fetched fresh.",
      'My local branch my/workYour branch as committed on this machine; uncommitted edits are not carried. If the agent publishes, your commits that are not pushed go up with its branch.',
    ])
    expect(items().map(item => item.getAttribute('aria-current'))).toEqual(['true', 'false'])
    // The drawn check follows the same pick.
    expect(items().map(item => item.querySelector('svg')!.classList.contains('opacity-100'))).toEqual([true, false])
    cleanup()

    renderMenu({ pick: 'local' })
    await openMenu(trigger())
    expect(items().map(item => item.getAttribute('aria-current'))).toEqual(['false', 'true'])
  })

  test('a folder on the main branch itself still has its local branch as the second option', async () => {
    renderMenu({ local: 'main' })
    await openMenu(trigger())
    expect(items().map(item => item.querySelector('span > span')!.textContent)).toEqual(['main', 'My local branch main'])
  })

  test('picking an option reports it', async () => {
    const { onPick } = renderMenu()
    await openMenu(trigger())
    fireEvent.click(screen.getByRole('menuitem', { name: /^My local branch/ }))
    expect(onPick).toHaveBeenCalledWith('local')
    cleanup()

    const again = renderMenu({ pick: 'local' })
    await openMenu(trigger())
    fireEvent.click(screen.getByRole('menuitem', { name: /^main/ }))
    expect(again.onPick).toHaveBeenCalledWith('main')
  })

  test('the tooltip says the branch in a sentence, and the chip is off while busy', async () => {
    renderMenu({ pick: 'local' })
    expect((await hoverTooltip(trigger())).textContent).toBe('The agent starts from my/work (local)')
    cleanup()
    renderMenu({ busy: true })
    expect((trigger() as HTMLButtonElement).disabled).toBe(true)
  })
})
