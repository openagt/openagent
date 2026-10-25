import { createContext, useContext, useEffect, useState, type ComponentType } from 'react'
import { onModules, type DashboardModule } from '../rpc/modules.js'
import type { LinkAction, ModuleCard, ModuleDefinition, ModulePage, ModulePanel, ModuleRunSlots, ModuleSchedule, ModuleSettings, ModuleUsageLimit } from '../module/index.js'
import { usePolled } from './use-async.js'
import { isPageSegment } from '../../src/project-address.js'

/** A module page as the shell mounts it: the page, plus the package it came from and the projects that have it. */
export interface MountedPage extends ModulePage {
  package: string
  projects: string[]
}

/** A link action as the shell mounts it (#1774): the action, plus the package it came from and the projects that have it. */
export interface MountedLinkAction extends LinkAction {
  package: string
  projects: string[]
}

/** A card as the shell mounts it (#1818): the card, plus the package it came from, the projects that have it, and whether it is the computer's. */
export interface MountedCard extends ModuleCard {
  package: string
  projects: string[]
  /** A package of this computer's (its devices): the card is on every Overview, whichever project is picked. */
  computer: boolean
}

/** A pane as the shell mounts it: the pane, plus the package it came from and the projects that have it. */
export interface MountedPanel extends ModulePanel {
  package: string
  projects: string[]
}

/** A module's run slots as the shell mounts them: the slots, plus the package they came from and the projects that have it. */
export interface MountedRunSlots extends ModuleRunSlots {
  package: string
  projects: string[]
}

/** A Settings entry as the shell mounts it: the entry, plus the package it came from, the projects that have it, and whether it is the computer's. */
export interface MountedSettings extends ModuleSettings {
  package: string
  projects: string[]
  computer: boolean
}

/** A usage bar stop line as the shell mounts it: the line's read and save, plus the package it came from and the projects that have it. */
export interface MountedUsageLimit extends ModuleUsageLimit {
  package: string
  projects: string[]
}

/** What a module of this computer's draws over every page, as the shell mounts it: the part, and the package it came from. */
export interface MountedEveryPage {
  EveryPage: ComponentType
  package: string
}

/** The commands a module starts by itself, as the shell mounts them: the read, plus the package it came from and the projects that have it. */
export interface MountedSchedule extends ModuleSchedule {
  package: string
  projects: string[]
}

/** The place of a card that names none. */
const DEFAULT_CARD_ORDER = 50

/** What the installed modules bring, once loaded: their pages, their cards and their link actions. */
export interface MountedModules {
  pages: MountedPage[]
  /** Every package's cards, in the order the Overview draws the ones it draws: by `order`, then by package name. */
  cards: MountedCard[]
  linkActions: MountedLinkAction[]
  /** The panes beside the chat, in package order. */
  panels: MountedPanel[]
  /** The run slots, one entry per module that has any, in package order. */
  runSlots: MountedRunSlots[]
  /** The Settings entries, in the order they are listed: by `order`, then by package name. */
  settings: MountedSettings[]
  /** What the modules of this computer's draw over every page, in package order. */
  everyPage: MountedEveryPage[]
  /** The usage bar's stop line: the first module's that declares one, in package order; absent when none does. */
  usageLimit?: MountedUsageLimit
  /** What starts by itself: the first module's that declares it, in package order; absent when none does. */
  schedule?: MountedSchedule
  /** True once the module list was read and every module in it imported or skipped. */
  loaded: boolean
}

const NOTHING_MOUNTED: MountedModules = { pages: [], cards: [], linkActions: [], panels: [], runSlots: [], settings: [], everyPage: [], loaded: false }

/** Each module's browser part, imported once per page load, by URL; a module that fails to load is skipped. */
const imported = new Map<string, Promise<ModuleDefinition | undefined>>()

function load(url: string): Promise<ModuleDefinition | undefined> {
  let loading = imported.get(url)
  if (!loading) {
    loading = import(/* @vite-ignore */ url).then(
      (loaded: { default?: ModuleDefinition }) => {
        const definition = loaded.default
        if (!definition || typeof definition !== 'object') return undefined
        // The module's stylesheet sits beside its module; it is linked once, like the module.
        if (definition.stylesheet) {
          const link = document.createElement('link')
          link.rel = 'stylesheet'
          link.href = new URL(definition.stylesheet, new URL(url, window.location.href)).href
          document.head.appendChild(link)
        }
        return definition
      },
      (error: unknown) => {
        console.warn(`[openagent] the module at ${url} did not load:`, error)
        return undefined
      },
    )
    imported.set(url, loading)
  }
  return loading
}

