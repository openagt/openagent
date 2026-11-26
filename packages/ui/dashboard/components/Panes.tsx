import { createContext, useContext, useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react'
import { ArrowLeft, Bot, FileText, Maximize2, Minimize2, PanelRight, Plus, X } from 'lucide-react'
import type { Layout } from 'react-resizable-panels'
import type { WorkspaceDoc } from '../../src/index.js'
import { DocsPanel } from './DocsPanel.js'
import { ModuleSlot } from './ModulePageView.js'
import { PaneHeaderContext } from './PaneHeader.js'
import { useMountedModules, type MountedView } from '../lib/use-modules.js'
import type { UiContext, UiPaneProps } from '../module/index.js'
import { Button } from './ui/button.js'
import { cn } from '../lib/utils.js'
import { usePolled } from '../lib/use-async.js'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from './ui/resizable.js'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip.js'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu.js'
import { onDocs } from '../rpc/reads.js'
import { closePanes, paneSizes, paneSizesOwner, panesPage, setActivePane, setPaneOpen, setPaneSizes, setPanelExpanded, setPanelShown, useActivePane, useOpenPanes, usePanelExpanded, usePanelShown } from '../lib/panes.js'
import { useRevealedChange, useRevealedFile, useRevealedScreen, useRevealedSubagent, type RevealedChange, type RevealedFile } from '../lib/reveal-change.js'
import { isMobileScreen, useIsMobile } from '../lib/use-mobile.js'
import { useNarrow } from '../lib/use-narrow.js'
import { pressed, shortcutKeys, type ShortcutId } from '../lib/shortcut.js'

// The side panel beside the chat, as Claude Code on the web has it: tabs at its top, one per thing
// it shows (what the installed modules add: Changes, Files, the Browser; the project's surfaced
// docs; the run's subagents), a "+" that opens another, and with no tab open a list of what it can
// show, each with its shortcut. The panel icon at the end of the page's top bar opens it, and at
// the end of its own tab bar closes it; its tabs are kept for when it opens again. The line
// between the chat and the panel is dragged to share the room, and the panel can fill the page.
// What is open, and how the room is shared, is remembered for each page (`lib/panes.ts`). A tab
// not shown renders nothing, so nothing in it reads anything.
//
// A module's pane may be opened on one of the run's copied repos (`repo`): a tab of its own, named
// for the repo, beside the project's.
//
// Where there is no room beside the chat (a phone, or a chat and a panel that would each be cut
// under their least width), the panel lies over the chat, under the top bar, and its tab bar's
// arrow goes back to the chat.
//
// The pieces: the provider knows the page's panel (PanesProvider, around the page and the panel),
// the top bar draws its icon (PaneToggles), and the layout puts the panel beside the page
// (PaneLayout). The top bar is the page's own, over the chat alone (TopBar), as Claude Code's:
// the panel beside it reaches the window's top.

/** A pane's own id among the page's: a module's by its package and the id it gave, the dashboard's own by name. */
const panelId = (panel: MountedView<'chat.pane'>): string => `${panel.package}/${panel.id}`
const DOCS = 'docs'
const SUBAGENTS = 'subagents'

/** The tab of a module's pane opened on one of the run's copied repos: its pane's id, then the repo. */
const REPO_MARK = '#'
export const repoTab = (paneId: string, repo: string): string => `${paneId}${REPO_MARK}${repo}`

/** The room between the chat and the panel, and its two parts. */
const WORKSPACE = 'workspace'
const CHAT = 'chat'
const COLUMN = 'panes'
/** The panel's share of the page until a person sets one: half, as a diff needs the room. */
const COLUMN_SHARE = 50

interface Pane {
  id: string
  label: string
  icon: ComponentType<{ className?: string }>
  /** The module's panel; absent on the dashboard's own panes. */
  panel?: MountedView<'chat.pane'>
  /** The copied repo a module's pane is opened on, in its own tab. */
  repo?: string
  /** Its shortcut, as Claude Code's: Changes ⌘⇧D, Files ⌘⇧F. */
  key?: ShortcutId
}

interface PanesValue {
  /** The name the page's panel is kept under (`panesPage`). */
  page: string
  /** The page has a panel at all: an agent's page and the "New agent session" page do. */
  enabled: boolean
  /** What the panel can show on this page, in the order of the "+" menu. */
  panes: Pane[]
  /** The open tabs, first opened first. */
  open: Pane[]
  /** The tab shown. */
  active: Pane | undefined
  /** The panel is open. */
  shown: boolean
  /** The panel fills the page. */
  expanded: boolean
  panelProps: UiPaneProps | undefined
  reveal: RevealedChange | undefined
  show: RevealedFile | undefined
  docs: WorkspaceDoc[]
  docsLoaded: boolean
  /** What the Subagents pane shows. */
  subagents: ReactNode
  /** What a pane's entry says beside its name in the list of what the panel can show, by its id. */
  counts: Record<string, ReactNode>
}

const NO_PANES: PanesValue = { page: '', enabled: false, panes: [], open: [], active: undefined, shown: false, expanded: false, panelProps: undefined, reveal: undefined, show: undefined, docs: [], docsLoaded: false, subagents: null, counts: {} }

const PanesContext = createContext<PanesValue>(NO_PANES)

/** Whether the page's side panel is open: the session's Activity panel stands beside the chat only while it is not. */
export function usePanesShown(): boolean {
  return useContext(PanesContext).shown
}

/** The last ask from the chat the panes moved for. */
let revealShown = 0

/**
 * Open the page's pane `paneId` when an ask from the chat comes (`at`), once for each ask: an old
 * one, met again on coming back to its page, opens nothing. No pane that takes it, nothing opens.
 */
function useOpenOnAsk(page: string, at: number | undefined, paneId: string | undefined): void {
  useEffect(() => {
    if (at === undefined || paneId === undefined || at <= revealShown) return
    revealShown = at
    setPaneOpen(page, paneId, true)
  }, [at, paneId, page])
}

/**
 * The panel of the page on screen, for the top bar's icon and for the panel beside the page.
 * `projectId` null, or `enabled` false, is a page with no panel: a module's own page, Settings,
 * the Overview.
 */
export function PanesProvider({
  projectId,
  agentId,
  enabled,
  files,
  context,
  toggleContext,
  activity,
  subagents,
  counts,
  children,
}: {
  projectId: string | null
  /** The selected agent: the modules' panes are then about it (#815). */
  agentId?: string | null | undefined
  enabled: boolean
  /** The project's files (#492): which of the Context's paths are files, for the modules' panes. */
  files: string[]
  /** The Context set, shared with the launcher (#504). */
  context: Set<string>
  /** Toggle a file path in the Context. */
  toggleContext: (path: string) => void
  /** How many events the selected run's feed has shown, for the modules' panes. */
  activity?: number
  /** What the Subagents pane shows: on the page of a run that started subagents. */
  subagents?: ReactNode
  /** What a pane's entry says beside its name in the panel's list, by its id. */
  counts?: Record<string, ReactNode>
  children: ReactNode
}) {
  const shown = enabled ? projectId : null
  // Read here and not in the pane: the panel has to know whether there is a document before it
  // offers it (#1146). Remembered per project: a project seen before says whether it has
  // documents from the first frame.
  const { value: docs, state: docsState } = usePolled<WorkspaceDoc[]>(
    shown ? () => onDocs(shown) : null,
    [],
    4000,
    [shown],
    shown ? { remember: `docs:${shown}` } : undefined,
  )
  const docsLoaded = docsState !== 'unknown'

  // What the panel can show for this project: every module's pane, since the panel cannot tell a
  // module's pane is empty without rendering it; an empty one says so inside. The dashboard's own
  // Docs pane is earned by content (#1146): one that can only say "nothing yet" is not offered.
  const { views } = useMountedModules()
  const mounted = views['chat.pane']
  const page = panesPage(shown ?? '', agentId)
  const subagentAsked = useRevealedSubagent(page)
  const hasSubagents = subagents !== undefined
  const panes = useMemo<Pane[]>(() => {
    if (!shown) return []
    const ofModules = mounted
      .filter(panel => panel.projects.includes(shown))
      .map(panel => ({ id: panelId(panel), label: panel.label, icon: panel.icon, panel, ...(panel.changes ? { key: 'changesTab' as const } : panel.files ? { key: 'filesTab' as const } : {}) }))
    const own: Pane[] = [
      ...(docs.length > 0 ? [{ id: DOCS, label: 'Docs', icon: FileText }] : []),
      ...(hasSubagents ? [{ id: SUBAGENTS, label: 'Subagents', icon: Bot }] : []),
    ]
    return [...ofModules, ...own]
  }, [mounted, shown, docs.length, hasSubagents])

  const openIds = useOpenPanes(page)
  // A tab is a pane, or a module's pane on a copied repo: its own tab, named for the repo.
  const open = useMemo(
    () =>
      openIds.flatMap((id): Pane[] => {
        const at = id.indexOf(REPO_MARK)
        if (at < 0) return panes.filter(pane => pane.id === id)
        const pane = panes.find(one => one.id === id.slice(0, at) && one.panel)
        const repo = id.slice(at + 1)
        if (!pane) return []
        const { key: _key, ...rest } = pane
        return [{ ...rest, id, repo, label: `${pane.label} · ${repo}` }]
      }),
    [openIds, panes],
  )
  const activeId = useActivePane(page)
  const active = open.find(pane => pane.id === activeId) ?? open.at(-1)
  const panelShown = usePanelShown(page) && shown !== null
  const expanded = usePanelExpanded(page) && panelShown

  // On a phone the panel covers most of the page, so leaving the page closes it: no page is found
  // covered on coming back. Leaving only: a phone turned on its side, wide now, keeps its panel.
  useEffect(
    () => () => {
      if (isMobileScreen()) closePanes(page)
    },
    [page],
  )

  // The panes' shortcuts, as Claude Code's: each opens its pane's tab.
  useEffect(() => {
    if (!shown) return
    const keyed = panes.filter(pane => pane.key !== undefined)
    if (keyed.length === 0) return
    const onKey = (event: KeyboardEvent) => {
      const key = pressed(event, 'changesTab') ? 'changesTab' : pressed(event, 'filesTab') ? 'filesTab' : undefined
      const pane = key && keyed.find(one => one.key === key)
      if (!pane) return
      event.preventDefault()
      setPaneOpen(page, pane.id, true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [shown, panes, page])

  // A changed file asked for from the chat: the pane that lists changes is opened, and takes the file.
  const reveal = useRevealedChange(page)
  useOpenOnAsk(page, reveal?.at, panes.find(pane => pane.panel?.changes)?.id)
  // A file asked for from the chat: the pane that shows the run's files is opened, and takes the file.
  const show = useRevealedFile(page)
  useOpenOnAsk(page, show?.at, panes.find(pane => pane.panel?.files)?.id)
  // A live screen asked for from the chat: the pane that shows it is opened.
  const screenAsked = useRevealedScreen(page)
  useOpenOnAsk(page, screenAsked?.at, panes.find(pane => pane.panel?.screen)?.id)
  // A subagent asked for from the chat: the pane of the run's subagents is opened, with that one open.
  useOpenOnAsk(page, subagentAsked?.key !== undefined ? subagentAsked.at : undefined, hasSubagents ? SUBAGENTS : undefined)

  // The Context as a module's pane sees it: its files only, never the project paths the
  // launcher's project checkboxes also put in it (#661).
  const contextFiles = useMemo(() => new Set(files.filter(f => context.has(f))), [files, context])
  const moduleContext = useMemo<UiContext>(() => ({ files: contextFiles, toggle: toggleContext }), [contextFiles, toggleContext])
  const panelProps = useMemo<UiPaneProps | undefined>(
    () => (shown ? { projectId: shown, ...(agentId ? { agentId, ...(activity !== undefined ? { activity } : {}) } : {}), context: moduleContext } : undefined),
    [shown, agentId, activity, moduleContext],
  )

  const value = useMemo<PanesValue>(
    () => ({ page, enabled: shown !== null, panes, open, active, shown: panelShown, expanded, panelProps, reveal, show, docs, docsLoaded, subagents: subagents ?? null, counts: counts ?? {} }),
    [page, shown, panes, open, active, panelShown, expanded, panelProps, reveal, show, docs, docsLoaded, subagents, counts],
  )
  return <PanesContext.Provider value={value}>{children}</PanesContext.Provider>
}

/**
 * A page's top bar, where the page puts it: over the chat alone, the panel beside it. Always lined
 * under, scrolled or not, with no fade under the line; an agent's page lays it over the chat's start,
 * see-through (ChatPane).
 */
export function TopBar({ children }: { children: ReactNode }) {
  // The line is drawn inside the bar's own height, as the panel's tab bar draws its own: the two
  // are as high, their lines level.
  return <div className="shadow-[inset_0_-1px_0_var(--color-border)]">{children}</div>
}

/** The press that opens the side panel, or closes it: the panel icon, as Claude Code's. */
function PanelButton({ className }: { className?: string }) {
  const { page, shown } = useContext(PanesContext)
  const label = shown ? 'Close the side panel' : 'Open the side panel'
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-bar"
            className={cn('text-muted-foreground', shown && 'bg-accent text-accent-foreground', className)}
            aria-label={label}
            aria-pressed={shown}
            onClick={() => setPanelShown(page, !shown)}
          />
        }
      >
        <PanelRight className="h-4 w-4" />
      </TooltipTrigger>
      <TooltipContent>{shown ? 'Close panel' : 'Open panel'}</TooltipContent>
    </Tooltip>
  )
}

/**
 * The end of a page's top bar: what stands before the panel's icon (the project's ⋮, the session's
 * Activity panel), then the panel icon while the panel is closed: open, its icon is at the end of
 * its own tab bar, as Claude Code's. The presses are one kind of button, 4px apart, the last glyph
 * ending 16 from the bar's edge as the title starts 16 from the other (ui/look/spacing.md 4).
 */
export function PaneToggles({ before }: { before?: ReactNode }) {
  const { enabled, shown } = useContext(PanesContext)
  const isMobile = useIsMobile()
  return (
    <div className="flex shrink-0 items-center gap-1 pr-0.5">
      {before}
      {/* Over the chat (a phone) the panel's way back is its arrow, so the icon stays here to open it again. */}
      {enabled && (!shown || isMobile) && <PanelButton />}
    </div>
  )
}

/** Open a tab: the one shown on this page from now on. */
function TabButton({ pane, current }: { pane: Pane; current: boolean }) {
  const { page } = useContext(PanesContext)
  return (
    <div
      className={cn(
        'group/tab flex h-7 shrink-0 items-center rounded-md text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        current && 'bg-accent text-accent-foreground shadow-[inset_0_0_0_1px_var(--color-border)]',
      )}
    >
      <button type="button" role="tab" aria-selected={current} className="flex h-full items-center gap-1.5 rounded-md px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setActivePane(page, pane.id)}>
        <pane.icon className="size-3.5 shrink-0" />
        <span className="max-w-40 truncate">{pane.label}</span>
      </button>
      <button
        type="button"
        aria-label={`Close ${pane.label}`}
        className={cn('mr-1 hidden size-5 place-items-center rounded-sm opacity-70 outline-none group-hover/tab:grid hover:bg-background/60 focus-visible:grid focus-visible:ring-2 focus-visible:ring-ring', current && 'grid')}
        onClick={() => setPaneOpen(page, pane.id, false)}
      >
        <X className="size-3" />
      </button>
    </div>
  )
}

/** What a pane's entry says after its name: its count, then its shortcut. */
function PaneEntryEnd({ pane }: { pane: Pane }) {
  const { counts } = useContext(PanesContext)
  const count = counts[pane.id]
  return (
    <>
      {count !== undefined && <span className="text-xs">{count}</span>}
      {pane.key !== undefined && <kbd className="ml-auto pl-4 font-sans text-xs text-muted-foreground">{shortcutKeys(pane.key).join('')}</kbd>}
    </>
  )
}

/** The "+" of the tab bar: what the panel can show, each opened in a tab. */
function AddTab() {
  const { page, panes } = useContext(PanesContext)
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger render={<DropdownMenuTrigger render={<Button variant="ghost" size="icon-bar" className="shrink-0 text-muted-foreground" aria-label="Open a tab" />} />}>
          <Plus className="h-4 w-4" />
        </TooltipTrigger>
        <TooltipContent>Open a tab</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="min-w-56">
        {panes.map(pane => (
          <DropdownMenuItem key={pane.id} onClick={() => setPaneOpen(page, pane.id, true)}>
            <pane.icon className="h-3.5 w-3.5" aria-hidden />
            <span>{pane.label}</span>
            <PaneEntryEnd pane={pane} />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The panel with no tab open: what it can show, each a press that opens it, with its shortcut. */
function EmptyPanel() {
  const { page, panes } = useContext(PanesContext)
  return (
    <div className="grid flex-1 place-items-center overflow-y-auto p-4">
      <ul aria-label="What the panel can show" className="flex w-full max-w-80 flex-col gap-1">
        {panes.map(pane => (
          <li key={pane.id}>
            <button type="button" className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[15px] outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setPaneOpen(page, pane.id, true)}>
              <pane.icon className="size-4 shrink-0 text-muted-foreground" />
              <span>{pane.label}</span>
              <PaneEntryEnd pane={pane} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** What one tab shows, under a row of its own where the pane puts its title and its presses (`PaneTitle`, `PaneActions`). */
function TabBody({ pane }: { pane: Pane }) {
  const { panelProps, reveal, show, docs, docsLoaded, subagents } = useContext(PanesContext)
  const [title, setTitle] = useState<HTMLElement | null>(null)
  const [actions, setActions] = useState<HTMLElement | null>(null)
  const slots = useMemo(() => ({ title, actions }), [title, actions])
  return (
    <section aria-label={pane.label} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {/* The pane's own row: gone while it puts nothing in it. */}
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2 has-[>div:first-child:empty]:has-[>div:last-child:empty]:hidden">
        <div ref={setTitle} className="flex min-w-0 flex-1 items-center gap-1" />
        <div ref={setActions} className="flex shrink-0 items-center gap-1" />
      </div>
      {/* The pane fills what is left of its height, and scrolls inside itself. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {pane.id === SUBAGENTS ? (
          <PaneHeaderContext.Provider value={slots}>{subagents}</PaneHeaderContext.Provider>
        ) : pane.panel && panelProps ? (
          <ModuleSlot package={pane.panel.package} label={`${pane.label} pane`}>
            <PaneHeaderContext.Provider value={slots}>
              <pane.panel.View
                {...panelProps}
                {...(pane.repo !== undefined ? { repo: pane.repo } : {})}
                {...(pane.panel.changes && reveal && pane.repo === undefined ? { reveal } : {})}
                {...(pane.panel.files && show && pane.repo === undefined ? { show } : {})}
              />
            </PaneHeaderContext.Provider>
          </ModuleSlot>
        ) : (
          <DocsPanel docs={docs} loaded={docsLoaded} />
        )}
      </div>
    </section>
  )
}

/**
 * The side panel: its tab bar (the tabs, the "+", the press that lets it fill the page and the
 * panel icon that closes it; over the chat, an arrow back to the chat at its start), over the tab
 * shown, or with none open the list of what it can show.
 */
function SidePanel({ over = false }: { /** Laid over the chat: flush, its way out an arrow back to the chat. */ over?: boolean }) {
  const { page, open, active, expanded } = useContext(PanesContext)
  const fills = !over && expanded
  return (
    // A panel that fills the page is laid over the whole of it, where it is: its contents are not
    // drawn anew, so what was opened and scrolled in it stays.
    <div className={fills ? 'absolute inset-0 z-30 flex bg-background' : 'flex h-full min-h-0 min-w-0'}>
      <section aria-label="Side panel" className={cn('flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background', over && 'border-t border-border')}>
        {/* Flush with the page, as Claude Code's: its tab bar as high as the page's top bar, 44, and lined under. */}
        <header className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-2">
          {over && (
            <Tooltip>
              <TooltipTrigger render={<Button variant="ghost" size="icon-bar" className="ml-0.5 shrink-0 text-muted-foreground" aria-label="Back to the chat" onClick={() => setPanelShown(page, false)} />}>
                <ArrowLeft className="size-4" />
              </TooltipTrigger>
              <TooltipContent>Back to the chat</TooltipContent>
            </Tooltip>
          )}
          {open.length > 0 && (
            <div role="tablist" aria-label="Tabs" className="scrollbar-none flex min-w-0 items-center gap-1 overflow-x-auto">
              {open.map(pane => (
                <TabButton key={pane.id} pane={pane} current={pane === active} />
              ))}
            </div>
          )}
          <AddTab />
          <div className="flex-1" />
          {!over && open.length > 0 && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-bar"
                    className="shrink-0 text-muted-foreground"
                    aria-label={fills ? 'Bring the panel back to its place' : 'Let the panel fill the page'}
                    aria-pressed={fills}
                    onClick={() => setPanelExpanded(page, !fills)}
                  />
                }
              >
                {fills ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
              </TooltipTrigger>
              <TooltipContent>{fills ? 'Back to its place' : 'Fill the page'}</TooltipContent>
            </Tooltip>
          )}
          {!over && <PanelButton className="mr-0.5" />}
        </header>
        {active ? <TabBody key={active.id} pane={active} /> : <EmptyPanel />}
      </section>
    </div>
  )
}

/** The least widths of the chat and of the panel, in px: a room narrower than both and the line between lays the panel over the chat. */
const CHAT_LEAST = 320
const COLUMN_LEAST = 288

/**
 * A page and its panel, as Claude Code's: the page (the chat) at the start with its top bar over it
 * alone, and at its end the side panel, from the window's top down, its tab bar level with the top
 * bar; the line between them is dragged to share the width. Where the room holds less than both at
 * their least (a phone; a window at 768 with the sidebar open), the open panel lies over the page
 * under its top bar instead. A page with no panel is drawn as it is.
 */
export function PaneLayout({ children }: { children: ReactNode }) {
  const { page, enabled, shown, expanded } = useContext(PanesContext)
  const isMobile = useIsMobile()
  const [room, setRoom] = useState<HTMLElement | null>(null)
  const over = useNarrow(room, CHAT_LEAST + COLUMN_LEAST + 8) || isMobile
  const beside = shown && !over
  if (!enabled) return children
  // The panel has the share it was last given on this page; on a page that was never sized, the
  // share last given on any. The group remembers a layout by its panels' names, so the panel is
  // named for whose share this is too (`paneSizesOwner`).
  const column = paneSizes(page, WORKSPACE)?.[COLUMN] ?? COLUMN_SHARE
  const columnId = `${COLUMN}@${paneSizesOwner(page, WORKSPACE)}`
  const remember = (layout: Layout, { isUserInteraction }: { isUserInteraction: boolean }) => {
    const [chat, panes] = [layout[CHAT], layout[columnId]]
    if (isUserInteraction && chat !== undefined && panes !== undefined) setPaneSizes(page, WORKSPACE, { [CHAT]: chat, [COLUMN]: panes })
  }
  return (
    // `relative`: a panel that fills the page, or lies over the chat, is laid over all of this.
    <div ref={setRoom} className="relative flex min-h-0 min-w-0 flex-1">
      {/* No line is dragged under a panel that fills the page. */}
      <ResizablePanelGroup orientation="horizontal" disabled={expanded} onLayoutChanged={remember} className="min-h-0 flex-1">
        <ResizablePanel id={CHAT} minSize={CHAT_LEAST} className="flex min-w-0 flex-col" style={{ overflow: 'hidden' }}>
          {children}
        </ResizablePanel>
        {beside && <ResizableHandle aria-label="The width of the chat and the side panel" />}
        {beside && (
          <ResizablePanel id={columnId} defaultSize={`${column}%`} minSize={COLUMN_LEAST} style={{ overflow: 'hidden' }}>
            <SidePanel />
          </ResizablePanel>
        )}
      </ResizablePanelGroup>
      {over && shown && (
        // The whole room under the top bar, 44 high: the chat's row, or on a phone the page's own.
        <div className="absolute inset-x-0 top-11 bottom-0 z-20 flex flex-col bg-background">
          <SidePanel over />
        </div>
      )}
    </div>
  )
}
