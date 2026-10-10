import { sayToRun, type SteerResult } from '../dashboard/run-inbox.js'
export type { SteerResult }
import { bridgeQuestions } from '../dashboard/bridge-store.js'
import { openInApp, type OpenTarget, type OpenResult } from '../dashboard/open-in-app.js'
import { contextBridgeBrowser, contextPreferences, contextStartAgent, resolveProjectPath, resolveAgentPath } from './context.js'
import type { BridgeBrowserAction } from '../bridge-browser.js'
import { relayOr } from './relay-agent.js'
import { hostname } from 'node:os'
import { findAgent, isPidAlive, isRunId, loadAgentEvents, projectRuns, readLiveMetas, type AgentMeta } from '../store/index.js'
import { withAgentLock } from '../agent-locks.js'
import { removeProjectWorktree, deleteProjectAgent } from '../worktrees.js'
import { mergeAgentPr, openAgentPullRequest, mergeAgentBranch, pushAgentBranch, type HandoffResult } from '../dashboard/agent-handoff.js'
import { pendingChoices } from '../open-choices.js'
import { createRepository, type CreateRepositoryResult } from '../store/repository.js'
import { providedDataChanged } from '../store/provided.js'
import type {
  DeleteAgentResult,
  RemoveWorktreeResult,
  StartAgentOptions,
  StartAgentResult,
} from '../dashboard/types.js'
import type { Preferences } from '../registry.js'

/**
 * The key every action on one run locks under (`agent-locks.ts`): a Remove, a Delete and an Open
 * PR on the same run each run their own git; serialized, whichever runs second finds the state
 * the first one left and acts on that. The project and the run's id, not the checkout's path:
 * the path is the branches provider's to know, and an Open PR on a run whose checkout is gone
 * still locks the run.
 */
export function agentLockKey(cwd: string, agentId: string): string {
  return `${cwd}\0${agentId}`
}

// The write side behind the dashboard (#405, #1774). The daemon runs no agent, so every write here
// reaches a run through what the run's tool reads: Start is the project's `start` hook line; what
// a person says to a run (their words, their answer to its question) is a line in the run's inbox
// file while the run works, and the project's `resume` hook line once it has ended; Stop is a
// signal to the pid the run's card names. OpenAgent names no tool in any of them.

/**
 * Stop a live agent (the Stop button): SIGINT to the process the run's own card names, when it is
 * this machine's and alive. The card is the file the dashboard shows the run from, and its pid is
 * whoever runs the agent; OpenAgent names no tool. Nothing else: a run without a live pid
 * here has nothing to stop.
 */
export async function sendStop(projectId: string, agentId?: string): Promise<void> {
  return relayOr(agentId, 'sendStop', [projectId, agentId], async () => {
    const cwd = await resolveProjectPath(projectId)
    if (!cwd || !agentId) return
    const meta = (await readLiveMetas(cwd).catch(() => [])).find(agent => agent.id === agentId)
    if (!meta || meta.status !== 'running' || meta.pid === undefined || meta.host !== hostname() || !isPidAlive(meta.pid)) return
    try {
      process.kill(meta.pid, 'SIGINT')
    } catch {
      // Gone between the probe and the signal.
    }
  }, undefined)
}

/**
 * Answer the question a run stopped on (#304, #1774). `pick` is one option id, or the chosen
 * subset of a multi-select; the answer handed to the run is the chosen labels, read off the
 * question as the run's own diary holds it, so only what the agent offered can be answered.
 */
