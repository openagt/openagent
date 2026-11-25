import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { forgetRemembered, usePolled } from '../lib/use-async.js'
import { pluginsAgain } from '../lib/plugins-switched.js'
import { HostServicesContext, INERT_HOST_SERVICES } from '../lib/host-services.js'
import type { ReactNode } from 'react'

const onComputerPlugins = vi.hoisted(() => vi.fn())
const onProjectPlugins = vi.hoisted(() => vi.fn())
const sendSwitchPlugin = vi.hoisted(() => vi.fn())
vi.mock('../rpc/plugins.js', () => ({ onComputerPlugins, onProjectPlugins, sendSwitchPlugin }))
const onModules = vi.hoisted(() => vi.fn())
vi.mock('../rpc/modules.js', () => ({ onModules }))
// A module's read of what the plugins give, which reads again when one is switched (a Skills count).
const onSkillChoices = vi.fn()

const { ComputerPluginsSettings, ProjectPluginsSettings } = await import('./PluginsSettings.js')
const { useModules } = await import('../lib/use-modules.js')

afterEach(() => {
  cleanup()
  forgetRemembered()
  onComputerPlugins.mockReset()
  onProjectPlugins.mockReset()
  sendSwitchPlugin.mockReset()
  onModules.mockReset()
  onSkillChoices.mockReset()
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

  test("a switch is seen at once wherever the plugins' state is read: the sidebar's pages and the Overview's cards (the modules), the Skills count, the first group's rows", async () => {
    onProjectPlugins.mockResolvedValue([row('tickets', true)])
    onComputerPlugins.mockResolvedValue([{ ...row('discord', false), scope: 'person' }])
    onModules.mockResolvedValue([])
    onSkillChoices.mockResolvedValue({ core: [], plugins: [] })
    sendSwitchPlugin.mockResolvedValue({ ok: true })
    function Page() {
      useModules()
      usePolled(() => onSkillChoices(), undefined, 30_000, [], undefined, pluginsAgain)
      return (
        <>
          <ComputerPluginsSettings />
          <ProjectPluginsSettings projectId="p1" />
        </>
      )
    }
    render(<Page />)
    const tickets = await screen.findByRole('switch', { name: 'tickets' })
    await waitFor(() => expect(onModules).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(onSkillChoices).toHaveBeenCalledTimes(1))
    expect(onComputerPlugins).toHaveBeenCalledTimes(1)
    fireEvent.click(tickets)
    await waitFor(() => expect(sendSwitchPlugin).toHaveBeenCalledWith('tickets', false, 'p1'))
    // Long before their next poll.
    await waitFor(() => expect(onModules).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(onSkillChoices).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(onComputerPlugins).toHaveBeenCalledTimes(2))
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
    onComputerPlugins.mockResolvedValue([{ ...row('discord', false), scope: 'person' }])
    sendSwitchPlugin.mockResolvedValue({ ok: true })
    render(<ComputerPluginsSettings />)
    fireEvent.click(await screen.findByRole('switch', { name: 'discord' }))
    await waitFor(() => expect(sendSwitchPlugin).toHaveBeenCalledWith('discord', true, undefined))
    cleanup()
    onComputerPlugins.mockResolvedValue([])
    render(<ComputerPluginsSettings />)
    expect(await screen.findByText('No plugin is kept per person or per computer.')).toBeTruthy()
  })

  test('a git store, which keeps its own row, says how it stands and leads to the entry it is switched on, in the project for one kept per project; it is no switch', async () => {
    const openSettings = vi.fn()
    const withServices = (ui: ReactNode) => render(<HostServicesContext.Provider value={{ ...INERT_HOST_SERVICES, openSettings }}>{ui}</HostServicesContext.Provider>)
    onComputerPlugins.mockResolvedValue([{ ...row('store-git-repository', false), scope: 'computer', settings: 'agent-data' }])
    withServices(<ComputerPluginsSettings />)
    expect(await screen.findByText('The store-git-repository plugin. Off.')).toBeTruthy()
    expect(screen.queryByRole('switch', { name: 'store-git-repository' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Switch on…' }))
    expect(openSettings).toHaveBeenCalledWith('agent-data', undefined)
    cleanup()
    onProjectPlugins.mockResolvedValue([{ ...row('store-git-branch', true), settings: 'project-agent-data' }])
    withServices(<ProjectPluginsSettings projectId="p1" />)
    expect(await screen.findByText('The store-git-branch plugin. On.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Change…' }))
    expect(openSettings).toHaveBeenLastCalledWith('project-agent-data', 'p1')
    expect(sendSwitchPlugin).not.toHaveBeenCalled()
  })
})
