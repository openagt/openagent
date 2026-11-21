import { createContext, forwardRef, useContext, useEffect, useImperativeHandle, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ArrowUp, Loader2 } from 'lucide-react'
import type { ProjectSummary } from '../../src/index.js'
import type { DriverName } from '../../src/client.js'
import { SESSIONS_ID } from '../../src/project-address.js'
import { usePreferences, updatePreferences, useActiveProjectId } from '../lib/preferences.js'
import { useLoaded } from '../lib/use-async.js'
import { Button } from './ui/button.js'
import { cn } from '../lib/utils.js'
import { ClaudeLogo, CodexLogo } from './driver-logos.js'
import { onProjects } from '../rpc/projects.js'
import { PromptEditor, type PromptDraft, type PromptEditorHandle } from './PromptEditor.js'
import { CommandsMenu } from './CommandsMenu.js'
import { ModuleSlot } from './ModulePageView.js'
import { usePrompts } from '../lib/use-prompts.js'
import { IN_BOX } from '../lib/in-box.js'
import { DriverModelMenu, type DriverOption } from './DriverModelMenu.js'
import { RunOnMenu } from './RunOnMenu.js'
import { PERMISSIONS_PAGE } from '../lib/use-route.js'
import { HostServicesContext, INERT_HOST_SERVICES } from '../lib/host-services.js'
import { selectHost, useRunHosts, useSelectedHost } from '../lib/run-hosts.js'
import { keepDraft, keptDraft, takePendingDraft } from '../lib/draft-handoff.js'
import { DaemonDown } from '../lib/use-daemon-health.js'
import { useIsMobile } from '../lib/use-mobile.js'
import { driverOptions, modelEfforts, useModels } from '../lib/models.js'
import { readyCommands, useProjectLauncher } from '../lib/use-project-launcher.js'
import { AgentAccountItems, firstAccount, useAccountsOn } from './AgentAccounts.js'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipsPastBox } from './ui/tooltip.js'
import { RowAboveBox, rowClass, rowItemClass, rowLeftClass } from './ui/row-item.js'
import { Skeleton } from './ui/skeleton.js'
import { Slot } from './ui/slot.js'

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

/**
 * The message box, as Claude Code's (DECISIONS.md, his pick): the raised surface with the hairline,
 * holding only the +, the text and the send. Where the agent starts is a row above it, how it runs a
 * row under it. It is focused almost all the time it is on screen, so focus is its own edge and nothing
 * more: the caret says the rest. While its text has the keyboard the edge is a field's focus, 2 wide in
 * the focus colour over its edge, as the presses' ring is 2 wide. While the keyboard is on the + or
 * in the menu it opened, the edge is his 1 wide primary border, so the +'s own ring stands alone.
 */
const BOX =
  '[view-transition-name:composer] flex items-end rounded-box border border-hairline bg-card shadow-lg transition-colors focus-within:border-primary has-[[aria-expanded=true]]:border-primary has-[[role=textbox]:focus]:outline-2 has-[[role=textbox]:focus]:-outline-offset-1 has-[[role=textbox]:focus]:outline-focus'

/**
 * The box while the page it stands on is read: a {@link Slot}'s shape at the three bands' heights,
 * the box's corner on the middle one, and nothing in them, so the box takes its place without
 * moving anything.
 */
export function ComposerShape() {
  return (
    <Slot of={{ value: null, state: 'unknown' }} shape={<div><div className="mb-1 h-8" /><Skeleton className="h-11 rounded-box" /><div className="mt-1 h-8" /></div>}>
      {() => null}
    </Slot>
  )
}

export interface ComposerHandle {
  /** Empty the box. Returns what it held, chips and all, for `restore`. */
  clear: () => PromptDraft | undefined
  /** Put back a draft `clear` returned, after what is typed there, the caret left where it is. */
  restore: (draft: PromptDraft) => void
  focus: () => void
  /** Put `text` in the box to edit, after what is typed there, and focus it. */
  edit: (text: string) => void
  /** Put `text` in the box after what is typed there, the caret left where it is. */
  append: (text: string) => void
}

/**
 * Where a page lays the box's notes, over itself above the box, when the box cannot: a session's
 * box is in a bar that scrolls inside itself, which would cut them (ChatPane). Elsewhere they lie
 * right above the box.
 */
