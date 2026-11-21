import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { forgetRemembered } from '../lib/use-async.js'
import { DaemonDown } from '../lib/use-daemon-health.js'

const rpc = vi.hoisted(() => ({ onPresetsList: vi.fn(), sendSavePreset: vi.fn(), sendRemovePreset: vi.fn() }))
vi.mock('../rpc/presets.js', () => rpc)
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

const { PresetsPage } = await import('./PresetsPage.js')
const { PresetMenu } = await import('./PresetMenu.js')

const DEFAULT = { id: 'default', name: 'Default', options: {} }
const REVIEWER = { id: 'reviewer', name: 'Reviewer', options: { github: { account: 'octo-agent' }, 'agent-driver': { claude: ['Dani'] }, skills: { project: 'none' as const } } }
const VIEW = {
  presets: [DEFAULT, REVIEWER],
  github: { host: 'github.com', accounts: ['octo', 'octo-agent'] },
  claude: [{ id: 'This computer', name: 'Claude login on Studio' }, { id: 'Dani', name: 'Dani' }],
  codex: [],
  plugins: ['ask', 'logs', 'tickets'],
}

beforeEach(() => {
  rpc.onPresetsList.mockResolvedValue(VIEW)
  rpc.sendSavePreset.mockResolvedValue({ ok: true, id: 'social' })
  rpc.sendRemovePreset.mockResolvedValue({ ok: true })
})

afterEach(() => {
  cleanup()
  forgetRemembered()
  for (const fn of [...Object.values(rpc), ...Object.values(logins)]) fn.mockReset()
  route.openPage.mockReset()
})

/** "New preset", once the presets are read: before, it is there and takes no press. */
async function newPresetPress(): Promise<HTMLElement> {
  const press = await screen.findByRole('button', { name: 'New preset' })
  await waitFor(() => expect((press as HTMLButtonElement).disabled).toBe(false))
  return press
}

/** The presets' rows, top to bottom, without what is said under one; `hidden`, also while a dialog over the page hides them. */
async function presetRows(hidden = false): Promise<HTMLElement[]> {
  const list = await screen.findByRole('list', { name: 'Presets', hidden })
  return within(list).getAllByRole('listitem', { hidden }).filter(item => item.parentElement === list && item.classList.contains('group/row'))
}

