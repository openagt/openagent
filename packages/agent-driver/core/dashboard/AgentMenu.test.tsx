import { useState } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { RunOptions } from '@openagt/hooks'
import { effortLabel, forgetRemembered, type ModuleCallResult, type UiComposerIn } from '@openagt/ui/module'
import { fakeHost, renderWithHost } from '@openagt/ui/module/testing'
import { AgentControl, AgentMenu, ModelWords, type MenuAgent } from './AgentMenu.js'

afterEach(() => {
  cleanup()
  forgetRemembered()
  localStorage.clear()
})

const LOGO = '<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>'

const agents: MenuAgent[] = [
  { value: 'claude', label: 'Claude Code', logo: LOGO, models: [{ value: 'opus', label: 'Opus' }], modelsNote: 'No models listed' },
  { value: 'codex', label: 'Codex', models: [{ value: 'gpt-5-codex', label: 'GPT-5 Codex' }], modelsNote: 'No models listed' },
]

function renderMenu(over: Partial<Parameters<typeof AgentMenu>[0]> = {}) {
  const onChange = vi.fn()
  render(<AgentMenu agents={agents} driver="claude" model="opus" onChange={onChange} busy={false} {...over} />)
  return { onChange }
}

/** A mark drawn from the SVG an agent says: a mask in the text's colour. */
const isMark = (el: Element | null | undefined): boolean => el instanceof HTMLElement && el.getAttribute('aria-hidden') === 'true' && el.style.maskImage.startsWith('url("data:image/svg+xml')

describe('the model as the row under the box says it', () => {
  test("the coding agent's mark, the model's name, and how hard it thinks smaller and quieter on the line's middle, neither raised nor a badge", () => {
    const { container } = render(<ModelWords logo={LOGO} name="Opus 5.5" effort="High" />)
    expect([...container.children].map(part => part.textContent)).toEqual(['', 'Opus 5.5', 'High'])
    expect(isMark(container.firstElementChild)).toBe(true)
    expect(screen.getByText('Opus 5.5').className.split(' ')).toEqual(expect.arrayContaining(['font-medium', 'text-foreground']))
    const effort = screen.getByText('High')
    expect(effort.className.split(' ')).toEqual(expect.arrayContaining(['text-xs', 'text-muted-foreground']))
    expect(effort.tagName).toBe('SPAN')
    expect(effort.className).not.toMatch(/rounded|bg-|align-super|-translate-y/)
  })

  test('each part only when there is one: no mark, no name, no effort', () => {
    const { container, rerender } = render(<ModelWords name="Opus 5.5" />)
    expect(container.textContent).toBe('Opus 5.5')
    expect(container.childElementCount).toBe(1)
    rerender(<ModelWords />)
    expect(container.innerHTML).toBe('')
  })

  test("the menu's button says them the same way; an agent with no mark is named in words before its model", () => {
    renderMenu({ effort: { levels: ['low', 'high'], level: 'high', onChange: () => {} } })
    const trigger = screen.getByRole('button')
    expect(screen.getByText('Opus').className).toContain('font-medium')
    expect(trigger.querySelector('.text-xs')!.textContent).toBe(effortLabel('high'))
    cleanup()
    renderMenu({ driver: 'codex', model: 'gpt-5-codex' })
    expect(screen.getByText('Codex GPT-5 Codex')).toBeTruthy()
  })
})

