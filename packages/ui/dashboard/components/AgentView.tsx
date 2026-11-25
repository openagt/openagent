import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type MutableRefObject } from 'react'
import type { AgentMeta } from '../../src/index.js'
import type { RunEvent } from '@openagt/hooks'
import { useLoaded } from '../lib/use-async.js'
import { agentOutcome, cardOutcome, pendingChoices, shownStatus } from '../lib/live-state.js'
import { useAgentFeed } from '../lib/use-agent-feed.js'
import { AgentActionBar } from './AgentActionBar.js'
import { SessionRow } from './SessionRow.js'
import type { StartPicks } from '../lib/started-from.js'
import type { ContextSet } from '../lib/use-context-set.js'
import { AgentComposer, type QueuedMessage } from './AgentComposer.js'
import { sendNow, withdrawMessage } from '../rpc/control.js'
import { onRunCheckout } from '../rpc/reads.js'
import type { WaitingMessage } from './EventList.js'
import { AgentWorkPanel } from './AgentWorkPanel.js'
import { ViewsAt, useOptionsAt } from './Places.js'
import { useAction } from '../lib/use-action.js'
import { keepSending, keepWaiting, keptSending, keptWaiting, onKeptWaiting } from '../lib/draft-handoff.js'
import { AgentFeed } from './AgentFeed.js'
import { IssueLinks } from '../lib/markdown-links.js'
import { useProjects } from '../lib/shell-projects.js'
import { OpenFile, RunCalls } from './ToolCalls.js'
import { ChatNote, ChatPane } from './ChatPane.js'
import { LostStreamNotice } from './LostStreamNotice.js'
import { ModuleSlot } from './ModulePageView.js'
import { useMountedModules } from '../lib/use-modules.js'
import { AgentDetails, type AgentDetailsCard } from './AgentDetails.js'
import { usePaneOpeners } from '../lib/reveal-change.js'
import { agentOf, modelContextWindow, useAgents } from '../lib/agents.js'
import { ContextCircle } from './ContextCircle.js'
import { hostOf, useRunHosts } from '../lib/run-hosts.js'
import { THIS_MACHINE } from './RunOnMenu.js'

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
/** How long a queued message stays shown once the agent no longer works and was not stopped: its next turn, which reads it, starts well within this. Unread then, it goes back to the box. */
const QUEUED_UNREAD_MS = 5_000

