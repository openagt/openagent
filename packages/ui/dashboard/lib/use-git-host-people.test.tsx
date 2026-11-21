import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ModuleHostPerson } from '../module/index.js'
import { forgetRemembered } from './use-async.js'
import { personSaid, useGitHostPeople, type PersonWanted } from './use-git-host-people.js'

afterEach(() => {
  cleanup()
  forgetRemembered()
  localStorage.clear()
})

const account = (email: string, login: string): ModuleHostPerson => ({ email, login, avatar: `https://pictures/${login}` })
const answers = (known: ModuleHostPerson[]) => vi.fn(async (_projectId: string, emails: string[]) => known.filter(person => emails.includes(person.email)))

test("each project's git host is asked once, for that project's people, however many rows name them", async () => {
  const ask = answers([account('ada@x.dev', 'ada')])
  const { result } = renderHook(() =>
    useGitHostPeople(
      [
        { projectId: 'beta', person: 'ada@x.dev' },
        { projectId: 'alpha', person: 'rom@y.dev' },
        { projectId: 'alpha', person: 'ada@x.dev' },
        { projectId: 'alpha', person: 'ada@x.dev' },
        // A very old card names nobody, and a row of no project has nowhere to ask.
        { projectId: 'alpha' },
        { projectId: null, person: 'lost@z.dev' },
      ],
      ask,
      'test',
    ),
  )
  await waitFor(() => expect(result.current('alpha', 'ada@x.dev')?.login).toBe('ada'))
  expect(ask.mock.calls.sort(([a], [b]) => a.localeCompare(b))).toEqual([
    ['alpha', ['ada@x.dev', 'rom@y.dev']],
    ['beta', ['ada@x.dev']],
  ])
  // By the project and whatever the email's case; someone the host does not know, nothing.
  expect(result.current('alpha', 'ADA@x.dev')?.login).toBe('ada')
  expect(result.current('alpha', 'rom@y.dev')).toBeUndefined()
  expect(result.current('gamma', 'ada@x.dev')).toBeUndefined()
  expect(result.current(null, 'ada@x.dev')).toBeUndefined()
  expect(result.current('alpha', undefined)).toBeUndefined()
})

test('the list read again is not asked again; someone new is, and those already known stay shown meanwhile', async () => {
  let answer: (people: ModuleHostPerson[]) => void = () => {}
  const ask = vi.fn<(projectId: string, emails: string[]) => Promise<ModuleHostPerson[]>>(async () => [account('ada@x.dev', 'ada')])
  const first: PersonWanted[] = [{ projectId: 'alpha', person: 'ada@x.dev' }]
  const { result, rerender } = renderHook(({ wanted }) => useGitHostPeople(wanted, ask, 'test'), { initialProps: { wanted: first } })
  await waitFor(() => expect(result.current('alpha', 'ada@x.dev')?.login).toBe('ada'))
  expect(ask).toHaveBeenCalledTimes(1)

  // The poll of the list: new rows, a new array, the same people.
  rerender({ wanted: [{ projectId: 'alpha', person: 'ada@x.dev' }, { projectId: 'alpha', person: 'ada@x.dev' }] })
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(ask).toHaveBeenCalledTimes(1)

  ask.mockImplementation(() => new Promise(resolve => (answer = resolve)))
  rerender({ wanted: [{ projectId: 'alpha', person: 'ada@x.dev' }, { projectId: 'alpha', person: 'rom@y.dev' }] })
  await waitFor(() => expect(ask).toHaveBeenLastCalledWith('alpha', ['ada@x.dev', 'rom@y.dev']))
  expect(result.current('alpha', 'ada@x.dev')?.login).toBe('ada')
  answer([account('ada@x.dev', 'ada'), account('rom@y.dev', 'rom')])
  await waitFor(() => expect(result.current('alpha', 'rom@y.dev')?.login).toBe('rom'))
  expect(result.current('alpha', 'ada@x.dev')?.login).toBe('ada')
})

test('no people, nothing asked', async () => {
  const ask = answers([])
  renderHook(() => useGitHostPeople([{ projectId: 'alpha' }], ask, 'test'))
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(ask).not.toHaveBeenCalled()
})

test('what a person says they are: their email, and their account when the host knows it', () => {
  expect(personSaid('ada@x.dev', undefined)).toBe('ada@x.dev')
  expect(personSaid('ada@x.dev', account('ada@x.dev', 'ada'))).toBe('ada@x.dev · ada')
})
