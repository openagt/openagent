import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { forgetRemembered } from '../lib/use-async.js'

const onPerson = vi.hoisted(() => vi.fn())
vi.mock('../rpc/person.js', () => ({ onPerson }))
const onAttention = vi.hoisted(() => vi.fn())
vi.mock('../rpc/attention.js', () => ({ onAttention }))
const openPage = vi.hoisted(() => vi.fn())
const openSettings = vi.hoisted(() => vi.fn())
vi.mock('../lib/host-services.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/host-services.js')>()
  return { ...actual, INERT_HOST_SERVICES: { ...actual.INERT_HOST_SERVICES, openPage, openSettings } }
})
// The menu's theme row has its own suite; here it is the row's name.
vi.mock('./ThemeSubmenu.js', () => ({ ThemeSubmenu: () => <div role="menuitem">Theme</div> }))

const { PersonMenu, firstName } = await import('./PersonMenu.js')

beforeEach(() => {
  onAttention.mockResolvedValue({ items: [], whole: true })
})

afterEach(() => {
  cleanup()
  forgetRemembered()
  onPerson.mockReset()
  onAttention.mockReset()
  openSettings.mockReset()
})

describe('PersonMenu', () => {
  test('the person\'s row: their picture and first name, opening their whole name, the theme and Settings', async () => {
    onPerson.mockResolvedValue({ name: 'Ada Lovelace', login: 'ada', avatar: 'https://avatars.githubusercontent.com/u/1' })
    const onSettings = vi.fn()
    const { container } = render(<PersonMenu onSettings={onSettings} />)
    const row = await screen.findByRole('button', { name: 'Ada Lovelace: settings' })
    expect(row.textContent).toBe('Ada')
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://avatars.githubusercontent.com/u/1')
    fireEvent.click(row)
    expect(screen.getByText('Ada Lovelace')).toBeTruthy()
    expect(screen.getByText('@ada')).toBeTruthy()
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Theme', 'Settings'])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Settings' }))
    expect(onSettings).toHaveBeenCalledTimes(1)
  })

  test('no accounts are in it: they are picked beside the message box, for the computer the run goes to', async () => {
    onPerson.mockResolvedValue({ name: 'Ada Lovelace', login: 'ada' })
    render(<PersonMenu onSettings={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Ada Lovelace: settings' }))
    await waitFor(() => expect(onAttention).toHaveBeenCalled())
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Theme', 'Settings'])
  })

  test('drawn again, as a phone draws its sidebar at each opening, the row shows the person at once, while they are asked again', async () => {
    onPerson.mockResolvedValue({ name: 'Ada Lovelace', login: 'ada' })
    const first = render(<PersonMenu onSettings={() => {}} />)
    await screen.findByRole('button', { name: 'Ada Lovelace: settings' })
    first.unmount()
    onPerson.mockImplementation(() => new Promise(() => {}))
    render(<PersonMenu onSettings={() => {}} />)
    expect(screen.getByRole('button', { name: 'Ada Lovelace: settings' })).toBeTruthy()
  })

  test('with no picture, or one that does not load, their initials', async () => {
    onPerson.mockResolvedValue({ name: 'Ada Lovelace', avatar: 'https://example.com/gone.png' })
    const { container } = render(<PersonMenu onSettings={() => {}} />)
    await screen.findByRole('button', { name: 'Ada Lovelace: settings' })
    fireEvent.error(container.querySelector('img')!)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('AL')).toBeTruthy()
  })

  test('the first name is the first word; a one-word name, a login say, is itself', () => {
    expect(firstName('Suleiman Shahbari')).toBe('Suleiman')
    expect(firstName('  Ada King Lovelace ')).toBe('Ada')
    expect(firstName('suleimansh')).toBe('suleimansh')
  })

  test('with no picture, the two letters the person\u2019s runs are marked with: a one-word name is its first two', async () => {
    onPerson.mockResolvedValue({ name: 'Demo' })
    render(<PersonMenu onSettings={() => {}} />)
    await screen.findByRole('button', { name: 'Demo: settings' })
    expect(screen.getByText('DE')).toBeTruthy()
  })
})