const NO_MODULES: DashboardModule[] = []

/** The order cards and Settings sections are drawn in: by `order` (50 when unsaid), then by package name. */
export function byMountOrder(a: { order?: number; package: string }, b: { order?: number; package: string }): number {
  return (a.order ?? DEFAULT_CARD_ORDER) - (b.order ?? DEFAULT_CARD_ORDER) || a.package.localeCompare(b.package)
}

/**
 * What the registered projects' modules add (#1774), in package order: the pages, a segment two
 * modules claim going to the first, the cards (#1818), sorted by their order then their package, the link actions, the panes, the run slots, the Settings sections (sorted as the cards are) and the usage bar's stop line (the first module's that declares one),
 * every one of them, each carrying the package it came from and the projects that have it. `loaded` is false until the module list has
 * been read and every module in it imported, so the shell can tell "no such page" from "not
 * loaded yet". A change of `reloadKey` reads the list again at once; what is mounted stays until
 * it answers.
 */
export function useModules(reloadKey = 0): MountedModules {
  const { value: modules, loaded: listed } = usePolled(onModules, NO_MODULES, 30_000, [reloadKey])
  const [state, setState] = useState<MountedModules>(NOTHING_MOUNTED)
  useEffect(() => {
    if (!listed) return
    let live = true
    void Promise.all(modules.map(async module => ({ module, definition: await load(module.url) }))).then(loadedModules => {
      if (!live) return
      const pages: MountedPage[] = []
      const cards: MountedCard[] = []
      const linkActions: MountedLinkAction[] = []
      const panels: MountedPanel[] = []
      const runSlots: MountedRunSlots[] = []
      const settings: MountedSettings[] = []
      const everyPage: MountedEveryPage[] = []
      let usageLimit: MountedUsageLimit | undefined
      let schedule: MountedSchedule | undefined
      for (const { module, definition } of loadedModules) {
        for (const page of definition?.pages ?? []) {
          if (!isPageSegment(page.segment) || pages.some(p => p.segment === page.segment)) continue
          pages.push({ ...page, package: module.package, projects: module.projects })
        }
        for (const card of definition?.cards ?? []) {
          cards.push({ ...card, package: module.package, projects: module.projects, computer: module.computer === true })
        }
        for (const action of definition?.linkActions ?? []) {
          linkActions.push({ ...action, package: module.package, projects: module.projects })
        }
        for (const panel of definition?.panels ?? []) {
          panels.push({ ...panel, package: module.package, projects: module.projects })
        }
        for (const section of definition?.settings ?? []) {
          settings.push({ ...section, package: module.package, projects: module.projects, computer: module.computer === true })
        }
        // Only a module of this computer's: a project's package does not put things on every page.
        if (definition?.everyPage && module.computer === true) everyPage.push({ EveryPage: definition.everyPage, package: module.package })
        if (definition?.usageLimit) usageLimit ??= { ...definition.usageLimit, package: module.package, projects: module.projects }
        if (definition?.schedule) schedule ??= { ...definition.schedule, package: module.package, projects: module.projects }
        const run = definition?.run
        if (run?.summary) runSlots.push({ ...run, package: module.package, projects: module.projects })
      }
      // Numbers, not a list the shell keeps: a third package sits between two others without the shell knowing it exists.
      cards.sort(byMountOrder)
      settings.sort(byMountOrder)
      setState({ pages, cards, linkActions, panels, runSlots, settings, everyPage, ...(usageLimit ? { usageLimit } : {}), ...(schedule ? { schedule } : {}), loaded: true })
    })
    return () => {
      live = false
    }
  }, [modules, listed])
  return state
}

/**
 * The mounted modules, for any component in the shell (#1774): the shell reads them once with
 * {@link useModules} and provides them here, so a page deep in the tree finds the link actions
 * without the shell threading them through every prop. Outside the provider: nothing mounted,
 * not loaded.
 */
export const ModulesContext = createContext<MountedModules>(NOTHING_MOUNTED)

/** The installed modules' pages and link actions, as the shell mounted them. */
export function useMountedModules(): MountedModules {
  return useContext(ModulesContext)
}
