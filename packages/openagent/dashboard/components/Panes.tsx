import { createContext, useContext, useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react'
import { Bot, FileText, Maximize2, Minimize2, MoreVertical, X } from 'lucide-react'
import type { Layout } from 'react-resizable-panels'
import type { WorkspaceDoc } from '../../src/index.js'
import { DocsPanel } from './DocsPanel.js'
import { ModuleSlot } from './ModulePageView.js'
import { PaneHeaderContext } from './PaneHeader.js'
import { useMountedModules, type MountedPanel } from '../lib/use-modules.js'
import type { ModuleContext, ModulePanelProps } from '../module/index.js'
import { Button } from './ui/button.js'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from './ui/dropdown-menu.js'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from './ui/resizable.js'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip.js'
import { cn } from '../lib/utils.js'
import { usePolled } from '../lib/use-async.js'
import { onDocs } from '../rpc/reads.js'
import { closePanes, paneSizes, paneSizesOwner, panesPage, setExpandedPane, setPaneOpen, setPaneSizes, useExpandedPane, useOpenPanes } from '../lib/panes.js'
import { useRevealedChange, useRevealedScreen, useRevealedSubagent, type RevealedChange } from '../lib/reveal-change.js'
import { isMobileScreen, useIsMobile } from '../lib/use-mobile.js'

// The panes beside the chat, as Claude Code on the web has them: what the installed modules add
// (Changes, Files, the Browser) and the project's surfaced docs (PLAN/TODO), each with an icon at
// the end of the page's top bar. An icon opens its pane and closes it again, and an open pane's
// icon is lit. The open panes are cards in one column beside the chat, in the order they were
// opened; the line between the chat and the column, and the line between two panes, is dragged to
// share the room. A pane's card has its name, a button that lets it fill the page and one that
// closes it. Which panes are open and how the room is shared is remembered for each page
// (`lib/panes.ts`). A closed pane renders nothing, so nothing in it reads anything.
//
// On a phone there is no room beside the chat: the column of cards lies over the chat's right two
// thirds, and the icons, which it covers, are one ⋮ menu at the start of the top bar.
//
// One pane has no icon: the subagent a row of the chat opened, which only such a row opens.
//
// The pieces: the provider knows the page's panes (PanesProvider, around the page and the panes),
// the top bar draws their icons (PaneToggles, PaneMenu), and the layout puts the column beside the
// page (PaneLayout).

/** A pane's own id among the page's: a module's by its package and the id it gave, the dashboard's own by name. */
const panelId = (panel: MountedPanel): string => `${panel.package}/${panel.id}`
const DOCS = 'docs'
const SUBAGENT = 'subagent'

/** The room between the chat and the column of panes, and its two parts. */
const WORKSPACE = 'workspace'
const CHAT = 'chat'
const COLUMN = 'panes'
/** The column's share of the page until a person sets one: half, as a diff needs the room. */
const COLUMN_SHARE = 50

interface Pane {
  id: string
  label: string
  icon: ComponentType<{ className?: string }>
  /** The module's panel; absent on the dashboard's own panes. */
  panel?: MountedPanel
  /** No icon in the top bar: something else on the page opens it. */
  hidden?: true
}

interface PanesValue {
  /** The name the page's panes are kept under (`panesPage`). */
  page: string
  /** The page has panes at all: an agent's page and the "New agent" page do. */
  enabled: boolean
  /** The panes this page offers, in the order of their icons. */
  panes: Pane[]
  /** The offered panes that are open, first opened first. */
  open: Pane[]
  /** The open pane that fills the page. */
  expanded: string | undefined
  panelProps: ModulePanelProps | undefined
  reveal: RevealedChange | undefined
  docs: WorkspaceDoc[]
  docsLoaded: boolean
  /** What the Subagent pane shows. */
  subagent: ReactNode
}

const NO_PANES: PanesValue = { page: '', enabled: false, panes: [], open: [], expanded: undefined, panelProps: undefined, reveal: undefined, docs: [], docsLoaded: false, subagent: null }
const PanesContext = createContext<PanesValue>(NO_PANES)

/** The last ask from the chat the panes moved for. */
let revealShown = 0

/**
 * The panes of the page on screen, for the top bar's icons and for the column beside the page.
 * `projectId` null, or `enabled` false, is a page with no panes: a module's own page, Settings,
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
  subagent,
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
  /** What the Subagent pane shows, once a row of the chat opened one: on an agent's page. */
  subagent?: ReactNode
  children: ReactNode
}) {
  const shown = enabled ? projectId : null
  // Read here and not in the pane: the top bar has to know whether there is a document before it
  // offers the icon (#1146). Remembered per project: a project seen before says whether it has
  // documents from the first frame, so its icon neither comes late nor shows and goes.
  const { value: docs, loaded: docsLoaded } = usePolled<WorkspaceDoc[]>(
    shown ? () => onDocs(shown) : null,
    [],
    4000,
    [shown],
    shown ? { remember: `docs:${shown}` } : undefined,
  )

  // The modules' panes for this project: every one is offered, since the top bar cannot tell a
  // module's pane is empty without rendering it; an empty one says so inside. The dashboard's own
  // Docs pane is earned by content (#1146): one that can only say "nothing yet" is not offered.
  const { panels: mounted } = useMountedModules()
  const page = panesPage(shown ?? '', agentId)
  // The Subagent pane is there once a row asked for a subagent on this page.
  const subagentAsked = useRevealedSubagent(page)
  const showsSubagent = subagent !== undefined && subagentAsked !== undefined
  const panes = useMemo<Pane[]>(() => {
    if (!shown) return []
    const ofModules = mounted.filter(panel => panel.projects.includes(shown)).map(panel => ({ id: panelId(panel), label: panel.label, icon: panel.icon, panel }))
    const own: Pane[] = [
      ...(docs.length > 0 ? [{ id: DOCS, label: 'Docs', icon: FileText }] : []),
      ...(showsSubagent ? [{ id: SUBAGENT, label: 'Subagent', icon: Bot, hidden: true as const }] : []),
    ]
    return [...ofModules, ...own]
  }, [mounted, shown, docs.length, showsSubagent])

  const openIds = useOpenPanes(page)
  const open = useMemo(() => openIds.flatMap(id => panes.find(pane => pane.id === id) ?? []), [openIds, panes])
  const expanded = useExpandedPane(page)

  // On a phone the open panes cover most of the page, so leaving the page closes them: no page is
  // found covered on coming back. Leaving only: a phone turned on its side, wide now, keeps its panes.
  useEffect(
    () => () => {
      if (isMobileScreen()) closePanes(page)
    },
    [page],
  )

  // A changed file asked for from the chat: the pane that lists changes is opened, and takes the file.
  const reveal = useRevealedChange(page)
  const changesPane = panes.find(pane => pane.panel?.changes)?.id
  const revealedAt = reveal?.at
  useEffect(() => {
    // Each ask opens the pane once: an old one, met again on coming back to its page, opens nothing.
    if (revealedAt === undefined || changesPane === undefined || revealedAt <= revealShown) return
    revealShown = revealedAt
    setPaneOpen(page, changesPane, true)
  }, [revealedAt, changesPane, page])
  // A live screen asked for from the chat: the pane that shows it is opened.
  const screenAsked = useRevealedScreen(page)
  const screenPane = panes.find(pane => pane.panel?.screen)?.id
  useEffect(() => {
    if (screenAsked === undefined || screenPane === undefined || screenAsked <= revealShown) return
    revealShown = screenAsked
    setPaneOpen(page, screenPane, true)
  }, [screenAsked, screenPane, page])

  // A subagent asked for from the chat: its pane is opened.
  const subagentAt = subagentAsked?.at
  useEffect(() => {
    if (subagentAt === undefined || !showsSubagent || subagentAt <= revealShown) return
    revealShown = subagentAt
    setPaneOpen(page, SUBAGENT, true)
  }, [subagentAt, showsSubagent, page])

  // The Context as a module's pane sees it: its files only, never the project paths the
  // launcher's project checkboxes also put in it (#661).
  const contextFiles = useMemo(() => new Set(files.filter(f => context.has(f))), [files, context])
  const moduleContext = useMemo<ModuleContext>(() => ({ files: contextFiles, toggle: toggleContext }), [contextFiles, toggleContext])
  const panelProps = useMemo<ModulePanelProps | undefined>(
    () => (shown ? { projectId: shown, ...(agentId ? { agentId, ...(activity !== undefined ? { activity } : {}) } : {}), context: moduleContext } : undefined),
    [shown, agentId, activity, moduleContext],
  )

  const value = useMemo<PanesValue>(
    () => ({ page, enabled: shown !== null, panes, open, expanded: open.some(pane => pane.id === expanded) ? expanded : undefined, panelProps, reveal, docs, docsLoaded, subagent: subagent ?? null }),
    [page, shown, panes, open, expanded, panelProps, reveal, docs, docsLoaded, subagent],
  )
  return <PanesContext.Provider value={value}>{children}</PanesContext.Provider>
}