export async function sendChoice(projectId: string, id: string, pick: string | string[], agentId?: string): Promise<SteerResult> {
  return relayOr(agentId, 'sendChoice', [projectId, id, pick, agentId], async (): Promise<SteerResult> => {
    const cwd = await resolveProjectPath(projectId)
    if (!cwd || !agentId || !isRunId(agentId)) return { ok: false, error: 'unknown session' }
    const question = pendingChoices((await loadAgentEvents(cwd, agentId).catch(() => undefined)) ?? []).find(choice => choice.id === id)
    if (!question) return { ok: false, error: 'that question is no longer open' }
    const picked = [pick].flat()
    const labels = question.options.filter(option => picked.includes(option.id)).map(option => option.label)
    if (labels.length !== picked.length) return { ok: false, error: 'every pick must be one of the question\'s options' }
    if (!question.multi && labels.length !== 1) return { ok: false, error: 'pick exactly one option' }
    return sayToRun(cwd, agentId, { kind: 'answer', question: question.title, answer: labels.length ? labels.join(', ') : '(none)' })
  }, { ok: false, error: 'could not reach the machine' })
}

/**
 * Queue the user's pick for the question a Claude web session is parked on (#1237).
 *
 * Not a line for a run like {@link sendChoice}: a cloud agent has no run here to hand it to, so
 * the pick goes to the bridge store, where the browser extension collects it, types
 * it into the session's composer and submits. Only labels of the currently parked question are
 * accepted — one, or a multi-select's subset — and the daemon composes the text typed from them,
 * so this can never put arbitrary text in front of another product's agent. Local only, no
 * relay: the bridge lives on the daemon the extension talks to.
 */
export async function sendBridgeAnswer(sessionId: string, labels: string[]): Promise<{ ok: boolean; error?: string }> {
  if (typeof sessionId !== 'string' || !/^session_[A-Za-z0-9]{1,128}$/.test(sessionId)) return { ok: false, error: 'unknown session' }
  if (!Array.isArray(labels) || !labels.every(label => typeof label === 'string' && label.trim())) return { ok: false, error: 'answer labels are required' }
  const queued = bridgeQuestions().queueAnswer(sessionId, labels)
  return typeof queued === 'string' ? { ok: false, error: queued } : { ok: true }
}

/** Withdraw a queued bridge answer (#1237). A no-op once the extension has delivered it. */
export async function sendBridgeAnswerCancel(sessionId: string): Promise<void> {
  if (typeof sessionId !== 'string' || !/^session_[A-Za-z0-9]{1,128}$/.test(sessionId)) return
  bridgeQuestions().cancelAnswer(sessionId)
}

/**
 * Say something to a run (#714, #1774): the person's own words, the next prompt of the same
 * conversation. A run that is working takes them when its turn ends; an ended run is resumed
 * with them. Empty messages are dropped.
 */
export async function sendMessage(projectId: string, text: string, agentId?: string): Promise<SteerResult> {
  const message = text.trim()
  if (!message) return { ok: true }
  return relayOr(agentId, 'sendMessage', [projectId, text, agentId], async (): Promise<SteerResult> => {
    const cwd = await resolveProjectPath(projectId)
    if (!cwd || !agentId || !isRunId(agentId)) return { ok: false, error: 'unknown session' }
    return sayToRun(cwd, agentId, { kind: 'message', text: message })
  }, { ok: false, error: 'could not reach the machine' })
}

/**
 * Remove a retained worktree (#737). An agent that failed or was stopped keeps its checkout so you
 * can inspect it; this is the explicit cleanup for one, since nothing removes them on a timer.
 *
 * The checks and the removal are {@link removeProjectWorktree}'s, shared with the CLI's removal
 * path (#982) so the surfaces cannot drift again; this adds only the agent lock around them.
 */
export async function sendRemoveWorktree(projectId: string, agentId: string): Promise<RemoveWorktreeResult> {
  return withWorktreeRemoval(projectId, agentId, cwd => removeProjectWorktree(cwd, agentId))
}

/**
 * Shared body of the two worktree-removing writes (#982/#1032): resolve the project and refuse
 * when it has no local path. Only the removal action and its result shape differ.
 */
async function withWorktreeRemoval<T>(projectId: string, agentId: string, remove: (cwd: string) => Promise<T>): Promise<T | { ok: false; error: string }> {
  const cwd = await resolveProjectPath(projectId)
  if (!cwd) return { ok: false, error: 'this project has no local path on this server' }
  // Under the agent lock: a Remove/Delete and an Open PR on the same finished run each run their
  // own git in its checkout; serialized, whichever runs second finds the state the first one left
  // and acts on that.
  return withAgentLock(agentLockKey(cwd, agentId), () => remove(cwd))
}