describe('the agent and model tree (#658)', () => {
  test("the trigger shows the agent's mark and the model, and its hover names the agent", () => {
    renderMenu()
    const trigger = screen.getByRole('button')
    expect(isMark(trigger.firstElementChild)).toBe(true)
    expect(trigger.textContent).toContain('Opus')
    // The mark is the only thing naming the agent on the trigger, so its name spells it out.
    expect(trigger.getAttribute('aria-label')).toContain('Claude Code')
  })

  test('with no model picked, the trigger says "Default": never a mark alone', () => {
    renderMenu({ model: undefined })
    expect(screen.getByRole('button').textContent).toContain('Default')
  })

  test('picking a model within an agent sets both the agent and the model', () => {
    const { onChange } = renderMenu()
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByText('Codex'))
    fireEvent.click(screen.getByText('GPT-5 Codex'))
    expect(onChange).toHaveBeenCalledWith('codex', 'gpt-5-codex')
  })

  test("each agent's submenu shows only its own models", () => {
    renderMenu({ model: '' })
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByText('Claude Code'))
    expect(screen.getByText('Opus')).toBeTruthy()
    expect(screen.queryByText('GPT-5 Codex')).toBeNull()
  })

  test('with no model pinned the trigger names no model, rather than the first one (#1143), and is named for assistive tech all the same', () => {
    renderMenu({ model: '' })
    const trigger = screen.getByRole('button', { name: "Coding agent: Claude Code · Model: the coding agent's default" })
    expect(trigger.textContent).not.toContain('Opus')
  })

  test('a model the agent does not list is named by its id, since the run is still given it', () => {
    renderMenu({ model: 'fable' })
    const trigger = screen.getByRole('button')
    expect(trigger.textContent).toContain('fable')
    expect(trigger.getAttribute('aria-label')).toContain('Model: fable')
  })

  test('an agent with no models says why in its submenu', () => {
    renderMenu({ agents: [{ value: 'claude', label: 'Claude Code', models: [], modelsNote: 'Claude Code is not installed.' }] })
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByText('Claude Code'))
    expect(screen.getByText('Claude Code is not installed.')).toBeTruthy()
  })
})

// How hard the model may think, in the same menu as the model: the levels are the agent's own, so
// the menu invents none of them and has no effort part for a model that offers none.
describe('the effort, in the model menu', () => {
  const effort = (over: Partial<{ levels: string[]; level: string; onChange: (level: string | undefined) => void }> = {}) => ({ levels: ['low', 'medium', 'high'], onChange: vi.fn(), ...over })

  test('a model that offers no level has no effort part, and its trigger names no effort', () => {
    renderMenu({ effort: effort({ levels: [] }) })
    const trigger = screen.getByRole('button')
    expect(trigger.getAttribute('aria-label')).not.toContain('Effort')
    fireEvent.click(trigger)
    expect(screen.queryByText('Effort')).toBeNull()
  })

  test("the trigger says the level after the model, and the menu lists the model's own levels under the coding agent's default, the one in force checked", () => {
    const picked = effort({ level: 'high' })
    renderMenu({ effort: picked })
    const trigger = screen.getByRole('button')
    expect(trigger.textContent).toBe('OpusHigh')
    expect(trigger.getAttribute('aria-label')).toBe('Coding agent: Claude Code · Model: Opus · Effort: High')
    fireEvent.click(trigger)
    const items = ["The coding agent's default", 'Low', 'Medium', 'High'].map(name => screen.getByRole('menuitem', { name }))
    expect(items.map(item => item.firstElementChild!.classList.contains('opacity-100'))).toEqual([false, false, false, true])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Medium' }))
    expect(picked.onChange).toHaveBeenCalledWith('medium')
  })

  test('with no level picked the trigger names the model alone, and the first item clears a pick', () => {
    const picked = effort()
    renderMenu({ effort: picked })
    const trigger = screen.getByRole('button')
    expect(trigger.textContent).toBe('Opus')
    expect(trigger.getAttribute('aria-label')).toContain("Effort: the coding agent's default")
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: "The coding agent's default" }))
    expect(picked.onChange).toHaveBeenCalledWith(undefined)
  })
})

