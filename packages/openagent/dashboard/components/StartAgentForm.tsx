import { useRef, useState } from 'react'
import { Folder } from 'lucide-react'
import { onProjects, onStartCheck } from '../rpc/projects.js'
import type { ProjectSummary } from '../../src/index.js'
import { usePreferences, usePreferencesLoaded, updatePreferences } from '../lib/preferences.js'
import { offeredPublishPicks, publishPickIn } from '../../src/client.js'
import { useMachines } from '../lib/machines.js'
import { useSelectedMachineId } from '../lib/remote-target.js'
import { cleanupPick, offersPostMergeCleanup, startPicks, useStartAgent } from '../lib/use-start-agent.js'
import { readyCommands, useProjectLauncher } from '../lib/use-project-launcher.js'
import { useLoaded } from '../lib/use-async.js'
import { promptWithContext } from '../lib/use-context-set.js'
import { AutoMenu } from './AutoMenu.js'
import { ContextMenu } from './ContextMenu.js'
import { Composer, type ComposerHandle } from './Composer.js'
import { StartFromMenu, type StartFrom } from './StartFromMenu.js'
import { Chip } from './ui/chip.js'
import { Dots } from './ToolCalls.js'

/** The note while the start is asked for: what the chat's first line says next. */
const STARTING = 'Starting session'

