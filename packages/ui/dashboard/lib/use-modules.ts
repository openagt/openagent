import { createContext, useContext, useEffect, useState, type ComponentType } from 'react'
import { flushSync } from 'react-dom'
import { RENDER_KINDS } from '@openagt/hooks/ui'
import { onModules, type DashboardModule } from '../rpc/modules.js'
import type { ActionPlace, OptionPlace, RenderKind, RenderKinds, UiAction, UiActionAt, UiModuleDefinition, UiOption, UiRender, UiTextRender, UiView, ViewPlace } from '../module/index.js'
import { usePolled } from './use-async.js'
import { pluginsAgain } from './plugins-switched.js'
import { isPageSegment, SESSIONS_ID } from '../../src/project-address.js'

/**
 * Where a thing a module brings came from: its package, the projects that have it, whether the
 * sessions with no project have it too, and whether the package is this computer's rather than a
 * project's.
 */
interface Of {
  package: string
  /** The module's name, as its Node part's: what an item it says needs the person names it by (`Attention.module`). */
  module?: string
  projects: string[]
  sessions?: true
  computer?: true
}

/** A thing a module brings, as the shell mounts it: the thing, plus where it came from. */
export type Mounted<Brought> = Brought & Of

/** The view at `place`, as the shell mounts it. */
export type MountedView<P extends ViewPlace> = Mounted<Extract<UiView, { place: P }>>
/** The action at `place`, as the shell mounts it. */
export type MountedAction<P extends ActionPlace> = Mounted<UiActionAt<P>>
/** The option at `place`, as the shell mounts it. */
export type MountedOption<P extends OptionPlace> = Mounted<Extract<UiOption, { place: P }>>

/** The place of an entry that names none: a card, a part of the Overview's line, a Settings entry, an option. */
export const DEFAULT_ORDER = 50

/**
 * What the installed modules bring, once loaded (#2394): each UI hook's entries, by place, in the
 * order the place draws them.
 */
export interface MountedModules {
  /**
   * The views, by place: the pages (a word two modules claim going to the first), the Overview's
   * cards and line and the Settings entries by their `order` then their package, the panes, the
   * parts of a run's page, what this computer's modules draw over every page, and the usage
   * bar's line (the first module's that has one); the message box's controls and the labels of a
   * session's row by their `order`; every other place in package order. Actions and options by
   * their `order`, then their package.
   */
  views: { [P in ViewPlace]: MountedView<P>[] }
  actions: { [P in ActionPlace]: MountedAction<P>[] }
  options: { [P in OptionPlace]: MountedOption<P>[] }
  /** How each kind of content looks: the first module's for a kind. */
  renders: Mounted<UiRender>[]
  /** True once the module list was read and every module in it imported or skipped. */
  loaded: boolean
}

const VIEW_PLACES: readonly ViewPlace[] = ['app.page', 'app.overlay', 'overview.card', 'overview.line', 'chat.pane', 'chat.summary', 'chat.work', 'chat.notice', 'chat.labels', 'composer.control', 'composer.prompts', 'settings.section', 'permissions.section', 'usage.line', 'overview.notice']
const ACTION_PLACES: readonly ActionPlace[] = ['link.menu', 'chat.handoff', 'chat.menu', 'project.menu', 'person.menu', 'attention.fix']
const OPTION_PLACES: readonly OptionPlace[] = ['composer.auto', 'composer.where', 'composer.images', 'composer.commands', 'chat.references']

/** Nothing mounted at any place. */
function nothingAt(loaded: boolean): MountedModules {
  return {
    views: Object.fromEntries(VIEW_PLACES.map(place => [place, []])) as unknown as MountedModules['views'],
    actions: Object.fromEntries(ACTION_PLACES.map(place => [place, []])) as unknown as MountedModules['actions'],
    options: Object.fromEntries(OPTION_PLACES.map(place => [place, []])) as unknown as MountedModules['options'],
    renders: [],
    loaded,
  }
}

const NOTHING_MOUNTED: MountedModules = nothingAt(false)

