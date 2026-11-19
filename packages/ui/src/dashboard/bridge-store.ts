import { randomUUID } from 'node:crypto'
import { continuationPrompt } from '@openagt/agent-driver'
import type { BridgeEvent, BridgeHello, BridgeQuestion, BridgeSessionStatus } from './bridge-endpoints.js'
import { CLOUD_SESSION_WINDOW_MS } from '../cloud-run-state.js'

/**
 * An answer picked in the dashboard, on its way back to the session (#1237).
 *
 * `queued` until the extension fetches it, delivers it into the composer and acknowledges;
 * then `sent`, or `failed` with the extension's reason. The id is what the acknowledgement
 * references, so a stale ack from a tab that died mid-delivery cannot resolve a newer answer.
 */
export interface BridgeAnswer {
  id: string
  sessionId: string
  /** The label(s) picked — one, or a `multi` question's subset (possibly none). */
  labels: string[]
  /**
   * What the extension types into the session (#1554): the same continuation a local gate
   * re-prompts with, so a cloud session hears its answer exactly as a local one does — and, on a
   * `stop` pick, that the user is taking over, since nothing of ours can end a session over there.
   */
  text: string
  queuedAt: string
  /**
   * When a Driver collected it to type (#1332). Two Drivers can serve one daemon — the user's own
   * Chrome and the daemon's bridge browser — and an answer handed to both would be typed twice.
   */
  claimedAt?: string
  state: 'queued' | 'sent' | 'failed'
  note?: string
}

/** How long a collected answer stays with the Driver that collected it before it is offered again. */
export const ANSWER_CLAIM_TTL_MS = 90_000

/** Most transcript entries kept per session, oldest dropped first. */
const MAX_SESSION_EVENTS = 300

/**
 * The questions a Claude web session is parked on, keyed by its cloud session id (#1237).
 *
 * A cloud agent has no live local session to hang a choice gate on: #1231 ends the agent at the
 * hand-off, so by the time the agent asks anything the agent is already `done`. The join back to
 * an agent is `AgentMeta.sessionId`, which a web agent already carries because `CloudSession` reports
 * the cloud id on its result.
 *
 * In memory on purpose. A question is only answerable while the session that asked it is still
 * parked, and the bridge that reported it re-reports on reconnect, so surviving a daemon restart
 * would preserve a question that may already have been answered elsewhere.
 */
/** The last time anything spoke to the bridge, and how it went. */
export interface BridgeContact {
  at: string
  route: string
  status: number
}

/** The extension's last version claim, and whether the doorway turned it away (#1519). */
export interface BridgeVersion {
  got: string
  expected: string
  blocked: boolean
  at: string
}

/**
 * What a cloud session is told when the user picks a `stop` option (#358, #1554). It lives on
 * claude.ai where nothing of ours can end it, so the bridge types this instead of a continuation:
 * the decision, and that the user is taking over from here.
 */
export function takeoverPrompt(question: string, answer: string): string {
  return `You paused to ask: "${question}". The user chose: ${answer}. Stop here: the user is taking over and will come back with fresh instructions.`
}

/** How recently the extension must have spoken to count as present. */
const EXTENSION_ALIVE_WINDOW_MS = 3 * 60_000

export class BridgeQuestions {
  private readonly bySession = new Map<string, BridgeQuestion>()
  private contact: BridgeContact | undefined

  /**
   * Note that something reached the bridge, whatever the outcome.
   *
   * Failures are recorded too, and that is the point: an extension that is misconfigured looks
   * exactly like one that is not installed, because both leave no question behind. A refused
   * request at least proves something is trying.
   */
  recordContact(route: string, status: number): void {
    this.contact = { at: new Date().toISOString(), route, status }
  }

  private versionState: BridgeVersion | undefined

  /**
   * What version the extension last claimed and whether it was refused for it (#1519).
   *
   * The accepted claims are recorded too, which is what clears a blocked banner: the moment an
   * updated extension gets through, the last word is no longer a refusal.
   */
  recordVersion(got: string, expected: string, blocked: boolean): void {
    this.versionState = { got, expected, blocked, at: new Date().toISOString() }
  }

  /** The last version claim, or undefined while nothing has stated one. */
  version(): BridgeVersion | undefined {
    return this.versionState
  }

  private helloState: BridgeHello | undefined

  /** What the injected page script last said about itself. */
  recordHello(hello: BridgeHello): void {
    this.helloState = hello
  }

  /** The page script's last report, or undefined if none has ever arrived. */
  hello(): BridgeHello | undefined {
    return this.helloState
  }

  /** The last contact, or undefined if nothing has ever reached the bridge. */
  lastContact(): BridgeContact | undefined {
    return this.contact
  }

  private readonly statusBySession = new Map<string, BridgeSessionStatus>()

