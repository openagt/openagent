import { describe, expect, test } from 'vitest'
import { agentLabel, awaitingName, NAMING_WAIT_MS } from './agent-label.js'

const NOW = Date.parse('2026-10-14T18:00:00.000Z')
const run = (over: Partial<Parameters<typeof awaitingName>[0]> = {}) => ({ id: 'r1', startedAt: new Date(NOW - 2_000).toISOString(), ...over })

describe('agentLabel', () => {
  test('the name a session was given comes before the words the person typed', () => {
    expect(agentLabel({ id: 'r1', title: 'README.md condensing', intent: 'make readme.md shorter', startedAt: '' })).toBe('README.md condensing')
    expect(agentLabel({ id: 'r1', intent: 'make readme.md shorter', startedAt: '' })).toBe('make readme.md shorter')
    expect(agentLabel({ id: 'r1', branch: 'agent-x', startedAt: '' })).toBe('agent-x')
  })
})

describe('awaitingName', () => {
  test('a run just started with naming on waits, rather than show the prompt and swap it a second later', () => {
    expect(awaitingName(run(), true, NOW)).toBe(true)
  })

  test('nothing waits once there is a name, nor for a subagent, which is never named', () => {
    expect(awaitingName(run({ title: 'README.md condensing' }), true, NOW)).toBe(false)
    expect(awaitingName(run({ parent: 'r0' }), true, NOW)).toBe(false)
  })

  test('naming turned off waits for nothing: no name is coming, so the prompt is the name', () => {
    expect(awaitingName(run(), false, NOW)).toBe(false)
  })

  test('a run too old to still be waiting shows what it has: a run from before naming existed never waits', () => {
    const old = run({ startedAt: new Date(NOW - NAMING_WAIT_MS - 1).toISOString() })
    expect(awaitingName(old, true, NOW)).toBe(false)
    expect(awaitingName(run({ startedAt: 'not a date' }), true, NOW)).toBe(false)
  })
})
