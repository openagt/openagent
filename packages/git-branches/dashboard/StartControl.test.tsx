import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { forgetRemembered, type ModuleCallResult, type UiComposerControlProps } from '@openagt/ui/module'
import { fakeHost, hoverTooltip, openMenu, renderWithHost } from '@openagt/ui/module/testing'
import type { StartFrom } from './calls.js'
import { StartControl } from './StartControl.js'

// The branch a run starts from, in the row above the message box (`composer.control` at
// `start`), its module's calls as a test answers them: in the launcher, the menu that picks it for
// every next run of the project; in a session, the branch its record says it started from.

const LOCAL = { kind: 'local' } as const
const published = (branch: string) => ({ kind: 'published', branch }) as const

const onStartBranches = vi.fn<() => Promise<unknown>>()
const picks = vi.fn()
let places: { main: string; local: string; pick?: StartFrom } | null = { main: 'main', local: 'my/work' }
const call = vi.fn(async (_projectId: string, name: string, input: object): Promise<ModuleCallResult> => {
  if (name === 'startPlaces') return { ok: true, output: places }
  if (name === 'startBranches') return onStartBranches().then(output => ({ ok: true as const, output }), (err: Error) => ({ ok: false as const, error: err.message }))
  if (name === 'pickStart') return picks(input), { ok: true, output: { ok: true } }
  if (name === 'startedFrom') return { ok: true, output: { from: 'main', on: 'agent-fix-it' } }
  return { ok: false, error: `no ${name} here` }
})
const host = fakeHost('@openagt/git-branches', { call })

beforeEach(() => {
  onStartBranches.mockReset()
  onStartBranches.mockResolvedValue({ branches: ['agent-fix-it', 'feature/x', 'local'] })
  places = { main: 'main', local: 'my/work' }
  picks.mockReset()
})
afterEach(() => {
  cleanup()
  forgetRemembered()
  call.mockClear()
})

/** The launcher's control, once where the project starts from is read: `main`, `local` and the saved `pick` are what its read answers. */
async function renderMenu(over: { main?: string; local?: string; pick?: StartFrom; busy?: boolean } = {}) {
  const { busy = false, ...read } = over
  places = { main: 'main', local: 'my/work', ...read }
  const props: UiComposerControlProps = { in: 'launcher', projectId: 'p1', options: {}, onChange: () => {}, busy, say: () => {} }
  const view = renderWithHost(<StartControl {...props} />, host)
  await screen.findByRole('combobox', { name: 'The agent starts from' })
  return view
}

const trigger = () => screen.getByRole('combobox', { name: 'The agent starts from' })
const items = () => screen.getAllByRole('option')
const names = () => items().map(item => (item.querySelector('span > span') ?? item.querySelector('span'))!.textContent)
const search = () => screen.getByRole('combobox', { name: 'Search branches' })
const LOCAL_DESCRIPTION = 'Your branch as committed on this machine; uncommitted edits are not carried. If the agent publishes, your commits that are not pushed go up with its branch.'

