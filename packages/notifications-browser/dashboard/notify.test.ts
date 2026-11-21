import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { ActivityItem, ProjectionRead, WaitingItem } from '@openagt/ui/module'
import { ACTIVITY, WAITING, activityKey, useNewItemNotifications } from './notify.js'

const made = vi.fn()
/** Each notification made, to click. */
let shown: { onclick: (() => void) | null }[] = []
/** What a click opened in this tab. */
const openAgent = vi.fn()

beforeEach(() => {
  made.mockReset()
  openAgent.mockReset()
  shown = []
  class FakeNotification {
    static permission = 'granted'
    onclick: (() => void) | null = null
    constructor(title: string, opts?: NotificationOptions) {
      made(title, opts)
      shown.push(this)
    }
    close(): void {}
  }
  vi.stubGlobal('Notification', FakeNotification)
})
afterEach(() => vi.unstubAllGlobals())

/** A read that reached every project it names: the ordinary case. */
const read = <T,>(items: T[], whole: string[] = ['p']): ProjectionRead<T> => ({ items, whole })

/** A read that could not look anywhere: an empty list that means "could not look" (#1625). */
const unread = <T,>(): ProjectionRead<T> => ({ items: [], whole: [] })

describe('what waits on the person (#627)', () => {
  const item = (n: number, url: string, projectId = 'p'): WaitingItem => ({ projectId, projectName: projectId, kind: 'waiting', module: 'github', scope: 'project', id: url, words: 'Needs merge', title: `pr ${n}`, detail: `#${n}`, mark: 'pull-request', fix: { label: `Open PR #${n}`, href: url } })
  const awaiting = (questionId: string, question: string, run = 'r1'): WaitingItem => ({ projectId: 'p', projectName: 'p', kind: 'waiting', module: 'ask', scope: 'run', run, id: `${run}:${questionId}`, words: 'Needs answer', title: 'Auth', detail: question, mark: 'question' })

  const render = (enabled: boolean) =>
    renderHook(({ items }) => useNewItemNotifications(items, enabled, WAITING, openAgent), {
      initialProps: { items: unread<WaitingItem>() },
    })

  test('quiet for the pull requests already open as the page opens, then told of one that comes later', () => {
    const { rerender } = render(true)
    rerender({ items: read([item(1, 'u1')]) })
    expect(made).not.toHaveBeenCalled()
    rerender({ items: read([item(1, 'u1'), item(2, 'u2')]) })
    expect(made).toHaveBeenCalledTimes(1)
    expect(made.mock.calls[0]![0]).toBe('Human Queue · p')
    expect(made.mock.calls[0]![1]?.body).toBe('pr 2 — Needs merge: #2')
  })

  test('a run that comes to wait on a question is told with its question (#636)', () => {
    const { rerender } = render(true)
    rerender({ items: read([] as WaitingItem[]) })
    rerender({ items: read([awaiting('g1', 'Cache the auth store?')]) })
    expect(made).toHaveBeenCalledTimes(1)
    expect(made.mock.calls[0]![1]?.body).toContain('Cache the auth store?')
  })

  test('several at once are one notification, counted', () => {
    const { rerender } = render(true)
    rerender({ items: read([] as WaitingItem[]) })
    rerender({ items: read([item(1, 'u1'), item(2, 'u2')]) })
    expect(made.mock.calls.map(call => call[0])).toEqual(['2 items in your Human Queue'])
  })

  test('a question is told with its own tag, the same in every open tab, so the system shows it once', () => {
    const tab = () => {
      const { rerender } = render(true)
      rerender({ items: read([] as WaitingItem[]) })
      rerender({ items: read([awaiting('g1', 'Cache the auth store?')]) })
    }
    tab()
    tab()
    expect(made.mock.calls.map(call => call[1]?.tag)).toEqual(['p:ask:r1:g1', 'p:ask:r1:g1'])
  })

  test('a click on a question opens the run that asks it, in this tab; one on a pull request opens it on the git host', () => {
    const opened = vi.spyOn(window, 'open').mockImplementation(() => null)
    const { rerender } = render(true)
    rerender({ items: read([] as WaitingItem[]) })
    rerender({ items: read([awaiting('g1', 'Cache the auth store?')]) })
    shown[0]!.onclick!()
    expect(openAgent.mock.calls).toEqual([['p', 'r1']])
    rerender({ items: read([awaiting('g1', 'Cache the auth store?'), item(2, 'https://github.com/o/r/pull/2')]) })
    shown[1]!.onclick!()
    expect(opened).toHaveBeenCalledWith('https://github.com/o/r/pull/2', '_blank', 'noopener')
    expect(openAgent).toHaveBeenCalledTimes(1)
    opened.mockRestore()
  })

  test('switched off, nothing is told', () => {
    const { rerender } = render(false)
    rerender({ items: read([item(1, 'u1')]) })
    rerender({ items: read([item(1, 'u1'), item(2, 'u2')]) })
    expect(made).not.toHaveBeenCalled()
  })

  test('without the browser allowing them, nothing is told', () => {
    vi.stubGlobal('Notification', Object.assign(vi.fn(), { permission: 'default' }))
    const { rerender } = render(true)
    rerender({ items: read([item(1, 'u1')]) })
    rerender({ items: read([item(1, 'u1'), item(2, 'u2')]) })
    expect(Notification).not.toHaveBeenCalled()
  })

  test('a read that reached no project is not a baseline, so the backlog stays quiet (#1625)', () => {
    // What a page opened with no reach to GitHub reads: an empty list, as every read under it forgave its failure.
    const { rerender } = render(true)
    rerender({ items: unread<WaitingItem>() })
    rerender({ items: unread<WaitingItem>() })
    // GitHub answers at last. Both pull requests were open before this tab was; neither is news.
    rerender({ items: read([item(1, 'u1'), item(2, 'u2')]) })
    expect(made).not.toHaveBeenCalled()
    rerender({ items: read([item(1, 'u1'), item(2, 'u2'), item(3, 'u3')]) })
    expect(made).toHaveBeenCalledTimes(1)
    expect(made.mock.calls[0]![1]?.body).toContain('#3')
  })

  test('a project that cannot be read does not hold back a project that can (#1625)', () => {
    const other = (n: number): WaitingItem => item(n, `u${n}`, 'q')
    const { rerender } = render(true)
    // `p` answers from the start; `q`, a repo with no remote, say, never does.
    rerender({ items: read([item(1, 'u1')]) })
    rerender({ items: read([item(1, 'u1'), item(9, 'u9')]) })
    expect(made).toHaveBeenCalledTimes(1)
    // `q` answers for the first time: what it holds is a baseline, not news.
    rerender({ items: read([item(1, 'u1'), item(9, 'u9'), other(5)], ['p', 'q']) })
    expect(made).toHaveBeenCalledTimes(1)
  })

  test('switched on, what came while it was off is not told', () => {
    const { rerender } = renderHook(({ items, enabled }) => useNewItemNotifications(items, enabled, WAITING, openAgent), {
      initialProps: { items: unread<WaitingItem>(), enabled: false },
    })
    rerender({ items: read([item(1, 'u1')]), enabled: false })
    rerender({ items: read([item(1, 'u1'), item(2, 'u2')]), enabled: false })
    rerender({ items: read([item(1, 'u1'), item(2, 'u2')]), enabled: true })
    expect(made).not.toHaveBeenCalled()
  })
})

