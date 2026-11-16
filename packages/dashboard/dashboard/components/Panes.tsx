import { createContext, useContext, useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, Bot, FileText, Maximize2, Minimize2, X } from 'lucide-react'
import type { Layout } from 'react-resizable-panels'
import type { WorkspaceDoc } from '../../src/index.js'
import { DocsPanel } from './DocsPanel.js'
import { ModuleSlot } from './ModulePageView.js'
import { PaneHeaderContext } from './PaneHeader.js'
import { useMountedModules, type MountedPanel } from '../lib/use-modules.js'
import type { ModuleContext, ModulePanelProps } from '../module/index.js'
import { Button } from './ui/button.js'
import { cn } from '../lib/utils.js'
import { usePolled } from '../lib/use-async.js'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from './ui/resizable.js'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip.js'
import { onDocs } from '../rpc/reads.js'
import { closePanes, paneSizes, paneSizesOwner, panesPage, setExpandedPane, setPaneOpen, setPaneSizes, useExpandedPane, useOpenPanes } from '../lib/panes.js'
import { useRevealedChange, useRevealedFile, useRevealedScreen, useRevealedSubagent, type RevealedChange, type RevealedFile } from '../lib/reveal-change.js'
import { isMobileScreen, useIsMobile } from '../lib/use-mobile.js'
import { useNarrow } from '../lib/use-narrow.js'

// The panes beside the chat, as Claude Code on the web has them: what the installed modules add
// (Changes, Files, the Browser) and the project's surfaced docs (PLAN/TODO), each with an icon at
// the end of the page's top bar. An icon opens its pane and closes it again, and an open pane's
// icon is lit. The open panes are cards in one column beside the chat, in the order they were
// opened; the line between the chat and the column, and the line between two panes, is dragged to
// share the room; a line is drawn only under the pointer and while it is dragged, the cards' own
// edges part them at rest. A pane's card has its name, a button that lets it fill the page and one
// that closes it. Which panes are open and how the room is shared is remembered for each page
// (`lib/panes.ts`). A closed pane renders nothing, so nothing in it reads anything.
//
// Where there is no room beside the chat (a phone, or a chat and a pane that would each be cut under
// their least width), the open pane lies over the chat, under the top bar, which keeps its icons, and
// its header's arrow goes back to the chat.
//
// A run that started subagents has their pane too: the list of them, and the one a row opened
// (here or in the chat) under it.
//
// The pieces: the provider knows the page's panes (PanesProvider, around the page and the panes),
// the top bar draws their icons (PaneToggles), and the layout puts the column beside the
// page (PaneLayout). On a desktop the top bar is a row over the page and its column (TopBar), so an
// icon stays where it was pressed as a pane opens, and pressed again there closes it.

/** A pane's own id among the page's: a module's by its package and the id it gave, the dashboard's own by name. */
const panelId = (panel: MountedPanel): string => `${panel.package}/${panel.id}`
const DOCS = 'docs'
const SUBAGENTS = 'subagents'

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
}

interface PanesValue {
  /** The name the page's panes are kept under (`panesPage`). */
  page: string
  /** The page has panes at all: an agent's page and the "New agent session" page do. */
  enabled: boolean
  /** The panes this page offers, in the order of their icons. */
  panes: Pane[]
  /** The offered panes that are open, first opened first. */
  open: Pane[]
  /** The open pane that fills the page. */
  expanded: string | undefined
  panelProps: ModulePanelProps | undefined
  reveal: RevealedChange | undefined
  show: RevealedFile | undefined
  docs: WorkspaceDoc[]
  docsLoaded: boolean
  /** What the Subagents pane shows. */
  subagents: ReactNode
  /**
   * How many icons to hold room for until the modules and the docs are read: as many as this project
   * had when they last were. Null while they are not read in a browser that kept none for it.
   */
  held: number | null
}

const NO_PANES: PanesValue = { page: '', enabled: false, panes: [], open: [], expanded: undefined, panelProps: undefined, reveal: undefined, show: undefined, docs: [], docsLoaded: false, subagents: null, held: 0 }

/** localStorage key prefix of how many pane icons each project's top bar had once its panes were all known. */
const ICONS_KEY = 'oa.pane-icons:'

