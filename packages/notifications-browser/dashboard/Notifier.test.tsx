import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, waitFor } from '@testing-library/react'
import type { ActivityItem, ModuleCallResult, ModuleHost, ProjectionRead, ReadState, WaitingItem } from '@openagt/ui/module'
import { fakeHost, renderWithHost } from '@openagt/ui/module/testing'
import type { Kinds } from '../src/kinds.js'

// What waits on the person as the shell read it, a test's: the notifier reads the shell's read, never one of its own.
const shell = vi.hoisted(() => ({ state: 'fresh' as ReadState, all: { items: [], whole: [] } as ProjectionRead<WaitingItem> }))
vi.mock('@openagt/ui/module', async original => ({
  ...(await original<typeof import('@openagt/ui/module')>()),
  useWaiting: () => ({ items: shell.all.items, state: shell.state, all: shell.all }),
}))

const { Notifier } = await import('./Notifier.js')
const { forgetKinds } = await import('./kinds.js')

/** The titles of the notifications made, and each one's click. */
let made: { title: string; click: () => void }[] = []
let kinds: Kinds

beforeEach(() => {
  made = []
  kinds = { waiting: true, activity: false }
  shell.state = 'fresh'
  shell.all = { items: [], whole: ['p'] }
  class FakeNotification {
    static permission = 'granted'
    onclick: (() => void) | null = null
    constructor(title: string) {
      made.push({ title, click: () => this.onclick?.() })
    }
    close(): void {}
  }
  vi.stubGlobal('Notification', FakeNotification)
})
afterEach(() => {
  cleanup()
  forgetKinds()
  vi.unstubAllGlobals()
})

const question = (run: string): WaitingItem => ({ kind: 'waiting', module: 'ask', scope: 'run', run, id: `${run}:q`, words: 'Needs answer', title: `Run ${run}`, detail: 'Which way?', mark: 'question', projectId: 'p', projectName: 'p' })

/** The kinds as the package's server part answers them, from `kinds`. */
const callComputer = vi.fn(async (name: string): Promise<ModuleCallResult> => (name === 'kinds' ? { ok: true, output: kinds } : { ok: false, error: `no ${name} here` }))

const render = (services: Partial<Omit<ModuleHost, 'package'>> = {}) => {
  const host = fakeHost('@openagt/notifications-browser', { callComputer, ...services })
  const view = renderWithHost(<Notifier />, host)
  return { host, waiting: (state: ReadState, items: WaitingItem[]) => ((shell.state = state), (shell.all = { items, whole: ['p'] }), view.rerender(<Notifier />)) }
}

describe('the notifier', () => {
  test('what waits on the person is told once new, the first read being what already waited; a click opens the run', async () => {
    const { host, waiting } = render()
    waiting('fresh', [question('r1')])
    await waitFor(() => expect(callComputer).toHaveBeenCalledWith('kinds', {}))
    waiting('fresh', [question('r1'), question('r2')])
    await waitFor(() => expect(made.map(each => each.title)).toEqual(['Human Queue · p']))
    made[0]!.click()
    expect(host.openAgent).toHaveBeenCalledWith('p', 'r2')
  })

  test('a read stored by an earlier visit is not what already waited: what came since is not told as the page opens', async () => {
    // The page opens on what an earlier visit read: nothing waited then.
    shell.state = 'kept'
    const { waiting } = render()
    await waitFor(() => expect(callComputer).toHaveBeenCalled())
    // The page's first fresh read: a question asked while the page was closed.
    waiting('fresh', [question('r1')])
    await act(async () => {})
    expect(made).toEqual([])
    waiting('fresh', [question('r1'), question('r2')])
    await waitFor(() => expect(made.map(each => each.title)).toEqual(['Human Queue · p']))
  })

  test('with the Human Queue switched off, nothing is told', async () => {
    kinds = { waiting: false, activity: false }
    const { waiting } = render()
    await waitFor(() => expect(callComputer).toHaveBeenCalled())
    waiting('fresh', [question('r1')])
    await act(async () => {})
    expect(made).toEqual([])
  })

  test('the runs are not read while New activity is off; on, a run that starts is told', async () => {
    const activity = vi.fn(async (): Promise<ProjectionRead<ActivityItem>> => ({ items: [], whole: ['p'] }))
    const off = render({ activity })
    await waitFor(() => expect(callComputer).toHaveBeenCalled())
    await act(async () => {})
    expect(activity).not.toHaveBeenCalled()
    off.waiting('fresh', [])
    cleanup()
    forgetKinds()

    kinds = { waiting: true, activity: true }
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
    try {
      render({ activity })
      await act(async () => vi.advanceTimersByTimeAsync(0))
      expect(activity).toHaveBeenCalledTimes(1)
      activity.mockResolvedValue({ items: [{ kind: 'started', agentId: 'r3', title: 'Add a cart', projectId: 'p', projectName: 'p' }], whole: ['p'] })
      await act(async () => vi.advanceTimersByTimeAsync(15_000))
      expect(made.map(each => each.title)).toEqual(['Agent started · p'])
    } finally {
      vi.useRealTimers()
    }
  })
})
