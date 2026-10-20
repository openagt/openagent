import type { Question } from './question.js'
import type { SessionLog, SessionLogOptions } from './session-log.js'
import type { InboxLine } from './inbox.js'

/**
 * The **driver** seam: the one abstraction a coding-agent CLI is wrapped behind.
 * A driver treats the CLI (Claude Code, Codex) as a **black box**: hand it a
 * prompt, let its *own* loop run to completion, then read the code it produced
 * and gate on the outcome.
 *
 * The seam is deliberately the **code and the outcome**, never the agent's
 * individual tool calls (#165): drive by prompting, verify by result, so the
 * wrapped CLI keeps its subscription-based auth and its internal loop stays
 * untouched and swappable.
 *
 * Everything runs *through* the driver: a role is prompt framing
 * ({@link DriverStartOptions.system}), and each pass is a **fresh**
 * {@link DriverSession.prompt} call, so `prompt` is the fresh-context unit.
 *
 * `Driver` is intentionally tiny: `start` a session, `prompt` it, read the code,
 * `dispose` — four moves a second CLI slots in behind.
 */

/**
 * The stable id of one concrete implementation, as recorded on a session's meta. A driver has one
 * per place it can run — `claude-code` locally, `claude-web` in a cloud session, `github-actions`
 * on a runner — which is why this is wider than the user's driver choice.
 */
export type DriverImplId = 'claude-code' | 'claude-web' | 'github-actions' | 'codex' | 'fake'

/** A wrapped coding-agent CLI. Boots {@link DriverSession}s bound to a workspace. */
export interface Driver {
  /**
   * Stable id for this concrete implementation, e.g. `"claude-code"`. Not the driver's *name*
   * (`claude`), which is the user's choice: one driver has an implementation per place it can run —
   * the caller maps it back to the choice.
   */
  readonly id: DriverImplId
  /** Boot a session bound to a workspace directory. */
  start(opts: DriverStartOptions): Promise<DriverSession>
  /**
   * Ask the agent where the account's subscription quota stands (#521), for the
   * consumption limits in #519. Account-wide and independent of any session, so
   * it hangs off the driver rather than off {@link DriverSession}.
   *
   * Optional: an agent that can't report it omits the method entirely, the same
   * way {@link DriverRateLimit} is omitted by drivers that can't emit it.
   */
  readQuota?(opts?: { signal?: AbortSignal }): Promise<DriverQuota>
  /**
   * Ask the agent which models it offers, in the order it lists them: the same list its own model
   * picker shows the person, for their login. Account-wide like {@link readQuota}, and costs no
   * prompt. Rejects, with the reason in words, when the agent could not say.
   *
   * Optional: an agent that cannot list its models omits the method.
   */
  listModels?(opts?: { signal?: AbortSignal }): Promise<DriverModel[]>
}

/** One model a coding agent offers. */
export interface DriverModel {
  /** What {@link DriverStartOptions.model} takes to run it, e.g. `opus` or `gpt-5.6-terra`. */
  id: string
  /** Its name as the agent shows it, e.g. `Opus 5.5`. */
  name: string
  /**
   * The full id it runs today, when {@link id} is an alias: `claude-opus-5-5` for `opus`. The
   * id a run's {@link DriverEvent} `model` names, so a reader finds the entry by either.
   */
  resolvedId?: string
  /**
   * How hard it may think, by the names its own agent takes ({@link DriverStartOptions.effort}),
   * in the order the agent lists them. Empty or absent: this model takes no effort.
   */
  efforts?: string[]
  /** How many tokens of conversation it holds, when the agent says; absent when it does not. */
  contextWindow?: number
}

/** The parts of the person's own setup a coding agent can load, by the names every adapter takes. */
export const PERSONAL_PARTS = ['memory', 'connectors', 'skills'] as const

/**
 * Which parts of the person's own setup a coding agent loads: `true` loads the part, `false`
 * keeps it out. `memory` is what the agent remembers across sessions on its own; `connectors` are
 * the apps and accounts linked to the person's login; `skills` are the person's own instructions,
 * skills and settings files. Every adapter that starts a coding agent on this machine takes the same three and turns each
 * off with its own switches; a part an adapter cannot turn off is a warning in its readiness check, never a
 * silent "off". An adapter given none loads everything, as its CLI does on its own.
 */
export type PersonalSetup = Record<(typeof PERSONAL_PARTS)[number], boolean>

