import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CircleAlert } from 'lucide-react'
import type { ProjectSummary, StartFromPick } from '../../src/index.js'
import { onCloneCheck, onStartBranches, onStartCheck } from '../rpc/projects.js'
import { thisMachineName } from '../lib/this-machine.js'
import { onMachineLogins, onMachineStartCheck } from '../rpc/machines.js'
import { usePreferences, usePreferencesLoaded, updatePreferences } from '../lib/preferences.js'
import { DEFAULT_AGENT, DRIVER_LABELS, isDriverName, machineName, offeredPublishPicks, publishPickIn, reachedThrough } from '../../src/client.js'
import { useMachines } from '../lib/machines.js'
import { followProjectHome, runTarget, useSelectedMachineId } from '../lib/remote-target.js'
import type { StartPicks } from '../lib/started-from.js'
import { startPicks, useStartAgent } from '../lib/use-start-agent.js'
import { useProjectLauncher } from '../lib/use-project-launcher.js'
import { useLoaded, usePolled } from '../lib/use-async.js'
import { Button } from './ui/button.js'
import { openPermissions, openSettings } from '../lib/use-route.js'
import { promptWithContext } from '../lib/use-context-set.js'
import { stashPendingDraft } from '../lib/draft-handoff.js'
import { AutoMenu } from './AutoMenu.js'
import { ProjectContextMenu } from './ContextMenu.js'
import { Composer, type ComposerHandle } from './Composer.js'
import { StartFromMenu, prTargetBranch, startFromBase } from './StartFromMenu.js'
import { ProjectPicker } from './ProjectPicker.js'
import { SessionRepoPicks, type PickedRepo } from './SessionRepos.js'
import { Dots } from './ToolCalls.js'
import { AgentFix, agentWords, useAgentState } from './Logins.js'
import { MachineLogins } from './ServerLogins.js'
import { agentPicks, SkillsMenu, type SkillPicks } from './SkillsMenu.js'
import { GitAccountMenu, useSessionAccount } from './GitHosts.js'
import { AgentMenu } from './AgentMenu.js'
import { useAgentsList } from './AgentsPage.js'
import { SESSIONS_ID } from '../../src/project-address.js'

/** The note while the start is asked for: what the chat's first line says next. */
const STARTING = 'Starting session'

/** How often a picked machine is asked again while it says a run would not start there: its logins come by themselves, or by a press. */
const MACHINE_MISSING_MS = 8_000
const MACHINE_SELDOM_MS = 60_000
/** How often another person's computer is asked which of this person's logins it has, while one is picked. */
const THEIR_LOGINS_MS = 8_000

