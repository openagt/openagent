import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { ModuleCallResult } from '@openagt/ui/module'
import { fakeHost, renderWithHost } from '@openagt/ui/module/testing'
import type { BridgeView } from '../src/server.js'
import { ClaudeWebSettings } from './ClaudeWebSettings.js'

// Settings › Claude web, as the plugin's server part answers it: where the bridge stands, which
// browser does the extension's work, and the token a person pastes into their own Chrome.

afterEach(cleanup)

const checked = (control: HTMLElement) => control.getAttribute('aria-checked') === 'true'

const FOLDER = '/home/me/openagent/packages/host-claude-web/extension/'
const BRIDGE: BridgeView = { browser: 'yours', browserState: { state: 'off' }, folder: FOLDER, questions: 0 }

/** The entry, its server part answering with `view` (a pick saved changes it) and the token `tok-1`. What was asked is the spy's. */
function shown(view: Partial<BridgeView> = {}) {
  let current: BridgeView = { ...BRIDGE, ...view }
  const callComputer = vi.fn(async (name: string, input: object): Promise<ModuleCallResult> => {
    if (name === 'bridge') return { ok: true, output: current }
    if (name === 'token') return { ok: true, output: 'tok-1' }
    if (name === 'pickBrowser') current = { ...current, browser: (input as { browser: BridgeView['browser'] }).browser }
    return ['pickBrowser', 'browserAction'].includes(name) ? { ok: true, output: undefined } : { ok: false, error: `no ${name} in this test` }
  })
  renderWithHost(<ClaudeWebSettings />, fakeHost('@openagt/host-claude-web', { callComputer }))
  return (name: string) => callComputer.mock.calls.filter(([called]) => called === name).map(([, input]) => input)
}

describe('which browser does the work (#1332)', () => {
  test('one choice, named by the question: the browser OpenAgent runs carries its state, the token belongs to the other', async () => {
    // "Browser bridge" and "Bridge browser" as two switches read as anagrams of each other; the
    // real decision is which browser drives claude.ai, so it is presented as exactly that.
    shown({ browser: 'app' })
    const app = await screen.findByRole('radio', { name: 'A browser OpenAgent runs' })
    const own = screen.getByRole('radio', { name: 'Your own Chrome' })
    expect(within(screen.getByRole('radiogroup', { name: 'Which browser does the work?' })).getAllByRole('radio')).toEqual([app, own])
    expect([checked(app), checked(own)]).toEqual([true, false])
    expect(screen.getByText('The browser is off.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Reveal' })).toBeNull()
  })

  test('picking the other saves it, by the radio or by its words, and what each needs follows the pick', async () => {
    const asked = shown({ browser: 'app' })
    fireEvent.click(await screen.findByRole('radio', { name: 'Your own Chrome' }))
    expect(asked('pickBrowser')).toEqual([{ browser: 'yours' }])
    expect(checked(screen.getByRole('radio', { name: 'Your own Chrome' }))).toBe(true)
    expect(screen.queryByText('The browser is off.')).toBeNull()
    expect(screen.getByRole('button', { name: 'Reveal' })).toBeTruthy()
    // The words are the radio's label: a click on them picks it too.
    fireEvent.click(screen.getByText('A browser OpenAgent runs'))
    expect(asked('pickBrowser')).toEqual([{ browser: 'yours' }, { browser: 'app' }])
    expect(checked(screen.getByRole('radio', { name: 'A browser OpenAgent runs' }))).toBe(true)
  })
})

