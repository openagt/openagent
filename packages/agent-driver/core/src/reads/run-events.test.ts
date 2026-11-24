import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { RunEvent } from '@openagt/hooks'
import { eventsOf, fromDiaryLine } from './run-events.js'

test('a diary reads as events: the skill\'s four kinds mapped, every other line as it is (#1769)', () => {
  assert.deepEqual(
    eventsOf([
      { kind: 'session', driver: 'claude-code', workspace: '/w', fake: false, model: 'opus' },
      { kind: 'said', text: 'Reading.' },
      { kind: 'result', text: 'Done.', sessionId: 's1' },
      { kind: 'cost', usd: 0.5 },
      { kind: 'ended', status: 'done' },
      { kind: 'ended', status: 'stopped', detail: 'its process died' },
      { kind: 'ended', status: 'failed', detail: 'API 500' },
    ]),
    [
      { kind: 'session', driver: 'claude-code', workspace: '/w', fake: false, model: 'opus' },
      { kind: 'driver', event: { type: 'text', text: 'Reading.' } },
      { kind: 'driver', event: { type: 'result', text: 'Done.', sessionId: 's1' } },
      { kind: 'usage', costUsd: 0.5 },
      { kind: 'end', ok: true },
      { kind: 'end', ok: false, stopped: true, detail: 'its process died' },
      { kind: 'end', ok: false, detail: 'API 500' },
    ] satisfies RunEvent[],
  )
})

test('a diary agent-driver\'s own log wrote reads back as OpenAgent\'s events: driver lines, the session id, the question as a gate, a waiting end (#1774)', () => {
  assert.deepEqual(fromDiaryLine({ kind: 'start', prompt: '/work-queue' }), { kind: 'driver', event: { type: 'start', prompt: '/work-queue' } })
  assert.deepEqual(fromDiaryLine({ kind: 'action', label: 'Bash' }), { kind: 'driver', event: { type: 'action', label: 'Bash' } })
  assert.deepEqual(fromDiaryLine({ kind: 'action', label: 'Bash', detail: 'git status' }), { kind: 'driver', event: { type: 'action', label: 'Bash', detail: 'git status' } })
  assert.deepEqual(fromDiaryLine({ kind: 'action', label: 'Bash', detail: 'a b', whole: 'a\nb', id: 't1' }), { kind: 'driver', event: { type: 'action', label: 'Bash', detail: 'a b', whole: 'a\nb', id: 't1' } })
  assert.deepEqual(fromDiaryLine({ kind: 'output', id: 't1', text: 'ok', failed: true, exitCode: 1 }), { kind: 'driver', event: { type: 'output', id: 't1', text: 'ok', failed: true, exitCode: 1 } })
  assert.deepEqual(fromDiaryLine({ kind: 'thought', text: 'Check the test first.' }), { kind: 'driver', event: { type: 'thought', text: 'Check the test first.' } })
  assert.deepEqual(fromDiaryLine({ kind: 'notice', message: 'retried' }), { kind: 'driver', event: { type: 'notice', message: 'retried' } })
  assert.deepEqual(fromDiaryLine({ kind: 'error', message: 'claude exited with code 1' }), { kind: 'driver', event: { type: 'error', message: 'claude exited with code 1' } })
  // An `error` block of a run recorded before the daemon stopped running agents is the agent's own report, not a driver's.
  assert.deepEqual(fromDiaryLine({ kind: 'error', headline: 'gh is not logged in', detail: 'ran gh auth status' }), { kind: 'error', headline: 'gh is not logged in', detail: 'ran gh auth status' })
  assert.deepEqual(fromDiaryLine({ kind: 'session', sessionId: 's-1' }), { kind: 'session-update', sessionId: 's-1' })
  // OpenAgent's own session event, written by its run child, still reads as itself.
  assert.deepEqual(fromDiaryLine({ kind: 'session', driver: 'claude-code', workspace: '/w', fake: false }), { kind: 'session', driver: 'claude-code', workspace: '/w', fake: false })
  assert.deepEqual(fromDiaryLine({ kind: 'question', title: 'Ship it?', options: [{ id: 'opt:0', label: 'Approve' }, { id: 'opt:1', label: 'Decline', stop: true }], recommended: 'opt:0' }), {
    kind: 'choice',
    id: 'question',
    title: 'Ship it?',
    options: [{ id: 'opt:0', label: 'Approve' }, { id: 'opt:1', label: 'Decline', stop: true }],
    recommended: 'opt:0',
  })
  assert.deepEqual(fromDiaryLine({ kind: 'question', title: 'Which colour?', header: 'Background', options: [{ id: 'opt:0', label: 'Blue' }] }), {
    kind: 'choice',
    id: 'question',
    title: 'Which colour?',
    header: 'Background',
    options: [{ id: 'opt:0', label: 'Blue' }],
  })
  assert.deepEqual(fromDiaryLine({ kind: 'ended', status: 'waiting' }), { kind: 'end', ok: false, waiting: true })
  assert.deepEqual(fromDiaryLine({ kind: 'ended', status: 'stopped', detail: 'by hand' }), { kind: 'end', ok: false, stopped: true, detail: 'by hand' })
})