describe('the Presets page', () => {
  test("while the presets are first read, rows' shapes stand where the presets will, and the presets take their place", async () => {
    let answer = () => {}
    rpc.onPresetsList.mockImplementationOnce(() => new Promise(resolve => (answer = () => resolve(VIEW))))
    render(<PresetsPage />)
    expect(screen.getByRole('status').textContent).toBe('Loading…')
    answer()
    expect(await presetRows()).toHaveLength(2)
    expect(screen.queryByText('Loading…')).toBeNull()
  })

  test('one row per preset, Default first and marked; each with the accounts its runs work as, the computer’s where it names none, and the project skills they get', async () => {
    render(<PresetsPage />)
    const rows = await presetRows()
    expect(rows.map(row => row.querySelector('.font-medium')?.firstChild?.textContent)).toEqual(['Default', 'Reviewer'])
    expect(within(rows[0]!).getByText(/used unless you pick another/)).toBeTruthy()
    // Under the name, its facts with a dot between them.
    const facts = (row: HTMLElement) => row.querySelector('.text-faint-foreground')?.textContent
    expect(facts(rows[0]!)).toBe('GitHub: whatever the computer uses·Every project skill')
    // A preset set to never pick up the project's own skills says so; Default does not.
    expect(facts(rows[1]!)).toBe('@octo-agent on GitHub·Claude: Dani·No project skills')
    // Default is never removed.
    expect(within(rows[0]!).queryByRole('button', { name: 'Remove Default' })).toBeNull()
    expect(within(rows[1]!).getByRole('button', { name: 'Remove Reviewer' })).toBeTruthy()
  })

  test('a preset that leaves plugins out says which; its editor has them ticked off, and one ticked on again is no longer left out', async () => {
    rpc.onPresetsList.mockResolvedValue({ ...VIEW, presets: [DEFAULT, { ...REVIEWER, options: { ...REVIEWER.options, plugins: { without: ['logs', 'tickets'] } } }] })
    render(<PresetsPage />)
    const rows = await presetRows()
    expect(rows[1]!.querySelector('.text-faint-foreground')?.textContent).toBe('@octo-agent on GitHub·Claude: Dani·Without logs and tickets·No project skills')
    fireEvent.click(screen.getByRole('button', { name: 'Edit Reviewer' }))
    const editor = screen.getByRole('dialog', { name: 'Editing Reviewer' })
    expect(['ask', 'logs', 'tickets'].map(name => within(editor).getByRole('checkbox', { name: `Plugin ${name}` }).getAttribute('aria-checked'))).toEqual(['true', 'false', 'false'])
    expect(within(editor).getByText(/Its sessions go without logs and tickets/)).toBeTruthy()
    fireEvent.click(within(editor).getByRole('checkbox', { name: 'Plugin logs' }))
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(rpc.sendSavePreset).toHaveBeenCalledWith({ id: 'reviewer', name: 'Reviewer', options: { ...REVIEWER.options, plugins: { without: ['tickets'] } } }))
  })

  test('a new preset: its name, typed at once, its accounts picked, every plugin and every project skill ticked already; saved as the dashboard’s call, and the list read again', async () => {
    render(<PresetsPage />)
    fireEvent.click(await newPresetPress())
    const editor = screen.getByRole('dialog', { name: 'New preset' })
    // What is typed first goes to the name.
    await waitFor(() => expect(document.activeElement).toBe(within(editor).getByLabelText('Name')))
    expect(within(editor).getByRole('checkbox', { name: 'Project skills' }).getAttribute('aria-checked')).toBe('true')
    expect(within(editor).getAllByRole('checkbox', { name: /^Plugin / }).map(tick => tick.getAttribute('aria-checked'))).toEqual(['true', 'true', 'true'])
    fireEvent.change(within(editor).getByLabelText('Name'), { target: { value: 'Social Media' } })
    fireEvent.click(within(editor).getByLabelText('Claude account Dani'))
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(rpc.sendSavePreset).toHaveBeenCalledWith({ name: 'Social Media', options: { 'agent-driver': { claude: ['Dani'] } } }))
    await waitFor(() => expect(rpc.onPresetsList).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('dialog', { name: 'New preset' })).toBeNull()
  })

  test('after a new preset is saved, the focus goes to its row’s Edit once the list is read with it', async () => {
    render(<PresetsPage />)
    fireEvent.click(await newPresetPress())
    fireEvent.change(within(screen.getByRole('dialog', { name: 'New preset' })).getByLabelText('Name'), { target: { value: 'Social' } })
    rpc.onPresetsList.mockResolvedValue({ ...VIEW, presets: [...VIEW.presets, { id: 'social', name: 'Social', options: {} }] })
    fireEvent.click(within(screen.getByRole('dialog', { name: 'New preset' })).getByRole('button', { name: 'Save' }))
    const edit = await screen.findByRole('button', { name: 'Edit Social' })
    await waitFor(() => expect(document.activeElement).toBe(edit))
  })

  test('the editor is a form: Enter in the name saves; with no name, Save says what it needs under the field and saves nothing', async () => {
    render(<PresetsPage />)
    fireEvent.click(await newPresetPress())
    const editor = screen.getByRole('dialog', { name: 'New preset' })
    const name = within(editor).getByLabelText('Name') as HTMLInputElement
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    expect(name.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(name.getAttribute('aria-describedby')!)!.textContent).toBe('Give the preset a name.')
    expect(rpc.sendSavePreset).not.toHaveBeenCalled()
    fireEvent.change(name, { target: { value: 'Social media' } })
    expect(name.getAttribute('aria-invalid')).toBe('false')
    fireEvent.submit(name.form!)
    await waitFor(() => expect(rpc.sendSavePreset).toHaveBeenCalledWith(expect.objectContaining({ name: 'Social media' })))
  })

  test('a name OpenAgent refuses marks the field with the refusal; a refusal of something else leaves the field alone, and typing clears it; while it saves, the field and Save keep the focus, and Save sends nothing more', async () => {
    let refuse = (_outcome: unknown) => {}
    rpc.sendSavePreset.mockReturnValue(new Promise(resolve => (refuse = resolve)))
    render(<PresetsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'New preset' }))
    const editor = screen.getByRole('dialog', { name: 'New preset' })
    const name = within(editor).getByLabelText('Name') as HTMLInputElement
    fireEvent.change(name, { target: { value: 'Default!' } })
    name.focus()
    fireEvent.submit(name.form!)
    const save = (await within(editor).findByRole('button', { name: 'Saving…' })) as HTMLButtonElement
    expect([name.disabled, name.readOnly, save.disabled, save.getAttribute('aria-disabled')]).toEqual([false, true, false, 'true'])
    fireEvent.click(save)
    expect(rpc.sendSavePreset).toHaveBeenCalledTimes(1)
    refuse({ ok: false, error: 'There is a preset Default already: pick another name.', field: 'name' })
    await waitFor(() => expect(name.getAttribute('aria-invalid')).toBe('true'))
    expect(document.activeElement).toBe(name)
    expect(document.getElementById(name.getAttribute('aria-describedby')!)!.textContent).toBe('There is a preset Default already: pick another name.')
    fireEvent.change(name, { target: { value: 'Defaults' } })
    expect(name.getAttribute('aria-invalid')).toBe('false')
    rpc.sendSavePreset.mockResolvedValue({ ok: false, error: 'OpenAgent has no GitHub account stranger on this computer.' })
    fireEvent.submit(name.form!)
    await screen.findByText('OpenAgent has no GitHub account stranger on this computer.')
    expect(name.getAttribute('aria-invalid')).toBe('false')
  })

  test('Cancel, Esc or the ✕ on an editor with something changed asks first: Cancel there keeps what was typed, Discard closes it; with nothing changed it closes at once', async () => {
    render(<PresetsPage />)
    fireEvent.click(await newPresetPress())
    const editor = screen.getByRole('dialog', { name: 'New preset' })
    fireEvent.change(within(editor).getByLabelText('Name'), { target: { value: 'Reviewer two' } })
    fireEvent.keyDown(within(editor).getByLabelText('Name'), { key: 'Escape' })
    const asked = await screen.findByRole('alertdialog', { name: 'Discard the new preset?' })
    fireEvent.click(within(asked).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect((within(screen.getByRole('dialog', { name: 'New preset' })).getByLabelText('Name') as HTMLInputElement).value).toBe('Reviewer two')
    fireEvent.click(within(screen.getByRole('dialog', { name: 'New preset' })).getByRole('button', { name: 'Cancel' }))
    fireEvent.click(within(await screen.findByRole('alertdialog', { name: 'Discard the new preset?' })).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    fireEvent.click(within(screen.getByRole('dialog', { name: 'New preset' })).getByRole('button', { name: 'Close' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New preset' })).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Edit Reviewer' }))
    fireEvent.keyDown(within(screen.getByRole('dialog', { name: 'Editing Reviewer' })).getByLabelText('Name'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(rpc.sendSavePreset).not.toHaveBeenCalled()
  })

  test('Back or a reload with a name typed asks first, and the address stays: Cancel keeps the name, Discard goes back and holds nothing more', async () => {
    window.history.replaceState(null, '', '/permissions')
    window.history.pushState(null, '', '/presets')
    const { useRoute } = await vi.importActual<typeof import('../lib/use-route.js')>('../lib/use-route.js')
    const { NO_PROJECTS } = await import('../../src/project-address.js')
    // The app's route, which follows Back.
    const Routed = () => (useRoute(NO_PROJECTS), null)
    render(<><Routed /><PresetsPage /></>)
    const back = async () => {
      const popped = new Promise(resolve => window.addEventListener('popstate', resolve, { once: true }))
      window.history.back()
      await act(async () => void (await popped))
    }
    fireEvent.click(await newPresetPress())
    fireEvent.change(within(screen.getByRole('dialog', { name: 'New preset' })).getByLabelText('Name'), { target: { value: 'Backtest' } })
    const reload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(reload)
    expect(reload.defaultPrevented).toBe(true)
    await back()
    const asked = await screen.findByRole('alertdialog', { name: 'Discard the new preset?' })
    await waitFor(() => expect(window.location.pathname).toBe('/presets'))
    fireEvent.click(within(asked).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect((within(screen.getByRole('dialog', { name: 'New preset' })).getByLabelText('Name') as HTMLInputElement).value).toBe('Backtest')
    await back()
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(window.location.pathname).toBe('/permissions'))
    const after = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(after)
    expect(after.defaultPrevented).toBe(false)
  })

  test('with OpenAgent not answering after a name is typed, Discard still closes the editor: it sends nothing', async () => {
    const page = render(<DaemonDown.Provider value={false}><PresetsPage /></DaemonDown.Provider>)
    fireEvent.click(await newPresetPress())
    fireEvent.change(within(screen.getByRole('dialog', { name: 'New preset' })).getByLabelText('Name'), { target: { value: 'Offline draft' } })
    page.rerender(<DaemonDown.Provider value={true}><PresetsPage /></DaemonDown.Provider>)
    fireEvent.click(within(screen.getByRole('dialog', { name: 'New preset' })).getByRole('button', { name: 'Close' }))
    const discard = within(await screen.findByRole('alertdialog', { name: 'Discard the new preset?' })).getByRole('button', { name: 'Discard' }) as HTMLButtonElement
    expect(discard.disabled).toBe(false)
    fireEvent.click(discard)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New preset' })).toBeNull())
    expect(rpc.sendSavePreset).not.toHaveBeenCalled()
  })

  test('a preset edited in place keeps its id; a refusal is said under the editor and nothing closes', async () => {
    rpc.sendSavePreset.mockResolvedValue({ ok: false, error: 'OpenAgent has no GitHub account stranger on this computer.' })
    render(<PresetsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Reviewer' }))
    const editor = screen.getByRole('dialog', { name: 'Editing Reviewer' })
    // Its project-skills tick is off as its record says; ticked on, the save says so.
    expect(within(editor).getByRole('checkbox', { name: 'Project skills' }).getAttribute('aria-checked')).toBe('false')
    fireEvent.click(within(editor).getByRole('checkbox', { name: 'Project skills' }))
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(rpc.sendSavePreset).toHaveBeenCalledWith({ id: 'reviewer', name: 'Reviewer', options: { github: { account: 'octo-agent' }, 'agent-driver': { claude: ['Dani'] } } }))
    expect((await within(editor).findByRole('alert')).textContent).toContain('no GitHub account stranger')
    // Default's name is not for editing.
    fireEvent.click(within(editor).getByRole('button', { name: 'Cancel' }))
    fireEvent.click(within(await screen.findByRole('alertdialog', { name: 'Discard your changes to Reviewer?' })).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Edit Default' }))
    expect(screen.queryByLabelText('Name')).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Editing Default' }).textContent).toMatch(/Default keeps its name/)
    // A preset that names no account: one plain item, not the computer's account repeated.
    expect(screen.getByLabelText('GitHub account').textContent).toBe('None — whatever the computer uses')
  })

  test('"All" is ticked while no account of a coding agent is picked; ticking one leaves it, ticking "All" again drops the picks', async () => {
    render(<PresetsPage />)
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
    await waitFor(() => expect(rpc.sendSavePreset).toHaveBeenCalledWith({ id: 'reviewer', name: 'Reviewer', options: { github: { account: 'octo-agent' }, skills: { project: 'none' } } }))
  })

  test('this computer\u2019s own login, logged out, is not offered; a preset that has it picked still shows it, saying it is not logged in', async () => {
    const claude = [{ id: 'This computer', name: 'Claude login on Studio', loggedOut: true }, { id: 'Dani', name: 'Dani' }]
    rpc.onPresetsList.mockResolvedValue({ ...VIEW, presets: [DEFAULT, { ...REVIEWER, options: { 'agent-driver': { claude: ['This computer'] } } }], claude })
    render(<PresetsPage />)
    fireEvent.click(await newPresetPress())
    const editor = screen.getByRole('dialog', { name: 'New preset' })
    expect(within(editor).queryByLabelText(/Claude login on Studio/)).toBeNull()
    expect(within(editor).getByLabelText('Claude account Dani')).toBeTruthy()
    fireEvent.click(within(editor).getByRole('button', { name: 'Cancel' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Reviewer' }))
    const edited = screen.getByRole('dialog', { name: 'Editing Reviewer' })
    expect(within(edited).getByLabelText('Claude account Claude login on Studio, not logged in').getAttribute('aria-checked')).toBe('true')
  })

  test('with no GitHub account of OpenAgent\u2019s yet, one is added from the editor, in its dialog, and is then the one picked; what was typed stays', async () => {
    const github = (accounts: string[]) => ({ hosts: [{ host: 'github.com', projects: [], provider: { name: 'GitHub', requestWord: 'pull request', tool: 'gh', installed: true, install: 'brew install gh', accounts: accounts.map(login => ({ login, runs: true, ok: true })) } }] })
    rpc.onPresetsList.mockResolvedValue({ ...VIEW, github: { host: 'github.com', accounts: [] } })
    logins.onGitHosts.mockResolvedValue(github([]))
    logins.sendGitHostLogin.mockResolvedValue({ ok: true, code: 'ABCD-1234', url: 'https://github.com/login/device' })
    logins.sendStopGitHostLogin.mockResolvedValue({ ok: true })
    render(<PresetsPage />)
    fireEvent.click(await newPresetPress())
    const editor = screen.getByRole('dialog', { name: 'New preset' })
    fireEvent.change(within(editor).getByLabelText('Name'), { target: { value: 'Social media' } })
    expect(within(editor).getByRole('combobox', { name: 'GitHub account' }).textContent).toContain('None')
    fireEvent.click(within(editor).getByRole('button', { name: 'Add account' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add a GitHub account' })
    expect(await within(dialog).findByText('ABCD-1234')).toBeTruthy()
    // Signed in at GitHub: the account is there, and the presets are read again with it.
    rpc.onPresetsList.mockResolvedValue({ ...VIEW, github: { host: 'github.com', accounts: ['me-agent'] } })
    logins.onGitHosts.mockResolvedValue(github(['me-agent']))
    // The account's dialog closes on it, and the preset's own is still there under it.
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add a GitHub account' })).toBeNull(), { timeout: 6000 })
    const after = screen.getByRole('dialog', { name: 'New preset' })
    expect(within(after).getByRole('combobox', { name: 'GitHub account' }).textContent).toContain('@me-agent')
    expect((within(after).getByLabelText('Name') as HTMLInputElement).value).toBe('Social media')
    fireEvent.click(within(after).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(rpc.sendSavePreset).toHaveBeenCalledWith(expect.objectContaining({ name: 'Social media', options: { github: { account: 'me-agent' } } })))
  }, 15_000)

  test('the editor is a dialog over the page: the preset\u2019s row stays under it, and a click beside it closes nothing', async () => {
    render(<PresetsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Reviewer' }))
    const editor = screen.getByRole('dialog', { name: 'Editing Reviewer' })
    expect((await presetRows(true)).some(row => row.textContent?.startsWith('Reviewer'))).toBe(true)
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
    expect(rpc.sendSavePreset).not.toHaveBeenCalled()
  })

  test('removing a preset asks first, then removes it and reads the list again', async () => {
    render(<PresetsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Reviewer' }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(rpc.sendRemovePreset).toHaveBeenCalledWith('reviewer'))
    await waitFor(() => expect(rpc.onPresetsList).toHaveBeenCalledTimes(2))
  })

  test('the focus a removed preset\u2019s press leaves goes to "New preset"', async () => {
    render(<PresetsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Reviewer' }))
    rpc.onPresetsList.mockResolvedValue({ ...VIEW, presets: [DEFAULT] })
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(screen.queryByText('Reviewer')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'New preset' })))
  })
})

describe('the Preset menu under the box', () => {
  test('the preset picked, by name; another picked is said back; "Manage presets…" opens the page; nothing until the presets are read', () => {
    const onPick = vi.fn()
    const { container, rerender } = render(<PresetMenu presets={undefined} picked={undefined} busy={false} onPick={onPick} />)
    expect(container.textContent).toBe('')
    rerender(<PresetMenu presets={VIEW.presets} picked={undefined} busy={false} onPick={onPick} />)
    expect(screen.getByRole('button', { name: 'Preset: Default' }).textContent).toBe('Default')
    rerender(<PresetMenu presets={VIEW.presets} picked="reviewer" busy={false} onPick={onPick} />)
    const trigger = screen.getByRole('button', { name: 'Preset: Reviewer' })
    expect(screen.getByRole('tooltip').textContent).toBe('This session is on the preset Reviewer, as @octo-agent on GitHub')
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: /^Default/ }))
    expect(onPick).toHaveBeenCalledWith('default')
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Manage presets…' }))
    expect(route.openPage).toHaveBeenCalledWith('presets')
  })
})
