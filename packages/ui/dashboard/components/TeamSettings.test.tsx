import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TeamContext, type TeamState } from '../lib/team.js'
import { TeamSettings } from './TeamSettings.js'
import { TeamSignInPage } from './TeamSignIn.js'

// Team mode's pages: the sign-in a browser not signed in gets, and Settings › Team. The server is
// played by a fetch that answers `/_team/*` as src/team/team-gate.ts does.

const DANI = { login: 'nitedani', id: 1, name: 'Dani' }
const SULEIMAN = { login: 'suleimansh', id: 2, name: 'Suleiman Shahbari' }
const CODE = { id: 'abc', userCode: 'K7QM-2XRD', verificationUri: 'https://github.com/login/device', expiresIn: 900, interval: 0 }

let answers: Record<string, unknown[]>
/** How long the server takes to answer a path (ms). */
let slow: Record<string, number>
const calls: { path: string; body: unknown }[] = []
const reload = vi.fn()

beforeEach(() => {
  answers = {}
  slow = {}
  calls.length = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace('/_team', '')
      calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (slow[path]) await new Promise(resolve => setTimeout(resolve, slow[path]))
      const queue = answers[path] ?? []
      const answer = queue.length > 1 ? queue.shift() : queue[0]
      return new Response(JSON.stringify(answer ?? { error: 'no answer' }), { headers: { 'content-type': 'application/json' } })
    }),
  )
  Object.defineProperty(window, 'location', { value: { ...window.location, reload }, configurable: true })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  reload.mockReset()
})

function inTeam(team: TeamState, node: React.ReactNode) {
  return render(<TeamContext.Provider value={{ team, reload: async () => {} }}>{node}</TeamContext.Provider>)
}

describe('the sign-in page', () => {
  test('asks GitHub for a code, shows it with GitHub’s page, and goes on by itself once GitHub says yes', async () => {
    answers['/sign-in'] = [CODE]
    answers['/sign-in/wait'] = [{ state: 'pending', interval: 0 }, { state: 'done', person: SULEIMAN }]
    render(<TeamSignInPage team={{ on: true, name: 'experiment', owner: DANI }} />)
    expect(screen.getByText('Sign in to experiment')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with GitHub' }))
    expect(await screen.findByText('K7QM-2XRD')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open github.com/login/device' }).getAttribute('href')).toBe('https://github.com/login/device')
    await waitFor(() => expect(reload).toHaveBeenCalled())
    expect(calls.find(c => c.path === '/sign-in')?.body).toEqual({ turnOn: false })
  })

  test('someone the owner has not added is told whom to ask', async () => {
    answers['/sign-in'] = [CODE]
    answers['/sign-in/wait'] = [{ state: 'not-member', login: 'jo-dev', owner: 'nitedani' }]
    render(<TeamSignInPage team={{ on: true, name: 'experiment', owner: DANI }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with GitHub' }))
    expect(await screen.findByText('@jo-dev isn’t on this machine’s team')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('Ask Dani (@nitedani) to add jo-dev in Settings › Team')
    expect(reload).not.toHaveBeenCalled()
  })
})

describe('Settings › Team', () => {
  test('off: the switch turns it on by signing in, as the owner', async () => {
    answers['/sign-in'] = [CODE]
    answers['/sign-in/wait'] = [{ state: 'done', person: DANI }]
    inTeam({ on: false }, <TeamSettings />)
    expect(screen.queryByRole('button', { name: 'Sign in with GitHub' })).toBeNull()
    fireEvent.click(screen.getByRole('switch'))
    expect(screen.getByText('Sign in with GitHub first')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with GitHub' }))
    await waitFor(() => expect(reload).toHaveBeenCalled())
    expect(calls.find(c => c.path === '/sign-in')?.body).toEqual({ turnOn: true })
  })

  test('drawn again while it waits, as Settings is, GitHub’s yes is not lost', async () => {
    answers['/sign-in'] = [CODE]
    // GitHub says yes to the first asking, while the page is drawn again; a second asking would find the code used.
    answers['/sign-in/wait'] = [{ state: 'done', person: DANI }, { state: 'ended', reason: 'The code ran out. Start again.' }]
    slow['/sign-in/wait'] = 60
    const drawn = inTeam({ on: false }, <TeamSettings />)
    fireEvent.click(screen.getByRole('switch'))
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with GitHub' }))
    await screen.findByText('K7QM-2XRD')
    await new Promise(resolve => setTimeout(resolve, 20))
    drawn.rerender(
      <TeamContext.Provider value={{ team: { on: false }, reload: async () => {} }}>
        <TeamSettings />
      </TeamContext.Provider>,
    )
    await waitFor(() => expect(reload).toHaveBeenCalled())
    expect(screen.queryByText('The code ran out. Start again.')).toBeNull()
  })

  test('on, for the owner: the team, a way to add and remove people, and the switch', async () => {
    answers['/members/add'] = [{ ok: true }]
    const team: TeamState = { on: true, name: 'experiment', owner: DANI, person: DANI, members: [{ login: 'suleimansh', added: '2026-11-27T10:00:00Z', person: SULEIMAN, signedIn: new Date().toISOString() }, { login: 'brillout', added: '2026-11-27T10:00:00Z' }] }
    inTeam(team, <TeamSettings />)
    const rows = screen.getAllByRole('listitem').map(row => row.textContent)
    expect(rows[0]).toContain('Dani@nitedani · owner')
    expect(rows[1]).toMatch(/Suleiman Shahbari@suleimansh · signed in/)
    expect(rows[2]).toContain('brillout@brillout · not signed in yet')
    expect((screen.getByRole('switch') as HTMLButtonElement).getAttribute('aria-disabled')).not.toBe('true')
    fireEvent.change(screen.getByRole('textbox', { name: 'GitHub username' }), { target: { value: 'jo-dev' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add teammate' }))
    await waitFor(() => expect(calls.find(c => c.path === '/members/add')?.body).toEqual({ login: 'jo-dev' }))
  })

  test('on, for a teammate: the team, and nothing to change', () => {
    const team: TeamState = { on: true, name: 'experiment', owner: DANI, person: SULEIMAN, members: [{ login: 'suleimansh', added: '2026-11-27T10:00:00Z', person: SULEIMAN }] }
    inTeam(team, <TeamSettings />)
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.queryByRole('textbox', { name: 'GitHub username' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'More for @suleimansh' })).toBeNull()
    expect(screen.getByText('Only @nitedani changes this.')).toBeTruthy()
    expect(screen.queryByText(/Locked out\?/)).toBeNull()
  })
})
