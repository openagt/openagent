import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { cloneElement, type ReactElement, type ReactNode } from 'react'

vi.mock('../rpc/logins.js', () => ({ onGitHosts: async () => ({ hosts: [{ host: 'github.com', projects: [], provider: { name: 'GitHub', logo: '<svg></svg>', tool: 'gh', installed: true, accounts: [{ login: 'today', runs: true, ok: true }] } }] }), onAgentState: async () => undefined }))
vi.mock('../rpc/server-logins.js', () => ({ onServerLogins: async () => ({ computer: 'Studio', servers: [] }) }))

// What each item's hover says is on the page as a line, and its trigger is what holds the button.
vi.mock('./ui/tooltip.js', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ render: trigger, children }: { render: ReactElement; children: ReactNode }) => cloneElement(trigger, { 'data-hover': true } as never, children),
  TooltipContent: ({ children }: { children: ReactNode }) => <span role="tooltip">{children}</span>,
}))

const { SessionRow } = await import('./SessionRow.js')

afterEach(cleanup)

const facts = { runsOn: 'This machine', elsewhere: false, projectName: 'site', startedFrom: 'main', worksOn: 'agent-fix-login', gitHost: { url: 'https://github.com/o/r', name: 'GitHub' } }
const words = (container: HTMLElement) => [...container.querySelectorAll('button')].map(button => button.textContent)

describe('a session\'s row above the box', () => {
  test('where it runs, the project, the branch, at the other end the git host: every one off', async () => {
    const { container } = render(<SessionRow {...facts} />)
    await screen.findByRole('button', { name: 'GitHub' })
    expect(words(container)).toEqual(['This machine', 'site', 'main', 'GitHub'])
    for (const button of container.querySelectorAll('button')) expect(button.disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'GitHub' }).closest('.shrink-0')).toBeTruthy()
    // The account the next run would use is not the one this run used.
    expect(container.textContent).not.toContain('today')
  })

  test('a session with no project shows the repos it has, each said with where it was copied from', () => {
    const { container } = render(<SessionRow runsOn="This machine" elsewhere={false} gitHost={null} repos={[{ name: 'vike', from: '/home/me/oss/vike' }, { name: 'notes', from: '/home/me/notes' }]} />)
    expect(container.textContent).toContain('vike')
    expect(container.textContent).toContain('notes')
    expect(screen.getByText("A copy of /home/me/oss/vike, in this session's folder")).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull()
  })

  test('its height is the row\'s own, whatever has landed: nothing moves when a name lands', () => {
    const { container } = render(<SessionRow runsOn="This machine" elsewhere={false} gitHost={null} />)
    expect(container.firstElementChild!.className.split(' ')).toContain('h-8')
    expect(words(container)).toEqual(['This machine'])
  })

  test('no project name yet, or no branch to vouch for: no word for it, never a guess', () => {
    const { container, rerender } = render(<SessionRow {...facts} projectName={null} gitHost={null} />)
    expect(words(container)).toEqual(['This machine'])
    rerender(<SessionRow {...facts} startedFrom={undefined} gitHost={null} />)
    expect(words(container)).toEqual(['This machine', 'site'])
  })

  test.each([
    ['main', 'agent-fix-login', 'Started from main, works on agent-fix-login'],
    ['main', undefined, 'Started from main'],
    ['agent-work', 'agent-work', 'Started from agent-work'],
  ])('the branch\'s hover, started from %s, working on %s', (startedFrom, worksOn, says) => {
    render(<SessionRow {...facts} startedFrom={startedFrom} worksOn={worksOn} gitHost={null} />)
    expect(screen.getAllByRole('tooltip').map(tip => tip.textContent)).toContain(says)
    // A disabled button takes no pointer: the hover is on what holds it.
    const button = screen.getByRole('button', { name: startedFrom }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.parentElement!.hasAttribute('data-hover')).toBe(true)
  })

  test('the branch it says is the one it started from, not the one it works on, which only its hover names', () => {
    const { container } = render(<SessionRow {...facts} gitHost={null} />)
    expect(words(container)).toContain('main')
    expect(words(container).join()).not.toContain('agent-fix-login')
  })

  test('a machine and the cloud say what they are: their name, and the mark of not being this computer', () => {
    const dot = (container: HTMLElement) => container.querySelector('button .rounded-full')
    const { container, rerender } = render(<SessionRow {...facts} gitHost={null} />)
    expect(dot(container)).toBeNull()
    rerender(<SessionRow {...facts} runsOn="Studio" target="remote" remoteKind="server" elsewhere gitHost={null} />)
    expect(words(container)[0]).toBe('Studio')
    expect(dot(container)).toBeTruthy()
    rerender(<SessionRow {...facts} runsOn="Cloud" target="web" elsewhere gitHost={null} />)
    expect(words(container)[0]).toBe('Cloud')
    rerender(<SessionRow {...facts} runsOn="GitHub Actions" target="actions" elsewhere gitHost={null} />)
    expect(words(container)[0]).toBe('GitHub Actions')
  })
})
