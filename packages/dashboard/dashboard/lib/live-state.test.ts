import { describe, expect, test } from 'vitest'
import type { OpenAgentEvent } from '../../src/index.js'
import { pendingChoices, isAgentActive, currentAgentEvents, agentOutcome, cardOutcome, actionsRunUrl } from './live-state.js'

const choice = (id: string, title: string): OpenAgentEvent => ({
  kind: 'choice',
  id,
  title,
  options: [{ id: 'a', label: 'A' }],
  recommended: 'a',
})
const resolved = (id: string): OpenAgentEvent => ({ kind: 'choice-resolved', id, picked: 'a', by: 'user' })

describe('pendingChoices', () => {
  test('an open choice is pending; a resolved one is not', () => {
    expect(pendingChoices([choice('c1', 'Approve?')]).map(c => c.id)).toEqual(['c1'])
    expect(pendingChoices([choice('c1', 'Approve?'), resolved('c1')])).toEqual([])
  })

  test('tracks several gates at once, in fire order', () => {
    const events = [choice('c1', 'One?'), choice('c2', 'Two?')]
    expect(pendingChoices(events).map(c => c.id)).toEqual(['c1', 'c2'])
  })

  test('strips the kind discriminant from the request', () => {
    const [req] = pendingChoices([choice('c1', 'Approve?')])
    expect(req).not.toHaveProperty('kind')
    expect(req).toMatchObject({ id: 'c1', title: 'Approve?' })
  })

  test('an end event expires every open gate (#1359)', () => {
    // An agent that died mid-gate never wrote choice-resolved; the store's surrogate end is what
    // says the question's audience is gone. Rendering past it left the panel answerable forever.
    const end: OpenAgentEvent = { kind: 'end', ok: false, stopped: true, detail: 'its process died without reporting an end' }
    expect(pendingChoices([choice('c1', 'One?'), choice('c2', 'Two?'), end])).toEqual([])
    // A gate asked after a (continued) run's next leg opens fresh — end only closes what came before.
    expect(pendingChoices([choice('c1', 'One?'), end, choice('c2', 'Two?')]).map(c => c.id)).toEqual(['c2'])
  })

  // A run that asks ENDS on its question (#1774): waiting, its checkout kept for the answer.
  test('a question stays open through an end that says waiting', () => {
    const waiting: OpenAgentEvent = { kind: 'end', ok: false, waiting: true }
    expect(pendingChoices([choice('q', 'Which?'), waiting]).map(c => c.id)).toEqual(['q'])
  })

  test('the agent going on closes the question: the answer, or the person\'s text, began a new turn', () => {
    const waiting: OpenAgentEvent = { kind: 'end', ok: false, waiting: true }
    const next: OpenAgentEvent = { kind: 'driver', event: { type: 'text', text: 'On it.' } }
    expect(pendingChoices([choice('q', 'Which?'), waiting, next])).toEqual([])
    // What is not the agent's own (its cost, a log line) closes nothing.
    expect(pendingChoices([choice('q', 'Which?'), { kind: 'usage', costUsd: 0.1 }, waiting]).map(c => c.id)).toEqual(['q'])
  })

  test('an end that does not say waiting still closes it, also after a waiting one', () => {
    const waiting: OpenAgentEvent = { kind: 'end', ok: false, waiting: true }
    const stopped: OpenAgentEvent = { kind: 'end', ok: false, stopped: true }
    expect(pendingChoices([choice('q', 'Which?'), waiting, stopped])).toEqual([])
  })
})

describe('isAgentActive', () => {
  test('empty is not active; streamed-but-unended is; ended is not', () => {
    expect(isAgentActive([])).toBe(false)
    expect(isAgentActive([{ kind: 'log', message: 'go' }])).toBe(true)
    expect(isAgentActive([{ kind: 'log', message: 'go' }, { kind: 'end', ok: true }])).toBe(false)
  })

  test('a resumed session is active again: the stopped segment\'s end does not count (#762)', () => {
    // A resume appends a second `session` boundary to the SAME journal. "Was there ever an end"
    // read the resumed-live agent as inactive — hiding Stop while the agent worked.
    const resumed = [
      { kind: 'session' },
      { kind: 'end', ok: false, stopped: true },
      { kind: 'session' },
      { kind: 'log', message: 'back at it' },
    ] as OpenAgentEvent[]
    expect(isAgentActive(resumed)).toBe(true)
  })
})

