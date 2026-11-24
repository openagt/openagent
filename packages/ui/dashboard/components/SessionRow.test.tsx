import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { cloneElement, type ReactElement, type ReactNode } from 'react'

// What each item's hover says is on the page as a line, and its trigger is the item.
vi.mock('./ui/tooltip.js', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ render: trigger, children }: { render: ReactElement; children: ReactNode }) => cloneElement(trigger, { 'data-hover': true } as never, children),
  TooltipContent: ({ children }: { children: ReactNode }) => <span role="tooltip">{children}</span>,
}))

const { SessionRow } = await import('./SessionRow.js')

afterEach(cleanup)

const facts = { runsOn: 'This machine', elsewhere: false, projectName: 'site' }
/** The items' words as the row shows them: what only a screen reader hears left out. */
const words = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>('[data-hover]')].map(item => [...item.childNodes].filter(node => !(node instanceof HTMLElement && node.classList.contains('sr-only'))).map(node => node.textContent).join(''))

describe('a session\'s row above the box', () => {
  test('where it runs and the project: each said in words the keyboard stops on, none a menu, and nothing else, as the launcher\'s row (the setup and the model are under the box; the branch is a module\'s control)', () => {
    const { container } = render(<SessionRow {...facts} />)
    expect(words(container)).toEqual(['This machine', 'site'])
    expect(container.querySelector('button')).toBeNull()
    for (const item of container.querySelectorAll<HTMLElement>('[data-hover]')) expect(item.tabIndex).toBe(0)
  })

  test("the run's pull requests stand at the row's right end, after the side that gives way, so the last one ends on the box's edge and stays whole in a narrow box; none, nothing there", () => {
    const { container, rerender } = render(<SessionRow {...facts} prs={[{ number: 4, url: 'https://x/pull/4', state: 'merged' }, { number: 5, url: 'https://x/pull/5', state: 'OPEN' }]} />)
    const row = container.firstElementChild!
    const links = screen.getAllByRole('link')
    expect(links.map(link => link.textContent)).toEqual(['#4', '#5'])
    expect(row.lastElementChild!.contains(links[1]!)).toBe(true)
    expect(row.lastElementChild!.className.split(' ')).toContain('shrink-0')
    // Not in the left side, which scrolls and fades in a narrow box.
    expect(row.firstElementChild!.contains(links[0]!)).toBe(false)
    expect(row.firstElementChild!.textContent).toContain('site')
    rerender(<SessionRow {...facts} />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(container.firstElementChild!.childElementCount).toBe(1)
  })

  test('a session with no project says where it runs alone: its repos are under the box, as Context', () => {
    const { container } = render(<SessionRow runsOn="This machine" elsewhere={false} />)
    expect(container.textContent).toContain('This machine')
    expect(container.querySelector('.lucide-folder-git-2')).toBeNull()
  })

  test('its height is the row\'s own, whatever has landed: nothing moves when a name lands', () => {
    const { container } = render(<SessionRow runsOn="This machine" elsewhere={false} />)
    expect(container.firstElementChild!.className.split(' ')).toContain('h-8')
    expect(words(container)).toEqual(['This machine'])
  })

  test('no project name yet: no word for it, never a guess', () => {
    const { container } = render(<SessionRow {...facts} projectName={null} />)
    expect(words(container)).toEqual(['This machine'])
  })

  test('a host says what it is: its name, and the mark of not being this computer', () => {
    const dot = (container: HTMLElement) => container.querySelector('[data-hover] .rounded-full')
    const { container, rerender } = render(<SessionRow {...facts} />)
    expect(dot(container)).toBeNull()
    rerender(<SessionRow {...facts} runsOn="Claude Code on the web" target="web" elsewhere />)
    expect(words(container)[0]).toBe('Claude Code on the web')
    expect(dot(container)).toBeTruthy()
    rerender(<SessionRow {...facts} runsOn="GitHub Actions" target="actions" elsewhere />)
    expect(words(container)[0]).toBe('GitHub Actions')
  })
})
