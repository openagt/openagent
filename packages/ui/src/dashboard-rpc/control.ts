import { agentLockKey, sayToRun, startedElsewhere, type SteerResult } from '../dashboard/run-inbox.js'
export type { SteerResult }
import { openInApp, type OpenTarget, type OpenResult } from '../dashboard/open-in-app.js'
import { contextPreferences, contextStartAgent, resolveProjectPath, resolveAgentPath, runHostOf } from './context.js'
import { runRefAt } from '../distribution-hooks.js'
import { errorMessage } from '@openagt/agent-data'
import { hasImage, isImageName, keepImage } from '@openagt/agent-driver'
import { IMAGES_PER_MESSAGE } from '../images.js'

import { findAgent, isRunId, projectRuns, type AgentMeta } from '../store/index.js'
import { withAgentLock } from '../agent-locks.js'
import { deleteProjectAgent } from '../worktrees.js'
import { providedDataChanged } from '../store/provided.js'
import type {
  DeleteAgentResult,
  StartAgentOptions,
  StartAgentResult,
} from '../dashboard/types.js'
import type { Preferences } from '../registry.js'
import { isPublishPick, type PublishPick } from '../publish-levels.js'

// The write side behind the dashboard (#405, #1774). The daemon runs no agent, so every write here
// reaches a run through its host (`run.host`, #2394), this computer's unless another host has the
// run: Start, what a person says to a run in their own words, and Stop. Their answer to its
// question is ask's (its server part).

/**
 * Stop a live agent (the Stop button), through its host: on this computer, the run's process asks
 * its agent to end the turn where it is, as Esc does in Claude Code; a message continues it. A run
 * still starting is stopped once its card names its process. A run that has nothing to stop here
 * is answered why.
 */
export async function sendStop(projectId: string, agentId?: string): Promise<SteerResult> {
  const cwd = await resolveProjectPath(projectId)
  if (!cwd || !agentId || !isRunId(agentId)) return { ok: false, error: 'unknown session' }
  try {
    const run = await runRefAt(projectId, cwd, agentId)
    await (await runHostOf(run)).stop(run)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: errorMessage(err) }
  }
}

/**
 * Say something to a run (#714, #1774): the person's own words, the next prompt of the same
 * conversation. A run that is working reads them at its next step, as Claude Code's chat does,
 * or, sent `later`, when its turn ends; an ended run is resumed with them. Empty messages are
 * dropped. `publish`, when the person changed the session's "Auto" pick, is how far the run takes
 * its work from these words on, `nothing` for no level: the run reads it from the inbox line, or
 * its host resumes it with it. `id` names the message for {@link withdrawMessage} and for
 * the run's word that it landed.
 */
export async function sendMessage(projectId: string, text: string, agentId?: string, publish?: PublishPick | null, sent?: { id?: string; later?: boolean; images?: string[] }): Promise<SteerResult> {
  const message = text.trim()
  if (!message) return { ok: true }
  const images = sent?.images ?? []
  if (!Array.isArray(images) || images.length > IMAGES_PER_MESSAGE || !images.every(isImageName)) return { ok: false, error: 'Images are named by the names the dashboard kept them under.' }
  if (!(await Promise.all(images.map(name => hasImage(name)))).every(Boolean)) return { ok: false, error: 'An image is no longer on this computer. Take it out and add it again.' }
  // A call that names how it is sent and no level passes the level as nothing.
  const level = publish ?? undefined
  if (level !== undefined && !isPublishPick(level)) return { ok: false, error: 'unknown publish level' }
  const id = typeof sent?.id === 'string' && sent.id !== '' ? sent.id : undefined
  const later = sent?.later === true
  const cwd = await resolveProjectPath(projectId)
  if (!cwd || !agentId || !isRunId(agentId)) return { ok: false, error: 'unknown session' }
  return (await startedElsewhere(cwd, agentId)) ?? sayToRun(projectId, cwd, agentId, { kind: 'message', text: message, ...(level !== undefined ? { publish: level } : {}), ...(id !== undefined ? { id } : {}), ...(later ? { later: true as const } : {}), ...(images.length > 0 ? { images } : {}) })
}

