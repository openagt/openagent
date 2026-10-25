import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ModuleHostContext, type ModuleHost, type ModuleHostPerson } from '@openagt/dashboard/module'
import { MembersCard } from './MembersCard.js'

// The Overview's Members card, from `logs people` in each project and the git host's accounts
// behind their emails. The tally itself is src/people.test.ts's.

const NOW = new Date().toISOString()
const person = (email: string, over: Record<string, unknown> = {}) => ({ person: email, runs: 0, running: 0, cost: 0, commits: 0, lastAt: NOW, ...over })

/** A host whose `logs people` says `people`; the runs it lists are `runs`, and with none it cannot list them. */
function hostWith(people: unknown[], accounts: ModuleHostPerson[], runs?: unknown[]): ModuleHost {
  return {
    package: '@openagt/skill-logs',
    runCommand: vi.fn(async () => ({ ok: true as const, output: people })),
    agents: vi.fn(async () => {
      if (!runs) throw new Error('no runs listed')
      return runs
    }),
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

test("a member's runs are counted as the dashboard lists them: a run its record still calls going is not working when the dashboard says it is not", async () => {
  // The records froze while the laptop's run went on: they say one run, going.
  const host = hostWith(
    [person('s@a.dev', { name: 'Suleiman Shahbari', runs: 1, running: 1, cost: 0.5, commits: 2 })],
    [],
    [
      // Its computer does not answer: how it stands is unknown, so it is not working.
      { id: 'r1', status: 'unknown', startedAt: NOW, person: 's@a.dev', cost: 0.5 },
      // A run the records do not have yet, from the laptop itself.
      { id: 'r2', status: 'done', startedAt: NOW, person: 's@a.dev', cost: 1 },
    ],
  )
  show(host)
  const me = await screen.findByRole('listitem', { name: 'Suleiman Shahbari' })
  expect(within(me).getByText('2 runs · $1.50 · 2 commits')).toBeTruthy()
  expect(within(me).queryByText(/working/)).toBeNull()
})

test('a run the dashboard says is going makes its person working, though no record says so yet', async () => {
  const host = hostWith([person('s@a.dev', { name: 'Suleiman Shahbari', commits: 2 })], [], [{ id: 'r1', status: 'running', startedAt: NOW, person: 's@a.dev' }])
  show(host)
  const me = await screen.findByRole('listitem', { name: 'Suleiman Shahbari' })
  expect(within(me).getByText('working')).toBeTruthy()
})
