import { PERMISSIONS_PAGE } from '../lib/use-route.js'
import { RevealedTitle } from './RevealedTitle.js'
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { Plus, SlidersHorizontal, Check, Folder, Laptop, LayoutDashboard, Blocks, FilePen, GitBranch, KeyRound } from 'lucide-react'
import { HOST_ICON } from './RunOnMenu.js'
import { hostOf, useRunHosts } from '../lib/run-hosts.js'
import { PersonMark, personName } from './PersonMark.js'
import { effortLabel } from '../lib/effort.js'
import type { ComponentType } from 'react'
import type { AgentMeta, AgentStatus, RecentAgent, ProjectSummary, Waiting } from '../../src/index.js'
import { waitingKey } from '../../src/client.js'
import type { ModuleHostPerson } from '../module/index.js'
import { buttonVariants } from './ui/button.js'
import { inPlace } from '../lib/in-place.js'
import { formatRoute, type Route } from '../lib/route.js'
import { NO_PROJECTS } from '../../src/project-address.js'
import { cn } from '../lib/utils.js'
import { formatRelative, formatSince } from '../lib/format-date.js'
import { updatePreferences, usePreferences } from '../lib/preferences.js'
import { RECENTS_GROUP_LABELS, RECENTS_SORT_LABELS, groupRuns, sortRuns, type RecentsGroup, type RecentsSort } from '../lib/recents-sort.js'
import { useGlide } from '../lib/glide.js'
import { useRailScroll } from '../lib/rail-scroll.js'
import { useProjectLabel } from '../lib/project-labels.js'
import { runState } from '../lib/run-words.js'
import { RunMark } from './RunMark.js'
import { agentOf, modelName, useAgents, useNamesRuns } from '../lib/agents.js'
import { PackageLogo } from './Logins.js'
import { PR_MARKS, type PrState } from '../lib/pr-marks.js'
import { agentLabel, awaitingName } from '../lib/agent-label.js'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuCheckboxItem, DropdownMenuSeparator } from './ui/dropdown-menu.js'
import { SESSIONS_ID } from '../../src/project-address.js'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip.js'
import { SidebarProjectPicker } from './SidebarProjectPicker.js'
import { navRowClass } from './ui/nav-row.js'
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
import { Skeleton } from './ui/skeleton.js'
import { Slot } from './ui/slot.js'
import { PopupPlacementContext } from './ui/popup-placement.js'
// Global chrome relocated off the removed top navbar (#772 follow-up): the sidebar is the app's
// chrome now, so the workspace keeps the full width.
import { BrandLink } from './BrandLink.js'
import { PersonMenu } from './PersonMenu.js'
import { SidebarResizer } from './SidebarResizer.js'
import { HideSidebarButton } from './SidebarToggle.js'
import { JumpButton } from './JumpPalette.js'
import { readAgentLogAhead } from '../lib/agent-log.js'
import { onPeople } from '../rpc/people.js'
import { personSaid, usePeople } from '../lib/use-people.js'
import { usePerson } from '../lib/use-person.js'

