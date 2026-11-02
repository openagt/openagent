import { fireEvent, screen, waitFor } from '@testing-library/react'

/**
 * Hover a tooltip trigger and hand back the tooltip it opens (#1149).
 *
 * Every hint in the dashboard is the custom tooltip now, so a test that used to read a `title`
 * attribute off an element has to hover like a user instead: Base UI opens on `mouseenter` +
 * a move, and portals the popup out of the trigger's subtree.
 */
export async function hoverTooltip(trigger: Element): Promise<HTMLElement> {
  // Re-fire the hover pair on every retry rather than once up front (#1398): a pair dispatched
  // before the trigger's listeners are attached opens nothing, and a single findByRole then
  // waits out its timeout on a tooltip that will never come ("Unable to find role=tooltip" on a
  // loaded CI runner, fine locally). Repeating the events is idempotent for a hover.
  return await waitFor(
    () => {
      fireEvent.mouseEnter(trigger)
      fireEvent.mouseMove(trigger)
      return screen.getByRole('tooltip')
    },
    { timeout: 5000 },
  )
}

/** Move off a trigger, so the next {@link hoverTooltip} is the only tooltip open. */
export function unhoverTooltip(trigger: Element): void {
  fireEvent.mouseLeave(trigger)
}

/**
 * Open a dropdown menu by its trigger and wait until the trigger reports it open (#1699).
 *
 * Clicked until it opens rather than once and hoped: these are Base UI menus, and a click landing
 * before the trigger's own handlers are live is silently a no-op — the trigger stays at
 * `aria-expanded="false"` and the search that follows then hunts for an item that was never
 * rendered. Rare enough to pass locally every time and still fail on a loaded CI runner. Retrying
 * is safe because the guard only ever clicks a shut menu, so it cannot toggle one back closed; a
 * menu that genuinely will not open still fails here, on the timeout.
 */
export async function openMenu(trigger: Element): Promise<void> {
  await waitFor(() => {
    if (trigger.getAttribute('aria-expanded') !== 'true') fireEvent.click(trigger)
    if (trigger.getAttribute('aria-expanded') !== 'true') throw new Error('the menu did not open')
  })
}

/**
 * Take a start button's "Configure first, then run" (#1507): open the chevron named
 * `menuAriaLabel`, then click the entry. Shared, because every surface that starts an agent
 * carries this same second half.
 */
export async function configureFirst(menuAriaLabel: string | RegExp): Promise<void> {
  await openMenu(await screen.findByRole('button', { name: menuAriaLabel }))
  fireEvent.click(await screen.findByText('Configure first, then run'))
}

/**
 * Make the test's screen a phone's until the returned undo is called. jsdom has no `matchMedia`, so
 * the dashboard reads a wide screen there; this answers the one question it asks of it, whether the
 * screen is narrower than a width. The undo tells whoever watches the screen that it grew wide.
 */
export function phoneScreen(): () => void {
  const had = window.matchMedia
  const listeners = new Set<() => void>()
  window.matchMedia = ((media: string) => ({
    matches: media.includes('width <'),
    media,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  })) as unknown as typeof window.matchMedia
  // The undo is the screen growing wide: whoever watches it is told.
  return () => {
    window.matchMedia = had
    for (const listener of [...listeners]) listener()
  }
}