function keptIcons(projectId: string): number | null {
  try {
    const kept = globalThis.localStorage?.getItem(ICONS_KEY + projectId)
    return kept == null ? null : Number(kept) || 0
  } catch {
    return null
  }
}

function keepIcons(projectId: string, count: number): void {
  try {
    globalThis.localStorage?.setItem(ICONS_KEY + projectId, String(count))
  } catch {
    // Kept for this page's life only.
  }
}
const PanesContext = createContext<PanesValue>(NO_PANES)

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
  subagents,
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
  children: ReactNode
}) {
  const shown = enabled ? projectId : null
  // Read here and not in the pane: the top bar has to know whether there is a document before it
  // offers the icon (#1146). Remembered per project: a project seen before says whether it has
  // documents from the first frame, so its icon neither comes late nor shows and goes.
  const { value: docs, state: docsState } = usePolled<WorkspaceDoc[]>(
    shown ? () => onDocs(shown) : null,
    [],
    4000,
    [shown],
    shown ? { remember: `docs:${shown}` } : undefined,
  )
  const docsLoaded = docsState !== 'unknown'

  // The modules' panes for this project: every one is offered, since the top bar cannot tell a
  // module's pane is empty without rendering it; an empty one says so inside. The dashboard's own
  // Docs pane is earned by content (#1146): one that can only say "nothing yet" is not offered.
  const { panels: mounted, loaded: modulesLoaded } = useMountedModules()
  const page = panesPage(shown ?? '', agentId)
  const subagentAsked = useRevealedSubagent(page)
  const hasSubagents = subagents !== undefined
  const panes = useMemo<Pane[]>(() => {
    if (!shown) return []
    const ofModules = mounted.filter(panel => panel.projects.includes(shown)).map(panel => ({ id: panelId(panel), label: panel.label, icon: panel.icon, panel }))
    const own: Pane[] = [
      ...(docs.length > 0 ? [{ id: DOCS, label: 'Docs', icon: FileText }] : []),
      ...(hasSubagents ? [{ id: SUBAGENTS, label: 'Subagents', icon: Bot }] : []),
    ]
    return [...ofModules, ...own]
  }, [mounted, shown, docs.length, hasSubagents])

  // A module's icon is its own component, so it cannot be drawn before the module is loaded: until
  // then the bar holds the room the icons took last time, and the ⋮ before them stays where it is.
  // With nothing kept, the ⋮ and the icons are drawn once, together, when they are known.
  const settled = modulesLoaded && docsLoaded
  useEffect(() => {
    if (shown && settled) keepIcons(shown, panes.length)
  }, [shown, settled, panes.length])
  const held = shown !== null && !settled ? keptIcons(shown) : 0

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
  const moduleContext = useMemo<ModuleContext>(() => ({ files: contextFiles, toggle: toggleContext }), [contextFiles, toggleContext])
  const panelProps = useMemo<ModulePanelProps | undefined>(
    () => (shown ? { projectId: shown, ...(agentId ? { agentId, ...(activity !== undefined ? { activity } : {}) } : {}), context: moduleContext } : undefined),
    [shown, agentId, activity, moduleContext],
  )

  const value = useMemo<PanesValue>(
    () => ({ page, enabled: shown !== null, panes, open, expanded: open.some(pane => pane.id === expanded) ? expanded : undefined, panelProps, reveal, show, docs, docsLoaded, subagents: subagents ?? null, held }),
    [page, shown, panes, open, expanded, panelProps, reveal, show, docs, docsLoaded, subagents, held],
  )
  return <PanesContext.Provider value={value}>{children}</PanesContext.Provider>
}

/** The row over the page and its panes that the page's top bar is drawn in (PaneLayout); none on a phone, or on a page with no panes. */
const TopBarRow = createContext<HTMLElement | null>(null)

/**
 * A page's top bar: in the row over the page and its panes where there is one, else where it
 * stands. It draws a line under itself only while the chat is scrolled under it (`top-bar-line`,
 * tailwind.css).
 */
export function TopBar({ children }: { children: ReactNode }) {
  const row = useContext(TopBarRow)
  const bar = <div className="top-bar-line">{children}</div>
  return row ? createPortal(bar, row) : bar
}

