import { useEffect, useMemo, useRef, useState } from 'react'
import type { WorkspaceDoc } from '../../src/index.js'
import { DocsPanel } from './DocsPanel.js'
import { ViewsRail } from './ViewsRail.js'
import { ModuleSlot } from './ModulePageView.js'
import { useMountedModules, type MountedPanel } from '../lib/use-modules.js'
import type { ModuleContext, ModulePanelProps } from '../module/index.js'
import type { AgentView } from '../lib/live-state.js'
import { Badge } from './ui/badge.js'
import { Button } from './ui/button.js'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip.js'
import { cn } from '../lib/utils.js'
import { usePolled } from '../lib/use-async.js'
import { onDocs } from '../rpc/reads.js'
import { setSidePanelOpen, sidePanelName, useSidePanelOpen } from '../lib/side-panel.js'
import { useRevealedChange, useRevealedScreen } from '../lib/reveal-change.js'
import { isMobileScreen, useIsMobile } from '../lib/use-mobile.js'
import { PanelRightClose, PanelRightOpen } from 'lucide-react'

/** The rail's own tabs, and a module's tab by its package and id. */
type Tab = 'views' | 'docs' | `module:${string}`

const panelTab = (panel: MountedPanel): Tab => `module:${panel.package}/${panel.id}`

// Choices had a tab here (#440) until the gates moved inline into the transcript (#1455
// items 6/7) — a question is answered where it was asked, so the rail has no panel for them.
// History had one too, rendering a committed markdown re-narration of what the event log already
// holds exactly (B3); the sessions themselves are the history now.
const TABS: Record<'views' | 'docs', { label: string; help: string }> = {
  views: { label: 'Views', help: 'Documents the agent pushed up during the session — a plan, a summary, a writeup.' },
  docs: { label: 'Docs', help: 'The PLAN/TODO markdown files at the root of the workspace.' },
}

// The right sidebar (#314 third rail): the tabs the installed modules add (the Files module's,
// first of all), the ad-hoc markdown views the agent pushes (#441) and the surfaced docs (PLAN/TODO). Views come from the live event stream, passed down from the
// shell; docs are an RPC read of the selected project. The rail jumps to a fresh first view; choice gates live inline in the
// transcript now (#1455 items 6/7), so nothing here pulls focus for them.
//
// The rail is closed until the person opens it, on each agent's page and on the "New agent" page
// apart (`lib/side-panel.ts` remembers which are open): closed, it is
// one button laid over the top right corner of the page; open, it is half the page wide,
// and the same button, at the end of the tabs, closes it. A closed rail renders no panel, so nothing in it reads anything.
/** The last ask from the chat the rail moved for. */
let revealShown = 0

