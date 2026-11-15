import type { AgentMeta, OpenAgentEvent } from '../../src/index.js'
import { describe, expect, test } from 'vitest'
import { callSubagents, holdsMainAgent, subagentWait, isOpenSubagent, nestRows, runRow, subagentEnd, subagentEvents, drivesSubagents, stepWords, subagentSteps, subagentStartedAt, subagentsOf, taskLabel, type SubagentStep } from './subagents.js'

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

describe('subagentSteps', () => {
  const at = (time: string): OpenAgentEvent => ({ kind: 'log', message: time, at: `2026-10-01T10:${time}.000Z` }) as OpenAgentEvent
  const turn = (time: string): OpenAgentEvent => ({ kind: 'driver', event: { type: 'start', prompt: 'go on' }, at: `2026-10-01T10:${time}.000Z` })
  const isTurn = (e: OpenAgentEvent) => e.kind === 'driver' && e.event.type === 'start'
  const row = (id: string, startedAt: string) => runRow(agent(id, { startedAt }), undefined)
  const placed = (groups: Map<number, SubagentStep[]>) => [...groups].map(([index, steps]) => [index, steps.map(step => step.row.key)])
  const NO_REPORTS = new Map<string, string>()

  test('a subagent goes before the first event written after it started; one started after the last event goes at the end', () => {
    const events = [turn('00:00'), at('02:00'), turn('02:30'), { kind: 'log', message: 'no time' } as OpenAgentEvent, turn('04:00')]
    const groups = subagentSteps(events, [row('d', '2026-10-01T10:09:00.000Z'), row('a', '2026-10-01T10:01:00.000Z'), row('c', '2026-10-01T10:03:00.000Z')], NO_REPORTS, isTurn)
    expect(placed(groups)).toEqual([
      [1, ['run:a']],
      [4, ['run:c']],
      [5, ['run:d']],
    ])
  })

  test('the subagents one turn started are one group, at the place of the first of them, in the order they were started', () => {
    const events = [turn('00:00'), at('01:10'), at('01:20'), at('01:40'), turn('02:00'), at('03:00')]
    const groups = subagentSteps(events, [row('b', '2026-10-01T10:01:30.000Z'), row('a', '2026-10-01T10:01:05.000Z'), row('c', '2026-10-01T10:02:30.000Z')], NO_REPORTS, isTurn)
    expect(placed(groups)).toEqual([
      [1, ['run:a', 'run:b']],
      [5, ['run:c']],
    ])
  })

  test('one started after the agent said something is a group of its own, after those words', () => {
    const said = (time: string): OpenAgentEvent => ({ kind: 'driver', event: { type: 'text', text: 'Both are running.' }, at: `2026-10-01T10:${time}.000Z` })
    const events = [turn('00:00'), at('01:10'), said('01:40'), at('02:40'), said('03:00')]
    const parts = (e: OpenAgentEvent) => isTurn(e) || (e.kind === 'driver' && e.event.type === 'text')
    const groups = subagentSteps(events, [row('a', '2026-10-01T10:01:05.000Z'), row('b', '2026-10-01T10:01:30.000Z'), row('c', '2026-10-01T10:02:30.000Z')], NO_REPORTS, parts)
    expect(placed(groups)).toEqual([
      [1, ['run:a', 'run:b']],
      [3, ['run:c']],
    ])
  })

  test('what they sent when they ended goes in the same line, until the agent says something', () => {
    const said = (time: string): OpenAgentEvent => ({ kind: 'driver', event: { type: 'text', text: 'One is back.' }, at: `2026-10-01T10:${time}.000Z` })
    const parts = (e: OpenAgentEvent) => isTurn(e) || (e.kind === 'driver' && e.event.type === 'text')
    const ended = (id: string, startedAt: string, endedAt: string) => runRow(agent(id, { startedAt, endedAt }), undefined)
    const rows = [ended('a', '2026-10-01T10:01:00.000Z', '2026-10-01T10:02:00.000Z'), ended('b', '2026-10-01T10:02:30.000Z', '2026-10-01T10:02:40.000Z'), ended('c', '2026-10-01T10:02:50.000Z', '2026-10-01T10:02:55.000Z')]
    const events = [turn('00:00'), said('01:30'), said('04:00')]
    const steps = subagentSteps(events, rows, new Map([['run:a', 'A found it.'], ['run:b', 'B found it.']]), parts)
    expect([...steps].map(([index, all]) => [index, all.map(step => `${step.kind}:${step.row.key}`)])).toEqual([
      [1, ['agent:run:a']],
      [2, ['message:run:a', 'agent:run:b', 'message:run:b', 'agent:run:c']],
    ])
    expect(stepWords(steps.get(2)!)).toBe('Received 2 messages, ran 2 agents')
    expect(stepWords(steps.get(1)!)).toBe('Ran an agent')
  })

  test('a subagent started just before a prompt is a subagent of the turn it was started in, not of the next', () => {
    const events = [turn('00:00'), at('01:00'), turn('02:00'), at('03:00')]
    const groups = subagentSteps(events, [row('a', '2026-10-01T10:00:30.000Z'), row('b', '2026-10-01T10:01:30.000Z')], NO_REPORTS, isTurn)
    expect(placed(groups)).toEqual([[1, ['run:a', 'run:b']]])
  })

  test("a subagent's row keeps its place when its card's start time moves past the next line of the log", () => {
    const events = [{ kind: 'log', message: 'a', at: '2026-10-01T10:00:59.000Z' }, { kind: 'log', message: 'b', at: '2026-10-01T10:01:05.000Z' }] as OpenAgentEvent[]
    const groups = subagentSteps(events, [runRow(agent('2026-10-01T10-01-00-000Z', { startedAt: '2026-10-01T10:01:07.500Z' }), undefined)], NO_REPORTS, isTurn)
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

test('a command that only drives the subagents, a look at git beside it, says nothing their rows do not', () => {
  expect(drivesSubagents('git status --short; npx @openagt/skill-orchestration@0.1 start --task write-about-html; npx @openagt/skill-orchestration@0.1 start --task files')).toBe(true)
  expect(drivesSubagents('npx @openagt/skill-orchestration@0.1 land 2026-11-03T00-52-48-684Z && git log --oneline -6')).toBe(true)
  // Saving a plan, or anything else beside it, is a step of the agent's own.
  expect(drivesSubagents('mkdir -p /tmp/plan && npx @openagt/skill-orchestration@0.1 plan /tmp/plan/plan.md')).toBe(false)
  expect(drivesSubagents('npx @openagt/skill-orchestration@0.1 land x; pnpm test')).toBe(false)
  expect(drivesSubagents('git status')).toBe(false)
  expect(drivesSubagents(undefined)).toBe(false)
})

describe('subagentWait', () => {
  const ev = (event: Extract<OpenAgentEvent, { kind: 'driver' }>['event'], at: string): OpenAgentEvent => ({ kind: 'driver', event, at: `2026-10-01T10:${at}.000Z` })
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

  test('on Codex the call that starts a subagent is the part of its id before the colon', () => {
    const call = ev({ type: 'action', label: 'collabAgentToolCall', id: 'item_1' }, '00:03')
    const start = ev({ type: 'subagent', id: 'item_1:t1', status: 'working' }, '00:03')
    const back = ev({ type: 'output', id: 'item_1', text: 'done' }, '00:09')
    expect(subagentWait([prompt, start, call, back]).waiting).toBe(true)
  })
})
