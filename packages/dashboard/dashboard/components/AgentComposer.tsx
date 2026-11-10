import { SESSIONS_ID } from '../../src/project-address.js'
import type { GitHostHome } from '../../src/index.js'
import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import { Loader2, Square } from 'lucide-react'
import { Composer, type ComposerHandle } from './Composer.js'
import { sendMessage, sendStop } from '../rpc/control.js'
import { useAction } from '../lib/use-action.js'
import { Button } from './ui/button.js'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip.js'
import { ProjectContextMenu } from './ContextMenu.js'
import { AutoMenu } from './AutoMenu.js'
import { AgentOff } from './AgentMenu.js'
import { GitHostOff } from './GitHosts.js'
import { SkillsOff } from './SkillsMenu.js'
import { isPublishPick, offeredPublishPicks, type PublishPick } from '../../src/client.js'
import { useProjectLauncher } from '../lib/use-project-launcher.js'
import { promptWithContext, type ContextSet } from '../lib/use-context-set.js'

/** A message sent to a working agent that it has not read yet: shown waiting until it lands. */
export interface QueuedMessage {
  id: string
  text: string
  /** Sent with ⌘Enter: the agent reads it when its turn ends, not at its next step. */
  later: boolean
}

// One composer for a session, live or finished (#1026). Above the box is only where the session
// started (SessionRow): how the agent ended, that it works, a message that waits and subagents that
// still work are all said by the chat, and a question by its panel.
//
// A send is always the same call, `sendMessage`: the person's words, the next prompt of the same
// conversation (#1774). What happens to them is the daemon's side of it: a run that is working
// reads them at its next step (Enter) or when its turn ends (⌘Enter), as Claude Code's chat does,
// and an ended run is continued with them through the project's resume hook — the same run, the
// same row, the same branch. The composer never remounts when the agent ends, so a half-typed
// message survives it.
//
// The empty box's submit slot is Stop while the agent is live, Esc its key, as in Claude Code: the
// agent ends its turn where it is, and a message continues it. Typing swaps the slot back to the
// send ↑.
export function AgentComposer({
  projectId,
  agentId,
  live,
  files,
  onAgentStarted,
  onSending,
  onQueued,
  editInBox,
  model,
  context,
  controls,
  contextSet,
  publish,
  prBase,
  row,
  agent,
  gitHost,
  gitAccount,
  skillsOn,
  skillsOff,
  projectSkills,
}: {
  projectId: string
  /** Which run this addresses (#749). */
  agentId: string
  /** Whether the agent is still running: what a send does is the same call, the note differs. */
  live: boolean
  files: string[]
  /** An ended run was continued: the shell follows the same run as it goes live again. */
  onAgentStarted?: ((intent: string, agentId: string) => void) | undefined
  /** A message is on its way to an ended run (`null`: it did not go through), so the feed shows it at once. */
  onSending?: ((text: string | null) => void) | undefined
  /** A message went into a working run's inbox: until the agent reads it, the feed shows it
   *  waiting, or the send would look like nothing happened (#948). */
  onQueued?: ((message: QueuedMessage) => void) | undefined
  /** Set here to what puts a text in the box to edit: Cancel and edit on a waiting message. */
  editInBox?: MutableRefObject<((text: string) => void) | null> | undefined
  /** The model the session runs on, by its name: said under the box. */
  model?: string | undefined
  /** How full the session's context is, as a circle beside the model. */
  context?: ReactNode
  /** What stands at the left of the row under the box after the launcher's items: the run's pull requests. */
  controls?: ReactNode
  /** The shell's Context (#492), as the launcher's box has it (his pick): what is picked goes with the next message, said at its end, and is cleared once it went. */
  contextSet?: ContextSet | undefined
  /** How far the run takes its work, as its record says (`commit`, `branch`, `pr`, `merge`); absent, none. The "Auto" menu shows it and changes it from the next message on. */
  publish?: string | undefined
  /** The branch the run's pull request goes into, as its record says; absent, the repository's default branch. */
  prBase?: string | undefined
  /** The row above the box: where the session started. */
  row?: ReactNode
  /** The agent the session is on, by its id, as its record says; the default agent when absent. */
  agent?: string | undefined
  /** The project's page on its git host, when it has one. */
  gitHost?: GitHostHome | null | undefined
  /** The account the run worked as there, as its record says. */
  gitAccount?: string | undefined
  /** The session's picks of skills, as its record says: on top of its agent's, left out of its agent's, which of the project's own stayed. */
  skillsOn?: string[] | undefined
  skillsOff?: string[] | undefined
  projectSkills?: 'none' | string[] | undefined
}) {
  const composerRef = useRef<ComposerHandle>(null)
  useEffect(() => {
    if (!editInBox) return
    editInBox.current = text => composerRef.current?.edit(text)
    return () => {
      editInBox.current = null
    }
  }, [editInBox])
  const { busy, error, run } = useAction()
  // The slot's Stop (#1455), its own action so a message send's busy beat cannot read as
  // "stopping". A landed Stop stays "Stopping…" until the end event flips `live`, so it cannot
  // be re-fired. Released the moment `live` drops, not only on an agent switch: a message continues
  // the SAME agent (#762), so a latch keyed to the agent id alone re-engaged on the continued
  // session and froze its Stop as a disabled spinner.
  const { busy: stopBusy, error: stopError, run: runStop } = useAction()
  const [stopRequested, setStopRequested] = useState(false)
  useEffect(() => setStopRequested(false), [agentId])
  useEffect(() => {
    if (!live) setStopRequested(false)
  }, [live])
  const stopping = stopBusy || (stopRequested && live)
  // The "Auto" menu, as the launcher's (his pick): how far the run takes its work. A pick goes with
  // the next message and holds from it on. Sent to a working run, it shows until the run's record
  // says it, which is when its turn ends and it takes the message. Sent to an ended run, the menu
  // goes back to what the record says at once: the project's resume line is what hands the level
  // on, and one written before it did keeps the old level, which must not read as changed.
  // Picked back to what the record says, there is nothing to send.
  const launcher = useProjectLauncher(projectId)
  const recorded: PublishPick = isPublishPick(publish) ? publish : 'nothing'
  const [picked, setPicked] = useState<PublishPick | null>(null)
  useEffect(() => setPicked(null), [agentId])
  useEffect(() => {
    if (picked === recorded) setPicked(null)
  }, [picked, recorded])
  /** Say `text` to the run, `later` for after its turn. Resolves whether it went through; a refusal's words are shown. */
  const say = async (text: string, later: boolean): Promise<boolean> => {
    const wasLive = live
    // An ended run's continuation takes seconds to write its first line; the message shows now.
    if (!wasLive) onSending?.(text)
    const id = crypto.randomUUID()
    const outcome = await run(
      () => (wasLive ? sendMessage(projectId, text, agentId, picked, { id, ...(later ? { later } : {}) }) : sendMessage(projectId, text, agentId, ...(picked !== null ? [picked] : []))),
      'Could not send. Your text is kept, try again.',
    )
    if (!outcome.ok) {
      if (!wasLive) onSending?.(null)
      return false
    }
    if (!wasLive) setPicked(null)
    if (wasLive) onQueued?.({ id, text, later })
    // An ended run goes live again under the same id: tell the shell, which keeps its feed (#762).
    else onAgentStarted?.(text, agentId)
    return true
  }

  const send = async (text: string, { later }: { later: boolean } = { later: false }): Promise<void> => {
    if (busy) return
    if (await say(contextSet ? promptWithContext(text, contextSet.context) : text, later)) {
      composerRef.current?.clear()
      contextSet?.reset()
    }
    composerRef.current?.focus()
  }

  const stopSession = () =>
    void runStop(() => sendStop(projectId, agentId).then(() => true), 'Could not stop the agent.').then(result => {
      if (result) setStopRequested(true)
    })

  // Esc stops the agent, as in Claude Code, also typed in the box, unless it closes something open
  // first: a menu, a dialog, the box's own suggestions. Read before anything on the page takes the
  // key, while what it closes still reads open.
  useEffect(() => {
    if (!live) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || stopping || document.querySelector('[role="dialog"], [role="menu"], [role="listbox"], .ProseMirror[aria-expanded="true"]')) return
      stopSession()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  // The empty box's slot control while the agent works: Stop, as Claude Code's, a square and no button around it.
  const idleControl = live ? (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={stopSession}
            disabled={stopping}
            aria-label="Stop agent"
            className="h-8 w-8 shrink-0 disabled:opacity-100"
          />
        }
      >
        {stopping ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-3.5 w-3.5 rounded-[3px] fill-current" />}
      </TooltipTrigger>
      <TooltipContent className="flex items-center gap-1.5">
        {stopping ? (
          'Stopping…'
        ) : (
          <>
            Stop
            <kbd className="flex h-[17px] items-center justify-center rounded border border-background/20 px-1 font-sans text-[11px]">Esc</kbd>
          </>
        )}
      </TooltipContent>
    </Tooltip>
  ) : undefined

  const surfacedError = error ?? stopError

  return (
    <div className="mx-auto w-full max-w-3xl p-2">
      {surfacedError && <p role="alert" className="mb-1 px-2 text-xs text-danger">{surfacedError}</p>}
      <Composer
        ref={composerRef}
        files={files}
        onSubmit={send}
        busy={busy}
        submitLabel="Send"
        submitBusyLabel={live ? 'Sending…' : 'Continuing…'}
        inAgent
        sessionRow={row}
        sessionModel={model}
        sessionContext={context}
        {...(contextSet ? { addContext: contextSet.add, removeContext: contextSet.remove } : {})}
        // The launcher's row under the box, item for item in its places: the agent, off, since a session
        // keeps the one it started on; "Skills", off, the picks it started with in its hover; the Context
        // picker; the run's own pull requests after them; and at the right, before the model, the account
        // the run worked as, off, then the "Auto" menu. A session with no project has no project to take
        // Context from and no git to take its work further with.
        controls={
          <>
            <AgentOff agent={agent} />
            <SkillsOff skillsOn={skillsOn} skillsOff={skillsOff} projectSkills={projectSkills} noProject={projectId === SESSIONS_ID} />
            {projectId !== SESSIONS_ID && contextSet && <ProjectContextMenu projectId={projectId} context={contextSet.context} busy={busy} onToggle={contextSet.toggle} />}
            {controls}
          </>
        }
        controlsEnd={
          <>
            <GitHostOff home={gitHost ?? null} account={gitAccount} />
            {projectId !== SESSIONS_ID && (
              <AutoMenu
                publish={picked ?? recorded}
                picks={offeredPublishPicks(launcher?.gitHost ?? true, launcher?.remote ?? true)}
                onPublish={pick => setPicked(pick === recorded ? null : pick)}
                target={prBase !== undefined ? { into: prBase } : undefined}
                busy={busy}
              />
            )}
          </>
        }
        idleControl={idleControl}
        // What the box can do, not what it is for: the keys for a working agent, as Claude Code's box
        // says them in the same place.
        placeholder={live ? '⏎ to send, ⌘⏎ to queue for later' : 'Message the agent to continue it…'}
      />
    </div>
  )
}