describe('your own Chrome (#1237)', () => {
  test('the folder the extension is loaded from, with how, and a press that copies it', async () => {
    shown()
    expect(await screen.findByText(FOLDER)).toBeTruthy()
    expect(screen.getByText(/press Load unpacked and pick this folder/).textContent).toContain('chrome://extensions')
    expect(screen.getByRole('button', { name: 'Copy the folder' })).toBeTruthy()
  })

  test('the token shows on request, read only then, and hides again', async () => {
    // A secret on screen for good is in every screen recording.
    const asked = shown()
    fireEvent.click(await screen.findByRole('button', { name: 'Reveal' }))
    expect(await screen.findByText('tok-1')).toBeTruthy()
    expect(asked('token')).toEqual([{}])
    expect(screen.getByRole('button', { name: 'Copy the bridge token' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }))
    expect(screen.queryByText('tok-1')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Reveal' }))
    expect(screen.getByText('tok-1')).toBeTruthy()
    expect(asked('token')).toEqual([{}])
  })
})

describe('what the bridge refused (#1519, #1225)', () => {
  const VERSION = { got: '0.12.0', expected: '0.13.0', at: '2026-11-19T12:00:00.000Z' }

  test('an extension of another version is named, with both versions and the way out', async () => {
    // Without this line the block is invisible here: the bridge just looks disconnected, which
    // after a pull is exactly the wrong diagnosis to hand someone.
    shown({ version: { ...VERSION, blocked: true } })
    const notice = await screen.findByRole('alert')
    expect(notice.textContent).toContain('v0.12.0')
    expect(notice.textContent).toContain('v0.13.0')
    expect(notice.textContent).toContain('chrome://extensions')
  })

  test('calls with a token the bridge does not know are named, with the way out', async () => {
    // A refused token dies before the version is read, so this is the only sign something is trying.
    shown({ lastContact: { at: VERSION.at, route: '/_bridge/sessions', status: 401 } })
    const notice = await screen.findByRole('alert')
    expect(notice.textContent).toContain('a token OpenAgent does not know')
    expect(notice.textContent).toContain('save the token')
  })

  test('a version block outranks a refused token the same extension left behind: one cure at a time', async () => {
    shown({ version: { ...VERSION, blocked: true }, lastContact: { at: VERSION.at, route: '/_bridge/sessions', status: 401 } })
    expect((await screen.findByRole('alert')).textContent).toContain('blocked')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })

  test('an accepted version and token say nothing', async () => {
    shown({ version: { ...VERSION, expected: '0.12.0', blocked: false }, lastContact: { at: VERSION.at, route: '/_bridge/sessions', status: 200 } })
    await screen.findByRole('radiogroup')
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('the browser OpenAgent runs (#1332)', () => {
  test('a start under way names its step, so a minutes-long download is not a hang', async () => {
    shown({ browser: 'app', browserState: { state: 'starting', detail: 'downloading Chrome for Testing 150: 42%' } })
    expect((await screen.findByText(/Starting the browser/)).textContent).toContain('42%')
  })

  test('on the sign-in page it asks for the one thing only a person can do', async () => {
    const asked = shown({ browser: 'app', browserState: { state: 'running', since: '2026-11-19T12:00:00.000Z', visible: false, signIn: true } })
    fireEvent.click(await screen.findByRole('button', { name: 'Show the window to sign in' }))
    expect(screen.getByText(/sign in once/)).toBeTruthy()
    await waitFor(() => expect(asked('browserAction')).toEqual([{ action: 'show' }]))
  })

  test('a shown window offers to hide it; a signed-in browser asks for no sign-in', async () => {
    const asked = shown({ browser: 'app', browserState: { state: 'running', since: '2026-11-19T12:00:00.000Z', visible: true, signIn: false } })
    fireEvent.click(await screen.findByRole('button', { name: 'Hide the window' }))
    expect(screen.queryByText(/sign in once/)).toBeNull()
    await waitFor(() => expect(asked('browserAction')).toEqual([{ action: 'hide' }]))
  })

  test('one that stopped says why and offers a restart, since quitting it was an act', async () => {
    const asked = shown({ browser: 'app', browserState: { state: 'stopped', detail: 'Chrome exited on SIGTERM' } })
    expect((await screen.findByText(/The browser is not running/)).textContent).toContain('Chrome exited on SIGTERM')
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }))
    await waitFor(() => expect(asked('browserAction')).toEqual([{ action: 'restart' }]))
  })
})
