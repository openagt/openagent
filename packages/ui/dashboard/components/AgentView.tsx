import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type MutableRefObject } from 'react'
import type { AgentMeta, AgentWorktree, OpenAgentEvent } from '../../src/index.js'
import { onAgentMainBranch, onGitHostHome, onRetainedWorktrees } from '../rpc/reads.js'
import { useLoaded } from '../lib/use-async.js'
import { handoffSays, useAgentHandoff } from '../lib/use-agent-handoff.js'
import { useCheckoutStatus } from '../lib/use-checkout-status.js'
import { agentOutcome, cardOutcome, pendingChoices, shownStatus } from '../lib/live-state.js'
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
import { useWorkBarAway } from '../lib/work-bar-away.js'
import { useAction } from '../lib/use-action.js'
import { keepSending, keepWaiting, keptSending, keptWaiting, onKeptWaiting } from '../lib/draft-handoff.js'
import { AgentFeed } from './AgentFeed.js'
import { IssueLinks } from '../lib/markdown-links.js'
import { OpenFile } from './ToolCalls.js'
import { ChatNote, ChatPane } from './ChatPane.js'
import { LostStreamNotice } from './LostStreamNotice.js'
import { ModuleSlot } from './ModulePageView.js'
import { useMountedModules } from '../lib/use-modules.js'
import { Committing, HandoffActions, HandoffSummary, isCommitAsk } from './AgentHandoff.js'
import { AgentDetails, type AgentDetailsCard } from './AgentDetails.js'
import { usePaneOpeners } from '../lib/reveal-change.js'
import { modelContextWindow, modelName, useModels } from '../lib/models.js'
import { ContextCircle } from './ContextCircle.js'
import { effortLabel } from '../lib/effort.js'
import { hostOf, useRunHosts } from '../lib/run-hosts.js'
import { THIS_MACHINE } from './RunOnMenu.js'
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
  onProjectRemoved,
}: {
  projectId: string
  /** Which run this is (#749). */
  agentId: string
  /** The live channel's events for this agent — all there is while it runs. */
  events: OpenAgentEvent[]
  /** Whether the agent is still running; `null` while the daemon's list of agents has not been read, so it is not known yet. */
  live: boolean | null
  /** What the run's card says, off the runs poll: what the feed cannot carry (the details strip's facts, how the agent was set up, whether its record is being saved). Absent until the card is listed. */
  card?: (AgentDetailsCard & Pick<AgentMeta, 'status' | 'intent' | 'saving' | 'workspace' | 'branch' | 'base' | 'baseCommit' | 'host' | 'otherHost' | 'publish' | 'prBase' | 'gitAccount' | 'earlierPrs' | 'pr' | 'prState' | 'repos' | 'profile' | 'pluginsWithout' | 'projectSkills'> & Partial<Pick<AgentMeta, 'endedAt'>>) | undefined
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
  /** Where the agent executes: a host beside this computer's, by its id (`run.host`: GitHub Actions' `actions`, Claude Code on the web's `web`); none, or `local`, for this computer's. */
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
  /** Told once the project is removed from the project's menu in the top bar, to leave its page; absent, no remove is offered. */
  onProjectRemoved?: (() => void) | undefined
}) {
  // The log on screen: the live channel's while the agent works, its archive once it has ended.
  const { archived, shown, active, feedLive } = useAgentFeed(projectId, agentId, live, events, replayed)
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

  // What was set up for the agent before it began, off its card: the chat's "Initialized session" line.
  const { workspace, branch, base, driver, model } = card ?? {}
  // An agent just started on a host has no card listed yet: the host's name says where it runs.
  const elsewhere = (target !== undefined && target !== 'local') || startedOn !== undefined
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
  // Where the agent runs, for the row above the message box: a host by its own name. A run another
  // computer started is named by that computer: it did not run here.
  const host = hostOf(target)
  const hosts = useRunHosts(host !== undefined ? projectId : null)
  const runsOn = startedOn ?? (host !== undefined ? (hosts.find(one => one.id === host)?.label ?? 'Another host') : card?.otherHost && card.host ? card.host : THIS_MACHINE)
  // The branch it started from, for that row: its card's, or, where the card says it was origin's
  // default branch, the name that has in the project's clone. Read once: it never changes.
  const fromMain = startedFromMain(card)
  const mainBranch = useLoaded<string | null>(fromMain ? () => onAgentMainBranch(projectId) : null, null, [projectId, fromMain], { remember: `main-branch:${projectId}` })
  const startedFrom = startedFromBranch(card, mainBranch) ?? picks?.branch
  const [open, setOpen] = useState(false)
  // What the installed modules add to this run's page: a summary in the bar above the message box.
  const summaries = useMountedModules().views['chat.summary'].filter(summary => summary.projects.includes(projectId))
  // And a strip above the chat: a host's word on a run it runs, say where the run is.
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
  // chat of a run just starting ("Starting Claude Code 12m 36s"), for the moment the replay took.
  const replaying = working && !replayed
  const standIn = card?.intent ?? startedWith
  const standsIn = standIn !== undefined && !replaying && !(live !== false && startedWith !== undefined) && !shown.some(e => e.kind === 'driver' && e.event.type === 'start')
  const startedAt = card?.startedAt
  const chat = useMemo<OpenAgentEvent[]>(
    () => (standsIn ? [{ kind: 'driver', event: { type: 'start', prompt: standIn }, ...(startedAt !== undefined ? { at: startedAt } : {}) }, ...shown] : shown),
    [standsIn, standIn, startedAt, shown],
  )
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
  const handoff = card?.saving && !kept ? { ...read, handoff: null, state: 'unknown' as const } : read
  const branchKnown = handoff.state !== 'unknown'
  // The agent is doing what the Commit button asked: said where the button was, from the ask going
  // out until the next step is known, so the place is never empty in between: the agent's turn
  // ends, its checkout is cleaned up, and only then is its branch read. Read off the last prompt,
  // so a refresh says the same.
  const lastPrompt = shownSending ?? [...shown].reverse().find(e => e.kind === 'driver' && e.event.type === 'start')
  const commitAsked = isCommitAsk(typeof lastPrompt === 'string' ? lastPrompt : lastPrompt?.kind === 'driver' && lastPrompt.event.type === 'start' ? lastPrompt.event.prompt : undefined)
  const committing = commitAsked && (going || (live === false && !branchKnown))
  // How the agent ended (#948), read once for the Resume offer below:
  // its events say it, and until they are read (or when they hold no ending) its card does, so
  // both are right from the first frame.
  const outcome = working ? undefined : (agentOutcome(shown) ?? (card ? cardOutcome(card.status) : undefined))
  // Until the handoff has actually loaded, a just-stopped agent keeps showing the modules' summaries
  // (the Changes module's count of changed files, #1030): the summary swaps once, to the handoff,
  // instead of blanking for the beat the handoff read takes.
  const showHandoff = live === false && branchKnown
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
  const branchRead = card?.saving === true || (branchKnown && !handoff.handoff?.prPending)
  const ready = working || waitedFor === agentId || (archived !== null && branchRead)
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

  // The agent has ended: the next step is offered from here on.
  const ended = ready && live === false && !going
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
  // The run's state after its name. The list of runs already says how an ended run ended and
  // whether its pull request merged, as its row in the sidebar shows, so the bar says that from
  // the first frame and never waits for this page's own reads: waiting for them, a switch to a
  // merged run showed nothing, then "Done", then "Merged". Once the reads are in, the chat's own
  // events say a question waits or how the last turn ended.
  const merged = pr?.state === 'MERGED' || card?.prState === 'merged'
  const status = ready
    ? shownStatus(live === null && !feedLive ? null : feedLive, feedLive && pendingChoices(shown).length > 0, outcome, merged)
    : live === false && card
      ? shownStatus(false, false, cardOutcome(card.status), card.prState === 'merged')
      : undefined
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
          ? branchKnown
            ? pr !== undefined || handoffSays(onBranch) || held
            : held
          : live === true
            ? pr !== undefined || checkout?.checkout?.dirty === true || held
            : held)))
  lastSay.current = { agentId, say }
  // Every pull request the run opened, for the row under the message box: the ones before, then the one it is on.
  const earlierPrs = card?.earlierPrs
  // How the request it is on stands is the git host's to say, and until it has answered the
  // page's read calls the request open: a merged request's label said "open" for a second, then
  // "merged", and pushed the labels beside it over. The list of runs has the git host's last word
  // already, as the run's row shows, so the label says that until this page's read is in, and
  // from the first frame, before the read has named the request at all.
  const prStateOut = checkout?.prPending === true || onBranch?.prPending === true
  const listedPr = card?.pr
  const listedState = card?.prState
  const labelPr = useMemo(() => {
    if (pr === undefined) return listedPr ? { ...listedPr, state: listedState } : undefined
    if (!prStateOut) return pr
    return { number: pr.number, url: pr.url, state: listedPr?.number === pr.number ? listedState : undefined }
  }, [pr, prStateOut, listedPr, listedState])
  const prs = useMemo(() => [...(earlierPrs ?? []), ...(labelPr && !earlierPrs?.some(earlier => earlier.url === labelPr.url) ? [labelPr] : [])], [earlierPrs, labelPr])
  // Where the session started, right above the message box, as the "New agent session" page has it. It is
  // there whatever stands in the box's place.
  const row = <SessionRow runsOn={runsOn} target={target} elsewhere={elsewhere || card?.otherHost === true} projectName={projectName} startedFrom={startedFrom} worksOn={barCheckout?.branch ?? branch} repos={card?.repos ?? picks?.repos} />
  // What the bar is about right now, so the ✕ hides this and not the next thing the agent does:
  // the run, its branch, how much work is on it, and where that work has got to.
  const workState = [agentId, barCheckout?.branch ?? '', onBranch?.commits.length ?? 0, onBranch?.pendingFiles?.length ?? 0, onBranch?.insertions ?? 0, onBranch?.deletions ?? 0, onBranch?.pushed ?? false, pr?.number ?? '', pr?.state ?? ''].join('|')
  // Put away, Session actions brings it back: the run may still wait on the person for its next step.
  const workBar = useWorkBarAway(agentId, workState)

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
            onWorktreeRemoved={onWorktreeRemoved}
            onDeleted={onDeleted}
            onBack={onBack}
            onProjectRemoved={onProjectRemoved}
            expanded={open}
            onToggle={toggle}
            ready={ready}
            checkout={checkout}
            status={status}
            {...(workBar.away && say ? { onShowWorkBar: workBar.show } : {})}
          />
          {/* The always-available session-details strip: agent + spend (#322). What the run changed is
              in the Changes pane, not here. */}
          {open && <AgentDetails events={shown} card={card} {...(checkout?.pr ? { pr: checkout.pr } : {})} />}
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
          {/* Where the work is and the next step, above the message box and its row. */}
          <AgentWorkBar
            checkout={barCheckout}
            summary={
              ready &&
              (showHandoff ? (
                <HandoffSummary handoff={handoff.handoff} />
              ) : (
                summaries.map(({ View: Summary, id, package: pkg }) => (
                  <ModuleSlot key={`${pkg}/${id}`} package={pkg} label="run summary">
                    <Summary projectId={projectId} agentId={agentId} working={working} />
                  </ModuleSlot>
                ))
              ))
            }
            actions={
              // A run that is working is still writing its branch; the next step is offered once it has ended.
              // Keyed: what a press said, and a merge it armed, are that session's alone.
              committing ? <Committing /> : ended ? <HandoffActions key={`${projectId}/${agentId}`} projectId={projectId} agentId={agentId} state={handoff} onAsked={onSending} /> : undefined
            }
            error={ready && showHandoff ? handoff.error : undefined}
            show={say}
            away={workBar.away}
            onHide={workBar.hide}
          />
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
            model={underBox}
            {...(contextWindow !== undefined ? { context: <ContextCircle used={card?.contextTokens ?? 0} size={contextWindow} /> } : {})}
            controls={<RunPrLabels prs={prs} />}
            contextSet={contextSet}
            // A card with no level has none: a message may have taken it away.
            publish={card ? card.publish : picks?.publish}
            prBase={card?.prBase ?? picks?.prBase}
            row={row}
            profile={card?.profile ?? picks?.profile}
            gitHost={gitHostHome}
            gitAccount={card?.gitAccount ?? picks?.gitAccount}
            // The picks as the record keeps them; the launcher's until it is there.
            {...(card ? { pluginsWithout: card.pluginsWithout, projectSkills: card.projectSkills } : { pluginsWithout: picks?.pluginsWithout, projectSkills: picks?.projectSkills })}
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
  shown: readonly OpenAgentEvent[],
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
