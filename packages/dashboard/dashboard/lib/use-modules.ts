import { createContext, useContext, useEffect, useState, type ComponentType } from 'react'
import { flushSync } from 'react-dom'
import { onModules, type DashboardModule } from '../rpc/modules.js'
import type { LinkAction, ModuleCard, ModuleDefinition, ModulePage, ModulePanel, ModuleRunSlots, ModuleSchedule, ModuleSettings, ModuleUsageLimit } from '../module/index.js'
import { usePolled } from './use-async.js'
import { isPageSegment } from '../../src/project-address.js'

/** Where a thing a module brings came from: its package, and the projects that have it. */
interface Of {
  package: string
  projects: string[]
}

/** A thing a module brings, as the shell mounts it: the thing, plus where it came from. */
type Mounted<Brought> = Brought & Of

/** Whether it is of a package of this computer's (its devices) rather than of a project's. */
type OfComputer = { computer: boolean }

/** A module page as the shell mounts it. */
export type MountedPage = Mounted<ModulePage>
/** A link action as the shell mounts it (#1774). */
export type MountedLinkAction = Mounted<LinkAction>
/** A card as the shell mounts it (#1818): a card of this computer's is on every Overview, whichever project is picked. */
export type MountedCard = Mounted<ModuleCard> & OfComputer
/** A pane as the shell mounts it. */
export type MountedPanel = Mounted<ModulePanel>
/** A module's run slots as the shell mounts them. */
export type MountedRunSlots = Mounted<ModuleRunSlots>
/** A Settings entry as the shell mounts it: one of this computer's is listed with no project. */
export type MountedSettings = Mounted<ModuleSettings> & OfComputer
/** A usage bar stop line as the shell mounts it: the line's read and save. */
export type MountedUsageLimit = Mounted<ModuleUsageLimit>
/** The commands a module starts by itself, as the shell mounts them: the read. */
export type MountedSchedule = Mounted<ModuleSchedule>

