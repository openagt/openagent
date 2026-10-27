import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowUp, Loader2 } from 'lucide-react'
import type { ProjectSummary } from '../../src/index.js'
import { machineName, type DriverName } from '../../src/client.js'
import {
  usePreferences,
  updatePreferences,
  useProjectPresets,
  saveProjectPresetList,
  useActiveProjectId,
} from '../lib/preferences.js'
import { useLoaded } from '../lib/use-async.js'
import { onProjects } from '../rpc/projects.js'
import { PromptEditor, type PromptEditorHandle } from './PromptEditor.js'
import { PresetCreatePanel } from './PresetCreatePanel.js'
import { CommandsMenu } from './CommandsMenu.js'
import { DriverModelMenu, type DriverOption } from './DriverModelMenu.js'
import { RunOnMenu } from './RunOnMenu.js'
import { openSettings } from '../lib/use-route.js'
import { useMachines, tellMachine, type Machine } from '../lib/machines.js'
import { runTarget, useSelectedMachineId, selectMachine } from '../lib/remote-target.js'
import { useMachineStatus } from '../lib/use-machine-status.js'
import { takePendingDraft } from '../lib/draft-handoff.js'
import { driverOptions, modelEfforts, useModels } from '../lib/models.js'
import { readyCommands, useProjectLauncher } from '../lib/use-project-launcher.js'
import { ClaudeLogo, CodexLogo } from './driver-logos.js'
import { Button } from './ui/button.js'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip.js'
import { cn } from '../lib/utils.js'

// The driver + model tree (#650/#656/#658): each driver lists ONLY its own models, since the
// model passes straight through to that coding agent. Picking a model in a driver's submenu sets both, so an
// incompatible pair can't be chosen. Every entry is a real model id: a "Default" entry used to head
// each list, and picking it stored nothing, so the menu's own answer to "which model" was "we do
// not know" (#1143). Not choosing is still a state — it is just no longer something to pick, and
// the trigger says so rather than naming the first model as if it had been chosen.
// The drivers and their models are the list Settings offers too (`lib/models.ts` driverOptions):
// what each coding agent answered when the daemon asked, so the menu offers what the agent's own
// picker offers, by the agent's own names. Only the icons are this component's own, and the Record<DriverName, ...> shape means a new agent on OpenAgent's side is
// a compile error here rather than a silently missing menu entry.
const DRIVER_UI: Record<DriverName, { icon: DriverOption['icon'] }> = {
  'claude-code': { icon: <ClaudeLogo className="h-4 w-4" /> },
  codex: { icon: <CodexLogo className="h-4 w-4" /> },
}

export interface ComposerHandle {
  clear: () => void
  focus: () => void
}

/** A row of items above or under the box: one line of a fixed height, no wrap. */
const ROW = 'flex h-8 items-center gap-2'
/** Its left side, which gives way: each item cut short, and on a phone, where cut short they would say nothing, scrolled sideways under a faded edge. */
const ROW_LEFT = 'flex min-w-0 flex-1 items-center gap-0.5 max-sm:overflow-x-auto max-sm:[scrollbar-width:none] max-sm:[mask-image:linear-gradient(to_right,#000_85%,transparent)]'