  /**
   * What claude.ai's session list last said about a session (#1332), as the Driver tab read it.
   *
   * This is the read-back a web run's own record cannot give: the run ends at its hand-off, so
   * the record says `done` whether the session is parked on its user or finished hours ago.
   */
  recordStatus(status: BridgeSessionStatus): void {
    this.statusBySession.set(status.sessionId, status)
  }

  /** The session's last list status, or undefined while the Driver has never reported one. */
  status(sessionId: string): BridgeSessionStatus | undefined {
    return this.statusBySession.get(sessionId)
  }

  /**
   * Whether the session is waiting on a human: the bridge holds the question it is parked on, or
   * claude.ai's list shows it awaiting input — a question asked in prose carries no block for
   * the bridge to hold, and the list is the only thing that says the session stopped for it.
   *
   * A list status older than the session window no longer counts: the Driver stops reading a
   * session past the window, so its last word would otherwise stand forever.
   */
  waiting(sessionId: string, now = new Date()): boolean {
    if (this.bySession.has(sessionId)) return true
    const status = this.statusBySession.get(sessionId)
    return status?.status === 'awaiting' && now.getTime() - Date.parse(status.at) <= CLOUD_SESSION_WINDOW_MS
  }

  /**
   * Whether an extension is around (#1328): something reached the bridge and was let in within
   * the window. The worker polls every half minute while it lives, so a longer silence means
   * there is nobody to drain a request.
   */
  extensionAlive(now = new Date(), windowMs = EXTENSION_ALIVE_WINDOW_MS): boolean {
    const contact = this.contact
    if (!contact || contact.status >= 400) return false
    return now.getTime() - Date.parse(contact.at) <= windowMs
  }

  private readonly eventsBySession = new Map<string, Map<number, BridgeEvent>>()

  /**
   * Record one transcript entry, keyed by its position.
   *
   * Keyed rather than appended because the page is re-read on every DOM change, so the same
   * message arrives repeatedly and a growing list would be mostly duplicates. Position also lets
   * a later read replace an earlier one, which is what a message still being streamed needs.
   */
  recordEvent(event: BridgeEvent): void {
    let bySeq = this.eventsBySession.get(event.sessionId)
    if (!bySeq) {
      bySeq = new Map()
      this.eventsBySession.set(event.sessionId, bySeq)
    }
    bySeq.set(event.seq, event)
    // Bound it: a long session would otherwise grow without limit in a daemon that never restarts.
    if (bySeq.size > MAX_SESSION_EVENTS) {
      for (const seq of [...bySeq.keys()].sort((a, b) => a - b).slice(0, bySeq.size - MAX_SESSION_EVENTS)) bySeq.delete(seq)
    }
  }

  /** That session's transcript so far, in order. */
  events(sessionId: string): BridgeEvent[] {
    return [...(this.eventsBySession.get(sessionId)?.values() ?? [])].sort((a, b) => a.seq - b.seq)
  }

  private readonly answersBySession = new Map<string, BridgeAnswer>()
  /** The fingerprint of the question each session's `sent` answer resolved. */
  private readonly answeredBySession = new Map<string, string>()

  /**
   * Record the question a session is parked on, replacing any earlier one for that session.
   *
   * A question identical to one an answer was already delivered for is dropped: the extension's
   * worker forgets what it sent when it restarts, and the answered block stays in the page's DOM,
   * so the same question would otherwise resurface as parked right after being answered.
   */
  record(question: BridgeQuestion): void {
    if (this.answeredBySession.get(question.sessionId) === fingerprint(question)) return
    const previous = this.bySession.get(question.sessionId)
    // A genuinely new question means the session moved on: an undelivered pick for the old one
    // must not be typed into it, and a resolved one no longer says anything about this question.
    // Only a re-report of the question currently parked keeps its queued answer alive.
    if (!previous || fingerprint(previous) !== fingerprint(question)) {
      this.answersBySession.delete(question.sessionId)
      this.answeredBySession.delete(question.sessionId)
    }
    this.bySession.set(question.sessionId, question)
  }

  /**
   * Queue an answer picked in the dashboard (#1237). Refuses anything but labels of the question
   * currently parked — exactly one unless the question is `multi` — so the only text this can
   * ever put in a composer is composed from what the session itself offered.
   */
  queueAnswer(sessionId: string, labels: string[]): BridgeAnswer | string {
    const question = this.bySession.get(sessionId)
    if (!question) return 'that session has no parked question'
    const picked = question.options.filter(option => labels.includes(option.label))
    if (picked.length !== labels.length || new Set(labels).size !== labels.length) return 'every label must be one of the question options'
    if (!question.multi && picked.length !== 1) return 'pick exactly one option'
    // Worded as a local run's answer is (agent-driver's continuation prompt): the labels joined, `(none)` for an
    // empty multi-select, and a stopping pick hands the session over instead of continuing it.
    const answer = picked.length ? picked.map(option => option.label).join(', ') : '(none)'
    const text = picked.some(option => option.stop) ? takeoverPrompt(question.title, answer) : continuationPrompt(question.title, answer)
    const queued: BridgeAnswer = { id: randomUUID(), sessionId, labels, text, queuedAt: new Date().toISOString(), state: 'queued' }
    this.answersBySession.set(sessionId, queued)
    return queued
  }