// One rendered row of the rail, from either source (a project's own run, or a pooled cross-project
// recent): the AgentMeta to show, an optional project label (only on the Overview, where the rail
// pools every project), whether it is the selected row, and what selecting it does.
type Row = { key: string; agent: AgentMeta; project?: string; projectId: string | null; active: boolean; href: string; onClick: () => void; onNear?: () => void }

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
  pageScrolls = false,
  projectId,
  scope = null,
  scopePending = false,
  listLoaded = true,
  onScope = () => {},
  homeHref = '/',
  agents,
  selectedAgentId,
  notFound = false,
  onSelect,
  recentAgents,
  onSelectRecent,
  projects = [],
  onNewAgentInProject,
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
  waiting = [],
  hrefOf = route => formatRoute(route, NO_PROJECTS),
}: {
  /** The page beside it scrolls as a page (App): the sidebar then stays where it is, as tall as the screen. */
  pageScrolls?: boolean
  /** The project of the page being shown, its launcher or one of its agents; null on every other page. */
  projectId: string | null
  /** The one project every page shows (#1513), picked at the top of the rail; null when all show. */
  scope?: string | null
  /** The address names a project that is not read yet: the select names none, and nothing says all show. */
  scopePending?: boolean
  /** Whether the list of agents shown is read: until it is, an empty list is not "No sessions yet." */
  listLoaded?: boolean
  /** Pick the one project every page shows, or null for all of them. */
  onScope?: (projectId: string | null) => void
  /** The Overview's address, which keeps the picked project: where the brand links to. */
  homeHref?: string
  /** The picked project's agents; unused when all projects show, where `recentAgents` is the list. */
  agents: AgentMeta[]
  selectedAgentId: string | null
  /** The address names no project, session or page: nothing in the list is the page shown. */
  notFound?: boolean
  onSelect: (agentId: string | null) => void
  /** The brand mark animates while any agent is working (moved off the navbar with the brand). */
  working?: boolean
  /** Go to the Overview (no project): the brand mark and the Overview item both call it. Defaults
   *  to a no-op so a focused unit test can mount the rail without wiring the shell's chrome. */
  onDashboard?: () => void
  /** Open Settings, from the person's menu at the sidebar's foot. */
  onSettings?: (entry?: string) => void
  /**
   * The pages the installed modules add (#1774), the picked project's only when one is picked, one nav row each, below Overview;
   * null while they are not known, when what stands under them waits so that nothing moves.
   */
  pages?: readonly { segment: string; label: string; icon?: ComponentType<{ className?: string; 'aria-hidden'?: boolean }> }[] | null
  /** The module page that is the current view, by its segment, or null. */
  activePage?: string | null
  /** Open a module's page by its segment. */
  onPage?: (segment: string) => void
  /** What waits on the person (the Human Queue, #632), the picked project's or every project's: the "Waiting on you" part, named as the launcher names it. */
  waiting?: readonly Waiting[]
  /** The address a row or a nav item goes to, as the shell writes it: each is a link, which also opens in a new tab. */
  hrefOf?: (route: Route) => string
  /** Cross-project recents, for when all projects show: every project's sessions pooled. */
  recentAgents?: RecentAgent[]
  /** Select a pooled recent: jump into its project's session (project + run both change). */
  onSelectRecent?: (projectId: string, agentId: string) => void
  /** Every registered project, so "New" knows whether to add one, start in the only one, or pick. */
  projects?: ProjectSummary[]
  /** Start a new session in a project (its launcher). */
  onNewAgentInProject?: (projectId: string) => void
  startTick?: number
  startIntent?: string
  /** The id the start reported for its run: the row the stand-in waits for. */
  startId?: string | null
  /** The project that run was started in, by its label: the stand-in row names it as the run's own row will. */
  startProjectName?: string | undefined
}) {
  // On a phone the rail is a sheet over the page, opened from the bar of pages (PagesBar): going
  // somewhere from it closes it.
  const { isMobile, open, openMobile, setOpenMobile } = useSidebar()
  // The one scroll under the project select, as it stands: which label is held at its top, and
  // whether what waits is scrolled out. The rows of its two lists travel between them (`useGlide`).
  const list = useRef<HTMLDivElement>(null)
  useGlide(list)
  const railScroll = useRailScroll(list, `${open}:${isMobile}:${openMobile}:${waiting.length > 0}:${pages === null}`)
  // What stands under the modules' rows waits while their pages are not known, and comes in at its
  // place once they are; drawn with the first frame wherever they were known from the start.
  const modulePages = { state: pages === null ? 'unknown' : 'fresh', value: pages ?? [] } as const
  const leave =
    <A extends unknown[]>(go: (...args: A) => void) =>
    (...args: A) => {
      setOpenMobile(false)
      go(...args)
    }
  const preferences = usePreferences()
  const label = useProjectLabel()
  // The optimistic row, and the id of the run it stands in for.
  const [optimistic, setOptimistic] = useState<{ intent: string; id: string | null } | null>(null)

  useEffect(() => {
    if (startTick > 0) setOptimistic({ intent: startIntent, id: startId })
  }, [startTick]) // eslint-disable-line react-hooks/exhaustive-deps

  // All projects show: the rail pools every project's sessions. One project: just its own.
  const crossProject = scope === null && recentAgents !== undefined
  // Whose `agents` are: the picked project's, on a session's page opened from its list too; else the page's project.
  const listOf = scope ?? projectId ?? null
  const listed = crossProject ? recentAgents!.map(recent => recent.agent) : agents

  // The handover: the row this one stands in for has landed once the list holds the run the start
  // reported — whatever its status.
  //
  // Waiting for a run that was not in the list when the start came back was wrong: a start
  // takes seconds, so the list often held the new run already. It counted as an old run, the
  // stand-in never handed over, and it showed again beside the run's own row once that stopped
  // running, until the deadline below swept it.
  //
  // Watching `running` alone was too narrow. The agents list polls every 2s, so a session that starts
  // and finishes inside one interval is never once observed running, and the stand-in had nothing to
  // hand over to: it sat beside the finished session's own row, claiming a second session was
  // starting, until the deadline below swept it. That was hard to hit while a broken agent hung as
  // `running` forever; it stopped being hard once such agents began failing in milliseconds.
  //
  // And it was too wide: any run at work counted as the one started. With another agent working,
  // which is the usual day, a start had no row at all until its own landed seconds later, and the
  // page it opened had nothing marked in the list.
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
    if (optimistic === null) return
    const timer = setTimeout(() => setOptimistic(null), 20_000)
    return () => clearTimeout(timer)
  }, [optimistic])

  // `landed` is checked here as well as in its effect so the stand-in and the real row are never
  // painted together for a frame while the effect is still queued.
  const showOptimistic = optimistic !== null && !landed

  // A session selected but not in the list is one just started, whose row lands with its card
  // a beat later (#784): the optimistic row is standing in for it, so highlight that.
  const starting = selectedAgentId !== null && !listed.some(agent => agent.id === selectedAgentId)

  // In the order the person picked from the button beside "Log" (`recents-sort.ts`).
  const order = preferences.recentsSort ?? 'created'
  const groupBy = preferences.recentsGroup ?? 'none'
  // A session with no project that has a copy of a project is listed under it (`projects-under.ts`): named by those projects,
  // and, cut by project, a row in each one's group. It opens on its own page all the same.
  const underOf = (agent: AgentMeta) => (agent.under ?? []).map(project => ({ id: project.id, label: label(project.id, project.name) }))
  const rows: Row[] = sortRuns(crossProject
    ? recentAgents!.flatMap(rr => {
        const row = {
          key: `${rr.projectId}:${rr.agent.id}`,
          agent: rr.agent,
          projectId: rr.projectId,
          active: rr.projectId === projectId && rr.agent.id === selectedAgentId,
          href: hrefOf({ projectId: rr.projectId, agentId: rr.agent.id }),
          onClick: () => onSelectRecent?.(rr.projectId, rr.agent.id),
          ...near(rr.projectId, rr.agent),
        }
        // A session with no project names none, or the projects it is listed under.
        if (rr.projectId !== SESSIONS_ID) return [{ ...row, project: label(rr.projectId, rr.projectName) }]
        const under = underOf(rr.agent)
        if (under.length === 0) return [row]
        if (groupBy === 'project') return under.map(project => ({ ...row, key: `${row.key}:${project.id}`, project: project.label }))
        return [{ ...row, project: under.map(project => project.label).join(', ') }]
      })
    : agents.map(agent => {
        // The list is the picked project's on a page of no project too: the Overview, a module's page. A session listed
        // under it is the sessions' own.
        const own = agent.under ? SESSIONS_ID : listOf
        return {
          key: agent.id,
          agent,
          projectId: own,
          active: agent.id === selectedAgentId,
          href: hrefOf({ projectId: own, agentId: agent.id }),
          onClick: () => (agent.under && onSelectRecent ? onSelectRecent(SESSIONS_ID, agent.id) : onSelect(agent.id)),
          ...near(own, agent),
        }
      }), order)

  // New is the active view when a project is open on its launcher (its "New" / Start-a-session
  // screen: a project selected, no run picked, not following a live one). On the Overview that role
  // belongs to the Overview item instead, so the two are never active at once. A Not found page is none of them.
  const atProjectLauncher = !notFound && projectId !== null && selectedAgentId === null

  // A run listed in "Waiting on you" is not listed again in the Log.
  const waitingListed = new Set(waiting.slice(0, WAITING_SHOWN).flatMap(item => (item.run !== undefined ? [`${item.projectId}:${item.run}`] : [])))
  // What waits on each run, by its project and its id: a row marks the work it left on this machine.
  const waitingByRun = new Map(waiting.flatMap(item => (item.run !== undefined ? [[`${item.projectId}:${item.run}`, item] as const] : [])))
  const logged = rows.filter(row => !waitingListed.has(`${row.projectId}:${row.agent.id}`))
  // What a row shows beside its name and its age, and what the list is cut by: the person's picks
  // from the button beside "Log", all off until asked for. One project's list has no projects to cut it by.
  const show: Showing = { person: preferences.recentsPerson === true, agent: preferences.recentsAgent === true }
  const groups = groupRuns(logged, groupBy === 'project' && !crossProject ? 'none' : groupBy, order)

  const hasRecents = rows.length > 0 || showOptimistic

  // Each row's person, in its own project.
  const accountIn = usePeople(rows.map(row => ({ projectId: row.projectId, person: row.agent.person })), onPeople, 'sidebar:people')
  // A session with no project has no git host to ask who its person is: they are who a project's
  // host said they are, on another row of the list, so one person has one picture down the list.
  // Between two projects nothing is carried over: a project's host may know another person by the address.
  const knownElsewhere = new Map<string, ModuleHostPerson>()
  for (const row of rows) {
    const account = row.agent.person ? accountIn(row.projectId, row.agent.person) : undefined
    if (account && !knownElsewhere.has(row.agent.person!.toLowerCase())) knownElsewhere.set(row.agent.person!.toLowerCase(), account)
  }
  const accountOf = (projectId: string | null, person: string): ModuleHostPerson | undefined => accountIn(projectId, person) ?? (projectId === SESSIONS_ID ? knownElsewhere.get(person.toLowerCase()) : undefined)
  // Your own runs are marked as the sidebar's foot marks you: the letters of your own name, not of
  // your email, and with no git host to ask (a session with no project), your own picture.
  const { person: me } = usePerson()
  const yours = (person: string | undefined): boolean => person !== undefined && me?.email !== undefined && person.toLowerCase() === me.email
  const ownMark = (person: string | undefined): { name?: string; picture?: string } => (yours(person) && me ? { name: me.name, ...(me.avatar !== undefined ? { picture: me.avatar } : {}) } : {})

  const codingAgents = useAgents()
  const namesRuns = useNamesRuns()
  const pageHref = (segment: string) => hrefOf({ projectId: null, agentId: null, page: segment, ...(scope ? { scope } : {}) })
  const renderRow = (row: Row) => (
    <AgentHistoryRow
      status={row.agent.status}
      show={show}
      glide={`${row.projectId}:${row.agent.id}`}
      saving={row.agent.saving === true}
      intent={agentLabel(row.agent)}
      // A name is seconds away: the row holds the place rather than printing the whole prompt and
      // swapping it for the name a moment later.
      naming={awaitingName(row.agent, namesRuns)}
      driver={row.agent.driver}
      {...(row.agent.person ? { person: row.agent.person, account: accountOf(row.projectId, row.agent.person), ...ownMark(row.agent.person) } : {})}
      {...(row.agent.model ? { model: modelName(agentOf(codingAgents, row.agent.driver), row.agent.model) } : {})}
      {...(row.agent.effort ? { effort: row.agent.effort } : {})}
      {...(row.agent.base ? { base: row.agent.base } : {})}
      // On the Overview the project is what tells the rows apart, so the row still names it; a
      // project's own rail already knows its project.
      {...(row.project ? { project: row.project } : {})}
      subtitle={formatRelative(row.agent.startedAt)}
      age={formatSince(row.agent.startedAt)}
      active={row.active}
      {...(hostOf(row.agent.target) !== undefined ? { host: { id: hostOf(row.agent.target)!, projectId: row.projectId } } : {})}
      {...(row.agent.otherHost && row.agent.host ? { startedOn: row.agent.host } : {})}
      prs={runPrs(row.agent)}
      {...workOf(waitingByRun.get(`${row.projectId}:${row.agent.id}`))}
      href={row.href}
      onClick={leave(row.onClick)}
      onNear={row.onNear}
    />
  )

  // Hidden on a wide screen (SidebarToggle): the page takes its room.
  if (!isMobile && !open) return null

  // Beside a page that scrolls as a page, the sidebar is fixed to the window, and a strip as wide
  // holds its place: one that scrolled with the page (even one that stuck at the top) moved with
  // the page as it bounced at either end.
  const pinned = pageScrolls && !isMobile

  return (
    // A fixed-width, in-flow column (`collapsible="none"`): with the top navbar gone (#772
    // follow-up), the sidebar carries the app's chrome — brand, global nav, and the utility
    // controls in the footer — so the workspace and the panes get the full height. A phone has no
    // width for a column: there it is a sheet over the page, closed until asked for.
    // Fixed to the window (or a phone's sheet), it stays put while the page scrolls: what opens from
    // it is placed against the window too, or each scroll carries it off and pulls it back a frame later.
    <PopupPlacementContext.Provider value={pinned || isMobile ? 'fixed' : 'absolute'}>
      {pinned && <div aria-hidden className="w-(--sidebar-width) shrink-0" />}
      <Sidebar className={cn('relative w-(--sidebar-width)', pinned && 'fixed top-(--top-banner,0px) left-0 z-20 h-[calc(100dvh-var(--top-banner,0px))]')}>
        {/* The brand and the project select (#1513): the project picked here is the one every page
            under it shows. No rule under it: the room around it sets it apart. */}
        <SidebarHeader className="gap-4 pb-2">
          {/* The mark + wordmark, the way home (#909), now that there is no navbar to hold them. */}
          <div className="flex items-center justify-between gap-2 pt-1 pr-0.5 pl-2">
            <BrandLink working={working} href={homeHref} onNavigate={leave(onDashboard)} />
            {/* The jump's press, for a screen with no keyboard, beside the sidebar's own. */}
            <span className="flex items-center gap-1">
              <JumpButton />
              <HideSidebarButton />
            </span>
          </div>
          {/* The "Landing page | Dashboard" switch (`ViewToggle`) stood here: hidden for now, its code kept. */}
          <SidebarProjectPicker picked={scope ?? null} pending={scopePending} projects={projects} onPick={onScope} />
        </SidebarHeader>
        {/* Everything under the project select is one scroll (his pick, 2026-11-24): the pages, what
            waits and the Log. The pages used to stand still over the lists, which left the Log only
            what was left under them. The themed ScrollArea (#913) instead of the sidebar's native
            overflow bar, matching the Overview: SidebarContent's own `overflow-auto` is suppressed. */}
        <SidebarContent className="overflow-hidden">
          <ScrollArea className="min-h-0 flex-1">
            <div ref={list}>
              {/* New/Overview/the modules' pages stack as one nav group, row against row, close under
                  the project select (the select's own section has its room below it), with a little
                  space below the group before the lists. */}
              <div className="flex flex-col gap-0.5 px-2 pb-2">
                {/* "New" starts a session — but where depends on what exists: with no project it prompts to
                    add one first, with one project it starts there, with several it opens a picker. With
                    one project picked at the top, it starts there. */}
                <NewButton
                  scope={scope}
                  href={hrefOf({ projectId: scope ?? SESSIONS_ID, agentId: null })}
                  active={atProjectLauncher}
                  onNewAgentInProject={onNewAgentInProject && leave(onNewAgentInProject)}
                  onSelect={leave(onSelect)}
                />
                {/* The Overview entry (Rom): the way home, over the lists and more prominent than a
                    menu row. Carries the Human Queue count (#632) so the one cross-project signal stays visible, and
                    highlights while it is the current view: only this carries the active fill. */}
                <NavRow icon={LayoutDashboard} label="Overview" active={projectId === null && activePage === null} href={homeHref} onClick={leave(onDashboard)}>
                  {waiting.length > 0 && (
                    <Tooltip>
                      <TooltipTrigger render={<span className={WAITING_COUNT} />}>{waiting.length}</TooltipTrigger>
                      <TooltipContent>
                        {waiting.length} item{waiting.length === 1 ? '' : 's'} in your Human Queue
                      </TooltipContent>
                    </Tooltip>
                  )}
                </NavRow>
                {/* The modules' pages the shell hands over (#1774), the picked project's only when one is
                    picked: destinations with no project selected, like the Overview, named by the module,
                    never by the dashboard — the tickets' page among them, when a package brings one. */}
                <Slot of={modulePages} shape={<NavShapes />} className="flex flex-col gap-0.5">
                  {known => (
                    <>
                      {known.map(page => (
                        <NavRow key={page.segment} icon={page.icon ?? Blocks} label={page.label} active={activePage === page.segment} href={pageHref(page.segment)} onClick={leave(() => onPage(page.segment))} />
                      ))}
                      {/* Then the accounts OpenAgent's work goes as, on a page of the dashboard's own. */}
                      <NavRow icon={KeyRound} label="Permissions" active={activePage === PERMISSIONS_PAGE} href={pageHref(PERMISSIONS_PAGE)} onClick={leave(() => onPage(PERMISSIONS_PAGE))} />
                    </>
                  )}
                </Slot>
              </div>
              {/* What stands under the modules' rows waits while they are not known, so nothing moves. */}
              <Slot of={modulePages} shape={null}>
                {() => (
                  <>
                    {waiting.length > 0 && (
                      <WaitingOnYou
                        waiting={waiting}
                        stuck={railScroll.stuck.has('waiting')}
                        severalProjects={crossProject}
                        hrefOf={item => (item.run !== undefined ? hrefOf({ projectId: item.projectId, agentId: item.run }) : item.fix !== undefined && 'href' in item.fix ? item.fix.href : undefined)}
                        isOpen={item => item.run !== undefined && item.run === selectedAgentId && item.projectId === (crossProject ? projectId : listOf)}
                        onOpen={item => (item.run !== undefined ? leave(onSelectRecent ?? (() => {}))(item.projectId, item.run) : undefined)}
                        moreHref={homeHref}
                        onMore={leave(onDashboard)}
                      />
                    )}
                    {/* The rows keep the nav's edges, the scrollbar laid over their right padding while it shows. The `!`:
                        a module's stylesheet has the group's own `p-2`, which would otherwise win on its page. */}
                    <SidebarGroup data-rail-part="log" className="pt-3!">
                      {/* Shown even when the list is empty (#1147): the heading is what makes "No sessions
                          yet." read as the state of this list rather than a lonely line in the sidebar. */}
                      <RailLabel part="log" stuck={railScroll.stuck.has('log')}>
                        Log
                        {/* What waits has scrolled out above, and the Overview's count with it: the label
                            says how many wait, and a press brings them back into view. */}
                        {railScroll.waitingGone && waiting.length > 0 && (
                          <button type="button" onClick={() => list.current?.querySelector('[data-rail-part="waiting"]')?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })} className={cn(WAITING_COUNT, 'focus-ring ml-2 px-1.5')}>
                            {waiting.length} waiting
                          </button>
                        )}
                        <LogViewMenu order={order} show={show} group={groupBy} byProject={crossProject} />
                      </RailLabel>
                      {/* A row brought into view (the keyboard's focus, the page's own row) stops under the label
                          and its fade, 32 + 16, so the label never covers the row it is about. */}
                      <SidebarGroupContent className="[&_:is(a,button)]:scroll-mt-12">
                        <SidebarMenu className="gap-0.5">
                          {/* A just-started run, before its run.json exists — highlighted while following it. */}
                          {showOptimistic && (
                            <SidebarMenuItem>
                              {/* Drawn as the run's own row will be a few seconds on (the same marks, not
                                  dimmed), so that row taking its place changes nothing on screen. With naming
                                  on that row will carry a name, so this one holds the place rather than
                                  printing the prompt and having it swapped a second later. */}
                              <AgentHistoryRow
                                status="running"
                                {...(!namesRuns ? { intent: optimistic?.intent ?? undefined } : { intent: undefined, naming: true })}
                                {...(crossProject && startProjectName ? { project: startProjectName } : {})}
                                subtitle="just now"
                                age="now"
                                show={show}
                                active={starting}
                                standIn
                                onClick={leave(() => onSelect(null))}
                              />
                            </SidebarMenuItem>
                          )}
                          {groups.map(group => (
                            <Fragment key={group.label ?? ''}>
                              {group.label !== undefined && (
                                <SidebarMenuItem role="presentation" className="flex h-6 items-center gap-2 px-2 text-xs text-faint-foreground not-first:mt-1.5 after:h-px after:flex-1 after:bg-border">
                                  <span className="min-w-0 truncate">{group.label}</span>
                                </SidebarMenuItem>
                              )}
                              {group.rows.map(row => (
                                <SidebarMenuItem key={row.key}>{renderRow(row)}</SidebarMenuItem>
                              ))}
                            </Fragment>
                          ))}
                        </SidebarMenu>
                        {/* Nothing while the list is read: it takes a moment, and "No sessions yet." would not be true yet. */}
                        {!hasRecents && listLoaded && <p className="whitespace-nowrap px-2 py-1 text-sm text-muted-foreground">No sessions yet.</p>}
                      </SidebarGroupContent>
                    </SidebarGroup>
                  </>
                )}
              </Slot>
            </div>
          </ScrollArea>
        </SidebarContent>
        {/* The person at this dashboard, as one row that opens their menu: the theme and Settings
            (PersonMenu). */}
        {/* At the bottom, under the scroll. */}
        <SidebarFooter className="mt-auto">
          <PersonMenu onSettings={leave(onSettings)} />
        </SidebarFooter>
        {/* Its right edge, dragged to set its width; a phone's sheet has none. */}
        {!isMobile && <SidebarResizer />}
      </Sidebar>
    </PopupPlacementContext.Provider>
  )
}

