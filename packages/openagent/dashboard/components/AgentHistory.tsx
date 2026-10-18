import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Plus, ChevronDown, Bot, Cloud, Laptop, Server, LayoutDashboard, Blocks, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft } from 'lucide-react'
import type { ComponentType } from 'react'
import type { AgentMeta, AgentStatus, RecentAgent, ProjectSummary } from '../../src/index.js'
import { DRIVER_LABELS, driverFromImpl, cloudRunState, type CloudRunState } from '../../src/client.js'
import { Button, buttonVariants } from './ui/button.js'
import { cn } from '../lib/utils.js'
import { formatRelative } from '../lib/format-date.js'
import { usePreferences } from '../lib/preferences.js'
import { STATUS_DOT, STATUS_RING } from '../lib/status-tone.js'
import { DriverLogo } from './driver-logos.js'
import { agentLabel, awaitingName } from '../lib/agent-label.js'
import { holdsMainAgent, isOpenSubagent, nestRows, taskLabel } from '../lib/subagents.js'
import { AddProjectPanel } from './AddProjectPanel.js'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from './ui/dropdown-menu.js'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip.js'
import { ProjectSelect } from './ProjectSelect.js'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  useSidebar,
} from './ui/sidebar.js'
import { ScrollArea } from './ui/scroll-area.js'
// Global chrome relocated off the removed top navbar (#772 follow-up): the sidebar is the app's
// chrome now, so the workspace keeps the full width.
import { BrandLink } from './BrandLink.js'
import { PersonMenu } from './PersonMenu.js'
import { SidebarResizer } from './SidebarResizer.js'
import { readAgentLogAhead } from '../lib/agent-log.js'

// One rendered row of the rail, from either source (a project's own run, or a pooled cross-project
// recent): the AgentMeta to show, an optional project label (only on the Overview, where the rail
// pools every project), whether it is the selected row, and what selecting it does.
type Row = { key: string; agent: AgentMeta; project?: string; active: boolean; onClick: () => void; onNear?: () => void }

/** What a row does as the pointer or the keyboard reaches it: an ended agent's log is read before the click, so its page opens drawn. A working agent's page reads no saved log. */
function near(projectId: string | null, agent: AgentMeta): { onNear?: () => void } {
  if (projectId === null || agent.status === 'running') return {}
  return { onNear: () => readAgentLogAhead(projectId, agent.id) }
}