export function AgentView({
  projectId,
  agentId,
  events,
  live,
  card,
  picks,
  label,
  naming,
  projectName,
  target,
  startedOn,
  files,
  lost = false,
  writing = '',
  replayed = true,
  startedWith,
  onAgentStarted,
  contextSet,
  onDeleted,
  onBack,
}: {
  projectId: string
  /** Which run this is (#749). */
  agentId: string
  /** The live channel's events for this agent — all there is while it runs. */
  events: RunEvent[]
  /** Whether the agent is still running; `null` while the daemon's list of agents has not been read, so it is not known yet. */
  live: boolean | null
  /** What the run's card says, off the runs poll: what the feed cannot carry (the details strip's facts, how the agent was set up, whether its record is being saved). Absent until the card is listed. */
  card?: (AgentDetailsCard & Pick<AgentMeta, 'status' | 'intent' | 'saving' | 'workspace' | 'resumeCommand' | 'branch' | 'base' | 'host' | 'otherHost' | 'publish' | 'earlierPrs' | 'pr' | 'prState' | 'prTitle' | 'options'> & Partial<Pick<AgentMeta, 'endedAt' | 'updatedAt'>>) | undefined
  /** What the launcher said about this run as it started it: shown until the run's record says it. */
  picks?: StartPicks | undefined
  /** The session's own name — the same label the rail shows (#1030). It leads the action bar as
   * the stable identity, so the branch renaming itself near the end of an agent (#736) reads as a
   * detail changing rather than the whole view changing. */
  label?: string | undefined
  /** The name is still being made, so the bar holds its place and shows it letter by letter. */
  naming?: boolean | undefined
  /** The session's project, said in the row above the message box. */
  projectName?: string | null | undefined
  /** Where the agent executes: a host beside this computer's, by its id (`run.host`: a CI runner's, Claude Code on the web's `web`); none, or `local`, for this computer's. */
  target?: string | undefined
  /** The host a run just started goes to, by its name, until its card says where it runs: the row above the message box says it. */
  startedOn?: string | undefined
  files: string[]
  /** The live channel's health (#948) — surfaced as a banner under the top bar. */
  lost?: boolean
  /** The message the agent is writing, as far as it has got: shown after the feed while it runs. */
  writing?: string
  /** The live channel has brought the lines the run had written when it was opened; false while it replays them. */
  replayed?: boolean
  /** The prompt this page just started the agent with: shown until the agent's own prompt line arrives. */
  startedWith?: string | undefined
  /** Jump to the agent a continuation started (#959). */
  onAgentStarted?: ((intent: string, agentId: string) => void) | undefined
  /** The shell's Context, for the message box to send with the next message. */
  contextSet?: ContextSet | undefined
  /** Leave this session after it is deleted (#1032) — back to the project home. */
  onDeleted?: (() => void) | undefined
  /** A phone's back arrow in the top bar: to the page shown before. */
  onBack?: (() => void) | undefined
}) {
  // The log on screen: the live channel's while the agent works, its archive once it has ended.
  const { archived, shown, feedLive } = useAgentFeed(projectId, agentId, live, events, replayed)
  // Where `#12` in an answer leads: the page the first module that links the project's references
  // gives it (`chat.references`), by the project's repository address. With none, `#12` stays text.
  const issueLinks = useIssueLinks(projectId)

  // Whether the agent is still working. A run that stops on a question ends `waiting` rather than
  // staying up, so a live run is a working one. One not known yet is neither working nor ended:
  // nothing is read for it and the bar waits.
  const working = live === true

  // What was set up for the agent before it began, off its card: the chat's "Initialized session" line.
  const { workspace, branch, base, driver, model } = card ?? {}
  // An agent just started on a host has no card listed yet: the host's name says where it runs.
  const elsewhere = (target !== undefined && target !== 'local') || startedOn !== undefined
  const setup = useMemo(() => ({ workspace, branch, base, driver, model, elsewhere }), [workspace, branch, base, driver, model, elsewhere])
  // The coding agent the run is on: how its calls read in the chat. And how full this session's
  // context is: the run's own last reading, against what its agent says the model holds. Either
  // missing, no circle. The model itself is said by its agent's control.
  const ranOn = agentOf(useAgents(), driver)
  const contextWindow = modelContextWindow(ranOn, model)
  // Where the agent runs, for the row above the message box: a host by its own name. A run another
  // computer started is named by that computer: it did not run here.
  const host = hostOf(target)
  const hosts = useRunHosts(host !== undefined ? projectId : null)
  const runsOn = startedOn ?? (host !== undefined ? (hosts.find(one => one.id === host)?.label ?? 'Another host') : card?.otherHost && card.host ? card.host : THIS_MACHINE)
  const [open, setOpen] = useState(false)
  // What the installed modules add to this run's page: a strip above the chat: a host's word on a run it runs, say where the run is.
  const notices = useMountedModules().views['chat.notice'].filter(notice => notice.projects.includes(projectId))
  // What a row of the chat opens in a pane beside it: a changed file, a file a step names
  // ("Read index.html"), a live screen, a subagent.
  const { onOpenChange, onOpenFile, onOpenScreen, onOpenSubagent } = usePaneOpeners(projectId, agentId)
  const toggle = useCallback(() => setOpen(o => !o), [])

  // The messages on their way to the agent, from the box under the chat to the feed above it.
  // The prompt this page started the run with is on its way only until the run has ended.
  const { sending: shownSending, sendingImages, sentAt, onSending, waiting, onQueued, editInBox, giveBack } = useMessagesOnTheirWay(projectId, agentId, shown, live === false && archived !== null && !feedLive, card?.status === 'stopped', card?.endedAt, live === false ? undefined : startedWith, picks?.images)
  // A question answered from its card hands the focus on to the box, for what the person says next.
  const focusBox = useRef<(() => void) | null>(null)
  // A run writes its prompt line once its coding agent begins. Until then its prompt, off its card,
  // is the chat's first row, after a reload and on a run stopped before it began too. Not while a
  // working run's replay is still coming: its log is not read yet, and its prompt alone was the
  // chat of a run just starting ("Starting <its coding agent> 12m 36s"), for the moment the replay took.
  const replaying = working && !replayed
  const standIn = card?.intent ?? startedWith
  const standsIn = standIn !== undefined && !replaying && !(live !== false && startedWith !== undefined) && !shown.some(e => e.kind === 'driver' && e.event.type === 'start')
  const startedAt = card?.startedAt
  const chat = useMemo<RunEvent[]>(
    () => (standsIn ? [{ kind: 'driver', event: { type: 'start', prompt: standIn }, ...(startedAt !== undefined ? { at: startedAt } : {}) }, ...shown] : shown),
    [standsIn, standIn, startedAt, shown],
  )
  // The agent works, or is about to: on a message just sent, or as its feed shows before the
  // agents poll does.
  const going = feedLive || shownSending !== undefined
  // Whether this agent kept its checkout (#737), as its host finds it: a failed/stopped run does, a
  // clean one had it removed when it finished. Its menu opens that folder. Read again as the run
  // starts or ends, and once its clean-up is done.
  const ownCheckout = useLoaded<string | null>(() => onRunCheckout(projectId, agentId), null, [projectId, agentId, live, card?.saving])
  const hasWorktree = live === false && ownCheckout !== null
  // How the agent ended (#948), read once for the Resume offer below:
  // its events say it, and until they are read (or when they hold no ending) its card does, so
  // both are right from the first frame.
  const outcome = working ? undefined : (agentOutcome(shown) ?? (card ? cardOutcome(card.status) : undefined))
  // Whether this run's own facts are in, so the bar shows them together: its log (for an ended
  // run; a running one streams it). Before then the bar names the run and nothing else, never
  // facts left from the run before. A run seen before is ready at once, from what was read last
  // time. A read that has not answered within a second holds the bar back no longer: the facts
  // that are in show then.
  // Which run the second has passed for: a flag would still be the last run's for a frame.
  const [waitedFor, setWaitedFor] = useState<string | null>(null)
  useEffect(() => {
    const timer = setTimeout(() => setWaitedFor(agentId), READY_WAIT_MS)
    return () => clearTimeout(timer)
  }, [agentId])
  const ready = working || waitedFor === agentId || archived !== null
  // Whether the feed shows this agent yet. On a first visit it would otherwise pass through what
  // each read still out has to say: "Waiting for the session to start…" while the list of agents
  // is unread, the live channel's events, "Loading agent…" while the archive is out, and only then
  // the archived log. It stays blank instead until the agent is known to run and its replay has
  // something to show, its archive has answered, or the second has passed, so it fills in one step.
  // Once it has shown this agent it keeps showing it: an agent that stops while watched keeps its
  // events on screen while the archive is read.
  const [settledFor, setSettledFor] = useState<string | null>(null)
  // Nor before the plugins are in, which draw its texts: on a page just loaded the feed came up
  // with its frame and no words (an empty message, "Initialized session"), then filled. Held back
  // the same second at most.
  const pluginsIn = useMountedModules().loaded || waitedFor === agentId
  const feedSettled = pluginsIn && (settledFor === agentId || (working && (!replaying || chat.length > 0 || shownSending !== undefined)) || archived !== null || waitedFor === agentId)
  useEffect(() => {
    if (feedSettled) setSettledFor(agentId)
  }, [feedSettled, agentId])

  // The run's pull request, the one its record names, as the list of runs marks it.
  const pr = useMemo(
    () => (card?.pr ? { ...card.pr, ...(card.prState ? { state: card.prState } : {}), ...(card.prTitle ? { title: card.prTitle } : {}) } : undefined),
    [card?.pr, card?.prState, card?.prTitle],
  )
  // The run's state after its name. The list of runs already says how an ended run ended and
  // whether its pull request merged, as its row in the sidebar shows, so the bar says that from
  // the first frame and never waits for this page's own reads: waiting for them, a switch to a
  // merged run showed nothing, then "Done", then "Merged". Once the reads are in, the chat's own
  // events say a question waits or how the last turn ended.
  const merged = pr?.state === 'merged' || card?.prState === 'merged'
  const status = ready
    ? shownStatus(live === null && !feedLive ? null : feedLive, feedLive && pendingChoices(shown).length > 0, outcome, merged)
    : live === false && card
      ? shownStatus(false, false, cardOutcome(card.status), card.prState === 'merged')
      : undefined
  // What the rows of the session's work are told: whether the run works, as its feed shows it (a
  // message just sent included: a turn that ends is ended at once, before the list of runs says
  // so), or has ended, and what the shell knows of it beside its work.
  const work = useMemo(
    () => ({ projectId, agentId, working: going, ended: live === false && !going, saving: card?.saving === true, ...(projectName ? { projectName } : {}), ...(pr ? { pr } : {}) }),
    [projectId, agentId, live, going, card?.saving, projectName, pr],
  )
  // Where the session started, right above the message box, as the "New agent session" page has it. It is
  // there whatever stands in the box's place.
  const sessionBox = useMemo(() => ({ in: 'session' as const, projectId, agentId, options: card?.options ?? picks?.options ?? {}, onChange: () => {}, busy: false }), [projectId, agentId, card?.options, picks?.options])
  const row = (
    <SessionRow
      runsOn={runsOn}
      target={target}
      elsewhere={elsewhere || card?.otherHost === true}
      projectName={projectName}
      box={sessionBox}
      run={{ projectId, agentId, working }}
    />
  )

  return (
    <ChatPane
      top={
        <>
          <AgentActionBar
            projectId={projectId}
            agentId={agentId}
            events={shown}
            live={feedLive}
            label={label}
            naming={naming}
            retainedWorktree={hasWorktree}
            onDeleted={onDeleted}
            onBack={onBack}
            expanded={open}
            onToggle={toggle}
            ready={ready}
            status={status}
            resumeCommand={card?.resumeCommand}
          />
          {/* The always-available session-details strip: agent + spend (#322). What the run changed is
              in the Changes pane, not here. */}
          {open && <AgentDetails events={shown} card={card} {...(pr ? { pr } : {})} />}
          {notices.map(({ View: Notice, id, package: pkg }) => (
            <ModuleSlot key={`${pkg}/${id}`} package={pkg} label="run notice">
              <Notice projectId={projectId} agentId={agentId} working={working} {...(host !== undefined ? { host } : {})} />
            </ModuleSlot>
          ))}
          {lost && <LostStreamNotice />}
        </>
      }
      bottom={
        <>
          {/* Where the work is and the next step, above the message box and its row: a row per repo, the modules'. */}
          <AgentWorkPanel>
            <ViewsAt place="chat.work" projectId={projectId} props={work} label="session's work" />
          </AgentWorkPanel>
          {/* Until the run's record or its feed says whether it works, no box: it would say an ended run's words. */}
          {live === null && !feedLive ? null : card?.otherHost && card.host ? (
            // A run another computer started is only read here: a
            // message would continue it on this computer, under its id, with this computer's
            // logins and none of its conversation.
            <div className="@container mx-auto w-full max-w-3xl px-4 pt-2 pb-4">
              {row}
              <p role="note" className="rounded-lg border border-border bg-muted/40 px-4 py-2.5 text-sm text-muted-foreground">
                {`This run is on ${card.host}. Continue it there.`}
              </p>
            </div>
          ) : (
          <AgentComposer
            projectId={projectId}
            agentId={agentId}
            live={feedLive}
            asked={outcome?.waiting === true}
            files={files}
            onAgentStarted={onAgentStarted}
            onSending={onSending}
            onQueued={onQueued}
            editInBox={editInBox}
            giveBack={giveBack}
            focusBox={focusBox}
            {...(contextWindow !== undefined ? { context: <ContextCircle used={card?.contextTokens ?? 0} size={contextWindow} /> } : {})}
            contextSet={contextSet}
            // A card with no level has none: a message may have taken it away.
            publish={card ? card.publish : picks?.publish}
            row={row}
            // The options as the record keeps them; the launcher's until it is there.
            options={card ? card.options : picks?.options}
          />
          )}
        </>
      }
    >
      {/* Nothing to show yet is not the same thing in both states: a live run is waiting for its
          first event, a finished one is still reading its log. */}
      {!feedSettled ? null : live !== true && archived === null && shown.length === 0 ? (
        <ChatNote>Loading agent…</ChatNote>
      ) : (
        // A finished log is static, so it does not follow new output; it opens at the end, where
        // the outcome, the final spend and the last changes are (#948). "Live" for the scroll
        // contract is the feed's own state, not the agents poll (#1460): a resumed session streams
        // its new leg up to two seconds before `live` flips, and entering follow mode with the
        // first streamed row absorbs the continuation one event at a time instead of jolting the
        // scroller when the poll lands.
        //
        // Keyed by the run, as the rest of the page is not: what was opened in one agent's chat (its
        // "Initialized session" line, a run of its steps) is not open in the next one's, and each chat
        // opens at its own place, not where the one before was left.
        <IssueLinks.Provider value={issueLinks}>
        <OpenFile.Provider value={onOpenFile}>
        <RunCalls.Provider value={ranOn?.calls}>
        <AgentFeed
          key={agentId}
          events={chat}
          projectId={projectId}
          agentId={agentId}
          onSaid={onSending}
          focusNext={() => focusBox.current?.()}
          writing={feedLive ? writing : ''}
          {...(shownSending !== undefined ? { sending: shownSending, sendingImages } : {})}
          {...(sentAt !== undefined ? { sendingAt: sentAt } : {})}
          working={feedLive || shownSending !== undefined}
          queued={waiting}
          {...(feedLive ? {} : { openAt: 'end' as const, emptyLabel: 'This agent has no events.' })}
          // A message just sent to an ended agent: the chat follows its end from the send on, not
          // only once the agent's own line arrives, by which time the chat had grown past the view.
          {...(going ? {} : { stick: false })}
          setup={setup}
          onOpenSubagent={onOpenSubagent}
          onOpenChange={onOpenChange}
          onOpenScreen={onOpenScreen}
        />
        </RunCalls.Provider>
        </OpenFile.Provider>
        </IssueLinks.Provider>
      )}
    </ChatPane>
  )
}