// One rail destination — Overview, a module's page — in the row every destination of the sidebar has.
/** Two of the rows below while they are read, in their own shape and height: a {@link Slot}'s `shape`. */
function NavShapes() {
  return Array.from({ length: 2 }, (_, at) => (
    <div key={at} className="flex items-center gap-3 px-2 md:h-8 max-md:h-11">
      <Skeleton className="size-4 shrink-0 rounded-sm" />
      <Skeleton className={cn('h-3.5', at === 0 ? 'w-20' : 'w-24')} />
    </div>
  ))
}

function NavRow({
  icon: Icon,
  label,
  active,
  href,
  onClick,
  children,
}: {
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  label: string
  active: boolean
  href: string
  onClick: () => void
  /** What sits after the label, e.g. the Overview row's Human Queue badge. */
  children?: ReactNode
}) {
  return (
    <a href={href} onClick={inPlace(onClick)} aria-current={active ? 'page' : undefined} className={navRowClass(active)}>
      <Icon aria-hidden />
      <span className="flex-1 truncate text-left">{label}</span>
      {children}
    </a>
  )
}

// The "New" launcher: one click to the "New agent session" page, of the project picked at the top of
// the rail, or with all of them showing, of no project. Where the session works is picked on that
// page, in the row above the box (the projects module's picker), not here.
function NewButton({
  scope,
  href,
  active = false,
  onNewAgentInProject,
  onSelect,
}: {
  scope: string | null
  /** The "New agent session" page it opens. */
  href: string
  /** On a project's launcher (its "New" screen), so New reads as the current view. Off on the
   *  Overview, where the Overview item is the active one instead — the two are never both active. */
  active?: boolean
  onNewAgentInProject?: ((projectId: string) => void) | undefined
  onSelect: (agentId: string | null) => void
}) {
  // The row every destination has, so its icon and label line up; the picked fill only on this
  // project's launcher, since New is an action, not a place.
  const target = scope ?? SESSIONS_ID
  return (
    <a href={href} aria-current={active ? 'page' : undefined} className={navRowClass(active)} onClick={inPlace(() => (onNewAgentInProject ? onNewAgentInProject(target) : onSelect(null)))}>
      <Plus aria-hidden />
      <span className="truncate">New agent session</span>
    </a>
  )
}

