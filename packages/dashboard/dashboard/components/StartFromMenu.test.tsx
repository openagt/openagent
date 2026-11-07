import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { hoverTooltip, openMenu } from '../test-utils.js'
import { forgetRemembered } from '../lib/use-async.js'
import { startFromBase, BranchButton, StartFromMenu } from './StartFromMenu.js'

const onStartBranches = vi.hoisted(() => vi.fn())
vi.mock('../rpc/projects.js', () => ({ onStartBranches }))

const LOCAL = { kind: 'local' } as const
const published = (branch: string) => ({ kind: 'published', branch }) as const

beforeEach(() => {
  onStartBranches.mockReset()
  onStartBranches.mockResolvedValue({ branches: ['agent-fix-it', 'feature/x', 'local'] })
})
afterEach(() => {
  cleanup()
  forgetRemembered()
})

function renderMenu(over: Partial<Parameters<typeof StartFromMenu>[0]> = {}) {
  const onPick = vi.fn()
  const view = render(<StartFromMenu projectId="p1" main="main" local="my/work" pick={undefined} onPick={onPick} busy={false} {...over} />)
  return { onPick, ...view }
}

const trigger = () => screen.getByRole('combobox', { name: 'The agent starts from' })
const items = () => screen.getAllByRole('option')
const names = () => items().map(item => (item.querySelector('span > span') ?? item.querySelector('span'))!.textContent)
const search = () => screen.getByRole('combobox', { name: 'Search branches' })
const LOCAL_DESCRIPTION = 'Your branch as committed on this machine; uncommitted edits are not carried. If the agent publishes, your commits that are not pushed go up with its branch.'

