import { fireEvent, screen, waitFor } from '@testing-library/react'
import { continuationPrompt, type AgentCalls } from '@openagt/hooks'
import { mountedOf, type Mounted, type MountedModules, type MountedOption } from './lib/use-modules.js'
import type { UiMarkdownProps, UiQuestionProps, UiRender } from './module/index.js'

// The gear and its lines, a tooltip's hover and a menu's opening: the SDK's own test helpers, which a module's tests use too.
import { openMenu } from './module/testing.js'
export { hoverTooltip, openMenu, GearMenu, gear, setupLine, openSetupLine } from './module/testing.js'

/**
 * A coding agent's words for its calls (`RunAgent.calls`), as the chat's tests word theirs: Claude
 * Code's tools and its MCP naming, which the chat's own tests draw their calls with.
 */
export const SAMPLE_CALLS: AgentCalls = {
  tools: {
    Bash: { verb: 'Ran', doing: 'Running', kind: 'command' },
    Read: { verb: 'Read', doing: 'Reading', kind: 'read', detail: 'path' },
    Edit: { verb: 'Edited', doing: 'Editing', kind: 'edit', detail: 'path' },
    Write: { verb: 'Wrote', doing: 'Writing', kind: 'edit', detail: 'path' },
    Grep: { verb: 'Searched', doing: 'Searching', kind: 'search', detail: 'query' },
    Glob: { verb: 'Searched', doing: 'Searching', kind: 'find', detail: 'query' },
    WebSearch: { verb: 'Searched the web', doing: 'Searching the web', kind: 'web', detail: 'query' },
    WebFetch: { verb: 'Fetched', doing: 'Fetching', kind: 'other' },
    Skill: { verb: 'Ran skill', doing: 'Running skill', kind: 'skill', detail: 'slash' },
    Task: { verb: 'Started agent', doing: 'Starting agent', kind: 'other', detail: 'task' },
    Agent: { verb: 'Started agent', doing: 'Starting agent', kind: 'other', detail: 'task' },
    TodoWrite: { verb: 'Updated todos', doing: 'Updating todos', kind: 'other' },
    ToolSearch: { verb: 'Loaded tools', doing: 'Loading tools', kind: 'other' },
  },
  families: [{ pattern: 'mcp__(.+?)__(.+)', verb: 'Used $1:', doing: 'Using $1:', target: '$2', kind: 'other' }],
}

/**
 * A module that keeps the images a message goes with (`composer.images`), as agent-driver's does:
 * `keep` stands in for its server part, and a kept image is shown from `/_images/<name>`.
 */
export function imageStore(keep: MountedOption<'composer.images'>['keep'] = async () => ({ ok: false, error: 'not kept' })): MountedOption<'composer.images'> {
  return {
    place: 'composer.images',
    id: 'images',
    package: '@acme/images',
    projects: [],
    computer: true,
    types: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
    kinds: 'PNG, JPEG, GIF or WebP',
    maxBytes: 3.75 * 1024 * 1024,
    maxEdge: 8000,
    perMessage: 20,
    keep,
    src: name => `/_images/${name}`,
  }
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