/** How to boot a {@link DriverSession}. */
export interface DriverStartOptions {
  /** Absolute path to the workspace the agent reads and edits. */
  cwd: string
  /**
   * Role framing prepended to every prompt in this session (a role is prompt
   * framing, not a separate kind of agent). Maps to the agent's system prompt.
   */
  system?: string
  /** Model id to pass through when the wrapped agent supports selecting one. */
  model?: string
  /**
   * How hard the model may think, by the names the agent itself takes ({@link DriverModel.efforts}):
   * `medium`, `high`, … A driver whose agent does not take one ignores it.
   */
  effort?: string
  /**
   * This session has nothing to do in its folder: it is asked one question and answers in words
   * (naming a run, `agent-runner`'s `title.ts`). An agent that can be started without its built-in
   * tools is, which is both cheaper — the tools and what they bring are most of what such a turn
   * sends — and safer: with no tool to reach for, a small model cannot mistake the words it is
   * given for work to do. A driver whose agent has no such mode ignores it and runs as usual.
   *
   * Both drivers take it, and neither gets as far as the other. Claude Code has one switch for it
   * (`--tools ""`), which takes a turn from ~23,000 tokens to ~3,600. Codex has none: its tools
   * ride on its feature flags, which go off one by one, and what is left is its own base
   * instructions — ~11,300 tokens down to ~8,800.
   */
  noTools?: boolean
  /** Abort the whole session; disposing kills the underlying process. */
  signal?: AbortSignal
  /**
   * Resume a prior agent session id (#720): seed the session so its very first
   * prompt (with `resume`) continues that conversation instead of starting fresh.
   * This is how a finished agent is revived from a UI — its captured session
   * id is threaded here so the opening message lands with the full prior context.
   * A driver that can't resume ignores it and runs fresh (the best-effort contract). One that can,
   * asked to continue a conversation its agent no longer has, throws `ConversationGoneError`.
   */
  resumeSessionId?: string
  /**
   * Keep the session's log, two files in a run record's shape at this directory, written as the
   * agent works (`session-log.ts`). The session exposes it as {@link DriverSession.log} for the
   * caller to patch and to end.
   */
  log?: SessionLogOptions
  /**
   * Observe the agent's *own* progress as it works. Black-box granularity: we
   * forward these for visibility (a UI) but never branch control flow
   * on them. Isolated: a throwing callback must not break the agent.
   */
  onEvent?: (event: DriverEvent) => void
}

/** A booted agent session, bound to one workspace. */
export interface DriverSession {
  /** Stable id the driver mints for this session. The wrapped CLI's own session id, when it has one, is {@link DriverTurn.sessionId}. */
  readonly id: string
  /** Absolute workspace path the agent is bound to. */
  readonly cwd: string
  /**
   * Send one prompt, let the agent's built-in loop run to completion, and
   * resolve with its final turn. Each call is a **fresh** invocation (fresh
   * context per loop pass) unless a driver documents otherwise.
   */
  prompt(text: string, opts?: DriverPromptOptions): Promise<DriverTurn>
  /**
   * Read a file the agent produced (the seam is the code). Optional: a driver
   * whose workspace is not host-readable may omit it and rely on a runner.
   */
  readCode?(path: string): Promise<string>
  /** The session's log, when {@link DriverStartOptions.log} asked for one. */
  readonly log?: SessionLog
  /** Tear the session down (kill the process, free resources). Idempotent. */
  dispose(): Promise<void>
}

/** Per-prompt overrides. */
export interface DriverPromptOptions {
  /** Extra framing for just this prompt, appended after the session `system`. */
  system?: string
  /** Abort just this prompt (the in-flight invocation). */
  signal?: AbortSignal
  /**
   * Continue the agent's *previous* turn instead of starting fresh (#714): the
   * live-chat path resumes the same session so the message lands in the ongoing
   * conversation with full context. Best-effort — a driver that can't resume
   * (or has no prior turn yet) runs a fresh invocation, the normal case. Honored
   * by the Claude Code driver via `--resume <sessionId>` and by the Codex driver via
   * `exec resume <sessionId>`.
   */
  resume?: boolean
  /**
   * The inbox, a file of lines from outside the agent (`inbox.ts`): when the turn ends, every
   * line waiting there is sent as a further prompt of the same session, in order, until the file
   * is empty; then this prompt resolves with the last turn. Nothing waits for a line that has not
   * come: a later line is for a new session resumed by its id.
   */
  inbox?: string
  /**
   * What a line taken from the inbox changes for the prompts from it on, the caller's to say: it
   * is handed each line before the line is sent, with the options the line would go with, and
   * answers the ones it goes with instead (the sentence after it, say, when the line gives the run
   * a new level). Absent, every line goes with this prompt's options.
   */
  onInboxLine?: (line: InboxLine, sent: DriverPromptOptions) => Promise<DriverPromptOptions>
  /**
   * A sentence the caller adds after the prompt, and after every inbox line this prompt goes on
   * to send: the agent reads the two as one message, the sentence after an empty line. The `start`
   * event names it apart from the prompt, so a reader can show who said what.
   */
  added?: string
  /**
   * A text the caller hands the agent with this one prompt: the agent reads it after the prompt
   * and before the added sentence, each after an empty line. No inbox line this prompt goes on to
   * send carries it. The `start` event names it apart from the prompt, like the added sentence.
   */
  attached?: string
}

