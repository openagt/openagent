import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { Activity, Intervention, ProjectionRead } from '../../src/index.js'
import { useActivityNotifications, useInterventionNotifications } from './use-notifications.js'

const ctor = vi.fn()

beforeEach(() => {
  ctor.mockReset()
  class FakeNotification {
    static permission = 'granted'
    onclick: (() => void) | null = null
    constructor(title: string, opts?: NotificationOptions) {
      ctor(title, opts)
    }
    close(): void {}
  }
  vi.stubGlobal('Notification', FakeNotification)
})
afterEach(() => vi.unstubAllGlobals())

/** A poll that reached every project it names — the ordinary case. */
const read = <T,>(items: T[], whole: string[] = ['p']): ProjectionRead<T> => ({ items, whole })

/** A poll that could not read anything: an empty list that means "we could not look" (#1625). */
const unread = <T,>(): ProjectionRead<T> => ({ items: [], whole: [] })

describe('useInterventionNotifications (#627)', () => {
  const item = (n: number, url: string): Intervention => ({ projectId: 'p', projectName: 'p', kind: 'pr', number: n, title: `pr ${n}`, url })
  const awaiting = (awaitId: string, title: string): Intervention => ({ projectId: 'p', projectName: 'p', kind: 'awaiting', title, url: '', awaitId })

  const render = (enabled: boolean) =>
    renderHook(({ items }) => useInterventionNotifications(items, enabled), {
      initialProps: { items: unread<Intervention>() },
    })

  test('stays quiet for PRs already open at load, then fires for one that appears later', () => {
    const { rerender } = render(true)
    rerender({ items: read([item(1, 'u1')]) }) // first fetch of an already-open PR -> baseline, no notify
    expect(ctor).not.toHaveBeenCalled()
    rerender({ items: read([item(1, 'u1'), item(2, 'u2')]) }) // a genuinely new PR -> notify once
    expect(ctor).toHaveBeenCalledTimes(1)
    expect(ctor.mock.calls[0]![0]).toContain('Human Queue')
  })

  test('fires for a paused run that appears later, showing its question (#636)', () => {
    const { rerender } = render(true)
    rerender({ items: read([] as Intervention[]) }) // baseline: read whole, nothing waiting
    rerender({ items: read([awaiting('g1', 'Cache the auth store?')]) })
    expect(ctor).toHaveBeenCalledTimes(1)
    expect(ctor.mock.calls[0]![1]?.body).toContain('Cache the auth store?')
  })

  test('never fires when notifications are disabled', () => {
    const { rerender } = render(false)
    rerender({ items: read([item(1, 'u1')]) })
    rerender({ items: read([item(1, 'u1'), item(2, 'u2')]) })
    expect(ctor).not.toHaveBeenCalled()
  })

  test('a poll that reached no project is not a baseline, so the backlog stays quiet (#1625)', () => {
    // What a dashboard opened with no GitHub reach actually sees: the fetch succeeds, empty,
    // because every read underneath forgave its own failure.
    const { rerender } = render(true)
    rerender({ items: unread<Intervention>() })
    rerender({ items: unread<Intervention>() })
    // GitHub answers at last. Both PRs were open before this tab existed; neither is news.
    rerender({ items: read([item(1, 'u1'), item(2, 'u2')]) })
    expect(ctor).not.toHaveBeenCalled()
    rerender({ items: read([item(1, 'u1'), item(2, 'u2'), item(3, 'u3')]) })
    expect(ctor).toHaveBeenCalledTimes(1)
    expect(ctor.mock.calls[0]![1]?.body).toContain('#3')
  })

  test('a project that cannot be read does not hold back a project that can (#1625)', () => {
    const other = (n: number): Intervention => ({ projectId: 'q', projectName: 'q', kind: 'pr', number: n, title: `pr ${n}`, url: `u${n}` })
    const { rerender } = render(true)
    // `p` answers from the start; `q` — a repo with no remote, say — never does.
    rerender({ items: read([item(1, 'u1')]) })
    rerender({ items: read([item(1, 'u1'), item(9, 'u9')]) }) // p keeps notifying
    expect(ctor).toHaveBeenCalledTimes(1)
    // `q` answers for the first time: its backlog is a baseline, not news.
    rerender({ items: read([item(1, 'u1'), item(9, 'u9'), other(5)], ['p', 'q']) })
    expect(ctor).toHaveBeenCalledTimes(1)
  })

  test('turning notifications on does not replay what arrived while they were off', () => {
    const { rerender } = renderHook(({ items, enabled }) => useInterventionNotifications(items, enabled), {
      initialProps: { items: unread<Intervention>(), enabled: false },
    })
    rerender({ items: read([item(1, 'u1')]), enabled: false })
    rerender({ items: read([item(1, 'u1'), item(2, 'u2')]), enabled: false })
    rerender({ items: read([item(1, 'u1'), item(2, 'u2')]), enabled: true })
    expect(ctor).not.toHaveBeenCalled()
  })
})

describe('useActivityNotifications (#627)', () => {
  const startedAgent = (agentId: string, title?: string): Activity => ({ projectId: 'p', projectName: 'p', agentId: agentId, kind: 'started', ...(title ? { title } : {}) })
  const finishedAgent = (agentId: string, title?: string): Activity => ({ projectId: 'p', projectName: 'p', agentId: agentId, kind: 'finished', ...(title ? { title } : {}) })

  const render = (enabled: boolean) =>
    renderHook(({ items }) => useActivityNotifications(items, enabled), { initialProps: { items: unread<Activity>() } })

  test('stays quiet for runs already present at load, then fires when a run starts', () => {
    const { rerender } = render(true)
    rerender({ items: read([finishedAgent('r1', 'seed')]) }) // first fetch of an existing run -> baseline, no notify
    expect(ctor).not.toHaveBeenCalled()
    rerender({ items: read([startedAgent('r2', 'add cart'), finishedAgent('r1', 'seed')]) }) // a run just started -> notify
    expect(ctor).toHaveBeenCalledTimes(1)
    expect(ctor.mock.calls[0]![0]).toContain('Agent started')
    expect(ctor.mock.calls[0]![1]?.body).toContain('add cart')
  })

  test('fires again when the same run finishes (distinct key)', () => {
    const { rerender } = render(true)
    rerender({ items: read([] as Activity[]) }) // baseline: read whole, no runs yet
    rerender({ items: read([startedAgent('r1', 'work')]) }) // started
    rerender({ items: read([finishedAgent('r1', 'work')]) }) // finished -> a new key
    expect(ctor).toHaveBeenCalledTimes(2)
    expect(ctor.mock.calls[1]![0]).toContain('Agent finished')
  })

  test('never fires when disabled', () => {
    const { rerender } = render(false)
    rerender({ items: read([startedAgent('r1')]) })
    rerender({ items: read([startedAgent('r1'), startedAgent('r2')]) })
    expect(ctor).not.toHaveBeenCalled()
  })
})
