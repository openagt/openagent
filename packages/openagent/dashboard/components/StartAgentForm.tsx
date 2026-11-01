import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CircleAlert, Folder, Puzzle } from 'lucide-react'
import { onCloneCheck, onStartCheck } from '../rpc/projects.js'
import { thisMachineName } from '../lib/this-machine.js'
import { onMachineLogins, onMachineStartCheck } from '../rpc/machines.js'
import { usePreferences, usePreferencesLoaded, updatePreferences } from '../lib/preferences.js'
import { DRIVER_LABELS, isDriverName, machineName, offeredPublishPicks, publishPickIn, reachedThrough } from '../../src/client.js'
import { useMachines } from '../lib/machines.js'
import { followProjectHome, runTarget, useSelectedMachineId } from '../lib/remote-target.js'
import { cleanupPick, offersPostMergeCleanup, startPicks, useStartAgent } from '../lib/use-start-agent.js'
import { readyCommands, useProjectLauncher } from '../lib/use-project-launcher.js'
import { useLoaded, usePolled } from '../lib/use-async.js'
import { Button } from './ui/button.js'
import { openSettings } from '../lib/use-route.js'
import { promptWithContext } from '../lib/use-context-set.js'
import { AutoMenu } from './AutoMenu.js'
import { ProjectContextMenu } from './ContextMenu.js'
import { Composer, type ComposerHandle } from './Composer.js'
import { StartFromMenu, type StartFrom } from './StartFromMenu.js'
import { RowItem, rowButtonClass } from './ui/row-item.js'
import { Dots } from './ToolCalls.js'
import { ACCOUNTS_ENTRY, AgentFix, agentWords, useAgentState } from './Logins.js'
import { MachineLogins } from './ServerLogins.js'
import { GitAccountMenu } from './GitHosts.js'

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
// first, then the project's name, then the branch the agent starts from; at its other end, the git
// host account the run pushes as, on the computer it goes to.
// That branch is a menu: the project's main branch (origin's default branch, fetched fresh), or
// "My local branch", the branch the project's folder is on, as committed on this machine. The pick
// is saved per project. The local pick hands the start hook the branch's name as `BASE`; the main
// branch hands it none. The pick is drawn only where it is obeyed: the daemon names the two
// branches only when the project's start line passes `BASE` on, and a machine has its own branches,
// so with a machine picked there is none and the Start names no branch.
// The "Auto" menu, under the box at the left (the model menu is at the right): what the agent
// does by itself when it finishes. Its button reads the picks, so nothing is hidden.
// In it, how far the run takes its work: Off, Commit, Publish branch, Open PR, Merge on green.
// The level is handed to the start hook as `PUBLISH`; Off hands it none. Until the person
// picks, the button shows the pick the daemon will start the run at: Commit, which pushes
// nothing. Saved, so the pick holds for every next run. A project with no git host package
// is offered Off, Commit and Publish branch only, and one with no remote Off and Commit.
// In it too, the "Post-merge cleanup" box, where the project has that command: ticked, the run is
// followed by a fresh agent running the command on its branch before its pull request merges. The
// box writes the same saved setting as Settings → Agent, so its state is every next run's default.
export function StartAgentForm({
  projectId,
  projectName,
  onAgentStarted,
  files,
  context,
  addContext,
  removeContext,
  toggleContext,
  onOpenSkills,
  home,
}: {
  projectId: string
  /** The saved machine the project is on, when only another computer of the person's has it (elsewhere.ts). */
  home?: string | undefined
  /** The project's name, for the row above the box; absent until the projects are read. */
  projectName?: string | null | undefined
  /** `runsOn` names the machine a remote agent executes on (#1067), for the "runs on <machine>" marker; `startedIn` the project the run started in, when it is not this one. */
  onAgentStarted?: ((intent: string, agentId: string, runsOn?: string, startedIn?: string) => void) | undefined
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
  /** Open the list of the project's skills: given, the row under the box has "Skills" after "Auto". */
  onOpenSkills?: (() => void) | undefined
}) {
  const [note, setNote] = useState<string | null>(null)
  // The machine the last start was sent to, by its name: what the form says it is cloning on.
  const [sentTo, setSentTo] = useState<string | null>(null)
  const { busy, cloning, error, reset, start } = useStartAgent(projectId)
  const composerRef = useRef<ComposerHandle>(null)
  const preferences = usePreferences()
  const launcher = useProjectLauncher(projectId)

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
  const machine = runTarget(machines, selectedMachineId, launcher, home)
  const atHome = home !== undefined && machine?.id === home
  // A machine that is not where the launcher was read: its own copy is not read at all.
  const foreign = machine !== undefined && !atHome
  const clonedHere = home !== undefined && machine === undefined
  const noStartHook = launcher !== null && !launcher.startHook && !foreign && !clonedHere
  // A machine starts the run in its own project, whose commands this launcher does not read. A command
  // whose skill has yet to reach the branch the agent starts from is not one the run can follow with.
  const commands = foreign ? [] : readyCommands(launcher?.commands ?? [])
  const offersCleanup = offersPostMergeCleanup(commands)
  // Whether a pull request can be opened here: unknown until the launcher is read, and a machine's
  // own project is not read at all, so both are offered every pick; the daemon that starts the run
  // holds a pull request pick to the branch where its project has no git host.
  const gitHost = foreign ? true : (launcher?.gitHost ?? true)
  // A project with no remote can publish nothing: its picks stop at the commit.
  const remote = foreign ? true : (launcher?.remote ?? true)
  const publishPick = publishPickIn(preferences.publish, gitHost, remote)
  // The two branches the agent can start from, where the pick is offered at all.
  const startFrom = foreign || clonedHere ? undefined : launcher?.startFrom
  const startFromPick: StartFrom = preferences.startFrom?.[projectId] ?? 'main'
  const preferencesLoaded = usePreferencesLoaded()
  // The whole map is written: a save names keys, and this is one key. The main branch is the
  // absent entry, so picking it takes the project out.
  const pickStartFrom = (pick: StartFrom) => {
    const { [projectId]: _was, ...others } = preferences.startFrom ?? {}
    updatePreferences({ startFrom: pick === 'local' ? { ...others, [projectId]: 'local' } : others })
  }

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

  const submit = async (text: string) => {
    if (busy) return
    setNote(STARTING)
    setSentTo(machine ? machineName(machine) : clonedHere ? hereName() : null)
    const result = await start(projectId, promptWithContext(text, context), {
      ...startPicks(preferences),
      ...cleanupPick(preferences, commands),
      ...(startFrom && startFromPick === 'local' ? { base: startFrom.local } : {}),
      ...(machine ? { machine: machine.id } : {}),
    })
    setNote(null)
    if (result) {
      // Show the run in the Runs rail immediately (#405): its tool writes the run's card a beat
      // later, so seed an optimistic row with the typed prompt until the real one takes over.
      // A remote agent (#1067) carries the machine label so the view can mark where it executes.
      onAgentStarted?.(text, result.agentId, machine?.label, result.projectId) // select the run we just started (#761)
      composerRef.current?.clear()
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
          projectName ? (
            <>
              <RowItem icon={<Folder className="h-3.5 w-3.5 shrink-0" aria-hidden />}>{projectName}</RowItem>
              {startFrom && preferencesLoaded && <StartFromMenu main={startFrom.main} local={startFrom.local} pick={startFromPick} onPick={pickStartFrom} busy={busy} />}
            </>
          ) : null
        }
        // Who it pushes as, at the row's other end: the project's git host account on the computer
        // the run goes to. Its own end of the row, so the branch landing moves nothing.
        startsAtEnd={remote && <GitAccountMenu address={address} machineId={machine?.id} on={name} busy={busy} onAdd={() => (machine ? openSettings('devices', machine.id) : openSettings(ACCOUNTS_ENTRY))} />}
        // How it runs, under the box: the Context picker, the "Auto" menu, then the project's skills (his pick).
        controls={
          <>
            <ProjectContextMenu projectId={projectId} context={context} busy={busy} onToggle={toggleContext} />
            <AutoMenu
              publish={publishPick}
              picks={offeredPublishPicks(gitHost, remote)}
              onPublish={pick => updatePreferences({ publish: pick })}
              cleanup={offersCleanup ? (preferences.postMergeCleanup ?? false) : undefined}
              onCleanup={next => updatePreferences({ postMergeCleanup: next })}
              busy={busy}
            />
            {onOpenSkills && (
              <button type="button" onClick={onOpenSkills} className={rowButtonClass}>
                <Puzzle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="truncate">Skills</span>
              </button>
            )}
          </>
        }
        onSubmit={submit}
        onPromptChange={value => {
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
                <Refusal key={problem} title={`${agentName} is not logged in on ${name}.`} actions={<MachineLogins machineId={machine.id} onAccounts={() => openSettings(ACCOUNTS_ENTRY)} />} />
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