/**
 * Delete a session (#1032): remove it from the dashboard, records and all — the sibling of
 * {@link sendRemoveWorktree}, and the one destructive-of-history action, so its surface confirms
 * first. The checks, the worktree removal and what it leaves behind (the branch and its
 * commits) are all {@link deleteProjectAgent}'s; this adds only the agent lock around them.
 */
export async function sendDeleteAgent(projectId: string, agentId: string): Promise<DeleteAgentResult> {
  return withWorktreeRemoval(projectId, agentId, cwd => deleteProjectAgent(cwd, agentId))
}

/**
 * Start a run in the project (#405, #1774): the project's own `start` hook line, reached through
 * the daemon's wired `startAgent` (which relays to a saved machine when the options name
 * one). Answers the id of the run the hook began, or why there is none: a project without the
 * line cannot start a run from here.
 */
export async function sendStart(projectId: string, prompt: string, options: StartAgentOptions = {}): Promise<StartAgentResult> {
  // Throws on an unwired context (D3): there is one host and it wires everything, so "not
  // enabled on this server" stopped being a state a request can find.
  const startAgent = contextStartAgent()
  const text = prompt.trim()
  if (!text) return { ok: false, error: 'a non-empty prompt is required' }
  return startAgent(text, options, projectId)
}

/**
 * Open a project in the OS file manager or an editor (#490). Localhost-only: the daemon
 * spawns a local command against the project's own registered path. A public host has no
 * local path to resolve, so it returns an error rather than spawning anything.
 *
 * With a `agentId` it opens that session's own checkout instead (#798) — the whole point of
 * opening it is to look at what the agent is doing, which is not in the project's tree.
 */
export async function sendOpenInApp(projectId: string, target: OpenTarget, agentId?: string): Promise<OpenResult> {
  const cwd = agentId ? await resolveAgentPath(projectId, agentId) : await resolveProjectPath(projectId)
  if (!cwd) return { ok: false, error: 'this project has no local path on this server' }
  // #727: honour the stored editor preference; absent falls back to $OPENAGENT_EDITOR, then `code`.
  const editor =
    target === 'editor' ? (await contextPreferences()?.read().catch((): Preferences => ({})))?.editor : undefined
  return openInApp(cwd, target, undefined, editor)
}

/**
 * The session's own branch, or undefined when the run/project is unknown. Shared by the two
 * handoff actions so they address exactly what {@link onAgentHandoff} reports on.
 */
async function handoffTargetFor(
  projectId: string,
  agentId: string,
): Promise<{ cwd: string; agent: AgentMeta; checkout: string } | undefined> {
  const cwd = await resolveProjectPath(projectId)
  if (!cwd || !isRunId(agentId)) return undefined
  const agent = await findAgent(cwd, agentId).catch(() => undefined)
  // The branch is read from the project repo; the tree the agent edited is its own checkout (#453),
  // and for a session that has not committed, that is the only place its work exists.
  const checkout = (await resolveAgentPath(projectId, agentId)) ?? cwd
  return agent ? { cwd, agent, checkout } : undefined
}

/**
 * Open a PR for a finished session's branch (#799): the project's branches provider pushes it
 * first if the remote lacks it (#1774).
 *
 * The title and body come from what the agent already recorded: the branch the agent named its
 * work with and the intent the user asked for. Nothing new is invented and nothing extra is asked
 * of the user, which is the point of "offer the next step rather than describe it".
 */