// Start a run in the selected project (#405, #1774): a free-text box, where `/` lists the project's
// commands, and Start, which is the project's own start hook (posted over `sendStart`). The editor +
// control row are the shared Composer (#721); this form owns the submit.
// A project without a start hook cannot start a run from here, and the form says how to add one:
// the scheduler's `init` writes its lines, or a person writes a `start:` line of their own.
// What would stop the run (a coding agent not installed or logged out) is said before the Start,
// from the project's check hook.
// The Context picker (#439/#314) narrows the run's focus to other projects and to files: the
// picked paths ride the prompt as one `Context:` line at its end.
// The row of chips above the box says where the Start goes: the "Run on" pick, which the Composer
// draws first, then the project's name, then the branch the agent starts from.
// That last chip is a menu: the project's main branch (origin's default branch, fetched fresh), or
// "My local branch", the branch the project's folder is on, as committed on this machine. The pick
// is saved per project. The local pick hands the start hook the branch's name as `BASE`; the main
// branch hands it none. The chip is drawn only where the pick is obeyed: the daemon names the two
// branches only when the project's start line passes `BASE` on, and a machine has its own branches,
// so with a machine picked there is no chip and the Start names no branch.
// The "Auto" menu, under the box at the left (the model menu is at the right): what the agent
// does by itself when it finishes. Its button reads the picks, so nothing is hidden.
// In it, how far the run takes its work: Nothing, Commit, Publish branch, Open PR, Merge on green.
// The level is handed to the start hook as `PUBLISH`; Nothing hands it none. Until the person
// picks, the button shows the pick the daemon will start the run at: Commit, which pushes
// nothing. Saved, so the pick holds for every next run. A project with no git host package
// is offered Nothing, Commit and Publish branch only, and one with no remote Nothing and Commit.
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
}: {
  projectId: string
  /** The project's name, for its chip above the box; absent until the projects are read. */
  projectName?: string | null | undefined
  /** `runsOn` names the machine a remote agent executes on (#1067), for the "runs on <machine>" marker. */
  onAgentStarted?: ((intent: string, agentId: string, runsOn?: string) => void) | undefined
  /** The project's files for the `#` picker (#504), owned by the shell. */
  files: string[]
  /** The Context set, shared with the right rail's file tree (#492), owned by the shell. */
  context: Set<string>
  /** Add a path to the Context (from an `@`/`#` mention). */
  addContext: (path: string) => void
  /** Drop a path from the Context when its `@`/`#` chip leaves the editor (#948). */
  removeContext: (path: string) => void
  /** Toggle a path in the Context (a project's checkbox, a file's cross). */
  toggleContext: (path: string) => void
}) {
  const [note, setNote] = useState<string | null>(null)
  const { busy, error, reset, start } = useStartAgent()
  const composerRef = useRef<ComposerHandle>(null)
  const preferences = usePreferences()
  const launcher = useProjectLauncher(projectId)

  // The machine this run targets (#1067), if one is picked in "Run on": the start names it by its
  // id, and the daemon, which holds its key, sends the run there. A project with no repository
  // address has no name another machine knows it by, so a pick made on another project's launcher
  // does not hold here; until the launcher is read that is not known, and the pick holds. A
  // machine runs the start hook of its own copy of the project, so this copy's lack of one does
  // not block it.
  const machines = useMachines()
  const selectedMachineId = useSelectedMachineId()
  const machine = selectedMachineId && (launcher === null || launcher.address !== undefined) ? machines.find(m => m.id === selectedMachineId) : undefined
  const noStartHook = launcher !== null && !launcher.startHook && !machine
  // A machine starts the run in its own project, whose commands this launcher does not read. A command
  // whose skill has yet to reach the branch the agent starts from is not one the run can follow with.
  const commands = machine ? [] : readyCommands(launcher?.commands ?? [])
  const offersCleanup = offersPostMergeCleanup(commands)
  // Whether a pull request can be opened here: unknown until the launcher is read, and a machine's
  // own project is not read at all, so both are offered every pick; the daemon that starts the run
  // holds a pull request pick to the branch where its project has no git host.
  const gitHost = machine ? true : (launcher?.gitHost ?? true)
  // A project with no remote can publish nothing: its picks stop at the commit.
  const remote = machine ? true : (launcher?.remote ?? true)
  const publishPick = publishPickIn(preferences.publish, gitHost, remote)
  // The two branches the agent can start from, where the pick is offered at all.
  const startFrom = machine ? undefined : launcher?.startFrom
  const startFromPick: StartFrom = preferences.startFrom?.[projectId] ?? 'main'
  const preferencesLoaded = usePreferencesLoaded()
  // The whole map is written: a save names keys, and this is one key. The main branch is the
  // absent entry, so picking it takes the project out.
  const pickStartFrom = (pick: StartFrom) => {
    const { [projectId]: _was, ...others } = preferences.startFrom ?? {}
    updatePreferences({ startFrom: pick === 'local' ? { ...others, [projectId]: 'local' } : others })
  }

  // Re-read when the pick changes: `claude` being logged in says nothing about `codex`. A run on
  // another machine uses that machine's CLIs, so this one's say nothing about it.
  const driver = preferences.driver
  const readiness = useLoaded(machine ? null : () => onStartCheck(projectId, driver), null, [projectId, driver, machine === undefined])

  // The Context mixes whole projects (registered paths) and single files (relative paths): the
  // files are listed to be removed, and each kind is counted in the picker's summary. The current
  // project is the run's own checkout, so only the other projects are offered (#665).
  const projects = useLoaded<ProjectSummary[]>(onProjects, [], [])
  const projectPaths = new Set(projects.map(p => p.path))
  const contextFiles = [...context].filter(path => !projectPaths.has(path))
  const otherProjects = projects.filter(p => p.id !== projectId)
  const pickedProjects = otherProjects.filter(p => context.has(p.path)).length
  const contextSummary = [
    pickedProjects > 0 ? `${pickedProjects} project${pickedProjects > 1 ? 's' : ''}` : null,
    contextFiles.length > 0 ? `${contextFiles.length} file${contextFiles.length > 1 ? 's' : ''}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  const submit = async (text: string) => {
    if (busy) return
    setNote(STARTING)
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
      onAgentStarted?.(text, result.agentId, machine?.label) // select the run we just started (#761)
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
    <form onSubmit={e => e.preventDefault()} className="mx-auto w-full max-w-3xl p-2">
      <Composer
        ref={composerRef}
        files={files}
        addContext={addContext}
        removeContext={removeContext}
        // No chip until the name is known, never a wrong one: the row is there all the same and
        // its height is fixed, so the name landing moves nothing.
        // The "start from" chip is the row's last, so nothing is beside it to push when it lands
        // or when its words change. It waits for the name, which would otherwise land before it
        // and push it, and for the saved pick, which would otherwise flip its words.
        aboveControls={
          projectName ? (
            <>
              <Chip icon={<Folder className="h-3.5 w-3.5 shrink-0" aria-hidden />}>{projectName}</Chip>
              {startFrom && preferencesLoaded && <StartFromMenu main={startFrom.main} local={startFrom.local} pick={startFromPick} onPick={pickStartFrom} busy={busy} />}
            </>
          ) : null
        }
        belowControls={
          <>
          <ContextMenu
            otherProjects={otherProjects}
            context={context}
            contextFiles={contextFiles}
            summary={contextSummary}
            busy={busy}
            onToggle={toggleContext}
          />
          <AutoMenu
            publish={publishPick}
            picks={offeredPublishPicks(gitHost, remote)}
            onPublish={pick => updatePreferences({ publish: pick })}
            cleanup={offersCleanup ? (preferences.postMergeCleanup ?? false) : undefined}
            onCleanup={next => updatePreferences({ postMergeCleanup: next })}
            busy={busy}
          />
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

      {/* Feedback right where the action is (#948). */}
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
      {note === STARTING && !error ? (
        // The chat's own first line (`SessionLine.tsx`), in its words and its look: the page that
        // opens a moment later goes on saying it.
        <p role="status" className="mt-2 flex items-center gap-2 px-1.5 text-sm text-muted-foreground">
          <Dots />
          <span className="text-shimmer">{note}</span>
        </p>
      ) : (
        note && !error && <p role="status" className="mt-2 text-xs text-muted-foreground">{note}</p>
      )}
      {readiness?.problems.map(problem => (
        <p key={problem} role="alert" className="mt-2 text-xs text-danger">
          {problem}
        </p>
      ))}
      {readiness?.warnings.map(warning => (
        <p key={warning} role="alert" className="mt-2 text-xs text-warning">
          {warning}
        </p>
      ))}
      {noStartHook && (
        <p role="alert" className="mt-2 text-xs text-danger">
          This project has no start hook. Add a <code className="font-mono">start:</code> line to{' '}
          <code className="font-mono">.openagent/hooks.yml</code>.
        </p>
      )}
    </form>
  )
}
