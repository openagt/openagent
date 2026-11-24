import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { DropdownMenuCheckboxItem, forgetRemembered, type ModuleCallResult, type UiComposerControlProps } from '@openagt/ui/module'
import { fakeHost, mountedOf, openMenu, renderWithHost, type MountedView } from '@openagt/ui/module/testing'
import { ProfilesPage } from './ProfilesPage.js'

// The Profiles page, its module's calls as a test answers them, beside one other module whose
// control of the message box leaves a plugin out: what a profile's editor draws and saves.

const DEFAULT = { id: 'default', name: 'Default', options: {} }
const REVIEWER = { id: 'reviewer', name: 'Reviewer', options: { plugins: { without: ['logs'] } } }
let listed = [DEFAULT, REVIEWER]
let saved: ModuleCallResult | Promise<ModuleCallResult> = { ok: true, output: { ok: true, id: 'social' } }
const callComputer = vi.fn(async (name: string, _input: object): Promise<ModuleCallResult> => {
  if (name === 'profiles') return { ok: true, output: { profiles: listed, picked: 'default' } }
  if (name === 'saveProfile') return saved
  if (name === 'removeProfile') return { ok: true, output: { ok: true } }
  return { ok: false, error: `no ${name} here` }
})
const sent = (name: string) => callComputer.mock.calls.filter(([called]) => called === name).map(([, input]) => input)
const host = fakeHost('@openagt/profiles', { callComputer })

/** Another module's line of the gear: whether runs get its plugin, as a tick, and in a few words. */
function LogsControl({ options, onChange, say }: UiComposerControlProps) {
  const without = options.plugins?.without ?? []
  const off = without.includes('logs')
  useEffect(() => say({ words: off ? 'Without logs' : 'Every plugin' }), [say, off])
  return (
    <DropdownMenuCheckboxItem checked={!off} onCheckedChange={() => onChange({ ...options, plugins: { without: off ? [] : ['logs'] } })}>
      Plugin logs
    </DropdownMenuCheckboxItem>
  )
}
const CONTROL: MountedView<'composer.control'> = { place: 'composer.control', id: 'logs', at: 'setup', View: LogsControl, package: '@acme/logs', module: 'logs', projects: ['p1'] }
const MODULES = mountedOf({ views: { 'composer.control': [CONTROL] } })
const render = () => renderWithHost(<ProfilesPage />, host, MODULES)

