import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { sessionInfo, agentErrors } from './agent-view.js'
import type { OpenAgentEvent } from './events.js'

test('sessionInfo merges the opening session with the latest session-update link (#431)', () => {
  const events: OpenAgentEvent[] = [
    { kind: 'session', driver: 'claude', workspace: '/repo', fake: false },
    { kind: 'session-update', sessionId: 'sess-1', sessionLink: 'https://claude.ai/code/sess-1' },
  ]
  const info = sessionInfo(events)
  assert.equal(info?.sessionId, 'sess-1')
  assert.equal(info?.sessionLink, 'https://claude.ai/code/sess-1')
  assert.equal(sessionInfo([{ kind: 'log', message: 'x' }]), null)
})

test('sessionInfo keeps the workspace the run used, so a removed worktree is still nameable (#1195)', () => {
  const events: OpenAgentEvent[] = [
    { kind: 'session', driver: 'claude', workspace: '/repo/.openagent/worktrees/run-1', fake: false },
    { kind: 'session-update', sessionId: 'sess-1' },
  ]
  // The later session-update must not drop it: the id arrives after the workspace, and it is the
  // pair together that reopens the session in a terminal.
  assert.equal(sessionInfo(events)?.workspace, '/repo/.openagent/worktrees/run-1')
  assert.equal(sessionInfo(events)?.sessionId, 'sess-1')
})

test('agentErrors folds the errors the agent reported, oldest first (#1500)', () => {
  assert.deepEqual(agentErrors([]), [])
  const events: OpenAgentEvent[] = [
    { kind: 'error', headline: 'gh is not logged in', detail: 'ran `gh auth status`' },
    { kind: 'branch', branch: 'agent-update-tickets' },
    { kind: 'error', headline: 'tickets/meta.json has no lastImportedAt' },
  ]
  assert.deepEqual(agentErrors(events), [
    { headline: 'gh is not logged in', detail: 'ran `gh auth status`' },
    { headline: 'tickets/meta.json has no lastImportedAt' },
  ])
})

test('agentErrors also counts the error lines the run\'s tool writes in the diary: first line the headline, the rest the detail', () => {
  const events: OpenAgentEvent[] = [
    { kind: 'driver', event: { type: 'text', text: 'working' } },
    { kind: 'driver', event: { type: 'error', message: 'claude exited with code 1\nstderr: not logged in\n' } },
    { kind: 'error', headline: 'gh is not logged in' },
    { kind: 'driver', event: { type: 'error', message: 'rate limited' } },
  ]
  assert.deepEqual(agentErrors(events), [
    { headline: 'claude exited with code 1', detail: 'stderr: not logged in' },
    { headline: 'gh is not logged in' },
    { headline: 'rate limited' },
  ])
  // A notice is something the driver worked around, not an error.
  assert.deepEqual(agentErrors([{ kind: 'driver', event: { type: 'notice', message: 'retried' } }]), [])
})
