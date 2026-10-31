// `@openagt/skill-ui/module`: what any page that draws a skill's UI offers it.
//
// A skill's package adds its UI with the file it exports as `./dashboard`. That file imports `react`
// and this one by bare name and bundles neither: the page's import map points both at the page's
// own running copies. Two pages do so, OpenAgent's dashboard and the page `npx @openagt/skill-ui`
// serves for one folder, so a skill built on this file alone is the same on both. The dashboard
// offers more in `@openagt/dashboard/module`, which starts from this.
import { createContext, useContext, type ComponentType } from 'react'
import type { PackageCommandResult } from '@openagt/agent-data'

/** What a skill's command answered: its JSON output, or why there is none. */
export type ModuleCommandResult = PackageCommandResult

/** A project that has the skill's package: on a skill's own page, the folder it was opened in. */
export interface ModuleProject {
  id: string
  name: string
  /** Whether one of the project's packages provides a git host; without one no pull request can be opened there. */
  gitHost: boolean
}

/** How wide a card stands, as a part of the page. */
export type CardWidth = '1/4' | '1/3' | '1/2' | '2/3' | '3/4' | '1'

/** What a card is rendered with: the projects that have its package, never none: the card is not drawn then. A card has no URL and no sub-path. */
export interface ModuleCardProps {
  /** The projects that have the package; with one project picked in the dashboard, that one alone. Never empty, but for a package that is this computer's. */
  projects: ModuleProject[]
}

/** A card a skill adds: its own summary of its data, drawn beside the page's other cards. */
export interface ModuleCard {
  /** Which card this is, for the page's key and its error line; never shown as a title. */
  id: string
  /** Its name where the person arranges the cards: what its title says ("Hot tickets"). */
  label: string
  /** How wide it stands until the person picks: half the page when unsaid. */
  width?: CardWidth
  /** The narrowest it fits: a third of the page when unsaid. */
  minWidth?: CardWidth
  /** Its place among every package's cards, lower first; 50 when unsaid, ties by package name. */
  order?: number
  /** The card itself. */
  Card: ComponentType<ModuleCardProps>
}

/** What a skill's browser part default-exports, built on this file alone. */
export interface SkillUi {
  /** The cards the skill adds. */
  cards?: ModuleCard[]
  /** A stylesheet to load with it, relative to the browser part's own URL. */
  stylesheet?: string
}

/** Type the default export: `export default defineModule({ ... })`. */
export function defineModule(definition: SkillUi): SkillUi {
  return definition
}

/** What the page gives the skill it is rendering: running the skill's own commands, the same ones an agent runs. */
export interface SkillHost {
  /** The package the skill came from: the one whose commands are run. */
  package: string
  /** Run one of the package's own commands in one project and get its JSON output. `command` names one when the package has several. */
  runCommand(projectId: string, args: string[], command?: string): Promise<ModuleCommandResult>
  /**
   * Run one of the package's own commands in no project, for what a package keeps for the whole
   * computer. `input` is what the command reads on standard input: a secret, which no other
   * program on this computer sees there, as it would among the arguments.
   */
  runComputerCommand(args: string[], command?: string, input?: string): Promise<ModuleCommandResult>
}

/** Set by the page around every piece of a skill it renders. A test provides a whole host here. */
export const SkillHostContext = createContext<SkillHost | null>(null)

/** The page's services for the skill being rendered. Only valid inside a skill's piece. */
export function useSkillHost(): SkillHost {
  const host = useContext(SkillHostContext)
  if (!host) throw new Error('useSkillHost is only available inside a piece of a skill')
  return host
}

// The building blocks, so a skill looks like the page it is on.
export { Button, buttonVariants, type ButtonProps } from './button.js'
export { Card, CardHeader, CardTitle, CardContent } from './card.js'
export { Skeleton } from './skeleton.js'
export { cn } from './utils.js'
export { usePolled, useLoaded, forgetRemembered, readAhead, StaleReads, type Again, type Keep } from './use-async.js'