/** How many of what waits on the person the sidebar lists before a row offers the rest, as the Human Queue does. */
const WAITING_SHOWN = 5

/** How many wait, in the waiting colour on its own soft fill: the Overview row's count, and the Log label's once what waits is scrolled out. */
const WAITING_COUNT = 'flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-warning/15 px-1 text-xs leading-none font-semibold text-warning tabular-nums'

/** A row of the sidebar's lists, the navigation's row (ui/nav-row): 32 high (44 on a phone), corners 8, the picked one filled, the one under the pointer half filled. Placed, so one that travels is drawn over the rows it passes (`useGlide`). */
const railRowClass = (active: boolean, lines: 1 | 2 = 1): string =>
  cn(
    'focus-ring rail-row relative flex w-full items-center gap-3 rounded-lg px-2 text-left text-sm text-foreground transition-colors',
    // Two lines: 32 (44 on a phone) at the least, grown by its lines.
    lines === 1 ? 'md:h-8 max-md:h-11' : 'py-1.5 md:min-h-8 max-md:min-h-11',
    active ? 'bg-foreground/8' : 'hover:bg-foreground/4 active:bg-foreground/8',
  )

/** The marks a row has just before its age, 4 from it and so closer to it than to the name they would otherwise cut into. */
const BEFORE_AGE = '-mr-2 flex shrink-0 items-center gap-1'