describe("the launcher's start", () => {
  test('the chip reads the branch the agent starts from: the main branch by its name, the local one marked as local, a published one by its name alone', async () => {
    await renderMenu()
    expect(trigger().textContent).toBe('main')
    expect(trigger().querySelector('svg')).not.toBeNull()
    cleanup()
    await renderMenu({ pick: LOCAL })
    expect(trigger().textContent).toBe('my/work (local)')
    cleanup()
    await renderMenu({ main: 'master', local: 'master', pick: LOCAL })
    expect(trigger().textContent).toBe('master (local)')
    cleanup()
    await renderMenu({ pick: published('feature/x') })
    expect(trigger().textContent).toBe('feature/x')
  })

  test('nothing is read until the menu opens, and it is read again at each opening: no polling', async () => {
    await renderMenu()
    expect(onStartBranches).not.toHaveBeenCalled()
    await openMenu(trigger())
    await screen.findByRole('option', { name: 'feature/x' })
    expect(onStartBranches).toHaveBeenCalledTimes(1)
    expect(call).toHaveBeenCalledWith('p1', 'startBranches', {})
    fireEvent.keyDown(search(), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('option', { name: 'feature/x' })).toBeNull())
    await openMenu(trigger())
    await waitFor(() => expect(onStartBranches).toHaveBeenCalledTimes(2))
  })

  test('the menu lists the main branch, then the local one, each with its description, at once; what origin has lands under them; the check is on the pick', async () => {
    let answer: (value: unknown) => void = () => {}
    onStartBranches.mockReturnValue(new Promise(resolve => (answer = resolve)))
    await renderMenu()
    await openMenu(trigger())
    expect(items().map(item => item.textContent)).toEqual(["mainThe project's main branch, fetched fresh.", `My local branch my/work${LOCAL_DESCRIPTION}`])
    expect(screen.getByText('Reading the branches on origin…')).toBeTruthy()
    answer({ branches: ['agent-fix-it', 'feature/x', 'local'] })
    await screen.findByRole('option', { name: 'feature/x' })
    expect(names()).toEqual(['main', 'My local branch my/work', 'agent-fix-it', 'feature/x', 'local'])
    expect(screen.queryByText('Reading the branches on origin…')).toBeNull()
    // The pick is the tick at the row's end; the other rows carry none.
    const checked = () => items().map(item => item.lastElementChild!.querySelector('.lucide-check') !== null)
    expect(checked()).toEqual([true, false, false, false, false])
    cleanup()

    await renderMenu({ pick: LOCAL })
    await openMenu(trigger())
    await screen.findByRole('option', { name: 'feature/x' })
    expect(checked()).toEqual([false, true, false, false, false])
    cleanup()

    // A branch literally named local is its own row, and no local pick.
    await renderMenu({ pick: published('local') })
    await openMenu(trigger())
    await screen.findByRole('option', { name: 'feature/x' })
    expect(checked()).toEqual([false, false, false, false, true])
  })

  test('a folder on the main branch itself still has its local branch as the second row', async () => {
    await renderMenu({ local: 'main' })
    await openMenu(trigger())
    await screen.findByRole('option', { name: 'feature/x' })
    expect(names().slice(0, 2)).toEqual(['main', 'My local branch main'])
  })

  test('picking a row saves it for every next run of the project, and the chip reads it; the main branch is no pick', async () => {
    await renderMenu()
    await openMenu(trigger())
    places = { main: 'main', local: 'my/work', pick: LOCAL }
    fireEvent.click(screen.getByRole('option', { name: /^My local branch/ }))
    await waitFor(() => expect(picks).toHaveBeenCalledWith({ pick: LOCAL }))
    await waitFor(() => expect(trigger().textContent).toBe('my/work (local)'))
    cleanup()

    await renderMenu({ pick: LOCAL })
    await openMenu(trigger())
    fireEvent.click(screen.getByRole('option', { name: /^main/ }))
    await waitFor(() => expect(picks).toHaveBeenLastCalledWith({}))
    cleanup()

    await renderMenu()
    await openMenu(trigger())
    fireEvent.click(await screen.findByRole('option', { name: 'local' }))
    await waitFor(() => expect(picks).toHaveBeenLastCalledWith({ pick: published('local') }))
  })

  test('the search narrows the rows, and says when none is left', async () => {
    await renderMenu()
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
    await renderMenu()
    await openMenu(trigger())
    await screen.findByText('Search to see more of the 300 branches.')
    expect(items()).toHaveLength(200)
    fireEvent.change(search(), { target: { value: 'b-299' } })
    await waitFor(() => expect(names()).toEqual(['b-299']))
  })

  test('an origin that cannot be read leaves the two rows that need no read, and says the rest could not be read; a call that fails on the way says the same', async () => {
    onStartBranches.mockResolvedValue({})
    await renderMenu()
    await openMenu(trigger())
    expect(await screen.findByText('The other branches could not be read from origin.')).toBeTruthy()
    expect(names()).toEqual(['main', 'My local branch my/work'])
    cleanup()
    forgetRemembered()

    onStartBranches.mockRejectedValue(new Error('an older computer'))
    await renderMenu()
    await openMenu(trigger())
    expect(await screen.findByText('The other branches could not be read from origin.')).toBeTruthy()
  })

  test('a saved pick origin no longer lists stays on the chip: the Start says what happened to it', async () => {
    await renderMenu({ pick: published('gone') })
    await openMenu(trigger())
    await screen.findByRole('option', { name: 'feature/x' })
    expect(trigger().textContent).toBe('gone')
    expect(names()).not.toContain('gone')
  })

  test('the tooltip says the branch in a sentence, and the chip is off while busy', async () => {
    await renderMenu({ pick: LOCAL })
    expect((await hoverTooltip(trigger())).textContent).toBe('The agent starts from my/work (local)')
    cleanup()
    await renderMenu({ busy: true })
    expect((trigger() as HTMLButtonElement).disabled).toBe(true)
  })

  test('no chip where there is no pick to make: a project with no remote, or a folder on no branch', async () => {
    places = null
    const props: UiComposerControlProps = { in: 'launcher', projectId: 'p1', options: {}, onChange: () => {}, busy: false, say: () => {} }
    const { container } = renderWithHost(<StartControl {...props} />, host)
    await waitFor(() => expect(call).toHaveBeenCalledWith('p1', 'startPlaces', {}))
    expect(container.textContent).toBe('')
  })
})

describe("a session's start", () => {
  test('the branch it started from, said, with the one it works on in the hover; nothing in a profile, which is for any project', async () => {
    const props: UiComposerControlProps = { in: 'session', projectId: 'p1', agentId: 'run1', options: {}, onChange: () => {}, busy: false, say: () => {} }
    renderWithHost(<StartControl {...props} />, host)
    const said = await screen.findByText('main')
    expect(call).toHaveBeenCalledWith('p1', 'startedFrom', { agentId: 'run1' })
    expect((await hoverTooltip(said.parentElement!)).textContent).toBe('Started from main, works on agent-fix-it')
    cleanup()
    const { container } = renderWithHost(<StartControl {...props} in="profile" />, host)
    expect(container.textContent).toBe('')
  })
})