beforeEach(() => {
  listed = [DEFAULT, REVIEWER]
  saved = { ok: true, output: { ok: true, id: 'social' } }
})
afterEach(() => {
  cleanup()
  forgetRemembered()
  localStorage.clear()
  callComputer.mockClear()
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
    callComputer.mockImplementationOnce(() => new Promise(resolve => (answer = () => resolve({ ok: true, output: { profiles: listed, picked: 'default' } }))))
    render()
    expect(screen.getByRole('status').textContent).toBe('Loading…')
    answer()
    expect(await profileRows()).toHaveLength(2)
    expect(screen.queryByText('Loading…')).toBeNull()
  })

  test('one row per profile, Default first and marked; under each, what its runs get, as the message box\'s controls say it; Default is never removed', async () => {
    render()
    const rows = await profileRows()
    expect(rows.map(row => row.querySelector('.font-medium')?.firstChild?.textContent)).toEqual(['Default', 'Reviewer'])
    expect(within(rows[0]!).getByText(/used unless you pick another/)).toBeTruthy()
    const facts = (row: HTMLElement) => row.querySelector('.text-faint-foreground')?.textContent
    await waitFor(() => expect([facts(rows[0]!), facts(rows[1]!)]).toEqual(['Every plugin', 'Without logs']))
    expect(within(rows[0]!).queryByRole('button', { name: 'Remove Default' })).toBeNull()
    expect(within(rows[1]!).getByRole('button', { name: 'Remove Reviewer' })).toBeTruthy()
  })

  test("a profile's editor draws the message box's controls on its options: a pick there is the profile's, saved under its own id", async () => {
    render()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Reviewer' }))
    const editor = screen.getByRole('dialog', { name: 'Editing Reviewer' })
    expect(within(editor).getByText('Without logs')).toBeTruthy()
    await openMenu(within(editor).getByRole('button', { name: 'Profile setup' }))
    const tick = await screen.findByRole('menuitemcheckbox', { name: 'Plugin logs' })
    expect(tick.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(tick)
    await waitFor(() => expect(within(editor).getByText('Every plugin')).toBeTruthy())
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent('saveProfile')).toEqual([{ id: 'reviewer', name: 'Reviewer', options: { plugins: { without: [] } } }]))
  })

  test('a new profile: its name, typed at once; saved with what its controls picked, and the list read again', async () => {
    render()
    fireEvent.click(await newProfilePress())
    const editor = screen.getByRole('dialog', { name: 'New profile' })
    await waitFor(() => expect(document.activeElement).toBe(within(editor).getByLabelText('Name')))
    fireEvent.change(within(editor).getByLabelText('Name'), { target: { value: 'Social Media' } })
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent('saveProfile')).toEqual([{ name: 'Social Media', options: {} }]))
    await waitFor(() => expect(sent('profiles')).toHaveLength(2))
    expect(screen.queryByRole('dialog', { name: 'New profile' })).toBeNull()
  })

  test('after a new profile is saved, the focus goes to its row’s Edit once the list is read with it', async () => {
    render()
    fireEvent.click(await newProfilePress())
    fireEvent.change(within(screen.getByRole('dialog', { name: 'New profile' })).getByLabelText('Name'), { target: { value: 'Social' } })
    listed = [DEFAULT, REVIEWER, { id: 'social', name: 'Social', options: {} }]
    fireEvent.click(within(screen.getByRole('dialog', { name: 'New profile' })).getByRole('button', { name: 'Save' }))
    const edit = await screen.findByRole('button', { name: 'Edit Social' })
    await waitFor(() => expect(document.activeElement).toBe(edit))
  })

  test('the editor is a form: Enter in the name saves; with no name, Save says what it needs under the field and saves nothing', async () => {
    render()
    fireEvent.click(await newProfilePress())
    const editor = screen.getByRole('dialog', { name: 'New profile' })
    const name = within(editor).getByLabelText('Name') as HTMLInputElement
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    expect(name.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(name.getAttribute('aria-describedby')!)!.textContent).toBe('Give the profile a name.')
    expect(sent('saveProfile')).toEqual([])
    fireEvent.change(name, { target: { value: 'Social media' } })
    expect(name.getAttribute('aria-invalid')).toBe('false')
    fireEvent.submit(name.form!)
    await waitFor(() => expect(sent('saveProfile')).toEqual([expect.objectContaining({ name: 'Social media' })]))
  })

  test('a name OpenAgent refuses marks the field with the refusal; a refusal of something else leaves the field alone; while it saves, the field and Save keep the focus, and Save sends nothing more', async () => {
    let refuse = (_outcome: ModuleCallResult) => {}
    saved = new Promise(resolve => (refuse = resolve))
    render()
    fireEvent.click(await newProfilePress())
    const editor = screen.getByRole('dialog', { name: 'New profile' })
    const name = within(editor).getByLabelText('Name') as HTMLInputElement
    fireEvent.change(name, { target: { value: 'Default!' } })
    name.focus()
    fireEvent.submit(name.form!)
    const save = (await within(editor).findByRole('button', { name: 'Saving…' })) as HTMLButtonElement
    expect([name.disabled, name.readOnly, save.disabled, save.getAttribute('aria-disabled')]).toEqual([false, true, false, 'true'])
    fireEvent.click(save)
    expect(sent('saveProfile')).toHaveLength(1)
    await act(async () => refuse({ ok: true, output: { ok: false, error: 'There is a profile Default already: pick another name.', field: 'name' } }))
    await waitFor(() => expect(name.getAttribute('aria-invalid')).toBe('true'))
    expect(document.activeElement).toBe(name)
    expect(document.getElementById(name.getAttribute('aria-describedby')!)!.textContent).toBe('There is a profile Default already: pick another name.')
    fireEvent.change(name, { target: { value: 'Defaults' } })
    expect(name.getAttribute('aria-invalid')).toBe('false')
    saved = { ok: true, output: { ok: false, error: 'That profile is gone: make it again.' } }
    fireEvent.submit(name.form!)
    await screen.findByText('That profile is gone: make it again.')
    expect(name.getAttribute('aria-invalid')).toBe('false')
  })

  test('Cancel, Esc or the ✕ on an editor with something changed asks first: Cancel there keeps what was typed, Discard closes it; with nothing changed it closes at once', async () => {
    render()
    fireEvent.click(await newProfilePress())
    const editor = screen.getByRole('dialog', { name: 'New profile' })
    fireEvent.change(within(editor).getByLabelText('Name'), { target: { value: 'Reviewer two' } })
    fireEvent.keyDown(within(editor).getByLabelText('Name'), { key: 'Escape' })
    const asked = await screen.findByRole('alertdialog', { name: 'Discard the new profile?' })
    fireEvent.click(within(asked).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect((within(screen.getByRole('dialog', { name: 'New profile' })).getByLabelText('Name') as HTMLInputElement).value).toBe('Reviewer two')
    fireEvent.click(within(screen.getByRole('dialog', { name: 'New profile' })).getByRole('button', { name: 'Close' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New profile' })).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Edit Reviewer' }))
    fireEvent.keyDown(within(screen.getByRole('dialog', { name: 'Editing Reviewer' })).getByLabelText('Name'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(sent('saveProfile')).toEqual([])
  })

  test('a reload with a name typed asks first; once discarded, nothing is held', async () => {
    render()
    fireEvent.click(await newProfilePress())
    fireEvent.change(within(screen.getByRole('dialog', { name: 'New profile' })).getByLabelText('Name'), { target: { value: 'Backtest' } })
    const reload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(reload)
    expect(reload.defaultPrevented).toBe(true)
    fireEvent.click(within(screen.getByRole('dialog', { name: 'New profile' })).getByRole('button', { name: 'Cancel' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New profile' })).toBeNull())
    const after = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(after)
    expect(after.defaultPrevented).toBe(false)
  })

  test("Default's name is not for editing: the editor says why", async () => {
    render()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Default' }))
    expect(screen.queryByLabelText('Name')).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Editing Default' }).textContent).toMatch(/Default keeps its name/)
  })

  test('the editor is a dialog over the page: the profile’s row stays under it, and a click beside it closes nothing', async () => {
    render()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Reviewer' }))
    const editor = screen.getByRole('dialog', { name: 'Editing Reviewer' })
    expect((await profileRows(true)).some(row => row.textContent?.startsWith('Reviewer'))).toBe(true)
    fireEvent.change(within(editor).getByLabelText('Name'), { target: { value: 'Reviewer two' } })
    const backdrop = document.querySelector('.fixed.inset-0')!
    for (const press of [fireEvent.pointerDown, fireEvent.mouseDown, fireEvent.pointerUp, fireEvent.mouseUp, fireEvent.click]) press(backdrop)
    await new Promise(resolve => setTimeout(resolve, 50))
    expect((within(screen.getByRole('dialog', { name: 'Editing Reviewer' })).getByLabelText('Name') as HTMLInputElement).value).toBe('Reviewer two')
  })

  test('removing a profile asks first, then removes it and reads the list again; the focus its press leaves goes to "New profile"', async () => {
    render()
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Reviewer' }))
    listed = [DEFAULT]
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(sent('removeProfile')).toEqual([{ id: 'reviewer' }]))
    await waitFor(() => expect(screen.queryByText('Reviewer')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'New profile' })))
  })
})
