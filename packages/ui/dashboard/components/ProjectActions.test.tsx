import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

// The menu reads the daemon and has tests of its own: here it only has to be in the bar, and to be
// told which project it acts on.
const menu = vi.hoisted(() => vi.fn())
vi.mock('./AgentActionsMenu.js', () => ({
  AgentActionsMenu: (props: { projectId: string; agentId?: string }) => {
    menu(props)
    return <button type="button">Agent actions</button>
  },
}))
// Any read of the daemon from the bar fails the test: the bar asks nothing.
vi.mock('../rpc/reads.js', () => new Proxy({}, { get: (_t, name) => (name === 'then' ? undefined : () => { throw new Error(`the bar read ${String(name)}`) }) }))

const { ProjectActions } = await import('./ProjectActions.js')

afterEach(cleanup)

describe('ProjectActions', () => {
  test('the page\'s name, as a session\'s bar has its name, and the ⋮ menu: no project name, no branch, no clean or dirty', () => {
    const { container } = render(<ProjectActions projectId="p1" />)
    expect(container.textContent).toBe('New agent sessionAgent actions')
    const name = screen.getByRole('heading', { level: 1, name: 'New agent session' })
    expect(name.className.split(' ')).toEqual(expect.arrayContaining(['truncate', 'text-sm', 'font-medium']))
    expect(name.nextElementSibling!.className).toContain('grow')
    expect(screen.getByRole('button', { name: 'Agent actions' })).toBeTruthy()
    // The menu acts on the project: it is given the project and no agent.
    expect(menu).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1', events: [] }))
    expect(menu.mock.calls[0]![0].agentId).toBeUndefined()
  })

  test("laid out as an agent's top bar: a line under it only while the chat scrolls under it, the same row, the menu at the end", () => {
    const { container } = render(<ProjectActions projectId="p1" />)
    expect(container.firstElementChild!.className).toBe('shadow-[inset_0_-1px_0_var(--color-border)]')
    const row = container.firstElementChild!.firstElementChild!
    // No layout in the test DOM, so the row is read off its classes.
    expect(row.className).not.toMatch(/border/)
    // It starts 16 in on every screen: a phone opens the sidebar from the bar of pages at its foot.
    for (const cls of ['flex', 'h-11', 'items-center', 'gap-2', 'overflow-hidden', 'pr-2', 'pl-4']) expect(row.className.split(' ')).toContain(cls)
    // The page's name, a spacer that takes the row's width, then the menu, last.
    expect(row.children).toHaveLength(3)
    expect(row.children[1]!.className).toContain('grow')
    expect(row.lastElementChild!.contains(screen.getByRole('button', { name: 'Agent actions' }))).toBe(true)
  })
})
