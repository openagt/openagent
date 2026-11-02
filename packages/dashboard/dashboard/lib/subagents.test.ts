import type { AgentMeta, OpenAgentEvent } from '../../src/index.js'
import { describe, expect, test } from 'vitest'
import { callSubagents, holdsMainAgent, isOpenSubagent, nestRows, rollUp, runRow, subagentEnd, subagentEvents, subagentGroups, subagentStartedAt, subagentsOf, taskLabel, type SubagentRow } from './subagents.js'

function agent(id: string, over: Partial<AgentMeta> = {}): AgentMeta {
  return { status: 'done', id, startedAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-01T10:00:00.000Z', ...over }
}
const row = (key: string, a: AgentMeta) => ({ key, agent: a })

describe('subagentsOf', () => {
  test("a run's subagents are the runs whose card names it as their parent, oldest first", () => {
    const agents = [agent('c2', { parent: 'main' }), agent('other'), agent('c1', { parent: 'main' }), agent('x1', { parent: 'else' }), agent('main')]
    expect(subagentsOf(agents, 'main').map(a => a.id)).toEqual(['c1', 'c2'])
    expect(subagentsOf(agents, 'other')).toEqual([])
  })
})

describe('taskLabel', () => {
  test('a subagent is called by the first line of what it was asked', () => {
    expect(taskLabel(agent('c1', { intent: 'Validate the form\n\nYou are a subagent: another agent started you.' }))).toBe('Validate the form')
    expect(taskLabel(agent('c1', { branch: 'agent-form' }))).toBe('agent-form')
  })
})

describe('isOpenSubagent', () => {
  test('a working subagent and one stopped on a question are not over; any other is', () => {
    expect(['running', 'waiting', 'done', 'failed', 'stopped'].filter(status => isOpenSubagent({ status: status as AgentMeta['status'] }))).toEqual(['running', 'waiting'])
  })
})

describe('nestRows', () => {
  test('a run whose parent is in the list sits under it, oldest first, and the other rows keep their order', () => {
    const tree = nestRows([row('c2', agent('c2', { parent: 'main' })), row('solo', agent('solo')), row('c1', agent('c1', { parent: 'main' })), row('main', agent('main'))])
    expect(tree.map(t => [t.row.key, t.subagents.map(s => s.key)])).toEqual([
      ['solo', []],
      ['main', ['c1', 'c2']],
    ])
  })

  test('a run whose parent is not in the list is a row of its own', () => {
    expect(nestRows([row('c1', agent('c1', { parent: 'gone' }))]).map(t => t.row.key)).toEqual(['c1'])
  })

  test('a run started for a subagent is a row of its own: the tree is one level deep, and no row is lost', () => {
    const tree = nestRows([row('g1', agent('g1', { parent: 'c1' })), row('c1', agent('c1', { parent: 'main' })), row('main', agent('main'))])
    expect(tree.map(t => [t.row.key, t.subagents.map(s => s.key)])).toEqual([
      ['g1', []],
      ['main', ['c1']],
    ])
  })

  test('in a list that pools projects a parent is looked for in the same project only', () => {
    const tree = nestRows([row('p1:c1', agent('c1', { parent: 'main' })), row('p2:main', agent('main')), row('p1:main', agent('main'))])
    expect(tree.map(t => [t.row.key, t.subagents.map(s => s.key)])).toEqual([
      ['p2:main', []],
      ['p1:main', ['p1:c1']],
    ])
  })
})

describe('subagentEnd', () => {
  const subagents = [agent('2026-10-01T10-00-00-000Z', { parent: 'main' })]

  test("the line a run is sent when its subagent ends reads as that subagent's end: how it ended, and the rest of what was said", () => {
    const end = subagentEnd('The run 2026-10-01T10-00-00-000Z, started for this run, ended done.\nIts work is on the branch agent-form.\n\nIts last words:\nAll done.', subagents)
    expect(end).toEqual({ agent: subagents[0], status: 'done', rest: 'Its work is on the branch agent-form.\n\nIts last words:\nAll done.' })
  })

  test('an end that says why carries the reason', () => {
    expect(subagentEnd('The run 2026-10-01T10-00-00-000Z, started for this run, ended failed: could not create a checkout: no such ref.', subagents)).toEqual({
      agent: subagents[0],
      status: 'failed',
      detail: 'could not create a checkout: no such ref',
      rest: '',
    })
  })

  test("the same words about a run that is not one of this run's subagents, and any other prompt, read as a person's", () => {
    expect(subagentEnd('The run 2026-09-01T10-00-00-000Z, started for this run, ended done.', subagents)).toBeUndefined()
    expect(subagentEnd('Note: The run 2026-10-01T10-00-00-000Z, started for this run, ended done.', subagents)).toBeUndefined()
    expect(subagentEnd('The run 2026-10-01T10-00-00-000Z, started for this run, ended done.', [])).toBeUndefined()
  })
})

describe('subagentGroups', () => {
  const at = (time: string): OpenAgentEvent => ({ kind: 'log', message: time, at: `2026-10-01T10:${time}.000Z` }) as OpenAgentEvent
  const turn = (time: string): OpenAgentEvent => ({ kind: 'driver', event: { type: 'start', prompt: 'go on' }, at: `2026-10-01T10:${time}.000Z` })
  const isTurn = (e: OpenAgentEvent) => e.kind === 'driver' && e.event.type === 'start'
  const row = (id: string, startedAt: string) => runRow(agent(id, { startedAt }), undefined)
  const placed = (groups: Map<number, SubagentRow[]>) => [...groups].map(([index, rows]) => [index, rows.map(one => one.key)])

  test('a subagent goes before the first event written after it started; one started after the last event goes at the end', () => {
    const events = [turn('00:00'), at('02:00'), turn('02:30'), { kind: 'log', message: 'no time' } as OpenAgentEvent, turn('04:00')]
    const groups = subagentGroups(events, [row('d', '2026-10-01T10:09:00.000Z'), row('a', '2026-10-01T10:01:00.000Z'), row('c', '2026-10-01T10:03:00.000Z')], isTurn)
    expect(placed(groups)).toEqual([
      [1, ['run:a']],
      [4, ['run:c']],
      [5, ['run:d']],
    ])
  })

  test('the subagents one turn started are one group, at the place of the first of them, in the order they were started', () => {
    const events = [turn('00:00'), at('01:10'), at('01:20'), at('01:40'), turn('02:00'), at('03:00')]
    const groups = subagentGroups(events, [row('b', '2026-10-01T10:01:30.000Z'), row('a', '2026-10-01T10:01:05.000Z'), row('c', '2026-10-01T10:02:30.000Z')], isTurn)
    expect(placed(groups)).toEqual([
      [1, ['run:a', 'run:b']],
      [5, ['run:c']],
    ])
  })

  test('a subagent started just before a prompt is a subagent of the turn it was started in, not of the next', () => {
    const events = [turn('00:00'), at('01:00'), turn('02:00'), at('03:00')]
    const groups = subagentGroups(events, [row('a', '2026-10-01T10:00:30.000Z'), row('b', '2026-10-01T10:01:30.000Z')], isTurn)
    expect(placed(groups)).toEqual([[1, ['run:a', 'run:b']]])
  })

  test("a subagent's row keeps its place when its card's start time moves past the next line of the log", () => {
    const events = [{ kind: 'log', message: 'a', at: '2026-10-01T10:00:59.000Z' }, { kind: 'log', message: 'b', at: '2026-10-01T10:01:05.000Z' }] as OpenAgentEvent[]
    const groups = subagentGroups(events, [runRow(agent('2026-10-01T10-01-00-000Z', { startedAt: '2026-10-01T10:01:07.500Z' }), undefined)], isTurn)
    expect([...groups.keys()]).toEqual([1])
  })
})

describe('callSubagents and subagentEvents', () => {
  const ev = (event: Extract<OpenAgentEvent, { kind: 'driver' }>['event'], at: string): OpenAgentEvent => ({ kind: 'driver', event, at: `2026-10-01T10:${at}.000Z` })
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

  test("what the chat passes over: the subagent's events, its call and that call's answer, and all it said and did; never the run's own steps", () => {
    const events = [call, started, named, read, grep, said, answered, ended, own]
    expect([...subagentEvents(events)]).toEqual([call, started, named, read, grep, said, answered, ended])
    // On Codex the call is the part of the subagent's id before the colon.
    const codexCall = ev({ type: 'action', label: 'collabAgentToolCall', id: 'item_1' }, '00:10')
    const codexAgent = ev({ type: 'subagent', id: 'item_1:t1', status: 'working' }, '00:10')
    expect([...subagentEvents([codexCall, codexAgent, own])]).toEqual([codexCall, codexAgent])
  })
})

describe('rollUp', () => {
  const row = (startedAt: string, over: Partial<SubagentRow> = {}): SubagentRow => ({ key: startedAt, name: 'x', status: 'done', working: false, startedAt, ...over })

  test('how many, from the first start to the last end, and the cost of the ones whose cost is known', () => {
    expect(rollUp([row('2026-10-01T10:00:00.000Z', { endedAt: '2026-10-01T10:00:40.000Z', cost: 0.25 }), row('2026-10-01T10:00:10.000Z', { endedAt: '2026-10-01T10:01:07.000Z', cost: 0.36 }), row('2026-10-01T10:00:20.000Z', { endedAt: '2026-10-01T10:00:30.000Z' })], 0)).toEqual({
      count: 3,
      ms: 67_000,
      cost: 0.61,
    })
  })

  test('up to now while one works, and no cost when none is known', () => {
    const now = Date.parse('2026-10-01T10:02:00.000Z')
    expect(rollUp([row('2026-10-01T10:00:00.000Z', { working: true, status: 'running' }), row('2026-10-01T10:00:10.000Z', { endedAt: '2026-10-01T10:00:20.000Z' })], now)).toEqual({ count: 2, ms: 120_000 })
  })
})

describe('subagentStartedAt', () => {
  test("a subagent started when its id was made, whatever start time its card carries now; an id that is no time falls back to the card's", () => {
    expect(subagentStartedAt(agent('2026-10-01T10-01-00-000Z', { startedAt: '2026-10-01T10:01:07.500Z' }))).toBe('2026-10-01T10:01:00.000Z')
    expect(subagentStartedAt(agent('c1', { startedAt: '2026-10-01T10:01:07.500Z' }))).toBe('2026-10-01T10:01:07.500Z')
  })

})

describe('holdsMainAgent', () => {
  const now = Date.parse('2026-10-01T10:05:00.000Z')
  test("a main agent's job is not over with a subagent that works, saves, or ended in the last seconds", () => {
    expect(holdsMainAgent({ status: 'running' }, now)).toBe(true)
    expect(holdsMainAgent({ status: 'done', saving: true, endedAt: '2026-10-01T10:00:00.000Z' }, now)).toBe(true)
    expect(holdsMainAgent({ status: 'done', endedAt: '2026-10-01T10:04:55.000Z' }, now)).toBe(true)
    expect(holdsMainAgent({ status: 'failed', endedAt: '2026-10-01T10:04:51.000Z' }, now)).toBe(true)
  })

  test('it is over with one that ended ten seconds ago or more, and with one that only waits', () => {
    expect(holdsMainAgent({ status: 'done', endedAt: '2026-10-01T10:04:50.000Z' }, now)).toBe(false)
    expect(holdsMainAgent({ status: 'waiting' }, now)).toBe(false)
  })
})