/**
 * The end of a page's top bar: what stands before the panes' icons (`before`: the project's ⋮), then
 * one icon per pane, lit while its pane is open. The ⋮ and the icons are one kind of button, 4px
 * apart, the last glyph ending 16 from the bar's edge as the title starts 16 from the other
 * (ui/look/spacing.md 4).
 */
export function PaneToggles({ before }: { before?: ReactNode }) {
  const { page, panes, open, held } = useContext(PanesContext)
  const room = Math.max(held ?? 0, panes.length)
  return (
    <div className={cn('flex shrink-0 items-center gap-1 pr-0.5', held === null && 'invisible')}>
      {before}
      {room > 0 && (
        <div role="group" aria-label="Panes" className="flex shrink-0 items-center gap-1">
          {Array.from({ length: room - panes.length }, (_, at) => (
            <span key={`held-${at}`} className="size-7 shrink-0" aria-hidden />
          ))}
          {panes.map(pane => {
            const isOpen = open.includes(pane)
            return (
              <Tooltip key={pane.id}>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-bar"
                      className={cn('text-muted-foreground', isOpen && 'bg-accent text-accent-foreground')}
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
      )}
    </div>
  )
}

/**
 * One open pane, flush with its neighbours: a header with its name, the button that lets it fill
 * the page and the one that closes it (over the chat, an arrow back to the chat), over what it shows. A module's pane may put its own things
 * in place of its name and before those buttons (`PaneTitle`, `PaneActions`).
 */
function PaneCard({ pane, over = false }: { pane: Pane; /** Laid over the chat: flush, its way out an arrow back to the chat. */ over?: boolean }) {
  const { page, expanded, panelProps, reveal, show, docs, docsLoaded, subagents } = useContext(PanesContext)
  const fills = !over && expanded === pane.id
  const [title, setTitle] = useState<HTMLElement | null>(null)
  const [actions, setActions] = useState<HTMLElement | null>(null)
  const slots = useMemo(() => ({ title, actions }), [title, actions])
  return (
    // A pane that fills the page is laid over the whole of it, where it is: its contents are not
    // drawn anew, so what was opened and scrolled in it stays.
    <div className={fills ? 'absolute inset-0 z-30 flex bg-background p-2' : 'flex h-full min-h-0 min-w-0'}>
      {/* A card: the surface with the hairline, its header 48 high and lined under, so its name and its presses' glyphs stand 16 from its edges. Over the chat, the whole room with a line at its top. */}
      <section aria-label={pane.label} className={cn('flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-card', over ? 'border-t border-hairline' : 'rounded-lg border border-hairline')}>
        <header className="flex h-12 shrink-0 items-center gap-1 border-b border-hairline px-2">
          {over && (
            <Tooltip>
              <TooltipTrigger
                render={<Button variant="ghost" size="icon-bar" className="ml-0.5 text-muted-foreground" aria-label="Back to the chat" onClick={() => setPaneOpen(page, pane.id, false)} />}
              >
                <ArrowLeft className="size-4" />
              </TooltipTrigger>
              <TooltipContent>Back to the chat</TooltipContent>
            </Tooltip>
          )}
          {/* The pane's name stands until the pane puts its own title here. */}
          <div ref={setTitle} className="peer flex min-w-0 flex-1 items-center gap-1 empty:hidden" />
          <h2 className="min-w-0 flex-1 truncate pl-2 text-sm font-medium peer-[:not(:empty)]:hidden">{pane.label}</h2>
          {/* Its last press (over the chat the pane's own, else Close) is pulled in so its glyph, as the name and the arrow at the left, stands 16 in. */}
          <div ref={setActions} className={cn('flex shrink-0 items-center gap-1 empty:hidden', over && 'mr-0.5')} />
          {!over && (
            <>
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
                  {fills ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
                </TooltipTrigger>
                <TooltipContent>{fills ? 'Back to its place' : 'Fill the page'}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger render={<Button variant="ghost" size="icon-sm" className="mr-0.5 shrink-0 text-muted-foreground" aria-label={`Close ${pane.label}`} onClick={() => setPaneOpen(page, pane.id, false)} />}>
                  <X className="h-4 w-4" />
                </TooltipTrigger>
                <TooltipContent>Close</TooltipContent>
              </Tooltip>
            </>
          )}
        </header>
        {/* The pane fills what is left of its height, and scrolls inside itself. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {pane.id === SUBAGENTS ? (
            <PaneHeaderContext.Provider value={slots}>{subagents}</PaneHeaderContext.Provider>
          ) : pane.panel && panelProps ? (
            <ModuleSlot package={pane.panel.package} label={`${pane.label} pane`}>
              <PaneHeaderContext.Provider value={slots}>
                <pane.panel.Panel {...panelProps} {...(pane.panel.changes && reveal ? { reveal } : {})} {...(pane.panel.files && show ? { show } : {})} />
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
    // The cards stand 8px apart and 8px in from the column's edges; the line between two is drawn
    // only under the pointer and while it is dragged.
    <ResizablePanelGroup orientation="vertical" disabled={expanded !== undefined} onLayoutChanged={remember} className="py-1 pr-2">
      {open.flatMap((pane, at) => [
        ...(at > 0 ? [<ResizableHandle key={`above-${pane.id}`} className="bg-transparent" aria-label={`The height of ${open[at - 1]!.label} and ${pane.label}`} />] : []),
        <ResizablePanel key={pane.id} id={named(pane)} defaultSize={`${shares?.[pane.id] ?? 100 / open.length}%`} minSize={96} className="py-1" style={{ overflow: 'hidden' }}>
          <PaneCard pane={pane} />
        </ResizablePanel>,
      ])}
    </ResizablePanelGroup>
  )
}

/** The least widths of the chat and of the column of panes, in px: a room narrower than both and the line between lays the pane over the chat. */
const CHAT_LEAST = 320
const COLUMN_LEAST = 288

/**
 * A page and its panes: the page's top bar over both, the page (the chat) at the start, and at its
 * end the column of open panes, the line between them dragged to share the width. Where the room
 * holds less than both at their least (a phone; a window at 768 with the sidebar open), the open
 * pane lies over the page under its top bar instead. A page with no panes is drawn as it is.
 */
export function PaneLayout({ children }: { children: ReactNode }) {
  const { page, enabled, open, expanded } = useContext(PanesContext)
  const isMobile = useIsMobile()
  const [row, setRow] = useState<HTMLElement | null>(null)
  const [room, setRoom] = useState<HTMLElement | null>(null)
  const over = useNarrow(room, CHAT_LEAST + COLUMN_LEAST + 8) || isMobile
  const beside = open.length > 0 && !over
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
    // `chat-scope`: the top bar, in the row over the chat or in the chat's own top, sees how far the chat is scrolled.
    <div className="chat-scope relative flex min-w-0 flex-1 flex-col">
      {!isMobile && <div ref={setRow} className="shrink-0" />}
      <TopBarRow.Provider value={row}>
        <div ref={setRoom} className="relative flex min-h-0 flex-1">
          {/* No line is dragged under a pane that fills the page. */}
          <ResizablePanelGroup orientation="horizontal" disabled={expanded !== undefined} onLayoutChanged={remember} className="min-h-0 flex-1">
            <ResizablePanel id={CHAT} minSize={CHAT_LEAST} className="flex min-w-0 flex-col" style={{ overflow: 'hidden' }}>
              {children}
            </ResizablePanel>
            {beside && <ResizableHandle className="bg-transparent" aria-label="The width of the chat and the panes" />}
            {beside && (
              <ResizablePanel id={columnId} defaultSize={`${column}%`} minSize={COLUMN_LEAST} style={{ overflow: 'hidden' }}>
                <PaneStack />
              </ResizablePanel>
            )}
          </ResizablePanelGroup>
          {over && open.length > 0 && (
            // The whole room under the top bar, which on a phone is the page's own, 44 high.
            <div className="absolute inset-x-0 top-0 bottom-0 z-20 flex flex-col bg-background max-md:top-11">
              {open.map(pane => (
                <div key={pane.id} className="min-h-0 flex-1">
                  <PaneCard pane={pane} over />
                </div>
              ))}
            </div>
          )}
        </div>
      </TopBarRow.Provider>
    </div>
  )
}