/** What is mounted when the modules bring only `parts`, at their places; loaded unless said. For the shell's tests and the modules'. */
export function mountedOf(
  parts: { views?: { [P in ViewPlace]?: MountedView<P>[] }; actions?: { [P in ActionPlace]?: MountedAction<P>[] }; options?: { [P in OptionPlace]?: MountedOption<P>[] }; renders?: Mounted<UiRender>[]; loaded?: boolean } = {},
): MountedModules {
  const nothing = nothingAt(parts.loaded ?? true)
  return {
    ...nothing,
    views: { ...nothing.views, ...parts.views },
    actions: { ...nothing.actions, ...parts.actions },
    options: { ...nothing.options, ...parts.options },
    ...(parts.renders ? { renders: parts.renders } : {}),
  }
}

/** Each module's browser part, imported once per page load, by URL; a module that fails to load is skipped. */
const imported = new Map<string, Promise<UiModuleDefinition | undefined>>()
/** The same, once imported (or skipped). */
const importedBy = new Map<string, UiModuleDefinition | undefined>()

function load(url: string): Promise<UiModuleDefinition | undefined> {
  let loading = imported.get(url)
  if (!loading) {
    loading = import(/* @vite-ignore */ url).then(
      (loaded: { default?: UiModuleDefinition }) => {
        const definition = loaded.default
        if (!definition || typeof definition !== 'object' || !definition.hooks || typeof definition.hooks !== 'object') return undefined
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

/** The order cards, the Overview's line and Settings entries are drawn in: by `order` (50 when unsaid), then by package name. */
export function byMountOrder(a: { order?: number; package: string }, b: { order?: number; package: string }): number {
  return (a.order ?? DEFAULT_ORDER) - (b.order ?? DEFAULT_ORDER) || a.package.localeCompare(b.package)
}

/**
 * What the registered projects' modules fill (#1774, #2394): each UI hook's entries at their
 * places, as {@link MountedModules} orders them, each carrying the package it came from and the
 * projects that have it. `loaded` is false until the module list has
 * been read and every module in it imported, so the shell can tell "no such page" from "not
 * loaded yet"; what a module brings is there as soon as that module is imported, so a card is not
 * kept waiting for another package's code. A change of `reloadKey`, and a plugin switched in Settings, read the list again at once;
 * what is mounted stays until it answers. The list is kept for the next visit too, so a page
 * opened again imports the modules at once.
 */
export function useModules(reloadKey = 0): MountedModules {
  const { value: modules, state: listState } = usePolled(onModules, NO_MODULES, 30_000, [reloadKey], { remember: 'modules', stored: true }, pluginsAgain)
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
    const definitions = new Map<DashboardModule, UiModuleDefinition | undefined>()
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
function mount(loadedModules: { module: DashboardModule; definition: UiModuleDefinition | undefined }[], loaded: boolean): MountedModules {
  const mounted = nothingAt(loaded)
  const views = mounted.views as Record<ViewPlace, Mounted<UiView>[]>
  const actions = mounted.actions as Record<ActionPlace, Mounted<UiAction>[]>
  const options = mounted.options as Record<OptionPlace, Mounted<UiOption>[]>
  for (const { module, definition } of loadedModules) {
    if (!definition) continue
    const of: Of = { package: module.package, module: definition.name, projects: module.projects, ...(module.sessions ? { sessions: true as const } : {}), ...(module.computer ? { computer: true as const } : {}) }
    for (const view of definition.hooks['ui.view'] ?? []) {
      const at = views[view.place]
      if (!at) continue
      if (view.place === 'app.page' && (!isPageSegment(view.id) || at.some(page => page.id === view.id))) continue
      // Only a module of this computer's draws over every page: a project's package does not put things on every page.
      if (view.place === 'app.overlay' && !of.computer) continue
      // The bar has one line: the first module's.
      if (view.place === 'usage.line' && at.length > 0) continue
      at.push({ ...view, ...of })
    }
    for (const action of definition.hooks['ui.action'] ?? []) actions[action.place]?.push({ ...action, ...of })
    for (const option of definition.hooks['ui.option'] ?? []) options[option.place]?.push({ ...option, ...of })
    for (const render of definition.hooks['ui.render'] ?? []) if (!mounted.renders.some(each => each.kind === render.kind)) mounted.renders.push({ ...render, ...of })
  }
  // Numbers, not a list the shell keeps: a third package sits between two others without the shell knowing it exists.
  for (const place of ['overview.card', 'overview.line', 'overview.notice', 'settings.section', 'permissions.section', 'chat.labels', 'composer.control'] as const) views[place].sort(byMountOrder)
  // The pages by their own order alone: at the same order they stay in the order the modules are loaded.
  const pages = views['app.page'] as MountedView<'app.page'>[]
  pages.sort((a, b) => (a.order ?? DEFAULT_ORDER) - (b.order ?? DEFAULT_ORDER))
  for (const place of ACTION_PLACES) actions[place].sort(byMountOrder)
  for (const place of OPTION_PLACES) options[place].sort(byMountOrder)
  return mounted
}

/** How content of a kind drawn from props of its own looks, as the shell mounted it. */
export type MountedRender<K extends RenderKind> = Mounted<{ kind: K; Render: ComponentType<RenderKinds[K]> }>

/**
 * How content of `kind` looks in the project `projectId` (the sessions with no project at
 * {@link SESSIONS_ID}), or on a page of no project: the first module's that is on there and draws
 * it, or none. A module of the computer's draws it everywhere.
 */
export function renderFor<K extends RenderKind>({ renders }: MountedModules, kind: K, projectId?: string): MountedRender<K> | undefined {
  const render = renders.find(
    each => each.kind === kind && (each.computer === true || (projectId !== undefined && (each.projects.includes(projectId) || (projectId === SESSIONS_ID && each.sessions === true)))),
  )
  return render as MountedRender<K> | undefined
}

/**
 * How a fenced block of `language` looks: the first module's that names its language; none, or
 * one with no `Render` (content the module shows elsewhere), for a block drawn as code.
 */
export function blockRender({ renders }: MountedModules, language: string): Mounted<UiTextRender> | undefined {
  if ((RENDER_KINDS as readonly string[]).includes(language)) return undefined
  return renders.find(each => each.kind === language) as Mounted<UiTextRender> | undefined
}

/** The languages of the fenced blocks a module shows elsewhere, which the chat leaves out where it does: ask's question block. */
export function blocksShownElsewhere({ renders }: MountedModules): string[] {
  return renders.flatMap(each => (!(RENDER_KINDS as readonly string[]).includes(each.kind) && !each.Render ? [each.kind] : []))
}

/**
 * A text without its fenced blocks of `languages`: closed ones, and one still being written, which
 * has no closing fence yet, so what it holds never scrolls by while the agent types it.
 */
export function withoutBlocks(text: string, languages: readonly string[]): string {
  if (languages.length === 0) return text.trim()
  const tags = languages.map(language => language.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  return text.replace(new RegExp('```(?:' + tags + ')\\b[\\s\\S]*?(```|$)', 'g'), '').trim()
}

/**
 * The mounted modules, for any component in the shell (#1774): the shell reads them once with
 * {@link useModules} and provides them here, so a page deep in the tree finds the link actions
 * without the shell threading them through every prop. Outside the provider there are no modules
 * to wait for: nothing mounted, and loaded, so a text is drawn as written there.
 */
export const ModulesContext = createContext<MountedModules>(nothingAt(true))

/** What the installed modules bring, as the shell mounted it. */
export function useMountedModules(): MountedModules {
  return useContext(ModulesContext)
}

/** Where the modules' pages the sidebar listed are kept in this browser, for the next load's first frame. */
const LISTED_PAGES_KEY = 'openagent:listed-pages'

/** A module's page as the sidebar lists it: before its module is imported, without its icon. */
export type ListedPage = Pick<MountedView<'app.page'>, 'id' | 'label' | 'projects'> & Partial<Pick<MountedView<'app.page'>, 'icon' | 'computer'>>

/** Whether a picked project shows a module's page: one of the packages it has, or of this computer's, which is every project's. */
export function pageIn(page: Pick<ListedPage, 'projects' | 'computer'>, projectId: string): boolean {
  return page.computer === true || page.projects.includes(projectId)
}

/**
 * The pages the sidebar lists: the imported ones, and until every module is, those of the last load;
 * null until then in a browser that kept none, where the pages are not known yet.
 */
export function useListedPages({ views, loaded }: MountedModules): readonly ListedPage[] | null {
  const pages = views['app.page']
  const [last] = useState(readListedPages)
  useEffect(() => {
    if (!loaded) return
    try {
      globalThis.localStorage?.setItem(LISTED_PAGES_KEY, JSON.stringify(pages.map(({ id, label, projects, computer }) => ({ id, label, projects, ...(computer ? { computer } : {}) }))))
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
    return Array.isArray(listed) ? listed.filter((page): page is ListedPage => typeof page?.id === 'string' && typeof page.label === 'string' && Array.isArray(page.projects)) : null
  } catch {
    return null
  }
}
