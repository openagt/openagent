import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Play } from 'lucide-react'
import { configureFirst, hoverTooltip, openMenu } from '../test-utils.js'

const { StartAgentButton } = await import('./StartAgentButton.js')
const { takePendingDraft } = await import('../lib/draft-handoff.js')

const PROMPT = 'Work on tickets/2026-07-20_do-the-thing.md. Do not start any other ticket.'
const MENU = 'Other ways to run this'

const onStart = vi.fn()
const onConfigure = vi.fn()

/** The button with every required prop filled in; a test overrides only what it asserts on. */
const renderButton = (props: Partial<Parameters<typeof StartAgentButton>[0]> = {}) =>
  render(
    <StartAgentButton
      icon={<Play className="h-3 w-3" aria-hidden />}
      label="Run now"
      menuAriaLabel={MENU}
      tooltip="Starts one agent."
      prompt={PROMPT}
      configureDescription="Opens the launcher with this prompt, so you can set the model and where it runs."
      onStart={onStart}
      onConfigure={onConfigure}
      {...props}
    />,
  )

beforeEach(() => {
  onStart.mockReset()
  onConfigure.mockReset()
  takePendingDraft() // a draft left by the previous test would look like this one's
})
afterEach(cleanup)

describe('StartAgentButton (#1507)', () => {
  test('the primary half starts it, and hands the launcher nothing', () => {
    renderButton()
    fireEvent.click(screen.getByRole('button', { name: 'Run now' }))
    expect(onStart).toHaveBeenCalledTimes(1)
    expect(onConfigure).not.toHaveBeenCalled()
    // Nothing stashed: the click that runs it now has no launcher trip to prepare for.
    expect(takePendingDraft()).toBeNull()
  })

  test('Configure first, then run opens the launcher with the prompt instead of starting anything', async () => {
    renderButton()
    await configureFirst(MENU)
    expect(onConfigure).toHaveBeenCalledTimes(1)
    expect(onStart).not.toHaveBeenCalled()
    // Carried through the draft stash the modules' "Configure first" uses (#1139), so the
    // launcher rehydrates with this prompt verbatim rather than an empty composer.
    expect(takePendingDraft()).toBe(PROMPT)
  })

  test('a start in flight shuts the primary half and leaves the chevron open', async () => {
    renderButton({ busy: true })
    expect((screen.getByRole('button', { name: 'Run now' }) as HTMLButtonElement).disabled).toBe(true)
    // Going to look at the settings is not a start, and being unable to because a start is in
    // flight would be the opposite of the point.
    const chevron = screen.getByRole('button', { name: MENU })
    expect((chevron as HTMLButtonElement).disabled).toBe(false)
    await configureFirst(MENU)
    expect(onConfigure).toHaveBeenCalledTimes(1)
  })

  test('nothing to act on shuts both halves: there is no launcher to open either', () => {
    renderButton({ disabled: true })
    expect((screen.getByRole('button', { name: 'Run now' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: MENU }) as HTMLButtonElement).disabled).toBe(true)
  })

  test('only the button whose own start is in flight reads as busy', () => {
    const { rerender } = renderButton()
    expect(screen.getByRole('button', { name: 'Run now' })).toBeTruthy()
    rerender(
      <StartAgentButton
        icon={<Play className="h-3 w-3" aria-hidden />}
        label="Run now"
        menuAriaLabel={MENU}
        tooltip="Starts one agent."
        prompt={PROMPT}
        configureDescription="…"
        onStart={onStart}
        onConfigure={onConfigure}
        busy
        starting
      />,
    )
    expect(screen.getByRole('button', { name: 'Starting…' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Run now' })).toBeNull()
  })

  test('the menu entry carries the caller’s own description of the trip', async () => {
    renderButton({ configureDescription: 'Opens the launcher with this prompt — one agent, not the fan-out.' })
    await openMenu(screen.getByRole('button', { name: MENU }))
    expect(await screen.findByText(/one agent, not the fan-out/)).toBeTruthy()
  })

  test('an icon-only button keeps a name of its own, and so does its chevron', async () => {
    // The dense rows (the queue card, the ticket list) have no room for a label, and a control
    // with only an icon is nameless to a screen reader without this.
    renderButton({ label: undefined, ariaLabel: 'Start work on Do the thing' })
    const start = screen.getByRole('button', { name: 'Start work on Do the thing' })
    expect(start).toBeTruthy()
    expect(screen.getByRole('button', { name: MENU })).toBeTruthy()
    // The hover still says what the click costs, label or no label.
    expect((await hoverTooltip(start)).textContent).toBe('Starts one agent.')
  })
})
