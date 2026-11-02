import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { effortLabel } from '../lib/effort.js'
import { DriverModelMenu, type DriverOption } from './DriverModelMenu.js'
import { hoverTooltip } from '../test-utils.js'

afterEach(cleanup)

const drivers: DriverOption[] = [
  {
    value: 'claude',
    label: 'Claude Code',
    icon: <svg data-testid="claude-logo" />,
    models: [{ value: 'opus', label: 'Opus' }],
  },
  {
    value: 'codex',
    label: 'Codex',
    models: [{ value: 'gpt-5-codex', label: 'GPT-5 Codex' }],
  },
]

function renderMenu(over: Partial<Parameters<typeof DriverModelMenu>[0]> = {}) {
  const onChange = vi.fn()
  render(<DriverModelMenu drivers={drivers} driver="claude" model="opus" onChange={onChange} busy={false} {...over} />)
  return { onChange }
}

describe('DriverModelMenu tree (#658)', () => {
  test('the trigger shows the current driver logo and model', async () => {
    renderMenu()
    const trigger = screen.getByRole('button')
    expect(trigger.querySelector('[data-testid="claude-logo"]')).toBeTruthy()
    expect(trigger.textContent).toContain('Opus')
    // The logo is the only thing naming the driver on the trigger, so hovering has to spell it out.
    expect((await hoverTooltip(trigger)).textContent).toContain('Claude Code')
  })

  test('picking a model within an driver sets both the driver and the model', () => {
    const { onChange } = renderMenu()
    fireEvent.click(screen.getByRole('button')) // open root
    fireEvent.click(screen.getByText('Codex')) // open the Codex submenu
    fireEvent.click(screen.getByText('GPT-5 Codex'))
    expect(onChange).toHaveBeenCalledWith('codex', 'gpt-5-codex')
  })

  test("each driver's submenu shows only its own models", () => {
    renderMenu({ model: '' }) // keep 'Opus' out of the trigger so we count only submenu items
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByText('Claude Code')) // Claude submenu
    expect(screen.getByText('Opus')).toBeTruthy() // Claude's own model
    expect(screen.queryByText('GPT-5 Codex')).toBeNull() // a Claude submenu never lists Codex models
  })

  test('with no model pinned the trigger names no model, rather than the first one (#1143)', async () => {
    // The list used to open with a "Default" entry storing an empty value, and the label fell back
    // to the first entry — so an unset preference read as whichever model happened to be listed
    // first. Naming a model the agent does not pass is the failure the ticket is about.
    renderMenu({ model: '' })
    const trigger = screen.getByRole('button')
    expect(trigger.textContent).not.toContain('Opus')
    expect((await hoverTooltip(trigger)).textContent).toContain("Model: the CLI's own default")
  })

  test('a model the driver does not list is named by its id, since the run is still given it', async () => {
    renderMenu({ driver: 'claude', model: 'fable' })
    const trigger = screen.getByRole('button')
    expect(trigger.textContent).toContain('fable')
    expect((await hoverTooltip(trigger)).textContent).toContain('Model: fable')
  })

  test('a driver with no models says why in its submenu', () => {
    renderMenu({ drivers: [{ value: 'claude', label: 'Claude Code', models: [], modelsNote: 'Asking Claude Code…' }] })
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByText('Claude Code'))
    expect(screen.getByText('Asking Claude Code…')).toBeTruthy()
  })

  test('the trigger is named for assistive tech even with nothing but a logo on it (#1143)', () => {
    renderMenu({ model: '' })
    // The rendered text is a logo and a chevron; without an explicit name this button says nothing.
    expect(screen.getByRole('button', { name: "Driver: Claude Code · Model: the CLI's own default" })).toBeTruthy()
  })
})

// How hard the model may think, in the same menu as the model: the levels are the agent's own, so
// the menu invents none of them and has no effort part for a model that offers none. The trigger
// says the level after the model, quieter, as Claude Code's "Opus 5.5 Medium".
describe('the effort, in the model menu', () => {
  const effort = (over: Partial<{ levels: string[]; level: string; onChange: (level: string | undefined) => void }> = {}) => ({ levels: ['low', 'medium', 'high'], onChange: vi.fn(), ...over })

  test('a model that offers no level has no effort part, and its trigger names no effort', () => {
    renderMenu({ effort: effort({ levels: [] }) })
    const trigger = screen.getByRole('button')
    expect(trigger.getAttribute('aria-label')).not.toContain('Effort')
    fireEvent.click(trigger)
    expect(screen.queryByText('Effort')).toBeNull()
  })

  test("the trigger says the level after the model, and the menu lists the model's own levels under the agent's default, the one in force checked", () => {
    const picked = effort({ level: 'high' })
    renderMenu({ effort: picked })
    const trigger = screen.getByRole('button')
    expect(trigger.textContent).toBe('OpusHigh')
    expect(trigger.getAttribute('aria-label')).toBe('Driver: Claude Code · Model: Opus · Effort: High')
    fireEvent.click(trigger)
    expect(screen.getByText('Effort')).toBeTruthy()
    const items = ['The agent’s default', 'Low', 'Medium', 'High'].map(name => screen.getByRole('menuitem', { name }))
    expect(items.map(item => item.querySelector('svg')!.getAttribute('class')).map(c => c?.includes('opacity-100'))).toEqual([false, false, false, true])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Medium' }))
    expect(picked.onChange).toHaveBeenCalledWith('medium')
  })

  test('with no level picked the trigger names the model alone, and the first item clears a pick', () => {
    const picked = effort()
    renderMenu({ effort: picked })
    const trigger = screen.getByRole('button')
    expect(trigger.textContent).toBe('Opus')
    expect(trigger.getAttribute('aria-label')).toContain('Effort: the agent’s default')
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: 'The agent’s default' }))
    expect(picked.onChange).toHaveBeenCalledWith(undefined)
  })

  test('a level reads as the agent writes it, capitalised, and the one id nobody says out loud is spelled', () => {
    expect(effortLabel('medium')).toBe('Medium')
    expect(effortLabel('ultra')).toBe('Ultra')
    expect(effortLabel('xhigh')).toBe('Extra high')
  })
})
