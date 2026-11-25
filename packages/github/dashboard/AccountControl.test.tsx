import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { forgetRemembered, type ModuleCallResult, type UiComposerControlProps, type UiControlSaid } from '@openagt/ui/module'
import { GearMenu, fakeHost, gear, openMenu, openSetupLine, renderWithHost, setupLine } from '@openagt/ui/module/testing'
import type { RunOptions } from '@openagt/hooks'
import type { AccountsRead } from './calls.js'
import { AccountControl } from './AccountControl.js'

// The GitHub account a run works as, a line of the gear's menu under the message box
// (`composer.control` at `setup`), its module's calls as a test answers them: in the launcher the
// account every next run works as, in a session the one its record keeps, in a profile's editor
// the profile's.

const ACCOUNTS: AccountsRead = {
  host: 'github.com',
  name: 'GitHub',
  requestWord: 'pull request',
  logo: '<svg/>',
  tool: 'gh',
  installed: true,
  accounts: [
    { login: 'octo', runs: true, ok: true, avatar: 'https://avatars.example/octo' },
    { login: 'octo-agent', runs: false, ok: true, avatar: '' },
  ],
  projects: ['shop'],
}

let accounts: AccountsRead = ACCOUNTS
let onGithub = true
let picked: { login?: string } = {}
const picks = vi.fn()
const call = vi.fn(async (_projectId: string, name: string, input: object): Promise<ModuleCallResult> => {
  if (name === 'accounts') return { ok: true, output: accounts }
  if (name === 'where') return { ok: true, output: { project: true, github: onGithub } }
  if (name === 'picked') return { ok: true, output: picked }
  if (name === 'pick') return picks(input), (picked = input as { login?: string }), { ok: true, output: { ok: true } }
  if (name === 'login') return { ok: true, output: { ok: true, code: 'ABCD-1234', url: 'https://github.com/login/device' } }
  if (name === 'stopLogin') return { ok: true, output: { ok: true } }
  return { ok: false, error: `no ${name} here` }
})
const host = fakeHost('@openagt/github', { call })

beforeEach(() => {
  accounts = ACCOUNTS
  onGithub = true
  picked = {}
  picks.mockReset()
})
afterEach(() => {
  cleanup()
  forgetRemembered()
  call.mockClear()
})

/** The control in the gear, as a box draws it (a line is drawn only inside the gear's open menu): what it says of itself is kept in `told`. */
function renderControl(over: Partial<UiComposerControlProps> = {}) {
  const told: { said?: UiControlSaid | undefined } = {}
  const onChange = vi.fn()
  const props: UiComposerControlProps = { in: 'launcher', projectId: 'p1', options: {}, onChange, busy: false, say: said => void (told.said = said), ...over }
  const view = renderWithHost(<GearMenu lines={<AccountControl {...props} />} />, host)
  return { told, onChange, props, ...view }
}

/** A line's words as a screen reader hears them: without the account's picture, or the letter in its place. */
const heard = (line: HTMLElement): string => {
  const copy = line.cloneNode(true) as HTMLElement
  for (const hidden of copy.querySelectorAll('[aria-hidden]')) hidden.remove()
  return copy.textContent ?? ''
}

describe("the launcher's account", () => {
  test('the account runs use, until another is picked for every next session; its pick is saved', async () => {
    const { told } = renderControl()
    const line = await openSetupLine('GitHub account')
    expect(heard(line)).toBe('GitHub account: @octo')
    expect(line.querySelector('img')?.getAttribute('src')).toBe('https://avatars.example/octo')
    expect(told.said).toEqual({ words: '@octo' })
    expect(screen.getByText('GitHub account for every next session')).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: '@octo-agent' }))
    await waitFor(() => expect(picks).toHaveBeenCalledWith({ login: 'octo-agent' }))
    await waitFor(() => expect(told.said).toEqual({ words: '@octo-agent' }))
  })

  test('a pick the computer no longer has is the account runs use again', async () => {
    picked = { login: 'gone' }
    const { told } = renderControl()
    expect(heard(await setupLine('GitHub account'))).toBe('GitHub account: @octo')
    await waitFor(() => expect(told.said).toEqual({ words: '@octo' }))
  })

  test("no account: the line says so, as a warning, and its press opens the dialog that adds one; gh not installed says that", async () => {
    accounts = { ...ACCOUNTS, accounts: [] }
    const { told, unmount } = renderControl()
    const line = await setupLine('GitHub account')
    expect(heard(line)).toBe('GitHub account: Add one…')
    expect(told.said).toEqual({ words: 'no GitHub account', warn: true })
    expect(line.getAttribute('aria-haspopup')).toBeNull()
    fireEvent.click(line)
    expect(await screen.findByRole('dialog', { name: 'Add a GitHub account' })).toBeTruthy()
    unmount()
    forgetRemembered()
    accounts = { ...ACCOUNTS, installed: false, accounts: [] }
    const missingTool = renderControl()
    expect(heard(await setupLine('GitHub account'))).toBe('GitHub account: gh not installed')
    expect(missingTool.told.said).toEqual({ words: 'gh not installed', warn: true })
  })

  test('a project not on GitHub has no line, and nothing is said of it', async () => {
    onGithub = false
    const { told } = renderControl()
    await openMenu(gear())
    await waitFor(() => expect(call).toHaveBeenCalledWith('p1', 'where', {}))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(screen.queryByText(/GitHub account/)).toBeNull()
    expect(told.said).toBeUndefined()
  })
})

describe("a session's account", () => {
  test('the account its record keeps, said and not offered; a record that kept none says so', async () => {
    const { told, unmount } = renderControl({ in: 'session', agentId: 'run-1', options: { github: { account: 'octo-agent' } } })
    expect(heard(await setupLine('GitHub account'))).toBe('GitHub account: @octo-agent. This run works as @octo-agent on GitHub')
    expect(told.said).toEqual({ words: '@octo-agent' })
    unmount()
    const none = renderControl({ in: 'session', agentId: 'run-1', options: {} })
    expect(heard(await setupLine('GitHub account'))).toBe('GitHub account: Not recorded. This project is on GitHub')
    expect(none.told.said).toBeUndefined()
  })
})

describe("a profile's account", () => {
  test("none until one is picked, whatever the computer uses; a pick is the profile's, none takes it out again; one the computer no longer has stays named", async () => {
    const onChange = vi.fn<(options: RunOptions) => void>()
    const { told, rerender, props } = renderControl({ in: 'profile', onChange })
    expect(heard(await openSetupLine('GitHub account'))).toBe('GitHub account: None')
    expect(told.said).toEqual({ words: 'GitHub: whatever the computer uses' })
    expect(screen.getByRole('menuitem', { name: /None — whatever the computer uses/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: '@octo-agent' }))
    expect(onChange).toHaveBeenLastCalledWith({ github: { account: 'octo-agent' } })
    expect(picks).not.toHaveBeenCalled()
    // The pick shuts the menu; it opens again once it has.
    await waitFor(() => expect(screen.queryAllByRole('menuitem')).toEqual([]))
    const named = { ...props, options: { github: { account: 'gone', prBase: 'main' } } }
    rerender(<GearMenu lines={<AccountControl {...named} />} />)
    expect(heard(await openSetupLine('GitHub account'))).toBe('GitHub account: @gone')
    expect(told.said).toEqual({ words: '@gone on GitHub' })
    expect(screen.getByRole('menuitem', { name: '@gone' })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: /None — whatever the computer uses/ }))
    expect(onChange).toHaveBeenLastCalledWith({ github: { prBase: 'main' } })
  })
})