describe('PersonMenu: what is missing', () => {
  test('something runs need is missing: a dot on the picture, and the menu says first what fixes it, opening where it is fixed', async () => {
    onPerson.mockResolvedValue({ name: 'Ada Lovelace', login: 'ada' })
    onAttention.mockResolvedValue({ items: [{ kind: 'setup', scope: 'computer', id: 'no-account', words: 'Connect GitHub', fix: { label: 'Add your GitHub account again…', href: '/permissions' }, module: 'github' }], whole: true })
    const onSettings = vi.fn()
    const { container } = render(<PersonMenu onSettings={onSettings} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Ada Lovelace: settings, something is missing' }))
    expect(container.ownerDocument.querySelector('[data-testid="missing-dot"]')).toBeTruthy()
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Add your GitHub account again…' }))
    expect(openPage).toHaveBeenCalledWith('permissions', [])
    expect(onSettings).not.toHaveBeenCalled()
  })

  test('a module says something on this computer needs setting up: a dot on the picture, and its fix in the menu, here opening its Settings entry', async () => {
    onPerson.mockResolvedValue({ name: 'Ada Lovelace' })
    onAttention.mockResolvedValue({ items: [{ kind: 'setup', scope: 'computer', id: 'not-backed-up', words: 'Your agent data is not backed up', fix: { label: 'Back up your agent data…', settings: 'agent-data' }, module: 'store-git-repository' }], whole: true })
    const { container } = render(<PersonMenu onSettings={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Ada Lovelace: settings, something is missing' }))
    expect(container.ownerDocument.querySelector('[data-testid="missing-dot"]')).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Back up your agent data…' }))
    expect(openSettings).toHaveBeenCalledWith('agent-data')
  })
})

describe('PersonMenu: what a module offers here', () => {
  test("a coding agent's newer version: a blue dot on the picture, and its update in the menu, said in full under the pointer; with something missing too, the dot is that one's", async () => {
    onPerson.mockResolvedValue({ name: 'Ada Lovelace' })
    const update = { kind: 'note', scope: 'computer', id: 'update:codex', words: 'Codex 0.172.0 is out', detail: 'Codex 0.172.0 is out. This computer has 0.171.0.', fix: { label: 'Update Codex to 0.172.0', href: '/permissions' }, module: 'agent-driver' }
    // A note with nothing to press, and one about a project, are not the menu's.
    const quiet = { kind: 'note', scope: 'computer', id: 'kept', words: 'Records kept here', module: 'store-filesystem' }
    onAttention.mockResolvedValue({ items: [update, quiet], whole: true })
    const { container, unmount } = render(<PersonMenu onSettings={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Ada Lovelace: settings, an update is out' }))
    expect(container.ownerDocument.querySelector('[data-testid="missing-dot"]')!.className).toContain('bg-info')
    const item = await screen.findByRole('menuitem', { name: 'Update Codex to 0.172.0' })
    expect(item.getAttribute('title')).toBe('Codex 0.172.0 is out. This computer has 0.171.0.')
    expect(screen.queryByRole('menuitem', { name: 'Records kept here' })).toBeNull()
    unmount()
    forgetRemembered()
    onAttention.mockResolvedValue({ items: [update, { kind: 'setup', scope: 'computer', id: 'x', words: 'Connect GitHub', module: 'github' }], whole: true })
    render(<PersonMenu onSettings={vi.fn()} />)
    await screen.findByRole('button', { name: 'Ada Lovelace: settings, something is missing' })
    expect(document.querySelector('[data-testid="missing-dot"]')!.className).toContain('bg-warning')
  })
})

describe('PersonMenu on a machine shared by a team', () => {
  test('the person is who signed in with GitHub, and the menu signs them out', async () => {
    onPerson.mockResolvedValue({ name: 'Computer Owner' })
    const { TeamContext } = await import('../lib/team.js')
    const team = { on: true as const, name: 'experiment', owner: { login: 'nitedani', id: 1 }, person: { login: 'suleimansh', id: 2, name: 'Suleiman Shahbari' }, members: [] }
    render(
      <TeamContext.Provider value={{ team, reload: async () => {} }}>
        <PersonMenu onSettings={() => {}} />
      </TeamContext.Provider>,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Suleiman Shahbari: settings' }))
    expect(screen.getByText('@suleimansh')).toBeTruthy()
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Theme', 'Settings', 'Sign out of experiment'])
  })
})