export const BoxNotes = createContext<HTMLElement | null>(null)

// The shared agent composer (#721), laid out as Claude Code's: a box one line tall when empty that
// holds the commands menu (+), the text (the Tiptap editor, `/` `@` `#` triggers) and the submit at
// its right; a row under it with the caller's controls at the left and the model at the right; and
// a row above it saying where the agent starts (led by the "Run on" pick), or, inside a session,
// where it started (`sessionRow`).
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
  /** The caller's controls at that row's other end, before the model: who the run pushes as, the git host account, on both pages. */
  controlsEnd?: ReactNode
  /** Inside a session: the model it runs on, said at the right of the row under the box, where
   *  the launcher has its select. Words, not a menu: a session keeps the model it started with. */
  sessionModel?: string | undefined
  /** Inside a session: how full its context is, beside the model. */
  sessionContext?: ReactNode
  /** Run the composed text; `later` when it was sent with Cmd/Ctrl+Enter, which a working agent reads after its turn. */
  onSubmit: (text: string, sent: { later: boolean }) => void | Promise<void>
  /** Mirror the live prompt out, so the launcher can drive its note. */
  onPromptChange?: ((prompt: string) => void) | undefined
  /** A command or a saved prompt was loaded (so the launcher can flag it in its note);
   *  `replaced` says a typed draft was overwritten (undo brings it back). */
  onLoaded?: ((label: string, replaced: boolean) => void) | undefined
  busy: boolean
  submitLabel: string
  submitBusyLabel: string
  placeholder?: string | undefined
  /** Inside a session: the "Run on" pick is the launcher's, since a session already runs where it
   *  was started, and so is the agent/model select (#831): a session is bound to the agent it
   *  started with, so the select would only ever rewrite the *next* session's default. */
  inAgent?: boolean | undefined
  /** Inside a session: the row above the box, which says what the launcher's row picks. */
  sessionRow?: ReactNode
  /** Occupies the submit slot while the box is empty (#1455): the session page's Stop while the
   *  run is live, its Resume once stopped — so Start/Stop/Resume and the send ↑ are one slot,
   *  like Claude Code's composer. Typing swaps it for the arrow (a live send still queues), and
   *  without one the slot keeps its collapse-when-empty behavior for the launcher. */
  idleControl?: ReactNode
  /** What the caller says about the box: laid over the page above it with the box's own notes,
   *  never in its flow, so the text being typed does not move when one comes or goes. */
  notes?: ReactNode
  /** Which box this is, by project or session: what is typed in it is kept in this browser, across a navigation and a reload, until it is sent. */
  draftKey?: string | undefined
  /** The box takes the caret when it opens. */
  autoFocus?: boolean | undefined
}>(function Composer(
  { files, addContext, removeContext, startsAt, controls, controlsEnd, sessionModel, sessionContext, onSubmit, onPromptChange, onLoaded, busy, submitLabel, submitBusyLabel, placeholder, inAgent = false, sessionRow, idleControl, notes, draftKey, autoFocus = false },
  ref,
) {
  const services = useContext(HostServicesContext) ?? INERT_HOST_SERVICES
  const [prompt, setPrompt] = useState('')
  // The panel that saves what the box holds as a prompt is open.
  const [savingPrompt, setSavingPrompt] = useState(false)
  const editorRef = useRef<PromptEditorHandle>(null)
  // The box's edge, which the tooltips of its last line's items open past.
  const surface = useRef<HTMLDivElement>(null)
  // The registered projects for the `@` picker: the same list the launcher reads.
  const projects = useLoaded<ProjectSummary[]>(onProjects, [], [])

  const preferences = usePreferences()
  const model = preferences.model ?? '' // #628: empty = the coding agent's own default model
  const driver = preferences.driver ?? 'claude-code' // which coding agent does the work (#650)
  const activeProjectId = useActiveProjectId() // the project whose commands the `/` list offers
  // The saved prompts the modules offer the box (#2394).
  const prompts = usePrompts(activeProjectId)
  const savePrompt = prompts.saver ? () => setSavingPrompt(true) : undefined
  const launcher = useProjectLauncher(activeProjectId)
  const commands = launcher?.commands ?? []
  // A session with no project runs in a folder of its own.
  const noProject = activeProjectId === SESSIONS_ID
  // The hosts beside this computer the project's modules bring, and the one picked: none for a session with no project.
  const hosts = useRunHosts(inAgent || noProject ? null : activeProjectId)
  const selectedHostId = useSelectedHost()
  const models = useModels()
  // Each agent's accounts, in its part of the agent picker: the one picked is the one its runs take
  // first, so the run goes with it. An agent not installed here has none to pick, and Codex's
  // accounts are there once it is installed or has some added, as on Settings.
  const claudeAccounts = useAccountsOn('claude', !inAgent)
  const codexAccounts = useAccountsOn('codex', !inAgent)
  const accountsOf = (name: DriverName): Pick<DriverOption, 'account' | 'accounts'> => {
    const { view, pick } = name === 'codex' ? codexAccounts : claudeAccounts
    const answer = models?.[name]
    const installed = answer !== undefined && !('error' in answer && answer.missing)
    if (!view || view.accounts.length === 0 || (name === 'codex' && view.accounts.length < 2 && !installed)) return {}
    return {
      account: firstAccount(view),
      accounts: <AgentAccountItems view={view} onPick={account => void pick(account)} onAdd={() => services.openPage(PERMISSIONS_PAGE)} />,
    }
  }
  // OpenAgent is not answering: nothing typed can be sent, and the box keeps it.
  const down = useContext(DaemonDown)
  // What holds a send, whatever the box holds: the one list the arrow and the keyboard both read.
  const held = busy || down

  useImperativeHandle(ref, () => ({
    clear: () => {
      const draft = editorRef.current?.clear()
      setPrompt('')
      return draft
    },
    restore: draft => editorRef.current?.restore(draft),
    focus: () => editorRef.current?.focus(),
    edit: text => {
      if (prompt.trim() !== '') editorRef.current?.append(text)
      else {
        editorRef.current?.loadTemplate(text)
        setPrompt(text)
      }
      editorRef.current?.focus()
    },
    append: text => editorRef.current?.append(text),
  }))

  // Rehydrate a draft carried in from the click that navigated here (#1139), launcher-only, else the
  // draft this box was left with before a navigation or a reload.
  //
  // Handed to the editor as `initialText` rather than pushed through the handle: the draft is taken
  // once and cleared, while `loadTemplate` silently does nothing until Tiptap has resolved
  // (`immediatelyRender: false`), so pushing it at mount dropped the draft and left an empty
  // composer. `prompt` then arrives the normal way, through the editor's own onChange.
  // On a phone a kept draft comes back without the caret, which would raise the keyboard; one a press handed over takes it.
  // A draft handed over to a box that kept one is loaded over it, as a saved prompt is: said, and one undo away.
  const [carriedDraft, setCarriedDraft] = useState<{ text: string; handedOver: boolean; over?: string } | undefined>(() => {
    const kept = draftKey !== undefined ? keptDraft(draftKey) : undefined
    return kept === undefined ? undefined : { text: kept, handedOver: false }
  })
  useEffect(() => {
    if (inAgent) return
    const carried = takePendingDraft()
    if (!carried) return
    const over = carriedDraft?.text !== carried ? carriedDraft?.text : undefined
    setCarriedDraft({ text: carried, handedOver: true, ...(over !== undefined ? { over } : {}) })
    if (over !== undefined) onLoaded?.('The prompt', true)
  }, [inAgent])
  const phone = useIsMobile()

  // A synchronous latch alongside the async `busy` prop (#948): two fast ⌘↵ presses both read
  // `busy === false` (React state lags), fired two starts, and the second surfaced a spurious
  // "already active" error. The ref flips before any await.
  const submittingRef = useRef(false)
  const submit = (e?: FormEvent, later = false) => {
    e?.preventDefault()
    const text = prompt.trim()
    if (!text || held || submittingRef.current) return
    submittingRef.current = true
    void Promise.resolve(onSubmit(text, { later })).finally(() => {
      submittingRef.current = false
    })
  }

  // The Commands button's load path (#948): through the imperative handle rather than the
  // suggestion plugin, then the same bookkeeping as the `/` menu.
  const loadFromMenu = (text: string, label: string) => {
    const replaced = editorRef.current?.loadTemplate(text) ?? false
    onLoaded?.(label, replaced)
  }

  const onPromptEdit = (value: string) => {
    setPrompt(value)
    if (draftKey !== undefined) keepDraft(draftKey, value)
    onPromptChange?.(value)
  }

  const editorEl = (
    <PromptEditor
      ref={editorRef}
      onChange={onPromptEdit}
      onSubmit={later => submit(undefined, later)}
      {...(onLoaded ? { onLoaded } : {})}
      {...(addContext ? { onMentionProject: addContext, onMentionFile: addContext } : {})}
      {...(removeContext ? { onMentionRemoved: removeContext } : {})}
      projects={projects}
      files={files}
      commands={readyCommands(commands)}
      prompts={prompts.list}
      // The `/` menu's "Save prompt…" opens the panel that saves what the box holds.
      {...(savePrompt ? { onSavePrompt: savePrompt } : {})}
      // A session's box takes what is typed next while a message goes: the message has left it.
      disabled={busy && !inAgent}
      {...(placeholder ? { placeholder } : {})}
      label={inAgent ? 'Message' : 'Prompt'}
      {...(carriedDraft ? { initialText: carriedDraft.text, initialFocus: carriedDraft.handedOver || !phone, replacedText: carriedDraft.over } : {})}
      autoFocus={autoFocus}
    />
  )

  // The agent/model select. Every value is preferences-backed and global: what it picks is what the
  // next start runs on, wherever that start is made.
  const driverModelEl = !inAgent && (
    <DriverModelMenu
      drivers={driverOptions(models).map(d => ({ ...d, ...DRIVER_UI[d.value as DriverName], ...accountsOf(d.value as DriverName) }))}
      driver={driver}
      model={model}
      onChange={(a, m) => updatePreferences({ driver: a, model: m })}
      // How hard that model may think, in the same menu: the levels are the model's own.
      effort={{ levels: modelEfforts(models, driver, model), level: preferences.effort || undefined, onChange: effort => updatePreferences({ effort: effort ?? '' }) }}
      busy={busy}
    />
  )
  // Commands and saved prompts get a visible surface (#948): load, save and delete in one menu,
  // instead of loading only behind typing `/`.
  const commandsEl = (
    <CommandsMenu
      commands={commands}
      prompts={prompts.list}
      busy={busy}
      onLoad={loadFromMenu}
      onNew={savePrompt}
      onDelete={prompt => void prompts.remove(prompt)}
    />
  )
  // Where the next run starts (#2394): this machine, or a host the project's modules bring.
  // Launcher-only: a session already runs where it was started. With no host there is nothing to pick.
  const runOnEl = inAgent || hosts.length === 0 ? null : (
    <RunOnMenu
      busy={busy}
      connection={{
        noProject,
        onSelectLocal: () => selectHost(null),
        hosts,
        selectedHostId,
        onSelectHost: (id: string) => selectHost(id),
      }}
    />
  )

  // The send is a single icon press, on a session's page and on the launcher alike, that only shows
  // once the box has text (#721): it grows in from the middle as it fades in, and its room opens
  // with it, by a negative margin (0 <- -w) rather than its width, so the text to its left gives way
  // smoothly; `aria-hidden` while empty keeps it out of the a11y tree. Its name and tooltip say what
  // it does ("Start agent" on the launcher).
  const hasPrompt = !!prompt.trim()
  const submitTip = busy ? submitBusyLabel : down ? 'OpenAgent is not answering' : `${submitLabel}  (Enter · Shift+Enter for a new line)`
  const submitButton = (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="submit"
            size="icon-sm"
            onClick={submit}
            disabled={held || !hasPrompt}
            aria-hidden={!hasPrompt}
            tabIndex={hasPrompt ? undefined : -1}
            aria-label={submitLabel}
            className={cn(
              // `disabled:opacity-*` overrides the base (the button is disabled while empty/busy), so the
              // hidden state must force it to 0 and the shown state back to full for the busy spinner.
              'relative shrink-0 transition-[margin,opacity,scale] duration-180 ease-out motion-reduce:transition-none max-md:after:absolute max-md:after:-inset-2',
              IN_BOX,
              hasPrompt
                ? // Full while busy, for its spinner; faded while something else holds the start (OpenAgent not answering).
                  cn('ml-0 scale-100 opacity-100', busy ? 'disabled:opacity-100' : 'disabled:opacity-40')
                // The hidden submit takes no room: its own width (1.75rem) back.
                : 'pointer-events-none -ml-7 scale-50 opacity-0 disabled:opacity-0',
            )}
          />
        }
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
      </TooltipTrigger>
      <TooltipContent>{submitTip}</TooltipContent>
    </Tooltip>
  )

  // One slot, three states (#1455): with an idleControl, the empty box shows it (Stop / Resume)
  // and typing swaps in the send arrow — instead of the launcher's collapse-to-nothing.
  const slotEl = !hasPrompt && idleControl ? idleControl : submitButton

  // Every note at once, stacked up from the prompt area; none moves the box or what is typed in it. A note
  // is a card, so it stands the step between two cards from the prompt area and from the next note: 12.
  const notesSlot = useContext(BoxNotes)
  const notesEl = (
    <div className="flex flex-col gap-3 pb-3 empty:hidden">
      {notes}
    </div>
  )

  return (
    <>
      <div className="relative">
        {/* Where the agent starts, above the box (his pick): the machine, the project and the branch,
            drawn as the row under the box draws its items. A session has its own words in the same place. */}
        {inAgent ? (
          sessionRow
        ) : (
          <RowAboveBox>
            {runOnEl}
            {startsAt}
          </RowAboveBox>
        )}

        {/* The box, as Claude Code's: the raised surface, the commands menu (+) at its left, the text,
            and the send at its right (the launcher's "Start agent"), the two kept at the last line. One
            line tall when empty, growing with what is typed. The editor is borderless: the edge is the box's.
            The two stand 5 from the box's edges on every side, their corners following its corner (IN_BOX);
            on a touch screen, where the text's line is 24 high, 7, so they sit on its middle. */}
        <div ref={surface} className={BOX}>
          <div className="-mr-2 flex shrink-0 items-center p-1 pointer-coarse:p-1.5 pointer-coarse:pr-1">{commandsEl}</div>
          <div className="min-w-0 flex-1">{editorEl}</div>
          <div className="flex shrink-0 items-center p-1 pointer-coarse:p-1.5 pointer-coarse:pl-1">{slotEl}</div>
        </div>

        {/* How it runs, under the box: the caller's controls at the left, the model at the right. The
            left side is the one that gives way: a longer label there never moves the model or the
            page below. */}
        <TooltipsPastBox value={surface}>
          <div className={cn('mt-1', rowClass)}>
            {/* In a narrow box, where its items say their icons only, each stays whole and the side scrolls, as the row above the box does. */}
            <div className={cn(rowLeftClass, '@max-xl:overflow-x-auto @max-xl:[scrollbar-width:none] @max-xl:[mask-image:linear-gradient(to_right,#000_85%,transparent)] @max-xl:*:shrink-0')}>
              {controls}
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              {controlsEnd}
              {driverModelEl ||
                // Only with something in it: an empty one would still take the row's gap, and the
                // row's last item would end off the row's end.
                ((sessionModel !== undefined || sessionContext) && (
                  <span className="flex items-center">
                    {sessionModel !== undefined && <span className={rowItemClass}>{sessionModel}</span>}
                    {sessionContext}
                  </span>
                ))}
            </div>
          </div>
        </TooltipsPastBox>
        {/* Last, so the box is the first thing drawn; laid over the page above the prompt area all the same. */}
        {notesSlot ? createPortal(notesEl, notesSlot) : <div className="absolute inset-x-0 bottom-full">{notesEl}</div>}
      </div>

      {savingPrompt && prompts.saver && activeProjectId !== null && (
        <ModuleSlot package={prompts.saver.package} label="Save prompt dialog">
          <prompts.saver.View
            projectId={activeProjectId}
            text={prompt}
            onDone={saved => {
              setSavingPrompt(false)
              if (saved) prompts.reload()
              editorRef.current?.focus()
            }}
          />
        </ModuleSlot>
      )}
    </>
  )
})
