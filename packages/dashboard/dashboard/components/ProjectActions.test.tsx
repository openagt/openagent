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
  test('the ⋮ menu alone: no project name, no branch, no clean or dirty', () => {
    const { container } = render(<ProjectActions projectId="p1" />)
    expect(container.textContent).toBe('Agent actions')
    expect(screen.getByRole('button', { name: 'Agent actions' })).toBeTruthy()
    // The menu acts on the project: it is given the project and no agent.
    expect(menu).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1', events: [] }))
    expect(menu.mock.calls[0]![0].agentId).toBeUndefined()
  })

  test('the menu is handed what to tell once the project is removed', () => {
    menu.mockClear()
    const onProjectRemoved = vi.fn()
    render(<ProjectActions projectId="p1" onProjectRemoved={onProjectRemoved} />)
    expect(menu).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1', onProjectRemoved }))
  })

  test("laid out as an agent's top bar: no bottom border, the same row, the menu at the end", () => {
    const { container } = render(<ProjectActions projectId="p1" />)
    const row = container.firstElementChild!
    // No layout in the test DOM, so the row is read off its classes.
    expect(row.className).not.toMatch(/border/)
    for (const cls of ['flex', 'h-11', 'items-center', 'gap-2', 'overflow-hidden', 'md:pl-4']) expect(row.className.split(' ')).toContain(cls)
    // On a phone its start is free for the menu's button. The phone's padding is never over a plain
    // one: a module's stylesheet has its own copy of that class, which comes later and would win.
    for (const cls of ['pr-2', 'max-md:pl-11']) expect(row.className.split(' ')).toContain(cls)
    for (const cls of ['px-4', 'pl-4']) expect(row.className.split(' ')).not.toContain(cls)
    // A spacer that takes the row's width, then the menu, last.
    expect(row.children).toHaveLength(2)
    expect(row.children[0]!.className).toContain('grow')
    expect(row.lastElementChild).toBe(screen.getByRole('button', { name: 'Agent actions' }))
  })
})
