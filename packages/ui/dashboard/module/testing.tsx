import { fireEvent, render, screen, waitFor, type RenderResult } from '@testing-library/react'
import { useRef, useState, type ReactElement, type ReactNode } from 'react'
import { SessionSetupMenu } from '../components/SessionSetup.js'
import { vi, type Mock } from 'vitest'
import { PaneHeaderContext } from '../components/PaneHeader.js'
import { SidebarProvider, useSidebar } from '../components/ui/sidebar.js'
import { DaemonDown } from '../lib/use-daemon-health.js'
import { ModulesContext, mountedOf, type Mounted, type MountedModules } from '../lib/use-modules.js'
export { mountedOf } from '../lib/use-modules.js'
export { onProjectsChanged, ShellProjectsContext } from '../lib/shell-projects.js'
import { ModuleHostContext, type ModuleCallResult, type ModuleCommandResult, type ModuleHost, type UiModuleDefinition, type UiRender } from './index.js'

// What a module's tests need of the dashboard, faked (`@openagt/ui/module/testing`, which
// `moduleTests` in `./vite.ts` resolves): a host whose every service is a spy, and a render inside
// it. A service the host gains is faked here once, instead of in every module's tests.

export type { MountedModules }
export type { MountedAction, MountedView } from '../lib/use-modules.js'

/** The host with every service a spy, so a test reads what was asked of it: `host.openPage.mock.calls`. */
export type FakeHost = { [K in keyof ModuleHost]: ModuleHost[K] extends (...args: infer A) => infer R ? Mock<(...args: A) => R> : ModuleHost[K] }

/**
 * A host for the module of `pkg`. Each service answers as a dashboard with nothing to give would
 * (no commands, no agents), unless `services` says how it answers in this test.
 */
export function fakeHost(pkg: string, services: Partial<Omit<ModuleHost, 'package'>> = {}): FakeHost {
  const nothing = async () => ({ ok: false as const, error: 'not in this test' })
  const host: Omit<ModuleHost, 'package'> = {
    runCommand: nothing,
    act: nothing,
    runComputerCommand: nothing,
    call: nothing,
    callComputer: nothing,
    openAgent: () => {},
    agentHref: (projectId, agentId) => `/${projectId}/${agentId}`,
    openPage: () => {},
    pageHref: (segment, path = [], projectId) => `/${[projectId, segment, ...path].filter(Boolean).join('/')}`,
    adjustPage: () => {},
    backToPage: () => {},
    openSettings: () => {},
    gitHostPeople: async () => [],
    startRun: nothing,
    configureRun: () => {},
    agents: async () => [],
    activity: async () => ({ items: [], whole: [] }),
    watchScreen: async () => undefined,
    sendToScreen: async () => false,
    ...services,
  }
  const spies = Object.entries(host).map(([name, service]) => [name, vi.isMockFunction(service) ? service : vi.fn(service as (...args: unknown[]) => unknown)])
  return { package: pkg, ...Object.fromEntries(spies) } as FakeHost
}

/** A command's outputs, keyed by project, then by its arguments joined with spaces. */
export type Answers = Record<string, Record<string, unknown>>

/** How a module's command answers from `answers`; a command line with no answer fails, naming itself. */
export function answering(command: string, answers: Answers): (projectId: string, args: string[]) => Promise<ModuleCommandResult> {
  return async (projectId, args) => {
    const line = args.join(' ')
    const known = answers[projectId]?.[line]
    return known === undefined ? { ok: false, error: `no answer for ${projectId}: ${command} ${line}` } : { ok: true, output: known }
  }
}

/**
 * How a module's server part answers from `answers`, keyed by project, then by the function's name
 * and the words of its input, joined with spaces: `show` with `{ file: 'x.md' }` by `show x.md`, a
 * call with no words by its name alone. A call with no answer fails, naming itself.
 */
export function answeringCalls(answers: Answers): (projectId: string, name: string, input: object) => Promise<ModuleCallResult> {
  return async (projectId, name, input) => {
    const key = [name, ...Object.values(input).filter((value): value is string => typeof value === 'string')].join(' ')
    const known = answers[projectId]?.[key]
    return known === undefined ? { ok: false, error: `no answer for ${projectId}: ${key}` } : { ok: true, output: known }
  }
}

/** No other module is installed. */
export const NO_MODULES: MountedModules = mountedOf()

/**
 * What the module `definition` of the package `pkg` draws (its `ui.render`), mounted as the
 * dashboard mounts a module of the computer's: on every page. For a test of a part that shows what
 * another module draws, as a text in markdown is: `mountedOf({ renders: computerRenders(markdown, '@openagt/ui-renderer-markdown') })`.
 */
export function computerRenders(definition: UiModuleDefinition, pkg: string): Mounted<UiRender>[] {
  return (definition.hooks['ui.render'] ?? []).map(render => ({ ...render, package: pkg, projects: [], computer: true as const }))
}

/**
 * Render `ui` as the dashboard draws a module: inside `host`, beside the installed `modules` (none
 * unless said), in a pane's card for a module that fills a pane's header. `rerender` keeps all three.
 */
export function renderWithHost(ui: ReactElement, host: ModuleHost, modules: MountedModules = NO_MODULES): RenderResult {
  const wrap = (node: ReactNode) => (
    <ModulesContext.Provider value={modules}>
      <ModuleHostContext.Provider value={host}>
        <PaneCard>{node}</PaneCard>
      </ModuleHostContext.Provider>
    </ModulesContext.Provider>
  )
  const result = render(wrap(ui))
  return { ...result, rerender: (next: ReactNode) => result.rerender(wrap(next)) }
}

/** Render `children` as the dashboard does while OpenAgent is not answering: `useOpenAgentDown()` is true inside. */
export function OpenAgentDown({ children }: { children: ReactNode }) {
  return <DaemonDown.Provider value>{children}</DaemonDown.Provider>
}

/** Render `children` as the dashboard does once the person hid the sidebar: an empty "Sidebar" navigation stands for it while it shows. */
export function SidebarHidden({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider defaultOpen={false}>
      <SidebarShown />
      {children}
    </SidebarProvider>
  )
}

function SidebarShown() {
  return useSidebar().open ? <nav aria-label="Sidebar" /> : null
}

/** A pane's card as the dashboard draws it: a header with the two places a pane fills, over the pane. */
function PaneCard({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState<HTMLElement | null>(null)
  const [actions, setActions] = useState<HTMLElement | null>(null)
  return (
    <section>
      <header>
        <div ref={setTitle} data-testid="pane-title" />
        <div ref={setActions} data-testid="pane-actions" />
      </header>
      <PaneHeaderContext.Provider value={{ title, actions }}>{children}</PaneHeaderContext.Provider>
    </section>
  )
}

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
