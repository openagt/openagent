import type { RunEvent } from '@openagt/hooks'
import { describe, expect, test } from 'vitest'
import { arrange, callRow, callSubagents, subagentRows, subagentWait, subagentEvents, stepWords, subagentSteps, type SubagentRow, type SubagentStep } from './subagents.js'

describe('subagentSteps', () => {
  const at = (time: string): RunEvent => ({ kind: 'log', message: time, at: `2026-10-01T10:${time}.000Z` }) as RunEvent
  const turn = (time: string): RunEvent => ({ kind: 'driver', event: { type: 'start', prompt: 'go on' }, at: `2026-10-01T10:${time}.000Z` })
  const isTurn = (e: RunEvent) => e.kind === 'driver' && e.event.type === 'start'
  /** A subagent of the coding agent's own, started at `startedAt`, and ended at `endedAt` when given. */
  const row = (id: string, startedAt: string, endedAt?: string) => callRow({ id, status: endedAt ? 'ended' : 'working', calls: 0, startedAt, ...(endedAt ? { endedAt } : {}) }, true, startedAt)
  const placed = (groups: Map<number, SubagentStep[]>) => [...groups].map(([index, steps]) => [index, steps.map(step => step.row.key)])
  const NO_REPORTS = new Map<string, string>()

  test('a subagent goes before the first event written after it started; one started after the last event goes at the end', () => {
    const events = [turn('00:00'), at('02:00'), turn('02:30'), { kind: 'log', message: 'no time' } as RunEvent, turn('04:00')]
    const groups = subagentSteps(events, [row('d', '2026-10-01T10:09:00.000Z'), row('a', '2026-10-01T10:01:00.000Z'), row('c', '2026-10-01T10:03:00.000Z')], NO_REPORTS, isTurn)
    expect(placed(groups)).toEqual([
      [1, ['call:a']],
      [4, ['call:c']],
      [5, ['call:d']],
    ])
  })

  test('the subagents one turn started are one group, at the place of the first of them, in the order they were started', () => {
    const events = [turn('00:00'), at('01:10'), at('01:20'), at('01:40'), turn('02:00'), at('03:00')]
    const groups = subagentSteps(events, [row('b', '2026-10-01T10:01:30.000Z'), row('a', '2026-10-01T10:01:05.000Z'), row('c', '2026-10-01T10:02:30.000Z')], NO_REPORTS, isTurn)
    expect(placed(groups)).toEqual([
      [1, ['call:a', 'call:b']],
      [5, ['call:c']],
    ])
  })

  test('one started after the agent said something is a group of its own, after those words', () => {
    const said = (time: string): RunEvent => ({ kind: 'driver', event: { type: 'text', text: 'Both are running.' }, at: `2026-10-01T10:${time}.000Z` })
    const events = [turn('00:00'), at('01:10'), said('01:40'), at('02:40'), said('03:00')]
    const parts = (e: RunEvent) => isTurn(e) || (e.kind === 'driver' && e.event.type === 'text')
    const groups = subagentSteps(events, [row('a', '2026-10-01T10:01:05.000Z'), row('b', '2026-10-01T10:01:30.000Z'), row('c', '2026-10-01T10:02:30.000Z')], NO_REPORTS, parts)
    expect(placed(groups)).toEqual([
      [1, ['call:a', 'call:b']],
      [3, ['call:c']],
    ])
  })

  test('what they sent when they ended goes in the same line, until the agent says something', () => {
    const said = (time: string): RunEvent => ({ kind: 'driver', event: { type: 'text', text: 'One is back.' }, at: `2026-10-01T10:${time}.000Z` })
    const parts = (e: RunEvent) => isTurn(e) || (e.kind === 'driver' && e.event.type === 'text')
    const rows = [row('a', '2026-10-01T10:01:00.000Z', '2026-10-01T10:02:00.000Z'), row('b', '2026-10-01T10:02:30.000Z', '2026-10-01T10:02:40.000Z'), row('c', '2026-10-01T10:02:50.000Z', '2026-10-01T10:02:55.000Z')]
    const events = [turn('00:00'), said('01:30'), said('04:00')]
    const steps = subagentSteps(events, rows, new Map([['call:a', 'A found it.'], ['call:b', 'B found it.']]), parts)
    expect([...steps].map(([index, all]) => [index, all.map(step => `${step.kind}:${step.row.key}`)])).toEqual([
      [1, ['agent:call:a']],
      [2, ['message:call:a', 'agent:call:b', 'message:call:b', 'agent:call:c']],
    ])
    expect(stepWords(steps.get(2)!)).toBe('Received 2 messages, ran 2 agents')
    expect(stepWords(steps.get(1)!)).toBe('Ran an agent')
  })

  test('a subagent started just before a prompt is a subagent of the turn it was started in, not of the next', () => {
    const events = [turn('00:00'), at('01:00'), turn('02:00'), at('03:00')]
    const groups = subagentSteps(events, [row('a', '2026-10-01T10:00:30.000Z'), row('b', '2026-10-01T10:01:30.000Z')], NO_REPORTS, isTurn)
    expect(placed(groups)).toEqual([[1, ['call:a', 'call:b']]])
  })
})

