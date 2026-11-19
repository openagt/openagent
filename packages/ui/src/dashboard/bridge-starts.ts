import { randomUUID } from 'node:crypto'

/**
 * The session start-queue (#1328): cloud sessions the daemon wants the browser extension to
 * create on claude.ai, because a session created through the page's repo picker is repo-bound
 * and can push and open pull requests, which is what a hand-off is for.
 *
 * A run asks for a session and polls until it exists; the extension claims the oldest request,
 * drives the page, and reports the session it became. The claim is the one subtle part: two
 * polling tabs handed the same request would create two cloud sessions on the user's account,
 * so a request leaves the queue in the same step that serves it, and comes back only if nobody
 * reports on it within {@link START_CLAIM_TTL_MS} — a browser that quit mid-creation must retry,
 * not brick the run.
 */

export type BridgeStartState = 'queued' | 'claimed' | 'created' | 'failed'

export interface BridgeStartRequest {
  id: string
  /** `owner/name`, as the repo picker lists it. */
  repo: string
  /** The branch the session opens on — the run's pushed hand-off ref. */
  branch: string
  prompt: string
  /** The model the run was started with (#1697), when it was; absent leaves claude.ai's default. */
  model?: string
  queuedAt: string
  state: BridgeStartState
  claimedAt?: string
  sessionId?: string
  url?: string
  note?: string
}

export interface BridgeStartInput {
  repo: string
  branch: string
  prompt: string
  model?: string
}

/** How long a claim stands before the request is offered again. */
export const START_CLAIM_TTL_MS = 90_000

const REPO = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/
const DOTS_ONLY = /^\.+$/
const BRANCH = /^[A-Za-z0-9._\-/]{1,255}$/
/** The hand-off prompt is the session's whole task and everything it needs to know, so it can be long. */
export const MAX_START_PROMPT = 200_000
/** A model is a short name or id the extension matches against claude.ai's model menu (#1697). */
export const MAX_START_MODEL = 100

export class BridgeStarts {
  private readonly byId = new Map<string, BridgeStartRequest>()

  /** Queue a request, or say what is wrong with it. */
  request(input: BridgeStartInput, now = new Date()): BridgeStartRequest | string {
    const repo = input.repo.trim()
    if (!REPO.test(repo) || repo.split('/').some(segment => DOTS_ONLY.test(segment))) return 'repo must look like owner/name'
    const branch = input.branch.trim()
    if (!BRANCH.test(branch)) return 'branch must be a git branch name'
    const prompt = input.prompt.trim()
    if (!prompt) return 'prompt must not be empty'
    if (prompt.length > MAX_START_PROMPT) return `prompt must be at most ${MAX_START_PROMPT} characters`
    const model = input.model?.trim()
    if (model && model.length > MAX_START_MODEL) return `model must be at most ${MAX_START_MODEL} characters`
    const start: BridgeStartRequest = {
      id: randomUUID(),
      repo,
      branch,
      prompt,
      ...(model ? { model } : {}),
      queuedAt: now.toISOString(),
      state: 'queued',
    }
    this.byId.set(start.id, start)
    return start
  }

  /** The oldest request nobody holds, claimed for the caller; an expired claim counts as unheld. */
  claimNext(now = new Date()): BridgeStartRequest | undefined {
    const stale = now.getTime() - START_CLAIM_TTL_MS
    const waiting = [...this.byId.values()]
      .filter(start => start.state === 'queued' || (start.state === 'claimed' && Date.parse(start.claimedAt ?? '') <= stale))
      .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))
    const next = waiting[0]
    if (!next) return undefined
    const claimed: BridgeStartRequest = { ...next, state: 'claimed', claimedAt: now.toISOString() }
    this.byId.set(claimed.id, claimed)
    return claimed
  }

  /**
   * The extension's word on a claimed request. Success without a session id is a failure: a run
   * pointing nowhere is not a usable outcome. A report on a request nobody holds is ignored — a
   * tab that died after its claim expired must not overwrite the retry that replaced it.
   */
  resolve(id: string, ok: boolean, sessionId?: string, note?: string): void {
    const start = this.byId.get(id)
    if (!start || start.state !== 'claimed') return
    if (ok && !sessionId) {
      this.byId.set(id, { ...start, state: 'failed', note: note ?? 'reported success without a session id' })
      return
    }
    this.byId.set(id, {
      ...start,
      state: ok ? 'created' : 'failed',
      ...(sessionId ? { sessionId, url: `https://claude.ai/code/${sessionId}` } : {}),
      ...(note ? { note } : {}),
    })
  }

  get(id: string): BridgeStartRequest | undefined {
    return this.byId.get(id)
  }

  list(): BridgeStartRequest[] {
    return [...this.byId.values()].sort((a, b) => b.queuedAt.localeCompare(a.queuedAt))
  }

  clear(id: string): void {
    this.byId.delete(id)
  }
}

let instance: BridgeStarts | undefined

/** The daemon's one queue: the run's request and the extension's claim must meet in the same store. */
export function bridgeStarts(): BridgeStarts {
  if (!instance) instance = new BridgeStarts()
  return instance
}

export function resetBridgeStarts(): void {
  instance = undefined
}