  /** Withdraw a queued answer. Too late once a Driver has collected it or the extension has delivered it. */
  cancelAnswer(sessionId: string, now = Date.now()): boolean {
    const answer = this.answersBySession.get(sessionId)
    if (!answer || answer.state !== 'queued' || this.claimed(answer, now)) return false
    this.answersBySession.delete(sessionId)
    return true
  }

  /** The answer waiting for the extension to deliver, if any — collected by a Driver or not. */
  pendingAnswer(sessionId: string): BridgeAnswer | undefined {
    const answer = this.answersBySession.get(sessionId)
    return answer?.state === 'queued' ? answer : undefined
  }

  /** Whether a Driver holds the answer: collected, and not so long ago that it is presumed lost. */
  private claimed(answer: BridgeAnswer, now: number): boolean {
    return answer.claimedAt !== undefined && now - Date.parse(answer.claimedAt) < ANSWER_CLAIM_TTL_MS
  }

  /**
   * Hand the queued answer to the Driver asking, once (#1332): the next Driver asking within the
   * claim's lifetime gets nothing, so a session served by two browsers is not answered twice. A
   * claim nobody acknowledged — the Driver died mid-delivery — expires, and the answer is offered
   * again.
   */
  claimAnswer(sessionId: string, now = Date.now()): BridgeAnswer | undefined {
    const answer = this.pendingAnswer(sessionId)
    if (!answer || this.claimed(answer, now)) return undefined
    answer.claimedAt = new Date(now).toISOString()
    return answer
  }

  /**
   * Every session with an answer waiting to be delivered. The Driver serves these whatever the
   * session window says: the page reports whichever session the user is on, so a pick can be for
   * a session no listed run carries, and one nothing serves would sit queued forever.
   */
  pendingAnswerSessions(): string[] {
    return [...this.answersBySession.values()].filter(answer => answer.state === 'queued').map(answer => answer.sessionId)
  }

  /** The session's answer in whatever state, for the dashboard to render. */
  answer(sessionId: string): BridgeAnswer | undefined {
    return this.answersBySession.get(sessionId)
  }

  /**
   * The extension's word on what happened to a delivery. On success the question is resolved:
   * it is dropped, and re-reports of the same block are ignored (see {@link record}).
   */
  resolveAnswer(sessionId: string, id: string, ok: boolean, note?: string): void {
    const answer = this.answersBySession.get(sessionId)
    if (!answer || answer.id !== id || answer.state !== 'queued') return
    this.answersBySession.set(sessionId, { ...answer, state: ok ? 'sent' : 'failed', ...(note ? { note } : {}) })
    if (!ok) return
    const question = this.bySession.get(sessionId)
    if (question) this.answeredBySession.set(sessionId, fingerprint(question))
    this.bySession.delete(sessionId)
  }

  /** The question that session is parked on, if the bridge has reported one. */
  get(sessionId: string): BridgeQuestion | undefined {
    return this.bySession.get(sessionId)
  }

  /** Every parked question, newest first. */
  list(): BridgeQuestion[] {
    return [...this.bySession.values()].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
  }

  /** Drop a session's question, once it is answered or its agent is gone. */
  clear(sessionId: string): void {
    this.bySession.delete(sessionId)
    this.eventsBySession.delete(sessionId)
    this.answersBySession.delete(sessionId)
    this.answeredBySession.delete(sessionId)
    this.statusBySession.delete(sessionId)
  }
}

/** What makes two reports the same question: the text shown, not when it arrived. */
function fingerprint(question: BridgeQuestion): string {
  return JSON.stringify([question.title, question.options, question.recommended ?? null, question.multi ?? false])
}

/**
 * The daemon's one store. A module singleton rather than a {@link DashboardContext} field
 * because both ends live in the same process but reach it by different routes: the bridge
 * endpoint writes from the raw HTTP handler, and the dashboard reads from an RPC, which is
 * handed only what the wired context carries.
 */
let instance: BridgeQuestions | undefined

export function bridgeQuestions(): BridgeQuestions {
  if (!instance) instance = new BridgeQuestions()
  return instance
}

/** Replace the store. Tests only: a module singleton would otherwise leak between them. */
export function resetBridgeQuestions(): void {
  instance = undefined
}
