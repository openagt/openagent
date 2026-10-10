import { useEffect, useMemo, useState } from 'react'
import type { Intervention, Activity, ProjectionRead, ProjectSummary, RecentAgent } from '../src/index.js'
import { onProjectFiles, onInterventions, onActivity, onRecentAgents, onAgents } from './rpc/reads.js'
import { sendStart } from './rpc/control.js'
import { onProjects } from './rpc/projects.js'
import { AgentHistory } from './components/AgentHistory.js'
import { SidebarProvider } from './components/ui/sidebar.js'
import { ProjectHome } from './components/ProjectHome.js'
import { DashboardPage } from './components/DashboardPage.js'
import { SettingsPage } from './components/SettingsPage.js'
import { AgentView } from './components/AgentView.js'
import { agentLabel } from './lib/agent-label.js'
import { subagentsOf, taskLabel } from './lib/subagents.js'
import { RightRail } from './components/RightRail.js'
import { NotFound } from './components/NotFound.js'
import { ModulePageView } from './components/ModulePageView.js'
import { useModules, ModulesContext } from './lib/use-modules.js'
import { HostServicesContext, type HostServices } from './lib/host-services.js'
import { startPicks } from './lib/use-start-agent.js'
import { stashPendingDraft } from './lib/draft-handoff.js'
import { useLiveEvents } from './lib/use-live-events.js'
import { useAgents } from './lib/use-agents.js'
import { usePolled } from './lib/use-async.js'
import { useRoute } from './lib/use-route.js'
import { formatRoute, type Route } from './lib/route.js'
import { dataLinkRoute } from './lib/data-link.js'
import { useActivityNotifications, useInterventionNotifications } from './lib/use-notifications.js'
import { usePreferences, notificationsEnabled, newActivityEnabled, humanInterventionEnabled } from './lib/preferences.js'
import { agentViews, currentAgentEvents } from './lib/live-state.js'
import { useDocumentTitle } from './lib/document-title.js'
import { useWorking } from './lib/use-working.js'
import { useFavicon } from './lib/favicon.js'
import { useDaemonHealth } from './lib/use-daemon-health.js'
import { useContextSet } from './lib/use-context-set.js'
import { TriangleAlert } from 'lucide-react'

/** Stable, so `files` keeps one identity while no project is selected. */
const EMPTY_FILES: string[] = []

/** Stable initial for the projects load, so it does not churn on every render. */
const EMPTY_PROJECTS: ProjectSummary[] = []

/** Stable initial for the interventions poll, so it does not churn on every render. */
const EMPTY_INTERVENTIONS: ProjectionRead<Intervention> = { items: [], whole: [] }

/** Stable initial for the activity poll (#627), so it does not churn on every render. */
const EMPTY_ACTIVITY: ProjectionRead<Activity> = { items: [], whole: [] }

/** Stable initial for the cross-project recents poll, so it does not churn on every render. */
const EMPTY_RECENT: RecentAgent[] = []

