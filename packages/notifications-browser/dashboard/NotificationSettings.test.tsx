import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import type { ModuleCallResult } from '@openagt/ui/module'
import { fakeHost, renderWithHost } from '@openagt/ui/module/testing'
import type { Kinds } from '../src/kinds.js'
import { forgetKinds } from './kinds.js'
import { NotificationSettings } from './NotificationSettings.js'

// The package's server part as a test answers it: the person's kinds.
let kinds: Kinds
let answers: Record<string, (input: Record<string, unknown>) => ModuleCallResult>
const callComputer = vi.fn(async (name: string, input: object): Promise<ModuleCallResult> => (answers[name] ?? (() => ({ ok: false, error: `no ${name} here` })))(input as Record<string, unknown>))
const sent = (name: string) => callComputer.mock.calls.filter(([called]) => called === name).map(([, input]) => input)
const render = () => renderWithHost(<NotificationSettings />, fakeHost('@openagt/notifications-browser', { callComputer }))
const toggle = (label: string) => screen.getByRole('switch', { name: label })
const on = (label: string) => toggle(label).getAttribute('aria-checked') === 'true'

/** A browser that has not been asked yet, and answers `answer` when it is. */
const unasked = (answer: NotificationPermission) => {
  const stub = { permission: 'default' as NotificationPermission, requestPermission: vi.fn(async () => (stub.permission = answer)) }
  vi.stubGlobal('Notification', stub)
  return stub
}

beforeEach(() => {
  kinds = { waiting: true, activity: false }
  answers = {
    kinds: () => ({ ok: true, output: kinds }),
    saveKind: input => ((kinds = { ...kinds, [String(input['kind'])]: input['on'] === true }), { ok: true, output: kinds }),
  }
  callComputer.mockClear()
})
afterEach(() => {
  cleanup()
  forgetKinds()
  vi.unstubAllGlobals()
})

describe('Settings › Notifications', () => {
  test('a browser not asked yet: Allow asks it, and once it allows them the row says so', async () => {
    const browser = unasked('granted')
    render()
    expect(screen.getByText('Not allowed yet: the browser asks once you press Allow.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
    expect(browser.requestPermission).toHaveBeenCalled()
    expect(await screen.findByText('Allowed: notifications show while the dashboard is open.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull()
  })

  test("each kind is the person's switch, as saved, and switching it saves it at once; while the browser shows none, it says so", async () => {
    unasked('default')
    render()
    await waitFor(() => expect(on('Human Queue')).toBe(true))
    expect(on('New activity')).toBe(false)
    expect(screen.getByText('An agent starts or finishes. Sent once this browser allows them.')).toBeTruthy()
    fireEvent.click(toggle('New activity'))
    await waitFor(() => expect(on('New activity')).toBe(true))
    expect(sent('saveKind')).toEqual([{ kind: 'activity', on: true }])
  })

  test('a browser that blocked them: said, and nothing to press', async () => {
    vi.stubGlobal('Notification', { permission: 'denied' })
    render()
    expect(screen.getByText('Blocked in your browser settings')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull()
    expect(await screen.findByText('An agent awaiting your answer, or a PR ready to review. This browser shows none.')).toBeTruthy()
  })

  test('a browser with no notifications says so', () => {
    vi.stubGlobal('Notification', undefined)
    render()
    expect(screen.getByText('Not supported by this browser')).toBeTruthy()
  })

  test('a switch that could not be saved says why, and stays as it was', async () => {
    vi.stubGlobal('Notification', { permission: 'granted' })
    answers['saveKind'] = () => ({ ok: false, error: 'The settings could not be written.' })
    render()
    await waitFor(() => expect(on('Human Queue')).toBe(true))
    expect(screen.getByText('An agent awaiting your answer, or a PR ready to review.')).toBeTruthy()
    fireEvent.click(toggle('Human Queue'))
    expect((await screen.findByRole('alert')).textContent).toBe('The settings could not be written.')
    expect(on('Human Queue')).toBe(true)
  })
})
