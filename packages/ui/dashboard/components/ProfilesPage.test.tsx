import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { forgetRemembered } from '../lib/use-async.js'
import { DaemonDown } from '../lib/use-daemon-health.js'

const rpc = vi.hoisted(() => ({ onProfilesList: vi.fn(), sendSaveProfile: vi.fn(), sendRemoveProfile: vi.fn() }))
vi.mock('../rpc/profiles.js', () => rpc)
const logins = vi.hoisted(() => ({ onGitHosts: vi.fn(), sendGitHostLogin: vi.fn(), sendStopGitHostLogin: vi.fn(), sendGitHostInstall: vi.fn(), onAgentState: vi.fn(), sendAgentFix: vi.fn() }))
vi.mock('../rpc/logins.js', () => logins)
const route = vi.hoisted(() => ({ openPage: vi.fn() }))
vi.mock('../lib/host-services.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/host-services.js')>()
  return { ...actual, INERT_HOST_SERVICES: { ...actual.INERT_HOST_SERVICES, ...route } }
})
// The tooltip's words are on the page.
vi.mock('./ui/tooltip.js', async () => {
  const { cloneElement } = await import('react')
  return {
    Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    TooltipTrigger: ({ render: trigger, children }: { render: React.ReactElement; children: React.ReactNode }) => cloneElement(trigger, {} as never, children),
    TooltipContent: ({ children }: { children: React.ReactNode }) => <span role="tooltip">{children}</span>,
  }
})

const { ProfilesPage } = await import('./ProfilesPage.js')
const { ProfileMenu } = await import('./ProfileMenu.js')

const DEFAULT = { id: 'default', name: 'Default', options: {} }
const REVIEWER = { id: 'reviewer', name: 'Reviewer', options: { github: { account: 'octo-agent' }, 'agent-driver': { claude: ['Dani'] }, skills: { project: 'none' as const } } }
const VIEW = {
  profiles: [DEFAULT, REVIEWER],
  github: { host: 'github.com', accounts: ['octo', 'octo-agent'] },
  claude: [{ id: 'This computer', name: 'Claude login on Studio' }, { id: 'Dani', name: 'Dani' }],
  codex: [],
  plugins: ['ask', 'logs', 'tickets'],
}

beforeEach(() => {
  rpc.onProfilesList.mockResolvedValue(VIEW)
  rpc.sendSaveProfile.mockResolvedValue({ ok: true, id: 'social' })
  rpc.sendRemoveProfile.mockResolvedValue({ ok: true })
})

afterEach(() => {
  cleanup()
  forgetRemembered()
  for (const fn of [...Object.values(rpc), ...Object.values(logins)]) fn.mockReset()
  route.openPage.mockReset()
})

/** "New profile", once the profiles are read: before, it is there and takes no press. */
async function newProfilePress(): Promise<HTMLElement> {
  const press = await screen.findByRole('button', { name: 'New profile' })
  await waitFor(() => expect((press as HTMLButtonElement).disabled).toBe(false))
  return press
}

/** The profiles' rows, top to bottom, without what is said under one; `hidden`, also while a dialog over the page hides them. */
async function profileRows(hidden = false): Promise<HTMLElement[]> {
  const list = await screen.findByRole('list', { name: 'Profiles', hidden })
  return within(list).getAllByRole('listitem', { hidden }).filter(item => item.parentElement === list && item.classList.contains('group/row'))
}