export function RightRail({
  projectId,
  agentId: agentId,
  views,
  files,
  context,
  toggleContext,
  activity,
}: {
  projectId: string | null
  /** The selected agent: the modules' tabs are then about it (#815). */
  agentId?: string | null | undefined
  views: AgentView[]
  /** The project's files (#492): which of the Context's paths are files, for the modules' tabs. */
  files: string[]
  /** The Context set, shared with the launcher (#504). */
  context: Set<string>
  /** Toggle a file path in the Context. */
  toggleContext: (path: string) => void
  /** How many events the selected run's feed has shown, for the modules' tabs. */
  activity?: number
}) {
  // The two content panels are read here rather than each polling for itself: the rail has to
  // know whether they have anything before it can decide which tabs to offer, and whether to be
  // there at all (#1146). One read each, passed down; the panels render what they are given.
  // Tickets used to be a third one (#697) — now its own full page (#1144), not a rail read.
  // Remembered per project: a project seen before says whether it has documents from the first
  // frame, so its tab neither comes late nor shows and goes.
  const { value: docs, loaded: docsLoaded } = usePolled<WorkspaceDoc[]>(
    projectId ? () => onDocs(projectId) : null,
    [],
    4000,
    [projectId],
    projectId ? { remember: `docs:${projectId}` } : undefined,
  )

  // The modules' tabs for this project: every one is offered, since the rail cannot tell a
  // module's tab is empty without rendering it; an empty one says so inside.
  const { panels: mounted } = useMountedModules()
  const panels = useMemo(() => (projectId ? mounted.filter(panel => panel.projects.includes(projectId)) : []), [mounted, projectId])
  // The Context as a module's tab sees it: its files only, never the project paths the
  // launcher's project checkboxes also put in it (#661).
  const contextFiles = useMemo(() => new Set(files.filter(f => context.has(f))), [files, context])
  const moduleContext = useMemo<ModuleContext>(() => ({ files: contextFiles, toggle: toggleContext }), [contextFiles, toggleContext])

  // While the first read is out, the tab stands in only for a rail that would otherwise have no
  // tab at all, so switching projects does not blink the rail out and back in. Beside other tabs
  // it waits for the answer: held there, it showed on every agent's page and went again a moment
  // later, for every project with no documents.
  const hasDocs = docsLoaded ? docs.length > 0 : panels.length === 0 && views.length === 0

  const panelName = sidePanelName(projectId ?? '', agentId)
  const open = useSidePanelOpen(panelName)
  // On a phone the open panel covers the page, so leaving the page closes it: no page is found
  // covered on coming back. Leaving only: a phone turned on its side, wide now, keeps its panel.
  const isMobile = useIsMobile()
  useEffect(
    () => () => {
      if (isMobileScreen()) setSidePanelOpen(panelName, false)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectId, agentId],
  )
  const [tab, setTab] = useState<Tab>('docs')
  // Once the user picks a tab, stop auto-defaulting (#695/U22) — only a genuinely new choice
  // gate or the first view may still pull focus after that.
  const touched = useRef(false)
  const pickTab = (t: Tab) => {
    touched.current = true
    setTab(t)
  }
  // A changed file asked for from the chat: the tab that lists changes takes it, and is shown.
  const reveal = useRevealedChange(panelName)
  const changesPanel = panels.find(panel => panel.changes)
  const changesTab = changesPanel ? panelTab(changesPanel) : undefined
  const revealedAt = reveal?.at
  useEffect(() => {
    // Each ask moves the rail once: an old one, met again on coming back to its page, moves nothing.
    if (revealedAt === undefined || changesTab === undefined || revealedAt <= revealShown) return
    revealShown = revealedAt
    touched.current = true
    setTab(changesTab)
  }, [revealedAt, changesTab])
  // A live screen asked for from the chat: the tab that shows it is shown.
  const screenAsked = useRevealedScreen(panelName)
  const screenPanel = panels.find(panel => panel.screen)
  const screenTab = screenPanel ? panelTab(screenPanel) : undefined
  useEffect(() => {
    if (screenAsked === undefined || screenTab === undefined || screenAsked <= revealShown) return
    revealShown = screenAsked
    touched.current = true
    setTab(screenTab)
  }, [screenAsked, screenTab])
  const hasViews = views.length > 0
  const firstPanel = panels[0] ? panelTab(panels[0]) : undefined

  // Only pull the rail for something genuinely new (#695/U22): the first view. A second view or
  // a Files flip no longer yanks the tab you're reading, and an explicit pick is never overridden
  // by the browse default. (A fresh choice gate used to pull focus too — the gates are inline in
  // the transcript now, #1455 items 6/7.) With no view, the first module's tab is the default.
  const sawView = useRef(false)
  useEffect(() => {
    const firstView = hasViews && !sawView.current
    sawView.current = sawView.current || hasViews

    if (firstView) setTab('views')
    else if (!touched.current && !hasViews) setTab(firstPanel ?? 'docs')
  }, [hasViews, firstPanel])

  if (!projectId) return null

  // The modules' tabs first (#492): Files is the project peek surface, before the agent's own
  // views and docs. The rail's own tabs are earned by content (#1146): a tab that can only say
  // "nothing yet" is one the rail does not offer, and a rail with no tabs left is not shown at all.
  const tabs: Tab[] = [
    ...panels.map(panelTab),
    ...(hasViews ? ['views' as const] : []),
    ...(hasDocs ? ['docs' as const] : []),
  ]
  if (tabs.length === 0) return null
  const toggle = (
    <Tooltip>
      <TooltipTrigger render={<Button variant="ghost" size="icon-sm" className="h-7 w-7 shrink-0" aria-label={open ? 'Close the side panel' : 'Open the side panel'} aria-expanded={open} onClick={() => setSidePanelOpen(panelName, !open)} />}>
        {open ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
      </TooltipTrigger>
      <TooltipContent>{open ? 'Close the side panel' : `Open the side panel: ${tabs.map(t => panels.find(panel => panelTab(panel) === t)?.label ?? TABS[t as 'views' | 'docs'].label).join(', ')}`}</TooltipContent>
    </Tooltip>
  )
  // Closed, the panel is its button alone, laid over the top right corner of the page, which the
  // page's top row keeps free: the page then runs to the window's edge, its scroll bar with it,
  // under that row.
  if (!open) return <aside className="absolute top-0 right-0 z-10 flex flex-col p-2">{toggle}</aside>
  // The remembered tab may have just lost its content (the last doc deleted, a gate resolved), so
  // fall back to the first one that still exists rather than rendering an empty panel.
  const active: Tab = tabs.includes(tab) ? tab : tabs[0]!
  const panelProps: ModulePanelProps = { projectId, ...(agentId ? { agentId, ...(activity !== undefined ? { activity } : {}) } : {}), context: moduleContext }
  const panelOf = (t: Tab) => panels.find(panel => panelTab(panel) === t)
  const label = (t: Tab) => panelOf(t)?.label ?? TABS[t as 'views' | 'docs'].label
  const help = (t: Tab) => panelOf(t)?.help ?? TABS[t as 'views' | 'docs'].help
  const count = (t: Tab) => {
    if (t === 'views') return views.length
    const panel = panelOf(t)
    return panel?.count ? panel.count(panelProps) : 0
  }
  const activePanel = panelOf(active)
  const activeProps: ModulePanelProps = activePanel?.changes && reveal ? { ...panelProps, reveal } : panelProps

  return (
    // Open, the panel takes half the page, as Claude Code's does: a diff needs the room. On a phone
    // half a page is no room: it covers the page, the menu's button included, until it is closed.
    <aside className={isMobile ? 'absolute inset-0 z-20 flex flex-col bg-background' : 'flex w-1/2 min-w-[22rem] shrink-0 flex-col border-l border-border'}>
      {/* flex-wrap: without it the tail of a long row of tabs clipped (#948).
          Announced as the tabset it visually is. */}
      <div className="flex items-start gap-1 p-2">
      <div role="tablist" aria-label="Rail panels" className="flex min-w-0 flex-1 flex-wrap gap-1">
        {tabs.map(t => (
          <Tooltip key={t}>
            <TooltipTrigger
              render={
                <Button
                  role="tab"
                  aria-selected={active === t}
                  variant="ghost"
                  size="sm"
                  className={cn('h-7 gap-1.5 text-xs', active === t && 'bg-accent text-accent-foreground')}
                  onClick={() => pickTab(t)}
                />
              }
            >
              {label(t)}
              {count(t) > 0 && <Badge className="border-primary/40 text-primary">{count(t)}</Badge>}
            </TooltipTrigger>
            <TooltipContent className="max-w-64">{help(t)}</TooltipContent>
          </Tooltip>
        ))}
      </div>
      {toggle}
      </div>
      {/* The panel fills what is left of the side panel's height, and scrolls inside itself. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {activePanel ? (
          <ModuleSlot key={active} package={activePanel.package} label={`${activePanel.label} tab`}>
            <activePanel.Panel {...activeProps} />
          </ModuleSlot>
        ) : active === 'views' && hasViews ? (
          <ViewsRail views={views} />
        ) : (
          <DocsPanel docs={docs} loaded={docsLoaded} />
        )}
      </div>
    </aside>
  )
}