describe('callSubagents and subagentEvents', () => {
  const ev = (event: Extract<RunEvent, { kind: 'driver' }>['event'], at: string): RunEvent => ({ kind: 'driver', event, at: `2026-10-01T10:${at}.000Z` })
  const call = ev({ type: 'action', label: 'Agent', id: 'toolu_a' }, '00:10')
  const started = ev({ type: 'subagent', id: 'toolu_a', status: 'working', name: 'Map the pages' }, '00:10')
  const named = ev({ type: 'subagent', id: 'toolu_a', status: 'working', name: 'Map the pages', model: 'claude-haiku-5-5' }, '00:11')
  const read = ev({ type: 'action', label: 'Read', id: 'toolu_b', subagent: 'toolu_a' }, '00:12')
  const grep = ev({ type: 'action', label: 'Grep', id: 'toolu_c', subagent: 'toolu_a' }, '00:13')
  const said = ev({ type: 'text', text: 'Found it.', subagent: 'toolu_a' }, '00:14')
  const answered = ev({ type: 'output', id: 'toolu_a', text: 'Found it.' }, '00:40')
  const ended = ev({ type: 'subagent', id: 'toolu_a', status: 'ended', name: 'Map the pages', model: 'claude-haiku-5-5' }, '00:40')
  const own = ev({ type: 'action', label: 'Bash', id: 'toolu_d' }, '00:50')

  test('one subagent per id, as its newest event says, with how many calls it made, the last tool, and when it started and ended', () => {
    expect(callSubagents([call, started, named, read, grep])).toEqual([{ id: 'toolu_a', status: 'working', name: 'Map the pages', model: 'claude-haiku-5-5', startedAt: '2026-10-01T10:00:10.000Z', calls: 2, tool: 'Grep' }])
    expect(callSubagents([call, started, named, read, grep, said, answered, ended])[0]).toMatchObject({ status: 'ended', calls: 2, endedAt: '2026-10-01T10:00:40.000Z' })
  })

  test("one still working when its run's process ended is over, stopped, also once a message continues the run; a new prompt alone ends none", () => {
    const end: RunEvent = { kind: 'end', ok: false, stopped: true, at: '2026-10-01T10:00:30.000Z' }
    const continued = ev({ type: 'start', prompt: 'And the footer too.' }, '01:00')
    expect(callSubagents([call, started, read, end, continued])[0]).toMatchObject({ status: 'stopped', endedAt: '2026-10-01T10:00:30.000Z' })
    expect(subagentRows([call, started, read, end, continued], true)[0]).toMatchObject({ status: 'stopped', working: false })
    expect(callSubagents([call, started, read, continued])[0]).toMatchObject({ status: 'working' })
    // One that ended before the run's process did keeps how it ended.
    expect(callSubagents([call, started, said, answered, ended, end])[0]).toMatchObject({ status: 'ended', endedAt: '2026-10-01T10:00:40.000Z' })
  })

  test("what the chat passes over: the subagent's events, its call and that call's answer, and all it said and did; never the run's own steps", () => {
    const events = [call, started, named, read, grep, said, answered, ended, own]
    expect([...subagentEvents(events)]).toEqual([call, started, named, read, grep, said, answered, ended])
    // A call that starts several subagents is the one their `call` names.
    const several = ev({ type: 'action', label: 'spawn', id: 'item_1' }, '00:10')
    const first = ev({ type: 'subagent', id: 'item_1:t1', call: 'item_1', status: 'working' }, '00:10')
    expect([...subagentEvents([several, first, own])]).toEqual([several, first])
  })
})