/**
 * A part's label, which sticks at the top of the sidebar's scroll while its rows pass: "Waiting on
 * you" first, then "Log" takes its place. While it is held, a strip under it fades the rows going
 * up beneath; at rest there is none, so it never dims the first row.
 */
function RailLabel({ part, stuck, children }: { /** Which part it names: it moves with its rows as one travels between the parts. */ part: string; stuck: boolean; children: ReactNode }) {
  return (
    <div data-glide={`label:${part}`} data-glide-part={part} className="sticky top-0 z-10">
      <SidebarGroupLabel className="rounded-none bg-sidebar px-2">{children}</SidebarGroupLabel>
      {/* Absolute (hanging just below the label) so it does not push the first row down. */}
      <div aria-hidden data-stuck={stuck || undefined} className={cn('pointer-events-none absolute inset-x-0 top-full h-4 bg-gradient-to-b from-sidebar to-transparent transition-opacity', stuck ? 'opacity-100' : 'opacity-0')} />
    </div>
  )
}

/**
 * What waits on the person, over the Log: each a row of the Log's (the waiting hexagon, the run's
 * name cut at the row's end, how long it has waited) with a second line, what it needs in the
 * Human Queue's two words, in the waiting colour (his pick, 2026-11-24, over the need as a mark
 * before the age). Pointed at, the row says the name whole and what the need is about. Past five,
 * a row that opens the Overview, where the Human Queue lists them all. A run listed here is not
 * listed again in the Log; once answered it is back in the Log, in its order, and its row is seen
 * going there and back.
 */
