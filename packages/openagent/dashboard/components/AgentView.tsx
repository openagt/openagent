import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentMeta, AgentWorktree, OpenAgentEvent } from '../../src/index.js'
import { onAgent, onAgentsDoing, onRetainedWorktrees } from '../rpc/reads.js'
import { useLoaded, usePolled } from '../lib/use-async.js'
import { useAgentHandoff } from '../lib/use-agent-handoff.js'
import { useCheckoutStatus } from '../lib/use-checkout-status.js'
import { isAgentActive, agentOutcome, cardOutcome, pendingChoices } from '../lib/live-state.js'
import { AgentActionBar } from './AgentActionBar.js'
import { AgentComposer } from './AgentComposer.js'
import { AgentWorkBar } from './AgentWorkBar.js'
import { AgentFeed } from './AgentFeed.js'
import { ActionsRunNotice } from './ActionsRunNotice.js'
import { CloudMirrorRow, CloudAgentNotice } from './CloudAgentNotice.js'
import { RemoteAgentNotice } from './RemoteAgentNotice.js'
import { ModuleSlot } from './ModulePageView.js'
import { useMountedModules } from '../lib/use-modules.js'
import { Committing, HandoffActions, HandoffSummary, handoffSays, isCommitAsk } from './AgentHandoff.js'
import { AgentDetails, type AgentDetailsCard } from './AgentDetails.js'
import { QuestionPanel } from './QuestionPanel.js'
import { SubagentsBar } from './SubagentLine.js'
import { holdsMainAgent } from '../lib/subagents.js'
import { agentLogKey } from '../lib/agent-log.js'
import { revealChange } from '../lib/reveal-change.js'
import { sidePanelName } from '../lib/side-panel.js'
import { modelName, useModels } from '../lib/models.js'
import { driverFromImpl } from '../../src/client.js'

// One session's view, whether it is running or finished (#1026).
//
// This used to be two components — AgentLive and AgentReplay — and the page swapped one for the other
// the instant an agent's status flipped. Everything remounted at once: the action bar blanked while
// its git read went out again, the output was replaced by "Loading session…" while the archived
// log was fetched, the agent overview disappeared, and the composer was rebuilt. A session ending is
// the moment you are most likely to be reading it, and the whole page flinched.
//
// So the frame is stable and only its contents change: the same bar, feed and composer stay
// mounted, and `live` decides what they say. The log is the same log — while the agent is live it
// arrives over the channel, and once it ends the archived copy is read and swapped in behind the
// events already on screen.
/** How long the bar waits for the run's own reads before it shows the facts that are in. */
const READY_WAIT_MS = 1_000
/** How long a queued message stays shown once the agent no longer works: its next turn, which reads it, starts well within this. */
const QUEUED_UNREAD_MS = 5_000

/** How often what the working subagents are doing is read: the runs poll's own pace. */
const DOING_EVERY_MS = 2_000
const NO_SUBAGENTS: readonly AgentMeta[] = []
const NOTHING_DOING: Record<string, string> = {}

