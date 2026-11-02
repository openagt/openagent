import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { Intervention, Activity, ProjectionRead, ProjectSummary, RecentAgent } from '../src/index.js'
import { onProjectFiles, onInterventions, onActivity, onRecentAgents } from './rpc/reads.js'
import { sendStart } from './rpc/control.js'
import { onProjects } from './rpc/projects.js'
import { onComputersThrough, onMachineAgentAccounts, onMachinePerson, onMachineVersions, sendLetMachineIn, sendMachineCode, sendMachineRemoveAgentAccount, sendRemoveMachineDevice } from './rpc/machines.js'
import { onGitHostPeople } from './rpc/people.js'
import { sendUseLoginsOn } from './rpc/server-logins.js'
import { addComputerThrough, addMachine, removeMachine, renameComputer, renameMachine } from './lib/machines.js'
import { AgentHistory } from './components/AgentHistory.js'
import { SidebarProvider } from './components/ui/sidebar.js'
import { setSidebarHidden, useSidebarHidden, useSidebarWidth } from './lib/sidebar-width.js'
import { ProjectHome } from './components/ProjectHome.js'
import { DashboardPage } from './components/DashboardPage.js'
import { SettingsDialog } from './components/SettingsDialog.js'
import { readProjectAccountsAhead } from './components/ProjectAccounts.js'
import { AgentView } from './components/AgentView.js'
import { agentLabel, awaitingName } from './lib/agent-label.js'
import { subagentsOf, taskLabel } from './lib/subagents.js'
import { PaneLayout, PanesProvider } from './components/Panes.js'
import { SubagentPanel } from './components/SubagentPanel.js'
import { MenuButton, PhoneBar } from './components/PhoneBar.js'
import { cn } from './lib/utils.js'
import { usePolled } from './lib/use-async.js'
import { useIsMobile } from './lib/use-mobile.js'
import { NotFound } from './components/NotFound.js'
import { ModulePageView, ModuleSlot } from './components/ModulePageView.js'
import { useModules, ModulesContext } from './lib/use-modules.js'
import { HostServicesContext, useSteadyServices } from './lib/host-services.js'
import { sendToScreen, watchScreen } from './lib/screen.js'
import { startPicks } from './lib/use-start-agent.js'
import { ownComputerName } from './lib/this-machine.js'
import { stashPendingDraft } from './lib/draft-handoff.js'
import { useLiveEvents } from './lib/use-live-events.js'
import { STARTING_AT_MOST_MS, useAgents } from './lib/use-agents.js'
import { readModuleAgents } from './lib/module-agents.js'
import { runsAgain, useRunsPace } from './lib/runs-changed.js'
import { useRoute } from './lib/use-route.js'
import { formatRoute, type Route } from './lib/route.js'
import { projectAddresses } from '../src/project-address.js'
import { dataLinkRoute } from './lib/data-link.js'
import { useActivityNotifications, useInterventionNotifications } from './lib/use-notifications.js'
import { usePreferences, notificationsEnabled, newActivityEnabled, humanInterventionEnabled, OpenProjectContext } from './lib/preferences.js'
import { useDocumentTitle } from './lib/document-title.js'
import { projectLabels, ProjectLabelsContext } from './lib/project-labels.js'
import { useActiveAgents } from './lib/use-working.js'
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