// The control as the shell draws it under the message box, on a host whose server part answers
// what this computer has: the agents with their models, the pick for every next run, the accounts.
const OFFERED = [
  { id: 'claude-code', label: 'Claude Code', logo: LOGO, list: 'claude', models: { models: [{ id: 'opus', name: 'Opus 5.5', efforts: ['low', 'high'] }] } },
  { id: 'codex', label: 'Codex', list: 'codex', models: { models: [{ id: 'gpt-5.6', name: 'GPT-5.6' }] } },
]
const LISTED = { claude: [{ name: 'This computer', who: 'Ada', own: true }, { name: 'Dani', own: false }], codex: [], notInstalled: [] }
const USED = { claude: [{ name: 'This computer', windows: [{ window: 'five_hour', percentUsed: 3 }, { window: 'seven_day', percentUsed: 22 }] }, { name: 'Dani', windows: [{ window: 'seven_day', percentUsed: 61.4 }] }], codex: [] }

function hostFor(over: Record<string, unknown> = {}) {
  const answers: Record<string, unknown> = { agents: OFFERED, picked: {}, list: LISTED, usage: USED, pick: {}, ...over }
  const callComputer = vi.fn(async (name: string, _input: object): Promise<ModuleCallResult> => (name in answers ? { ok: true, output: answers[name] } : { ok: false, error: `no ${name}` }))
  const runComputerCommand = vi.fn(async () => ({ ok: true as const, output: { ok: true } }))
  return { host: fakeHost('@openagt/agent-driver', { callComputer, runComputerCommand }), callComputer, runComputerCommand }
}

/** The control in a box, holding the options it changes, as the shell does. */
function Box({ box, start = {}, seen }: { box: UiComposerIn; start?: RunOptions; seen?: (options: RunOptions) => void }) {
  const [options, setOptions] = useState<RunOptions>(start)
  return (
    <AgentControl
      in={box}
      options={options}
      onChange={next => {
        setOptions(next)
        seen?.(next)
      }}
      busy={false}
      say={() => {}}
    />
  )
}

const trigger = () => screen.findByRole('button', { name: /^Coding agent: / })