/** The outcome of one {@link DriverSession.prompt} turn. */
export interface DriverTurn {
  /** The agent's final assistant text for this prompt. */
  text: string
  /** The agent's session id for this turn, when it exposes one: the handle a UI links to. */
  sessionId?: string
  /** Token + cost accounting for this turn, when the agent reports it (#322). */
  usage?: DriverUsage
}

/**
 * Token and cost accounting for one turn, as reported by the wrapped agent (#322).
 * Claude Code emits this on its final `result` line; drivers that cannot report
 * it simply omit it. Costs are whatever the agent computed, in USD.
 *
 * Tokens are the part every agent reports; the price is the part only some do
 * (#540). So `costUsd` is optional and the tokens are not: Codex reports counts
 * and no price, and an agent that can't price a turn reports the tokens it does
 * know rather than nothing at all.
 */
export interface DriverUsage {
  /**
   * Cost of the turn in USD, when the agent prices its own turns. Omitted when it
   * doesn't — never `0`, which would read as free rather than as unknown.
   *
   * Note this is a notional price under a subscription: the user pays a flat fee,
   * and the agent reports what the turn would have cost on metered API pricing.
   * What a subscription actually spends is quota, which {@link DriverQuota}
   * carries and a spending limit (#519) gates on.
   */
  costUsd?: number
  /** Non-cached input tokens. */
  inputTokens: number
  /** Output tokens. */
  outputTokens: number
  /** Tokens read from the prompt cache. */
  cacheReadTokens: number
  /** Tokens written to the prompt cache. */
  cacheCreationTokens: number
  /**
   * How much of the model's context the conversation filled when the turn ended: the last model
   * call's whole prompt (cached part included) plus what that call wrote. Not the turn's total —
   * a turn makes several calls over one growing conversation, and adding those up would say the
   * window is far fuller than it is. Absent when the agent reports no per-call reading.
   */
  contextTokens?: number
}

/**
 * Where the account's subscription quota stands, as reported by the wrapped
 * agent (#517). Claude Code emits one of these per turn on its `stream-json`
 * output; drivers that cannot report it simply omit it. This is the account
 * limit, not this agent's spend — {@link DriverUsage} covers the latter.
 */
export interface DriverRateLimit {
  /**
   * Whether the account may still spend against this window: `allowed`,
   * `allowed_warning`, or `rejected`. Left open rather than a union — only
   * `allowed` has been observed, and a status we don't know is the signal we're
   * capturing for, so it must surface rather than be dropped.
   */
  status: string
  /**
   * Which quota window this reports on (`five_hour`, `seven_day`,
   * `seven_day_opus`, `seven_day_sonnet`, `weekly`). Left open for the same
   * reason: the agent adds windows as plans change.
   */
  window: string
  /** When the window resets, epoch **milliseconds** (the agent reports seconds). */
  resetsAt: number
}

/**
 * One quota window and how much of it the account has burned (#521).
 *
 * The three concepts here are easy to confuse. {@link DriverUsage} is what *this
 * run* spent. {@link DriverRateLimit} is a per-turn traffic light (are we still
 * allowed to spend, and when does the window reset). This is the missing middle:
 * the *proportion* of a window consumed, which is the only one of the three that
 * can fill a progress bar.
 */
export interface DriverQuotaWindow {
  /** The window's name exactly as the agent phrased it, e.g. `"Current session"`. */
  label: string
  /**
   * Normalized window, so callers can gate without matching on prose.
   * `session` is Claude's 5-hour window, `week` its all-models week, and
   * `week-model` a single model's week (Opus/Sonnet get their own).
   *
   * Note there is deliberately no `day`: Claude measures a 5-hour session and a
   * week, and nothing per day.
   */
  kind: 'session' | 'week' | 'week-model' | 'unknown'
  /** How much of the window is gone, 0-100. */
  percentUsed: number
  /**
   * When the window resets, as the agent worded it (`"Jul 18 at 7am
   * (Asia/Jerusalem)"`). Prose, not a timestamp: the agent prints no year, so
   * parsing it to an epoch would be guesswork. {@link DriverRateLimit.resetsAt}
   * carries the exact epoch for the window it reports on.
   */
  resetsAtText?: string
}