test('a line\'s time is its event\'s, on every kind; a line with none reads with none', () => {
  const at = '2026-09-25T10:00:00.000Z'
  assert.deepEqual(fromDiaryLine({ kind: 'said', text: 'hi', at }), { kind: 'driver', event: { type: 'text', text: 'hi' }, at })
  assert.deepEqual(fromDiaryLine({ kind: 'result', text: 'done', at }), { kind: 'driver', event: { type: 'result', text: 'done' }, at })
  assert.deepEqual(fromDiaryLine({ kind: 'ended', status: 'waiting', at }), { kind: 'end', ok: false, waiting: true, at })
  assert.deepEqual(fromDiaryLine({ kind: 'screen', url: 'http://127.0.0.1:1/', label: 'browser', at }), { kind: 'screen', url: 'http://127.0.0.1:1/', label: 'browser', at })
  // A question is the one asked at its line: its time is its id.
  assert.deepEqual(fromDiaryLine({ kind: 'question', title: 'Ship it?', options: [{ id: 'opt:0', label: 'Approve' }], at }), { kind: 'choice', id: at, title: 'Ship it?', options: [{ id: 'opt:0', label: 'Approve' }], at })
  assert.deepEqual(fromDiaryLine({ kind: 'said', text: 'old' }), { kind: 'driver', event: { type: 'text', text: 'old' } })
})

test('a subagent of the coding agent\'s own reads as its event, and what it said and did reads as its own', () => {
  const subagent = { kind: 'subagent', id: 'toolu_a', status: 'working', name: 'Map the pages', model: 'claude-haiku-5-5', prompt: 'Read how the pages are served.' }
  assert.deepEqual(fromDiaryLine(subagent), { kind: 'driver', event: { type: 'subagent', id: 'toolu_a', status: 'working', name: 'Map the pages', model: 'claude-haiku-5-5', prompt: 'Read how the pages are served.' } })
  assert.deepEqual(fromDiaryLine({ kind: 'said', text: 'Reading.', subagent: 'toolu_a' }), { kind: 'driver', event: { type: 'text', text: 'Reading.', subagent: 'toolu_a' } })
  assert.deepEqual(fromDiaryLine({ kind: 'action', label: 'Bash', id: 'toolu_b', subagent: 'toolu_a' }), { kind: 'driver', event: { type: 'action', label: 'Bash', id: 'toolu_b', subagent: 'toolu_a' } })
})

test('what the agent waited on in the background reads back as its event: a page opened during the wait says it', () => {
  const at = '2026-11-21T19:13:12.000Z'
  const tasks = [{ id: 'b1', description: 'Run the tests', command: 'pnpm test', since: '2026-11-21T19:13:10.000Z' }]
  assert.deepEqual(fromDiaryLine({ kind: 'background', tasks, at }), { kind: 'driver', event: { type: 'background', tasks }, at })
  assert.deepEqual(fromDiaryLine({ kind: 'background', tasks: [] }), { kind: 'driver', event: { type: 'background', tasks: [] } })
})

test('a line whose kind is no longer an event reads as nothing, so an old run shows no empty rows', () => {
  // Kinds runs wrote before OpenAgent stopped running agents: nothing reads them any more.
  assert.equal(fromDiaryLine({ kind: 'handoff', outcome: 'done', pushed: true, url: 'https://x/pr/1' }), undefined)
  assert.equal(fromDiaryLine({ kind: 'bootstrap', at: '2026-07-26T14:50:54.113Z' }), undefined)
  assert.deepEqual(
    eventsOf([{ kind: 'said', text: 'hi' }, { kind: 'handoff-armed', push: true, pr: true }, { kind: 'open-pr', title: 't' }, { kind: 'ready-for-merge' }, { kind: 'settled' }]),
    [{ kind: 'driver', event: { type: 'text', text: 'hi' } }, { kind: 'settled' }] satisfies RunEvent[],
  )
})
