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

const facts = { runsOn: 'This machine', elsewhere: false, projectName: 'site', startedFrom: 'main', worksOn: 'agent-fix-login' }
/** The items' words as the row shows them: what only a screen reader hears left out. */
const words = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>('[data-hover]')].map(item => [...item.childNodes].filter(node => !(node instanceof HTMLElement && node.classList.contains('sr-only'))).map(node => node.textContent).join(''))

describe('a session\'s row above the box', () => {
  test('where it runs, the project, the branch: each said in words the keyboard stops on, none a menu, and nothing else, as the launcher\'s row (the setup and the model are under the box)', () => {
    const { container } = render(<SessionRow {...facts} />)
    expect(words(container)).toEqual(['This machine', 'site', 'main'])
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

  test('a session with no project shows the repos it has, each said with where it was copied from', () => {
    const { container } = render(<SessionRow runsOn="This machine" elsewhere={false} repos={[{ name: 'vike', from: '/home/me/oss/vike' }, { name: 'notes', from: '/home/me/notes' }]} />)
    expect(container.textContent).toContain('vike')
    expect(container.textContent).toContain('notes')
    expect(screen.getByText("A copy of /home/me/oss/vike, in this session's folder")).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull()
  })

  test('its height is the row\'s own, whatever has landed: nothing moves when a name lands', () => {
    const { container } = render(<SessionRow runsOn="This machine" elsewhere={false} />)
    expect(container.firstElementChild!.className.split(' ')).toContain('h-8')
    expect(words(container)).toEqual(['This machine'])
  })

  test('no project name yet, or no branch to vouch for: no word for it, never a guess', () => {
    const { container, rerender } = render(<SessionRow {...facts} projectName={null} />)
    expect(words(container)).toEqual(['This machine'])
    rerender(<SessionRow {...facts} startedFrom={undefined} />)
    expect(words(container)).toEqual(['This machine', 'site'])
  })

  test.each([
    ['main', 'agent-fix-login', 'Started from main, works on agent-fix-login'],
    ['main', undefined, 'Started from main'],
    ['agent-work', 'agent-work', 'Started from agent-work'],
  ])('the branch\'s hover, started from %s, working on %s', (startedFrom, worksOn, says) => {
    render(<SessionRow {...facts} startedFrom={startedFrom} worksOn={worksOn} />)
    expect(screen.getAllByRole('tooltip').map(tip => tip.textContent)).toContain(says)
    // A screen reader hears the words and their hover together.
    expect(screen.getByText(`. ${says}`).closest('[data-hover]')!.textContent).toBe(`${startedFrom}. ${says}`)
  })

  test('the branch it says is the one it started from, not the one it works on, which only its hover names', () => {
    const { container } = render(<SessionRow {...facts} />)
    expect(words(container)).toContain('main')
    expect(words(container).join()).not.toContain('agent-fix-login')
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