describe('the Profiles page', () => {
  test("while the profiles are first read, rows' shapes stand where the profiles will, and the profiles take their place", async () => {
    let answer = () => {}
    rpc.onProfilesList.mockImplementationOnce(() => new Promise(resolve => (answer = () => resolve(VIEW))))
    render(<ProfilesPage />)
    expect(screen.getByRole('status').textContent).toBe('Loading…')
    answer()
    expect(await profileRows()).toHaveLength(2)
    expect(screen.queryByText('Loading…')).toBeNull()
  })

  test('one row per profile, Default first and marked; each with the accounts its runs work as, the computer’s where it names none, and the project skills they get', async () => {
    render(<ProfilesPage />)
    const rows = await profileRows()
    expect(rows.map(row => row.querySelector('.font-medium')?.firstChild?.textContent)).toEqual(['Default', 'Reviewer'])
    expect(within(rows[0]!).getByText(/used unless you pick another/)).toBeTruthy()
    // Under the name, its facts with a dot between them.
    const facts = (row: HTMLElement) => row.querySelector('.text-faint-foreground')?.textContent
    expect(facts(rows[0]!)).toBe('GitHub: whatever the computer uses·Every project skill')
    // A profile set to never pick up the project's own skills says so; Default does not.
    expect(facts(rows[1]!)).toBe('@octo-agent on GitHub·Claude: Dani·No project skills')
    // Default is never removed.
    expect(within(rows[0]!).queryByRole('button', { name: 'Remove Default' })).toBeNull()
    expect(within(rows[1]!).getByRole('button', { name: 'Remove Reviewer' })).toBeTruthy()
  })

  test('a profile that leaves plugins out says which; its editor has them ticked off, and one ticked on again is no longer left out', async () => {
    rpc.onProfilesList.mockResolvedValue({ ...VIEW, profiles: [DEFAULT, { ...REVIEWER, options: { ...REVIEWER.options, plugins: { without: ['logs', 'tickets'] } } }] })
    render(<ProfilesPage />)
    const rows = await profileRows()
    expect(rows[1]!.querySelector('.text-faint-foreground')?.textContent).toBe('@octo-agent on GitHub·Claude: Dani·Without logs and tickets·No project skills')
    fireEvent.click(screen.getByRole('button', { name: 'Edit Reviewer' }))
    const editor = screen.getByRole('dialog', { name: 'Editing Reviewer' })
    expect(['ask', 'logs', 'tickets'].map(name => within(editor).getByRole('checkbox', { name: `Plugin ${name}` }).getAttribute('aria-checked'))).toEqual(['true', 'false', 'false'])
    expect(within(editor).getByText(/Its sessions go without logs and tickets/)).toBeTruthy()
    fireEvent.click(within(editor).getByRole('checkbox', { name: 'Plugin logs' }))
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(rpc.sendSaveProfile).toHaveBeenCalledWith({ id: 'reviewer', name: 'Reviewer', options: { ...REVIEWER.options, plugins: { without: ['tickets'] } } }))
  })

  test('a new profile: its name, typed at once, its accounts picked, every plugin and every project skill ticked already; saved as the dashboard’s call, and the list read again', async () => {
    render(<ProfilesPage />)
    fireEvent.click(await newProfilePress())
    const editor = screen.getByRole('dialog', { name: 'New profile' })
    // What is typed first goes to the name.
    await waitFor(() => expect(document.activeElement).toBe(within(editor).getByLabelText('Name')))
    expect(within(editor).getByRole('checkbox', { name: 'Project skills' }).getAttribute('aria-checked')).toBe('true')
    expect(within(editor).getAllByRole('checkbox', { name: /^Plugin / }).map(tick => tick.getAttribute('aria-checked'))).toEqual(['true', 'true', 'true'])
    fireEvent.change(within(editor).getByLabelText('Name'), { target: { value: 'Social Media' } })
    fireEvent.click(within(editor).getByLabelText('Claude account Dani'))
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(rpc.sendSaveProfile).toHaveBeenCalledWith({ name: 'Social Media', options: { 'agent-driver': { claude: ['Dani'] } } }))
    await waitFor(() => expect(rpc.onProfilesList).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('dialog', { name: 'New profile' })).toBeNull()
  })

  test('after a new profile is saved, the focus goes to its row’s Edit once the list is read with it', async () => {
    render(<ProfilesPage />)
    fireEvent.click(await newProfilePress())
    fireEvent.change(within(screen.getByRole('dialog', { name: 'New profile' })).getByLabelText('Name'), { target: { value: 'Social' } })
    rpc.onProfilesList.mockResolvedValue({ ...VIEW, profiles: [...VIEW.profiles, { id: 'social', name: 'Social', options: {} }] })
    fireEvent.click(within(screen.getByRole('dialog', { name: 'New profile' })).getByRole('button', { name: 'Save' }))
    const edit = await screen.findByRole('button', { name: 'Edit Social' })
    await waitFor(() => expect(document.activeElement).toBe(edit))
  })

  test('the editor is a form: Enter in the name saves; with no name, Save says what it needs under the field and saves nothing', async () => {
    render(<ProfilesPage />)
    fireEvent.click(await newProfilePress())
    const editor = screen.getByRole('dialog', { name: 'New profile' })
    const name = within(editor).getByLabelText('Name') as HTMLInputElement
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    expect(name.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(name.getAttribute('aria-describedby')!)!.textContent).toBe('Give the profile a name.')
    expect(rpc.sendSaveProfile).not.toHaveBeenCalled()
    fireEvent.change(name, { target: { value: 'Social media' } })
    expect(name.getAttribute('aria-invalid')).toBe('false')
    fireEvent.submit(name.form!)
    await waitFor(() => expect(rpc.sendSaveProfile).toHaveBeenCalledWith(expect.objectContaining({ name: 'Social media' })))
  })

  test('a name OpenAgent refuses marks the field with the refusal; a refusal of something else leaves the field alone, and typing clears it; while it saves, the field and Save keep the focus, and Save sends nothing more', async () => {
    let refuse = (_outcome: unknown) => {}
    rpc.sendSaveProfile.mockReturnValue(new Promise(resolve => (refuse = resolve)))
    render(<ProfilesPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'New profile' }))
    const editor = screen.getByRole('dialog', { name: 'New profile' })
    const name = within(editor).getByLabelText('Name') as HTMLInputElement
    fireEvent.change(name, { target: { value: 'Default!' } })
    name.focus()
    fireEvent.submit(name.form!)
    const save = (await within(editor).findByRole('button', { name: 'Saving…' })) as HTMLButtonElement
    expect([name.disabled, name.readOnly, save.disabled, save.getAttribute('aria-disabled')]).toEqual([false, true, false, 'true'])
    fireEvent.click(save)
    expect(rpc.sendSaveProfile).toHaveBeenCalledTimes(1)
    refuse({ ok: false, error: 'There is a profile Default already: pick another name.', field: 'name' })
    await waitFor(() => expect(name.getAttribute('aria-invalid')).toBe('true'))
    expect(document.activeElement).toBe(name)
    expect(document.getElementById(name.getAttribute('aria-describedby')!)!.textContent).toBe('There is a profile Default already: pick another name.')
    fireEvent.change(name, { target: { value: 'Defaults' } })
    expect(name.getAttribute('aria-invalid')).toBe('false')
    rpc.sendSaveProfile.mockResolvedValue({ ok: false, error: 'OpenAgent has no GitHub account stranger on this computer.' })
    fireEvent.submit(name.form!)
    await screen.findByText('OpenAgent has no GitHub account stranger on this computer.')
    expect(name.getAttribute('aria-invalid')).toBe('false')
  })

  test('Cancel, Esc or the ✕ on an editor with something changed asks first: Cancel there keeps what was typed, Discard closes it; with nothing changed it closes at once', async () => {
    render(<ProfilesPage />)
    fireEvent.click(await newProfilePress())
    const editor = screen.getByRole('dialog', { name: 'New profile' })
    fireEvent.change(within(editor).getByLabelText('Name'), { target: { value: 'Reviewer two' } })
    fireEvent.keyDown(within(editor).getByLabelText('Name'), { key: 'Escape' })
    const asked = await screen.findByRole('alertdialog', { name: 'Discard the new profile?' })
    fireEvent.click(within(asked).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect((within(screen.getByRole('dialog', { name: 'New profile' })).getByLabelText('Name') as HTMLInputElement).value).toBe('Reviewer two')
    fireEvent.click(within(screen.getByRole('dialog', { name: 'New profile' })).getByRole('button', { name: 'Cancel' }))
    fireEvent.click(within(await screen.findByRole('alertdialog', { name: 'Discard the new profile?' })).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    fireEvent.click(within(screen.getByRole('dialog', { name: 'New profile' })).getByRole('button', { name: 'Close' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New profile' })).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Edit Reviewer' }))
    fireEvent.keyDown(within(screen.getByRole('dialog', { name: 'Editing Reviewer' })).getByLabelText('Name'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(rpc.sendSaveProfile).not.toHaveBeenCalled()
  })

  test('Back or a reload with a name typed asks first, and the address stays: Cancel keeps the name, Discard goes back and holds nothing more', async () => {
    window.history.replaceState(null, '', '/permissions')
    window.history.pushState(null, '', '/profiles')
    const { useRoute } = await vi.importActual<typeof import('../lib/use-route.js')>('../lib/use-route.js')
    const { NO_PROJECTS } = await import('../../src/project-address.js')
    // The app's route, which follows Back.
    const Routed = () => (useRoute(NO_PROJECTS), null)
    render(<><Routed /><ProfilesPage /></>)
    const back = async () => {
      const popped = new Promise(resolve => window.addEventListener('popstate', resolve, { once: true }))
      window.history.back()
      await act(async () => void (await popped))
    }
    fireEvent.click(await newProfilePress())
    fireEvent.change(within(screen.getByRole('dialog', { name: 'New profile' })).getByLabelText('Name'), { target: { value: 'Backtest' } })
    const reload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(reload)
    expect(reload.defaultPrevented).toBe(true)
    await back()
    const asked = await screen.findByRole('alertdialog', { name: 'Discard the new profile?' })
    await waitFor(() => expect(window.location.pathname).toBe('/profiles'))
    fireEvent.click(within(asked).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect((within(screen.getByRole('dialog', { name: 'New profile' })).getByLabelText('Name') as HTMLInputElement).value).toBe('Backtest')
    await back()
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(window.location.pathname).toBe('/permissions'))
    const after = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(after)
    expect(after.defaultPrevented).toBe(false)
  })

  test('with OpenAgent not answering after a name is typed, Discard still closes the editor: it sends nothing', async () => {
    const page = render(<DaemonDown.Provider value={false}><ProfilesPage /></DaemonDown.Provider>)
    fireEvent.click(await newProfilePress())
    fireEvent.change(within(screen.getByRole('dialog', { name: 'New profile' })).getByLabelText('Name'), { target: { value: 'Offline draft' } })
    page.rerender(<DaemonDown.Provider value={true}><ProfilesPage /></DaemonDown.Provider>)
    fireEvent.click(within(screen.getByRole('dialog', { name: 'New profile' })).getByRole('button', { name: 'Close' }))
    const discard = within(await screen.findByRole('alertdialog', { name: 'Discard the new profile?' })).getByRole('button', { name: 'Discard' }) as HTMLButtonElement
    expect(discard.disabled).toBe(false)
    fireEvent.click(discard)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New profile' })).toBeNull())
    expect(rpc.sendSaveProfile).not.toHaveBeenCalled()
  })

  test('a profile edited in place keeps its id; a refusal is said under the editor and nothing closes', async () => {
    rpc.sendSaveProfile.mockResolvedValue({ ok: false, error: 'OpenAgent has no GitHub account stranger on this computer.' })
    render(<ProfilesPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Reviewer' }))
    const editor = screen.getByRole('dialog', { name: 'Editing Reviewer' })
    // Its project-skills tick is off as its record says; ticked on, the save says so.
    expect(within(editor).getByRole('checkbox', { name: 'Project skills' }).getAttribute('aria-checked')).toBe('false')
    fireEvent.click(within(editor).getByRole('checkbox', { name: 'Project skills' }))
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(rpc.sendSaveProfile).toHaveBeenCalledWith({ id: 'reviewer', name: 'Reviewer', options: { github: { account: 'octo-agent' }, 'agent-driver': { claude: ['Dani'] } } }))
    expect((await within(editor).findByRole('alert')).textContent).toContain('no GitHub account stranger')
    // Default's name is not for editing.
    fireEvent.click(within(editor).getByRole('button', { name: 'Cancel' }))
    fireEvent.click(within(await screen.findByRole('alertdialog', { name: 'Discard your changes to Reviewer?' })).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Edit Default' }))
    expect(screen.queryByLabelText('Name')).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Editing Default' }).textContent).toMatch(/Default keeps its name/)
    // A profile that names no account: one plain item, not the computer's account repeated.
    expect(screen.getByLabelText('GitHub account').textContent).toBe('None — whatever the computer uses')
  })

  test('"All" is ticked while no account of a coding agent is picked; ticking one leaves it, ticking "All" again drops the picks', async () => {
    render(<ProfilesPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Reviewer' }))
    const editor = screen.getByRole('dialog', { name: 'Editing Reviewer' })
    const checked = (name: string) => within(editor).getByLabelText(name).getAttribute('aria-checked')
    expect([checked('Every Claude account, also new ones'), checked('Claude account Dani')]).toEqual(['false', 'true'])
    fireEvent.click(within(editor).getByLabelText('Every Claude account, also new ones'))
    expect([checked('Every Claude account, also new ones'), checked('Claude account Dani')]).toEqual(['true', 'false'])
    fireEvent.click(within(editor).getByLabelText('Claude account Claude login on Studio'))
    expect([checked('Every Claude account, also new ones'), checked('Claude account Claude login on Studio')]).toEqual(['false', 'true'])
    fireEvent.click(within(editor).getByLabelText('Every Claude account, also new ones'))
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(rpc.sendSaveProfile).toHaveBeenCalledWith({ id: 'reviewer', name: 'Reviewer', options: { github: { account: 'octo-agent' }, skills: { project: 'none' } } }))
  })

  test('this computer\u2019s own login, logged out, is not offered; a profile that has it picked still shows it, saying it is not logged in', async () => {
    const claude = [{ id: 'This computer', name: 'Claude login on Studio', loggedOut: true }, { id: 'Dani', name: 'Dani' }]
    rpc.onProfilesList.mockResolvedValue({ ...VIEW, profiles: [DEFAULT, { ...REVIEWER, options: { 'agent-driver': { claude: ['This computer'] } } }], claude })
    render(<ProfilesPage />)
    fireEvent.click(await newProfilePress())
    const editor = screen.getByRole('dialog', { name: 'New profile' })
    expect(within(editor).queryByLabelText(/Claude login on Studio/)).toBeNull()
    expect(within(editor).getByLabelText('Claude account Dani')).toBeTruthy()
    fireEvent.click(within(editor).getByRole('button', { name: 'Cancel' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Reviewer' }))
    const edited = screen.getByRole('dialog', { name: 'Editing Reviewer' })
    expect(within(edited).getByLabelText('Claude account Claude login on Studio, not logged in').getAttribute('aria-checked')).toBe('true')
  })

  test('with no GitHub account of OpenAgent\u2019s yet, one is added from the editor, in its dialog, and is then the one picked; what was typed stays', async () => {
    const github = (accounts: string[]) => ({ hosts: [{ host: 'github.com', projects: [], provider: { name: 'GitHub', requestWord: 'pull request', tool: 'gh', installed: true, install: 'brew install gh', accounts: accounts.map(login => ({ login, runs: true, ok: true })) } }] })
    rpc.onProfilesList.mockResolvedValue({ ...VIEW, github: { host: 'github.com', accounts: [] } })
    logins.onGitHosts.mockResolvedValue(github([]))
    logins.sendGitHostLogin.mockResolvedValue({ ok: true, code: 'ABCD-1234', url: 'https://github.com/login/device' })
    logins.sendStopGitHostLogin.mockResolvedValue({ ok: true })
    render(<ProfilesPage />)
    fireEvent.click(await newProfilePress())
    const editor = screen.getByRole('dialog', { name: 'New profile' })
    fireEvent.change(within(editor).getByLabelText('Name'), { target: { value: 'Social media' } })
    expect(within(editor).getByRole('combobox', { name: 'GitHub account' }).textContent).toContain('None')
    fireEvent.click(within(editor).getByRole('button', { name: 'Add account' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add a GitHub account' })
    expect(await within(dialog).findByText('ABCD-1234')).toBeTruthy()
    // Signed in at GitHub: the account is there, and the profiles are read again with it.
    rpc.onProfilesList.mockResolvedValue({ ...VIEW, github: { host: 'github.com', accounts: ['me-agent'] } })
    logins.onGitHosts.mockResolvedValue(github(['me-agent']))
    // The account's dialog closes on it, and the profile's own is still there under it.
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add a GitHub account' })).toBeNull(), { timeout: 6000 })
    const after = screen.getByRole('dialog', { name: 'New profile' })
    expect(within(after).getByRole('combobox', { name: 'GitHub account' }).textContent).toContain('@me-agent')
    expect((within(after).getByLabelText('Name') as HTMLInputElement).value).toBe('Social media')
    fireEvent.click(within(after).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(rpc.sendSaveProfile).toHaveBeenCalledWith(expect.objectContaining({ name: 'Social media', options: { github: { account: 'me-agent' } } })))
  }, 15_000)

  test('the editor is a dialog over the page: the profile\u2019s row stays under it, and a click beside it closes nothing', async () => {
    render(<ProfilesPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Reviewer' }))
    const editor = screen.getByRole('dialog', { name: 'Editing Reviewer' })
    expect((await profileRows(true)).some(row => row.textContent?.startsWith('Reviewer'))).toBe(true)
    // Save and Cancel are the dialog's own presses, outside what scrolls.
    expect(within(editor).getByRole('button', { name: 'Save' })).toBeTruthy()
    fireEvent.change(within(editor).getByLabelText('Name'), { target: { value: 'Reviewer two' } })
    // A press on the dimmed page beside it, as a real pointer makes one.
    const backdrop = document.querySelector('.fixed.inset-0')!
    for (const press of [fireEvent.pointerDown, fireEvent.mouseDown, fireEvent.pointerUp, fireEvent.mouseUp, fireEvent.click]) press(backdrop)
    await new Promise(resolve => setTimeout(resolve, 50))
    expect((within(screen.getByRole('dialog', { name: 'Editing Reviewer' })).getByLabelText('Name') as HTMLInputElement).value).toBe('Reviewer two')
    fireEvent.click(within(editor).getByRole('button', { name: 'Cancel' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(rpc.sendSaveProfile).not.toHaveBeenCalled()
  })

  test('removing a profile asks first, then removes it and reads the list again', async () => {
    render(<ProfilesPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Reviewer' }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(rpc.sendRemoveProfile).toHaveBeenCalledWith('reviewer'))
    await waitFor(() => expect(rpc.onProfilesList).toHaveBeenCalledTimes(2))
  })

  test('the focus a removed profile\u2019s press leaves goes to "New profile"', async () => {
    render(<ProfilesPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Reviewer' }))
    rpc.onProfilesList.mockResolvedValue({ ...VIEW, profiles: [DEFAULT] })
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(screen.queryByText('Reviewer')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'New profile' })))
  })
})

describe('the Profile menu under the box', () => {
  test('the profile picked, by name; another picked is said back; "Manage profiles…" opens the page; nothing until the profiles are read', () => {
    const onPick = vi.fn()
    const { container, rerender } = render(<ProfileMenu profiles={undefined} picked={undefined} busy={false} onPick={onPick} />)
    expect(container.textContent).toBe('')
    rerender(<ProfileMenu profiles={VIEW.profiles} picked={undefined} busy={false} onPick={onPick} />)
    expect(screen.getByRole('button', { name: 'Profile: Default' }).textContent).toBe('Default')
    rerender(<ProfileMenu profiles={VIEW.profiles} picked="reviewer" busy={false} onPick={onPick} />)
    const trigger = screen.getByRole('button', { name: 'Profile: Reviewer' })
    expect(screen.getByRole('tooltip').textContent).toBe('This session is on the profile Reviewer, as @octo-agent on GitHub')
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: /^Default/ }))
    expect(onPick).toHaveBeenCalledWith('default')
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Manage profiles…' }))
    expect(route.openPage).toHaveBeenCalledWith('profiles')
  })
})