// The Runs rail (#314 second sidebar), now the shadcn Sidebar (#shared-shell): one component on
// every route, so the home/Overview and a session page share the exact same left column instead of
// the rail vanishing the moment no project is selected. "New" is the permanent home/launcher —
// selecting it shows the Start form + cards (ProjectHome), and it is never consumed by an agent. Below
// it sit the recent sessions: the one project's own agents when the project select at the top names
// one (#1513), and every project's sessions pooled newest-first (`recentAgents`) when it says all
// projects, each row naming its project and jumping into it when selected. `agents`/`recentAgents` are owned by the shell
// so the rail and the main pane share one list. `startTick`/`startIntent`/`startId` seed an optimistic
// "starting…" row once a start reports its run, until that run's real card lands.
export function AgentHistory({
  projectId,
  scope = null,
  onScope = () => {},
  homeHref = '/',
  agents,
  selectedAgentId,
  onSelect,
  recentAgents,
  onSelectRecent,
  projects = [],
  onNewAgentInProject,
  onProjectAdded,
  startTick = 0,
  startIntent = '',
  startId = null,
  startProjectName,
  working = false,
  onDashboard = () => {},
  onSettings = () => {},
  pages = [],
  activePage = null,
  onPage = () => {},
  interventionCount = 0,
}: {
  /** The project of the page being shown, its launcher or one of its agents; null on every other page. */
  projectId: string | null
  /** The one project every page shows (#1513), picked at the top of the rail; null when all show. */
  scope?: string | null
  /** Pick the one project every page shows, or null for all of them. */
  onScope?: (projectId: string | null) => void
  /** The Overview's address, which keeps the picked project: where the brand links to. */
  homeHref?: string
  /** The picked project's agents; unused when all projects show, where `recentAgents` is the list. */
  agents: AgentMeta[]
  selectedAgentId: string | null
  onSelect: (agentId: string | null) => void
  /** The brand mark animates while any agent is working (moved off the navbar with the brand). */
  working?: boolean
  /** Go to the Overview (no project): the brand mark and the Overview item both call it. Defaults
   *  to a no-op so a focused unit test can mount the rail without wiring the shell's chrome. */
  onDashboard?: () => void
  /** Open Settings, from the person's menu at the sidebar's foot. */
  onSettings?: () => void
  /** The pages the installed modules add (#1774), the picked project's only when one is picked, one nav row each, below Overview. */
  pages?: readonly { segment: string; label: string; icon?: ComponentType<{ className?: string; 'aria-hidden'?: boolean }> }[]
  /** The module page that is the current view, by its segment, or null. */
  activePage?: string | null
  /** Open a module's page by its segment. */
  onPage?: (segment: string) => void
  /** Human Queue count, shown on the Overview item and the picker (#632). */
  interventionCount?: number
  /** Cross-project recents, for when all projects show: every project's sessions pooled. */
  recentAgents?: RecentAgent[]
  /** Select a pooled recent: jump into its project's session (project + run both change). */
  onSelectRecent?: (projectId: string, agentId: string) => void
  /** Every registered project, so "New" knows whether to add one, start in the only one, or pick. */
  projects?: ProjectSummary[]
  /** Start a new session in a project (its launcher). */
  onNewAgentInProject?: (projectId: string) => void
  /** A project was just added, so the shell can refresh its list. */
  onProjectAdded?: () => void
  startTick?: number
  startIntent?: string
  /** The id the start reported for its run: the row the stand-in waits for. */
  startId?: string | null
  /** The project that run was started in, by name: the stand-in row names it as the run's own row will. */
  startProjectName?: string | undefined
  /** Just started an agent that reported no id, so there is nothing selected to highlight yet (#705):
   *  put the highlight on the running/optimistic row rather than the New row until the shell adopts
   *  the agent's real id. An agent that did report one is selected by URL instead (#784). */
}) {
  // On a phone the rail is a sheet over the page, opened from the page's top left corner
  // (MenuButton): going somewhere from it closes it.
  const { isMobile, setOpenMobile } = useSidebar()
  const leave =
    <A extends unknown[]>(go: (...args: A) => void) =>
    (...args: A) => {
      setOpenMobile(false)
      go(...args)
    }
  // The coding agent picked for the next start: the stand-in row's logo.
  const preferences = usePreferences()
  // The optimistic row, and the id of the run it stands in for.
  const [optimistic, setOptimistic] = useState<{ intent: string; id: string | null } | null>(null)

  useEffect(() => {
    if (startTick > 0) setOptimistic({ intent: startIntent, id: startId })
  }, [startTick]) // eslint-disable-line react-hooks/exhaustive-deps

  // All projects show: the rail pools every project's sessions. One project: just its own.
  const crossProject = scope === null && recentAgents !== undefined
  const listed = crossProject ? recentAgents!.map(recent => recent.agent) : agents

  const hasRunning = listed.some(agent => agent.status === 'running')
  // The handover: the row this one stands in for has landed once the list holds the run the start
  // reported — whatever its status.
  //
  // Waiting for a run that was not in the list when the start came back was wrong: the start hook
  // takes seconds, so the list often held the new run already. It counted as an old run, the
  // stand-in never handed over, and it showed again beside the run's own row once that stopped
  // running, until the deadline below swept it.
  //
  // Watching `running` alone was too narrow. The agents list polls every 2s, so a session that starts
  // and finishes inside one interval is never once observed running, and the stand-in had nothing to
  // hand over to: it sat beside the finished session's own row, claiming a second session was
  // starting, until the deadline below swept it. That was hard to hit while a broken agent hung as
  // `running` forever; it stopped being hard once such agents began failing in milliseconds.
  const landed = optimistic !== null && listed.some(agent => agent.id === optimistic.id)
  useEffect(() => {
    if (landed) setOptimistic(null)
  }, [landed])
  useEffect(() => {
    setOptimistic(null)
  }, [scope])
  // A start that never produces an agent at all has nothing to hand over to either, so without a
  // deadline the row said "starting…" forever (#948). The Start form surfaces the actual error;
  // this just stops the rail pretending. Still the backstop, not the usual path: `landed` above
  // retires the row as soon as the real one exists.
  useEffect(() => {
    if (optimistic === null || hasRunning) return
    const timer = setTimeout(() => setOptimistic(null), 20_000)
    return () => clearTimeout(timer)
  }, [optimistic, hasRunning])

  // `landed` is checked here as well as in its effect so the stand-in and the real row are never
  // painted together for a frame while the effect is still queued.
  const showOptimistic = optimistic !== null && !hasRunning && !landed

  // A session selected but not in the list is one just started, whose row lands with its card
  // a beat later (#784): the optimistic row is standing in for it, so highlight that. Following a
  // just-started run (#705) counts too, before its id is known.
  const starting = selectedAgentId !== null && !listed.some(agent => agent.id === selectedAgentId)

  const rows: Row[] = crossProject
    ? recentAgents!.map(rr => ({
        key: `${rr.projectId}:${rr.agent.id}`,
        agent: rr.agent,
        project: rr.projectName,
        active: rr.projectId === projectId && rr.agent.id === selectedAgentId,
        onClick: () => onSelectRecent?.(rr.projectId, rr.agent.id),
        ...near(rr.projectId, rr.agent),
      }))
    : agents.map(agent => ({
        key: agent.id,
        agent: agent,
        // Following live highlights the newest running agent, not every one of them (#738):
        // `agents` is newest-first, so that is the first with a running status.
        active: agent.id === selectedAgentId,
        onClick: () => onSelect(agent.id),
        ...near(projectId, agent),
      }))

  // New is the active view when a project is open on its launcher (its "New" / Start-a-session
  // screen: a project selected, no run picked, not following a live one). On the Overview that role
  // belongs to the Overview item instead, so the two are never active at once.
  const atProjectLauncher = projectId !== null && selectedAgentId === null

  // The rows as a tree: a run started for another run in the list sits under it, as its subagent.
  const tree = nestRows(rows)
  // Which lists of subagents the reader opened or folded by hand, by the main agent's row.
  const [folds, setFolds] = useState<Record<string, boolean>>({})

  const hasRecents = rows.length > 0 || showOptimistic

  const renderRow = (row: Row, subagent: boolean, status: AgentStatus = row.agent.status, fold?: SubagentsFold) => (
    <AgentHistoryRow
      status={status}
      fold={fold}
      // A main agent shown as still going is not shown as saving too: one dot, one word.
      saving={row.agent.saving === true && status === row.agent.status}
      // A subagent's prompt is its task and then the lines every subagent is told: its row names the task.
      intent={subagent ? taskLabel(row.agent) : agentLabel(row.agent)}
      // A name is seconds away: the row holds the place rather than printing the whole prompt and
      // swapping it for the name a moment later.
      naming={!subagent && awaitingName(row.agent, preferences.nameRuns !== false)}
      driver={row.agent.driver}
      // On the Overview the project is what tells the rows apart, so the row still names it; a
      // project's own rail already knows its project, and a subagent is in its main agent's.
      {...(row.project && !subagent ? { project: row.project } : {})}
      subtitle={formatRelative(row.agent.startedAt)}
      active={row.active}
      remote={row.agent.target === 'remote'}
      cloud={row.agent.target === 'web'}
      {...(row.agent.otherHost && row.agent.host ? { startedOn: row.agent.host } : {})}
      cloudState={cloudRunState(row.agent, Date.now())}
      {...(row.agent.remoteLabel ? { remoteLabel: row.agent.remoteLabel } : {})}
      remoteByLine={row.agent.remoteByLine === true}
      {...(row.agent.pr ? { pr: { number: row.agent.pr.number, ...(row.agent.prState ? { state: row.agent.prState } : {}) } } : {})}
      onClick={leave(row.onClick)}
      onNear={row.onNear}
    />
  )

  return (
    // A fixed-width, in-flow column (`collapsible="none"`): with the top navbar gone (#772
    // follow-up), the sidebar carries the app's chrome — brand, global nav, and the utility
    // controls in the footer — so the workspace and the panes get the full height. A phone has no
    // width for a column: there it is a sheet over the page, closed until asked for.
    <Sidebar collapsible={isMobile ? 'offcanvas' : 'none'} className="relative w-(--sidebar-width) border-r border-sidebar-border">
      {/* The brand and the project select (#1513): the project picked here is the one every page
          under it shows. No rule under it: the room around it sets it apart. */}
      <SidebarHeader className="gap-4 pb-2">
        {/* The mark + wordmark, the way home (#909), now that there is no navbar to hold them. */}
        <div className="px-1 pt-1">
          <BrandLink working={working} href={homeHref} onNavigate={leave(onDashboard)} />
        </div>
        <ProjectSelect projects={projects} scope={scope} onScope={onScope} onProjectAdded={onProjectAdded} />
      </SidebarHeader>
      {/* New/Overview/the modules' pages stack tight as one nav group (gap-0.5), close under the
          project select (no top padding: the select's own section has its room below it), with a
          little space below the group (pb-2) before the session list. The `!` because a module's
          stylesheet, loaded after the dashboard's, redefines the header's own `p-2`, which would
          otherwise win over a plain `pt-0`. */}
      <SidebarHeader className="gap-0.5 pt-0! pb-2">
        {/* "New" starts a session — but where depends on what exists: with no project it prompts to
            add one first, with one project it starts there, with several it opens a picker. With
            one project picked at the top, it starts there. */}
        <NewButton
          scope={scope}
          projects={projects}
          active={atProjectLauncher}
          onNewAgentInProject={onNewAgentInProject && leave(onNewAgentInProject)}
          onSelect={leave(onSelect)}
          onProjectAdded={onProjectAdded}
        />
        {/* Overview: the way home, its own nav item directly under New and above the session list,
            more prominent than a menu row. Only this — the current view — carries the active fill. */}
        <OverviewButton active={projectId === null && activePage === null} count={interventionCount} onClick={leave(onDashboard)} />
        {/* The modules' pages the shell hands over (#1774), the picked project's only when one is
            picked: destinations with no project selected, like the Overview, named by the module,
            never by the dashboard — the tickets' page among them, when a package brings one. */}
        {pages.map(page => (
          <NavRow key={page.segment} icon={page.icon ?? Blocks} label={page.label} active={activePage === page.segment} onClick={leave(() => onPage(page.segment))} />
        ))}
      </SidebarHeader>
      {/* The themed ScrollArea (#913) instead of the sidebar's native overflow bar, matching the
          Overview: suppress SidebarContent's own `overflow-auto` and let the ScrollArea own it. */}
      <SidebarContent className="overflow-hidden">
        <ScrollArea className="min-h-0 flex-1">
          {/* pr-3 keeps the rows (and the active card) clear of the overlaid scrollbar (w-2.5). */}
          <SidebarGroup className="pt-3 pr-3">
            {/* The label sticks to the top of the scroll; the gradient strip under it (also sticky)
                fades the rows into the background as they scroll up beneath the label. Shown even
                when the list is empty (#1147): the heading is what makes "No sessions yet." read as
                the state of this list rather than a lonely line in the sidebar. */}
            <div className="sticky top-0 z-10">
              <SidebarGroupLabel className="rounded-none bg-sidebar font-normal tracking-wide text-muted-foreground">Recent agents</SidebarGroupLabel>
              {/* Absolute (hanging just below the label) so it does not push the first row down; it
                  still overlays the rows scrolling up under it. `rail-fade` keeps it invisible at
                  the top of the scroll (so it never dims the first row) and fades it in on scroll. */}
              <div aria-hidden className="rail-fade pointer-events-none absolute inset-x-0 top-full h-4 bg-gradient-to-b from-sidebar to-transparent" />
            </div>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {/* A just-started run, before its run.json exists — highlighted while following it. */}
                {showOptimistic && (
                  <SidebarMenuItem>
                    {/* Drawn as the run's own row will be a few seconds on (the same logo, not
                        dimmed), so that row taking its place changes nothing on screen. With naming
                        on that row will carry a name, so this one holds the place rather than
                        printing the prompt and having it swapped a second later. */}
                    <AgentHistoryRow
                      status="running"
                      {...(preferences.nameRuns === false ? { intent: optimistic?.intent ?? undefined } : { intent: undefined, naming: true })}
                      {...(crossProject && startProjectName ? { project: startProjectName } : {})}
                      subtitle="just now"
                      driver={preferences.driver}
                      active={starting}
                      standIn
                      onClick={leave(() => onSelect(null))}
                    />
                  </SidebarMenuItem>
                )}
                {tree.map(({ row, subagents }) => {
                  // Open while a subagent is not over, or is the page being read; folded to a count once
                  // all have ended. A click on the count is the reader's own choice and wins.
                  const open = folds[row.key] ?? subagents.some(sub => isOpenSubagent(sub.agent) || sub.active)
                  const working = subagents.filter(sub => sub.agent.status === 'running').length
                  // A main agent whose own turn is over while its job waits on a subagent is still going.
                  const now = Date.now()
                  const going = row.agent.status === 'done' && subagents.some(sub => holdsMainAgent(sub.agent, now))
                  return (
                    <SidebarMenuItem key={row.key}>
                      {renderRow(
                        row,
                        false,
                        going ? 'running' : row.agent.status,
                        subagents.length > 0 ? { count: subagents.length, working, open, onToggle: () => setFolds(f => ({ ...f, [row.key]: !open })) } : undefined,
                      )}
                      {subagents.length > 0 && open && (
                        // The indented sub-list, with the rule the Projects list draws down its group.
                        <div className="mt-0.5 ml-4 flex flex-col gap-0.5 border-l border-sidebar-border pl-2">
                          {subagents.map(sub => (
                            <div key={sub.key}>{renderRow(sub, true)}</div>
                          ))}
                        </div>
                      )}
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
              {!hasRecents && (
                <p className="whitespace-nowrap px-2 py-1 text-sm text-muted-foreground">No agents yet.</p>
              )}
            </SidebarGroupContent>
          </SidebarGroup>
        </ScrollArea>
      </SidebarContent>
      {/* The person at this dashboard, as one row that opens their menu: the theme, the
          notifications and Settings (PersonMenu). */}
      <SidebarFooter className="border-t border-sidebar-border">
        <PersonMenu onSettings={leave(onSettings)} />
      </SidebarFooter>
      {/* Its right edge, dragged to set its width; a phone's sheet has none. */}
      {!isMobile && <SidebarResizer />}
    </Sidebar>
  )
}

// One rail destination — Overview, a module's page. Same box as New (px-2 py-1.5 gap-2) so every row's
// icon and label line up exactly, and only the current view carries the active fill.
function NavRow({
  icon: Icon,
  label,
  active,
  onClick,
  children,
}: {
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  label: string
  active: boolean
  onClick: () => void
  /** What sits after the label, e.g. the Overview row's Human Queue badge. */
  children?: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
        active ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-foreground hover:bg-sidebar-accent/60',
      )}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      <span className="flex-1 text-left">{label}</span>
      {children}
    </button>
  )
}

// The Overview entry (Rom): the way home, pinned above the session list and more prominent than a
// menu row. Carries the Human Queue count (#632) so the one cross-project signal stays visible, and
// highlights while it is the current view.
function OverviewButton({ active, count, onClick }: { active: boolean; count: number; onClick: () => void }) {
  return (
    <NavRow icon={LayoutDashboard} label="Overview" active={active} onClick={onClick}>
      {count > 0 && (
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="min-w-5 rounded-full bg-primary px-1.5 text-center text-xs font-semibold text-primary-foreground tabular-nums" />
            }
          >
            {count}
          </TooltipTrigger>
          <TooltipContent>
            {count} item{count === 1 ? '' : 's'} in your Human Queue
          </TooltipContent>
        </Tooltip>
      )}
    </NavRow>
  )
}

// The "New" launcher, project-count aware (#new-button). With one project picked at the top of the
// rail, it starts a session there. With all projects showing it adapts to how many exist: none -> open the add-project dialog
// (you cannot start a session with nowhere to run it); one -> start there; several -> a small picker
// so you choose where. The label + Plus stay the same in every case, so it reads as one button.
function NewButton({
  scope,
  projects,
  active = false,
  onNewAgentInProject,
  onSelect,
  onProjectAdded,
}: {
  scope: string | null
  projects: ProjectSummary[]
  /** On a project's launcher (its "New" screen), so New reads as the current view. Off on the
   *  Overview, where the Overview item is the active one instead — the two are never both active. */
  active?: boolean
  onNewAgentInProject?: ((projectId: string) => void) | undefined
  onSelect: (agentId: string | null) => void
  onProjectAdded?: (() => void) | undefined
}) {
  const [adding, setAdding] = useState(false)
  // Same box as the Overview row (px-2 py-1.5 gap-2) so their icons and labels align; h-auto/px-2/
  // py-1.5 override the button size's default h-9/px-4/py-2. The active fill (same tokens as
  // Overview) only on this project's launcher; otherwise plain, since New is an action, not a place.
  const cls = cn(
    'h-auto w-full justify-start gap-2 px-2 py-1.5 font-normal',
    active && 'bg-sidebar-accent text-sidebar-accent-foreground',
  )
  const start = (id: string) => (onNewAgentInProject ? onNewAgentInProject(id) : onSelect(null))

  // One project picked, or exactly one registered: start a session straight away.
  if (scope !== null || projects.length === 1) {
    const target = scope ?? projects[0]!.id
    return (
      <Button variant="ghost" className={cls} onClick={() => start(target)}>
        <Plus className="h-4 w-4 shrink-0" />
        <span className="whitespace-nowrap">New agent</span>
      </Button>
    )
  }

  // No projects: there is nowhere to run a session, so prompt to add one first.
  if (projects.length === 0) {
    return (
      <>
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" className={cls} onClick={() => setAdding(true)} />}>
            <Plus className="h-4 w-4 shrink-0" />
            <span className="whitespace-nowrap">New agent</span>
          </TooltipTrigger>
          <TooltipContent>Add a project to start an agent</TooltipContent>
        </Tooltip>
        {adding && <AddProjectPanel onAdded={() => onProjectAdded?.()} onClose={() => setAdding(false)} />}
      </>
    )
  }

  // Several projects: pick which one the new session agents in.
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label="New agent" className={cn(buttonVariants({ variant: 'ghost' }), cls)}>
        <Plus className="h-4 w-4 shrink-0" />
        <span className="whitespace-nowrap">New agent</span>
        <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[13.5rem]">
        {projects.map(p => (
          <DropdownMenuItem key={p.id} onClick={() => start(p.id)}>
            {/* Match the picker's activated dot so the two project lists read the same (#695/U33). */}
            <span
              aria-hidden
              className={cn('h-2 w-2 shrink-0 rounded-full', p.activated ? 'bg-primary' : 'bg-muted-foreground')}
            />
            <span className="flex-1 truncate">{p.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** A main agent's list of subagents, as its row folds it: how many, how many work, and the fold. */
type SubagentsFold = { count: number; working: number; open: boolean; onToggle: () => void }

// A run just started: its title comes in letter by letter, each out of a light blur, as Claude
// Code on the web shows a new session's. The stand-in row starts it; the run's own row, taking that
// row's place a moment later, goes on from where it was, so the title neither restarts nor jumps
// to whole. Kept by the title's words, for as long as a reveal lasts.
const REVEAL_STEP_MS = 30
const REVEAL_LETTERS = 24
const REVEAL_MS = REVEAL_STEP_MS * REVEAL_LETTERS + 300
const revealedSince = new Map<string, number>()

function RevealedTitle({ text, start }: { text: string; start: boolean }) {
  // How far into its reveal the title is, read once, when the row is drawn first.
  const [elapsed] = useState(() => {
    const now = Date.now()
    for (const [words, since] of revealedSince) if (now - since > REVEAL_MS) revealedSince.delete(words)
    const since = revealedSince.get(text)
    if (since !== undefined) return now - since
    if (!start) return REVEAL_MS
    revealedSince.set(text, now)
    return 0
  })
  if (elapsed >= REVEAL_MS) return text
  const letters = [...text]
  const delay = (at: number) => ({ animationDelay: `${Math.min(at, REVEAL_LETTERS) * REVEAL_STEP_MS - elapsed}ms` })
  return (
    <>
      {letters.slice(0, REVEAL_LETTERS).map((letter, at) => (
        <span key={at} className="letter-in" style={delay(at)}>
          {letter}
        </span>
      ))}
      {letters.length > REVEAL_LETTERS && (
        <span className="letter-in" style={delay(REVEAL_LETTERS)}>
          {letters.slice(REVEAL_LETTERS).join('')}
        </span>
      )}
    </>
  )
}

/** How a run's pull request stands, as the git host last said. */
type PrState = NonNullable<AgentMeta['prState']>

/**
 * A run's pull request on its row, one glyph per state in the git host's own colours, so a list of
 * runs says which have work waiting for review and which landed without opening one. Each state
 * has its own shape too, for a reader who cannot tell the colours apart. A request whose state was
 * not read (older than the git host lists) is drawn plainly.
 */
const PR_MARKS: Record<PrState | 'unknown', { Icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>; tone: string; word?: string }> = {
  open: { Icon: GitPullRequest, tone: 'text-success', word: 'open' },
  draft: { Icon: GitPullRequestDraft, tone: 'text-muted-foreground', word: 'draft' },
  merged: { Icon: GitMerge, tone: 'text-merged', word: 'merged' },
  closed: { Icon: GitPullRequestClosed, tone: 'text-danger', word: 'closed' },
  unknown: { Icon: GitPullRequest, tone: 'text-muted-foreground' },
}

// One agent row, one line: a small circle and the session's name, as Claude Code on the web lists
// its sessions. The row used to be two lines — a status word, the project, the time and the agent's
// logo above the name — which made the list a column of paragraphs and fitted half as many sessions
// on the screen. What those words said is now the circle (what the run is doing, by its colour and
// whether it is filled) and the row's hover, which says all of it in a sentence.
function AgentHistoryRow({
  status,
  intent,
  naming = false,
  project,
  subtitle,
  active,
  onClick,
  onNear,
  driver,
  standIn = false,
  saving = false,
  remote = false,
  cloud = false,
  cloudState,
  remoteLabel,
  remoteByLine = false,
  startedOn,
  fold,
  pr,
}: {
  status: AgentStatus
  /** The row's subagents, folded or open under it: a count at the row's end, so a row with subagents is no taller than one without. */
  fold?: SubagentsFold | undefined
  intent: string | undefined
  /** The run's name is on its way: the row shows where it will go, not the prompt it would replace. */
  naming?: boolean
  /** When the sessions come from several projects, which one this is: it is what tells the rows apart there. */
  project?: string | undefined
  subtitle: string
  /** The agent that ran it, so the row can show whose session it was. */
  driver?: string | undefined
  active: boolean
  onClick: () => void
  /** The pointer or the keyboard reached the row, before any click. */
  onNear?: (() => void) | undefined
  /** The row stands in for a run just started, until that run's own row lands. */
  standIn?: boolean
  /** Ended clean, its process still saving its record and cleaning up its checkout (#1455): the row must
   *  not say "done" while the session's own pill says "saving…". */
  saving?: boolean
  /** Runs on a saved machine (#1067): the row gets a machine glyph next to the agent logo. */
  remote?: boolean
  /** A Claude Code cloud session (#1263): the row gets a cloud glyph beside the agent logo. */
  cloud?: boolean
  /** What that session is doing (#1668), once the local half is over; undefined = the status is the word. */
  cloudState?: CloudRunState | undefined
  /** The machine's label, for the glyph's tooltip. */
  remoteLabel?: string | undefined
  /** That machine is a person's own computer, reached by the line it keeps open here: the glyph is a computer, not a server. */
  remoteByLine?: boolean
  /** The machine whose daemon started the run, when that is another machine (#1648): a glyph names it. */
  startedOn?: string | undefined
  /** The run's pull request, and how it stands when the git host said: a glyph before the agent's logo. */
  pr?: { number: number; state?: PrState } | undefined
}) {
  // A run that ended on its question waits on you (#785), and so does a web run whose cloud
  // session the bridge reports as parked (#1668).
  const parked = status === 'waiting' || cloudState === 'waiting'
  const picked = driverFromImpl(driver)
  const MachineIcon = remoteByLine ? Laptop : Server
  // A web agent's local process ends at the hand-off by design, so its `done` is about this
  // machine, not the session (#1264): the cloud side keeps working and opens its own PR. Saying
  // "done" under ten working cloud agents is the lie the demo would put on camera — and "in cloud"
  // over a run whose PR merged two days ago is the opposite lie (#1668), so the word comes from
  // what is known of the session: waiting, in cloud, merged, or finally done.
  const inCloud = cloudState === 'in-cloud'
  const cloudWord = cloudState === 'merged' ? 'merged' : undefined
  // "In cloud" outranks "saving…": a web agent's local half is over either way, and the cloud
  // side owns its own push/PR, so the cloud word is the truer one for that row.
  const savingNow = saving && !cloud
  // The title only fades + carries a tooltip when it actually overflows the fixed-width rail; a
  // short one shows plainly. Measured here since CSS cannot tell. The rail width is fixed, so
  // intent is the only thing that changes the answer.
  const titleRef = useRef<HTMLSpanElement>(null)
  const [overflowing, setOverflowing] = useState(false)
  useEffect(() => {
    const el = titleRef.current
    if (el) setOverflowing(el.scrollWidth > el.clientWidth + 1)
  }, [intent])
  const titleText = naming ? '' : intent || 'New agent'
  const titleClass = cn('rail-title min-w-0 flex-1 text-sm font-normal', overflowing && 'is-overflowing')
  // What the row says in a word, the one the status badge used to print: it names the circle, and
  // opens the sentence the row's hover says.
  const word = parked ? 'waiting' : inCloud ? 'in cloud' : cloudWord ? cloudWord : savingNow ? 'saving…' : status
  // The circle: filled while something is going on, a ring once nothing is, and the colour is the
  // status vocabulary every list shares (`status-tone.ts`). Only a run that is working pulses — a
  // run parked on you has been still for as long as you have not answered it (#785).
  const working = status === 'running' || inCloud || savingNow
  const dotTone = savingNow ? STATUS_DOT['saving'] : parked ? STATUS_DOT['waiting'] : working ? STATUS_DOT['running'] : STATUS_DOT[status]
  const ringTone = (cloudWord ? STATUS_RING[cloudWord] : STATUS_RING[status]) ?? STATUS_RING['done']
  const prMark = pr ? PR_MARKS[pr.state ?? 'unknown'] : undefined
  const prSaid = pr && prMark ? `PR #${pr.number}${prMark.word ? ` ${prMark.word}` : ''}` : undefined
  // Everything the two-line row used to print, in one sentence on hover: the word, where the run
  // is and when it started, which coding agent ran it, and the machine or cloud it ran on.
  const said = [
    word,
    ...(project ? [project] : []),
    subtitle,
    ...(picked ? [DRIVER_LABELS[picked]] : []),
    ...(startedOn ? [`started on ${startedOn}`] : []),
    ...(remote ? [remoteLabel ? `runs on ${remoteLabel}` : 'runs on another machine'] : []),
    ...(cloud ? ['a Claude Code cloud session'] : []),
    ...(prSaid ? [prSaid] : []),
  ].join(' · ')
  // The hover says what the row no longer prints, and a name too long for the rail in full under it
  // (#1494) — the marquee it replaced forced reading at the animation's pace. The row itself is the
  // trigger, so there is no wrapper between the list and its rows.
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            // The row prints its name and a circle; what it no longer prints is still its name
            // here, so a reader who cannot see the row's colour, or cannot hover it, is told the
            // same sentence.
            aria-label={`${naming ? 'Naming this session' : titleText} · ${said}`}
            className={cn(
              'rail-row h-8 w-full items-center gap-2 px-2 text-left',
              active && 'bg-accent text-accent-foreground',
            )}
            {...(standIn ? { 'data-stand-in': '' } : {})}
            onClick={onClick}
            onPointerEnter={onNear}
            onFocus={onNear}
          />
        }
      >
      {/* The circle stands where the status word stood, and carries that word for a reader who
          cannot see a colour. */}
      <span
        role="img"
        aria-label={word}
        className={cn(
          'inline-block h-2 w-2 shrink-0 rounded-full',
          dotTone ?? cn('border', ringTone),
          working && 'animate-pulse',
        )}
      />
      <span ref={titleRef} className={titleClass}>
        {/* Nothing yet, and something coming: a bar where the name goes, rather than a blank row or
            the prompt it is about to replace. */}
        {naming ? <span aria-hidden className="block h-3.5 w-2/3 animate-pulse rounded bg-muted-foreground/20" /> : <RevealedTitle text={titleText} start={standIn} />}
      </span>
      {/* What is unusual about where the run is, kept on the row as one small glyph: another
          machine, a person's own computer, a cloud session. Rare, so the row stays a circle and a
          name nearly always; the coding agent's own logo was on every row and is now in the
          sentence instead. */}
      {startedOn && (
        <Laptop className="h-3 w-3 shrink-0 text-muted-foreground" role="img" aria-label={`Started on ${startedOn}`} />
      )}
      {remote && (
        <MachineIcon className="h-3 w-3 shrink-0 text-muted-foreground" role="img" aria-label={remoteLabel ? `Runs on ${remoteLabel}` : 'Runs on another machine'} />
      )}
      {cloud && <Cloud className="h-3 w-3 shrink-0 text-muted-foreground" role="img" aria-label="Runs as a Claude Code cloud session" />}
      {/* Where the sessions of several projects are listed together, the project is what tells one
          row from the next, so it stays on the row: small, after the marks, and the first to give
          up width. A project's own rail knows its project and shows none. */}
      {project && <span className="min-w-0 shrink truncate text-xs text-muted-foreground">{project}</span>}
      {/* The row's subagents: how many, and the fold of their list. A control, so it stays on the
          row rather than moving into the hover. Inside the row's own button, so it is a span that
          takes the click for itself. */}
      {fold && (
        <span
          role="button"
          tabIndex={0}
          aria-expanded={fold.open}
          aria-label={`${fold.count} agent${fold.count === 1 ? '' : 's'}${fold.working > 0 ? ` · ${fold.working} running` : ''}`}
          title={`${fold.count} subagent${fold.count === 1 ? '' : 's'}${fold.working > 0 ? `, ${fold.working} running` : ''}`}
          onClick={e => {
            e.stopPropagation()
            fold.onToggle()
          }}
          onKeyDown={e => {
            if (e.key !== 'Enter' && e.key !== ' ') return
            e.preventDefault()
            e.stopPropagation()
            fold.onToggle()
          }}
          className="flex shrink-0 items-center gap-0.5 rounded-sm px-1 text-[11px] font-normal tabular-nums text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
        >
          <ChevronDown className={cn('h-3 w-3 shrink-0 transition-transform', fold.open || '-rotate-90')} aria-hidden />
          <Bot className="h-3 w-3 shrink-0" aria-hidden />
          {fold.count}
        </span>
      )}
      {/* Its pull request, just before the logo, so the marks of the rows that have one stand in a
          column too. */}
      {prMark && prSaid && (
        <span role="img" aria-label={prSaid} className="flex shrink-0 items-center">
          <prMark.Icon className={cn('h-3 w-3', prMark.tone)} aria-hidden />
        </span>
      )}
      {/* Which coding agent ran it, as its own mark at the very end of the row (his pick): a
          session is told from the next by its agent as much as by its words, and a logo reads
          faster than a word. Last, after every other mark, so the logos of all rows stand in one
          column. */}
      {picked && (
        <span role="img" aria-label={DRIVER_LABELS[picked]} className="flex shrink-0 items-center">
          <DriverLogo driver={picked} className="h-3 w-3 text-muted-foreground" />
        </span>
      )}
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-96 whitespace-pre-wrap break-words">
        {overflowing ? `${titleText}\n${said}` : said}
      </TooltipContent>
    </Tooltip>
  )
}