/**
 * Keep an image dropped or pasted into a message box on this computer (`@openagt/agent-driver`'s
 * image store), its bytes sent as base64: answers the name a message names it by, or why it was
 * not kept.
 */
export async function sendImage(type: string, data: string): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  if (typeof type !== 'string' || typeof data !== 'string' || !BASE64.test(data)) return { ok: false, error: 'An image is sent as its kind and its bytes in base64.' }
  return keepImage(type, Buffer.from(data, 'base64'))
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

/**
 * Take back a message sent to a working run that the agent has not read yet (Cancel and edit):
 * the person edits it instead. One the agent already read stays read.
 */
export async function withdrawMessage(projectId: string, agentId: string, id: string): Promise<SteerResult> {
  if (typeof id !== 'string' || id === '') return { ok: false, error: 'unknown message' }
  const cwd = await resolveProjectPath(projectId)
  if (!cwd || !isRunId(agentId)) return { ok: false, error: 'unknown session' }
  return sayToRun(projectId, cwd, agentId, { kind: 'cancel', id })
}

/**
 * Send now: the messages a working run has not read yet reach its agent at once, what it is running
 * going on in the background, as Claude Code's Send now does.
 */
export async function sendNow(projectId: string, agentId: string): Promise<SteerResult> {
  const cwd = await resolveProjectPath(projectId)
  if (!cwd || !isRunId(agentId)) return { ok: false, error: 'unknown session' }
  return sayToRun(projectId, cwd, agentId, { kind: 'now' })
}

/**
 * The body of the worktree-removing write (#1032): resolve the project and refuse when it has no
 * local path, then remove under the run's lock.
 */
async function withWorktreeRemoval<T>(projectId: string, agentId: string, remove: (cwd: string) => Promise<T>): Promise<T | { ok: false; error: string }> {
  const cwd = await resolveProjectPath(projectId)
  if (!cwd) return { ok: false, error: 'this project has no local path on this server' }
  // Under the agent lock: a Delete and an Open PR on the same finished run each run their
  // own git in its checkout; serialized, whichever runs second finds the state the first one left
  // and acts on that.
  return withAgentLock(agentLockKey(cwd, agentId), () => remove(cwd))
}

/**
 * Delete a session (#1032): remove it from the dashboard, records and all — the sibling of
 * git-branches' Remove worktree, and the one destructive-of-history action, so its surface confirms
 * first. The checks, the worktree removal and what it leaves behind (the branch and its
 * commits) are all {@link deleteProjectAgent}'s; this adds only the agent lock around them.
 */
export async function sendDeleteAgent(projectId: string, agentId: string): Promise<DeleteAgentResult> {
  return withWorktreeRemoval(projectId, agentId, cwd => deleteProjectAgent(cwd, agentId))
}

/**
 * Start a run in the project (#405, #1774): the project's own `start` hook line, reached through
 * the daemon's wired `startAgent`. Answers the id of the run the hook began, or why there is none: a project without the
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
 * spawns a local command against the project's own registered path. A project with no folder
 * here returns an error rather than spawning anything.
 *
 * With a `agentId` it opens that session's own checkout instead (#798) — the whole point of
 * opening it is to look at what the agent is doing, which is not in the project's tree.
 */
export async function sendOpenInApp(projectId: string, target: OpenTarget, agentId?: string): Promise<OpenResult> {
  const cwd = agentId ? await resolveAgentPath(projectId, agentId) : await resolveProjectPath(projectId)
  if (!cwd) return { ok: false, error: 'this project has no local path on this server' }
  // #727: honour the stored editor preference; absent falls back to $OPENAGENT_EDITOR, then `code`.
  const editor =
    target === 'editor' ? (await contextPreferences().read().catch((): Preferences => ({}))).editor : undefined
  return openInApp(cwd, target, undefined, editor)
}
