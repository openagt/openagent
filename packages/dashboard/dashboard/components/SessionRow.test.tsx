import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { cloneElement, type ReactElement, type ReactNode } from 'react'

// What each item's hover says is on the page as a line, and its trigger is what holds the button.
vi.mock('./ui/tooltip.js', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ render: trigger, children }: { render: ReactElement; children: ReactNode }) => cloneElement(trigger, { 'data-hover': true } as never, children),
  TooltipContent: ({ children }: { children: ReactNode }) => <span role="tooltip">{children}</span>,
}))

const { SessionRow } = await import('./SessionRow.js')

afterEach(cleanup)

const facts = { runsOn: 'This machine', elsewhere: false, projectName: 'site', startedFrom: 'main', worksOn: 'agent-fix-login' }
const words = (container: HTMLElement) => [...container.querySelectorAll('button')].map(button => button.textContent)

describe('a session\'s row above the box', () => {
  test('where it runs, the project, the branch: every one off, and nothing else, as the launcher\'s row (the agent and the account are under the box)', () => {
    const { container } = render(<SessionRow {...facts} />)
    expect(words(container)).toEqual(['This machine', 'site', 'main'])
    for (const button of container.querySelectorAll('button')) expect(button.disabled).toBe(true)
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
    // A disabled button takes no pointer: the hover is on what holds it.
    const button = screen.getByRole('button', { name: startedFrom }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.parentElement!.hasAttribute('data-hover')).toBe(true)
  })

  test('the branch it says is the one it started from, not the one it works on, which only its hover names', () => {
    const { container } = render(<SessionRow {...facts} />)
    expect(words(container)).toContain('main')
    expect(words(container).join()).not.toContain('agent-fix-login')
  })

  test('a machine and the cloud say what they are: their name, and the mark of not being this computer', () => {
    const dot = (container: HTMLElement) => container.querySelector('button .rounded-full')
    const { container, rerender } = render(<SessionRow {...facts} />)
    expect(dot(container)).toBeNull()
    rerender(<SessionRow {...facts} runsOn="Studio" target="remote" remoteKind="server" elsewhere />)
    expect(words(container)[0]).toBe('Studio')
    expect(dot(container)).toBeTruthy()
    rerender(<SessionRow {...facts} runsOn="Cloud" target="web" elsewhere />)
    expect(words(container)[0]).toBe('Cloud')
    rerender(<SessionRow {...facts} runsOn="GitHub Actions" target="actions" elsewhere />)
    expect(words(container)[0]).toBe('GitHub Actions')
  })
})