describe('StartFromMenu', () => {
  test('the chip reads the branch the agent starts from: the main branch by its name, the local one marked as local, a published one by its name alone', () => {
    renderMenu()
    expect(trigger().textContent).toBe('main')
    expect(trigger().querySelector('svg')).not.toBeNull()
    cleanup()
    renderMenu({ pick: LOCAL })
    expect(trigger().textContent).toBe('my/work (local)')
    cleanup()
    renderMenu({ main: 'master', local: 'master', pick: LOCAL })
    expect(trigger().textContent).toBe('master (local)')
    cleanup()
    renderMenu({ pick: published('feature/x') })
    expect(trigger().textContent).toBe('feature/x')
  })

  test('nothing is read until the menu opens, and it is read again at each opening: no polling', async () => {
    renderMenu()
    expect(onStartBranches).not.toHaveBeenCalled()
    await openMenu(trigger())
    await screen.findByRole('option', { name: 'feature/x' })
    expect(onStartBranches).toHaveBeenCalledTimes(1)
    expect(onStartBranches).toHaveBeenCalledWith('p1')
    fireEvent.keyDown(search(), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('option', { name: 'feature/x' })).toBeNull())
    await openMenu(trigger())
    await waitFor(() => expect(onStartBranches).toHaveBeenCalledTimes(2))
  })

  test('the menu lists the main branch, then the local one, each with its description, at once; what origin has lands under them; the check is on the pick', async () => {
    let answer: (value: unknown) => void = () => {}
    onStartBranches.mockReturnValue(new Promise(resolve => (answer = resolve)))
    renderMenu()
    await openMenu(trigger())
    expect(items().map(item => item.textContent)).toEqual(["mainThe project's main branch, fetched fresh.", `My local branch my/work${LOCAL_DESCRIPTION}`])
    expect(screen.getByText('Reading the branches on origin…')).toBeTruthy()
    answer({ branches: ['agent-fix-it', 'feature/x', 'local'] })
    await screen.findByRole('option', { name: 'feature/x' })
    expect(names()).toEqual(['main', 'My local branch my/work', 'agent-fix-it', 'feature/x', 'local'])
    expect(screen.queryByText('Reading the branches on origin…')).toBeNull()
    // The pick is the tick at the row's end; the other rows carry none.
    const checked = () => items().map(item => item.lastElementChild!.classList.contains('lucide-check'))
    expect(checked()).toEqual([true, false, false, false, false])
    cleanup()

    renderMenu({ pick: LOCAL })
    await openMenu(trigger())
    await screen.findByRole('option', { name: 'feature/x' })
    expect(checked()).toEqual([false, true, false, false, false])
    cleanup()

    // A branch literally named local is its own row, and no local pick.
    renderMenu({ pick: published('local') })
    await openMenu(trigger())
    await screen.findByRole('option', { name: 'feature/x' })
    expect(checked()).toEqual([false, false, false, false, true])
  })

  test('a folder on the main branch itself still has its local branch as the second row', async () => {
    renderMenu({ local: 'main' })
    await openMenu(trigger())
    await screen.findByRole('option', { name: 'feature/x' })
    expect(names().slice(0, 2)).toEqual(['main', 'My local branch main'])
  })

  test('picking a row reports the pick; the main branch is no pick', async () => {
    const { onPick } = renderMenu()
    await openMenu(trigger())
    fireEvent.click(screen.getByRole('option', { name: /^My local branch/ }))
    expect(onPick).toHaveBeenCalledWith(LOCAL)
    cleanup()

    const again = renderMenu({ pick: LOCAL })
    await openMenu(trigger())
    fireEvent.click(screen.getByRole('option', { name: /^main/ }))
    expect(again.onPick).toHaveBeenCalledWith(undefined)
    cleanup()

    const third = renderMenu()
    await openMenu(trigger())
    fireEvent.click(await screen.findByRole('option', { name: 'local' }))
    expect(third.onPick).toHaveBeenCalledWith(published('local'))
  })

  test('the search narrows the rows, and says when none is left', async () => {
    renderMenu()
    await openMenu(trigger())
    await screen.findByRole('option', { name: 'feature/x' })
    fireEvent.change(search(), { target: { value: 'FEAT' } })
    await waitFor(() => expect(names()).toEqual(['feature/x']))
    fireEvent.change(search(), { target: { value: 'no-such-branch' } })
    await waitFor(() => expect(screen.queryAllByRole('option')).toEqual([]))
    expect(screen.getByText('No branch by that name.')).toBeTruthy()
  })

  test('a repository with more branches than are drawn says the search reaches the rest, which it does', async () => {
    onStartBranches.mockResolvedValue({ branches: Array.from({ length: 300 }, (_, i) => `b-${i}`) })
    renderMenu()
    await openMenu(trigger())
    await screen.findByText('Search to see more of the 300 branches.')
    expect(items()).toHaveLength(200)
    fireEvent.change(search(), { target: { value: 'b-299' } })
    await waitFor(() => expect(names()).toEqual(['b-299']))
  })

  test('an origin that cannot be read leaves the two rows that need no read, and says the rest could not be read; a call that fails on the way says the same', async () => {
    onStartBranches.mockResolvedValue({})
    renderMenu()
    await openMenu(trigger())
    expect(await screen.findByText('The other branches could not be read from origin.')).toBeTruthy()
    expect(names()).toEqual(['main', 'My local branch my/work'])
    cleanup()
    forgetRemembered()

    onStartBranches.mockRejectedValue(new Error('an older computer'))
    renderMenu()
    await openMenu(trigger())
    expect(await screen.findByText('The other branches could not be read from origin.')).toBeTruthy()
  })

  test('a saved pick origin no longer lists stays on the chip: the Start says what happened to it', async () => {
    renderMenu({ pick: published('gone') })
    await openMenu(trigger())
    await screen.findByRole('option', { name: 'feature/x' })
    expect(trigger().textContent).toBe('gone')
    expect(names()).not.toContain('gone')
  })

  test('the tooltip says the branch in a sentence, and the chip is off while busy', async () => {
    renderMenu({ pick: LOCAL })
    expect((await hoverTooltip(trigger())).textContent).toBe('The agent starts from my/work (local)')
    cleanup()
    renderMenu({ busy: true })
    expect((trigger() as HTMLButtonElement).disabled).toBe(true)
  })

  test('the button can be drawn alone and off, with no menu and no read behind it', () => {
    render(<BranchButton label="feature/x" disabled />)
    const button = screen.getByRole('button') as HTMLButtonElement
    expect(button.textContent).toBe('feature/x')
    expect(button.disabled).toBe(true)
    expect(onStartBranches).not.toHaveBeenCalled()
  })

  test('what a Start hands the daemon: nothing for the main branch, the local branch by its name, a published one as origin has it', () => {
    expect(startFromBase(undefined, 'main', 'my/work')).toEqual({})
    expect(startFromBase(LOCAL, 'main', 'my/work')).toEqual({ base: 'my/work' })
    expect(startFromBase(published('feature/x'), 'main', 'my/work')).toEqual({ base: 'refs/remotes/origin/feature/x' })
    expect(startFromBase(published('main'), 'main', 'my/work')).toEqual({})
  })
})
