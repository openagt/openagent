import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { SeenTracker } from './keyed-watcher.js'
import { activityKey, type Activity } from './activity.js'
import { interventionKey, type Intervention } from './interventions.js'

const pr = (n: number, url: string, project = 'p'): Intervention => ({
  projectId: project,
  projectName: project,
  kind: 'pr',
  number: n,
  title: `pr ${n}`,
  url,
})

const projectOf = (item: { projectId: string }): string => item.projectId

const started = (agentId: string): Activity => ({ projectId: 'p', projectName: 'p', kind: 'started', agentId })
const finished = (agentId: string): Activity => ({ projectId: 'p', projectName: 'p', kind: 'finished', agentId, status: 'done' })

test('SeenTracker seeds a baseline on the first poll, then returns only new items', () => {
  const tracker = new SeenTracker(interventionKey, projectOf)
  // First poll = the queue that already existed at start-up: baseline, nothing announced.
  assert.deepEqual(tracker.observe([pr(1, 'u1')], ['p']), [])
  // A new PR appears next poll -> just that one.
  assert.deepEqual(tracker.observe([pr(1, 'u1'), pr(2, 'u2')], ['p']).map(i => i.number), [2])
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
  const tracker = new SeenTracker(interventionKey, projectOf)
  // What a boot with no GitHub reach looks like: the read *succeeds*, with an empty list,
  // because every read underneath it forgave its own failure.
  assert.deepEqual(tracker.observe([], []), [])
  // The first real read: two pre-existing PRs, and neither is news.
  assert.deepEqual(tracker.observe([pr(1, 'u1'), pr(2, 'u2')], ['p']), [])
})

test('one unreadable project neither floods nor silences the others (#1623)', () => {
  const tracker = new SeenTracker(interventionKey, projectOf)
  // `a` answers from the start; `b` — a repo with no remote, say — only later.
  assert.deepEqual(tracker.observe([pr(1, 'u1', 'a')], ['a']), [])
  // `a` keeps announcing while `b` is unreadable — the point of holding the baseline per project.
  assert.deepEqual(tracker.observe([pr(1, 'u1', 'a'), pr(3, 'u3', 'a')], ['a']).map(i => i.number), [3])
  // `b`'s pre-existing PR is not news either: this is `b`'s first whole read.
  assert.deepEqual(tracker.observe([pr(1, 'u1', 'a'), pr(3, 'u3', 'a'), pr(2, 'u2', 'b')], ['a', 'b']), [])
})

test('an item seen in a partial read is remembered, so it is not news once the project is whole (#1623)', () => {
  const tracker = new SeenTracker(interventionKey, projectOf)
  assert.deepEqual(tracker.observe([pr(1, 'u1')], []), [])
  assert.deepEqual(tracker.observe([pr(1, 'u1')], ['p']), [])
  assert.deepEqual(tracker.observe([pr(1, 'u1')], ['p']), [])
})