// The dashboard shell (#405 phase 2): Sessions | main | the panes, with the project
// selection in the top nav as a dropdown since #772 (it used to be a rail of its own). The main pane
// is one of three views chosen by the selection: the project home/launcher (Live, the default —
// Start form + cards) or one session's own view (AgentView), live or finished — the same frame
// either way (#1026). Everything over the wire is `POST /_rpc/<name>`. A projection of the files
// each run's own tool writes: its card and its diary.
//
// The selection IS the URL (#784): `/` the Overview, `/{project}` the project home,
// `/{project}/{agentId}` one session. It used to be three pieces of React state — the
// selected agent, the just-started agent, and a "follow the live feed" flag — reconciled at render,
// and each of #761/#766/#768/#774 was a case where they disagreed about which run was in play.
// A route cannot disagree with itself, and a session becomes a link: paste it, reload it,
// bookmark it, open two side by side. A refresh returns to the same project for free, which is
// what the remembered-project state (#475) was for.
//
// The project select at the top of the sidebar (#1513) is in the URL too: the one project every page
// shows, or none for all of them. It filters what the pages show; it is not a page of its own, so it
// rides along on every navigation as the address's first segment (`/{project}/overview`,
// `/{project}/logs`). A project's own pages pick their project unless `?all` is there.
/** How long what a phone shows is read at every frame once it changed: as its keyboard slides and settles. */
const SETTLE_MS = 700

/** Whether a box someone types in has the focus: what brings up a phone's keyboard. */
function typing(): boolean {
  const focused = document.activeElement
  return focused instanceof HTMLElement && (focused.isContentEditable || focused instanceof HTMLTextAreaElement || (focused instanceof HTMLInputElement && !['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file'].includes(focused.type)))
}