/**
 * Why a quota read came back empty.
 *
 * The split that matters is transient vs authoritative. `fetch-failed`,
 * `timeout` and `unrecognized` describe *this attempt* (the agent's own usage
 * fetch can be refused upstream, with a penalty window), so a recent reading is
 * still worth showing and asking again may work. The remaining reasons describe
 * the account or the install and are a statement about the setup, so a retained
 * reading must not outlive them.
 */
export type DriverQuotaUnavailableReason =
  /** The agent's own usage fetch failed, e.g. refused upstream. Transient. */
  | 'fetch-failed'
  /** The agent did not answer in time. Transient. */
  | 'timeout'
  /** The agent binary isn't installed or isn't on `PATH`. */
  | 'agent-not-found'
  /** The account has no subscription quota to report (e.g. API-key auth). */
  | 'no-subscription'
  /**
   * The agent answered, but not in a shape we recognize (it reworded the readout).
   *
   * Transient, because it describes one answer rather than the install: an
   * update notice printed ahead of the JSON, or empty stdout while the CLI
   * swaps itself under a long-lived process, both land here and both are gone by
   * the next read (#960).
   */
  | 'unrecognized'

/** Whether a {@link DriverQuotaUnavailableReason} describes this attempt rather than the setup. */
export function isTransientQuotaReason(reason: DriverQuotaUnavailableReason): boolean {
  return reason === 'fetch-failed' || reason === 'timeout' || reason === 'unrecognized'
}

/**
 * Where the account's subscription quota stands (#521), as a whole reading.
 *
 * Modelled as available-or-not rather than as an empty window list, so a caller
 * can't mistake "we couldn't ask" for "nothing is used".
 */
export type DriverQuota =
  | { available: true; windows: DriverQuotaWindow[] }
  | { available: false; reason: DriverQuotaUnavailableReason }

/**
 * One file a tool call changed, as the call's own CLI reports it: the path as the CLI names it,
 * how many lines the call added and how many it removed, and `created` when the call made the file.
 */
/** One task of an agent's plan. */
export interface PlanTask {
  text: string
  status: 'pending' | 'in_progress' | 'completed'
}

export interface FileChange {
  path: string
  added: number
  removed: number
  created?: true
}

/**
 * A black-box progress event from the wrapped agent. A caller shows these for
 * visibility but never gates on them: the gate is the code and the outcome, not
 * which tool the agent reached for.
 */
