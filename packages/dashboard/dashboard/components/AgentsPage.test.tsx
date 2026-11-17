import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { forgetRemembered } from '../lib/use-async.js'
import { DaemonDown } from '../lib/use-daemon-health.js'

const rpc = vi.hoisted(() => ({ onAgentsList: vi.fn(), sendSaveAgent: vi.fn(), sendRemoveAgent: vi.fn(), onAgentLogins: vi.fn(), sendCopyAgentLogins: vi.fn() }))
vi.mock('../rpc/agents.js', () => rpc)
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

const { AgentsPage } = await import('./AgentsPage.js')
const { AgentMenu } = await import('./AgentMenu.js')

const DEFAULT = { id: 'default', name: 'Default', skills: ['ask', 'github'], accounts: {}, projectSkills: true }
const REVIEWER = { id: 'reviewer', name: 'Reviewer', skills: ['ask', 'readability'], accounts: { github: 'octo-agent', claude: ['Dani'] }, projectSkills: false }
const VIEW = {
  agents: [DEFAULT, REVIEWER],
  skills: [
    { title: 'Every agent starts with', skills: [{ name: 'ask', description: 'Ask the person.' }, { name: 'github', description: 'Pull requests on GitHub.' }] },
    { title: 'Code reviews', skills: [{ name: 'readability', description: 'Read the code.' }, { name: 'ux', description: 'Judge the UX.' }] },
  ],
  github: { host: 'github.com', accounts: ['octo', 'octo-agent'] },
  claude: [{ id: 'This computer', name: 'Claude login on Studio' }, { id: 'Dani', name: 'Dani' }],
  codex: [],
}

beforeEach(() => {
  rpc.onAgentsList.mockResolvedValue(VIEW)
  rpc.onAgentLogins.mockResolvedValue([])
  rpc.sendCopyAgentLogins.mockResolvedValue({ ok: true })
  rpc.sendSaveAgent.mockResolvedValue({ ok: true, id: 'social' })
  rpc.sendRemoveAgent.mockResolvedValue({ ok: true })
})

afterEach(() => {
  cleanup()
  forgetRemembered()
  for (const fn of [...Object.values(rpc), ...Object.values(logins)]) fn.mockReset()
  route.openPage.mockReset()
})

/** "New agent", once the agents are read: before, it is there and takes no press. */
async function newAgentPress(): Promise<HTMLElement> {
  const press = await screen.findByRole('button', { name: 'New agent' })
  await waitFor(() => expect((press as HTMLButtonElement).disabled).toBe(false))
  return press
}

/** The agents' rows, top to bottom, without what is said under one; `hidden`, also while a dialog over the page hides them. */
async function agentRows(hidden = false): Promise<HTMLElement[]> {
  const list = await screen.findByRole('list', { name: 'Agents', hidden })
  return within(list).getAllByRole('listitem', { hidden }).filter(item => item.parentElement === list && item.classList.contains('group/row'))
}

