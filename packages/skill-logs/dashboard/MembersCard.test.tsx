import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ModuleHostContext, type ModuleHost, type ModuleHostPerson } from '@openagt/dashboard/module'
import { MembersCard } from './MembersCard.js'

// The Overview's Members card, from `logs people` in each project and the git host's accounts
// behind their emails. The tally itself is src/people.test.ts's.

const NOW = new Date().toISOString()
const person = (email: string, over: Record<string, unknown> = {}) => ({ person: email, runs: 0, running: 0, cost: 0, commits: 0, lastAt: NOW, ...over })

function hostWith(people: unknown[], accounts: ModuleHostPerson[]): ModuleHost {
  return {
    package: '@openagt/skill-logs',
    runCommand: vi.fn(async () => ({ ok: true as const, output: people })),
    gitHostPeople: vi.fn(async () => accounts),
    openPage: vi.fn(),
    pageHref: (segment: string) => `/${segment}`,
  } as unknown as ModuleHost
}

const show = (host: ModuleHost) =>
  render(
    <ModuleHostContext.Provider value={host}>
      <MembersCard projects={[{ id: 'p1', name: 'alpha', gitHost: true }]} />
    </ModuleHostContext.Provider>,
  )

afterEach(cleanup)

test("each member by the name git knows, their picture where the git host knows their account, else two letters; a picture that does not load gives way to the letters", async () => {
  const host = hostWith(
    [person('git@brillout.com', { name: 'Romuald Brillout', commits: 1 }), person('s@a.dev', { name: 'Suleiman Shahbari', runs: 3, cost: 1.5, commits: 2, you: true }), person('new@z.dev')],
    [
      { email: 'git@brillout.com', login: 'brillout', avatar: 'https://avatars.githubusercontent.com/u/1' },
      { email: 's@a.dev', login: 'suleimansh', avatar: 'https://avatars.githubusercontent.com/u/2' },
    ],
  )
  show(host)
  const rom = await screen.findByRole('listitem', { name: 'Romuald Brillout' })
  expect(rom.querySelector('img')!.getAttribute('src')).toBe('https://avatars.githubusercontent.com/u/1')
  expect(within(rom).getByText('Romuald Brillout').getAttribute('title')).toBe('git@brillout.com · brillout')
  expect(within(rom).getByText('1 commit')).toBeTruthy()
  // The git host is asked of the project's own emails.
  expect(host.gitHostPeople).toHaveBeenCalledWith('p1', ['git@brillout.com', 's@a.dev', 'new@z.dev'])
  // No account known: the letters.
  const fresh = screen.getByRole('listitem', { name: 'new' })
  expect(fresh.querySelector('img')).toBeNull()
  expect(within(fresh).getByText('NE')).toBeTruthy()
  // A picture that fails to load: the letters.
  const me = screen.getByRole('listitem', { name: 'Suleiman Shahbari' })
  expect(within(me).getByText('3 runs · $1.50 · 2 commits')).toBeTruthy()
  fireEvent.error(me.querySelector('img')!)
  expect(me.querySelector('img')).toBeNull()
  expect(within(me).getByText('SS')).toBeTruthy()
})
