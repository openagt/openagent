import { afterEach, expect, test } from 'vitest'
import { cleanup, render, renderHook, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { ProjectSummary } from '../../src/index.js'
import { ModulesContext, mountedOf, type MountedView } from '../lib/use-modules.js'
import { useModuleCards } from './ModuleCards.js'

afterEach(cleanup)

const projects = [{ id: 'p1', name: 'alpha', path: '/p1' }] as ProjectSummary[]
const card = (pkg: string, id: string, needsYou?: true): MountedView<'overview.card'> => ({
  place: 'overview.card',
  package: pkg,
  projects: [],
  computer: true,
  id,
  label: id,
  ...(needsYou ? { needsYou } : {}),
  View: () => <p>{`${pkg} ${id}`}</p>,
})

test('the card of what needs the person is the part the line’s count scrolls to: only the first that says so', async () => {
  const views = [card('@x/waiting', 'queue', true), card('@x/other', 'also', true), card('@x/tickets', 'hot')]
  const wrapper = ({ children }: { children: ReactNode }) => <ModulesContext.Provider value={mountedOf({ views: { 'overview.card': views } })}>{children}</ModulesContext.Provider>
  const { result } = renderHook(() => useModuleCards(projects), { wrapper })
  expect(result.current.cards.map(one => [one.id, one.needsYou ?? false])).toEqual([
    ['@x/waiting/queue', true],
    ['@x/other/also', false],
    ['@x/tickets/hot', false],
  ])
  render(<>{result.current.cards.map(one => <div key={one.id}>{one.node}</div>)}</>)
  expect((await screen.findByText('@x/waiting queue')).closest('#needs-you')).toBeTruthy()
  expect(screen.getByText('@x/other also').closest('#needs-you')).toBeNull()
  expect(document.querySelectorAll('#needs-you')).toHaveLength(1)
})

test('until the packages’ code is in, the card of what needs the person the last load drew holds its room, where the line’s count scrolls; once in, the card takes it', async () => {
  const kept = card('@x/waiting', 'queue', true)
  const mounted = (loaded: boolean, views: MountedView<'overview.card'>[]) => ({ children }: { children: ReactNode }) => <ModulesContext.Provider value={mountedOf({ views: { 'overview.card': views }, loaded })}>{children}</ModulesContext.Provider>
  // A load that drew it keeps where it stands, for the next.
  renderHook(() => useModuleCards(projects), { wrapper: mounted(true, [{ ...kept, order: 5, width: '2/3', minWidth: '1/2' }]) })
  expect(JSON.parse(localStorage.getItem('openagent:needs-you-card')!)).toEqual({ id: '@x/waiting/queue', label: 'queue', order: 5, width: '2/3', minWidth: '1/2' })
  // The next load, before its code is in: its room, first, as wide as it stood.
  const { result } = renderHook(() => useModuleCards(projects), { wrapper: mounted(false, []) })
  expect(result.current.cards.map(one => [one.id, one.order, one.width, one.needsYou, one.holding])).toEqual([['@x/waiting/queue', 5, '2/3', true, true]])
  render(<>{result.current.cards[0]!.node}</>)
  expect(document.querySelector('#needs-you')).toBeTruthy()
  cleanup()
  // Every package in, and none brings it any more: nothing is held, and the next load holds nothing.
  renderHook(() => useModuleCards(projects), { wrapper: mounted(true, []) })
  expect(localStorage.getItem('openagent:needs-you-card')).toBeNull()
  const { result: next } = renderHook(() => useModuleCards(projects), { wrapper: mounted(false, []) })
  expect(next.current.cards).toEqual([])
})