function WaitingOnYou({
  waiting,
  stuck,
  severalProjects,
  hrefOf,
  isOpen,
  onOpen,
  moreHref,
  onMore,
}: {
  waiting: readonly Waiting[]
  /** Its label is held at the top of the scroll. */
  stuck: boolean
  /** The rows are of several projects: a row's hover names its own. */
  severalProjects: boolean
  /** Where a row goes: its run's page, or the page that fixes it, a pull request no run here opened. */
  hrefOf: (item: Waiting) => string | undefined
  /** Whether a row's run is the page shown: its row is the picked one, as the Log's would be. */
  isOpen: (item: Waiting) => boolean
  /** Open a row's run in place. */
  onOpen: (item: Waiting) => void
  moreHref: string
  onMore: () => void
}) {
  const shown = waiting.slice(0, WAITING_SHOWN)
  const rest = waiting.length - shown.length
  return (
    <SidebarGroup data-rail-part="waiting" className="pt-3! pb-0!">
      <RailLabel part="waiting" stuck={stuck}>
        Waiting on you
      </RailLabel>
      <SidebarGroupContent className="[&_:is(a,button)]:scroll-mt-12">
        <SidebarMenu className="gap-0.5">
          {shown.map(item => {
            const href = hrefOf(item)
            // Drawn and said by the rule a run's row is, the Logs' too: what waits on the person, in its item's words.
            const { state, word: need } = runState({ status: 'waiting' }, item)
            const external = item.run === undefined
            const name = item.title ?? item.projectName
            return (
              <SidebarMenuItem key={waitingKey(item)}>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <a
                        href={href}
                        aria-label={`${name} · ${need}`}
                        aria-current={isOpen(item) ? 'page' : undefined}
                        data-glide={item.run !== undefined ? `${item.projectId}:${item.run}` : waitingKey(item)}
                        data-glide-part="waiting"
                        {...(external ? { target: '_blank', rel: 'noreferrer' } : { onClick: inPlace(() => onOpen(item)) })}
                        className={railRowClass(isOpen(item), 2)}
                      />
                    }
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      {/* The mark and the age on the name's line, never between the two (spacing.md 3). */}
                      <span className="flex min-w-0 items-start gap-3">
                        <span data-glide-new className="flex h-5 w-4 shrink-0 items-center justify-center">
                          <RunMark status={state} />
                        </span>
                        <span className="min-w-0 flex-1 truncate">{name}</span>
                        <span aria-hidden className={cn(AGE, 'leading-5')}>
                          {formatSince(item.since)}
                        </span>
                      </span>
                      {/* Under the name, 16 for the mark and 12 after it: the words start where the name does. */}
                      <span aria-hidden data-glide-new className="truncate pl-7 text-xs text-warning">
                        {need}
                      </span>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="right" align="start" className="max-w-80">
                    <span className="block whitespace-pre-wrap break-words">{name}</span>
                    <span className="block text-xs text-muted-foreground">{[need, item.detail, ...(severalProjects && item.title !== undefined ? [item.projectName] : [])].filter(Boolean).join(' · ')}</span>
                  </TooltipContent>
                </Tooltip>
              </SidebarMenuItem>
            )
          })}
          {rest > 0 && (
            <SidebarMenuItem>
              <a href={moreHref} onClick={inPlace(onMore)} className={cn(railRowClass(false), 'text-muted-foreground')}>
                <span aria-hidden className="size-4 shrink-0" />
                {rest} more
              </a>
            </SidebarMenuItem>
          )}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

/**
 * The button beside "Log", the list's one menu (his pick, after Claude Code's own beside its
 * "Recents"): its order, what its rows show beside a name and its age, and what it is cut by, each
 * kept in the person's preferences. By creation unless picked otherwise, so a run does not move
 * while a person talks to it; a row is its name and its age until more is asked for.
 */
function LogViewMenu({ order, show, group, byProject }: { order: RecentsSort; show: Showing; group: RecentsGroup; /** The list is of several projects: it can be cut by them. */ byProject: boolean }) {
  // A list ordered by name has no days to cut it by, and one project's list no projects.
  const offered = (Object.keys(RECENTS_GROUP_LABELS) as RecentsGroup[]).filter(pick => pick !== 'project' || byProject)
  const marked = (on: boolean) => <Check className={cn('ml-auto size-4 shrink-0', on ? 'opacity-100' : 'opacity-0')} aria-hidden />
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              type="button"
              aria-label="Sort and view"
              // A ghost press of 24 (a finger's 48 on a phone), its glyph on the rows' right edge.
              className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), 'relative -mr-1 ml-auto size-6 text-muted-foreground max-md:after:absolute max-md:after:-inset-3')}
            />
          }
        >
          <SlidersHorizontal className="size-4 shrink-0" aria-hidden />
        </TooltipTrigger>
        <TooltipContent>Sort and view</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="font-normal">Sort by</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={order} onValueChange={(pick: RecentsSort) => updatePreferences({ recentsSort: pick })}>
            {(Object.keys(RECENTS_SORT_LABELS) as RecentsSort[]).map(pick => (
              <DropdownMenuRadioItem key={pick} value={pick} closeOnClick={false}>
                {RECENTS_SORT_LABELS[pick]}
                {marked(pick === order)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel className="font-normal">Show</DropdownMenuLabel>
          <DropdownMenuCheckboxItem checked={show.person} onCheckedChange={(on: boolean) => updatePreferences({ recentsPerson: on })}>
            Who started it
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem checked={show.agent} onCheckedChange={(on: boolean) => updatePreferences({ recentsAgent: on })}>
            Coding agent
          </DropdownMenuCheckboxItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel className="font-normal">Group by</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={group} onValueChange={(pick: RecentsGroup) => updatePreferences({ recentsGroup: pick })}>
            {offered.map(pick => (
              <DropdownMenuRadioItem key={pick} value={pick} closeOnClick={false} disabled={pick === 'day' && order === 'name'}>
                {RECENTS_GROUP_LABELS[pick]}
                {marked(pick === group)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** A person's mark on a row, beside its smaller marks. */
const PERSON_MARK = 'size-5 text-xs font-medium'

/** A row's time, in a box as wide as its longest word ("59m", "23h", "now") and set to its right, so it stands on one x down a list. */
const AGE = 'w-7 shrink-0 text-right text-xs text-muted-foreground tabular-nums'

/** What a row shows beside its name and its age, by the person's picks: whose run it is, and which coding agent ran it. */
type Showing = { person: boolean; agent: boolean }

/** One of a run's pull requests, and how it stands when the git host said. */
type RunPr = { number: number; state?: PrState | undefined }

/** A run's pull requests, the earlier ones first and each once: the ones it opened before, then the one it has now. */
function runPrs(agent: AgentMeta): RunPr[] {
  const now = agent.pr ? [{ number: agent.pr.number, ...(agent.prState ? { state: agent.prState } : {}) }] : []
  return [...(agent.earlierPrs ?? []).filter(earlier => !now.some(pr => pr.number === earlier.number)).map(({ number, state }) => ({ number, ...(state ? { state } : {}) })), ...now]
}

/**
 * A run's pull requests as marks: one glyph per state they stand in, in the git host's colours, and
 * how many stand in it at the glyph's top right corner once there are several (his pick,
 * 2026-11-24), so two merged requests are one mark and not two. A request whose state is not known
 * has no mark (`PR_MARKS`).
 */
function PrMarks({ prs }: { prs: readonly RunPr[] }) {
  const states = [...new Set(prs.flatMap(pr => (pr.state ? [pr.state] : [])))]
  return states.map(state => {
    const { Icon, tone } = PR_MARKS[state]
    const count = prs.filter(pr => pr.state === state).length
    return (
      <span key={state} data-pr={state} className={cn('relative flex shrink-0 items-center', tone, count > 1 && 'mr-0.5')}>
        <Icon className="size-3.5" aria-hidden />
        {/* The smallest type step, drawn at three quarters: a count at a 14 glyph's corner. */}
        {count > 1 && <span className="absolute -top-2 -right-2.5 scale-75 rounded-full bg-sidebar px-0.5 text-xs leading-none font-bold tabular-nums">{count}</span>}
      </span>
    )
  })
}

/** A state's word as a line of its own starts: "Open", "Needs answer". */
const capitalised = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1)

/** The work a run left on this machine, as a row marks it: the mark of the item that says it, and its words. */
export interface RunWork {
  mark: 'changes' | 'branch'
  said: string
}

/** A row's work mark, from what waits on its run: files never committed, or a branch never published. Nothing for any other item. */
function workOf(item: Waiting | undefined): { work?: RunWork } {
  if (item?.mark !== 'changes' && item?.mark !== 'branch') return {}
  return { work: { mark: item.mark, said: [item.words, item.detail].filter(Boolean).join(' · ') } }
}

// One agent row, one line: the state's mark, the session's name and how long ago it started, as
// Claude Code on the web lists its sessions. The name comes first (his pick, 2026-11-24): the row
// used to carry the project, the person and the coding agent's logo too, wherever the rows of a
// list differed in them, and at the rail's usual width that left the name three letters. What a
// row has beyond its name is now its pull requests and the work it left on the machine, just
// before its age, and whose run it is and which agent ran it once the person asks for them; all
// of it, and the project, is said when the row is pointed at.
function AgentHistoryRow({
  status,
  show,
  glide,
  intent,
  naming = false,
  project,
  subtitle,
  age,
  active,
  href,
  onClick,
  onNear,
  driver,
  model,
  effort,
  base,
  standIn = false,
  saving = false,
  host,
  startedOn,
  prs = [],
  work,
  person,
  account,
  name,
  picture,
}: {
  status: AgentStatus
  /** Which of the marks that tell runs apart the person asked for; the row's hover and its name say them all. */
  show: Showing
  /** What the row is known by as it travels between the Log and "Waiting on you"; none for a stand-in. */
  glide?: string | undefined
  intent: string | undefined
  /** The run's name is on its way: the row shows where it will go, not the prompt it would replace. */
  naming?: boolean
  /** When the sessions come from several projects, which one this is: the row's hover says it. */
  project?: string | undefined
  subtitle: string
  /** How long ago it started, in a word ("2m"), at the row's end: the order the list is in by default. */
  age: string
  /** The agent that ran it, so the row can show whose session it was. */
  driver?: string | undefined
  /** The model it ran on, by the name its coding agent gives it: said with the agent. */
  model?: string | undefined
  /** How hard that model was told to think, by the coding agent's own word; none when it thought as it does by default. */
  effort?: string | undefined
  /** The branch it was told to start from; none for a run started from the default branch. */
  base?: string | undefined
  active: boolean
  /** The run's page; the stand-in for a run not listed yet has none, and is a button. */
  href?: string | undefined
  onClick: () => void
  /** The pointer or the keyboard reached the row, before any click. */
  onNear?: (() => void) | undefined
  /** The row stands in for a run just started, until that run's own row lands. */
  standIn?: boolean
  /** Ended clean, its process still saving its record and cleaning up its checkout (#1455): the row must
   *  not say "done" while the session's own pill says "saving…". */
  saving?: boolean
  /** Runs on a host beside this computer's (`run.host`, #1263, #2394), by its id, a host of its project's: the row gets the host's glyph. */
  host?: { id: string; projectId: string | null } | undefined
  /** The computer whose daemon started the run, when that is another computer (#1648): a glyph names it. */
  startedOn?: string | undefined
  /** The run's pull requests, each with how it stands when the git host said: glyphs before the age. */
  prs?: readonly RunPr[]
  /** The work it left on this machine, as what waits on the person says it: files never committed, or a branch never published. */
  work?: RunWork | undefined
  /** Whose run it is, by the email its record is kept under. */
  person?: string | undefined
  /** Their account at the project's git host, when it said: their picture. */
  account?: ModuleHostPerson | undefined
  /** Their name, for their mark's letters: the person's own, for their own runs. */
  name?: string | undefined
  /** Their picture when the git host has none to give: the person's own, for their own runs. */
  picture?: string | undefined
}) {
  const ran = agentOf(useAgents(), driver)
  // The host it runs on, by the name its project's module gives it.
  const hostLabel = useRunHosts(host ? host.projectId : null).find(one => one.id === host?.id)?.label
  const onHost = host ? `Runs on ${hostLabel ?? 'another host'}` : undefined
  const titleText = naming ? '' : intent || 'New agent session'
  // A name that comes to a row that waited for it comes in as a new session's does.
  const waitedForName = useRef(false)
  if (naming) waitedForName.current = true
  // The mark: the state's hexagon, by the rule every row of a run reads (`runState`, the Logs' too),
  // and the word that names it. A run that ended on its question waits on you (#785). Its pull
  // request merged is said by the request's own mark, beside it.
  const { state: marked, word } = runState({ status, saving })
  const prWords = prs.map(pr => `#${pr.number}${pr.state ? ` ${PR_MARKS[pr.state].word}` : ''}`)
  const prSaid = prs.length > 0 ? `${prs.length === 1 ? 'PR' : 'PRs'} ${prWords.join(', ')}` : undefined
  // Work that never left the machine, in the Human Queue's words and icon, gray (his pick).
  const left = work ? { Icon: work.mark === 'changes' ? FilePen : GitBranch, said: work.said } : undefined
  const personWords = person ? personSaid(person, account) : undefined
  const agentSaid = ran ? [ran.label, ...(model ? [model] : [])].join(' · ') : undefined
  // Everything about the run in one sentence, the row's name for a reader that cannot see its
  // marks or point at it: the word, where the run is and when it started, whose it is, which
  // coding agent ran it, and the computer or host it ran on.
  const said = [
    word,
    ...(project ? [project] : []),
    subtitle,
    ...(personWords ? [personWords] : []),
    ...(ran ? [ran.label] : []),
    ...(startedOn ? [`started on ${startedOn}`] : []),
    ...(host ? [`runs on ${hostLabel ?? 'another host'}`] : []),
    ...(prSaid ? [prSaid] : []),
    ...(left ? [left.said] : []),
  ].join(' · ')
  // The same, pointed at (his pick of three): the work on top, its name whole, how it stands and
  // since when, then what is known of where it is as a chip each; under a rule, who started it at
  // the left, their picture, name and address, and what ran it at the right, the model by its
  // maker's logo with how hard it thought. The logo says the coding agent: its name is not written.
  const chips: { fact: string; said: string; node: ReactNode }[] = [
    ...(project ? [{ fact: 'Project', said: [project, base].filter(Boolean).join(' · '), node: <Folder className="size-3 shrink-0" aria-hidden /> }] : []),
    ...prs.map(pr => {
      const mark = pr.state ? PR_MARKS[pr.state] : undefined
      return { fact: 'PR', said: `#${pr.number}${mark ? ` · ${capitalised(mark.word)}` : ''}`, node: mark ? <mark.Icon className={cn('size-3 shrink-0', mark.tone)} aria-hidden /> : null }
    }),
    ...(left ? [{ fact: 'Work', said: left.said, node: <left.Icon className="size-3 shrink-0" aria-hidden /> }] : []),
    ...(startedOn ? [{ fact: 'Started on', said: startedOn, node: <Laptop className="size-3 shrink-0" aria-hidden /> }] : []),
    ...(host ? [{ fact: 'Runs on', said: hostLabel ?? 'another host', node: <HOST_ICON className="size-3 shrink-0" aria-hidden /> }] : []),
  ]
  // A run whose model its record does not say is its coding agent's logo alone.
  const ranOn = ran ? [...(model ? [model] : []), ...(model && effort ? [effortLabel(effort)] : [])] : undefined
  const marks = (
    <>
      {/* The mark stands where a status word would, and carries that word for a reader who
          cannot see a colour. */}
      <span data-glide-new className="flex size-4 shrink-0 items-center justify-center">
        <RunMark status={marked} label={word} />
      </span>
      <span className="rail-title min-w-0 flex-1 truncate text-sm font-normal">
        {/* Nothing yet, and something coming: a bar where the name goes, rather than a blank row or
            the prompt it is about to replace. */}
        {naming ? <span aria-hidden className="block h-3.5 w-2/3 animate-pulse rounded-sm bg-muted-foreground/20" /> : <RevealedTitle text={titleText} start={standIn || waitedForName.current} />}
      </span>
      {/* What is unusual about where the run is, kept on the row as one small glyph: another
          computer, a host. Rare, so the row stays a mark and a name nearly always. */}
      {startedOn && (
        <RowMark said={`Started on ${startedOn}`}>
          <Laptop className="size-3.5 text-muted-foreground" />
        </RowMark>
      )}
      {onHost && (
        <RowMark said={onHost}>
          <HOST_ICON className="size-3.5 text-muted-foreground" />
        </RowMark>
      )}
      {/* Its pull requests and the work it left on the machine, just before its age. */}
      {(prs.some(pr => pr.state) || left) && (
        <span className={BEFORE_AGE}>
          {prSaid && prs.some(pr => pr.state) && (
            <RowMark said={prSaid}>
              <PrMarks prs={prs} />
            </RowMark>
          )}
          {left && (
            <RowMark said={left.said}>
              <left.Icon className="size-3.5 text-muted-foreground" />
            </RowMark>
          )}
        </span>
      )}
      {/* When it started, in a word: the list's own order, read down the rows' end. */}
      <span aria-hidden className={AGE}>
        {age}
      </span>
      {/* Whose run it is and which coding agent ran it, once the person asks for them (the menu
          beside "Log"). With both, the agent's logo rides on the person's picture, one mark for
          the two, so the name keeps its room. The row of a run just started holds the picture's
          place with an empty circle, so its title has the same room when the run's own row lands. */}
      {show.person && (personWords || standIn) && (
        <span className="relative flex shrink-0">
          {personWords ? (
            <RowMark said={personWords}>
              <PersonMark email={person} name={name} picture={account?.avatar ?? picture} className={PERSON_MARK} />
            </RowMark>
          ) : (
            <PersonMark className={PERSON_MARK} />
          )}
          {show.agent && ran && agentSaid && (
            <span className="absolute -right-1.5 -bottom-1 flex size-3 items-center justify-center rounded-full bg-sidebar">
              <RowMark said={agentSaid}>
                <PackageLogo svg={ran.logo} className="size-2.5 text-muted-foreground" />
              </RowMark>
            </span>
          )}
        </span>
      )}
      {show.agent && !(show.person && (personWords || standIn)) && ran && agentSaid && (
        <RowMark said={agentSaid}>
          <PackageLogo svg={ran.logo} className="size-3.5 text-muted-foreground" />
        </RowMark>
      )}
    </>
  )
  const row = {
    'aria-label': `${naming ? 'Naming this session' : titleText} · ${said}`,
    'aria-current': active ? ('page' as const) : undefined,
    className: railRowClass(active),
    ...(standIn ? { 'data-stand-in': '' } : {}),
    ...(glide !== undefined ? { 'data-glide': glide, 'data-glide-part': 'log' } : {}),
    onPointerEnter: onNear,
    onFocus: onNear,
  }
  return (
    <Tooltip>
      <TooltipTrigger render={href !== undefined ? <a href={href} {...row} onClick={inPlace(onClick)} /> : <button type="button" {...row} onClick={onClick} />}>{marks}</TooltipTrigger>
      {/* Pointed at, the row says all of it beside itself. One width for every row, so the card
          never changes size as the pointer goes down the list, and a long name or address wraps
          or is cut inside it. */}
      <TooltipContent side="right" align="start" className="w-75 max-w-[calc(100vw-2rem)] p-0">
        <span className="block space-y-2 px-3 py-3">
          <span data-card="name" className="block text-sm font-medium whitespace-pre-wrap break-words">
            {titleText}
          </span>
          <span data-card="state" className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <RunMark status={marked} />
            {capitalised(word)} · {subtitle}
          </span>
          {chips.length > 0 && (
            <span role="list" className="flex flex-wrap gap-1.5 pt-0.5">
              {chips.map(chip => (
                <span key={`${chip.fact} ${chip.said}`} role="listitem" aria-label={`${chip.fact}: ${chip.said}`} className="inline-flex max-w-full items-center gap-1 rounded-full border border-border px-2 py-px text-xs text-muted-foreground">
                  {chip.node}
                  <span className="truncate">{chip.said}</span>
                </span>
              ))}
            </span>
          )}
        </span>
        {(person || ranOn) && (
          <span data-card="foot" className="flex items-center gap-3 border-t border-border px-3 py-2">
            {person && (
              <>
                <PersonMark email={person} name={name} picture={account?.avatar ?? picture} className="size-7" />
                <span className="flex min-w-0 flex-1 flex-col leading-tight">
                  {/* By their first name, as the sidebar's foot calls them: the foot shares its line with the model. */}
                  <span className="truncate text-sm">{personName(person, name).split(/\s+/)[0]}</span>
                  <span className="truncate text-xs text-muted-foreground">{person}</span>
                </span>
              </>
            )}
            {ran && ranOn && (
              <span role="img" aria-label={[ran.label, ...ranOn].join(' · ')} className={cn('flex shrink-0 items-center gap-1.5 text-xs whitespace-nowrap', !person && 'flex-1')}>
                <PackageLogo svg={ran.logo} className="size-3.5 shrink-0" />
                {ranOn[0] && <span>{ranOn[0]}</span>}
                {ranOn[1] && <span className="text-muted-foreground">· {ranOn[1]}</span>}
              </span>
            )}
          </span>
        )}
      </TooltipContent>
    </Tooltip>
  )
}

/** One small mark on a row, named for a reader that cannot see it; the row's hover says it in words. */
function RowMark({ said, children }: { said: string; children: ReactNode }) {
  return (
    <span role="img" aria-label={said} className="flex shrink-0 items-center">
      {children}
    </span>
  )
}
