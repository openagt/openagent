import { describe, expect, test } from 'vitest'
import type { OpenAgentEvent } from '../../src/index.js'
import { agentStatusPill } from './agent-status.js'

const said = { kind: 'driver', event: { type: 'text', text: 'working' } } as OpenAgentEvent
const ended = (over: Record<string, unknown>) => ({ kind: 'end', ...over }) as OpenAgentEvent

describe('agentStatusPill', () => {
  test('says nothing with no line in the feed', () => {
    expect(agentStatusPill([])).toBeNull()
  })

  test('pulses while the run is live, settles when it ends', () => {
    expect(agentStatusPill([said])).toMatchObject({ label: 'building…' })
    expect(agentStatusPill([said, ended({ ok: true })])).toMatchObject({ label: 'finished' })
  })

  test('a stopped run says stopped', () => {
    expect(agentStatusPill([said, ended({ ok: false, stopped: true })])).toMatchObject({ label: 'stopped', tone: 'text-warning' })
  })

  test('a failed run says failed, and carries the reason', () => {
    expect(agentStatusPill([said, ended({ ok: false, detail: 'exit 1' })])).toMatchObject({ label: 'failed', detail: 'exit 1' })
    expect(agentStatusPill([said, ended({ ok: false })])).not.toHaveProperty('detail')
  })

  test('a resumed session builds again — the stopped segment does not hold the pill (#762)', () => {
    // A resume appends a second `session` boundary to the same journal; the yellow "stopped"
    // stuck to a live agent because first-end-wins outranked everything that followed.
    const resumed = [said, ended({ ok: false, stopped: true }), { kind: 'session' } as OpenAgentEvent]
    expect(agentStatusPill(resumed)).toMatchObject({ label: 'building…' })
    expect(agentStatusPill([...resumed, ended({ ok: true })])).toMatchObject({ label: 'finished' })
  })

  // A run that asked ends on its question (#1774): not failed, not finished, waiting on you.
  test('a run that ended on its question says it waits for an answer, not that it failed', () => {
    expect(agentStatusPill([said, ended({ ok: false, waiting: true })])).toMatchObject({ label: 'waiting for an answer', tone: 'text-warning' })
  })

  test('answered, the same run builds again: the leg it waited in is behind it', () => {
    const next = { kind: 'driver', event: { type: 'text', text: 'On it.' } } as OpenAgentEvent
    const answered = [said, ended({ ok: false, waiting: true }), next]
    expect(agentStatusPill(answered)).toMatchObject({ label: 'building…' })
    expect(agentStatusPill([...answered, ended({ ok: true })])).toMatchObject({ label: 'finished' })
  })
})
