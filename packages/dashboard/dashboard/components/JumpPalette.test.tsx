import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { AgentMeta, FoundAgent, Intervention } from '../../src/index.js'
import type { Route } from '../lib/route.js'

// The transport, stubbed at its one seam: the jump's one read answers when the test says.
const allAgents = vi.hoisted(() => ({ answer: (): Promise<unknown> => new Promise(() => {}) }))
vi.mock('../lib/rpc.js', () => ({
  rpc: (name: string) => async () => (name === 'onAllAgents' ? allAgents.answer() : null),
}))

const { JumpPalette, openJump } = await import('./JumpPalette.js')

const run = (id: string, fields: Partial<AgentMeta> = {}): AgentMeta => ({ id, status: 'done', startedAt: '2026-11-01T10:00:00Z', updatedAt: '2026-11-01T10:00:00Z', ...fields }) as AgentMeta
const found = (projectId: string, id: string, title: string): FoundAgent => ({ projectId, projectName: projectId, agent: { id, title, startedAt: '2026-01-01T10:00:00Z' } })

const SHOP = { id: 'shop', path: '/shop', name: 'shop', activated: true, gitHost: true }
const BLOG = { id: 'blog', path: '/blog', name: 'blog', activated: true, gitHost: true }

const WAITING: Intervention = { projectId: 'shop', projectName: 'shop', kind: 'awaiting', title: 'Pick a colour', agentId: 'r-ask' }

let go: ReturnType<typeof vi.fn<(to: Route) => void>>

function draw(props: Partial<Parameters<typeof JumpPalette>[0]> = {}) {
  return render(
    <JumpPalette
      waiting={[WAITING]}
      runs={[
        { projectId: 'shop', projectName: 'shop', agent: run('r-cart', { title: 'Cart page', branch: 'feat/cart', pr: { number: 12, url: 'https://git.example/pr/12' } }) },
        { projectId: 'shop', projectName: 'shop', agent: run('r-ask', { title: 'Pick a colour' }) },
        { projectId: 'blog', projectName: 'blog', agent: run('r-post', { title: 'First post' }) },
      ]}
      pages={[{ segment: 'tickets', label: 'Tickets' }]}
      projects={[SHOP, BLOG]}
      scope={null}
      here={{ projectId: null, agentId: null }}
      hrefOf={to => `/${to.projectId ?? ''}${to.agentId ? `/${to.agentId}` : ''}${to.page ? to.page : ''}`}
      go={go}
      {...props}
    />,
  )
}

/** The groups shown, each with its rows' names. */
function shown(): Record<string, string[]> {
  const listbox = screen.getByRole('listbox')
  return Object.fromEntries(
    within(listbox)
      .getAllByRole('group')
      .map(group => [group.getAttribute('aria-labelledby') && document.getElementById(group.getAttribute('aria-labelledby')!)?.textContent, within(group).queryAllByRole('option').map(option => option.querySelector('span')?.textContent)]),
  )
}