describe('the control under the message box', () => {
  test('in the launcher it shows the agent picked for every next run; a pick is the next run\'s option, and every next run\'s on this computer', async () => {
    const { host, callComputer } = hostFor({ picked: { driver: 'codex', model: 'gpt-5.6' } })
    const seen = vi.fn()
    renderWithHost(<Box box="launcher" seen={seen} />, host)
    await waitFor(async () => expect((await trigger()).getAttribute('aria-label')).toBe('Coding agent: Codex · Model: GPT-5.6'))
    fireEvent.click(await trigger())
    fireEvent.click(screen.getByRole('menuitem', { name: /Claude Code/ }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Opus 5.5' }))
    expect(seen).toHaveBeenLastCalledWith({ 'agent-driver': { driver: 'claude-code', model: 'opus' } })
    await waitFor(() => expect(callComputer).toHaveBeenCalledWith('pick', { driver: 'claude-code', model: 'opus' }))
    // The model's own levels; a level picked goes with the run's options too.
    fireEvent.click(await trigger())
    fireEvent.click(await screen.findByRole('menuitem', { name: 'High' }))
    expect(seen).toHaveBeenLastCalledWith({ 'agent-driver': { driver: 'claude-code', model: 'opus', effort: 'high' } })
  })

  test("an agent's row says the account its runs take first; its part lists its models, then its accounts, which put another first, or add one", async () => {
    const { host, runComputerCommand } = hostFor()
    renderWithHost(<Box box="launcher" />, host)
    fireEvent.click(await trigger())
    const row = await screen.findByRole('menuitem', { name: /Claude Code/ })
    await waitFor(() => expect(row.textContent).toBe('Claude CodeAda·22%'))
    fireEvent.click(row)
    const part = (await screen.findByText('Accounts')).closest('[role=menu]')!
    expect([...part.querySelectorAll('[role=menuitem]')].map(item => item.textContent)).toEqual(['Opus 5.5', 'Ada22%', 'Dani61%', 'Add account…'])
    fireEvent.click(screen.getByRole('menuitem', { name: /Dani/ }))
    await waitFor(() => expect(runComputerCommand).toHaveBeenCalledWith(['use-first', 'claude', 'Dani'], 'account-rotation'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add account…' }))
    expect(host.openPage).toHaveBeenCalledWith('permissions')
  })

  test('an agent with no account read, or whose program is not here, has no accounts part', async () => {
    const { host } = hostFor({ agents: [OFFERED[0], { ...OFFERED[1], models: { models: [], error: '`codex` not found', missing: true } }], list: { claude: [], codex: [{ name: 'This computer', who: 'Ada L', own: true }], notInstalled: ['codex'] } })
    renderWithHost(<Box box="launcher" />, host)
    fireEvent.click(await trigger())
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(screen.getByRole('menuitem', { name: /Codex/ }).textContent).toBe('Codex')
    expect(screen.getByRole('menuitem', { name: /Claude Code/ }).textContent).toBe('Claude Code')
  })

  test('in a session it says the agent and model the record keeps, in words, and is no button', async () => {
    const { host } = hostFor()
    const { container } = renderWithHost(<Box box="session" start={{ 'agent-driver': { driver: 'claude-code', model: 'opus', effort: 'high' } }} />, host)
    const said = await screen.findByText('Opus 5.5')
    expect(said.closest('button')).toBeNull()
    expect(isMark(said.previousElementSibling)).toBe(true)
    expect(screen.getByText('High').className).toContain('text-xs')
    cleanup()
    renderWithHost(<Box box="session" />, host)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(container.textContent).toBe('')
  })

  test('in a profile it picks the profile\'s agent and its accounts: "Every account" is ticked while none is picked, ticking one leaves it, ticking it again drops the picks', async () => {
    const { host } = hostFor()
    const seen = vi.fn()
    renderWithHost(<Box box="profile" start={{ 'agent-driver': { claude: ['Dani'] } }} seen={seen} />, host)
    const checked = (name: string) => screen.getByLabelText(name).getAttribute('aria-checked')
    await waitFor(() => expect([checked('Every Claude Code account, also new ones'), checked('Claude Code account Dani')]).toEqual(['false', 'true']))
    fireEvent.click(screen.getByLabelText('Every Claude Code account, also new ones'))
    expect(seen).toHaveBeenLastCalledWith({})
    fireEvent.click(screen.getByLabelText('Claude Code account Ada'))
    expect(seen).toHaveBeenLastCalledWith({ 'agent-driver': { claude: ['This computer'] } })
    // The profile's agent and model are its own, never every next run's.
    fireEvent.click(await trigger())
    fireEvent.click(screen.getByRole('menuitem', { name: /Codex/ }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'GPT-5.6' }))
    expect(seen).toHaveBeenLastCalledWith({ 'agent-driver': { claude: ['This computer'], driver: 'codex', model: 'gpt-5.6' } })
    expect(host.callComputer).not.toHaveBeenCalledWith('pick', expect.anything())
  })

  test("this computer's own login, logged out, is offered to a profile only while it is picked, and says so", async () => {
    const { host } = hostFor({ list: { claude: [{ name: 'This computer', own: true, signedOut: true }, { name: 'Dani', own: false }], codex: [], notInstalled: [] } })
    renderWithHost(<Box box="profile" />, host)
    expect(await screen.findByLabelText('Claude Code account Dani')).toBeTruthy()
    expect(screen.queryByLabelText(/This computer/)).toBeNull()
    cleanup()
    renderWithHost(<Box box="profile" start={{ 'agent-driver': { claude: ['This computer'] } }} />, host)
    expect((await screen.findByLabelText('Claude Code account This computer, not logged in')).getAttribute('aria-checked')).toBe('true')
    expect(within(document.body).getByLabelText('Claude Code account Dani')).toBeTruthy()
  })
})
