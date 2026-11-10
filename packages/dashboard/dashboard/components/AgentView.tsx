import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import type { AgentDoing, AgentMeta, AgentWorktree, OpenAgentEvent } from '../../src/index.js'
import { onAgentMainBranch, onAgentsDoing, onGitHostHome, onRetainedWorktrees } from '../rpc/reads.js'
import { useLoaded, usePolled } from '../lib/use-async.js'
import { handoffSays, useAgentHandoff } from '../lib/use-agent-handoff.js'
import { useCheckoutStatus } from '../lib/use-checkout-status.js'
import { agentOutcome, cardOutcome } from '../lib/live-state.js'
import { useAgentFeed } from '../lib/use-agent-feed.js'
import { AgentActionBar } from './AgentActionBar.js'
import { SessionRow } from './SessionRow.js'
import { startedFromBranch, startedFromMain, type StartPicks } from '../lib/started-from.js'
import { RunPrLabels } from './RunPrLabels.js'
import type { ContextSet } from '../lib/use-context-set.js'
import { AgentComposer, type QueuedMessage } from './AgentComposer.js'
import { sendNow, withdrawMessage } from '../rpc/control.js'
import type { WaitingMessage } from './EventList.js'
import { AgentWorkBar } from './AgentWorkBar.js'
import { AgentFeed } from './AgentFeed.js'
import { IssueLinks } from './Markdown.js'
import { OpenFile } from './ToolCalls.js'
import { ChatNote, ChatPane } from './ChatPane.js'
import { ActionsRunNotice } from './ActionsRunNotice.js'
import { LostStreamNotice } from './LostStreamNotice.js'
import { CloudMirrorRow, CloudAgentNotice } from './CloudAgentNotice.js'
import { ModuleSlot } from './ModulePageView.js'
import { useMountedModules } from '../lib/use-modules.js'
import { Committing, HandoffActions, HandoffSummary, isCommitAsk } from './AgentHandoff.js'
import { AgentDetails, type AgentDetailsCard } from './AgentDetails.js'
import { holdsMainAgent } from '../lib/subagents.js'
import { usePaneOpeners } from '../lib/reveal-change.js'
import { modelContextWindow, modelName, useModels } from '../lib/models.js'
import { ContextCircle } from './ContextCircle.js'
import { effortLabel } from '../lib/effort.js'
import { thisMachineName } from '../lib/this-machine.js'
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
const NOTHING_DOING: Record<string, AgentDoing> = {}

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
  remoteLabel,
  files,
  lost = false,
  writing = '',
  startedWith,
  onAgentStarted,
  contextSet,
  onDeleted,
  onProjectRemoved,
  subagents = NO_SUBAGENTS,
}: {
  projectId: string
  /** Which run this is (#749). */
  agentId: string
  /** The live channel's events for this agent — all there is while it runs. */
  events: OpenAgentEvent[]
  /** Whether the agent is still running; `null` while the daemon's list of agents has not been read, so it is not known yet. */
  live: boolean | null
  /** What the run's card says, off the runs poll: what the feed cannot carry (the details strip's facts, how the agent was set up, whether it is a subagent, whether its record is being saved). Absent until the card is listed. */
  card?: (AgentDetailsCard & Pick<AgentMeta, 'status' | 'saving' | 'parent' | 'workspace' | 'branch' | 'base' | 'baseCommit' | 'host' | 'otherHost' | 'publish' | 'prBase' | 'gitAccount' | 'earlierPrs' | 'remoteKind' | 'repos' | 'agent' | 'skillsOn' | 'skillsOff' | 'projectSkills'>) | undefined
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
  /** Where the agent executes (#1053/#610): `actions` swaps the live feed for a burst-mode affordance; `remote` is relayed to a machine (#1067); `web` is handed to a Claude Code cloud session. */
  target?: 'local' | 'actions' | 'remote' | 'web' | undefined
  /** The machine this agent executes on (#1067), when it is relayed to another one, by the name it
   *  was given: the row above the message box says it. */
  remoteLabel?: string | undefined
  files: string[]
  /** The live channel's health (#948) — surfaced as a banner under the top bar. */
  lost?: boolean
  /** The message the agent is writing, as far as it has got: shown after the feed while it runs. */
  writing?: string
  /** The prompt this page just started the agent with: shown until the agent's own prompt line arrives. */
  startedWith?: string | undefined
  /** Jump to the agent a preset or a continuation started (#959). */
  onAgentStarted?: ((intent: string, agentId: string) => void) | undefined
  /** The shell's Context, for the message box to send with the next message. */
  contextSet?: ContextSet | undefined
  /** Leave this session after it is deleted (#1032) — back to the project home. */
  onDeleted?: (() => void) | undefined
  /** Told once the project is removed from the project's menu in the top bar, to leave its page; absent, no remove is offered. */
  onProjectRemoved?: (() => void) | undefined
  /** The runs started for this run, oldest first: rows in its chat, and a line above the message box while any works. */
  subagents?: readonly AgentMeta[]
}) {
  // The log on screen: the live channel's while the agent works, its archive once it has ended.
  const { archived, shown, active, feedLive } = useAgentFeed(projectId, agentId, live, events)
  // What each working subagent is doing now, read only while one works: an ended one's row says how it ended.
  const workingSubagents = subagents.filter(agent => agent.status === 'running').map(agent => agent.id).join(',')
  // How many subagents the run's job still waits on: while any, the run is not over, whatever its own turn says.
  const now = Date.now()
  const subagentsRunning = subagents.filter(agent => holdsMainAgent(agent, now)).length
  const { value: doing } = usePolled<Record<string, AgentDoing>>(
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
  // The project's page on GitHub, where `#12` in an answer leads. Another host names its issues
  // under another path, so its numbers stay text.
  const gitHostHome = useLoaded(() => onGitHostHome(projectId), null, [projectId], { remember: `git-host-home:${projectId}` })
  const issueLinks = gitHostHome?.name === 'GitHub' ? gitHostHome.url : undefined
  // The view is mounted un-keyed, so switching agents only swaps props: per-agent latches must
  // reset by hand or the previous agent's Remove press hides this one's offer.
  useEffect(() => setRemoved(false), [agentId])
  const hasWorktree = live === false && !removed && retained.includes(agentId)

  // Whether the agent is still working. A run that stops on a question ends `waiting` rather than
  // staying up, so a live run is a working one. One not known yet is neither working nor ended:
  // nothing is read for it and the bar waits.
  const working = live === true

  // A run started for another run: it opens no pull request, its main agent lands its work.
  const subagent = card?.parent !== undefined
  // What was set up for the agent before it began, off its card: the chat's "Initialized session" line.
  const { workspace, branch, base, driver, model } = card ?? {}
  // An agent just started on a machine has no card listed yet: the machine's name says where it runs.
  const elsewhere = (target !== undefined && target !== 'local') || remoteLabel !== undefined
  const setup = useMemo(() => ({ workspace, branch, base, driver, model, elsewhere }), [workspace, branch, base, driver, model, elsewhere])
  // The model by the name its coding agent gives it, for the row under the message box.
  const picked = driverFromImpl(driver ?? picks?.driver)
  const models = useModels()
  const shownModel = model ?? picks?.model
  const modelLabel = shownModel ? modelName(picked ? models?.[picked] : undefined, shownModel) : undefined
  // The model and how hard it was told to think, as Claude Code says them under its box: the two
  // words of the session's own setup, which it keeps for its whole life.
  // Two words with a space between them, as Claude Code sets them under its box ("Opus 5  High"):
  // they are one setting read together, and a dot between made them read as two separate facts.
  const effort = card?.effort ?? picks?.effort
  const underBox = [modelLabel, effort ? effortLabel(effort) : undefined].filter(Boolean).join('\u2002') || undefined
  // How full this session's context is: the run's own last reading, against what the agent says
  // the model holds. Either missing, no circle.
  const contextWindow = modelContextWindow(models, picked, model)
  // Where the agent runs, for the row above the message box: a machine by the name it was given.
  // A run another computer started, which is no saved machine, is named by that computer: it did not run here.
  const runsOn = remoteLabel ?? (target === 'web' ? 'Cloud' : target === 'actions' ? 'GitHub Actions' : target === 'remote' ? 'Another machine' : card?.otherHost && card.host ? card.host : thisMachineName())
  // The branch it started from, for that row: its card's, or, where the card says it was origin's
  // default branch, the name that has on the computer the run is on. Read once: it never changes.
  const fromMain = startedFromMain(card)
  const mainBranch = useLoaded<string | null>(fromMain ? () => onAgentMainBranch(projectId, agentId) : null, null, [projectId, agentId, fromMain], { remember: `main-branch:${projectId}:${agentId}` })
  const startedFrom = startedFromBranch(card, mainBranch) ?? picks?.branch
  const [open, setOpen] = useState(false)
  // What the installed modules add to this run's page: a summary in the bar above the message box.
  const runSlots = useMountedModules().runSlots.filter(slots => slots.projects.includes(projectId))
  // What a row of the chat opens in a pane beside it: a changed file, a file a step names
  // ("Read index.html"), a live screen, a subagent.
  const { onOpenChange, onOpenFile, onOpenScreen, onOpenSubagent } = usePaneOpeners(projectId, agentId)
  const toggle = useCallback(() => setOpen(o => !o), [])

  // The messages on their way to the agent, from the box under the chat to the feed above it.
  const { sending: shownSending, onSending, waiting, onQueued, editInBox } = useMessagesOnTheirWay(projectId, agentId, shown, feedLive, startedWith)
  // The agent works, or is about to: on a message just sent, or as its feed shows before the
  // agents poll does.
  const going = feedLive || shownSending !== undefined
  // The agent's checkout (its branch, its pull request, clean or dirty, its size), read once for
  // the top bar and for the bar above the message box, and again the moment a turn starts or ends.
  const checkout = useCheckoutStatus(projectId, agentId, active)
  // What the branch holds (#1023), read once for the bar above the message box. Read once
  // the agent stops rather than once the process does: while it is still writing to the branch
  // there is nothing to hand off yet, but a parked session's branch is finished work. "Stops" is
  // as the feed knows it: read off the agents poll alone, the last step stayed in the bar, its
  // button with it, for the seconds an agent sent a new message already worked. While the
  // card says saving, the checkout is being cleaned up, and an empty branch is deleted with it, so
  // a publish offered then turned into "Branch gone" moments later: the answer is only shown then
  // for a branch with commits of its own, which the clean-up keeps.
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
  // Until the handoff has actually loaded, a just-stopped agent keeps showing the modules' summaries
  // (the Changes module's count of changed files, #1030): the summary swaps once, to the handoff,
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
  // is unread, the live channel's events, "Loading agent…" while the archive is out, and only then
  // the archived log. It stays blank instead until the agent is known to run, its archive has answered, or the second
  // has passed, so it fills in one step. Once it has shown this agent it keeps showing it: an
  // agent that stops while watched keeps its events on screen while the archive is read.
  const [settledFor, setSettledFor] = useState<string | null>(null)
  const feedSettled = settledFor === agentId || working || archived !== null || waitedFor === agentId
  useEffect(() => {
    if (feedSettled) setSettledFor(agentId)
  }, [feedSettled, agentId])

  // The agent has ended, its subagents too: the next step is offered from here on.
  const ended = ready && live === false && !going && subagentsRunning === 0
  // The bar's branch and pull request: the checkout's read, and where it has none, the branch's.
  // The checkout's read answers without them for the moment its folder is being removed, and a bar
  // with no branch went away until the next read.
  const onBranch = handoff.handoff
  const barCheckout = useMemo<AgentWorktree | null>(() => {
    const branch = checkout?.branch ?? onBranch?.branch
    const pr = checkout?.pr ?? onBranch?.pr
    return branch === undefined ? checkout : { ...checkout, branch, ...(pr ? { pr } : {}) }
  }, [checkout, onBranch])
  const pr = barCheckout?.pr
  // Over: the pull request is merged or closed (his pick: the bar goes, it does not stay as a
  // label), or the work was landed without one, and the branch holds nothing the request does not.
  // There is no step left. The request itself is not lost with the bar: it is under the message box.
  const over =
    live === false &&
    (onBranch?.landed === true ||
      ((onBranch?.merged === true || pr?.state === 'MERGED' || pr?.state === 'CLOSED') && !onBranch?.pendingFiles?.length && onBranch?.movedPastPr !== true))
  // Whether the bar above the message box has something to say: a pull request, a commit going
  // on, uncommitted changes while the agent works, or, once it has ended and its branch is read,
  // what the branch holds. An agent that changed nothing has no bar. A bar that is there stays
  // while the agent works (it committed: its checkout is clean again) and while an ended agent's
  // branch is still being read, so it never goes and comes back.
  //
  // Once the bar has something to say for this run it keeps it (`|| held`): a run makes its own
  // last commit while it cleans up, after its turn ends, and the branch read taken in between
  // answers for a branch that holds nothing — which used to hide the bar for the seconds until the
  // next read. The read itself now comes a second later rather than fifteen (`SETTLING_MS`).
  const lastSay = useRef<{ agentId: string | null; say: boolean }>({ agentId: null, say: false })
  const held = lastSay.current.agentId === agentId && lastSay.current.say
  // Whether the run's pull request is merged is not known until the git host has answered, and
  // until then the read calls the request open: a bar shown on that word, on a first visit, went
  // again the moment the request turned out merged. So a bar not up yet waits for the answer; one
  // already up stays while its request is read again. A run with no request waits for nothing.
  // The same for the branch's read of an ended run: its request, and with it the next step, is
  // still being looked up, and a bar shown before came up without them and grew them a moment later.
  const prUnknown = !held && ((checkout?.pr !== undefined && checkout.prPending === true) || (live === false && onBranch?.prPending === true))
  // An ended run's bar comes up once its branch is read, all of it at once: shown on the pull
  // request alone, it came up with the request's number and grew the work and the next step a
  // moment later. So does a run not known yet to be going or ended, until the list of runs says.
  const say =
    !over &&
    (committing ||
      (!prUnknown &&
        (live === false
          ? handoff.loaded
            ? pr !== undefined || handoffSays(onBranch) || held
            : held
          : live === true
            ? pr !== undefined || checkout?.checkout?.dirty === true || held
            : held)))
  lastSay.current = { agentId, say }
  // Every pull request the run opened, for the row under the message box: the ones before, then the one it is on.
  const earlierPrs = card?.earlierPrs
  const prs = useMemo(() => [...(earlierPrs ?? []), ...(pr && !earlierPrs?.some(earlier => earlier.url === pr.url) ? [pr] : [])], [earlierPrs, pr])
  // Where the session started, right above the message box, as the "New agent session" page has it. It is
  // there whatever stands in the box's place.
  const row = <SessionRow runsOn={runsOn} target={target} remoteKind={card?.remoteKind} elsewhere={elsewhere || card?.otherHost === true} projectName={projectName} startedFrom={startedFrom} worksOn={barCheckout?.branch ?? branch} repos={card?.repos ?? picks?.repos} />
  // What the bar is about right now, so the ✕ hides this and not the next thing the agent does:
  // the run, its branch, how much work is on it, and where that work has got to.
  const workState = [agentId, barCheckout?.branch ?? '', onBranch?.commits.length ?? 0, onBranch?.pendingFiles?.length ?? 0, onBranch?.insertions ?? 0, onBranch?.deletions ?? 0, onBranch?.pushed ?? false, pr?.number ?? '', pr?.state ?? ''].join('|')

  return (
    <ChatPane
      top={
        <>
          <AgentActionBar
            projectId={projectId}
            agentId={agentId}
            events={shown}
            label={label}
            naming={naming}
            retainedWorktree={hasWorktree}
            onWorktreeRemoved={onWorktreeRemoved}
            onDeleted={onDeleted}
            onProjectRemoved={onProjectRemoved}
            expanded={open}
            onToggle={toggle}
            ready={ready}
            checkout={checkout}
          />
          {/* The always-available session-details strip: agent + spend (#322). What the run changed is
              in the Changes pane, not here. */}
          {open && <AgentDetails events={shown} card={card} {...(checkout?.pr ? { pr: checkout.pr } : {})} />}
          {/* A GitHub Actions run replays in a burst at the end (#1053), so the live feed looks stalled:
              say the wait is expected and link through to the live Actions run. */}
          <ActionsRunNotice target={target} events={shown} live={working} />
          {/* A run handed to Claude Code on the web (#610): the work is happening in a cloud session
              this machine cannot stream, so point at where it is rather than show an empty feed. */}
          <CloudAgentNotice target={target} events={shown} projectId={projectId} agentId={agentId} />
          {lost && <LostStreamNotice />}
        </>
      }
      bottom={
        <>
          {/* Where the work is and the next step, above the message box and its row. */}
          <AgentWorkBar
            checkout={barCheckout}
            summary={
              ready &&
              (showHandoff ? (
                <HandoffSummary handoff={handoff.handoff} subagent={subagent} />
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
            error={ready && showHandoff ? handoff.error : undefined}
            show={say}
            state={workState}
          />
          {card?.otherHost && card.host ? (
            // A run another computer started, which is no saved machine, is only read here: a
            // message would continue it on this computer, under its id, with this computer's
            // logins and none of its conversation.
            <div className="mx-auto w-full max-w-3xl p-2">
              {row}
              <p role="note" className="rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
                {`This run is on ${card.host}. Continue it there.`}
              </p>
            </div>
          ) : (
          <AgentComposer
            projectId={projectId}
            agentId={agentId}
            live={feedLive}
            files={files}
            onAgentStarted={onAgentStarted}
            onSending={onSending}
            onQueued={onQueued}
            editInBox={editInBox}
            model={underBox}
            {...(contextWindow !== undefined ? { context: <ContextCircle used={card?.contextTokens ?? 0} size={contextWindow} /> } : {})}
            controls={<RunPrLabels prs={prs} />}
            contextSet={contextSet}
            // A card with no level has none: a message may have taken it away.
            publish={card ? card.publish : picks?.publish}
            prBase={card?.prBase ?? picks?.prBase}
            row={row}
            agent={card?.agent ?? picks?.agent}
            gitHost={gitHostHome}
            gitAccount={card?.gitAccount ?? picks?.gitAccount}
            // The picks as the record keeps them; the launcher's until it is there.
            {...(card ? { skillsOn: card.skillsOn, skillsOff: card.skillsOff, projectSkills: card.projectSkills } : { skillsOn: picks?.skillsOn, skillsOff: picks?.skillsOff, projectSkills: picks?.projectSkills })}
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
        <AgentFeed
          key={agentId}
          events={shown}
          projectId={projectId}
          agentId={agentId}
          onSaid={onSending}
          writing={feedLive ? writing : ''}
          {...(shownSending !== undefined ? { sending: shownSending } : {})}
          working={feedLive || shownSending !== undefined}
          queued={waiting}
          waitingOn={!going && live === false && outcome?.ok !== false && !outcome?.waiting ? subagentsRunning : 0}
          {...(feedLive ? {} : { openAt: 'end' as const, emptyLabel: 'This agent has no events.' })}
          // A message just sent to an ended agent: the chat follows its end from the send on, not
          // only once the agent's own line arrives, by which time the chat had grown past the view.
          {...(going ? {} : { stick: false })}
          // A web agent's log dead-ends at the hand-off (#1265): the mirror box rides the tail of
          // the scroller, where "and then…" belongs. Self-nulling for every other target.
          tail={<CloudMirrorRow target={target} events={shown} />}
          subagents={subagents}
          doing={doing}
          setup={setup}
          onOpenSubagent={onOpenSubagent}
          onOpenChange={onOpenChange}
          onOpenScreen={onOpenScreen}
        />
        </OpenFile.Provider>
        </IssueLinks.Provider>
      )}
    </ChatPane>
  )
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
  shown: readonly OpenAgentEvent[],
  feedLive: boolean,
  startedWith: string | undefined,
): {
  sending: string | undefined
  onSending: (text: string | null) => void
  waiting: WaitingMessage[]
  onQueued: (message: QueuedMessage) => void
  /** Set by the composer to what puts a text back in its box: Cancel and edit on a waiting message. */
  editInBox: MutableRefObject<((text: string) => void) | null>
} {
  // The message just sent to an ended run, shown at the end of the feed until its own prompt line
  // arrives: the continuation writes that line only once its checkout is back, seconds later.
  const [sending, setSending] = useState<{ text: string; prompts: number } | null>(null)
  useEffect(() => setSending(null), [agentId])
  const prompts = shown.filter(e => e.kind === 'driver' && e.event.type === 'start').length
  useEffect(() => {
    if (sending && prompts > sending.prompts) setSending(null)
  }, [sending, prompts])
  const onSending = useCallback((text: string | null) => setSending(text === null ? null : { text, prompts }), [prompts])
  // The messages sent while the agent works that it has not read yet, each shown waiting until the
  // agent reads it: at its next step, where its `steered` line lands, or, sent for later or not
  // taken in time, as the prompt of its next turn. An agent that stopped working without reading
  // them (it failed, it was stopped) shows them no longer.
  const [queued, setQueued] = useState<(QueuedMessage & { prompts: number })[]>([])
  useEffect(() => setQueued([]), [agentId])
  const isRead = useMemo(() => {
    const steered = new Set(shown.flatMap(e => (e.kind === 'driver' && e.event.type === 'steered' && e.event.id !== undefined ? [e.event.id] : [])))
    const starts = shown.flatMap(e => (e.kind === 'driver' && e.event.type === 'start' ? [e.event.prompt] : []))
    return (message: QueuedMessage & { prompts: number }) => steered.has(message.id) || starts.slice(message.prompts).includes(message.text)
  }, [shown])
  const unread = queued.filter(message => !isRead(message))
  useEffect(() => {
    if (unread.length !== queued.length) setQueued(unread)
  }, [unread.length, queued.length]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (queued.length === 0 || feedLive) return
    const timer = setTimeout(() => setQueued([]), QUEUED_UNREAD_MS)
    return () => clearTimeout(timer)
  }, [queued.length, feedLive])
  const onQueued = useCallback((message: QueuedMessage) => setQueued(was => [...was, { ...message, prompts }]), [prompts])
  // Cancel and edit puts the message back in the box; the composer says how.
  const editInBox = useRef<((text: string) => void) | null>(null)
  const waiting: WaitingMessage[] = unread.map(({ prompts: _prompts, ...message }) => ({
    ...message,
    onSendNow: () => void sendNow(projectId, agentId),
    onEdit: () => {
      setQueued(was => was.filter(other => other.id !== message.id))
      void withdrawMessage(projectId, agentId, message.id)
      editInBox.current?.(message.text)
    },
  }))
  return {
    // A run just started writes its prompt line only once its record is saved and its checkout made.
    // Told apart from the prompts in the same draw that brings the prompt's line, not an effect
    // later: for that one frame the message was in the chat twice.
    sending: (sending && prompts <= sending.prompts ? sending.text : undefined) ?? (startedWith && prompts === 0 ? startedWith : undefined),
    onSending,
    waiting,
    onQueued,
    editInBox,
  }
}