export function App() {
  // The registered projects, for the browser-tab title (#695/U3) — the selected project's name
  // plus the needs-you count drive `document.title` so a backgrounded tab tells you which project
  // needs attention — and for the sidebar's project select. Polled rather than read once (#1500):
  // each project carries what the daemon currently finds wrong with it, a state that appears and
  // clears on the daemon's own minute cadence, so the sidebar dot and the project's banner have to
  // follow it. Slow, and reloadable so adding a project from the sidebar's "New" reflects at once
  // (bump the key).
  const [projectsKey, setProjectsKey] = useState(0)
  // Kept for the next visit too: the Overview's cards are drawn for the projects before they are read again.
  const { value: projects, loaded: projectsLoaded } = usePolled<ProjectSummary[]>(onProjects, EMPTY_PROJECTS, 30_000, [projectsKey], { remember: 'projects', stored: true })
  // Read again when a project is added from the sidebar or removed from its project home: which
  // project has which module changes then.
  const modules = useModules(projectsKey)
  const { pages: modulePages, loaded: modulesLoaded } = modules
  // A project's address is its name unless another project or a page has it: what the address
  // names is known once both are read, and until then nothing is said to be missing.
  const projectIds = projects.map(p => p.id).join('\n')
  const pageWords = modulePages.map(page => page.segment).join('\n')
  const addresses = useMemo(() => projectAddresses(projectIds ? projectIds.split('\n') : [], pageWords ? pageWords.split('\n') : []), [projectIds, pageWords])
  const addressesRead = projectsLoaded && modulesLoaded
  // How each project is named where it is listed: two clones called `shop` say which folder each is in.
  const labels = useMemo(() => projectLabels(projects), [projects])
  const { route, go: navigate } = useRoute(addresses)
  const { projectId, agentId } = route
  // A module's page (#1774): the route names it by its segment, with no project's own page open.
  const pageSegment = route.page ?? null
  // The address written as the route reads, once it can be read: a project named by its id, as
  // `npx @openagt/dashboard` opens it, shows its name, in place of the entry rather than as a new one.
  useEffect(() => {
    if (addressesRead) navigate(route, { replace: true, keepQuery: true })
    // The route is what the address says; only what names projects changes it here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressesRead, addresses])
  // The one project every page shows (#1513), or null for all of them. A project that is not
  // registered (removed, or a link from another machine) picks nothing.
  const scope = route.scope && projects.some(p => p.id === route.scope) ? route.scope : null
  // Settings lists the picked project's Accounts entry only when there is something to pick there, which takes the server a second to say: asked now, so Settings opens with it.
  useEffect(() => {
    if (scope) readProjectAccountsAhead(scope)
  }, [scope])
  // The address may name a project, and what it names is not read yet: until it is, the address's
  // word is no project's id, so nothing is read for it, and nothing says every project shows either.
  // A page's word counts: before the projects are read, a project's name reads as one.
  const scopePending = scope === null && (route.scope !== undefined || pageSegment !== null) && !addressesRead
  const scopedProjects = useMemo(() => (scope ? projects.filter(p => p.id === scope) : projects), [projects, scope])
  // The modules' pages the dashboard has: every one, or with a project picked only the pages of the
  // packages that project has. The sidebar lists these, and a URL names a page only among these.
  const shownPages = useMemo(() => (scope ? modulePages.filter(page => page.projects.includes(scope)) : modulePages), [modulePages, scope])
  const modulePage = pageSegment ? shownPages.find(page => page.segment === pageSegment) : undefined

  // Every navigation keeps the picked project, and one into another project's page, or into a
  // page in a named project, picks that project: the pages never show a project the select does not name.
  const go = (next: Route, options?: { replace?: boolean }) => navigate({ ...next, ...(scope ? { scope: next.scope ?? next.projectId ?? scope } : {}) }, options)

  // Pick the one project every page shows, or all of them. The page stays, with what it mirrored
  // into the query (a list's filters), unless it is another project's: its launcher becomes the
  // picked project's, and its agent's page the Overview. A module's page drops what follows its
  // segment, which is the project just left's (a ticket of it), and one the picked project does
  // not have becomes the Overview.
  const selectScope = (next: string | null) => {
    const { scope: _scope, ...here } = route
    if (here.projectId !== null) {
      if (next === null) return navigate(here, { keepQuery: true })
      if (here.projectId !== next) return navigate(here.agentId === null ? { projectId: next, agentId: null, scope: next } : { projectId: null, agentId: null, scope: next })
    }
    const mounted = modulePages.find(page => page.segment === here.page)
    if (next !== null && mounted && !mounted.projects.includes(next)) return navigate({ projectId: null, agentId: null, scope: next })
    const { pagePath, ...page } = here
    navigate({ ...page, ...(next !== null ? { scope: next } : {}) }, { keepQuery: !pagePath?.length })
  }

  // A just-started run: bump the tick so the Sessions rail shows an optimistic "starting…" row
  // with the typed prompt at once, before the run's tool writes its card. `id` is the one the
  // project's start hook answered (#761) — the URL already points there, and this is what tells
  // the main pane that a session missing from the list is starting, not gone.
  // `runsOn` names the machine a just-started remote agent executes on (#1067), so the live view can
  // mark where it runs and degrade the panels that are local-only. Undefined for a local agent.
  const [agentStart, setAgentStart] = useState<{ tick: number; intent: string; id: string | null; projectId: string | null; at: number; runsOn?: string }>({ tick: 0, intent: '', id: null, projectId: null, at: 0 })
  // The agents of the project on screen, for its pages, or of the picked project, for the sidebar:
  // the same project whenever both are set. Read once the address is: before, it names the project
  // by its address, not by its id.
  // Every two seconds on the project's own pages, where a run's status is watched; every ten beside
  // the Overview or a module's page, whose rail only lists them (as every project's rail does).
  const agentsOf = addressesRead ? (projectId ?? scope) : null
  const { agents: agents, reload, loaded: agentsLoaded } = useAgents(agentsOf, agentStart.id !== null && agentStart.projectId === agentsOf ? agentStart.id : null, projectId !== null ? 2000 : 10_000)

  // The Context set lives in the shell (#492/#504) so the two surfaces that feed it share one
  // source of truth: the launcher's `@`/`#` chips and Context picker, and the Files pane's tree.
  const contextSet = useContextSet()
  const { context, add: addContext, remove: removeContext, toggle: toggleContext, reset: resetContext } = contextSet

  // The picked Context is one project's, and a session's box sends it with its next message, so
  // changing projects or sessions starts fresh. Keyed off the route rather than the click, because
  // Back/Forward change them too.
  useEffect(() => {
    resetContext()
    // `resetContext` is a fresh closure each render; the project and the session are the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, agentId])

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

  // The cross-project "needs you" queue (#632): open PRs to review, questions to answer, work left
  // on this machine. Polled here in the shell so the sidebar badge, the Overview card and the
  // launcher's "Waiting on you" share one poll. Every five seconds, so an answered question leaves
  // the list soon; the git host is read no more often for it, its listing being cached.
  // The read as a whole goes to the notifier, which tells of every project's items whichever one
  // is picked, and also needs to know which projects the poll actually reached before it calls
  // anything "new" (#1625).
  const { value: interventionsRead, stale: interventionsStale } = usePolled<ProjectionRead<Intervention>>(onInterventions, EMPTY_INTERVENTIONS, 5000, [], {
    remember: 'interventions',
    stored: true,
  })

  const project = projectId ? projects.find(p => p.id === projectId) : undefined
  const projectName = project ? (labels.get(project.id) ?? project.name) : null
  // The Human Queue as the pages show it: the picked project's items, or every project's.
  const interventions = scope ? interventionsRead.items.filter(item => item.projectId === scope) : interventionsRead.items
  useDocumentTitle(interventions.length, projectName ?? (scope ? (labels.get(scope) ?? null) : null))
  // A URL naming a project that is not registered (renamed, removed, mistyped). A non-empty list
  // is the answer, so this never fires while the first read is still out.
  const unknownProject = projectId !== null && projects.length > 0 && !projects.some(p => p.id === projectId)

  // Fire a browser notification when a new item lands on the "needs you" queue (#627). Rides the
  // one interventions poll above (the poll stays unconditional — it also feeds the sidebar badge
  // and Overview card); only the notification is gated, on both the category (`notifyHumanIntervention`,
  // default on) and the browser method (`notifyBrowser`).
  const preferences = usePreferences()
  // Only a fresh read: one stored by an earlier visit taken as what was already there would announce
  // everything that came while the page was closed.
  useInterventionNotifications(interventionsStale ? EMPTY_INTERVENTIONS : interventionsRead, humanInterventionEnabled(preferences) && notificationsEnabled(preferences))

  // The "New activity" category (#627): the default-off feed of agents starting/finishing. Its only
  // client consumer is the browser notification below, so it is polled exactly when that will fire —
  // both the category (`notifyNewActivity`) and the browser method (`notifyBrowser`) on.
  const browserActivity = newActivityEnabled(preferences) && notificationsEnabled(preferences)
  const { value: activity } = usePolled<ProjectionRead<Activity>>(browserActivity ? onActivity : null, EMPTY_ACTIVITY, 15000, [browserActivity], undefined, runsAgain(undefined))
  useActivityNotifications(activity, browserActivity)

  // The shared sidebar's recents when all projects show (#shared-shell): the rail pools every
  // project's sessions here. Polled only then — a picked project's own agents (above) carry its rail.
  const allShow = scope === null && !scopePending
  const recentPace = useRunsPace(10_000)
  const { value: recentAgents, reload: reloadRecent, loaded: recentLoaded } = usePolled<RecentAgent[]>(allShow ? onRecentAgents : null, EMPTY_RECENT, recentPace, [allShow], undefined, runsAgain(undefined))
  // Every project's runs are read every ten seconds, but a run just started is read every second
  // until its row and its name are in, as a project's own list reads it (`use-agents.ts`): the name
  // is the first thing a person waits on. Only for a run just started: one that never shows in that
  // list (it runs on another machine) is not read for again each time the list is shown.
  const startedRecent = agentStart.id === null ? undefined : recentAgents.find(row => row.agent.id === agentStart.id && row.projectId === agentStart.projectId)
  const recentAwaitsStart =
    allShow && agentStart.id !== null && Date.now() - agentStart.at < STARTING_AT_MOST_MS && (startedRecent === undefined || awaitingName(startedRecent.agent, preferences.nameRuns !== false))
  useEffect(() => {
    if (!recentAwaitsStart) return
    const timer = setInterval(() => void reloadRecent(), 1000)
    const stop = setTimeout(() => clearInterval(timer), STARTING_AT_MOST_MS)
    return () => {
      clearInterval(timer)
      clearTimeout(stop)
    }
  }, [recentAwaitsStart, reloadRecent])

  // An agent just started in `inProject`, which is not always the selected one: the onboarding
  // checklist starts one from the Overview, where nothing is selected (#1169).
  const agentStarted = (inProject: string | null, intent: string, startedId: string, runsOn?: string) => {
    // Continuing the agent already on screen (#762) appends to its journal — nothing truncates, so
    // nothing would re-replay after a reset. Bumping the tick here is what blanked the transcript
    // the moment a message resumed an ended session; a continuation keeps the feed instead.
    const continued = startedId === agentId && inProject === projectId
    setAgentStart(prev => ({ tick: continued ? prev.tick : prev.tick + 1, intent, id: startedId, projectId: inProject, at: Date.now(), ...(runsOn ? { runsOn } : {}) }))
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
  // A run of another computer's project started on this one starts in the copy cloned here: a project the list has yet to read.
  const onAgentStarted = (intent: string, startedId: string, runsOn?: string, startedIn?: string) => {
    if (startedIn !== undefined && startedIn !== projectId) setProjectsKey(k => k + 1)
    agentStarted(startedIn ?? projectId, intent, startedId, runsOn)
  }

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

  // Settings (#958): a dialog over the page you are on, which stays under it, its own query too.
  // Moving between its entries replaces the address, so Back closes it rather than stepping through them.
  const showSettings = (entry = '') => {
    navigate({ ...route, settings: entry }, { keepQuery: true })
  }
  const showSettingsEntry = (entry: string) => {
    const { settingsItem: _item, ...rest } = route
    navigate({ ...rest, settings: entry }, { keepQuery: true, replace: true })
  }
  const closeSettings = () => {
    const { settings: _settings, settingsItem: _item, ...under } = route
    navigate(under, { keepQuery: true })
  }

  // A module's page (#1774): its own segment, in the picked project, like the Overview.
  const showPage = (segment: string) => {
    go({ projectId: null, agentId: null, page: segment })
  }

  // A link into a project's files (#1774) — `tickets/<file>` — opens the mounted module page named
  // by its first segment in that project, at `/<project>/<segment>/<rest>`; the dashboard has no
  // page of its own for any such path and names no module. Nothing opens when no page claims it.
  const openDataLink = (id: string, href: string) => {
    const target = dataLinkRoute(id, href, modulePages)
    if (target) go(target)
  }

  // The shell's services for modules (#1774): what a module page or a link action may ask of the
  // dashboard, none of it naming a skill. Bound to each module's package where its host is built.
  const hostServices = useSteadyServices({
      openAgent: selectAgentInProject,
      openPage: (segment, path, inProject) => go({ projectId: null, agentId: null, page: segment, ...(path && path.length ? { pagePath: path } : {}), ...(inProject ? { scope: inProject } : {}) }),
      pageHref: segment => formatRoute({ projectId: null, agentId: null, page: segment, ...(scope ? { scope } : {}) }, addresses),
      openSettings: entry => showSettings(entry),
      gitHostPeople: onGitHostPeople,
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
      // Asked at once by two cards, or soon again, the same runs are read once.
      agents: (inProject, wanted) => readModuleAgents(inProject, wanted),
      // This computer by the name the page says it everywhere else: one computer, one name.
      machines: async () => {
        const versions = await onMachineVersions()
        const name = ownComputerName(versions.name)
        return { ...versions, ...(name !== undefined ? { name } : {}) }
      },
      // Through the dashboard's own list, so the launcher's "Run on" shows the change at once.
      addMachine: async (link, label) => {
        const added = await addMachine(link, label)
        return added.ok ? { ok: true } : added
      },
      removeMachine,
      renameMachine: async (id, label) => {
        const renamed = await renameMachine(id, label)
        return renamed.ok ? { ok: true } : renamed
      },
      renameComputer: async name => {
        const renamed = await renameComputer(name)
        return renamed.ok ? { ok: true } : renamed
      },
      letMachineIn: sendLetMachineIn,
      machineCode: sendMachineCode,
      computersThrough: onComputersThrough,
      machinePerson: onMachinePerson,
      removeMachineDevice: sendRemoveMachineDevice,
      machineAccounts: async (machineId, agent) => {
        const view = await onMachineAgentAccounts(machineId, agent)
        return view && view.accounts.map((account, i) => ({ id: account.id, name: account.name, own: account.own, ...(account.from !== undefined ? { from: account.from } : {}), first: account.state === 'in-use' || (i === 0 && view.accounts.length === 1) }))
      },
      removeMachineAccount: sendMachineRemoveAgentAccount,
      useLoginsOn: sendUseLoginsOn,
      addComputerThrough: async (machineId, computerId) => {
        const added = await addComputerThrough(machineId, computerId)
        return added.ok ? { ok: true } : added
      },
      watchScreen,
      sendToScreen,
  })

  // The live agent feed is owned here: the main view and the panes' count of its events read one
  // shared event stream.
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

  // Is an agent working (#875)? Drives the mark and the tab icon, and the Overview's agents at work.
  const activeAgents = useActiveAgents()
  const working = activeAgents.active.length > 0
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
    if (pageSegment) {
      if (modulePage)
        return <ModulePageView page={modulePage} projects={scopedProjects} projectId={scope} path={route.pagePath ?? []} />
      // Not read yet is not "no such page": the modules are imported after the first read, and
      // until the projects are read too a project's name reads as a page's word.
      if (!addressesRead) return null
      // A page another project's package adds is not the picked project's.
      const elsewhere = scope !== null && modulePages.some(page => page.segment === pageSegment)
      return (
        <NotFound
          title="No such page"
          detail={
            elsewhere
              ? `The project "${projects.find(p => p.id === scope)?.name ?? scope}" has no package that adds a page at "${pageSegment}".`
              : route.scope === undefined
                ? `No project has the address "/${pageSegment}", and no installed package adds a page there.`
                : `No installed package adds a page at "${pageSegment}".`
          }
          actionLabel="Go to the Overview"
          onAction={showDashboard}
        />
      )
    }
    if (!projectId) {
      // A project's Overview whose project is not read yet: not every project's.
      if (scopePending) return null
      return (
        <DashboardPage
          onSelectProject={selectProject}
          onSelectAgent={selectAgentInProject}
          onAgentStarted={agentStarted}
          interventions={interventions}
          interventionsStale={interventionsStale}
          active={activeAgents}
          projects={projects}
          scope={scope}
        />
      )
    }
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
          home={project?.machine}
          waiting={interventions}
          events={events}
          onAgentStarted={onAgentStarted}
          files={files}
          context={context}
          addContext={addContext}
          removeContext={removeContext}
          toggleContext={toggleContext}
          onOpenAgent={selectAgentInProject}
          errors={project?.errors}
          // The project is off the list: read the list again and leave its page for the Overview of
          // every project, since the one it was picked as is gone.
          onProjectRemoved={() => {
            setProjectsKey(k => k + 1)
            navigate({ projectId: null, agentId: null })
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
        return <AgentView projectId={projectId} agentId={agentId} events={events} live={agentId === agentStart.id ? true : null} label={agentStart.intent || undefined} projectName={projectName} remoteLabel={agentId === agentStart.id ? agentStart.runsOn : undefined} files={files} lost={lost} writing={writing} startedWith={agentId === agentStart.id ? agentStart.intent : undefined} onAgentStarted={onAgentStarted} contextSet={contextSet} />
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
        onAgentStarted={onAgentStarted}
        contextSet={contextSet}
        onDeleted={() => {
          // Its view is about to point at a session that no longer exists; go home and refresh
          // the rail so the row is gone (#1032).
          selectAgent(null)
          reload()
        }}
      />
    )
  }

  const isMobile = useIsMobile()
  // The width its edge was dragged to (SidebarResizer), in place of the sidebar's own default.
  const sidebarWidth = useSidebarWidth()
  // Hidden by its button or Cmd/Ctrl+B, and remembered; a phone's sheet is opened apart from it.
  const sidebarHidden = useSidebarHidden()
  // The name a phone's top bar gives the page; null on a project's own pages, which have a top row.
  const phoneTitle = pageSegment ? (modulePage?.label ?? '') : projectId === null ? 'Overview' : null
  // A page with no chat (the Overview, a module's page) scrolls as a page: the browser's own
  // scrolling, which bounces at either end, and its header goes up with the rest. On a phone its bar
  // stays at the top; on a wider screen the sidebar stays beside it. A chat keeps its box at the
  // bottom, and only its own columns scroll.
  const pageScrolls = phoneTitle !== null
  // Every other page is pinned: only its own columns scroll. A phone made the page itself a little
  // taller than it shows, and a finger on the top bar or the message box scrolled it, or reloaded it.
  useEffect(() => {
    if (pageScrolls) return
    document.documentElement.dataset['pinned'] = 'true'
    // The page lies exactly where the screen shows it: with a phone's keyboard open, the room
    // above the keyboard, so the message box sits on the keyboard. Safari leaves the page as tall,
    // lays its keyboard over it and scrolls what shows: the page follows where that is, rather
    // than scrolling it back, which made it jump while the keyboard came and went.
    const view = window.visualViewport
    const root = document.documentElement
    // Only while a box has the keyboard: once none has, the page is the whole screen at its top
    // again, whatever Safari still says of what shows, which kept it short and low after its
    // keyboard was gone.
    const fit = (): void => {
      if (!view) return
      if (!typing()) {
        root.style.removeProperty('--shown-height')
        root.style.removeProperty('--shown-top')
        if (window.scrollY !== 0 || view.offsetTop !== 0) window.scrollTo(0, 0)
        return
      }
      root.style.setProperty('--shown-height', `${view.height}px`)
      root.style.setProperty('--shown-top', `${view.offsetTop}px`)
    }
    // Safari moves what shows as its keyboard slides, says so only after, and says nothing once
    // it stopped: while a box takes or lets go of the keyboard, what shows is read at every frame.
    let frame = 0
    let until = 0
    const step = (): void => {
      fit()
      frame = performance.now() < until ? requestAnimationFrame(step) : 0
    }
    const settle = (): void => {
      until = performance.now() + SETTLE_MS
      fit()
      if (frame === 0) frame = requestAnimationFrame(step)
    }
    fit()
    view?.addEventListener('resize', settle)
    view?.addEventListener('scroll', settle)
    document.addEventListener('focusin', settle)
    document.addEventListener('focusout', settle)
    return () => {
      delete root.dataset['pinned']
      root.style.removeProperty('--shown-height')
      root.style.removeProperty('--shown-top')
      cancelAnimationFrame(frame)
      view?.removeEventListener('resize', settle)
      view?.removeEventListener('scroll', settle)
      document.removeEventListener('focusin', settle)
      document.removeEventListener('focusout', settle)
    }
  }, [pageScrolls])

  return (
    // The whole shell lives inside the SidebarProvider so the sidebar's context (state + Cmd/Ctrl+B,
    // the `--sidebar-width` var) is available on every route, home and session alike. Its wrapper is
    // the column that used to be a plain div. The installed modules (#1774) are provided around it
    // all, so the link actions they offer reach any page that shows a link.
    <ModulesContext.Provider value={modules}>
    <HostServicesContext.Provider value={hostServices}>
    <OpenProjectContext.Provider value={projectId}>
    <ProjectLabelsContext.Provider value={labels}>
    {/* As tall as what the screen shows, never taller: a phone's 100vh reaches under its browser's
        bars, and the page then scrolled around the column that scrolls. */}
    <SidebarProvider open={!sidebarHidden} onOpenChange={open => setSidebarHidden(!open)} className={pageScrolls ? 'min-h-dvh flex-col' : 'fixed inset-x-0 top-(--shown-top,0px) h-(--shown-height,100dvh) min-h-0 flex-col overflow-hidden'} style={{ '--sidebar-width': `${sidebarWidth}px` } as CSSProperties}>
      {/* The top navbar is gone (#772 follow-up): its brand, global nav and utility controls moved
          into the sidebar (AgentHistory), so the workspace and the panes get the full height. */}
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
      {/* A page that scrolls as a page is clipped sideways only: a box that clips both ways holds its bar from sticking. */}
      <div className={cn('relative flex min-h-0 flex-1', pageScrolls ? 'overflow-x-clip' : 'overflow-hidden')}>
        <AgentHistory
          pageScrolls={pageScrolls}
          projectId={projectId}
          scope={scope}
          scopePending={scopePending}
          listLoaded={scope === null ? recentLoaded : agentsLoaded}
          onScope={selectScope}
          homeHref={formatRoute({ projectId: null, agentId: null, ...(scope ? { scope } : {}) }, addresses)}
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
          startProjectName={agentStart.projectId !== null ? labels.get(agentStart.projectId) : undefined}
          working={working}
          onDashboard={showDashboard}
          onSettings={showSettings}
          pages={shownPages}
          activePage={pageSegment}
          onPage={showPage}
          interventionCount={interventions.length}
        />
        {/* On a phone the sidebar is a sheet, and this button, over the page's top left corner,
            opens it. An agent's page and the "New agent" page keep that corner of their top row
            free; a page with no top row of its own gets a bar that names it. */}
        {isMobile && !pageScrolls && <MenuButton />}
        {/* A project's page and an agent's have panes beside them (Panes). A module's page takes
            the full width itself (#1774), the way the Overview does. */}
        <PanesProvider
          projectId={projectId}
          agentId={agentId}
          enabled={!pageSegment}
          files={files}
          context={context}
          toggleContext={toggleContext}
          activity={events.length}
          // A subagent a row of the agent's chat opened, beside the chat.
          subagent={projectId && agentId ? <SubagentPanel projectId={projectId} agentId={agentId} events={events} subagents={subagents} live={selectedAgent?.status === 'running'} onOpenAgent={selectAgent} /> : undefined}
        >
          <PaneLayout>
            <main className="flex min-h-0 min-w-0 flex-1 flex-col">
              {isMobile && phoneTitle !== null && <PhoneBar title={phoneTitle} />}
              {renderMain()}
            </main>
          </PaneLayout>
        </PanesProvider>
      </div>
      {/* What a module of this computer's draws over every page: a popup it raises itself. */}
      {modules.everyPage.map(({ EveryPage, package: pkg }) => (
        <ModuleSlot key={pkg} package={pkg} label={`${pkg} popup`}>
          <EveryPage />
        </ModuleSlot>
      ))}
      {route.settings !== undefined && <SettingsDialog entry={route.settings} openItem={route.settingsItem} onEntry={showSettingsEntry} onClose={closeSettings} scope={scope} projects={projects} />}
    </SidebarProvider>
    </ProjectLabelsContext.Provider>
    </OpenProjectContext.Provider>
    </HostServicesContext.Provider>
    </ModulesContext.Provider>
  )
}