beforeEach(() => {
  go = vi.fn<(to: Route) => void>()
  allAgents.answer = () => new Promise(() => {})
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('the jump', () => {
  test('⌘K or Ctrl+K opens it, the message box too, and it is a combo box over a list that says how many it holds', async () => {
    draw()
    const box = document.body.appendChild(Object.defineProperty(document.createElement('div'), 'isContentEditable', { value: true }))
    fireEvent.keyDown(box, { key: 'k', ctrlKey: true })
    const input = await screen.findByRole('combobox', { name: 'Jump to' })
    expect(document.activeElement).toBe(input)
    expect(screen.getByRole('listbox')).toBeTruthy()
    expect(screen.getAllByRole('status')[0]!.textContent).toMatch(/^7 places/)
    box.remove()
  })

  test('empty, it lists the runs waiting on you, then the runs, the pages and the other projects', async () => {
    draw({ scope: 'shop' })
    act(() => openJump())
    await screen.findByRole('listbox')
    expect(shown()).toEqual({
      'Waiting on you': ['Pick a colour'],
      Recent: ['Cart page', 'First post'],
      Pages: ['Overview', 'Tickets'],
      Projects: ['blog'],
    })
  })

  test('the runs last opened come first among the recent ones, and the one on the page is not among them', async () => {
    draw({ here: { projectId: 'blog', agentId: 'r-post' } })
    cleanup()
    draw({ waiting: [], here: { projectId: 'shop', agentId: 'r-cart' } })
    act(() => openJump())
    await screen.findByRole('listbox')
    expect(shown().Recent).toEqual(['First post', 'Pick a colour'])
  })

  test('typed into, a run is found by its title, its branch and its pull request’s number, the best match first', async () => {
    draw()
    act(() => openJump())
    const input = await screen.findByRole('combobox')
    fireEvent.change(input, { target: { value: 'cart' } })
    expect(shown()).toEqual({ Recent: ['Cart page'] })
    fireEvent.change(input, { target: { value: 'feat/' } })
    expect(shown()).toEqual({ Recent: ['Cart page'] })
    fireEvent.change(input, { target: { value: '#12' } })
    expect(shown()).toEqual({ Recent: ['Cart page'] })
    fireEvent.change(input, { target: { value: 'p' } })
    // "Pick a colour" starts with it, "Cart page" has it at a word's start, "First post" too, "shop" inside a word.
    expect(shown()).toEqual({ 'Waiting on you': ['Pick a colour'], Recent: ['Cart page', 'First post'], Projects: ['shop'] })
    fireEvent.change(input, { target: { value: 'nothing like it' } })
    expect(screen.getByText('Nothing matches “nothing like it”')).toBeTruthy()
  })

  test('every other run is read as it opens, and what it adds comes under what is shown, never among it', async () => {
    let answer: (runs: FoundAgent[]) => void = () => {}
    allAgents.answer = () => new Promise(resolve => (answer = resolve))
    // Five recent ones, and a sixth the page has read too.
    const runs = [...['a', 'b', 'c', 'd', 'e'].map(id => ({ projectId: 'shop', projectName: 'shop', agent: run(id, { title: `Other thing ${id}` }) })), { projectId: 'shop', projectName: 'shop', agent: run('r-old', { title: 'An old post' }) }]
    draw({ waiting: [], runs })
    act(() => openJump())
    const input = await screen.findByRole('combobox')
    fireEvent.change(input, { target: { value: 'post' } })
    expect(shown()).toEqual({ Runs: ['An old post'] })
    await act(async () => answer([found('blog', 'r-new', 'Post about posts'), found('shop', 'r-old', 'An old post')]))
    // Read while "post" stood: under it, though it matches better.
    expect(shown()).toEqual({ Runs: ['An old post', 'Post about posts'] })
    fireEvent.change(input, { target: { value: 'post ' } })
    expect(shown()).toEqual({ Runs: ['Post about posts', 'An old post'] })
  })

  test('a thousand runs are ranked in the frame of the key, and a group shows its first twenty with how many more match', async () => {
    allAgents.answer = async () => Array.from({ length: 1000 }, (_, at) => found('shop', `r${at}`, `Run number ${at}`))
    draw()
    act(() => openJump())
    const input = await screen.findByRole('combobox')
    // The read is in.
    await act(async () => {})
    fireEvent.change(input, { target: { value: 'run num' } })
    // Nothing is awaited: the thousand are ranked in the key's own task, and twenty rows are drawn.
    expect(shown().Runs).toHaveLength(20)
    expect(screen.getByText('980 more: keep typing')).toBeTruthy()
  })

  test('arrows mark a row, Enter goes there and closes; the marked row is the one the pointer is on', async () => {
    draw()
    act(() => openJump())
    const input = await screen.findByRole('combobox')
    expect(input.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[0]!.id)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    const second = screen.getAllByRole('option')[1]!
    expect(input.getAttribute('aria-activedescendant')).toBe(second.id)
    expect(second.getAttribute('href')).toBe('/shop/r-cart')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(go).toHaveBeenCalledWith({ projectId: 'shop', agentId: 'r-cart' })
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
  })

  test('⌘/Ctrl+Enter opens the marked row in a new tab and goes nowhere here', async () => {
    const opened = vi.spyOn(window, 'open').mockReturnValue(null)
    draw()
    act(() => openJump())
    const input = await screen.findByRole('combobox')
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
    expect(opened).toHaveBeenCalledWith('/shop/r-ask', '_blank', 'noopener')
    expect(go).not.toHaveBeenCalled()
  })

  test('Escape closes it without going anywhere', async () => {
    draw()
    act(() => openJump())
    const input = await screen.findByRole('combobox')
    fireEvent.keyDown(input, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('combobox')).toBeNull())
    expect(go).not.toHaveBeenCalled()
  })

  test('it never opens over a dialog that is open, nor for a key composing a character', () => {
    draw()
    const dialog = document.body.appendChild(document.createElement('div'))
    dialog.setAttribute('role', 'dialog')
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true })
    expect(screen.queryByRole('combobox')).toBeNull()
    dialog.remove()
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true, isComposing: true })
    expect(screen.queryByRole('combobox')).toBeNull()
  })
})