// Start a run in the selected project (#405, #1774): a free-text box, where `/` lists the project's
// commands, and Start, which is the project's own start hook (posted over `sendStart`). The editor +
// control row are the shared Composer (#721); this form owns the submit.
// A project without a start hook cannot start a run from here, and the form says how to add one:
// the scheduler's `init` writes its lines, or a person writes a `start:` line of their own.
// What would stop the run (a coding agent not installed or logged out) is said before the Start,
// from the project's check hook: this computer's, or, with a machine picked, the machine's own,
// asked there. The line a press fixes is said with its press inside: logging the agent in here, or
// this computer's logins on the machine. All of it is said above the box, over the page, where
// the Start's own line is: the box does not move when it comes or goes.
// The Context picker (#439/#314) narrows the run's focus to other projects and to files: the
// picked paths ride the prompt as one `Context:` line at its end.
// The row above the box says where the Start goes: the "Run on" pick, which the Composer draws
// first, then the project's name, then the branch the agent starts from.
// That branch is a menu: the project's main branch (origin's default branch, fetched fresh), "My
// local branch", the branch the project's folder is on, as committed on this machine, or another
// of origin's branches, fetched fresh. The pick is saved per project. It reaches the start hook as
// `BASE`: the local branch's name, or origin's copy of the branch by its full name; the main branch
// hands it none. The pick is drawn only where it is obeyed: the daemon offers it only when the
// project's start line passes `BASE` on, and a machine has its own branches, so with a machine
// picked there is none and the Start names no branch.
// The "Auto" menu, under the box at the left (the model menu is at the right): what the agent
// does by itself when it finishes. Its button reads the picks, so nothing is hidden.
// In it, how far the run takes its work: Off, Commit, Publish branch, Open PR, Merge on green.
// The level is handed to the start hook as `PUBLISH`; Off hands it none. Until the person
// picks, the button shows the pick the daemon will start the run at: Commit, which pushes
// nothing. Saved, so the pick holds for every next run. A project with no git host package
// is offered Off, Commit and Publish branch only, and one with no remote Off and Commit.
// At the right of that row, before the model: the git host account this session pushes as, on
// the computer the run goes to. A pick there is for this session alone: it goes with the Start,
// and the computer's own pick, the Permissions page's, stays. Not saved: the next session starts
// on the computer's again.
// First under the box, the "Agent" menu: which agent the session is on, its skills and accounts
// (AgentMenu.tsx); saved, like the model. Its GitHub account is what the account control shows
// until the person picks another for the session.
// With no project (`SESSIONS_ID`), the run starts in a folder of its own on this computer: the row
// says "No project", and nothing about a repository is offered, no branch, no account, no Auto
// level, no project Context or skills. Beside "No project", the repos the session has as context
// (SessionRepos.tsx): each is copied into the session's folder, and none is made a project.
export function StartAgentForm({
  projectId,
  projectName,
  onAgentStarted,
  files,
  context,
  addContext,
  removeContext,
  toggleContext,
  home,
  projects,
  onPickProject,
  onProjectAdded,
}: {
  projectId: string
  /** Every project, for the picker of where the session works (ProjectPicker). */
  projects: readonly ProjectSummary[]
  /** Open the "New agent session" page of another project, or of no project. */
  onPickProject: (projectId: string) => void
  /** A repo was added as a project from the picker: the projects are to be read again. */
  onProjectAdded: () => void
  /** The saved machine the project is on, when only another computer of the person's has it (elsewhere.ts). */
  home?: string | undefined
  /** The project's name, for the row above the box; absent until the projects are read. */
  projectName?: string | null | undefined
  /** `runsOn` names the machine a remote agent executes on (#1067), for the "runs on <machine>" marker; `startedIn` the project the run started in, when it is not this one. */
  onAgentStarted?: ((intent: string, agentId: string, runsOn?: string, startedIn?: string, picks?: StartPicks) => void) | undefined
  /** The project's files for the `#` picker (#504), owned by the shell. */
  files: string[]
  /** The Context set, shared with the Files pane's tree (#492), owned by the shell. */
  context: Set<string>
  /** Add a path to the Context (from an `@`/`#` mention). */
  addContext: (path: string) => void
  /** Drop a path from the Context when its `@`/`#` chip leaves the editor (#948). */
  removeContext: (path: string) => void
  /** Toggle a path in the Context (a project's checkbox, a file's cross). */
  toggleContext: (path: string) => void
}) {
  const [note, setNote] = useState<string | null>(null)
  // The machine the last start was sent to, by its name: what the form says it is cloning on.
  const [sentTo, setSentTo] = useState<string | null>(null)
  const { busy, cloning, error, reset, start } = useStartAgent(projectId)
  const composerRef = useRef<ComposerHandle>(null)
  const preferences = usePreferences()
  const launcher = useProjectLauncher(projectId)
  const noProject = projectId === SESSIONS_ID
  // The repos a session with no project has as context, until it starts or another project is picked.
  const [repos, setRepos] = useState<PickedRepo[]>([])
  useEffect(() => setRepos([]), [projectId])
  // What the box holds, so another project picked takes the prompt along to its page.
  const typed = useRef('')
  const pickProject = (id: string) => {
    if (id === projectId) return
    if (typed.current.trim()) stashPendingDraft(typed.current)
    onPickProject(id)
  }

  // The machine this run targets (#1067), if one is picked in "Run on": the start names it by its
  // id, and the daemon, which holds its key, sends the run there (runTarget). A machine runs the
  // start hook of its own copy of the project, so this copy's lack of one does not block it.
  //
  // A project only another computer has is that computer's: it is picked when the project is
  // opened, and the launcher read is that computer's own, so on it the run starts as on a project
  // of this computer's, its commands and branches and all. On this computer it starts in a copy
  // cloned here first, which has none of that yet.
  const machines = useMachines()
  const selectedMachineId = useSelectedMachineId()
  useEffect(() => followProjectHome(home), [projectId, home])
  // A session with no project goes to any machine: nothing is cloned, it works in that machine's own folder for them.
  const machine = runTarget(machines, selectedMachineId, noProject ? { address: SESSIONS_ID } : launcher, home)
  const atHome = home !== undefined && machine?.id === home
  // A machine that is not where the launcher was read: its own copy is not read at all.
  const foreign = machine !== undefined && !atHome
  const clonedHere = home !== undefined && machine === undefined
  const noStartHook = launcher !== null && !launcher.startHook && !foreign && !clonedHere
  // Whether a pull request can be opened here: unknown until the launcher is read, and a machine's
  // own project is not read at all, so both are offered every pick; the daemon that starts the run
  // holds a pull request pick to the branch where its project has no git host.
  const gitHost = foreign ? true : (launcher?.gitHost ?? true)
  // A project with no remote can publish nothing: its picks stop at the commit.
  const remote = foreign ? true : (launcher?.remote ?? true)
  const publishPick = publishPickIn(preferences.publish, gitHost, remote)
  // The branches every project's menu lists, where the pick is offered at all.
  const startFrom = foreign || clonedHere ? undefined : launcher?.startFrom
  const startFromPick = preferences.startFrom?.[projectId]
  const preferencesLoaded = usePreferencesLoaded()
  // The whole map is written: a save names keys, and this is one key. The main branch is the
  // absent entry, so picking it takes the project out.
  const pickStartFrom = (pick: StartFromPick | undefined) => {
    const { [projectId]: _was, ...others } = preferences.startFrom ?? {}
    updatePreferences({ startFrom: pick ? { ...others, [projectId]: pick } : others })
    // The red error may be about the branch just left behind.
    if (error) reset()
  }

  // Where the pull request goes: the picked branch unless the person said main, for that branch; a
  // new pick of the branch to start from starts over. Whether origin has "My local branch" is read
  // from origin, as the branch menu's list is: this clone's copies keep branches origin deleted.
  const [mainFor, setMainFor] = useState<string | null>(null)
  const localOnOrigin = useLoaded<string[] | undefined>(launcher?.prBase && startFrom && startFromPick?.kind === 'local' ? () => onStartBranches(projectId).then(read => read?.branches, () => undefined) : null, undefined, [projectId, launcher?.prBase, startFrom !== undefined, startFromPick?.kind])
  const prBranch = launcher?.prBase && startFrom ? prTargetBranch(startFromPick, startFrom.main, startFrom.local, localOnOrigin) : undefined
  const prInto = prBranch !== undefined && mainFor !== prBranch ? prBranch : undefined
  const prTarget = prBranch !== undefined && startFrom ? { into: prInto ?? startFrom.main, picks: [prBranch, startFrom.main], onPick: (branch: string) => setMainFor(branch === prBranch ? null : prBranch) } : undefined

  // Re-read when the pick changes: `claude` being logged in says nothing about `codex`. A run on
  // another machine uses that machine's CLIs, so this one's say nothing about it: the machine is asked.
  const driver = preferences.driver
  // Asked again once a press fixed what it said: the agent's own state is followed only while the check says a press can.
  const [recheck, setRecheck] = useState(0)
  // A project cloned here first has no check of its own here yet: this computer is asked what the clone and the run would hit.
  const address = launcher?.address
  const here = useLoaded(machine ? null : clonedHere ? (address !== undefined ? () => onCloneCheck(address, driver) : null) : () => onStartCheck(projectId, driver), null, [projectId, driver, machine === undefined, clonedHere, address, recheck])
  const [machineEvery, setMachineEvery] = useState(MACHINE_SELDOM_MS)
  const there = usePolled(machine ? () => onMachineStartCheck(projectId, machine.id, driver) : null, null, machineEvery, [projectId, driver, machine?.id]).value
  const readiness = machine ? there : here
  useEffect(() => {
    const next = there && there.problems.length > 0 ? MACHINE_MISSING_MS : MACHINE_SELDOM_MS
    if (next !== machineEvery) setMachineEvery(next)
  }, [there, machineEvery])
  const fixable = !machine && readiness?.fix !== undefined
  const { state: agent, reload: reloadAgent } = useAgentState(isDriverName(driver) ? driver : undefined, fixable)
  const agentName = DRIVER_LABELS[isDriverName(driver) ? driver : 'claude-code']
  // Another person's computer: a run there uses this person's own logins there, and a run from
  // here copies none. Which are missing is said as soon as it is picked, with where to log in.
  const theirs = usePolled(machine?.owner !== undefined ? () => onMachineLogins(machine.id) : null, null, THEIR_LOGINS_MS, [machine?.id]).value
  const missingThere = machine?.owner !== undefined && theirs?.ok ? (['GitHub', 'Claude'] as const).filter(kind => theirs.logins[kind === 'GitHub' ? 'github' : 'claude'] === undefined) : []
  const name = machine ? machineName(machine) : undefined
  const wasReady = useRef<boolean | undefined>(undefined)
  useEffect(() => {
    const ready = fixable ? agent?.ready : undefined
    if (wasReady.current === false && ready === true) setRecheck(n => n + 1)
    wasReady.current = ready
  }, [fixable, agent?.ready])

  // The agent the session is on: the saved pick, while there is such an agent; the default otherwise.
  const { view: agentsView } = useAgentsList()
  const onAgent = agentsView?.agents.find(one => one.id === (preferences.agent ?? DEFAULT_AGENT)) ?? agentsView?.agents[0]
  const agentId = onAgent !== undefined && onAgent.id !== DEFAULT_AGENT ? onAgent.id : undefined
  // The git host account picked for this session, when the person picked one; the agent's, else the computer's, otherwise.
  const [pickedAccount, setPickedAccount] = useState<string | undefined>()
  useEffect(() => setPickedAccount(undefined), [projectId, machine?.id])
  // The skills picked for this session, beside its agent's list and the project's: what its agent starts from, until the person picks.
  const [skillPicks, setSkillPicks] = useState<SkillPicks>(() => agentPicks(onAgent))
  useEffect(() => setSkillPicks(agentPicks(onAgent)), [projectId, onAgent?.id, onAgent?.projectSkills])
  const pickedSkills = {
    ...(skillPicks.on.length > 0 ? { skillsOn: skillPicks.on } : {}),
    ...(skillPicks.off.length > 0 ? { skillsOff: skillPicks.off } : {}),
    ...(!noProject && skillPicks.project !== undefined ? { projectSkills: skillPicks.project } : {}),
  }
  const account = useSessionAccount(address, machine?.id, pickedAccount ?? onAgent?.accounts.github)

  const submit = async (text: string) => {
    if (busy) return
    setNote(STARTING)
    setSentTo(machine ? machineName(machine) : clonedHere ? hereName() : null)
    const { publish: _publish, ...unpublished } = startPicks(preferences)
    const result = await start(projectId, promptWithContext(text, context), {
      ...(noProject ? unpublished : startPicks(preferences)),
      ...(startFrom ? startFromBase(startFromPick, startFrom.main, startFrom.local) : {}),
      ...(prInto !== undefined ? { prBase: prInto } : {}),
      ...(machine ? { machine: machine.id } : {}),
      ...(noProject && !machine && repos.length > 0 ? { repos: repos.map(repo => repo.path) } : {}),
      ...(!noProject && remote && account !== undefined ? { account } : {}),
      ...(agentId !== undefined ? { agent: agentId } : {}),
      ...pickedSkills,
    })
    setNote(null)
    if (result) {
      // Show the run in the Runs rail immediately (#405): its tool writes the run's card a beat
      // later, so seed an optimistic row with the typed prompt until the real one takes over.
      // A remote agent (#1067) carries the machine label so the view can mark where it executes.
      // What this page says goes with it, for the run's page until the run's record says it.
      const started = startFrom ? (startFromPick?.kind === 'local' ? startFrom.local : startFromPick?.kind === 'published' ? startFromPick.branch : startFrom.main) : undefined
      onAgentStarted?.(text, result.agentId, machine?.label, result.projectId, {
        ...(started !== undefined ? { branch: started } : {}),
        ...(!noProject && remote && account !== undefined ? { gitAccount: account } : {}),
        ...(agentId !== undefined ? { agent: agentId } : {}),
        ...pickedSkills,
        ...(noProject ? {} : { publish: publishPick }),
        ...(prInto !== undefined ? { prBase: prInto } : {}),
        ...(preferences.driver ? { driver: preferences.driver } : {}),
        ...(preferences.model ? { model: preferences.model } : {}),
        ...(preferences.effort ? { effort: preferences.effort } : {}),
        ...(noProject && !machine && repos.length > 0 ? { repos: repos.map(repo => ({ name: repo.name, from: repo.path })) } : {}),
      }) // select the run we just started (#761)
      composerRef.current?.clear()
      setRepos([])
      setSkillPicks(agentPicks(onAgent))
    }
  }

  const loaded = (label: string, replaced: boolean) => {
    reset()
    setNote(replaced ? `${label} loaded over your draft — undo (⌘Z) brings the draft back` : `${label} loaded — review or edit, then Start`)
  }

  return (
    // The width and the padding of an agent's message box (`AgentComposer.tsx`): the box is in the
    // same place on both pages.
    <form onSubmit={e => e.preventDefault()} className="relative mx-auto w-full max-w-3xl p-2">
      <Composer
        // A box of its own per project, so the prompt carried over from the picker lands in it (below).
        key={projectId}
        ref={composerRef}
        home={home}
        files={files}
        addContext={addContext}
        removeContext={removeContext}
        // Where the agent starts, above the box after the "Run on" pick: the project, then the branch
        // it starts from. No project word until the name is known, never a wrong one: the row's
        // height is fixed, so the name landing moves nothing. The branch is the row's last, so
        // nothing beside it is pushed when it lands or its words change; it waits for the name,
        // which would otherwise land before it and push it, and for the saved pick, which would
        // otherwise flip its words.
        startsAt={
          <>
            <ProjectPicker look="row" none={{ label: 'No project', tip: 'The session works in a folder of its own' }} picked={noProject ? null : projectId} pickedName={projectName} projects={projects} busy={busy} onPick={id => pickProject(id ?? SESSIONS_ID)} onProjectAdded={onProjectAdded} />
            {/* Repos are folders on this computer, copied into the session's folder here: on a machine there is nothing to copy. */}
            {noProject && !machine && <SessionRepoPicks picked={repos} projects={projects} busy={busy} onChange={setRepos} />}
            {!noProject && projectName && startFrom && preferencesLoaded && <StartFromMenu projectId={projectId} main={startFrom.main} local={startFrom.local} pick={startFromPick} onPick={pickStartFrom} busy={busy} />}
          </>
        }
        // Who runs, under the box at the left (his order): the agent, the skills this session gets, then the Context picker.
        controls={
          <>
            <AgentMenu agents={agentsView?.agents} picked={onAgent?.id} busy={busy} onPick={id => updatePreferences({ agent: id === DEFAULT_AGENT ? '' : id })} />
            <SkillsMenu projectId={noProject ? undefined : projectId} agent={onAgent} groups={agentsView?.skills} picks={skillPicks} onChange={setSkillPicks} busy={busy} />
            {!noProject && <ProjectContextMenu projectId={projectId} context={context} busy={busy} onToggle={toggleContext} />}
          </>
        }
        // What becomes of the work, at that row's right, before the model: who it pushes as (the
        // project's git host account on the computer the run goes to, picked for this session), then
        // the "Auto" menu.
        controlsEnd={
          !noProject && (
            <>
              {remote && <GitAccountMenu address={address} machineId={machine?.id} on={name} busy={busy} picked={pickedAccount} onPick={setPickedAccount} onAddThere={() => machine && openSettings('devices', machine.id)} />}
              <AutoMenu publish={publishPick} picks={offeredPublishPicks(gitHost, remote)} onPublish={pick => updatePreferences({ publish: pick })} target={prTarget} busy={busy} />
            </>
          )
        }
        onSubmit={submit}
        onPromptChange={value => {
          typed.current = value
          if (!value.trim() && note) setNote(null)
          // Editing after a failed start: the red error described the old attempt, drop it (#948).
          if (error) reset()
        }}
        onPreset={loaded}
        busy={busy}
        canSubmit={!noStartHook}
        submitLabel="Start agent"
        submitBusyLabel="Starting…"
      />

      {/* Feedback right where the action is (#948): above the box, over the page, so the box never moves. */}
      <div className="absolute inset-x-2 bottom-full flex flex-col gap-1.5 pb-1">
        {/* A start that hit what the check says, or the missing logins, says nothing the boxes below do not. */}
        {error && missingThere.length === 0 && !readiness?.problems.length && <Refusal {...said(error)} />}
        {machine && missingThere.length > 0 && (
          <Refusal
            title={`Your ${missingThere.join(' and ')} ${missingThere.length === 1 ? 'login is' : 'logins are'} not on ${name} yet.`}
            detail={`Runs there use your own logins. Log ${missingThere.length === 1 ? 'it' : 'them'} in on its page, or start your first run there from your page on ${reachedThrough(machine.url) ?? 'its server'}, which copies yours.`}
            actions={
              <Button type="button" size="xs" onClick={() => openSettings('devices', machine.id)}>
                {`Log in on ${name}`}
              </Button>
            }
          />
        )}
        {readiness?.problems.map(problem =>
          problem === readiness.fix?.problem ? (
            machine ? (
              readiness.fix.kind === 'log-in' ? (
                <Refusal key={problem} title={`${agentName} is not logged in on ${name}.`} actions={<MachineLogins machineId={machine.id} onAccounts={openPermissions} />} />
              ) : (
                // The install brings every coding agent, and an update brings one added since.
                <Refusal
                  key={problem}
                  title={`${agentName} is not installed on ${name}.`}
                  detail={`Update ${name} to get it.`}
                  actions={
                    <Button type="button" size="xs" onClick={() => openSettings('devices', machine.id)}>
                      {`Update ${name}`}
                    </Button>
                  }
                />
              )
            ) : (
              <Refusal
                key={problem}
                {...(agent && !agent.ready ? { title: agentWords(agent), actions: <AgentFix state={agent} onChanged={() => void reloadAgent()} size="xs" /> } : said(problem))}
              />
            )
          ) : (
            <Refusal key={problem} {...said(problem)} />
          ),
        )}
        {readiness?.warnings.map(warning => (
          <p key={warning} role="alert" className="rounded-lg border border-warning/30 bg-[color-mix(in_oklab,var(--color-warning)_8%,var(--color-background))] px-3 py-1.5 text-xs text-warning">
            {warning}
          </p>
        ))}
        {noStartHook && (
          <Refusal
            title="This project has no start hook."
            detail={
              <>
                Add a <code className="font-mono">start:</code> line to <code className="font-mono">.openagent/hooks.yml</code>.
              </>
            }
          />
        )}
        {note === STARTING && !error && (
          // The chat's own first line (`SessionLine.tsx`), in its words and its look: the page that
          // opens a moment later goes on saying it. A machine that does not have the project yet
          // clones it first, which can take minutes: the line says so for as long as it does.
          <p role="status" className="flex items-center gap-2 px-1.5 text-sm text-muted-foreground">
            <Dots />
            <span className="text-shimmer">{cloning && sentTo ? `Cloning ${projectName ?? 'this project'} on ${sentTo}, the first time only` : note}</span>
          </p>
        )}
      </div>
      {note !== STARTING && note && !error && <p role="status" className="mt-2 text-xs text-muted-foreground">{note}</p>}
    </form>
  )
}

