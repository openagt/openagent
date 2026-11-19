import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { SeenTracker } from './keyed-watcher.js'
import { activityKey, type Activity } from './activity.js'
import { waitingKey } from './keys.js'
import type { Waiting } from './waiting.js'
import { pendingChoices } from '../open-choices.js'
import { eventsOf } from '../store/run-record.js'
import type { AnyDiaryLine } from '../store/runs.js'

const pr = (n: number, url: string, project = 'p'): Waiting => ({
  projectId: project,
  projectName: project,
  kind: 'waiting',
  module: 'github',
  scope: 'project',
  id: url,
  words: 'Needs merge',
  title: `pr ${n}`,
  detail: `#${n}`,
})

const projectOf = (item: { projectId: string }): string => item.projectId

const started = (agentId: string): Activity => ({ projectId: 'p', projectName: 'p', kind: 'started', agentId })
const finished = (agentId: string): Activity => ({ projectId: 'p', projectName: 'p', kind: 'finished', agentId, status: 'done' })

test('SeenTracker seeds a baseline on the first poll, then returns only new items', () => {
  const tracker = new SeenTracker<Waiting>(waitingKey, projectOf)
  // First poll = the queue that already existed at start-up: baseline, nothing announced.
  assert.deepEqual(tracker.observe([pr(1, 'u1')], ['p']), [])
  // A new PR appears next poll -> just that one.
  assert.deepEqual(tracker.observe([pr(1, 'u1'), pr(2, 'u2')], ['p']).map(i => i.detail), ['#2'])
  // Nothing new -> empty.
  assert.deepEqual(tracker.observe([pr(1, 'u1'), pr(2, 'u2')], ['p']), [])
})

test('SeenTracker keys on the caller\'s identity, so a run started and finished are two announcements', () => {
  const tracker = new SeenTracker(activityKey, projectOf)
  assert.deepEqual(tracker.observe([started('r1')], ['p']), [])
  // The same agent finishing is a new key -> announced.
  assert.deepEqual(tracker.observe([finished('r1')], ['p']).map(i => i.kind), ['finished'])
  assert.deepEqual(tracker.observe([finished('r1')], ['p']), [])
})

test('a first read that saw nothing whole is not a baseline: the backlog is not announced (#1623)', () => {
  const tracker = new SeenTracker<Waiting>(waitingKey, projectOf)
  // What a boot with no GitHub reach looks like: the read *succeeds*, with an empty list,
  // because every read underneath it forgave its own failure.
  assert.deepEqual(tracker.observe([], []), [])
  // The first real read: two pre-existing PRs, and neither is news.
  assert.deepEqual(tracker.observe([pr(1, 'u1'), pr(2, 'u2')], ['p']), [])
})

test('one unreadable project neither floods nor silences the others (#1623)', () => {
  const tracker = new SeenTracker<Waiting>(waitingKey, projectOf)
  // `a` answers from the start; `b` — a repo with no remote, say — only later.
  assert.deepEqual(tracker.observe([pr(1, 'u1', 'a')], ['a']), [])
  // `a` keeps announcing while `b` is unreadable — the point of holding the baseline per project.
  assert.deepEqual(tracker.observe([pr(1, 'u1', 'a'), pr(3, 'u3', 'a')], ['a']).map(i => i.detail), ['#3'])
  // `b`'s pre-existing PR is not news either: this is `b`'s first whole read.
  assert.deepEqual(tracker.observe([pr(1, 'u1', 'a'), pr(3, 'u3', 'a'), pr(2, 'u2', 'b')], ['a', 'b']), [])
})

test('an item seen in a partial read is remembered, so it is not news once the project is whole (#1623)', () => {
  const tracker = new SeenTracker<Waiting>(waitingKey, projectOf)
  assert.deepEqual(tracker.observe([pr(1, 'u1')], []), [])
  assert.deepEqual(tracker.observe([pr(1, 'u1')], ['p']), [])
  assert.deepEqual(tracker.observe([pr(1, 'u1')], ['p']), [])
})

test('a run\'s second question is announced: each question is the one asked at its own line', () => {
  const tracker = new SeenTracker<Waiting>(waitingKey, projectOf)
  const asking = (lines: AnyDiaryLine[]): Waiting[] =>
    pendingChoices(eventsOf(lines)).map(choice => ({ projectId: 'p', projectName: 'p', kind: 'waiting', module: 'ask', scope: 'run', run: 'r1', id: `r1:${choice.id}`, words: 'Needs answer', title: 'r1', detail: choice.title }))
  const first = { kind: 'question', title: 'Which way?', options: [{ id: 'a', label: 'Left' }], at: '2026-11-15T10:00:00.000Z' }
  const second = { kind: 'question', title: 'Which colour?', options: [{ id: 'b', label: 'Blue' }], at: '2026-11-15T10:05:00.000Z' }
  assert.deepEqual(tracker.observe([], ['p']), [])
  assert.deepEqual(tracker.observe(asking([first]), ['p']).map(item => item.detail), ['Which way?'])
  const answered = [first, { kind: 'said', text: 'Going left.', at: '2026-11-15T10:01:00.000Z' }]
  assert.deepEqual(tracker.observe(asking(answered), ['p']), [])
  assert.deepEqual(tracker.observe(asking([...answered, second]), ['p']).map(item => item.detail), ['Which colour?'])
})