describe('currentAgentEvents', () => {
  const session = (workspace: string): OpenAgentEvent => ({ kind: 'session', driver: 'claude', workspace, fake: false })

  test('returns the feed whole when no run has opened yet', () => {
    const events: OpenAgentEvent[] = [{ kind: 'log', message: 'warming up' }]
    expect(currentAgentEvents(events)).toEqual(events)
  })

  test('keeps a single run intact, session-first', () => {
    const events: OpenAgentEvent[] = [session('/repo'), { kind: 'log', message: 'go' }, { kind: 'end', ok: true }]
    expect(currentAgentEvents(events)).toEqual(events)
  })

  test('drops a previous run once a new run opens (the bug)', () => {
    const events: OpenAgentEvent[] = [
      session('/repo'),
      { kind: 'log', message: 'run 1' },
      { kind: 'end', ok: true },
      session('/repo'),
      { kind: 'log', message: 'run 2' },
    ]
    expect(currentAgentEvents(events)).toEqual([session('/repo'), { kind: 'log', message: 'run 2' }])
  })

  test('a just-finished second run keeps its own end, not the first run', () => {
    const events: OpenAgentEvent[] = [
      session('/repo'),
      { kind: 'log', message: 'run 1' },
      { kind: 'end', ok: true },
      session('/repo'),
      { kind: 'log', message: 'run 2' },
      { kind: 'end', ok: false, stopped: true },
    ]
    expect(currentAgentEvents(events)).toEqual([
      session('/repo'),
      { kind: 'log', message: 'run 2' },
      { kind: 'end', ok: false, stopped: true },
    ])
  })
})

// #948: the overview pill must tell a crash, a user stop, and a clean finish apart.
describe('cardOutcome', () => {
  test('a running card says no ending; every other status says how the agent ended', () => {
    expect(cardOutcome('running')).toBeUndefined()
    expect(cardOutcome('done')).toEqual({ ok: true, stopped: false })
    expect(cardOutcome('failed')).toEqual({ ok: false, stopped: false })
    expect(cardOutcome('stopped')).toEqual({ ok: false, stopped: true })
    expect(cardOutcome('waiting')).toEqual({ ok: false, stopped: false, waiting: true })
  })
})

describe('agentOutcome', () => {
  test('undefined while the run is still going', () => {
    expect(agentOutcome([{ kind: 'log', message: 'hi' }])).toBeUndefined()
  })

  test('a clean end', () => {
    expect(agentOutcome([{ kind: 'end', ok: true }])).toEqual({ ok: true, stopped: false })
  })

  test('a failure carries its detail', () => {
    expect(agentOutcome([{ kind: 'end', ok: false, detail: 'driver exited 1' }])).toEqual({
      ok: false,
      stopped: false,
      detail: 'driver exited 1',
    })
  })

  test('a user stop is a stop, not a failure', () => {
    expect(agentOutcome([{ kind: 'end', ok: false, stopped: true }])).toEqual({ ok: false, stopped: true })
  })

  test('a resumed session has no outcome until ITS segment ends (#762)', () => {
    // First-end-wins kept a resumed agent "stopped" for ever: while it was live again, and even
    // after it later finished clean. The ending is the current segment's, or nothing yet.
    const stopped = { kind: 'end', ok: false, stopped: true }
    const midResume = [{ kind: 'session' }, stopped, { kind: 'session' }, { kind: 'log', message: 'go' }] as OpenAgentEvent[]
    expect(agentOutcome(midResume)).toBeUndefined()
    const finishedClean = [...midResume, { kind: 'end', ok: true }] as OpenAgentEvent[]
    expect(agentOutcome(finishedClean)).toEqual({ ok: true, stopped: false })
  })
})

describe('actionsRunUrl', () => {
  const action = (label: string): OpenAgentEvent => ({ kind: 'driver', event: { type: 'action', label } })

  test('extracts the html_url from the ActionsDriver run action', () => {
    expect(actionsRunUrl([action('run https://github.com/o/r/actions/runs/42')])).toBe(
      'https://github.com/o/r/actions/runs/42',
    )
  })

  test('undefined before the run action has fired', () => {
    expect(actionsRunUrl([{ kind: 'driver', event: { type: 'start', prompt: 'go' } }])).toBeUndefined()
  })

  test('a plain tool action is not mistaken for a run url', () => {
    expect(actionsRunUrl([action('Edit')])).toBeUndefined()
  })

  test('the most recent run wins across turns', () => {
    expect(
      actionsRunUrl([action('run https://github.com/o/r/actions/runs/1'), action('run https://github.com/o/r/actions/runs/2')]),
    ).toBe('https://github.com/o/r/actions/runs/2')
  })
})