/** What a module of this computer's draws over every page, as the shell mounts it: the part, and the package it came from. */
export interface MountedEveryPage {
  EveryPage: ComponentType
  package: string
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
/** The same, once imported (or skipped). */
const importedBy = new Map<string, ModuleDefinition | undefined>()

function load(url: string): Promise<ModuleDefinition | undefined> {
  let loading = imported.get(url)
  if (!loading) {
    loading = import(/* @vite-ignore */ url).then(
      (loaded: { default?: ModuleDefinition }) => {
        const definition = loaded.default
        if (!definition || typeof definition !== 'object') return undefined
        return definition
      },
      (error: unknown) => {
        console.warn(`[openagent] the module at ${url} did not load:`, error)
        return undefined
      },
    )
    imported.set(url, loading)
    void loading.then(definition => void importedBy.set(url, definition))
  }
  return loading
}

/**
 * Where the page's one sheet of classes is served for a set of modules: the dashboard's own and
 * every listed module's, compiled together by the daemon (src/dashboard/page-styles.ts), so
 * Tailwind alone orders every class on the page. The address names the dashboard's build and each
 * module's version, so a browser keeps each set's sheet for good.
 */
function pageSheetUrl(modules: readonly DashboardModule[]): string {
  const asked = new URLSearchParams({ v: String(import.meta.env.OPENAGENT_CLASSES ?? '') })
  for (const module of modules) asked.append('m', module.url)
  return `/_styles/page.css?${asked}`
}

/** The page sheets fetched this page load, by address; one that fails to load is left out, with a warning. */
const sheets = new Map<string, Promise<CSSStyleSheet | undefined>>()
/** The same, once fetched (or left out). */
const sheetBy = new Map<string, CSSStyleSheet | undefined>()

function pageSheet(url: string): Promise<CSSStyleSheet | undefined> {
  let loading = sheets.get(url)
  if (!loading) {
    loading = fetch(url)
      .then(async response => {
        if (!response.ok) throw new Error(`${response.status} ${await response.text()}`)
        return new CSSStyleSheet().replace(await response.text())
      })
      .catch((error: unknown) => {
        console.warn(`[openagent] the page sheet at ${url} did not load:`, error)
        return undefined
      })
    sheets.set(url, loading)
    void loading.then(sheet => void sheetBy.set(url, sheet))
  }
  return loading
}

/** Adopts `sheet` as the page sheet, after the dashboard's own, in place of the one before. */
function adopt(sheet: CSSStyleSheet | undefined): void {
  if (!sheet || document.adoptedStyleSheets.includes(sheet)) return
  const pageSheets = new Set(sheetBy.values())
  document.adoptedStyleSheets = [...document.adoptedStyleSheets.filter(each => !pageSheets.has(each)), sheet]
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
 * loaded yet"; what a module brings is there as soon as that module is imported, so a card is not
 * kept waiting for another package's code. A change of `reloadKey` reads the list again at once;
 * what is mounted stays until it answers. The list is kept for the next visit too, so a page
 * opened again imports the modules at once.
 */
export function useModules(reloadKey = 0): MountedModules {
  const { value: modules, state: listState } = usePolled(onModules, NO_MODULES, 30_000, [reloadKey], { remember: 'modules', stored: true })
  const listed = listState !== 'unknown'
  const [state, setState] = useState<MountedModules>(NOTHING_MOUNTED)
  useEffect(() => {
    if (!listed) return
    // No module, no sheet of theirs to wait for.
    const sheetUrl = modules.length > 0 ? pageSheetUrl(modules) : undefined
    // Read again with every module imported already (the list is polled): mounted at once, in one go.
    if (modules.every(module => importedBy.has(module.url)) && (!sheetUrl || sheetBy.has(sheetUrl))) {
      if (sheetUrl) adopt(sheetBy.get(sheetUrl))
      setState(mount(modules.map(module => ({ module, definition: importedBy.get(module.url) })), true))
      return
    }
    let live = true
    let sheetIn = !sheetUrl
    const definitions = new Map<DashboardModule, ModuleDefinition | undefined>()
    // A module is drawn once its code and the sheet with its classes are both in, never before its classes are.
    const show = () => {
      if (!live || !sheetIn || definitions.size === 0) return
      // In the list's order, whichever came first: a package's place never depends on how fast its code came.
      const imported = modules.filter(each => definitions.has(each)).map(each => ({ module: each, definition: definitions.get(each) }))
      // In the task of the commit that draws the modules, so no frame shows them without it.
      if (sheetUrl) adopt(sheetBy.get(sheetUrl))
      flushSync(() => setState(mount(imported, imported.length === modules.length)))
    }
    if (sheetUrl)
      void pageSheet(sheetUrl).then(() => {
        sheetIn = true
        show()
      })
    for (const module of modules) {
      void load(module.url).then(definition => {
        if (!live) return
        definitions.set(module, definition)
        show()
      })
    }
    return () => {
      live = false
    }
  }, [modules, listed])
  return state
}

/** What the modules imported so far bring, in the list's order; `loaded` once every one of the list is. */
function mount(loadedModules: { module: DashboardModule; definition: ModuleDefinition | undefined }[], loaded: boolean): MountedModules {
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
    const of: Of = { package: module.package, projects: module.projects }
    const computer = module.computer === true
    for (const page of definition?.pages ?? []) {
      if (!isPageSegment(page.segment) || pages.some(p => p.segment === page.segment)) continue
      pages.push({ ...page, ...of })
    }
    for (const card of definition?.cards ?? []) cards.push({ ...card, ...of, computer })
    for (const action of definition?.linkActions ?? []) linkActions.push({ ...action, ...of })
    for (const panel of definition?.panels ?? []) panels.push({ ...panel, ...of })
    for (const section of definition?.settings ?? []) settings.push({ ...section, ...of, computer })
    // Only a module of this computer's: a project's package does not put things on every page.
    if (definition?.everyPage && computer) everyPage.push({ EveryPage: definition.everyPage, package: module.package })
    if (definition?.usageLimit) usageLimit ??= { ...definition.usageLimit, ...of }
    if (definition?.schedule) schedule ??= { ...definition.schedule, ...of }
    const run = definition?.run
    if (run?.summary) runSlots.push({ ...run, ...of })
  }
  // Numbers, not a list the shell keeps: a third package sits between two others without the shell knowing it exists.
  cards.sort(byMountOrder)
  settings.sort(byMountOrder)
  return { pages, cards, linkActions, panels, runSlots, settings, everyPage, ...(usageLimit ? { usageLimit } : {}), ...(schedule ? { schedule } : {}), loaded }
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

/** Where the modules' pages the sidebar listed are kept in this browser, for the next load's first frame. */
const LISTED_PAGES_KEY = 'openagent:listed-pages'

/** A module's page as the sidebar lists it: before its module is imported, without its icon. */
export type ListedPage = Pick<MountedPage, 'segment' | 'label' | 'projects'> & Partial<Pick<MountedPage, 'icon'>>

/**
 * The pages the sidebar lists: the imported ones, and until every module is, those of the last load;
 * null until then in a browser that kept none, where the pages are not known yet.
 */
export function useListedPages({ pages, loaded }: MountedModules): readonly ListedPage[] | null {
  const [last] = useState(readListedPages)
  useEffect(() => {
    if (!loaded) return
    try {
      globalThis.localStorage?.setItem(LISTED_PAGES_KEY, JSON.stringify(pages.map(({ segment, label, projects }) => ({ segment, label, projects }))))
    } catch {
      // No room, or no storage: the next load lists the pages once they are imported.
    }
  }, [pages, loaded])
  return loaded ? pages : last
}

function readListedPages(): ListedPage[] | null {
  try {
    const kept = globalThis.localStorage?.getItem(LISTED_PAGES_KEY)
    if (kept == null) return null
    const listed: unknown = JSON.parse(kept)
    return Array.isArray(listed) ? listed.filter((page): page is ListedPage => typeof page?.segment === 'string' && typeof page.label === 'string' && Array.isArray(page.projects)) : null
  } catch {
    return null
  }
}