/** This computer, in "Cloning … on …": by the name the page was reached at, or as this computer when it is open on it. */
function hereName(): string {
  const name = thisMachineName()
  return name === 'This machine' ? 'this computer' : name
}

/**
 * Why no run starts, or would not, above the message box: what is wrong in one line, then smaller
 * what to do about it, and the press that does it. Opaque under its tint, since it lies over the page.
 */
function Refusal({ title, detail, actions }: { title: ReactNode; detail?: ReactNode | undefined; actions?: ReactNode | undefined }) {
  return (
    <div role="alert" className="flex items-start gap-2.5 rounded-lg border border-danger/30 bg-[color-mix(in_oklab,var(--color-danger)_8%,var(--color-background))] px-3 py-2.5 shadow-sm">
      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
      <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        <p className="text-sm font-medium text-danger">{title}</p>
        {detail !== undefined && (
          <>
            {' '}
            <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
          </>
        )}
        {actions !== undefined && <div className="mt-2 flex flex-wrap items-center gap-2 text-foreground">{actions}</div>}
      </div>
    </div>
  )
}

/**
 * A line said whole, as a title and what follows it: split after its first sentence, when that
 * sentence is short enough to read as one. A daemon's or a machine's words come as one line.
 */
function said(line: string): { title: string; detail?: string } {
  const end = line.search(/\.\s+(?=[A-Z`@])/)
  if (end <= 0 || end > 140) return { title: line }
  return { title: line.slice(0, end + 1), detail: line.slice(end + 1).trim() }
}
