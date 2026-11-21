import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { pickedIds } from './events.js'
import { formatOpenAgentEvent } from './terminal.js'

test('pickedIds normalizes a single id or a subset to a list (#332)', () => {
  assert.deepEqual(pickedIds('proceed'), ['proceed'])
  assert.deepEqual(pickedIds(['p0', 'p2']), ['p0', 'p2'])
  assert.deepEqual(pickedIds([]), [])
  assert.deepEqual(pickedIds(''), [])
})

test('formatOpenAgentEvent renders a multi-select choice as a checklist (#332)', () => {
  const line = formatOpenAgentEvent({
    kind: 'choice',
    id: 'ms',
    title: 'Pick problems to deep-dive',
    multi: true,
    options: [
      { id: 'p0', label: 'auth flow', default: true },
      { id: 'p1', label: 'routing' },
    ],
  })
  assert.equal(line, '? Pick problems to deep-dive\n    [x] auth flow\n    [ ] routing')
})

test('formatOpenAgentEvent shows what a tool call did beside its name, and a thought as its own line', () => {
  assert.equal(formatOpenAgentEvent({ kind: 'driver', event: { type: 'action', label: 'Bash', detail: 'git status --short' } }), '    · Bash  git status --short')
  assert.equal(formatOpenAgentEvent({ kind: 'driver', event: { type: 'action', label: 'Bash' } }), '    · Bash')
  assert.equal(formatOpenAgentEvent({ kind: 'driver', event: { type: 'output', id: 't1', text: '12 passed\nall good' } }), '      → 12 passed all good')
  assert.equal(formatOpenAgentEvent({ kind: 'driver', event: { type: 'output', id: 't1', text: 'boom', failed: true } }), '      ✗ boom')
  assert.equal(formatOpenAgentEvent({ kind: 'driver', event: { type: 'thought', text: 'The test\nfails first.' } }), '    💭 The test fails first.')
})

test('formatOpenAgentEvent renders a single-select choice with the recommended mark (#304)', () => {
  const line = formatOpenAgentEvent({
    kind: 'choice',
    id: 'plan',
    title: 'Approve this plan?',
    recommended: 'proceed',
    options: [
      { id: 'proceed', label: 'Proceed: Vike' },
      { id: 'alt:0', label: 'Use Next.js instead' },
    ],
  })
  assert.equal(line, '? Approve this plan?\n    ● Proceed: Vike\n    ○ Use Next.js instead')
})

test('formatOpenAgentEvent renders a resolved subset, and (none) when empty (#332)', () => {
  assert.equal(
    formatOpenAgentEvent({ kind: 'choice-resolved', id: 'ms', picked: ['p0', 'p2'], by: 'user' }),
    '  ✓ chose p0, p2 (user)',
  )
  assert.equal(
    formatOpenAgentEvent({ kind: 'choice-resolved', id: 'ms', picked: [], by: 'auto' }),
    '  ✓ chose (none) (auto)',
  )
  assert.equal(
    formatOpenAgentEvent({ kind: 'choice-resolved', id: 'plan', picked: 'proceed', by: 'user' }),
    '  ✓ chose proceed (user)',
  )
})

test('formatOpenAgentEvent renders a session-update line', () => {
  assert.equal(formatOpenAgentEvent({ kind: 'session-update', sessionId: 'abc123' }), '  session abc123')
  assert.equal(
    formatOpenAgentEvent({ kind: 'session-update', sessionId: 'abc123', sessionLink: 'https://x.dev/s/abc123' }),
    '  session abc123 — https://x.dev/s/abc123',
  )
})

test('formatOpenAgentEvent shows a preview of the driver prompt, not just "prompt sent" (#476)', () => {
  assert.equal(
    formatOpenAgentEvent({ kind: 'driver', event: { type: 'start', prompt: 'Build this app end to end' } }),
    '  › prompt: Build this app end to end',
  )
  // Long prompts are truncated for the one-line feed (the dashboard shows the full text).
  const long = 'x'.repeat(300)
  const line = formatOpenAgentEvent({ kind: 'driver', event: { type: 'start', prompt: long } })!
  assert.ok(line.startsWith('  › prompt: '))
  assert.ok(line.length < 160 && line.endsWith('…'))
})

test('formatOpenAgentEvent distinguishes finished / stopped / failed (#218)', () => {
  assert.equal(formatOpenAgentEvent({ kind: 'end', ok: true }), '✓ finished')
  assert.equal(formatOpenAgentEvent({ kind: 'end', ok: false, stopped: true }), '■ stopped')
  assert.equal(formatOpenAgentEvent({ kind: 'end', ok: false, detail: 'boom' }), '✗ failed: boom')
})

test('formatOpenAgentEvent renders a usage spend line: the price of one turn (#322)', () => {
  assert.equal(formatOpenAgentEvent({ kind: 'usage', costUsd: 0.04 }), '  spend: $0.0400')
})

test('formats the rate-limit line by how much the quota actually matters (#517)', () => {
  const at = Date.UTC(2026, 6, 15, 4, 30)
  const line = (status: string) => formatOpenAgentEvent({ kind: 'driver', event: { type: 'rate-limit', limit: { status, window: 'five_hour', resetsAt: at } } })!
  assert.match(line('allowed'), /^\s+· quota allowed \(five_hour\)/)
  assert.match(line('allowed_warning'), /^\s+! quota running low \(five_hour\)/)
  assert.match(line('rejected'), /^\s+✗ quota exhausted \(five_hour\)/)
  // An unseen status still renders rather than blowing up or vanishing.
  assert.match(line('some_new_status'), /quota some_new_status/)
  assert.ok(line('allowed').includes(new Date(at).toISOString()))
})