export async function sendOpenPullRequest(projectId: string, agentId: string, options: { draft?: boolean } = {}): Promise<HandoffResult> {
  return relayOr(agentId, 'sendOpenPullRequest', [projectId, agentId, options], async () => {
    const target = await handoffTargetFor(projectId, agentId)
    if (!target) return { ok: false, error: 'unknown session' }
    // Under the agent lock, so the provider's push inside `openAgentPullRequest` cannot race a
    // Remove of the same checkout.
    const opened = await withAgentLock(agentLockKey(target.cwd, agentId), () => openAgentPullRequest(target.cwd, target.agent, options.draft === true ? { draft: true } : {}))
    // Record it on the finished run (E6), through the project's runs provider. The session's own
    // process is gone by now, so there is no event stream to carry the fact — but it is the same
    // fact, and every surface reads it from the same place either way rather than re-deriving it
    // from branch names. No provider: there is no record to carry it, and the PR is still open.
    if (opened.ok && opened.number !== undefined && opened.url) {
      await (await projectRuns(target.cwd).catch(() => undefined))?.patch(agentId, { pr: { number: opened.number, url: opened.url } })
    }
    return opened
  }, { ok: false, error: 'could not reach the machine' })
}

/**
 * The user's Publish branch action (#1820): push a finished run's branch and open no pull request,
 * the last step where the project has no git host package. Under the agent lock, as Open PR is, so the push cannot race a Remove.
 */
export async function sendPush(projectId: string, agentId: string): Promise<HandoffResult> {
  return relayOr(agentId, 'sendPush', [projectId, agentId], async () => {
    const target = await handoffTargetFor(projectId, agentId)
    if (!target) return { ok: false, error: 'unknown session' }
    if (target.agent.status === 'running') return { ok: false, error: 'that session is still going' }
    return withAgentLock(agentLockKey(target.cwd, agentId), () => pushAgentBranch(target.cwd, target.agent))
  }, { ok: false, error: 'could not reach the machine' })
}

/**
 * The user's "Create a repository" action, for a project with no remote: the project's repository
 * provider creates it private, sets it as the origin and pushes. The git host is looked up again
 * afterwards: the project has a page there now.
 */
export async function sendCreateRepository(projectId: string): Promise<CreateRepositoryResult> {
  const cwd = await resolveProjectPath(projectId)
  if (!cwd) return { ok: false, error: 'this project has no local path on this server' }
  const created = await createRepository(cwd)
  if (created.ok) providedDataChanged(cwd)
  return created
}

/**
 * The user's "Merge into main" action: merge a finished run's branch into the project's default
 * branch on this machine, for a project with no remote to push to. Under the agent lock, as the
 * push is, so the merge cannot race a Remove.
 */
export async function sendMergeBranch(projectId: string, agentId: string): Promise<HandoffResult> {
  return relayOr(agentId, 'sendMergeBranch', [projectId, agentId], async () => {
    const target = await handoffTargetFor(projectId, agentId)
    if (!target) return { ok: false, error: 'unknown session' }
    if (target.agent.status === 'running') return { ok: false, error: 'that session is still going' }
    return withAgentLock(agentLockKey(target.cwd, agentId), () => mergeAgentBranch(target.cwd, target.agent))
  }, { ok: false, error: 'could not reach the machine' })
}

/**
 * The user's Merge action (#1391): merge a finished run's open pull request, directly. A run
 * that is still working has no Merge: its agent is still writing its branch, and the button comes
 * with the ended view.
 */
export async function sendMerge(projectId: string, agentId: string): Promise<HandoffResult> {
  return relayOr(agentId, 'sendMerge', [projectId, agentId], async () => {
    const target = await handoffTargetFor(projectId, agentId)
    if (!target) return { ok: false, error: 'unknown session' }
    if (target.agent.status === 'running') return { ok: false, error: 'that session is still going' }
    return mergeAgentPr(target.cwd, target.agent)
  }, { ok: false, error: 'could not reach the machine' })
}

/**
 * Ask the daemon's bridge browser to show its window (for the one-time sign-in), hide it again,
 * or restart (#1332). Anything else is refused; a browser that is not running ignores show/hide.
 */
export async function sendBridgeBrowser(action: BridgeBrowserAction): Promise<{ ok: boolean; error?: string }> {
  if (action !== 'show' && action !== 'hide' && action !== 'restart') return { ok: false, error: 'unknown action' }
  await contextBridgeBrowser().act(action)
  return { ok: true }
}