describe('runs that start or end (#627)', () => {
  const startedAgent = (agentId: string, title?: string): ActivityItem => ({ projectId: 'p', projectName: 'p', agentId, kind: 'started', ...(title ? { title } : {}) })
  const finishedAgent = (agentId: string, title?: string): ActivityItem => ({ projectId: 'p', projectName: 'p', agentId, kind: 'finished', ...(title ? { title } : {}) })

  const render = (enabled: boolean) => renderHook(({ items }) => useNewItemNotifications(items, enabled, ACTIVITY, openAgent), { initialProps: { items: unread<ActivityItem>() } })

  test("an item's key is its kind, project and run, so a run's start and its end are two", () => {
    expect([activityKey(startedAgent('r1')), activityKey(finishedAgent('r1'))]).toEqual(['started:p:r1', 'finished:p:r1'])
  })

  test('quiet for the runs there as the page opens, then told of a run that starts', () => {
    const { rerender } = render(true)
    rerender({ items: read([finishedAgent('r1', 'seed')]) })
    expect(made).not.toHaveBeenCalled()
    rerender({ items: read([startedAgent('r2', 'add cart'), finishedAgent('r1', 'seed')]) })
    expect(made.mock.calls.map(call => [call[0], call[1]?.body])).toEqual([['Agent started · p', 'Started: add cart']])
    shown[0]!.onclick!()
    expect(openAgent.mock.calls).toEqual([['p', 'r2']])
  })

  test('told again when the same run finishes', () => {
    const { rerender } = render(true)
    rerender({ items: read([] as ActivityItem[]) })
    rerender({ items: read([startedAgent('r1', 'work')]) })
    rerender({ items: read([finishedAgent('r1', 'work')]) })
    expect(made.mock.calls.map(call => call[0])).toEqual(['Agent started · p', 'Agent finished · p'])
  })

  test('switched off, nothing is told', () => {
    const { rerender } = render(false)
    rerender({ items: read([startedAgent('r1')]) })
    rerender({ items: read([startedAgent('r1'), startedAgent('r2')]) })
    expect(made).not.toHaveBeenCalled()
  })
})
