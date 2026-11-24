import { SESSIONS_ID } from '../../src/project-address.js'
import type { GitHostHome } from '../../src/index.js'
import { useContext, useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '../lib/utils.js'
import { IN_BOX } from '../lib/in-box.js'
import { Composer, type ComposerHandle, type SessionModel } from './Composer.js'
import { sendMessage } from '../rpc/control.js'
import { useAction } from '../lib/use-action.js'
import { useStop } from '../lib/use-stop.js'
import { keepDraft, keepDraftImages, keptDraft, keptDraftImages } from '../lib/draft-handoff.js'
import { DaemonDown } from '../lib/use-daemon-health.js'
import { Button } from './ui/button.js'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip.js'
import { SessionContextMenu } from './ContextMenu.js'
import { SessionReposSaid } from './SessionRepos.js'
import { AutoMenu, autoCovers, autoSaid, useAutoLevels } from './AutoMenu.js'
import { GitHostOff } from './GitHosts.js'
import { isPublishPick, type PublishPick } from '../../src/client.js'
import { useProjectLauncher } from '../lib/use-project-launcher.js'
import { promptWithContext, type ContextSet } from '../lib/use-context-set.js'
import { overlayOpen, pressed, shortcut } from '../lib/shortcut.js'
import { useIsMobile } from '../lib/use-mobile.js'
import type { RunOptions } from '@openagt/hooks'
import type { ControlBox } from './Places.js'

/** How long after an Esc that closed something a second Esc is still that press, said twice: a double press. */
const DOUBLE_PRESS_MS = 500

/** A message sent to a working agent that it has not read yet: shown waiting until it lands. */
export interface QueuedMessage {
  id: string
  text: string
  /** Sent with ⌘Enter: the agent reads it when its turn ends, not at its next step. */
  later: boolean
  /** The images it goes with, by the names the dashboard kept them under. */
  images?: string[] | undefined
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
  asked = false,
  files,
  onAgentStarted,
  onSending,
  onQueued,
  editInBox,
  giveBack,
  focusBox,
  model,
  context,
  contextSet,
  publish,
  prBase,
  row,
  repos,
  gitHost,
  gitAccount,
  options,
}: {
  projectId: string
  /** Which run this addresses (#749). */
  agentId: string
  /** Whether the agent is still running: what a send does is the same call, the note differs. */
  live: boolean
  /** It ended on a question its card asks: a message is the answer, in the person's own words. */
  asked?: boolean
  files: string[]
  /** An ended run was continued: the shell follows the same run as it goes live again. */
  onAgentStarted?: ((intent: string, agentId: string) => void) | undefined
  /** A message is on its way to an ended run, with its images (`null`: it did not go through), so the feed shows it at once. */
  onSending?: ((text: string | null, images?: string[]) => void) | undefined
  /** A message went into a working run's inbox: until the agent reads it, the feed shows it
   *  waiting, or the send would look like nothing happened (#948). */
  onQueued?: ((message: QueuedMessage) => void) | undefined
  /** Set here to what puts a text and its images in the box to edit: Cancel and edit on a waiting message. */
  editInBox?: MutableRefObject<((text: string, images?: string[]) => void) | null> | undefined
  /** Set here to what hands the box back what the run ended without reading, with its images, after any draft, and says it was not sent. */
  giveBack?: MutableRefObject<((text: string, images?: string[]) => void) | null> | undefined
  /** Set here to what gives the box the focus: a question answered from its card. */
  focusBox?: MutableRefObject<(() => void) | null> | undefined
  /** The model the session runs on: said under the box, at the right. */
  model?: SessionModel | undefined
  /** How full the session's context is, as a circle beside the model. */
  context?: ReactNode
  /** The shell's Context (#492), as the launcher's box has it (his pick): what is picked goes with the next message, said at its end, and is cleared once it went. */
  contextSet?: ContextSet | undefined
  /** How far the run takes its work, as its record says (`commit`, `branch`, `pr`, `merge`); absent, none. The "Auto" menu shows it and changes it from the next message on. */
  publish?: string | undefined
  /** The branch the run's pull request goes into, as its record says; absent, the repository's default branch. */
  prBase?: string | undefined
  /** The row above the box: where the session started. */
  row?: ReactNode
  /** The repos the session has as copies, as its record says. */
  repos?: readonly { name: string; from: string }[] | undefined
  /** The project's page on its git host, when it has one. */
  gitHost?: GitHostHome | null | undefined
  /** The account the run worked as there, as its record says. */
  gitAccount?: string | undefined
  /** The session's run options, as its record keeps them: what its box's controls say (`composer.control`). */
  options?: RunOptions | undefined
}) {
  const composerRef = useRef<ComposerHandle>(null)
  useEffect(() => {
    if (!editInBox) return
    editInBox.current = (text, images = []) => {
      composerRef.current?.edit(text)
      composerRef.current?.restore({ text: undefined, images })
    }
    return () => {
      editInBox.current = null
    }
  }, [editInBox])
  // Messages handed back unsent: said above the box until the next send, or another session.
  const [notSent, setNotSent] = useState(false)
  useEffect(() => setNotSent(false), [agentId])
  useEffect(() => {
    if (!giveBack) return
    giveBack.current = (text, images = []) => {
      composerRef.current?.append(text)
      composerRef.current?.restore({ text: undefined, images })
      setNotSent(true)
    }
    return () => {
      giveBack.current = null
    }
  }, [giveBack])
  useEffect(() => {
    if (!focusBox) return
    focusBox.current = () => composerRef.current?.focus()
    return () => {
      focusBox.current = null
    }
  }, [focusBox])
  const phone = useIsMobile()
  // A touch screen has no keys to name: its pointer is a finger. A phone's box has no room for them either.
  const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
  const { busy, error, run } = useAction(agentId)
  // The slot's Stop (#1455), its own press so a message send's busy beat cannot read as
  // "stopping", and the session menu's Stop the same press: one per run (`use-stop.ts`).
  const { stopping, error: stopError, stop: stopSession } = useStop(projectId, agentId, live)
  // OpenAgent is not answering: Stop cannot reach the agent, by the button or by Esc.
  const down = useContext(DaemonDown)
  // The "Auto" menu, as the launcher's (his pick): how far the run takes its work. A pick goes with
  // the next message and holds from it on. Sent to a working run, it shows until the run's record
  // says it, which is when its turn ends and it takes the message. Sent to an ended run, the menu
  // goes back to what the record says at once: a resume that fails before its run records the new
  // level keeps the old one, which must not read as changed.
  // Picked back to what the record says, there is nothing to send.
  const launcher = useProjectLauncher(projectId)
  // The levels offered, as the launcher's: every one with no project, the session's copies of repos being wherever each is.
  const autoProject = projectId !== SESSIONS_ID && launcher ? { id: projectId, name: projectId, ...(launcher.remote ? { remote: launcher.address ?? 'origin' } : {}) } : undefined
  const levels = useAutoLevels(projectId, autoProject, projectId === SESSIONS_ID || (launcher?.gitHost ?? true))
  const recorded: PublishPick = isPublishPick(publish) ? publish : 'nothing'
  const [picked, setPicked] = useState<PublishPick | null>(null)
  useEffect(() => setPicked(null), [agentId])
  // The session's controls, as its record keeps their options: said, not offered.
  const controlBox: ControlBox = { in: 'session', projectId, agentId, options: options ?? {}, onChange: () => {}, busy }
  useEffect(() => {
    if (picked === recorded) setPicked(null)
  }, [picked, recorded])
  // The session shown now: a send's answer, back after another was picked, leaves that one's box and menus alone.
  const shown = useRef(agentId)
  shown.current = agentId
  /** Say `text` to the run with `images`, `later` for after its turn. Resolves whether it went through; a refusal's words are shown. */
  const say = async (text: string, later: boolean, images: string[]): Promise<boolean> => {
    const wasLive = live
    // An ended run's continuation takes seconds to write its first line; the message shows now.
    if (!wasLive) {
      if (images.length > 0) onSending?.(text, images)
      else onSending?.(text)
    }
    const id = crypto.randomUUID()
    const withImages = images.length > 0 ? { images } : {}
    // To an ended run, the level goes only when one was picked, and how it is sent only with images.
    const send = () => {
      if (wasLive) return sendMessage(projectId, text, agentId, picked, { id, ...(later ? { later } : {}), ...withImages })
      if (images.length > 0) return sendMessage(projectId, text, agentId, picked, withImages)
      return picked !== null ? sendMessage(projectId, text, agentId, picked) : sendMessage(projectId, text, agentId)
    }
    const outcome = await run(
      send,
      'Could not send. Your text is kept, try again.',
    )
    if (!outcome.ok) {
      if (!wasLive) onSending?.(null)
      return false
    }
    if (!wasLive && shown.current === agentId) setPicked(null)
    if (wasLive) onQueued?.({ id, text, later, ...withImages })
    // An ended run goes live again under the same id: tell the shell, which keeps its feed (#762).
    else onAgentStarted?.(text, agentId)
    return true
  }

  const send = async (text: string, { later, images }: { later: boolean; images: string[] }): Promise<void> => {
    // The box is emptied as the message goes, so what is typed meanwhile stays; a message refused comes back to it
    // as the same draft: its chips, and the Context it went with.
    const sent = contextSet?.context
    const draft = composerRef.current?.clear()
    // The Context goes with the message, out of the set as the box empties: what is picked while it goes, a path it
    // went with picked again included, is the next message's, and its landing leaves the set alone.
    for (const path of sent ?? []) contextSet?.remove(path)
    // The box takes the next message at once, after a click on Send too; the answer leaves its focus and caret alone.
    composerRef.current?.focus()
    const message = sent ? promptWithContext(text, sent) : text
    const went = await say(message, later, images)
    const box = shown.current === agentId ? composerRef.current : null
    if (box) {
      if (went) setNotSent(false)
      else {
        if (draft) box.restore(draft)
        for (const path of sent ?? []) contextSet?.add(path)
      }
    } else if (!went) {
      // The page is closed or shows another session by now: the message goes back as it went, its Context line included, to the
      // draft of the session it was written in, after what that holds, as its append puts them.
      const draftKey = `${projectId}:${agentId}`
      const kept = keptDraft(draftKey)
      keepDraft(draftKey, kept === undefined ? message : `${kept}\n\n${message}`)
      keepDraftImages(draftKey, [...images, ...keptDraftImages(draftKey)])
    }
  }

  // Esc stops the agent, as in Claude Code, also typed in the box, unless it closes something open
  // first: a menu, a dialog, the box's own suggestions. Read before anything on the page takes the
  // key, while what it closes still reads open. An Esc straight after the one that closed something
  // is the same press to a person, and a key held down is no press: neither stops the agent.
  const closedAt = useRef(-Infinity)
  useEffect(() => {
    if (!live) return
    const onKey = (event: KeyboardEvent) => {
      if (!pressed(event, 'stop')) return
      if (overlayOpen() || document.querySelector('.ProseMirror[aria-expanded="true"]')) return void (closedAt.current = Date.now())
      if (event.repeat || Date.now() - closedAt.current < DOUBLE_PRESS_MS || stopping || down) return
      stopSession()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  // The empty box's slot control while the agent works: Stop, a quiet press with a small solid square,
  // its fill only under the pointer, its corner following the box's (IN_BOX).
  const idleControl = live ? (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={stopSession}
            loading={stopping}
            disabled={down}
            aria-label="Stop agent"
            // Stopping draws its spinner in full; off while OpenAgent is not answering, Stop is dimmed as any button off.
            className={cn('shrink-0 text-foreground', IN_BOX, stopping && 'opacity-100')}
          />
        }
      >
        {stopping ? <Loader2 className="h-4 w-4 animate-spin" /> : <span aria-hidden className="size-[11px] rounded-[3px] bg-current" />}
      </TooltipTrigger>
      <TooltipContent className="flex items-center gap-1.5">
        {stopping ? (
          'Stopping…'
        ) : (
          <>
            Stop
            <kbd className="flex h-5 items-center justify-center rounded-sm border border-hairline px-1 font-sans text-xs">Esc</kbd>
          </>
        )}
      </TooltipContent>
    </Tooltip>
  ) : undefined

  const surfacedError = error ?? stopError

  // What the gear's hover says of the session's setup with its menu shut.
  const noProject = projectId === SESSIONS_ID
  // What a level acts on: the project, or with none the session's copies of repos.
  const publishes = !noProject || (repos?.length ?? 0) > 0
  const autoTarget = prBase !== undefined ? { into: prBase } : undefined
  const setupSaid = [
    gitAccount !== undefined && `@${gitAccount}`,
    publishes && autoSaid(picked ?? recorded, levels, autoTarget),
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    // The box stands on the chat's 16 inset at every width, as the chat's cards do, so on a desktop its
    // words, 16 inside it, stand on the chat's column (32 in, EventList).
    <div className="@container mx-auto w-full max-w-3xl px-4 pt-2 pb-4">
      <Composer
        // A box of its own per session, with the draft it was left with.
        key={agentId}
        ref={composerRef}
        draftKey={`${projectId}:${agentId}`}
        // A session opened takes what is typed next, as the launcher does; not on a phone, where the keyboard would rise over the chat.
        autoFocus={!phone}
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
        // The launcher's gear, line for line in its places: the modules' lines, as the session's record
        // keeps its options; the account the run worked as; then, set apart and still a pick, "When it finishes". After the
        // gear, Context: the repos the session started with, said, and in a project the files picked for the next message; for a session with no project,
        // no git to take its work further with.
        controlBox={controlBox}
        setup={{
          said: setupSaid,
          lines: (
            <>
              <GitHostOff home={gitHost ?? null} account={gitAccount} />
              {publishes && <AutoMenu publish={picked ?? recorded} levels={levels} onPublish={pick => setPicked(pick === recorded ? null : pick)} covers={autoCovers(noProject ? null : 'the project', repos?.length ?? 0)} target={autoTarget} />}
            </>
          ),
        }}
        controls={noProject ? <SessionReposSaid repos={repos ?? []} /> : contextSet && <SessionContextMenu repos={repos ?? []} context={contextSet.context} busy={busy} onToggle={contextSet.toggle} />}
        idleControl={idleControl}
        notes={
          <>
            {surfacedError && <p role="alert" className="rounded-md bg-background px-2 py-0.5 text-xs text-danger">{surfacedError}</p>}
            {notSent && <p role="status" className="rounded-md bg-background px-2 py-0.5 text-xs text-muted-foreground">Not sent: the session stopped first.</p>}
          </>
        }
        // What the box can do, not what it is for: the keys for a working agent, as Claude Code's box
        // says them in the same place; a touch screen has none to name.
        placeholder={down ? 'OpenAgent is not answering' : live ? (touch || phone ? 'Message the agent…' : `Enter to send, ${shortcut('Enter')} to queue for later`) : asked ? 'Or answer in your own words…' : 'Message the agent to continue it…'}
      />
    </div>
  )
}
