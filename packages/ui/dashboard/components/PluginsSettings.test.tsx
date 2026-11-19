import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { forgetRemembered } from '../lib/use-async.js'

const onComputerPlugins = vi.hoisted(() => vi.fn())
const onProjectPlugins = vi.hoisted(() => vi.fn())
const sendSwitchPlugin = vi.hoisted(() => vi.fn())
vi.mock('../rpc/plugins.js', () => ({ onComputerPlugins, onProjectPlugins, sendSwitchPlugin }))

const { ComputerPluginsSettings, ProjectPluginsSettings } = await import('./PluginsSettings.js')

afterEach(() => {
  cleanup()
  forgetRemembered()
  onComputerPlugins.mockReset()
  onProjectPlugins.mockReset()
  sendSwitchPlugin.mockReset()
})

const row = (name: string, on: boolean) => ({ name, description: `The ${name} plugin.`, scope: 'project', on })

describe('Settings › Plugins', () => {
  test("a project's plugins, each a switch saying what it is; a switch saves at once in that project, and the rows are read again", async () => {
    onProjectPlugins.mockResolvedValueOnce([row('ask', true), row('tickets', false)]).mockResolvedValue([row('ask', true), row('tickets', true)])
    sendSwitchPlugin.mockResolvedValue({ ok: true })
    render(<ProjectPluginsSettings projectId="p1" />)
    const tickets = await screen.findByRole('switch', { name: 'tickets' })
    expect(screen.getByText('The tickets plugin.')).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'ask' }).getAttribute('aria-checked')).toBe('true')
    expect(tickets.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(tickets)
    await waitFor(() => expect(sendSwitchPlugin).toHaveBeenCalledWith('tickets', true, 'p1'))
    await waitFor(() => expect(screen.getByRole('switch', { name: 'tickets' }).getAttribute('aria-checked')).toBe('true'))
    expect(onProjectPlugins).toHaveBeenCalledWith('p1')
  })

  test('a switch that is refused says why', async () => {
    onProjectPlugins.mockResolvedValue([row('tickets', false)])
    sendSwitchPlugin.mockResolvedValue({ ok: false, error: 'tickets is switched in a project.' })
    render(<ProjectPluginsSettings projectId="p1" />)
    fireEvent.click(await screen.findByRole('switch', { name: 'tickets' }))
    expect(await screen.findByText('tickets is switched in a project.')).toBeTruthy()
  })

  test("a project of another computer's is switched there; the first group's plugins are the person's and the computer's", async () => {
    onProjectPlugins.mockResolvedValue(null)
    render(<ProjectPluginsSettings projectId="p1" />)
    expect(await screen.findByText(/plugins are switched on the computer the project is on/)).toBeTruthy()
    cleanup()
    onComputerPlugins.mockResolvedValue([{ ...row('store-git-repository', false), scope: 'computer' }])
    sendSwitchPlugin.mockResolvedValue({ ok: true })
    render(<ComputerPluginsSettings />)
    fireEvent.click(await screen.findByRole('switch', { name: 'store-git-repository' }))
    await waitFor(() => expect(sendSwitchPlugin).toHaveBeenCalledWith('store-git-repository', true, undefined))
    cleanup()
    onComputerPlugins.mockResolvedValue([])
    render(<ComputerPluginsSettings />)
    expect(await screen.findByText('No plugin is kept per person or per computer.')).toBeTruthy()
  })
})
