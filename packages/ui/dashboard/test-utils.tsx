import { useRef, type ReactNode } from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { SessionSetupMenu } from './components/SessionSetup.js'
import { continuationPrompt } from '@openagt/agent-driver/question'
import { mountedOf, type Mounted, type MountedModules } from './lib/use-modules.js'
import type { UiMarkdownProps, UiQuestionProps, UiRender } from './module/index.js'

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
 * The gear under a message box around `lines` of its menu (SessionSetup.tsx): a line is a part of
 * that menu and is drawn only inside it. `said` is what the gear's hover says.
 */
export function GearMenu({ lines, said = '', warn, busy = false }: { lines: ReactNode; said?: string; warn?: boolean; busy?: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  return (
    <>
      <div ref={box} />
      <SessionSetupMenu setup={{ lines, said, warn }} box={box} busy={busy} />
    </>
  )
}

/** The gear's button. */
export const gear = (): HTMLElement => screen.getByRole('button', { name: 'Session setup' })

/**
 * Open the gear's menu and hand back its line named `label` ("Profile", "When it finishes"): the
 * line's own words are its label, then its value ("Profile: Default").
 */
export async function setupLine(label: string): Promise<HTMLElement> {
  await openMenu(gear())
  return await waitFor(() => {
    const line = screen.getAllByRole('menuitem').find(item => item.textContent?.startsWith(`${label}: `))
    if (!line) throw new Error(`the gear's menu has no "${label}" line`)
    return line
  })
}

/** Open the list of the gear's line named `label`, and hand the line back. */
export async function openSetupLine(label: string): Promise<HTMLElement> {
  const line = await setupLine(label)
  await openMenu(line)
  return line
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

/**
 * A stand-in for the module that draws markdown (`ui-renderer-markdown`'s `ui.render`), the
 * computer's, on every page: the text as it was given, in an element that says how it was asked to
 * be set (`data-markdown-look`). How markdown looks is that module's, tested with it.
 */
export const MARKDOWN_RENDER: Mounted<UiRender> = {
  kind: 'markdown',
  Render: ({ text, look = 'chat' }: UiMarkdownProps) => <span data-markdown-look={look}>{text}</span>,
  package: '@openagt/ui-renderer-markdown',
  projects: [],
  computer: true,
}

/**
 * A stand-in for what the module that asks draws (ask's `ui.render`), mounted for `projects`: its
 * card (kind `question`), the question's title as a region and a press per option, which picks it
 * through the `send` the card is given, when it is given one, and else tells the chat what its
 * answer said (`onSaid`), as the module's card does once its answer is taken; and its question block, which the
 * chat leaves out of the message whose question the card asks. What the card was given is kept,
 * the last last, so a test reads it: the module's own card is tested with the module.
 */
export function questionCard(projects: string[] = ['p1'], more: { sessions?: true } = {}): { given: UiQuestionProps[]; modules: MountedModules } {
  const given: UiQuestionProps[] = []
  function Render(props: UiQuestionProps) {
    given.push(props)
    return (
      <section role="region" aria-label={props.question.title} data-active={props.active === true}>
        {props.question.options.map(option => (
          <button key={option.id} type="button" onClick={() => void (props.send ? props.send(option.id) : props.onSaid?.(continuationPrompt(props.question.title, option.label)))}>
            {option.label}
          </button>
        ))}
      </section>
    )
  }
  const of = { package: '@openagt/ask', projects, ...more }
  return { given, modules: mountedOf({ renders: [{ kind: 'question', Render, ...of }, { kind: 'await-choices', ...of }] }) }
}