describe('subagentWait', () => {
  const ev = (event: Extract<RunEvent, { kind: 'driver' }>['event'], at: string): RunEvent => ({ kind: 'driver', event, at: `2026-10-01T10:${at}.000Z` })
  const prompt = ev({ type: 'start', prompt: 'two subagents, then a story' }, '00:00')
  const said = ev({ type: 'text', text: 'I\'ll start both.' }, '00:02')
  const callA = ev({ type: 'action', label: 'Agent', id: 'a' }, '00:03')
  const startA = ev({ type: 'subagent', id: 'a', status: 'working', name: 'Summarize README' }, '00:03')
  const callB = ev({ type: 'action', label: 'Agent', id: 'b' }, '00:04')
  const startB = ev({ type: 'subagent', id: 'b', status: 'working', name: 'List markdown files' }, '00:04')
  const progressA = ev({ type: 'subagent', id: 'a', status: 'working', name: 'Summarize README', toolUses: 1 }, '00:06')
  const readByA = ev({ type: 'action', label: 'Read', id: 'r', subagent: 'a' }, '00:06')
  const endA = ev({ type: 'subagent', id: 'a', status: 'ended' }, '00:10')
  const backA = ev({ type: 'output', id: 'a', text: 'Two lines.' }, '00:10')
  const endB = ev({ type: 'subagent', id: 'b', status: 'ended' }, '00:16')
  const backB = ev({ type: 'output', id: 'b', text: 'Five files.' }, '00:16')
  const thinks = ev({ type: 'thinking' }, '00:17')

  test('blocked on its subagents\u2019 calls, the main agent waits: what they do and hand back is no step of its own', () => {
    expect(subagentWait([prompt, said, callA, startA]).waiting).toBe(true)
    expect(subagentWait([prompt, said, callA, startA, callB, startB, progressA, readByA, endA, backA]).waiting).toBe(true)
  })

  test('the last subagent\u2019s end wakes it: the count starts again there, and its next step does not restart it', () => {
    expect(subagentWait([prompt, said, callA, startA, callB, startB, endA, backA, endB, backB])).toEqual({ waiting: false, wokeAt: '2026-10-01T10:00:16.000Z' })
    expect(subagentWait([prompt, said, callA, startA, callB, startB, endA, backA, endB, backB, thinks])).toEqual({ waiting: false, wokeAt: '2026-10-01T10:00:16.000Z' })
    // One of two ended: its next step wakes it.
    expect(subagentWait([prompt, said, callA, startA, callB, startB, endA, backA, thinks])).toEqual({ waiting: false, wokeAt: '2026-10-01T10:00:17.000Z' })
    // A new prompt is a new turn: no wake carried over.
    expect(subagentWait([prompt, callA, startA, endA, backA, thinks, ev({ type: 'start', prompt: 'again' }, '00:30')])).toEqual({ waiting: false })
  })

  test('a main agent that goes on beside its subagents never waited, and a subagent\u2019s progress does not make it', () => {
    const own = ev({ type: 'action', label: 'Bash', id: 'x' }, '00:05')
    expect(subagentWait([prompt, callA, startA, own])).toEqual({ waiting: false })
    expect(subagentWait([prompt, callA, startA, own, progressA]).waiting).toBe(false)
    // Its message said while they work: it waits on them, and their end wakes it.
    const done = ev({ type: 'text', text: 'Both started; waiting.' }, '00:07')
    expect(subagentWait([prompt, callA, startA, own, done]).waiting).toBe(true)
    expect(subagentWait([prompt, callA, startA, own, done, endA, backA, thinks])).toEqual({ waiting: false, wokeAt: '2026-10-01T10:00:10.000Z' })
  })

  test('the call that starts a subagent is the one its `call` names', () => {
    const call = ev({ type: 'action', label: 'spawn', id: 'item_1' }, '00:03')
    const start = ev({ type: 'subagent', id: 'item_1:t1', call: 'item_1', status: 'working' }, '00:03')
    const back = ev({ type: 'output', id: 'item_1', text: 'done' }, '00:09')
    expect(subagentWait([prompt, start, call, back]).waiting).toBe(true)
  })
})

describe('arrange', () => {
  /** A row of `status` that started `at` minutes into the hour. */
  const row = (key: string, status: string, at: number): SubagentRow => ({ key, name: key, status, working: status === 'running', startedAt: `2026-10-01T10:${String(at).padStart(2, '0')}:00.000Z`, call: { id: key, status: 'working', calls: 0 } })

  test('forty rows, two failed: those lead, and the ended ones fold', () => {
    const rows = Array.from({ length: 38 }, (_, at) => row(`ended ${at}`, at % 2 ? 'done' : 'stopped', at))
    rows.push(row('late failure', 'failed', 50), row('early failure', 'failed', 40))
    const { parts, folds } = arrange(rows)
    expect(parts.map(part => [part.name, part.keys.slice(0, 2)])).toEqual([
      ['Failed', ['early failure', 'late failure']],
      ['Ended', ['ended 0', 'ended 1']],
    ])
    expect(folds).toBe(true)
  })

  test('each part only when it holds a row, its rows by start; eight in all fold nothing', () => {
    const { parts, folds } = arrange([row('b', 'running', 5), row('a', 'running', 2), row('c', 'done', 1)])
    expect(parts).toEqual([
      { name: 'Working', keys: ['a', 'b'] },
      { name: 'Ended', keys: ['c'] },
    ])
    expect(folds).toBe(false)
    expect(arrange(Array.from({ length: 8 }, (_, at) => row(`${at}`, 'done', at))).folds).toBe(false)
    // Nine with none ended: nothing to fold.
    expect(arrange(Array.from({ length: 9 }, (_, at) => row(`${at}`, 'failed', at))).folds).toBe(false)
  })
})
