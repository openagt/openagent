import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Plus, ChevronDown, Bot, Cloud, Laptop, MonitorSmartphone, Settings, LayoutDashboard, Blocks } from 'lucide-react'
import type { ComponentType } from 'react'
import type { AgentMeta, AgentStatus, RecentAgent, ProjectSummary } from '../../src/index.js'
import { DRIVER_LABELS, driverFromImpl, cloudRunState, type CloudRunState } from '../../src/client.js'
import { Button, buttonVariants } from './ui/button.js'
import { Badge } from './ui/badge.js'
import { cn } from '../lib/utils.js'
import { formatRelative } from '../lib/format-date.js'
import { usePreferences } from '../lib/preferences.js'
import { STATUS_TONE } from '../lib/status-tone.js'
import { agentLabel } from '../lib/agent-label.js'
import { holdsMainAgent, isOpenSubagent, nestRows, taskLabel } from '../lib/subagents.js'
import { DriverLogo } from './driver-logos.js'
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
} from './ui/sidebar.js'
import { ScrollArea } from './ui/scroll-area.js'
// Global chrome relocated off the removed top navbar (#772 follow-up): the sidebar is the app's
// chrome now, so the workspace keeps the full width.
import { BrandLink } from './BrandLink.js'
import { ConnectionIndicator } from './ConnectionIndicator.js'
import { ThemeToggle } from './ThemeToggle.js'
import { NotificationsMenu } from './NotificationsMenu.js'
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
  /** Open Settings, from the sidebar footer where the navbar gear moved. */
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
      driver={row.agent.driver}
      // On the Overview the project is what tells the rows apart, so it leads the meta
      // line; a project's own rail already knows its project, so it shows just the time. A
      // subagent is in its main agent's project.
      subtitle={row.project && !subagent ? `${row.project} · ${formatRelative(row.agent.startedAt)}` : formatRelative(row.agent.startedAt)}
      active={row.active}
      remote={row.agent.target === 'remote'}
      cloud={row.agent.target === 'web'}
      {...(row.agent.otherHost && row.agent.host ? { startedOn: row.agent.host } : {})}
      cloudState={cloudRunState(row.agent, Date.now())}
      {...(row.agent.remoteLabel ? { remoteLabel: row.agent.remoteLabel } : {})}
      onClick={row.onClick}
      onNear={row.onNear}
    />
  )

  return (
    // A fixed-width, in-flow column (`collapsible="none"`): with the top navbar gone (#772
    // follow-up), the sidebar carries the app's chrome — brand, global nav, and the utility
    // controls in the footer — so the workspace and right rail get the full height.
    <Sidebar collapsible="none" className="w-(--sidebar-width) border-r border-sidebar-border">
      {/* The brand and the project select, set apart from everything below by a rule (#1513): the
          project picked here is the one every page under it shows. */}
      <SidebarHeader className="gap-3 border-b border-sidebar-border pb-3">
        {/* The mark + wordmark, the way home (#909), now that there is no navbar to hold them. */}
        <div className="px-1 pt-1">
          <BrandLink working={working} href={homeHref} onNavigate={onDashboard} />
        </div>
        <ProjectSelect projects={projects} scope={scope} onScope={onScope} onProjectAdded={onProjectAdded} />
      </SidebarHeader>
      {/* New/Overview/the modules' pages stack tight as one nav group (gap-0.5), with a little space
          below the group (pb-2) before the session list. */}
      <SidebarHeader className="gap-0.5 pb-2">
        {/* "New" starts a session — but where depends on what exists: with no project it prompts to
            add one first, with one project it starts there, with several it opens a picker. With
            one project picked at the top, it starts there. */}
        <NewButton
          scope={scope}
          projects={projects}
          active={atProjectLauncher}
          onNewAgentInProject={onNewAgentInProject}
          onSelect={onSelect}
          onProjectAdded={onProjectAdded}
        />
        {/* Overview: the way home, its own nav item directly under New and above the session list,
            more prominent than a menu row. Only this — the current view — carries the active fill. */}
        <OverviewButton active={projectId === null && activePage === null} count={interventionCount} onClick={onDashboard} />
        {/* The modules' pages the shell hands over (#1774), the picked project's only when one is
            picked: destinations with no project selected, like the Overview, named by the module,
            never by the dashboard — the tickets' page among them, when a package brings one. */}
        {pages.map(page => (
          <NavRow key={page.segment} icon={page.icon ?? Blocks} label={page.label} active={activePage === page.segment} onClick={() => onPage(page.segment)} />
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
              <SidebarGroupLabel className="rounded-none bg-background font-normal tracking-wide text-muted-foreground">Recent agents</SidebarGroupLabel>
              {/* Absolute (hanging just below the label) so it does not push the first row down; it
                  still overlays the rows scrolling up under it. `rail-fade` keeps it invisible at
                  the top of the scroll (so it never dims the first row) and fades it in on scroll. */}
              <div aria-hidden className="rail-fade pointer-events-none absolute inset-x-0 top-full h-4 bg-gradient-to-b from-background to-transparent" />
            </div>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {/* A just-started run, before its run.json exists — highlighted while following it. */}
                {showOptimistic && (
                  <SidebarMenuItem>
                    {/* Drawn as the run's own row will be a few seconds on (the same words, the same
                        logo, not dimmed), so that row taking its place changes nothing on screen. */}
                    <AgentHistoryRow status="running" intent={optimistic?.intent ?? undefined} subtitle={crossProject && startProjectName ? `${startProjectName} · just now` : 'just now'} driver={preferences.driver} active={starting} standIn onClick={() => onSelect(null)} />
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
      {/* The navbar's utility controls, relocated to the foot of the sidebar (#772 follow-up):
          which daemon this is (Local/remote), theme, notifications, and Settings. */}
      <SidebarFooter className="border-t border-sidebar-border">
        <div className="flex items-center gap-1">
          <ConnectionIndicator />
          <div className="min-w-0 flex-1" />
          <ThemeToggle />
          <NotificationsMenu />
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="sm" onClick={onSettings} aria-label="Settings" />}>
              <Settings className="h-4 w-4" aria-hidden />
            </TooltipTrigger>
            <TooltipContent>Settings</TooltipContent>
          </Tooltip>
        </div>
      </SidebarFooter>
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

// One agent row: a pulsing dot + RUNNING badge for a working agent, a still dot + WAITING for one
// parked on the user (#785), else the terminal-status badge.
function AgentHistoryRow({
  status,
  intent,
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
  startedOn,
  fold,
}: {
  status: AgentStatus
  /** The row's subagents, folded or open under it: a count on the row's first line, so a row with subagents is no taller than one without. */
  fold?: SubagentsFold | undefined
  intent: string | undefined
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
  /** The machine whose daemon started the run, when that is another machine (#1648): a glyph names it. */
  startedOn?: string | undefined
}) {
  // A run that ended on its question waits on you (#785), and so does a web run whose cloud
  // session the bridge reports as parked (#1668).
  const parked = status === 'waiting' || cloudState === 'waiting'
  const picked = driverFromImpl(driver)
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
  const titleText = intent || 'New agent'
  const titleClass = cn('rail-title w-full px-2 text-sm font-normal', overflowing && 'is-overflowing')
  return (
    <Button
      variant="ghost"
      className={cn(
        // px-0 (overriding the button base's px-4) so the card has no horizontal padding: the title
        // spans edge to edge and its clip/fade land on the border. Inner rows carry their own px-2.
        'rail-row h-auto w-full flex-col items-start gap-0.5 px-0 py-2 text-left',
        active && 'bg-accent text-accent-foreground',
      )}
      {...(standIn ? { 'data-stand-in': '' } : {})}
      onClick={onClick}
      onPointerEnter={onNear}
      onFocus={onNear}
    >
      <span className="flex w-full items-center gap-2 px-2">
        {/* The dot means "the agent is working", so a run parked on you gets a still one (#785):
            it used to pulse identically whether it was mid-edit or had been idle for an hour. */}
        {/* The saving dot pulses green like the session pill's (#1431), so the two surfaces
            describe the same window the same way. */}
        {/* `parked` alone covers the cloud-side wait: its local status is done, but "waiting"
            always comes with the still dot, wherever the session is parked. */}
        {(status === 'running' || parked) && (
          <span className={cn('inline-block h-2 w-2 shrink-0 rounded-full', parked ? 'bg-muted-foreground' : 'animate-pulse bg-primary')} />
        )}
        {savingNow && <span className="inline-block h-2 w-2 shrink-0 animate-pulse rounded-full bg-success" />}
        <Badge className={cn('shrink-0 border-transparent px-0 text-[10px] uppercase', parked || savingNow ? 'text-muted-foreground' : inCloud ? 'text-primary' : cloudWord ? 'text-success' : STATUS_TONE[status])}>
          {parked ? 'waiting' : inCloud ? 'in cloud' : cloudWord ? cloudWord : savingNow ? 'saving…' : status}
        </Badge>
        <span className="truncate text-xs font-normal text-muted-foreground">{subtitle}</span>
        {/* Right cluster: a machine glyph when the run is relayed to a saved machine (#1067),
            a cloud glyph for a Claude Code cloud session (#1263), then the driver logo. The logo
            is the only thing naming the driver on this row, so it carries a title rather than
            being decorative. */}
        {(remote || cloud || picked || startedOn || fold) && (
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {/* The row's subagents: how many, and the fold of their list. Inside the row's own
                button, so it is a span that takes the click for itself. */}
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
                className="flex items-center gap-0.5 rounded-sm px-1 text-[11px] font-normal tabular-nums text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
              >
                <ChevronDown className={cn('h-3 w-3 shrink-0 transition-transform', fold.open || '-rotate-90')} aria-hidden />
                <Bot className="h-3 w-3 shrink-0" aria-hidden />
                {fold.count}
              </span>
            )}
            {/* Another machine's daemon started this run (#1648): the shared agent-data branch lists every
                machine's runs here, and one that looked exactly like this daemon's own was a mystery
                solved only by reading the archive. A glyph, not a word in the meta line: the rail's
                fixed width truncated a hostname to "from…". */}
            {startedOn && (
              <Tooltip>
                <TooltipTrigger render={<span className="flex items-center" />}>
                  <Laptop className="h-3 w-3 text-muted-foreground" aria-label={`Started on ${startedOn}`} />
                </TooltipTrigger>
                <TooltipContent>Started on {startedOn}, by that machine's daemon.</TooltipContent>
              </Tooltip>
            )}
            {remote && (
              <Tooltip>
                <TooltipTrigger render={<span className="flex items-center" />}>
                  <MonitorSmartphone className="h-3 w-3 text-muted-foreground" aria-label={remoteLabel ? `Runs on ${remoteLabel}` : 'Runs on another machine'} />
                </TooltipTrigger>
                <TooltipContent>{remoteLabel ? `Runs on ${remoteLabel}` : 'Runs on another machine'}</TooltipContent>
              </Tooltip>
            )}
            {cloud && (
              <Tooltip>
                <TooltipTrigger render={<span className="flex items-center" />}>
                  <Cloud className="h-3 w-3 text-muted-foreground" aria-label="Runs as a Claude Code cloud session" />
                </TooltipTrigger>
                <TooltipContent>Runs as a Claude Code cloud session; it works and opens its PR over there.</TooltipContent>
              </Tooltip>
            )}
            {picked && (
              // The logo is the only thing naming the driver on this row, so the trigger carries the
              // accessible name and the logo itself stays decorative.
              <Tooltip>
                <TooltipTrigger render={<span className="flex items-center" role="img" aria-label={DRIVER_LABELS[picked]} />}>
                  <DriverLogo driver={picked} className="h-3 w-3 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent>{DRIVER_LABELS[picked]}</TooltipContent>
              </Tooltip>
            )}
          </span>
        )}
      </span>
      {/* A truncated title shows its full prompt in a tooltip (#1494) — the hover marquee it
          replaces forced reading at the animation's pace and moved the text under the cursor.
          The end-fade stays as the truncation cue; a title that fits gets no tooltip at all. */}
      {overflowing ? (
        <Tooltip>
          <TooltipTrigger render={<span ref={titleRef} className={titleClass} />}>{titleText}</TooltipTrigger>
          <TooltipContent side="right" className="max-w-96 whitespace-pre-wrap break-words">
            {titleText}
          </TooltipContent>
        </Tooltip>
      ) : (
        <span ref={titleRef} className={titleClass}>
          {titleText}
        </span>
      )}
    </Button>
  )
}