// The shared agent composer (#721), laid out as Claude Code's: a box one line tall when empty that
// holds the commands menu (+), the text (the Tiptap editor, `/` `@` `#` triggers) and the submit at
// its right; a row under it with the caller's controls at the left and the model at the right; and,
// where an agent is started, a row above it saying where (led by the "Run on" pick).
// Factored out of the launcher (StartAgentForm) so the run-view chat (AgentComposer) gets the
// same surface, wired to the same data (files, commands, saved prompts, prefs). The caller owns
// what happens on submit: the launcher starts a run, the chat says the text to the run. The `@`
// picker's project list and the `/` list's commands are Composer's own concern, so it loads
// them here (#743) rather than making every host pass the same lists down.
export const Composer = forwardRef<ComposerHandle, {
  /** The current project's files for the `#` picker (#504). */
  files: string[]
  /** Add a path to the Context (from an `@`/`#` mention). Omit where nothing keeps a Context. */
  addContext?: ((path: string) => void) | undefined
  /** Drop a path from the Context when its `@`/`#` chip leaves the editor (#948). */
  removeContext?: ((path: string) => void) | undefined
  /** Where the agent starts, in the row above the box after the "Run on" pick: the launcher's
   *  project and the branch it starts from. */
  startsAt?: ReactNode
  /** The caller's controls in the row under the box: the launcher's Context picker and "Auto" menu. */
  controls?: ReactNode
  /** Inside a session: the model it runs on, said at the right of the row under the box, where
   *  the launcher has its select. Words, not a menu: a session keeps the model it started with. */
  sessionModel?: string | undefined
  /** Inside a session: how full its context is, beside the model. */
  sessionContext?: ReactNode
  /** Run the composed text. */
  onSubmit: (text: string) => void | Promise<void>
  /** Mirror the live prompt out, so the launcher can drive its note. */
  onPromptChange?: ((prompt: string) => void) | undefined
  /** A command or a saved prompt was loaded (so the launcher can flag it in its note);
   *  `replaced` says a typed draft was overwritten (undo brings it back). */
  onPreset?: ((label: string, replaced: boolean) => void) | undefined
  busy: boolean
  submitLabel: string
  submitBusyLabel: string
  placeholder?: string | undefined
  /** Compact single-row form for the navbar quick-launch (#723): editor + submit, no control row
   *  or save panel. The `/` `@` `#` triggers still work; agent/model + options come from the
   *  shared prefs the launcher sets. */
  compact?: boolean | undefined
  /** Off inside a session (#831): a session is bound to the agent it started with, so the select
   *  would only ever rewrite the *next* session's default. Chosen at the launcher instead. */
  showDriverModel?: boolean | undefined
  /** Inside a session: the "Run on" pick is the launcher's, since a session already runs where it
   *  was started. */
  inAgent?: boolean | undefined
  /** Off when nothing can be started here (the project has no start hook): the submit stays disabled. */
  canSubmit?: boolean | undefined
  /** Occupies the submit slot while the box is empty (#1455): the session page's Stop while the
   *  run is live, its Resume once stopped — so Start/Stop/Resume and the send ↑ are one slot,
   *  like Claude Code's composer. Typing swaps it for the arrow (a live send still queues), and
   *  without one the slot keeps its collapse-when-empty behavior for the launcher. */
  idleControl?: ReactNode
  /** The saved machine the project is on, when only another computer of the person's has it (elsewhere.ts). */
  home?: string | undefined
}>(function Composer(
  { files, addContext, removeContext, startsAt, controls, sessionModel, sessionContext, onSubmit, onPromptChange, onPreset, busy, submitLabel, submitBusyLabel, placeholder, compact = false, showDriverModel = true, inAgent = false, canSubmit = true, idleControl, home },
  ref,
) {
  const [prompt, setPrompt] = useState('')
  const [addingPreset, setAddingPreset] = useState(false)
  const editorRef = useRef<PromptEditorHandle>(null)
  // The machines saved on this dashboard's own machine (#1052).
  const machines = useMachines()
  const machineStatus = useMachineStatus(machines) // #1072: online/offline per saved machine
  // The registered projects for the `@` picker — the same list the launcher reads, but another
  // computer's: its folder is not here to add (elsewhere.ts).
  const listed = useLoaded<ProjectSummary[]>(onProjects, [], [])
  const projects = useMemo(() => listed.filter(p => p.machine === undefined), [listed])

  const preferences = usePreferences()
  const model = preferences.model ?? '' // #628: empty = the coding agent's own default model
  const driver = preferences.driver ?? 'claude-code' // which coding agent does the work (#650)
  const models = useModels()
  const customPresets = preferences.customPresets ?? [] // #626: the user's own saved prompts
  const projectPresets = useProjectPresets() // #1025: saved prompts committed in the open project's repo
  const activeProjectId = useActiveProjectId() // the project whose commands the `/` list offers
  const launcher = useProjectLauncher(activeProjectId)
  const commands = launcher?.commands ?? []
  // A project with no repository address has no name another machine knows it by, so it runs here
  // only and a machine picked on another project's launcher is not its target. Another computer's
  // such project runs on that computer only: this one cannot clone it.
  const onlyHere = home === undefined && launcher !== null && launcher.address === undefined
  const onlyThere = home !== undefined && launcher !== null && launcher.address === undefined
  const selectedMachineId = useSelectedMachineId() // #1067: the machine this run targets, if any
  const selectedMachine = runTarget(machines, selectedMachineId, launcher, home)
  // #1073: block Start when the target machine is known-offline; an absent/unknown status must not block.
  const targetOffline = !!selectedMachine && machineStatus[selectedMachine.id] === 'offline'
  // Another person's computer: the person is told once that their logins are copied there, and
  // starts nothing there until they said OK. Gone at once on OK, before the list is read again.
  const [toldNow, setToldNow] = useState<string | null>(null)
  const owner = selectedMachine?.owner
  const untold = !inAgent && !!selectedMachine && owner !== undefined && !selectedMachine.told && toldNow !== selectedMachine.id

  useImperativeHandle(ref, () => ({
    clear: () => {
      editorRef.current?.clear()
      setPrompt('')
    },
    focus: () => editorRef.current?.focus(),
  }))

  // Rehydrate a draft carried in from the click that navigated here (#1139), launcher-only.
  //
  // Handed to the editor as `initialText` rather than pushed through the handle: the draft is taken
  // once and cleared, while `loadTemplate` silently does nothing until Tiptap has resolved
  // (`immediatelyRender: false`), so pushing it at mount dropped the draft and left an empty
  // composer. `prompt` then arrives the normal way, through the editor's own onChange.
  const [carriedDraft, setCarriedDraft] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (compact || inAgent) return
    const carried = takePendingDraft()
    if (carried) setCarriedDraft(carried)
  }, [compact, inAgent])

  // A synchronous latch alongside the async `busy` prop (#948): two fast ⌘↵ presses both read
  // `busy === false` (React state lags), fired two starts, and the second surfaced a spurious
  // "already active" error. The ref flips before any await.
  const submittingRef = useRef(false)
  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    const text = prompt.trim()
    // #1073: a keyboard submit must be blocked too when the target machine is offline.
    if (!text || busy || submittingRef.current || targetOffline || untold || !canSubmit) return
    submittingRef.current = true
    void Promise.resolve(onSubmit(text)).finally(() => {
      submittingRef.current = false
    })
  }

  // The Commands button's load path (#948): through the imperative handle rather than the
  // suggestion plugin, then the same bookkeeping as the `/` menu.
  const loadFromMenu = (text: string, label: string) => {
    const replaced = editorRef.current?.loadTemplate(text) ?? false
    onPreset?.(label, replaced)
  }

  const onPromptEdit = (value: string) => {
    setPrompt(value)
    onPromptChange?.(value)
  }

  const editorEl = (
    <PromptEditor
      ref={editorRef}
      compact={compact}
      onChange={onPromptEdit}
      onSubmit={submit}
      {...(onPreset ? { onPreset } : {})}
      {...(addContext ? { onMentionProject: addContext, onMentionFile: addContext } : {})}
      {...(removeContext ? { onMentionRemoved: removeContext } : {})}
      projects={projects}
      files={files}
      commands={readyCommands(commands)}
      customPresets={customPresets}
      projectPresets={projectPresets}
      // The `/` menu offers "Save prompt…" only in the full composer, where the create panel renders;
      // the compact navbar launch has no panel, so it gets no callback (and no item).
      {...(compact ? {} : { onNewPreset: () => setAddingPreset(true) })}
      disabled={busy}
      {...(placeholder ? { placeholder } : {})}
      {...(carriedDraft ? { initialText: carriedDraft } : {})}
    />
  )

  // The agent/model select and the "Run on" pick, shared by both forms (#755). They were compact's
  // one real omission: an agent started from the navbar used the stored agent, model and options with
  // nothing on screen saying which. Every value is preferences-backed and global, so the same
  // controls in either place read and write the same state.
  const driverModelEl = showDriverModel && (
    <DriverModelMenu
      drivers={driverOptions(models).map(d => ({ ...d, ...DRIVER_UI[d.value as DriverName] }))}
      driver={driver}
      model={model}
      onChange={(a, m) => updatePreferences({ driver: a, model: m })}
      // How hard that model may think, in the same menu: the levels are the model's own.
      effort={{ levels: modelEfforts(models, driver, model), level: preferences.effort || undefined, onChange: effort => updatePreferences({ effort: effort ?? '' }) }}
      busy={busy}
    />
  )
  {/* Commands and saved prompts get a visible surface (#948): load, save and delete in one menu,
      instead of loading only behind typing `/`. Not in the compact row, which has no room and
      no save panel. */}
  const commandsEl = !compact && (
    <CommandsMenu
      commands={commands}
      customPresets={customPresets}
      projectPresets={projectPresets}
      busy={busy}
      onLoad={loadFromMenu}
      onNew={() => setAddingPreset(true)}
      onDelete={id => updatePreferences({ customPresets: customPresets.filter(p => p.id !== id) })}
      onDeleteProject={id => saveProjectPresetList(activeProjectId, projectPresets.filter(p => p.id !== id))}
    />
  )
  // Where the next run starts (#1052/#1067): this machine or a saved machine. Launcher-only: a
  // session already runs where it was started.
  const runOnEl = inAgent ? null : (
    <RunOnMenu
      busy={busy}
      inRow={!compact}
      connection={{
        machines,
        selectedMachineId,
        onlyHere,
        home,
        onlyThere,
        // #1067: selecting a machine makes it the run target in place, no navigation.
        onSelect: (m: Machine) => selectMachine(m.id),
        onSelectLocal: () => selectMachine(null),
        // A machine is added where every device is: Settings › Devices.
        onAddMachine: () => openSettings('devices'),
        status: machineStatus,
      }}
    />
  )

  // The submit is a single icon button that only shows once the prompt has text (#721): an empty
  // launcher has nothing to send, and the arrow reads as "send" in either place (Start session /
  // Send). It is always full size (never appears to grow): it fades in and slides into place, and
  // its layout footprint is animated with a negative margin (0 <- -w) rather than its width, so the
  // control to its left (the agent/model select) is pushed over smoothly. `aria-hidden` while empty
  // keeps it out of the a11y tree and role queries.
  const hasPrompt = !!prompt.trim()
  const submitButton = (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="submit"
            size="icon-sm"
            onClick={submit}
            disabled={busy || !hasPrompt || targetOffline || untold || !canSubmit}
            aria-hidden={!hasPrompt}
            tabIndex={hasPrompt ? undefined : -1}
            aria-label={submitLabel}
            className={cn(
              // `disabled:opacity-*` overrides the base (the button is disabled while empty/busy), so the
              // hidden state must force it to 0 and the shown state back to full for the busy spinner.
              'h-8 w-8 shrink-0 transition-[margin,opacity,transform] duration-150 ease-out',
              hasPrompt
                ? // Full while busy, for its spinner; faded while something else holds the start (the note's OK, a machine offline).
                  cn('ml-0 translate-x-0 opacity-100', busy ? 'disabled:opacity-100' : 'disabled:opacity-40')
                // The hidden submit takes no room: its own w-8 (2rem) back, and in the compact row the
                // row's gap-1.5 (0.375rem) too, so the control beside it sits flush.
                : cn('pointer-events-none translate-x-2 opacity-0 disabled:opacity-0', compact ? '-ml-[2.375rem]' : '-ml-8'),
            )}
          />
        }
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
      </TooltipTrigger>
      <TooltipContent>{busy ? submitBusyLabel : `${submitLabel}  (Enter · Shift+Enter for a new line)`}</TooltipContent>
    </Tooltip>
  )

  // One slot, three states (#1455): with an idleControl, the empty box shows it (Stop / Resume)
  // and typing swaps in the send arrow — instead of the launcher's collapse-to-nothing.
  const slotEl = !hasPrompt && idleControl ? idleControl : submitButton

  // #1073: an offline target blocks Start; say so and point back to the pick of where it runs. No auto-fallback.
  const offlineNote = targetOffline && (
    <p role="alert" className="mt-2 text-xs text-danger">
      {`${selectedMachine ? machineName(selectedMachine) : 'The selected machine'} is offline. Pick another place to run, then start.`}
    </p>
  )
  const loginsNote = untold && (
    <div role="note" className="mb-1.5 flex items-center gap-3 rounded-md border border-border bg-background px-3 py-2 text-xs">
      <p className="min-w-0 flex-1">
        <span className="text-foreground">{`Your GitHub and Claude logins are copied to @${owner}'s server.`}</span>{' '}
        <span className="text-muted-foreground">{`@${owner} can see what is on it. Runs there start once you say OK.`}</span>
      </p>
      <Button
        type="button"
        size="xs"
        variant="outline"
        onClick={() => {
          setToldNow(selectedMachine!.id)
          void tellMachine(selectedMachine!.id)
        }}
      >
        OK
      </Button>
    </div>
  )

  // Compact (#723): a single row for the navbar — editor, then the same controls and submit. It
  // stays one row on purpose (#755): the header must not grow taller to gain them.
  if (compact) {
    return (
      <div className="flex items-start gap-1.5">
        <div className="min-w-0 flex-1">{editorEl}</div>
        {driverModelEl}
        {runOnEl}
        {slotEl}
      </div>
    )
  }

  return (
    <>
      {/* Where the agent starts, above the box, where an agent is started (his pick): the machine,
          the project and the branch, drawn as the row under the box draws its items. A fixed height
          and no wrap, so a name that lands late moves nothing; the later items give way first, each
          cut short, and on a phone the row scrolls sideways, its right edge faded to say so. */}
      {!inAgent && (
        <div className={cn('mb-1', ROW)}>
          <div className={ROW_LEFT}>
            {runOnEl}
            {startsAt}
          </div>
        </div>
      )}

      {loginsNote}

      {/* The box, as Claude Code's: a fill a step above the page and rounder corners than the rest
          of the app, the commands menu (+) at its left, the text, and the submit at its right,
          the two kept at the last line. One line tall when empty, growing with what is typed. The
          editor is borderless: the border is the box's. */}
      <div className="flex items-end rounded-xl border border-border bg-card focus-within:border-muted-foreground/40">
        {/* The editor's own inset sets the text off the box's edge; beside the + it pulls in, so the
            text starts close to it, as in Claude Code's. */}
        {commandsEl && <div className="-mr-2 flex shrink-0 items-center p-1">{commandsEl}</div>}
        <div className="min-w-0 flex-1">{editorEl}</div>
        <div className="flex shrink-0 items-center p-1">{slotEl}</div>
      </div>

      {/* How it runs, under the box: the caller's controls at the left, the model at the right. The
          left side is the one that gives way: a longer label there never moves the model or the
          page below. */}
      <div className={cn('mt-1', ROW)}>
        <div className={ROW_LEFT}>{controls}</div>
        <div className="shrink-0">
          {driverModelEl || (
            <span className="flex items-center">
              {sessionModel !== undefined && <span className="px-2 text-[13px] text-muted-foreground">{sessionModel}</span>}
              {sessionContext}
            </span>
          )}
        </div>
      </div>

      {offlineNote}

      {addingPreset && (
        <PresetCreatePanel
          currentPrompt={prompt}
          busy={busy}
          canSaveToProject={activeProjectId !== null}
          onCancel={() => {
            setAddingPreset(false)
            editorRef.current?.focus()
          }}
          onSave={(preset, scope) => {
            if (scope === 'project') saveProjectPresetList(activeProjectId, [...projectPresets, preset])
            else updatePreferences({ customPresets: [...customPresets, preset] })
            setAddingPreset(false)
            editorRef.current?.focus()
          }}
        />
      )}
    </>
  )
})
