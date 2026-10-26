import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { AgentMeta, Checkout } from '../store/index.js'
import { RunsWatch } from './runs-watch.js'

const until = async (done: () => boolean): Promise<void> => {
  for (let i = 0; i < 200 && !done(); i++) await new Promise(resolve => setTimeout(resolve, 5))
  assert.ok(done(), 'it never happened')
}
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 40))

/** A project's checkouts and their cards, as a test changes them. */
function project(): { source: ConstructorParameters<typeof RunsWatch>[0]; cards: Map<string, AgentMeta>; listed: () => number } {
  const cards = new Map<string, AgentMeta>()
  let listed = 0
  return {
    cards,
    listed: () => listed,
    source: {
      checkouts: async () => {
        listed++
        return [...cards.keys()].map((id): Checkout => ({ id, path: `/p/.branches/${id}` }))
      },
      card: async checkout => cards.get(checkout.id),
    },
  }
}

const card = (id: string, status: AgentMeta['status'], more: Partial<AgentMeta> = {}): AgentMeta => ({ id, status, startedAt: '2026-10-26T10:00:00.000Z', updatedAt: '2026-10-26T10:00:00.000Z', ...more })

test('a listener is told when a run changes what a list shows of it, and not when its card only moved on', async () => {
  const { source, cards } = project()
  cards.set('01', card('01', 'running'))
  const watch = new RunsWatch(source, Date.now, 5)
  let told = 0
  const stop = watch.follow('/p', () => told++)
  await settle()
  assert.equal(told, 0)
  // Another step: the card is written again, with a later time and a higher cost, and says nothing new to a list.
  cards.set('01', card('01', 'running', { updatedAt: '2026-10-26T10:01:00.000Z', cost: 0.2 }))
  await settle()
  assert.equal(told, 0)
  // The run waits on the person: told.
  cards.set('01', card('01', 'waiting'))
  await until(() => told === 1)
  // Named, then ended.
  cards.set('01', card('01', 'waiting', { title: 'Fix the login' }))
  await until(() => told === 2)
  cards.set('01', card('01', 'done', { title: 'Fix the login', endedAt: '2026-10-26T10:05:00.000Z' }))
  await until(() => told === 3)
  stop()
})

test('a run started here is seen at once: its checkouts are listed again when poked, and else only now and then', async () => {
  const { source, cards, listed } = project()
  let now = 1_000_000
  const watch = new RunsWatch(source, () => now, 5)
  let told = 0
  const stop = watch.follow('/p', () => told++)
  await until(() => listed() === 1)
  // A new checkout is not seen by reading the cards: its checkout was never listed.
  cards.set('02', card('02', 'running'))
  await settle()
  assert.equal(told, 0)
  assert.equal(listed(), 1)
  watch.poke('/p')
  await until(() => told === 1)
  assert.equal(listed(), 2)
  // One started elsewhere than here is seen when the checkouts are listed again, a while later.
  cards.set('03', card('03', 'running'))
  now += 15_000
  await until(() => told === 2)
  stop()
})

test('a project nobody listens to is read a while more, then not at all', async () => {
  const { source, cards, listed } = project()
  let now = 1_000_000
  let reads = 0
  const counted = { ...source, card: async (checkout: Checkout) => (reads++, cards.get(checkout.id)) }
  cards.set('01', card('01', 'running'))
  const watch = new RunsWatch(counted, () => now, 5)
  watch.follow('/p', () => {})()
  // Still read: a computer that waits asks again the moment it was answered.
  await until(() => reads >= 3)
  // A listener coming back finds what was read before: a change in between is told.
  cards.set('01', card('01', 'done'))
  let told = 0
  const again = watch.follow('/p', () => told++)
  await until(() => told === 1)
  again()
  now += 30_000
  await settle()
  const stoppedAt = reads
  await settle()
  assert.equal(reads, stoppedAt)
  assert.equal(listed(), 1)
})