export type DriverEvent =
  /** A prompt was sent; the agent's loop is starting. `attached` is the text the caller handed over with it ({@link DriverPromptOptions.attached}) and `added` the sentence the caller put after it ({@link DriverPromptOptions.added}): the agent got all of it. */
  | { type: 'start'; prompt: string; attached?: string; added?: string }
  /**
   * The agent announced its session id, at the start of the turn (#1322). `result` repeats it,
   * but a turn that never settles — a manual Stop, an error, a kill — used to take the id down
   * with it, and with it the agent's `claude --resume` handle. A caller records this one rather
   * than showing it: the id is plumbing, not conversation.
   */
  | { type: 'session'; sessionId: string }
  /**
   * The model the turn runs on, as the agent's CLI names it once it has started: its full id
   * (`claude-opus-5-5` for `opus`, or for no model picked), so a run says which model ran even
   * after the alias moves on. A driver whose CLI does not say omits it.
   */
  | { type: 'model'; model: string }
  /**
   * An assistant text chunk streamed out. `subagent`, here and on `action`, `output` and `thought`,
   * is the id of the {@link DriverEvent subagent} the CLI says wrote it, when it was not the agent
   * itself: a reader shows those events as that subagent's own, and never as the agent's.
   */
  | { type: 'text'; text: string; subagent?: string }
  /**
   * The message the agent is writing, as far as it has got: the whole text so far, not the newest
   * piece. Its `text` event follows once the message is whole. Live only: a log keeps it beside the
   * diary for a watcher to read, and never in the diary. A driver whose CLI sends no pieces sends none.
   */
  | { type: 'partial'; text: string }
  /**
   * The agent used a tool: its name, and `detail`, the one argument that says what it did (the
   * command, the file, the URL, the skill), on one line and cut short. A tool whose arguments hold
   * none of those has no `detail`. `whole` is that argument as it was given, lines kept, when `detail`
   * is not all of it (a command of several lines, or a long one); it is cut too, to the size limit
   * of an output. `id` is the call's own id in its CLI, the one its `output` event names.
   * `summary` is the coding agent's own few words for what the call does ("List project files"),
   * when it gave some beside the detail.
   */
  | { type: 'action'; label: string; detail?: string; whole?: string; summary?: string; id?: string; subagent?: string }
  /**
   * What a tool call gave back once it was over: `id` is its `action`'s, `text` is what it printed,
   * cut to a size limit (`cutOutput`). `failed` says the call failed; `exitCode` is the command's
   * exit code, for a CLI that reports one. `changed` is the files the call changed, as its CLI
   * reports them: an edit, a write, a patch. A call that gave nothing back and changed no file has
   * no `output`.
   */
  | { type: 'output'; id: string; text: string; failed?: true; exitCode?: number; changed?: FileChange[]; subagent?: string }
  /**
   * A **subagent the wrapped CLI started inside its own session**: a second agent in the same
   * process, on the same checkout, which the parent handed a task of its own. Nothing to do with
   * this project's own subagents (separate runs on separate branches) — this is the coding agent's
   * own tool, and a reader shows it as one row that is live and then is over.
   *
   * `id` is stable across the same subagent's updates, so a reader replaces its row rather than
   * appending a second one. On Claude Code it is the `Agent` call's `tool_use` id — one call is one
   * subagent — and the events the subagent's own messages make carry it as their `subagent`. On
   * Codex it is the `collabAgentToolCall` item's id and the agent's own thread id (its nickname, or
   * its place in the list, when the item names no thread) joined by a colon, because one Codex call
   * can concern several agents at once.
   *
   * `status` is the only part a reader may gate a row on: `working` while it runs, `ended` once it
   * is over, `failed` when it did not go through (Codex's `declined` reads as `failed` too). A
   * Claude Code subagent run in the background is over when the CLI says its task is, not when its
   * call answers: that answer only says it began.
   * Everything else is whatever the CLI happened to say and is **absent** when it said nothing,
   * never guessed or defaulted. Claude Code gives the name (the call's `description`), the `role`
   * (its `subagent_type`), the `prompt`, and a `model` only when the call overrode the parent's.
   * Codex gives each agent's name and role (off the item's `agentsStates`) and the item's `model`
   * and `prompt`; it never says which model an agent that takes the parent's runs on either.
   * `prompt` is cut to the size limit of an output (`cutOutput`).
   *
   * Emitted **beside** the `action` and `output` events of the same call, which both drivers go on
   * emitting unchanged: whoever renders this event renders one row for the subagent and skips
   * those two for the same call — the same `id`, or on Codex the part of it before the colon.
   */
  | { type: 'subagent'; id: string; status: 'working' | 'ended' | 'failed'; name?: string; role?: string; model?: string; prompt?: string }
  /** What the agent thought before it acted, as its CLI summarizes it. */
  | { type: 'thought'; text: string; subagent?: string }
  /**
   * The agent's own plan, whole, each time it changes it: its tasks in order, each pending, in
   * progress or completed. Claude Code keeps it with its TodoWrite tool, Codex sends it as its
   * turn's plan; an agent that made none sends nothing. Live only: a log keeps no line of it.
   */
  | { type: 'plan'; tasks: PlanTask[] }
  /**
   * The turn settled with this final text. `sessionLink` is the real URL of the session,
   * for a driver whose session has one of its own (#1317) — a cloud session, say — so a
   * caller can link there instead of the generic entry point; drivers without one omit it.
   * `anchorSha` is the hand-off anchor commit (#1601), for a driver whose session does its
   * work on a branch of its own naming that this machine can only recognize later by
   * ancestry; drivers whose work stays on the designated branch omit it.
   */
  | { type: 'result'; text: string; sessionId?: string; sessionLink?: string; anchorSha?: string; usage?: DriverUsage }
  /** Where the account's subscription quota stands (#517). */
  | { type: 'rate-limit'; limit: DriverRateLimit }
  /** The agent (or its transport) errored. */
  | { type: 'error'; message: string }
  /** Something the driver worked around, worth telling the user about (#778). */
  | { type: 'notice'; message: string }
  /** The turn ended on a question the agent will not decide alone: its `await-choices` block, parsed (`question.ts`). */
  | { type: 'question'; question: Question }
