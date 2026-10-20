import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { ConversationGoneError, continuingTurn } from './gone.js'
import type { DriverEvent } from './types.js'

const isGone = (err: unknown): boolean => /gone/.test(String(err))

test('a turn on a conversation that is there sends every event, in order', async () => {
  const events: DriverEvent[] = []
  const turn = await continuingTurn('fake', 's-1', e => events.push(e), isGone, async emit => {
    emit({ type: 'start', prompt: 'go on' })
    emit({ type: 'session', sessionId: 's-1' })
    emit({ type: 'text', text: 'Going on.' })
    emit({ type: 'result', text: 'Going on.' })
    return { text: 'Going on.' }
  })
  assert.equal(turn.text, 'Going on.')
  assert.deepEqual(events.map(e => e.type), ['start', 'session', 'text', 'result'])
})

test('a turn on a gone conversation sends nothing and says it is gone; one that failed otherwise sends what it held, then fails', async () => {
  const events: DriverEvent[] = []
  const refused = (reason: string) => async (emit: (event: DriverEvent) => void) => {
    emit({ type: 'start', prompt: 'go on' })
    emit({ type: 'session', sessionId: 's-1' })
    emit({ type: 'error', message: reason })
    throw new Error(reason)
  }
  await assert.rejects(continuingTurn('fake', 's-1', e => events.push(e), isGone, refused('it is gone')), (err: unknown) => err instanceof ConversationGoneError && err.driver === 'fake' && err.sessionId === 's-1')
  assert.equal(events.length, 0)
  await assert.rejects(continuingTurn('fake', 's-1', e => events.push(e), isGone, refused('boom')), /boom/)
  assert.deepEqual(events.map(e => e.type), ['start', 'session', 'error'])
})

test('a failure after the agent began answering is the turn\'s own, whatever it says', async () => {
  const events: DriverEvent[] = []
  await assert.rejects(
    continuingTurn('fake', 's-1', e => events.push(e), isGone, async emit => {
      emit({ type: 'start', prompt: 'go on' })
      emit({ type: 'text', text: 'Working.' })
      throw new Error('gone mid-turn')
    }),
    (err: unknown) => !(err instanceof ConversationGoneError),
  )
  assert.deepEqual(events.map(e => e.type), ['start', 'text'])
})