/** On a phone with a pane open the column of panes lies over the icons' end of the top bar: they are one menu at its start. */
function useFolded(): boolean {
  const { open } = useContext(PanesContext)
  return useIsMobile() && open.length > 0
}

/** The panes' icons, for the end of a page's top bar: one per pane, lit while its pane is open. */
export function PaneToggles() {
  const { page, panes, open } = useContext(PanesContext)
  const offered = panes.filter(pane => !pane.hidden)
  if (useFolded() || offered.length === 0) return null
  return (
    <div role="group" aria-label="Panes" className="flex shrink-0 items-center gap-0.5">
      {offered.map(pane => {
        const isOpen = open.includes(pane)
        return (
          <Tooltip key={pane.id}>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className={cn('shrink-0 text-muted-foreground', isOpen && 'bg-accent text-accent-foreground')}
                  aria-label={pane.label}
                  aria-pressed={isOpen}
                  onClick={() => setPaneOpen(page, pane.id, !isOpen)}
                />
              }
            >
              <pane.icon className="h-4 w-4" />
            </TooltipTrigger>
            {/* Its name only, as Claude Code's icons say "Files" and "Changes". */}
            <TooltipContent>{pane.label}</TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}

/** The panes as one ⋮ menu, for the start of a page's top bar: on a phone while a pane is open, each open pane checked. */
export function PaneMenu() {
  const { page, panes, open } = useContext(PanesContext)
  if (!useFolded()) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label="Panes" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground">
        <MoreVertical className="h-4 w-4" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[12rem]">
        {panes.filter(pane => !pane.hidden || open.includes(pane)).map(pane => (
          <DropdownMenuCheckboxItem key={pane.id} closeOnClick checked={open.includes(pane)} onCheckedChange={checked => setPaneOpen(page, pane.id, checked)}>
            <pane.icon className="h-3.5 w-3.5 shrink-0" aria-hidden /> {pane.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * One open pane, flush with its neighbours: a header with its name, the button that lets it fill
 * the page and the one that closes it, over what it shows. A module's pane may put its own things
 * in place of its name and before those buttons (`PaneTitle`, `PaneActions`).
 */
function PaneCard({ pane }: { pane: Pane }) {
  const { page, expanded, panelProps, reveal, docs, docsLoaded, subagent } = useContext(PanesContext)
  const fills = expanded === pane.id
  const [title, setTitle] = useState<HTMLElement | null>(null)
  const [actions, setActions] = useState<HTMLElement | null>(null)
  const slots = useMemo(() => ({ title, actions }), [title, actions])
  return (
    // A pane that fills the page is laid over the whole of it, where it is: its contents are not
    // drawn anew, so what was opened and scrolled in it stays.
    <div className={fills ? 'absolute inset-0 z-30 flex bg-background' : 'flex h-full min-h-0 min-w-0'}>
      <section aria-label={pane.label} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
        {/* As tall as the chat's top row, and lined under as it is: the two read as one bar. */}
        <header className="flex h-11 shrink-0 items-center gap-0.5 border-b border-border pr-2 pl-2">
          {/* The pane's name stands until the pane puts its own title here. */}
          <div ref={setTitle} className="peer flex min-w-0 flex-1 items-center gap-0.5 empty:hidden" />
          <h2 className="min-w-0 flex-1 truncate pl-2 text-[13px] text-muted-foreground peer-[:not(:empty)]:hidden">{pane.label}</h2>
          <div ref={setActions} className="flex shrink-0 items-center gap-0.5 empty:hidden" />
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 text-muted-foreground"
                  aria-label={fills ? `Bring ${pane.label} back to its place` : `Let ${pane.label} fill the page`}
                  aria-pressed={fills}
                  onClick={() => setExpandedPane(page, fills ? undefined : pane.id)}
                />
              }
            >
              {fills ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </TooltipTrigger>
            <TooltipContent>{fills ? 'Back to its place' : 'Fill the page'}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon-sm" className="shrink-0 text-muted-foreground" aria-label={`Close ${pane.label}`} onClick={() => setPaneOpen(page, pane.id, false)} />}>
              <X className="h-4 w-4" />
            </TooltipTrigger>
            <TooltipContent>Close</TooltipContent>
          </Tooltip>
        </header>
        {/* The pane fills what is left of its height, and scrolls inside itself. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {pane.id === SUBAGENT ? (
            <PaneHeaderContext.Provider value={slots}>{subagent}</PaneHeaderContext.Provider>
          ) : pane.panel && panelProps ? (
            <ModuleSlot package={pane.panel.package} label={`${pane.label} pane`}>
              <PaneHeaderContext.Provider value={slots}>
                <pane.panel.Panel {...(pane.panel.changes && reveal ? { ...panelProps, reveal } : panelProps)} />
              </PaneHeaderContext.Provider>
            </ModuleSlot>
          ) : (
            <DocsPanel docs={docs} loaded={docsLoaded} />
          )}
        </div>
      </section>
    </div>
  )
}

/** The room a group shares between the open panes is remembered under their ids, in the order they stand. */
const stackOf = (open: Pane[]): string => open.map(pane => pane.id).join('+')

/** The column of open panes, one under the other, the line between two of them dragged to share the height. */
function PaneStack() {
  const { page, open, expanded } = useContext(PanesContext)
  const stack = stackOf(open)
  // The panes of another page, or one pane more or less: each has the share it was last given
  // with these panes open, and an even share until one was. The group remembers a layout by its
  // panels' names, so each is named for whose shares these are too (`paneSizesOwner`).
  const shares = paneSizes(page, stack)
  const owner = paneSizesOwner(page, stack)
  const named = (pane: Pane) => `${pane.id}@${owner}`
  const remember = (layout: Layout, { isUserInteraction }: { isUserInteraction: boolean }) => {
    const set = open.map(pane => [pane.id, layout[named(pane)]] as const)
    if (isUserInteraction && set.every(([, share]) => share !== undefined)) setPaneSizes(page, stack, Object.fromEntries(set) as Layout)
  }
  return (
    // No line is dragged under a pane that fills the page.
    <ResizablePanelGroup orientation="vertical" disabled={expanded !== undefined} onLayoutChanged={remember}>
      {open.flatMap((pane, at) => [
        ...(at > 0 ? [<ResizableHandle key={`above-${pane.id}`} aria-label={`The height of ${open[at - 1]!.label} and ${pane.label}`} />] : []),
        <ResizablePanel key={pane.id} id={named(pane)} defaultSize={`${shares?.[pane.id] ?? 100 / open.length}%`} minSize={96} style={{ overflow: 'hidden' }}>
          <PaneCard pane={pane} />
        </ResizablePanel>,
      ])}
    </ResizablePanelGroup>
  )
}

/**
 * A page and its panes: the page (the chat) at the start, and at its end the column of open panes,
 * the line between them dragged to share the width. On a phone the column lies over the page. A
 * page with no panes is drawn as it is.
 */
export function PaneLayout({ children }: { children: ReactNode }) {
  const { page, enabled, open, expanded } = useContext(PanesContext)
  const isMobile = useIsMobile()
  const beside = open.length > 0 && !isMobile
  if (!enabled) return children
  // The column has the share it was last given on this page; on a page that was never sized, the
  // share last given on any. The group remembers a layout by its panels' names, so the column is
  // named for whose share this is too (`paneSizesOwner`).
  const column = paneSizes(page, WORKSPACE)?.[COLUMN] ?? COLUMN_SHARE
  const columnId = `${COLUMN}@${paneSizesOwner(page, WORKSPACE)}`
  const remember = (layout: Layout, { isUserInteraction }: { isUserInteraction: boolean }) => {
    const [chat, panes] = [layout[CHAT], layout[columnId]]
    if (isUserInteraction && chat !== undefined && panes !== undefined) setPaneSizes(page, WORKSPACE, { [CHAT]: chat, [COLUMN]: panes })
  }
  return (
    // `relative`: a pane that fills the page is laid over all of this.
    <div className="relative flex min-w-0 flex-1">
      {/* No line is dragged under a pane that fills the page. */}
      <ResizablePanelGroup orientation="horizontal" disabled={expanded !== undefined} onLayoutChanged={remember}>
        <ResizablePanel id={CHAT} minSize={320} className="flex min-w-0 flex-col" style={{ overflow: 'hidden' }}>
          {children}
        </ResizablePanel>
        {beside && <ResizableHandle aria-label="The width of the chat and the panes" />}
        {beside && (
          <ResizablePanel id={columnId} defaultSize={`${column}%`} minSize={288} style={{ overflow: 'hidden' }}>
            <PaneStack />
          </ResizablePanel>
        )}
      </ResizablePanelGroup>
      {isMobile && open.length > 0 && (
        // Over the chat's right two thirds, as Claude Code's are; all of the page while one pane fills it.
        <div className={cn('absolute inset-y-0 right-0 z-20 flex flex-col divide-y divide-border border-l border-border bg-background', expanded ? 'left-0' : 'w-2/3 min-w-64 max-w-full')}>
          {open.map(pane => (
            <div key={pane.id} className="min-h-0 flex-1">
              <PaneCard pane={pane} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
