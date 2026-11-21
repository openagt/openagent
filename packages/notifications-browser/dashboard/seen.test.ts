import { expect, test } from 'vitest'
import { waitingKey, type ActivityItem, type WaitingItem } from '@openagt/ui/module'
import { activityKey } from './notify.js'
import { SeenTracker } from './seen.js'

const pr = (n: number, url: string, project = 'p'): WaitingItem => ({
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

const started = (agentId: string): ActivityItem => ({ projectId: 'p', projectName: 'p', kind: 'started', agentId })
const finished = (agentId: string): ActivityItem => ({ projectId: 'p', projectName: 'p', kind: 'finished', agentId, status: 'done' })

test('the first read is a baseline; after it, only the new items', () => {
  const tracker = new SeenTracker<WaitingItem>(waitingKey, projectOf)
  // The first read is what already waited when the page opened: nothing is told.
  expect(tracker.observe([pr(1, 'u1')], ['p'])).toEqual([])
  // A new pull request on the next read: just that one.
  expect(tracker.observe([pr(1, 'u1'), pr(2, 'u2')], ['p']).map(item => item.detail)).toEqual(['#2'])
  // Nothing new: nothing.
  expect(tracker.observe([pr(1, 'u1'), pr(2, 'u2')], ['p'])).toEqual([])
})

test("the identity is the caller's, so a run started and the same run finished are two items", () => {
  const tracker = new SeenTracker(activityKey, projectOf)
  expect(tracker.observe([started('r1')], ['p'])).toEqual([])
  expect(tracker.observe([finished('r1')], ['p']).map(item => item.kind)).toEqual(['finished'])
  expect(tracker.observe([finished('r1')], ['p'])).toEqual([])
})

test('a first read that reached no project whole is not a baseline: the backlog is not told (#1623)', () => {
  const tracker = new SeenTracker<WaitingItem>(waitingKey, projectOf)
  // What a page opened with no reach to the git host reads: an empty list, and a read that
  // succeeded, as every read under it forgave its own failure.
  expect(tracker.observe([], [])).toEqual([])
  // The first real read: two pull requests already open, neither of them news.
  expect(tracker.observe([pr(1, 'u1'), pr(2, 'u2')], ['p'])).toEqual([])
})

test('a project that cannot be read neither floods nor silences the others (#1623)', () => {
  const tracker = new SeenTracker<WaitingItem>(waitingKey, projectOf)
  // `a` answers from the start; `b`, a repo with no remote, say, only later.
  expect(tracker.observe([pr(1, 'u1', 'a')], ['a'])).toEqual([])
  // `a` is still told of while `b` cannot be read: the baseline is each project's.
  expect(tracker.observe([pr(1, 'u1', 'a'), pr(3, 'u3', 'a')], ['a']).map(item => item.detail)).toEqual(['#3'])
  // `b`'s pull request, already open, is not news either: this is `b`'s first whole read.
  expect(tracker.observe([pr(1, 'u1', 'a'), pr(3, 'u3', 'a'), pr(2, 'u2', 'b')], ['a', 'b'])).toEqual([])
})

test('an item seen in a partial read is remembered, so it is not news once its project is read whole (#1623)', () => {
  const tracker = new SeenTracker<WaitingItem>(waitingKey, projectOf)
  expect(tracker.observe([pr(1, 'u1')], [])).toEqual([])
  expect(tracker.observe([pr(1, 'u1')], ['p'])).toEqual([])
  expect(tracker.observe([pr(1, 'u1')], ['p'])).toEqual([])
})