describe('the Agents page', () => {
  test("while the agents are first read, rows' shapes stand where the agents will, and the agents take their place", async () => {
    let answer = () => {}
    rpc.onAgentsList.mockImplementationOnce(() => new Promise(resolve => (answer = () => resolve(VIEW))))
    render(<AgentsPage />)
    expect(screen.getByRole('status').textContent).toBe('Loading…')
    answer()
    expect(await agentRows()).toHaveLength(2)
    expect(screen.queryByText('Loading…')).toBeNull()
  })

  test('one row per agent, the default first and marked; each with its skills and the accounts it works as, the computer’s where it names none', async () => {
    render(<AgentsPage />)
    const rows = await agentRows()
    expect(rows.map(row => row.querySelector('.font-medium')?.firstChild?.textContent)).toEqual(['Default', 'Reviewer'])
    expect(within(rows[0]!).getByText(/used unless you pick another/)).toBeTruthy()
    // Under the name, its facts with a dot between them.
    const facts = (row: HTMLElement) => row.querySelector('.text-faint-foreground')?.textContent
    expect(facts(rows[0]!)).toBe('ask, github·GitHub: whatever the computer uses')
    // An agent set to never pick up the project's own skills says so after its list; the default does not.
    expect(facts(rows[1]!)).toBe('ask, readability, no project skills·@octo-agent on GitHub·Claude: Dani')
    // One without a skill every agent starts with says so in its row, in the skill's own words; the default has both.
    expect(screen.getByText('Without github, which every agent starts with. Pull requests on GitHub.').closest('li')).toBe(rows[1])
    expect(screen.getAllByText(/^Without /)).toHaveLength(1)
    // The default is never removed.
    expect(within(rows[0]!).queryByRole('button', { name: 'Remove Default' })).toBeNull()
    expect(within(rows[1]!).getByRole('button', { name: 'Remove Reviewer' })).toBeTruthy()
  })

  test('a new agent: its name, typed at once, the skills ticked from the list, the two every agent starts with ticked already; saved as the dashboard’s call, and the list read again', async () => {
    render(<AgentsPage />)
    fireEvent.click(await newAgentPress())
    const editor = screen.getByRole('dialog', { name: 'New agent' })
    // What is typed first goes to the name.
    await waitFor(() => expect(document.activeElement).toBe(within(editor).getByLabelText('Name')))
    expect((within(editor).getByRole('checkbox', { name: 'ask' }) as HTMLInputElement).getAttribute('aria-checked') ?? (within(editor).getByRole('checkbox', { name: 'ask' }) as HTMLInputElement).checked.toString()).toMatch(/true/)
    fireEvent.change(within(editor).getByLabelText('Name'), { target: { value: 'Social Media' } })
    fireEvent.click(within(editor).getByRole('checkbox', { name: 'ux' }))
    fireEvent.click(within(editor).getByLabelText('Claude account Dani'))
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(rpc.sendSaveAgent).toHaveBeenCalledWith({ name: 'Social Media', skills: ['ask', 'github', 'ux'], accounts: { claude: ['Dani'] }, projectSkills: true }))
    await waitFor(() => expect(rpc.onAgentsList).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('dialog', { name: 'New agent' })).toBeNull()
  })

  test('after a new agent is saved, the focus goes to its row’s Edit once the list is read with it', async () => {
    render(<AgentsPage />)
    fireEvent.click(await newAgentPress())
    fireEvent.change(within(screen.getByRole('dialog', { name: 'New agent' })).getByLabelText('Name'), { target: { value: 'Social' } })
    rpc.onAgentsList.mockResolvedValue({ ...VIEW, agents: [...VIEW.agents, { id: 'social', name: 'Social', skills: ['ask', 'github'], accounts: {}, projectSkills: true }] })
    fireEvent.click(within(screen.getByRole('dialog', { name: 'New agent' })).getByRole('button', { name: 'Save' }))
    const edit = await screen.findByRole('button', { name: 'Edit Social' })
    await waitFor(() => expect(document.activeElement).toBe(edit))
  })

  test("a skill's sentence is two lines at most, the whole of it on a press of them, which ticks nothing", async () => {
    render(<AgentsPage />)
    fireEvent.click(await newAgentPress())
    const editor = screen.getByRole('dialog', { name: 'New agent' })
    const sentence = within(editor).getByRole('button', { name: 'Read the code.' })
    expect(sentence.getAttribute('aria-expanded')).toBe('false')
    expect(sentence.className).toContain('line-clamp-2')
    fireEvent.click(sentence)
    expect(sentence.getAttribute('aria-expanded')).toBe('true')
    expect(sentence.className).not.toContain('line-clamp-2')
    expect(within(editor).getByRole('checkbox', { name: 'readability' }).getAttribute('aria-checked')).toBe('false')
  })

  test('the editor is a form: Enter in the name saves; with no name, Save says what it needs under the field and saves nothing', async () => {
    render(<AgentsPage />)
    fireEvent.click(await newAgentPress())
    const editor = screen.getByRole('dialog', { name: 'New agent' })
    const name = within(editor).getByLabelText('Name') as HTMLInputElement
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    expect(name.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(name.getAttribute('aria-describedby')!)!.textContent).toBe('Give the agent a name.')
    expect(rpc.sendSaveAgent).not.toHaveBeenCalled()
    fireEvent.change(name, { target: { value: 'Social media' } })
    expect(name.getAttribute('aria-invalid')).toBe('false')
    fireEvent.submit(name.form!)
    await waitFor(() => expect(rpc.sendSaveAgent).toHaveBeenCalledWith(expect.objectContaining({ name: 'Social media' })))
  })

  test('a name OpenAgent refuses marks the field with the refusal; a refusal of something else leaves the field alone, and typing clears it; while it saves, the field and Save keep the focus, and Save sends nothing more', async () => {
    let refuse = (_outcome: unknown) => {}
    rpc.sendSaveAgent.mockReturnValue(new Promise(resolve => (refuse = resolve)))
    render(<AgentsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'New agent' }))
    const editor = screen.getByRole('dialog', { name: 'New agent' })
    const name = within(editor).getByLabelText('Name') as HTMLInputElement
    fireEvent.change(name, { target: { value: 'Default!' } })
    name.focus()
    fireEvent.submit(name.form!)
    const save = (await within(editor).findByRole('button', { name: 'Saving…' })) as HTMLButtonElement
    expect([name.disabled, name.readOnly, save.disabled, save.getAttribute('aria-disabled')]).toEqual([false, true, false, 'true'])
    fireEvent.click(save)
    expect(rpc.sendSaveAgent).toHaveBeenCalledTimes(1)
    refuse({ ok: false, error: 'There is an agent Default already: pick another name.', field: 'name' })
    await waitFor(() => expect(name.getAttribute('aria-invalid')).toBe('true'))
    expect(document.activeElement).toBe(name)
    expect(document.getElementById(name.getAttribute('aria-describedby')!)!.textContent).toBe('There is an agent Default already: pick another name.')
    fireEvent.change(name, { target: { value: 'Defaults' } })
    expect(name.getAttribute('aria-invalid')).toBe('false')
    rpc.sendSaveAgent.mockResolvedValue({ ok: false, error: 'OpenAgent has no GitHub account stranger on this computer.' })
    fireEvent.submit(name.form!)
    await screen.findByText('OpenAgent has no GitHub account stranger on this computer.')
    expect(name.getAttribute('aria-invalid')).toBe('false')
  })

  test('Cancel, Esc or the ✕ on an editor with something changed asks first: Cancel there keeps what was typed, Discard closes it; with nothing changed it closes at once', async () => {
    render(<AgentsPage />)
    fireEvent.click(await newAgentPress())
    const editor = screen.getByRole('dialog', { name: 'New agent' })
    fireEvent.change(within(editor).getByLabelText('Name'), { target: { value: 'Reviewer two' } })
    fireEvent.keyDown(within(editor).getByLabelText('Name'), { key: 'Escape' })
    const asked = await screen.findByRole('alertdialog', { name: 'Discard the new agent?' })
    fireEvent.click(within(asked).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect((within(screen.getByRole('dialog', { name: 'New agent' })).getByLabelText('Name') as HTMLInputElement).value).toBe('Reviewer two')
    fireEvent.click(within(screen.getByRole('dialog', { name: 'New agent' })).getByRole('button', { name: 'Cancel' }))
    fireEvent.click(within(await screen.findByRole('alertdialog', { name: 'Discard the new agent?' })).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    fireEvent.click(within(screen.getByRole('dialog', { name: 'New agent' })).getByRole('button', { name: 'Close' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New agent' })).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Edit Reviewer' }))
    fireEvent.keyDown(within(screen.getByRole('dialog', { name: 'Editing Reviewer' })).getByLabelText('Name'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(rpc.sendSaveAgent).not.toHaveBeenCalled()
  })

  test('Back or a reload with a name typed asks first, and the address stays: Cancel keeps the name, Discard goes back and holds nothing more', async () => {
    window.history.replaceState(null, '', '/permissions')
    window.history.pushState(null, '', '/agents')
    const { useRoute } = await vi.importActual<typeof import('../lib/use-route.js')>('../lib/use-route.js')
    const { NO_PROJECTS } = await import('../../src/project-address.js')
    // The app's route, which follows Back.
    const Routed = () => (useRoute(NO_PROJECTS), null)
    render(<><Routed /><AgentsPage /></>)
    const back = async () => {
      const popped = new Promise(resolve => window.addEventListener('popstate', resolve, { once: true }))
      window.history.back()
      await act(async () => void (await popped))
    }
    fireEvent.click(await newAgentPress())
    fireEvent.change(within(screen.getByRole('dialog', { name: 'New agent' })).getByLabelText('Name'), { target: { value: 'Backtest' } })
    const reload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(reload)
    expect(reload.defaultPrevented).toBe(true)
    await back()
    const asked = await screen.findByRole('alertdialog', { name: 'Discard the new agent?' })
    await waitFor(() => expect(window.location.pathname).toBe('/agents'))
    fireEvent.click(within(asked).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect((within(screen.getByRole('dialog', { name: 'New agent' })).getByLabelText('Name') as HTMLInputElement).value).toBe('Backtest')
    await back()
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(window.location.pathname).toBe('/permissions'))
    const after = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(after)
    expect(after.defaultPrevented).toBe(false)
  })

  test('with OpenAgent not answering after a name is typed, Discard still closes the editor: it sends nothing', async () => {
    const page = render(<DaemonDown.Provider value={false}><AgentsPage /></DaemonDown.Provider>)
    fireEvent.click(await newAgentPress())
    fireEvent.change(within(screen.getByRole('dialog', { name: 'New agent' })).getByLabelText('Name'), { target: { value: 'Offline draft' } })
    page.rerender(<DaemonDown.Provider value={true}><AgentsPage /></DaemonDown.Provider>)
    fireEvent.click(within(screen.getByRole('dialog', { name: 'New agent' })).getByRole('button', { name: 'Close' }))
    const discard = within(await screen.findByRole('alertdialog', { name: 'Discard the new agent?' })).getByRole('button', { name: 'Discard' }) as HTMLButtonElement
    expect(discard.disabled).toBe(false)
    fireEvent.click(discard)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New agent' })).toBeNull())
    expect(rpc.sendSaveAgent).not.toHaveBeenCalled()
  })

  test('an agent edited in place keeps its id; a refusal is said under the editor and nothing closes', async () => {
    rpc.sendSaveAgent.mockResolvedValue({ ok: false, error: 'OpenAgent has no GitHub account stranger on this computer.' })
    render(<AgentsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Reviewer' }))
    const editor = screen.getByRole('dialog', { name: 'Editing Reviewer' })
    fireEvent.click(within(editor).getByRole('checkbox', { name: 'readability' }))
    // Its project-skills tick is off as its record says; ticked on, the save says so.
    expect(within(editor).getByRole('checkbox', { name: 'Project skills' }).getAttribute('aria-checked')).toBe('false')
    fireEvent.click(within(editor).getByRole('checkbox', { name: 'Project skills' }))
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(rpc.sendSaveAgent).toHaveBeenCalledWith({ id: 'reviewer', name: 'Reviewer', skills: ['ask'], accounts: { github: 'octo-agent', claude: ['Dani'] }, projectSkills: true }))
    expect((await within(editor).findByRole('alert')).textContent).toContain('no GitHub account stranger')
    // The default's name is not for editing.
    fireEvent.click(within(editor).getByRole('button', { name: 'Cancel' }))
    fireEvent.click(within(await screen.findByRole('alertdialog', { name: 'Discard your changes to Reviewer?' })).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Edit Default' }))
    expect((screen.getByLabelText('Name') as HTMLInputElement).disabled).toBe(true)
    // An agent that names no account: one plain item, not the computer's account repeated.
    expect(screen.getByLabelText('GitHub account').textContent).toBe('None — whatever the computer uses')
  })

  test('"All" is ticked while no account of a coding agent is picked; ticking one leaves it, ticking "All" again drops the picks', async () => {
    render(<AgentsPage />)
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
    await waitFor(() => expect(rpc.sendSaveAgent).toHaveBeenCalledWith({ id: 'reviewer', name: 'Reviewer', skills: ['ask', 'readability'], accounts: { github: 'octo-agent' }, projectSkills: false }))
  })

  test('this computer\u2019s own login, logged out, is not offered; an agent that has it picked still shows it, saying it is not logged in', async () => {
    const claude = [{ id: 'This computer', name: 'Claude login on Studio', loggedOut: true }, { id: 'Dani', name: 'Dani' }]
    rpc.onAgentsList.mockResolvedValue({ ...VIEW, agents: [DEFAULT, { ...REVIEWER, accounts: { claude: ['This computer'] } }], claude })
    render(<AgentsPage />)
    fireEvent.click(await newAgentPress())
    const editor = screen.getByRole('dialog', { name: 'New agent' })
    expect(within(editor).queryByLabelText(/Claude login on Studio/)).toBeNull()
    expect(within(editor).getByLabelText('Claude account Dani')).toBeTruthy()
    fireEvent.click(within(editor).getByRole('button', { name: 'Cancel' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Reviewer' }))
    const edited = screen.getByRole('dialog', { name: 'Editing Reviewer' })
    expect(within(edited).getByLabelText('Claude account Claude login on Studio, not logged in').getAttribute('aria-checked')).toBe('true')
  })

  test('with no GitHub account of OpenAgent\u2019s yet, one is added from the editor, in its dialog, and is then the one picked; what was typed stays', async () => {
    const github = (accounts: string[]) => ({ hosts: [{ host: 'github.com', projects: [], provider: { name: 'GitHub', requestWord: 'pull request', tool: 'gh', installed: true, install: 'brew install gh', accounts: accounts.map(login => ({ login, runs: true, ok: true })) } }] })
    rpc.onAgentsList.mockResolvedValue({ ...VIEW, github: { host: 'github.com', accounts: [] } })
    logins.onGitHosts.mockResolvedValue(github([]))
    logins.sendGitHostLogin.mockResolvedValue({ ok: true, code: 'ABCD-1234', url: 'https://github.com/login/device' })
    logins.sendStopGitHostLogin.mockResolvedValue({ ok: true })
    render(<AgentsPage />)
    fireEvent.click(await newAgentPress())
    const editor = screen.getByRole('dialog', { name: 'New agent' })
    fireEvent.change(within(editor).getByLabelText('Name'), { target: { value: 'Social media' } })
    expect(within(editor).getByRole('combobox', { name: 'GitHub account' }).textContent).toContain('None')
    fireEvent.click(within(editor).getByRole('button', { name: 'Add account' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add a GitHub account' })
    expect(await within(dialog).findByText('ABCD-1234')).toBeTruthy()
    // Signed in at GitHub: the account is there, and the agents are read again with it.
    rpc.onAgentsList.mockResolvedValue({ ...VIEW, github: { host: 'github.com', accounts: ['me-agent'] } })
    logins.onGitHosts.mockResolvedValue(github(['me-agent']))
    // The account's dialog closes on it, and the agent's own is still there under it.
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add a GitHub account' })).toBeNull(), { timeout: 6000 })
    const after = screen.getByRole('dialog', { name: 'New agent' })
    expect(within(after).getByRole('combobox', { name: 'GitHub account' }).textContent).toContain('@me-agent')
    expect((within(after).getByLabelText('Name') as HTMLInputElement).value).toBe('Social media')
    fireEvent.click(within(after).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(rpc.sendSaveAgent).toHaveBeenCalledWith(expect.objectContaining({ name: 'Social media', accounts: { github: 'me-agent' } })))
  }, 15_000)

  test('the editor is a dialog over the page: the agent\u2019s row stays under it, a click beside it closes nothing, and it says what every project run gets besides', async () => {
    render(<AgentsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Reviewer' }))
    const editor = screen.getByRole('dialog', { name: 'Editing Reviewer' })
    expect((await agentRows(true)).some(row => row.textContent?.startsWith('Reviewer'))).toBe(true)
    expect(within(editor).getByText(/every run also gets the branches skill/)).toBeTruthy()
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
    expect(rpc.sendSaveAgent).not.toHaveBeenCalled()
  })

  test('where an agent\u2019s GitHub account is: one line per device, on it or not, with why; "Copy again" for one that failed copies now and reads again; nothing for an agent that names none', async () => {
    rpc.onAgentLogins.mockResolvedValue([
      { machineId: 'm1', label: 'Droplet', reachable: true, github: { 'octo-agent': { state: 'there' } } },
      { machineId: 'm2', label: 'Laptop', reachable: true, github: { 'octo-agent': { state: 'failed', error: 'GitHub did not take the login' } } },
      { machineId: 'm3', label: 'Studio', reachable: false, github: {} },
    ])
    render(<AgentsPage />)
    const where = await screen.findByRole('list', { name: 'Where @octo-agent is' })
    expect([...where.querySelectorAll('li')].map(li => li.textContent)).toEqual(['On Droplet', 'Laptop: not copied — GitHub did not take the login', 'Studio: not reached'])
    // The failure alone in the warning colour.
    expect(where.querySelectorAll('.text-warning')).toHaveLength(1)
    fireEvent.click(within(where.closest('li')!).getByRole('button', { name: 'Copy again' }))
    await waitFor(() => expect(rpc.sendCopyAgentLogins).toHaveBeenCalled())
    await waitFor(() => expect(rpc.onAgentLogins).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('list', { name: /Where @/ })).toBe(where)
    expect(screen.getAllByRole('list', { name: /Where @/ })).toHaveLength(1)
  })

  test('removing an agent asks first, then removes it and reads the list again', async () => {
    render(<AgentsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Reviewer' }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(rpc.sendRemoveAgent).toHaveBeenCalledWith('reviewer'))
    await waitFor(() => expect(rpc.onAgentsList).toHaveBeenCalledTimes(2))
  })

  test('the focus a removed agent\u2019s press leaves goes to "New agent"', async () => {
    render(<AgentsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Reviewer' }))
    rpc.onAgentsList.mockResolvedValue({ ...VIEW, agents: [DEFAULT] })
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(screen.queryByText('Reviewer')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'New agent' })))
  })
})

describe('the Agent menu under the box', () => {
  test('the agent picked, by name; another picked is said back; "Manage agents…" opens the page; nothing until the agents are read', () => {
    const onPick = vi.fn()
    const { container, rerender } = render(<AgentMenu agents={undefined} picked={undefined} busy={false} onPick={onPick} />)
    expect(container.textContent).toBe('')
    rerender(<AgentMenu agents={VIEW.agents} picked={undefined} busy={false} onPick={onPick} />)
    expect(screen.getByRole('button', { name: 'Agent: Default' }).textContent).toBe('Default')
    rerender(<AgentMenu agents={VIEW.agents} picked="reviewer" busy={false} onPick={onPick} />)
    const trigger = screen.getByRole('button', { name: 'Agent: Reviewer' })
    expect(screen.getByRole('tooltip').textContent).toBe('This session is on the agent Reviewer: its own 2 skills, as @octo-agent on GitHub')
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: /^Default/ }))
    expect(onPick).toHaveBeenCalledWith('default')
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Manage agents…' }))
    expect(route.openPage).toHaveBeenCalledWith('agents')
  })
})