/** A message sent to a working agent, with how many prompts its log held then: a later prompt of its text is it, read. */
type Queued = QueuedMessage & { prompts: number }
/** A message sent to continue an ended run: how many prompts the run had then, when its record said it ended then, and when it was sent. */
type Sending = { text: string; images?: string[]; prompts: number; endedAt: string | null; at: string }

function onVisibilityChange(changed: () => void): () => void {
  document.addEventListener('visibilitychange', changed)
  return () => document.removeEventListener('visibilitychange', changed)
}

/**
 * The messages on their way to an agent, shown in its feed until the agent's own line of each
 * arrives: the one just sent to the ended agent (`sending`, which `onSending` sets), or the prompt
 * this page just started it with; and the ones sent while it works that it has not read yet
 * (`waiting`, which `onQueued` adds to).
 */
function useMessagesOnTheirWay(
  projectId: string,
  agentId: string,
  shown: readonly RunEvent[],
  /** The run is known to have ended: the list of runs says so and its feed is in. */
  ended: boolean,
  /** Its record says it was stopped: what it had not read, it never will. A failed leg's process still sends its inbox as the next turn. */
  stopped: boolean,
  /** When its record says it last ended. */
  endedAt: string | undefined,
  startedWith: string | undefined,
  /** The images this page just started the agent with. */
  startedImages: string[] | undefined,
): {
  sending: string | undefined
  /** The images that message goes with. */
  sendingImages: string[] | undefined
  /** When that message was sent. */
  sentAt: string | undefined
  onSending: (text: string | null, images?: string[]) => void
  waiting: WaitingMessage[]
  onQueued: (message: QueuedMessage) => void
  /** Set by the composer to what puts a text back in its box: Cancel and edit on a waiting message. */
  editInBox: MutableRefObject<((text: string, images?: string[]) => void) | null>
  /** Set by the composer to what hands its box the messages the run ended without reading, with their images. */
  giveBack: MutableRefObject<((text: string, images?: string[]) => void) | null>
} {
  // The message just sent to an ended run, shown at the end of the feed until its own prompt line
  // arrives: the continuation writes that line only once its coding agent answers, seconds later.
  // Kept per run in this browser, as the waiting ones are, so a reload shows it too.
  const [sent, setSent] = useState(() => ({ run: agentId, message: keptSending<Sending>(agentId) }))
  const sending = sent.run === agentId ? sent.message : keptSending<Sending>(agentId)
  const setSending = useCallback((message: Sending | null) => setSent({ run: agentId, message }), [agentId])
  useEffect(() => {
    if (sent.run === agentId) keepSending(agentId, sent.message)
  }, [sent, agentId])
  const prompts = shown.filter(e => e.kind === 'driver' && e.event.type === 'start').length
  useEffect(() => {
    if (sending && prompts > sending.prompts) setSending(null)
  }, [sending, prompts, setSending])
  const onSending = useCallback(
    (text: string | null, images?: string[]) => setSending(text === null ? null : { text, ...(images !== undefined && images.length > 0 ? { images } : {}), prompts, endedAt: endedAt ?? null, at: new Date().toISOString() }),
    [prompts, endedAt, setSending],
  )
  // The messages sent while the agent works that it has not read yet, each shown waiting until the
  // agent reads it: at its next step, where its `steered` line lands, or, sent for later or not
  // taken in time, as the prompt of its next turn. An agent that stopped working without reading
  // them (it failed, it was stopped) never will: their words go back to the box. Kept per run in
  // this browser, so a visit or a reload shows them too, until the run's events say they are read,
  // and each tab open on the run takes the list another tab keeps, so a send there adds to it.
  const [kept, setKept] = useState(() => ({ run: agentId, messages: keptWaiting<Queued>(agentId) }))
  const queued = kept.run === agentId ? kept.messages : keptWaiting<Queued>(agentId)
  const setQueued = useCallback(
    (next: (was: Queued[]) => Queued[]) => setKept(was => ({ run: agentId, messages: next(was.run === agentId ? was.messages : keptWaiting<Queued>(agentId)) })),
    [agentId],
  )
  useEffect(() => {
    if (kept.run === agentId) keepWaiting(agentId, kept.messages)
  }, [kept, agentId])
  useEffect(() => onKeptWaiting<Queued>(agentId, messages => setKept({ run: agentId, messages })), [agentId])
  const isRead = useMemo(() => {
    const steered = new Set(shown.flatMap(e => (e.kind === 'driver' && e.event.type === 'steered' && e.event.id !== undefined ? [e.event.id] : [])))
    const starts = shown.flatMap(e => (e.kind === 'driver' && e.event.type === 'start' ? [e.event.prompt] : []))
    return (message: Queued) => steered.has(message.id) || starts.slice(message.prompts).includes(message.text)
  }, [shown])
  const unread = queued.filter(message => !isRead(message))
  useEffect(() => {
    if (unread.length !== queued.length) setQueued(() => unread)
  }, [unread.length, queued.length]) // eslint-disable-line react-hooks/exhaustive-deps
  const giveBack = useRef<((text: string, images?: string[]) => void) | null>(null)
  const unreadNow = useRef(queued)
  unreadNow.current = queued
  // With the session open in two tabs, the words go to the one the person looks at.
  const onScreen = useSyncExternalStore(onVisibilityChange, () => document.visibilityState !== 'hidden', () => true)
  useEffect(() => {
    if (queued.length === 0 || !ended || !onScreen) return
    const timer = setTimeout(
      () => {
        giveBack.current?.(unreadNow.current.map(message => message.text).join('\n\n'), unreadNow.current.flatMap(message => message.images ?? []))
        setQueued(() => [])
      },
      stopped ? 0 : QUEUED_UNREAD_MS,
    )
    return () => clearTimeout(timer)
  }, [queued.length, ended, stopped, onScreen, setQueued])
  // A run whose record ended again since the message was sent, and whose feed shows no prompt of it
  // five seconds on, as for the messages waiting above, never began on it: its words go back to the box.
  // The record can end before this page reads the lines of the leg that began on it. Again, not
  // later: the record's times are the daemon's clock, and this browser's may be another device's.
  useEffect(() => {
    if (!sending || endedAt === undefined || endedAt === sending.endedAt || !ended || !onScreen) return
    const timer = setTimeout(() => {
      giveBack.current?.(sending.text, sending.images)
      setSending(null)
    }, QUEUED_UNREAD_MS)
    return () => clearTimeout(timer)
  }, [sending, endedAt, ended, onScreen, setSending])
  const onQueued = useCallback((message: QueuedMessage) => setQueued(was => [...was, { ...message, prompts }]), [setQueued, prompts])
  // Cancel and edit puts the message back in the box; the composer says how.
  const editInBox = useRef<((text: string, images?: string[]) => void) | null>(null)
  // Send now asks the run to read every message it has not yet: one press, under the last of them, which says how it went, in that run.
  const now = useAction(agentId)
  const sendsNow = [...unread].reverse().find(message => !message.later)?.id
  const waiting: WaitingMessage[] = unread.map(({ prompts: _prompts, ...message }) => ({
    ...message,
    ...(message.id === sendsNow ? { onSendNow: () => void now.run(() => sendNow(projectId, agentId), 'Could not send it now.'), sendingNow: now.busy, refused: now.error ?? undefined } : {}),
    onEdit: () => {
      setQueued(was => was.filter(other => other.id !== message.id))
      void withdrawMessage(projectId, agentId, message.id)
      editInBox.current?.(message.text, message.images)
    },
  }))
  return {
    // A run just started writes its prompt line only once its record is saved and its checkout made.
    // Told apart from the prompts in the same draw that brings the prompt's line, not an effect
    // later: for that one frame the message was in the chat twice.
    sending: (sending && prompts <= sending.prompts ? sending.text : undefined) ?? (startedWith && prompts === 0 ? startedWith : undefined),
    sendingImages: sending && prompts <= sending.prompts ? sending.images : startedWith && prompts === 0 ? startedImages : undefined,
    sentAt: sending && prompts <= sending.prompts ? sending.at : undefined,
    onSending,
    waiting,
    onQueued,
    editInBox,
    giveBack,
  }
}

/** Where `#<number>` in the chat of the project `projectId` leads, as the modules that link its references say; none where no module links them. */
function useIssueLinks(projectId: string): ((number: number) => string | undefined) | undefined {
  const references = useOptionsAt('chat.references', projectId)
  const listed = useProjects().find(project => project.id === projectId)
  const remote = listed?.remote
  const name = listed?.name
  return useMemo(() => {
    if (name === undefined || references.length === 0) return undefined
    const project = { id: projectId, name, ...(remote !== undefined ? { remote } : {}) }
    return (number: number) => references.map(({ option }) => option.issue(project, number)).find(page => page !== undefined)
  }, [references, projectId, name, remote])
}
