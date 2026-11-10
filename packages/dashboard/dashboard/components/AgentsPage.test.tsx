import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { forgetRemembered } from '../lib/use-async.js'

const rpc = vi.hoisted(() => ({ onAgentsList: vi.fn(), sendSaveAgent: vi.fn(), sendRemoveAgent: vi.fn(), onAgentLogins: vi.fn(), sendCopyAgentLogins: vi.fn() }))
vi.mock('../rpc/agents.js', () => rpc)
const logins = vi.hoisted(() => ({ onGitHosts: vi.fn(), sendGitHostLogin: vi.fn(), sendStopGitHostLogin: vi.fn(), sendGitHostInstall: vi.fn(), onAgentState: vi.fn(), sendAgentFix: vi.fn() }))
vi.mock('../rpc/logins.js', () => logins)
const route = vi.hoisted(() => ({ openAgents: vi.fn() }))
vi.mock('../lib/use-route.js', () => route)
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
  route.openAgents.mockReset()
})

describe('the Agents page', () => {
  test('one card per agent, the default first and marked; each with its skills and the accounts it works as, the computer’s where it names none', async () => {
    render(<AgentsPage />)
    const cards = await screen.findAllByRole('region')
    expect(cards.map(card => card.getAttribute('aria-label'))).toEqual(['Default', 'Reviewer'])
    expect(within(cards[0]!).getByText(/the agent a session is on unless you pick another/)).toBeTruthy()
    expect(within(cards[0]!).getByText('GitHub: whatever the computer uses')).toBeTruthy()
    expect(within(cards[1]!).getByText('@octo-agent on GitHub · Claude: Dani')).toBeTruthy()
    expect(within(cards[1]!).getByText('readability')).toBeTruthy()
    // An agent set to never pick up the project's own skills says so after its list; the default does not.
    expect(within(cards[1]!).getByText('· no project skills')).toBeTruthy()
    expect(within(cards[0]!).queryByText('· no project skills')).toBeNull()
    // The default is never removed.
    expect(within(cards[0]!).queryByRole('button', { name: 'Remove Default' })).toBeNull()
    expect(within(cards[1]!).getByRole('button', { name: 'Remove Reviewer' })).toBeTruthy()
  })

  test('a new agent: its name, the skills ticked from the list, the two every agent starts with ticked already; saved as the dashboard’s call, and the list read again', async () => {
    render(<AgentsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'New agent' }))
    const editor = screen.getByRole('dialog', { name: 'New agent' })
    expect((within(editor).getByLabelText('ask') as HTMLInputElement).getAttribute('aria-checked') ?? (within(editor).getByLabelText('ask') as HTMLInputElement).checked.toString()).toMatch(/true/)
    fireEvent.change(within(editor).getByLabelText('Name'), { target: { value: 'Social Media' } })
    fireEvent.click(within(editor).getByLabelText('ux'))
    fireEvent.click(within(editor).getByLabelText('Claude account Dani'))
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(rpc.sendSaveAgent).toHaveBeenCalledWith({ name: 'Social Media', skills: ['ask', 'github', 'ux'], accounts: { claude: ['Dani'] }, projectSkills: true }))
    await waitFor(() => expect(rpc.onAgentsList).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('dialog', { name: 'New agent' })).toBeNull()
  })

  test('an agent edited in place keeps its id; a refusal is said under the editor and nothing closes', async () => {
    rpc.sendSaveAgent.mockResolvedValue({ ok: false, error: 'OpenAgent has no GitHub account stranger on this computer.' })
    render(<AgentsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Reviewer' }))
    const editor = screen.getByRole('dialog', { name: 'Editing Reviewer' })
    fireEvent.click(within(editor).getByLabelText('readability'))
    // Its project-skills tick is off as its record says; ticked on, the save says so.
    expect(within(editor).getByLabelText('Project skills').getAttribute('aria-checked')).toBe('false')
    fireEvent.click(within(editor).getByLabelText('Project skills'))
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(rpc.sendSaveAgent).toHaveBeenCalledWith({ id: 'reviewer', name: 'Reviewer', skills: ['ask'], accounts: { github: 'octo-agent', claude: ['Dani'] }, projectSkills: true }))
    expect((await within(editor).findByRole('alert')).textContent).toContain('no GitHub account stranger')
    // The default's name is not for editing.
    fireEvent.click(within(editor).getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Default' }))
    expect((screen.getByLabelText('Name') as HTMLInputElement).disabled).toBe(true)
    // An agent that names no account: one plain item, not the computer's account repeated.
    expect(screen.getByLabelText('GitHub account').textContent).toBe('None — whatever the computer uses')
  })

  test('with no GitHub account of OpenAgent\u2019s yet, one is added from the editor, in its dialog, and is then the one picked; what was typed stays', async () => {
    const github = (accounts: string[]) => ({ hosts: [{ host: 'github.com', projects: [], provider: { name: 'GitHub', requestWord: 'pull request', tool: 'gh', installed: true, install: 'brew install gh', accounts: accounts.map(login => ({ login, runs: true, ok: true })) } }] })
    rpc.onAgentsList.mockResolvedValue({ ...VIEW, github: { host: 'github.com', accounts: [] } })
    logins.onGitHosts.mockResolvedValue(github([]))
    logins.sendGitHostLogin.mockResolvedValue({ ok: true, code: 'ABCD-1234', url: 'https://github.com/login/device' })
    logins.sendStopGitHostLogin.mockResolvedValue({ ok: true })
    render(<AgentsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'New agent' }))
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

  test('the editor is a dialog over the page: the agent\u2019s card stays under it, a click beside it closes nothing, and it says what every project run gets besides', async () => {
    render(<AgentsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Reviewer' }))
    const editor = screen.getByRole('dialog', { name: 'Editing Reviewer' })
    expect(screen.getByRole('region', { name: 'Reviewer', hidden: true })).toBeTruthy()
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
    expect([...where.querySelectorAll('li')].map(li => li.textContent).slice(0, 3)).toEqual(['on Droplet', 'Laptop: not copied — GitHub did not take the login', 'Studio: not reached'])
    fireEvent.click(within(where).getByRole('button', { name: 'Copy again' }))
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
    expect(screen.getByRole('tooltip').textContent).toBe('This session is on the agent Reviewer: 2 skills, as @octo-agent on GitHub')
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: /^Default/ }))
    expect(onPick).toHaveBeenCalledWith('default')
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Manage agents…' }))
    expect(route.openAgents).toHaveBeenCalled()
  })
})
