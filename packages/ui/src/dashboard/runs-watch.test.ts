import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { AgentMeta } from '../store/index.js'
import { RunsWatch } from './runs-watch.js'

const until = async (done: () => boolean): Promise<void> => {
  for (let i = 0; i < 200 && !done(); i++) await new Promise(resolve => setTimeout(resolve, 5))
  assert.ok(done(), 'it never happened')
}
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 40))

/** A project's runs as its host says them, as a test changes them. */
function project(): { source: ConstructorParameters<typeof RunsWatch>[0]; cards: Map<string, AgentMeta>; reads: () => number } {
  const cards = new Map<string, AgentMeta>()
  let reads = 0
  return {
    cards,
    reads: () => reads,
    source: {
      runs: async () => {
        reads++
        return [...cards.values()]
      },
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

test('a run started here is seen at once: its runs are read again when poked', async () => {
  const { source, cards, reads } = project()
  const watch = new RunsWatch(source, Date.now, 60_000)
  let told = 0
  const stop = watch.follow('/p', () => told++)
  await until(() => reads() === 1)
  cards.set('02', card('02', 'running'))
  await settle()
  assert.equal(told, 0, 'not read again before its time')
  watch.poke('/p')
  await until(() => told === 1)
  stop()
})

test('a project nobody listens to is read a while more, then not at all', async () => {
  const { source, cards, reads } = project()
  let now = 1_000_000
  cards.set('01', card('01', 'running'))
  const watch = new RunsWatch(source, () => now, 5)
  watch.follow('/p', () => {})()
  // Still read: a computer that waits asks again the moment it was answered.
  await until(() => reads() >= 3)
  // A listener coming back finds what was read before: a change in between is told.
  cards.set('01', card('01', 'done'))
  let told = 0
  const again = watch.follow('/p', () => told++)
  await until(() => told === 1)
  again()
  now += 30_000
  await settle()
  const stoppedAt = reads()
  await settle()
  assert.equal(reads(), stoppedAt)
})