// The dashboard shell (#405 phase 2): Sessions | main | Docs/History rail, with the project
// selection in the top nav as a dropdown since #772 (it used to be a rail of its own). The main pane
// is one of three views chosen by the selection: the project home/launcher (Live, the default —
// Start form + cards) or one session's own view (AgentView), live or finished — the same frame
// either way (#1026). Everything over the wire is `POST /_rpc/<name>`. A projection of the files
// each run's own tool writes: its card and its diary.
//
// The selection IS the URL (#784): `/` the Overview, `/{projectId}` the project home,
// `/{projectId}/{sessionId}` one session. It used to be three pieces of React state — the
// selected agent, the just-started agent, and a "follow the live feed" flag — reconciled at render,
// and each of #761/#766/#768/#774 was a case where they disagreed about which run was in play.
// A route cannot disagree with itself, and a session becomes a link: paste it, reload it,
// bookmark it, open two side by side. A refresh returns to the same project for free, which is
// what the remembered-project state (#475) was for.
//
// The project select at the top of the sidebar (#1513) is in the URL too, as `?project=`: the one
// project every page shows, or none for all of them. It filters what the pages show; it is not a
// page of its own, so it rides along on every navigation.
export function App() {
  const { route, go: navigate } = useRoute()
  const { view, projectId, agentId } = route
  // A module's page (#1774): the route names it by its segment, with no project selected.
  const pageSegment = route.page ?? null

  // The registered projects, for the browser-tab title (#695/U3) — the selected project's name
  // plus the needs-you count drive `document.title` so a backgrounded tab tells you which project
  // needs attention — and for the sidebar's project select. Polled rather than read once (#1500):
  // each project carries what the daemon currently finds wrong with it, a state that appears and
  // clears on the daemon's own minute cadence, so the sidebar dot and the project's banner have to
  // follow it. Slow, and reloadable so adding a project from the sidebar's "New" reflects at once
  // (bump the key).
  const [projectsKey, setProjectsKey] = useState(0)
  const { value: projects, loaded: projectsLoaded } = usePolled<ProjectSummary[]>(onProjects, EMPTY_PROJECTS, 30_000, [projectsKey])
  // Read again when a project is added from the sidebar or removed from its project home: which
  // project has which module changes then.
  const modules = useModules(projectsKey)
  const { pages: modulePages, loaded: modulesLoaded } = modules
  // The one project every page shows (#1513), or null for all of them. A project that is not
  // registered (removed, or a link from another machine) picks nothing.
  const scope = route.scope && (projects.length === 0 || projects.some(p => p.id === route.scope)) ? route.scope : null
  const scopedProjects = useMemo(() => (scope ? projects.filter(p => p.id === scope) : projects), [projects, scope])
  // The modules' pages the dashboard has: every one, or with a project picked only the pages of the
  // packages that project has. The sidebar lists these, and a URL names a page only among these.
  const shownPages = useMemo(() => (scope ? modulePages.filter(page => page.projects.includes(scope)) : modulePages), [modulePages, scope])
  const modulePage = pageSegment ? shownPages.find(page => page.segment === pageSegment) : undefined

  // Every navigation keeps the picked project, and one into another project's page picks that
  // project: the pages never show a project the select does not name.
  const go = (next: Route, options?: { replace?: boolean }) => navigate({ ...next, ...(scope ? { scope: next.projectId ?? scope } : {}) }, options)

  // Pick the one project every page shows, or all of them. The page stays, with what it mirrored
  // into the query (a list's filters), unless it is another project's: its launcher becomes the
  // picked project's, and its agent's page the Overview. A module's page drops what follows its
  // segment, which may name the project just left, and one the picked project does not have
  // becomes the Overview.
  const selectScope = (next: string | null) => {
    const { scope: _scope, ...here } = route
    if (next === null) return navigate(here, { keepQuery: true })
    if (here.projectId !== null && here.projectId !== next)
      return navigate(here.agentId === null ? { projectId: next, agentId: null, scope: next } : { projectId: null, agentId: null, scope: next })
    const mounted = modulePages.find(page => page.segment === here.page)
    if (mounted && !mounted.projects.includes(next)) return navigate({ projectId: null, agentId: null, scope: next })
    const { pagePath, ...page } = here
    navigate({ ...page, scope: next }, { keepQuery: !pagePath?.length })
  }

  // A just-started run: bump the tick so the Sessions rail shows an optimistic "starting…" row
  // with the typed prompt at once, before the run's tool writes its card. `id` is the one the
  // project's start hook answered (#761) — the URL already points there, and this is what tells
  // the main pane that a session missing from the list is starting, not gone.
  // `runsOn` names the machine a just-started remote agent executes on (#1067), so the live view can
  // mark where it runs and degrade the panels that are local-only. Undefined for a local agent.
  const [agentStart, setAgentStart] = useState<{ tick: number; intent: string; id: string | null; projectId: string | null; runsOn?: string }>({ tick: 0, intent: '', id: null, projectId: null })
  // The agents of the project on screen, for its pages, or of the picked project, for the sidebar:
  // the same project whenever both are set.
  const { agents: agents, reload, loaded: agentsLoaded } = useAgents(projectId ?? scope, agentStart.id !== null && agentStart.projectId === (projectId ?? scope) ? agentStart.id : null)

  // The Context set lives in the shell (#492/#504) so the two surfaces that feed it share one
  // source of truth: the launcher's `@`/`#` chips and Context picker, and the right rail's file tree.
  const { context, add: addContext, remove: removeContext, toggle: toggleContext, reset: resetContext } = useContextSet()

  // The picked Context is one project's, so changing projects starts fresh. Keyed off the route
  // rather than the click, because Back/Forward change projects too.
  useEffect(() => {
    resetContext()
    // `resetContext` is a fresh closure each render; the project is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  // The selected project's files (git ls-files), handed to both the `#` picker and the tree.
  // Empty when no project (no checkout). Scoped to the selected session's
  // worktree (#815), the same checkout the action bar's branch, Serve and open-folder act on;
  // polled so a file the agent creates shows up rather than waiting for a reload.
  const { value: files } = usePolled<string[]>(
    projectId ? () => onProjectFiles(projectId, agentId ?? undefined) : null,
    EMPTY_FILES,
    10_000,
    [projectId, agentId],
  )

  // The cross-project "needs you" queue (#632): open PRs to review. Polled here in the shell so
  // the sidebar badge and the Overview card share one poll. Slow cadence — PRs change rarely and
  // each poll runs a git host read per project.
  // The read as a whole goes to the notifier, which tells of every project's items whichever one
  // is picked, and also needs to know which projects the poll actually reached before it calls
  // anything "new" (#1625).
  const { value: interventionsRead } = usePolled<ProjectionRead<Intervention>>(onInterventions, EMPTY_INTERVENTIONS, 15000, [])

  const project = projectId ? projects.find(p => p.id === projectId) : undefined
  const projectName = project?.name ?? null
  // The Human Queue as the pages show it: the picked project's items, or every project's.
  const interventions = scope ? interventionsRead.items.filter(item => item.projectId === scope) : interventionsRead.items
  useDocumentTitle(interventions.length, projectName ?? projects.find(p => p.id === scope)?.name ?? null)
  // A URL naming a project that is not registered (renamed, removed, mistyped). A non-empty list
  // is the answer, so this never fires while the first read is still out.
  const unknownProject = projectId !== null && projects.length > 0 && !projects.some(p => p.id === projectId)

  // Fire a browser notification when a new item lands on the "needs you" queue (#627). Rides the
  // one interventions poll above (the poll stays unconditional — it also feeds the sidebar badge
  // and Overview card); only the notification is gated, on both the category (`notifyHumanIntervention`,
  // default on) and the browser method (`notifyBrowser`).
  const preferences = usePreferences()
  useInterventionNotifications(interventionsRead, humanInterventionEnabled(preferences) && notificationsEnabled(preferences))

  // The "New activity" category (#627): the default-off feed of agents starting/finishing. Its only
  // client consumer is the browser notification below, so it is polled exactly when that will fire —
  // both the category (`notifyNewActivity`) and the browser method (`notifyBrowser`) on.
  const browserActivity = newActivityEnabled(preferences) && notificationsEnabled(preferences)
  const { value: activity } = usePolled<ProjectionRead<Activity>>(browserActivity ? onActivity : null, EMPTY_ACTIVITY, 15000, [browserActivity])
  useActivityNotifications(activity, browserActivity)

  // The shared sidebar's recents when all projects show (#shared-shell): the rail pools every
  // project's sessions here. Polled only then — a picked project's own agents (above) carry its rail.
  const { value: recentAgents, reload: reloadRecent } = usePolled<RecentAgent[]>(scope === null ? onRecentAgents : null, EMPTY_RECENT, 10_000, [scope])

  // An agent just started in `inProject`, which is not always the selected one: the onboarding
  // checklist starts one from the Overview and the settings page, where nothing is selected (#1169).
  const agentStarted = (inProject: string | null, intent: string, startedId: string, runsOn?: string) => {
    // Continuing the agent already on screen (#762) appends to its journal — nothing truncates, so
    // nothing would re-replay after a reset. Bumping the tick here is what blanked the transcript
    // the moment a message resumed an ended session; a continuation keeps the feed instead.
    const continued = startedId === agentId && inProject === projectId
    setAgentStart(prev => ({ tick: continued ? prev.tick : prev.tick + 1, intent, id: startedId, projectId: inProject, ...(runsOn ? { runsOn } : {}) }))
    // The picked Context went with that run; the next launch starts from a clean focus (#948).
    resetContext()
    // Go to the run we just started — a real history entry, so Back returns to where you launched
    // from. Its row does not exist yet; the main pane shows it live on the strength of the id.
    go({ projectId: inProject, agentId: startedId })
    // The new agent just appends to the rail; reload so its real row shows up quickly.
    reload()
    reloadRecent()
  }

  /** The same, for the surfaces that start an agent inside the selected project. */
  const onAgentStarted = (intent: string, startedId: string, runsOn?: string) => agentStarted(projectId, intent, startedId, runsOn)

  // Selecting a session (or the Live/Home row) is always an explicit choice, so it ends the
  // just-started follow.
  const selectAgent = (id: string | null) => {
    go({ projectId, agentId: id })
  }

  const selectProject = (id: string) => {
    go({ projectId: id, agentId: null }) // switching projects always returns to the home launcher
  }

  // Naming a session in another project. The Overview's cross-project rows — the sidebar recents,
  // the Agents view (#1139), and the modules' cards — know which run they are about, and going through
  // selectProject drops that on the way, landing on the launcher instead of the session the row was
  // describing.
  const selectAgentInProject = (id: string, agentId: string) => {
    go({ projectId: id, agentId: agentId })
  }

  // "New" in the sidebar: start a fresh session in a named project (the sidebar decides which —
  // the current one, the only one, or a picked one). resetContext explicitly, since staying in the
  // same project would not trip the project-change effect above.
  const newAgentInProject = (id: string) => {
    go({ projectId: id, agentId: null })
    resetContext()
  }

  // The Overview dashboard (#471): no project selected.
  const showDashboard = () => {
    go({ projectId: null, agentId: null })
  }

  // The settings page (#958): every setting in one place, plus the Onboarding checklist, which is
  // where dismissing it from the Overview says you can pick it back up.
  const showSettings = () => {
    go({ view: 'settings', projectId: null, agentId: null })
  }

  // A module's page (#1774): its own segment, with no project selected, like the Overview.
  const showPage = (segment: string) => {
    go({ projectId: null, agentId: null, page: segment })
  }

  // A link into a project's files (#1774) — `tickets/<file>` — opens the mounted module page named
  // by its first segment, at `/<segment>/<projectId>/<rest>`; the dashboard has no page of its own
  // for any such path and names no module. Nothing opens when no page claims it.
  const openDataLink = (id: string, href: string) => {
    const target = dataLinkRoute(id, href, modulePages)
    if (target) go(target)
  }

  // The shell's services for modules (#1774): what a module page or a link action may ask of the
  // dashboard, none of it naming a skill. Bound to each module's package where its host is built.
  const hostServices: HostServices = {
      openAgent: selectAgentInProject,
      openPage: (segment, path) => go({ projectId: null, agentId: null, page: segment, ...(path && path.length ? { pagePath: path } : {}) }),
      startRun: async (inProject, prompt, opts) => {
        const result = await sendStart(inProject, prompt, startPicks(preferences))
        if (!result.ok) return result
        // A module starting several runs in a row asks not to land (#1818): the rail still learns of the run.
        if (opts?.land ?? true) agentStarted(inProject, prompt, result.agentId)
        else reload()
        return result
      },
      // The launcher rehydrates a stashed draft once as it mounts (#1066): the same carry every
      // "Configure first, then run" uses.
      configureRun: (inProject, prompt) => {
        stashPendingDraft(prompt)
        selectProject(inProject)
      },
      agents: async inProject =>
        (await onAgents(inProject)).map(agent => ({ id: agent.id, status: agent.status, startedAt: agent.startedAt, ...(agent.branch ? { name: agent.branch } : {}), ...(agent.intent ? { ask: agent.intent } : {}) })),
  }

  // The live agent feed is owned here so both the main view and the right rail's views tab read
  // one shared event stream.
  // The agent whose feed and controls are in play is simply the one in the URL; in the no-id
  // fallback there is none yet, and a null id resolves to the project root, as before.
  const { events, lost, writing } = useLiveEvents(projectId, agentId, agentStart.tick)
  // The run's feed says it ended before the runs poll does: read the runs now, so its page stops
  // reading as running (and its handoff is read) without waiting up to a poll for it.
  const ends = events.filter(e => e.kind === 'end').length
  useEffect(() => {
    if (ends > 0) reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ends])
  // The rail's views stay scoped to the newest `session` segment even though an agent's feed no
  // longer is (a resumed session appends a second segment to the same journal). Choice gates
  // are no longer folded here: they live inline in the transcript (#1455 items 6/7), where
  // EventList derives open/answered state from the same events it renders.
  const current = currentAgentEvents(events)
  const views = projectId ? agentViews(current) : []
  // The selected session's loop verdict, for the rail's pinned block under the tabs. It comes up
  // from AgentView rather than being folded here: a finished agent's events live in its archived log,
  // which that view is the one to read.

  // Is an agent working (#875)? Drives the mark and the tab icon.
  const working = useWorking()
  useFavicon(working)

  // Whether the daemon answers at all (#948). Without this, a dead daemon froze every surface
  // silently: the channels retry their transport without a verdict and the polls keep their
  // last value, so "the agent went quiet" and "nothing on this page is live" looked identical.
  const healthy = useDaemonHealth()

  // Route the main pane: the Overview dashboard when no project is selected (#471); else the
  // project home/launcher, a running agent's live output, or a finished agent's replay. Each live
  // run streams its own feed and is steered by its own id (#749).
  // Until the project's own list is read, the row clicked in the all-projects list says who the
  // agent is: without it a jump to another project's agent showed a page with no name, and its
  // message box offered what an ended agent's does whatever the agent's state, for a moment.
  const selectedAgent = agentId
    ? (agents.find(agent => agent.id === agentId) ??
      (agentsLoaded ? undefined : recentAgents.find(recent => recent.projectId === projectId && recent.agent.id === agentId)?.agent))
    : undefined
  // The runs started for the selected one: rows in its chat.
  const subagents = useMemo(() => (agentId ? subagentsOf(agents, agentId) : []), [agents, agentId])
  const renderMain = () => {
    if (view === 'settings')
      return <SettingsPage onAgentStarted={agentStarted} onSelectProject={selectProject} onDone={showDashboard} />
    if (pageSegment) {
      if (modulePage)
        return <ModulePageView page={modulePage} projects={scopedProjects} path={route.pagePath ?? []} />
      // Not loaded yet is not "no such page": the modules are imported after the first read, and
      // whether a picked project is a registered one is known once the projects are read.
      if (!modulesLoaded || (scope !== null && !projectsLoaded)) return null
      // A page another project's package adds is not the picked project's.
      const elsewhere = scope !== null && modulePages.some(page => page.segment === pageSegment)
      return (
        <NotFound
          title="No such page"
          detail={
            elsewhere
              ? `The project "${projects.find(p => p.id === scope)?.name ?? scope}" has no package that adds a page at "/${pageSegment}".`
              : `No installed package adds a page at "/${pageSegment}".`
          }
          actionLabel="Go to the Overview"
          onAction={showDashboard}
        />
      )
    }
    if (!projectId)
      return (
        <DashboardPage
          onSelectProject={selectProject}
          onSelectAgent={selectAgentInProject}
          onAgentStarted={agentStarted}
          interventions={interventions}
          projects={projects}
          scope={scope}
        />
      )
    if (unknownProject)
      return (
        <NotFound
          title="No such project"
          detail={`No project is registered as "${projectId}". It may have been removed, or the link may be from another machine.`}
          actionLabel="Go to the Overview"
          onAction={showDashboard}
        />
      )
    if (agentId === null) {
      return (
        <ProjectHome
          projectId={projectId}
          projectName={projectName}
          scope={scope}
          events={events}
          onAgentStarted={onAgentStarted}
          files={files}
          context={context}
          addContext={addContext}
          removeContext={removeContext}
          toggleContext={toggleContext}
          onOpenAgent={selectAgentInProject}
          errors={project?.errors}
          // The project is off the list: read the list again and leave its page for the Overview.
          onProjectRemoved={() => {
            setProjectsKey(k => k + 1)
            showDashboard()
          }}
          // A skill written or deleted gives or takes a page: read the projects and their modules again now.
          onSkillsChanged={() => setProjectsKey(k => k + 1)}
        />
      )
    }
    if (!selectedAgent) {
      // Not in the list: either the run we just started (its card lands a beat later) or a
      // list we have not read yet, where whether the agent runs is not known. Only a session that
      // is genuinely absent from a list we did read is gone.
      if (agentId === agentStart.id || !agentsLoaded)
        return <AgentView projectId={projectId} agentId={agentId} events={events} live={agentId === agentStart.id ? true : null} label={agentStart.intent || undefined} projectName={projectName} remoteLabel={agentId === agentStart.id ? agentStart.runsOn : undefined} files={files} lost={lost} writing={writing} startedWith={agentId === agentStart.id ? agentStart.intent : undefined} onAgentStarted={onAgentStarted} />
      return (
        <NotFound
          title="This agent is gone"
          detail="There is no record of this agent. Once its checkout is removed, a finished agent is kept only when the project has a logs skill installed."
          actionLabel="Back to the project"
          onAction={() => selectAgent(null)}
        />
      )
    }
    // Live and finished are the same view (#1026): only `live` changes, so an agent ending swaps
    // what the bar, feed and composer say without remounting any of them.
    return (
      <AgentView
        projectId={projectId}
        agentId={agentId}
        events={events}
        live={selectedAgent.status === 'running'}
        card={selectedAgent}
        // A subagent's page is named as its rows are: by its task, not by its whole prompt.
        label={selectedAgent.parent !== undefined ? taskLabel(selectedAgent) : agentLabel(selectedAgent)}
        projectName={projectName}
        files={files}
        lost={lost}
        writing={writing}
        startedWith={agentId === agentStart.id ? agentStart.intent : undefined}
        target={selectedAgent.target}
        remoteLabel={selectedAgent.remoteLabel}
        subagents={subagents}
        onOpenAgent={selectAgent}
        onAgentStarted={onAgentStarted}
        onDeleted={() => {
          // Its view is about to point at a session that no longer exists; go home and refresh
          // the rail so the row is gone (#1032).
          selectAgent(null)
          reload()
        }}
      />
    )
  }

  return (
    // The whole shell lives inside the SidebarProvider so the sidebar's context (state + Cmd/Ctrl+B,
    // the `--sidebar-width` var) is available on every route, home and session alike. Its wrapper is
    // the column that used to be a plain div. The installed modules (#1774) are provided around it
    // all, so the link actions they offer reach any page that shows a link.
    <ModulesContext.Provider value={modules}>
    <HostServicesContext.Provider value={hostServices}>
    <SidebarProvider className="h-screen flex-col overflow-hidden">
      {/* The top navbar is gone (#772 follow-up): its brand, global nav and utility controls moved
          into the sidebar (AgentHistory), so the workspace and right rail get the full height. */}
      {!healthy && (
        <div role="alert" className="flex items-center gap-2 border-b border-border bg-warning/10 px-4 py-2 text-xs text-warning">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
          The daemon is not answering — retrying. Everything on this page is frozen until it returns.
        </div>
      )}
      {/* The workspace row is fixed-height: each column scrolls internally, so the row itself
          must never scroll. overflow-hidden clips any stray horizontal bleed (no page X-scroll).
          `relative` is load-bearing (#904): overflow only clips a descendant this box is the
          containing block for, and Tailwind's `.sr-only` is position:absolute. Without it those
          labels resolve against the initial containing block, keep their static position deep in
          the scrolled content, and give the document a phantom scrollbar that slides the whole
          app off-screen. */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <AgentHistory
          projectId={projectId}
          scope={scope}
          onScope={selectScope}
          homeHref={formatRoute({ projectId: null, agentId: null, ...(scope ? { scope } : {}) })}
          agents={agents}
          selectedAgentId={agentId}
          // A row of the picked project's list opens in that project, whichever page is showing.
          onSelect={id => go({ projectId: scope ?? projectId, agentId: id })}
          recentAgents={recentAgents}
          onSelectRecent={selectAgentInProject}
          projects={projects}
          onNewAgentInProject={newAgentInProject}
          onProjectAdded={() => {
            setProjectsKey(k => k + 1)
            reload()
          }}
          startTick={agentStart.tick}
          startIntent={agentStart.intent}
          startId={agentStart.id}
          startProjectName={projects.find(p => p.id === agentStart.projectId)?.name}
          working={working}
          onDashboard={showDashboard}
          onSettings={showSettings}
          pages={shownPages}
          activePage={pageSegment}
          onPage={showPage}
          interventionCount={interventions.length}
        />
        <main className="flex min-w-0 flex-1 flex-col">{renderMain()}</main>
        {/* A module's page takes the full width itself (#1774): no rail beside it, the way Settings
            takes the whole main pane with none either. */}
        {!pageSegment && (
          <RightRail
            projectId={projectId}
            agentId={agentId}
            views={views}
            files={files}
            context={context}
            toggleContext={toggleContext}
            activity={events.length}
          />
        )}
      </div>
    </SidebarProvider>
    </HostServicesContext.Provider>
    </ModulesContext.Provider>
  )
}
