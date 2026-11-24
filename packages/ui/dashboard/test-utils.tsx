import { fireEvent, screen, waitFor } from '@testing-library/react'
import { continuationPrompt } from '@openagt/agent-driver/question'
import { mountedOf, type Mounted, type MountedModules } from './lib/use-modules.js'
import type { UiMarkdownProps, UiQuestionProps, UiRender } from './module/index.js'

// The gear and its lines, a tooltip's hover and a menu's opening: the SDK's own test helpers, which a module's tests use too.
import { openMenu } from './module/testing.js'
export { hoverTooltip, openMenu, GearMenu, gear, setupLine, openSetupLine } from './module/testing.js'

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