export function AgentView({
  projectId,
  agentId: agentId,
  events,
  live,
  card,
  label,
  projectName,
  target,
  remoteLabel,
  files,
  lost = false,
  writing = '',
  startedWith,
  onAgentStarted,
  onDeleted,
  subagents = NO_SUBAGENTS,
  onOpenAgent,
}: {
  projectId: string
  /** Which run this is (#749); absent right after Start, before the poll adopts its id. */
  agentId: string
  /** The live channel's events for this agent — all there is while it runs. */
  events: OpenAgentEvent[]
  /** Whether the agent is still running; `null` while the daemon's list of agents has not been read, so it is not known yet. */
  live: boolean | null
  /** What the run's card says, off the runs poll: what the feed cannot carry (the details strip's facts, how the agent was set up, whether it is a subagent, whether its record is being saved). Absent until the card is listed. */
  card?: (AgentDetailsCard & Pick<AgentMeta, 'status' | 'saving' | 'parent' | 'workspace' | 'branch' | 'base'>) | undefined
  /** The session's own name — the same label the rail shows (#1030). It leads the action bar as
   * the stable identity, so the branch renaming itself near the end of an agent (#736) reads as a
   * detail changing rather than the whole view changing. */
  label?: string | undefined
  /** The session's project, said in the chip beside the session's name in the top bar. */
  projectName?: string | null | undefined
  /** Where the agent executes (#1053/#610): `actions` swaps the live feed for a burst-mode affordance; `remote` is relayed to a machine (#1067); `web` is handed to a Claude Code cloud session. */
  target?: 'local' | 'actions' | 'remote' | 'web' | undefined
  /** The machine this agent executes on (#1067), when it is relayed to another one. Set only for a
   *  just-started remote run: its diff, handoff, and push/PR now relay to the machine (slice 2), so the
   *  panels are shown, and a "runs on <machine>" notice only flags that the browser preview stays local. */
  remoteLabel?: string | undefined
  files: string[]
  /** The live channel's health (#948) — surfaced as a banner over the feed. */
  lost?: boolean
  /** The message the agent is writing, as far as it has got: shown after the feed while it runs. */
  writing?: string
  /** The prompt this page just started the agent with: shown until the agent's own prompt line arrives. */
  startedWith?: string | undefined
  /** Jump to the agent a preset or a continuation started (#959). */
  onAgentStarted?: ((intent: string, agentId: string) => void) | undefined
  /** Leave this session after it is deleted (#1032) — back to the project home. */
  onDeleted?: (() => void) | undefined
  /** The runs started for this run, oldest first: rows in its chat, and a line above the message box while any works. */
  subagents?: readonly AgentMeta[]
  /** Open another run of this project: what a subagent's row does on a click. */
  onOpenAgent?: ((agentId: string) => void) | undefined
  /** The loop's verdict, handed up so the right rail can pin it under its tabs. It is reported from
   *  here rather than read in the shell because a finished agent's log is archived, and this view is
   *  the one that reads it back. */
}) {
  // The archived log, read only once the agent has ended: while it runs, the channel is the truth.
  // `archiveBehind` re-reads it whenever the live channel has outgrown the copy on screen (#1460):
  // a resumed session streams new events while `live` is still false for a poll round-trip, and a
  // line written as a clean run is recorded only ever lands in the archive — its worktree journal is
  // torn down with the worktree — so without this the PR line waited for a manual refresh.
  const [archiveBehind, setArchiveBehind] = useState(0)
  const archived = useLoaded<OpenAgentEvent[] | null>(
    live === false ? () => onAgent(projectId, agentId) : null,
    null,
    [projectId, agentId, live, archiveBehind],
    // Going back to an ended run shows its log at once, as last read, while it is read again.
    { remember: agentLogKey(projectId, agentId) },
  )
  // What each working subagent is doing now, read only while one works: an ended one's row says how it ended.
  const workingSubagents = subagents.filter(agent => agent.status === 'running').map(agent => agent.id).join(',')
  // How many subagents the run's job still waits on: while any, the run is not over, whatever its own turn says.
  const now = Date.now()
  const subagentsRunning = subagents.filter(agent => holdsMainAgent(agent, now)).length
  const { value: doing } = usePolled<Record<string, string>>(
    workingSubagents ? () => onAgentsDoing(projectId, workingSubagents.split(',')) : null,
    NOTHING_DOING,
    DOING_EVERY_MS,
    [projectId, workingSubagents],
    'previous',
  )
  // Whether this agent kept its worktree (#737): a failed/stopped run does, a clean one had it
  // removed when it finished. Drives the Remove button, and is cleared locally once removed so
  // the button goes without waiting for a refetch.
  const retained = useLoaded<string[]>(live === false ? () => onRetainedWorktrees(projectId) : null, [], [projectId, agentId, live], { remember: `retained:${projectId}` })
  const [removed, setRemoved] = useState(false)
  const onWorktreeRemoved = useCallback(() => setRemoved(true), [])
  // The view is mounted un-keyed, so switching agents only swaps props: per-agent latches must
  // reset by hand or the previous agent's Remove press hides this one's offer (and a stale
  // archiveBehind can swallow the catch-up re-read on an equal-length collision).
  useEffect(() => {
    setRemoved(false)
    setArchiveBehind(0)
  }, [agentId])
  const hasWorktree = live === false && !removed && retained.includes(agentId)

  // Whether the agent is still working. A run that stops on a question ends `waiting` rather than
  // staying up, so a live run is a working one. One not known yet is neither working nor ended:
  // nothing is read for it and the bar waits.
  const working = live === true

  // A run started for another run: it opens no pull request, its main agent lands its work.
  const subagent = card?.parent !== undefined
  // What was set up for the agent before it began, off its card: the chat's "Session set up" line.
  const { workspace, branch, base, driver, model } = card ?? {}
  // An agent just started on a machine has no card listed yet: the machine's name says where it runs.
  const elsewhere = (target !== undefined && target !== 'local') || remoteLabel !== undefined
  const setup = useMemo(() => ({ workspace, branch, base, driver, model, elsewhere }), [workspace, branch, base, driver, model, elsewhere])
  // The model by the name its coding agent gives it, for the row under the message box.
  const picked = driverFromImpl(driver)
  const models = useModels()
  const modelLabel = model ? modelName(picked ? models?.[picked] : undefined, model) : undefined
  // Where the agent runs, for the chip beside its name: a machine by the name it was given.
  const runsOn = remoteLabel ?? (target === 'web' ? 'Cloud' : target === 'actions' ? 'GitHub Actions' : target === 'remote' ? 'Another machine' : 'This machine')
  const [open, setOpen] = useState(false)
  // What the installed modules add to this run's page: a summary in the bar above the message box.
  const { runSlots: mountedSlots, panels: mountedPanels } = useMountedModules()
  // A changed file's row in the chat opens the side panel on the tab that lists changes, when a
  // module of this project has one.
  const listsChanges = mountedPanels.some(panel => panel.changes && panel.projects.includes(projectId))
  const onOpenChange = useMemo(() => (listsChanges ? (path: string) => revealChange(sidePanelName(projectId, agentId), path) : undefined), [listsChanges, projectId, agentId])
  const runSlots = mountedSlots.filter(slots => slots.projects.includes(projectId))
  const toggle = useCallback(() => setOpen(o => !o), [])

  // The events already on screen keep their place while the archived copy is read, so an agent
  // ending swaps the source without blanking the output. An EMPTY archive never replaces them
  // either (#1383): `onAgent` answers `[]` both for "gone" and for "not archived yet", and a Stop
  // races the archive write — swapping the live feed for that `[]` blanked the view to "This
  // session has no events." until a manual refresh.
  //
  // A STALE archive never wins either (#1460): on Resume the channel streams the new leg while
  // `live` waits on the 2s runs poll, and serving the frozen archive for that window is what made
  // the whole continuation land in one jolting commit — or, when the poll lost the race entirely,
  // not render at all until a refresh. The channel is preferred the moment it knows more; the
  // archive is re-read behind it (`archiveBehind` above) and takes back over once it has caught
  // up, which is also how the epilogue's archive-only events reach the screen.
  //
  // "Knows more" is only trustworthy when the channel is this agent's OWN journal. It is not
  // guaranteed to be: an ended agent whose worktree is gone resolves to the project ROOT journal
  // server-side (resolveAgentCheckout's fallback), and that file holds whatever root run wrote it
  // last — a longer foreign feed must never beat the agent's archive. The archive is the agent's own
  // record, so its opening event is the fingerprint the channel has to match; an unloaded or
  // empty archive can't be checked and keeps the pre-existing show-the-feed fallback.
  const sameJournal =
    !archived?.length || events.length === 0 || JSON.stringify(events[0]) === JSON.stringify(archived[0])
  const feedAhead = sameJournal && events.length > (archived?.length ?? 0)
  const shown = working ? events : archived?.length && !feedAhead ? archived : events
  useEffect(() => {
    if (live === false && archived !== null && feedAhead) setArchiveBehind(events.length)
  }, [live, archived, feedAhead, events.length])
  // Live as the FEED knows it (#1460): the agents poll takes up to 2s to notice a resumed session,
  // but its events are already streaming. The feed's own verdict drives the scroll contract and
  // the composer slot, so the continuation renders (and Stop takes over from Resume) the moment
  // the first event lands rather than when the poll does.
  //
  // Once the feed has shown the run going again, it keeps saying so until the log shows that turn
  // end: the archive re-read above catches up with the channel within milliseconds, the channel
  // then knows no more than it, and without this the page said "ended" again until the poll
  // landed, the spinner row flashing in between. Only a turn seen starting past an
  // archive that was read counts: before the first read the channel is ahead of nothing.
  const [resumedFor, setResumedFor] = useState<string | null>(null)
  const active = isAgentActive(shown)
  const feedLive = working || (active && (feedAhead || resumedFor === agentId))
  useEffect(() => {
    if (active && feedAhead && archived !== null) setResumedFor(agentId)
    else if (!active) setResumedFor(null)
  }, [active, feedAhead, archived, agentId])
  // The message just sent to an ended run, shown at the end of the feed until its own prompt line
  // arrives: the continuation writes that line only once its checkout is back, seconds later.
  const [sending, setSending] = useState<{ text: string; prompts: number } | null>(null)
  useEffect(() => setSending(null), [agentId])
  const prompts = shown.filter(e => e.kind === 'driver' && e.event.type === 'start').length
  useEffect(() => {
    if (sending && prompts > sending.prompts) setSending(null)
  }, [sending, prompts])
  const onSending = useCallback((text: string | null) => setSending(text === null ? null : { text, prompts }), [prompts])
  // The messages sent while the agent works: it reads them all when its turn ends, as its next
  // prompt. Until that prompt's line arrives the feed shows them as queued. An agent that stopped
  // working without reading them (it failed, it was stopped) shows them no longer.
  const [queued, setQueued] = useState<{ texts: string[]; prompts: number } | null>(null)
  useEffect(() => setQueued(null), [agentId])
  useEffect(() => {
    if (queued && prompts > queued.prompts) setQueued(null)
  }, [queued, prompts])
  useEffect(() => {
    if (!queued || feedLive) return
    const timer = setTimeout(() => setQueued(null), QUEUED_UNREAD_MS)
    return () => clearTimeout(timer)
  }, [queued, feedLive])
  const onQueued = useCallback((text: string) => setQueued(was => ({ texts: [...(was?.texts ?? []), text], prompts })), [prompts])
  // A run just started writes its prompt line only once its record is saved and its checkout made.
  const shownSending = sending?.text ?? (startedWith && prompts === 0 ? startedWith : undefined)
  // The agent works, or is about to: on a message just sent, or as its feed shows before the
  // agents poll does.
  const going = feedLive || shownSending !== undefined
  // What the branch holds (#1023), read once for the bar above the message box. Read once
  // the agent stops rather than once the process does: while it is still writing to the branch
  // there is nothing to hand off yet, but a parked session's branch is finished work. "Stops" is
  // as the feed knows it: read off the agents poll alone, the last step stayed in the bar, its
  // button with it, for the seconds an agent sent a new message already worked. While the
  // card says saving, the checkout is being cleaned up, and an empty branch is deleted with it, so
  // a publish offered then turned into "Branch gone" moments later: the answer is only shown then
  // for a branch with commits of its own, which the clean-up keeps.
  // The agent's checkout (its branch, its pull request, clean or dirty, its size), read once for
  // the top bar and for the bar above the message box, and again the moment a turn starts or ends.
  const checkout = useCheckoutStatus(projectId, agentId, active)
  const read = useAgentHandoff(projectId, agentId, live === false && !going, card?.saving === true, going)
  const kept = read.handoff !== null && read.handoff.exists && !read.handoff.empty
  const handoff = card?.saving && !kept ? { ...read, handoff: null, loaded: false } : read
  // The agent is doing what the Commit button asked: said where the button was, from the ask going
  // out until the next step is known, so the place is never empty in between: the agent's turn
  // ends, its checkout is cleaned up, and only then is its branch read. Read off the last prompt,
  // so a refresh says the same.
  const lastPrompt = shownSending ?? [...shown].reverse().find(e => e.kind === 'driver' && e.event.type === 'start')
  const commitAsked = isCommitAsk(typeof lastPrompt === 'string' ? lastPrompt : lastPrompt?.kind === 'driver' && lastPrompt.event.type === 'start' ? lastPrompt.event.prompt : undefined)
  const committing = commitAsked && (going || (live === false && !handoff.loaded))
  // How the agent ended (#948), read once for the Resume offer and the wait for subagents below:
  // its events say it, and until they are read (or when they hold no ending) its card does, so
  // both are right from the first frame.
  const outcome = working ? undefined : (agentOutcome(shown) ?? (card ? cardOutcome(card.status) : undefined))
  const questions = useMemo(() => pendingChoices(shown), [shown])
  // Until the handoff has actually loaded, a just-stopped agent keeps showing the modules' summaries
  // (the Files module's count of changed files, #1030): the summary swaps once, to the handoff,
  // instead of blanking for the beat the handoff read takes.
  const showHandoff = live === false && handoff.loaded
  // Whether this run's own facts are in, so the bar shows them together: its log (for an ended
  // run; a running one streams it) and what its branch holds (when that is read at all). Before
  // then the bar names the run and nothing else, never facts left from the run before. A run
  // seen before is ready at once, from what was read last time. A read that has not answered
  // within a second holds the bar back no longer: the facts that are in show then.
  // Which run the second has passed for: a flag would still be the last run's for a frame.
  const [waitedFor, setWaitedFor] = useState<string | null>(null)
  useEffect(() => {
    const timer = setTimeout(() => setWaitedFor(agentId), READY_WAIT_MS)
    return () => clearTimeout(timer)
  }, [agentId])
  // The branch's answer counts once its pull request lookup is in too: the bar offers nothing
  // while it is out, so showing the facts before it would add them in two steps.
  const branchRead = card?.saving === true || (handoff.loaded && !handoff.handoff?.prPending)
  const ready = working || waitedFor === agentId || (archived !== null && branchRead)
  // Whether the feed shows this agent yet. On a first visit it would otherwise pass through what
  // each read still out has to say: "Waiting for the session to start…" while the list of agents
  // is unread, the live channel's events (the project root's, for an agent whose checkout is
  // gone), "Loading agent…" while the archive is out, and only then the agent's own events. It
  // stays blank instead until the agent is known to run, its archive has answered, or the second
  // has passed, so it fills in one step. Once it has shown this agent it keeps showing it: an
  // agent that stops while watched keeps its events on screen while the archive is read.
  const [settledFor, setSettledFor] = useState<string | null>(null)
  const feedSettled = settledFor === agentId || working || archived !== null || waitedFor === agentId
  useEffect(() => {
    if (feedSettled) setSettledFor(agentId)
  }, [feedSettled, agentId])

  // The agent has ended, its subagents too: the next step is offered from here on.
  const ended = ready && live === false && !going && subagentsRunning === 0
  // Whether the bar above the message box has something to say: a pull request, a commit going
  // on, uncommitted changes while the agent works, or, once it has ended and its branch is read,
  // what the branch holds. An agent that changed nothing has no bar. A bar that is there stays
  // while the agent works (it committed: its checkout is clean again) and while an ended agent's
  // branch is still being read, so it never goes and comes back.
  const lastSay = useRef<{ agentId: string | null; say: boolean }>({ agentId: null, say: false })
  const held = lastSay.current.agentId === agentId && lastSay.current.say
  const say =
    committing ||
    checkout?.pr !== undefined ||
    (live === false ? (handoff.loaded ? handoffSays(handoff.handoff) : held) : checkout?.checkout?.dirty === true || held)
  lastSay.current = { agentId, say }

  return (
    <>
      <AgentActionBar
        projectId={projectId}
        agentId={agentId}
        events={shown}
        label={label}
        projectName={projectName}
        runsOn={runsOn}
        retainedWorktree={hasWorktree}
        onWorktreeRemoved={onWorktreeRemoved}
        onDeleted={onDeleted}
        expanded={open}
        onToggle={toggle}
        ready={ready}
        checkout={checkout}
      />
      {/* The always-available session-details strip: agent + spend (#322). What the run changed is
          in the side panel's Changes tab, not here. */}
      {open && <AgentDetails events={shown} card={card} />}
      {/* A GitHub Actions run replays in a burst at the end (#1053), so the live feed looks stalled:
          say the wait is expected and link through to the live Actions run. */}
      <ActionsRunNotice target={target} events={shown} live={working} />
      {/* A run handed to Claude Code on the web (#610): the work is happening in a cloud session
          this machine cannot stream, so point at where it is rather than show an empty feed. */}
      <CloudAgentNotice target={target} events={shown} projectId={projectId} agentId={agentId} />
      {/* A run relayed to a saved machine (#1067): its diff, handoff, and push/PR now relay to the
          machine (slice 2), so this notice only flags that the browser preview stays local-only for now. */}
      <RemoteAgentNotice machine={remoteLabel} />
      {/* Nothing to show yet is not the same thing in both states: a live run is waiting for its
          first event, a finished one is still reading its log. */}
      {!feedSettled ? (
        <div className="flex-1" />
      ) : live !== true && archived === null && shown.length === 0 ? (
        <div className="grid flex-1 place-items-center text-sm text-muted-foreground">Loading agent…</div>
      ) : (
        // A finished log is static, so it does not follow new output; it opens at the end, where
        // the outcome, the final spend and the last changes are (#948). "Live" for the scroll
        // contract is the feed's own state, not the agents poll (#1460): a resumed session streams
        // its new leg up to two seconds before `live` flips, and entering follow mode with the
        // first streamed row absorbs the continuation one event at a time instead of jolting the
        // scroller when the poll lands.
        <AgentFeed
          events={shown}
          projectId={projectId}
          lost={lost}
          writing={feedLive ? writing : ''}
          {...(shownSending !== undefined ? { sending: shownSending } : {})}
          working={feedLive || shownSending !== undefined}
          queued={queued?.texts}
          waitingOn={!going && live === false && outcome?.ok !== false && !outcome?.waiting ? subagentsRunning : 0}
          {...(feedLive ? {} : { stick: false, openAt: 'end' as const, emptyLabel: 'This agent has no events.' })}
          // A web agent's log dead-ends at the hand-off (#1265): the mirror box rides the tail of
          // the scroller, where "and then…" belongs. Self-nulling for every other target.
          tail={<CloudMirrorRow target={target} events={shown} />}
          subagents={subagents}
          doing={doing}
          setup={setup}
          onOpenAgent={onOpenAgent}
          onOpenChange={onOpenChange}
        />
      )}
      {/* Keyed by the run: a list opened for one main agent is not open for the next. */}
      <SubagentsBar key={agentId} subagents={subagents} doing={doing} onOpen={onOpenAgent} />
      {/* The questions the agent stopped on, above the message box; the newest takes the keys. */}
      {agentId && questions.map((choice, at) => <QuestionPanel key={`${agentId}:${choice.id}`} projectId={projectId} agentId={agentId} choice={choice} active={at === questions.length - 1} onSaid={onSending} />)}
      {/* Where the work is and the next step, right above the message box. */}
      <AgentWorkBar
        projectName={projectName}
        checkout={checkout}
        summary={
          ready &&
          (showHandoff ? (
            <>
              <HandoffSummary handoff={handoff.handoff} subagent={subagent} />
              {handoff.error && <span className="text-danger">{handoff.error}</span>}
            </>
          ) : (
            runSlots.map(slots => {
              const Summary = slots.summary
              return Summary ? (
                <ModuleSlot key={slots.package} package={slots.package} label="run summary">
                  <Summary projectId={projectId} agentId={agentId} working={working} />
                </ModuleSlot>
              ) : null
            })
          ))
        }
        actions={
          // A run that is working is still writing its branch; the next step is offered once it has ended,
          // and a run whose subagents still work has not: it goes on as each of them ends.
          committing ? <Committing /> : ended ? <HandoffActions projectId={projectId} agentId={agentId} state={handoff} subagent={subagent} onAsked={onSending} /> : undefined
        }
        show={say}
      />
      <AgentComposer
        projectId={projectId}
        agentId={agentId}
        live={feedLive}
        files={files}
        onAgentStarted={onAgentStarted}
        onSending={onSending}
        onQueued={onQueued}
        outcome={outcome}
        model={modelLabel}
      />
    </>
  )
}
