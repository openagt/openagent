/**
 * The coding agent's contract (#2394): what a module fills `run.agent` with, and what the run
 * engine, a host and a page read of a run's agent. The adapters (`agent-driver-claude-code`,
 * `agent-driver-codex`) implement it; agent-driver holds what they build it with.
 */

import type { AgentCalls } from './calls.js'
import type { RunOptions } from './run.js'

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
 * per place it can run — `claude-code` locally, `github-actions` on a runner — which is why this is
 * wider than the user's driver choice.
 */
export type DriverImplId = 'claude-code' | 'github-actions' | 'codex' | 'fake'

/** A wrapped coding-agent CLI. Boots {@link DriverSession}s bound to a workspace. */
export interface Driver {
  /**
   * Stable id for this concrete implementation, e.g. `"claude-code"`. Not the driver's *name*
   * (`claude`), which is the user's choice: one driver has an implementation per place it can run —
   * the caller maps it back to the choice.
   */
  readonly id: DriverImplId
  /**
   * The agent asks the person with a tool of its own, as Claude Code's AskUserQuestion, and a turn
   * that asked ends on it with {@link DriverTurn.question}. Such an agent is given no skill that
   * teaches another way to ask: it would ask that way instead.
   */
  readonly ownQuestionTool?: boolean
  /** A small, quick model of the agent's, which a run's short name is asked of; none, and its runs are not named. */
  readonly namingModel?: string
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

/**
 * A coding agent, as a module fills `run.agent` with it (#2394): what a run on it is built with,
 * and whether one can start here. The run engine names no agent: it takes the one a run's options
 * or record name from the modules of its distribution.
 */
export interface RunAgent {
  /** What a run's options and record name it by: `claude-code`, `codex`. */
  readonly id: string
  /** Its name for a person: `Claude Code`. */
  readonly label: string
  /** Its mark, as SVG markup drawn in the text's colour (`fill="currentColor"`): beside its name, wherever a run on it is shown. */
  readonly logo?: string
  /** Its program on this computer, for its updates: the command it runs as (`claude`), and the npm package its versions come out under. */
  readonly program?: { readonly bin: string; readonly npm: string }
  /** It asks the person with a tool of its own ({@link Driver.ownQuestionTool}): its runs get no skill that teaches asking. */
  readonly ownQuestionTool?: boolean
  /** How its tool calls read in the chat, by the labels its `action` events give them: none, each is said by its label. */
  readonly calls?: AgentCalls
  /**
   * Its accounts on this computer: the list its turns take, the accounts a person added for it in
   * OpenAgent beside its own login, and a profile's picks among them (`RunOptions['agent-driver']`).
   * None: it runs on whatever login it has.
   */
  readonly accounts?: AgentLogins
  /**
   * The models it offers, by its own names, as it lists them on the account its runs take first:
   * asked once for each account, as its picker would, and again with `fresh` (a new version can
   * offer other models). Rejects where it cannot say, with the error's `code` `ENOENT` where its
   * program is not on this computer.
   */
  models?(opts?: { fresh?: boolean }): Promise<DriverModel[]>
  /** What would stop a run on it here, asked before a run spends a checkout: its CLI missing or logged out. */
  ready(opts: RunAgentReadyOptions): Promise<DriverReadiness>
  /** The driver one run's sessions start on, unrestricted: nobody is there to approve what its agent does in the run's checkout. */
  driver(opts: RunAgentOptions): Driver
  /**
   * The command that picks one of its sessions back up in a person's terminal (`claude --resume
   * <id>`): `cwd` is the folder the session ran in, which may be gone by then. None: its sessions
   * are not picked up outside a run.
   */
  resumeCommand?(session: { id: string; cwd?: string }): string
}

/** What a coding agent's readiness is asked with. */
export interface RunAgentReadyOptions {
  /** The parts of the person's own setup its runs keep here: one it cannot keep out is a warning. */
  personal: PersonalSetup
  /** An account was added to its list: runs use it where the agent's own login is out. */
  addedAccount: boolean
}

/** What one run's driver is built with. */
export interface RunAgentOptions {
  /** The environment the agent runs in: the run's process's, with the run's id. */
  env: NodeJS.ProcessEnv
  /** The parts of the person's own setup the run keeps. */
  personal: PersonalSetup
  /** The accounts of its list its turns take, the next free one going on at a limit; none when it runs on its own login. */
  accounts?: AccountRotation
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
  /** The effort it thinks at when none is picked, when its agent says: Codex's list does, Claude Code's does not. */
  defaultEffort?: string
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
   * (naming a run, agent-driver's `engine/title.ts`). An agent that can be started without its built-in
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
  /**
   * Variables this session's agent gets on top of the driver's own environment: the run's
   * (`RunContext.env` in `@openagt/hooks`), such as the account it works as at its git host.
   */
  env?: Readonly<Record<string, string>>
  /** Abort the whole session; disposing kills the underlying process. */
  signal?: AbortSignal
  /**
   * End the turn that runs when it fires, as the person's Stop does in Claude Code: the agent is
   * asked to stop where it is, its conversation keeps everything up to there, and the turn resolves
   * with {@link DriverTurn.stopped} rather than failing. A driver that cannot ask its agent ends the
   * process instead, as {@link signal} does.
   */
  stop?: AbortSignal
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
   * agent works (agent-driver's `attachLog`). The session exposes it as {@link DriverSession.log} for the
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
  /**
   * One fresh prompt whose process starts now, before its words are known: the agent's own
   * start-up is done while nothing waits on it, and the words, once given, go straight to the
   * model. Measured with a small model and no tools: an answer in a second where a fresh process
   * takes two (Claude Code), and in two where it takes four (Codex, whose conversation is opened
   * ahead too). Optional: a driver without it is only ever prompted the usual way.
   */
  ready?(): ReadyPrompt
  /** Tear the session down (kill the process, free resources). Idempotent. */
  dispose(): Promise<void>
}

/** A prompt whose process was started before its words were known ({@link DriverSession.ready}). */
export interface ReadyPrompt {
  /** Send the words and wait for the turn. A process takes one prompt: a second, or one after it ended, is refused. */
  prompt(text: string): Promise<DriverTurn>
  /** Whether it is still waiting for its words: one whose process ended on its own takes none. */
  readonly waiting: boolean
  /** End the process without a prompt. Idempotent. */
  cancel(): void
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
   * its app server's `thread/resume`.
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
   * a new level). An `attached` text in its answer goes with that one line alone (where the repos
   * the line gives the session were copied). Absent, every line goes with this prompt's options.
   */
  onInboxLine?: (line: PromptLine, sent: DriverPromptOptions) => Promise<DriverPromptOptions>
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
  /**
   * The images the person's message goes with, by the names this computer keeps them under
   * (`@openagt/agent-driver`'s image store): the agent looks at them with this one prompt. No inbox
   * line this prompt goes on to send carries them; a line brings its own. The `start` event names them.
   */
  images?: string[]
  /**
   * The question a turn's last message ends on, as the caller reads it (the block a skill taught
   * the agent), for a turn whose agent asked with no tool of its own; absent, a message asks
   * nothing. The turn reports it as it reports a question asked with the agent's own tool.
   */
  questionIn?: (text: string) => Question | undefined
}

/** The outcome of one {@link DriverSession.prompt} turn. */
export interface DriverTurn {
  /** The agent's final assistant text for this prompt. */
  text: string
  /** The agent's session id for this turn, when it exposes one: the handle a UI links to. */
  sessionId?: string
  /** Token + cost accounting for this turn, when the agent reports it (#322). */
  usage?: DriverUsage
  /**
   * The question the agent asked with a tool of its own, as Claude Code's AskUserQuestion: the
   * driver ended the turn on it, so the person answers it the same way as one written in the text.
   */
  question?: Question
  /** The turn was ended on purpose ({@link DriverStartOptions.stop}): over, not failed. */
  stopped?: true
  /**
   * Lines the turn took from the inbox while it ran but could not hand the agent then: a message
   * sent for after the turn, or one the turn ended before it took. The next prompts, in order.
   */
  held?: InboxLine[]
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
  /**
   * Every window the account has, each with how much of it is gone: the line carries them all,
   * whichever one `window` names. What an account that cannot read its own `/usage` is known by.
   */
  windows?: DriverRateWindow[]
}

/** One of the account's windows as a turn's rate-limit line says it: its name, how full, when it resets. */
export interface DriverRateWindow {
  /** The agent's name for it: `five_hour`, `seven_day`, `seven_day_opus`… */
  window: string
  /** How much of the window is gone, 0-100. */
  percentUsed: number
  /** When it resets, epoch milliseconds. */
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
  /** When the window resets, epoch milliseconds, where the reading knows it exactly: a turn's rate-limit line does. */
  resetsAt?: number
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
 * One piece of work the agent runs in the background, as its CLI names it: `id` is the CLI's own
 * for it, `description` the agent's few words for it, `command` the shell command when it is one,
 * and `since` when it began (ISO 8601).
 */
export interface BackgroundTask {
  id: string
  description?: string
  command?: string
  since: string
}

/**
 * One file a tool call changed, as the call's own CLI reports it: the path as the CLI names it,
 * how many lines the call added and how many it removed, and `created` when the call made the file.
 */
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
  /**
   * A message the person sent while the agent worked reached it now, between two of its steps:
   * `id` is the one its inbox line carried. The agent read it with what it was doing, in the same
   * turn, so a reader shows it here, where it landed.
   */
  | { type: 'steered'; text: string; id?: string; images?: string[] }
  /** A prompt was sent; the agent's loop is starting. `attached` is the text the caller handed over with it ({@link DriverPromptOptions.attached}), `added` the sentence the caller put after it ({@link DriverPromptOptions.added}) and `images` the images it went with ({@link DriverPromptOptions.images}): the agent got all of it. */
  | { type: 'start'; prompt: string; attached?: string; added?: string; images?: string[] }
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
   * after the alias moves on. A driver whose CLI does not say omits it. `effort` is how hard it
   * thinks, the one picked or else the one in force, when the driver can tell; a driver may say
   * the model again once it can.
   */
  | { type: 'model'; model: string; effort?: string }
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
   * appending a second one, and the events the subagent's own messages make carry it as their
   * `subagent`. `call` is the id of the `action` that started it, when that is not `id`: a driver
   * whose one call can start several subagents gives each an id of its own and the call's as
   * `call`. On Claude Code `id` is the `Agent` call's `tool_use` id — one call is one subagent. On
   * Codex it is the `collabAgentToolCall` item's id and the agent's own thread id (its nickname, or
   * its place in the list, when the item names no thread) joined by a colon, and `call` the item's.
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
   * those two for the same call: the one `call` names, else the one of the same `id`.
   *
   * `task` is what the person's ■ stops it by ({@link InboxLine} `stop-task`), once its CLI named
   * one (Claude Code's task id, said a moment after the subagent began): absent where it cannot be
   * stopped alone. `stopped` is its end on that ■.
   */
  | { type: 'subagent'; id: string; call?: string; status: 'working' | 'ended' | 'failed' | 'stopped'; task?: string; name?: string; role?: string; model?: string; prompt?: string; tokens?: number; toolUses?: number }
  /** How many tokens the turn has gone through so far, its subagents' too, when its CLI says. */
  | { type: 'tokens'; tokens: number }
  /** The agent began to think: until what it thinks comes to a message or a call, it is thinking. */
  | { type: 'thinking' }
  /** What the agent thought before it acted, as its CLI summarizes it. */
  | { type: 'thought'; text: string; subagent?: string }
  /**
   * The agent is idle, waiting on work it runs in the background: its turn goes on once that work
   * ends and wakes it. `tasks` is the whole set it waits on, said each time the agent goes idle;
   * none means it is awake again, waiting no more. A driver whose CLI runs nothing in the
   * background sends none.
   */
  | { type: 'background'; tasks: BackgroundTask[] }
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

// A question the agent stopped to ask: how a turn ends when the agent will not decide alone, which
// every driver reports the same way (`DriverTurn.question`, a `question` event).

/** One option of a question: what the user picks between. */
export interface QuestionOption {
  /** Stable id an answer is posted back against; synthesized from position when the agent names none. */
  id: string
  /** The option as shown to the user. */
  label: string
  /** An optional one-liner under the label. */
  detail?: string
  /** Starts checked. Only meaningful on a {@link Question.multi} question. */
  default?: boolean
  /** Picking this ends the session rather than resuming the agent with it: the user takes over. */
  stop?: boolean
}

/** A question the agent stopped to ask. */
export interface Question {
  /** The question shown above the options. */
  title: string
  /** A word or two naming the question ("Background"): what it is called once it is passed by. */
  header?: string
  /** The options to pick between: at least one, or it is no question. */
  options: QuestionOption[]
  /** The option to default to when nobody is there to answer, when the agent named one. */
  recommended?: string
  /** Any number of options may be picked rather than exactly one. */
  multi?: boolean
  /** A markdown file the question is about (a plan under approval). */
  file?: string
}

// The inbox: what reaches a running agent from outside, one line per message or answer.

/** One line of the inbox. */
export type InboxLine =
  /**
   * The user's own words to the agent. `publish` is how far the run takes its work from this
   * message on, in the words of the tool that runs it, which reads it (`agent-runner`'s levels, or
   * `nothing`): a driver sends the words alone. `id` names the message for the lines that act on
   * it and for the `steered` event that says it landed. `later` keeps it for after the turn, as
   * Claude Code's ⌘Enter does, rather than handing it to the agent while it works. `images` are the
   * images it goes with, by the names this computer keeps them under ({@link DriverPromptOptions.images}).
   * `options` are what the session box's controls changed for it and the messages after it, one
   * slice per module: a repo given to the session, say, which the tool that runs it copies into the
   * session's folder before the message is sent, handing the agent the line saying where.
   */
  | { kind: 'message'; text: string; publish?: string; id?: string; later?: true; images?: string[]; options?: RunOptions }
  /** The user's answer to the question the agent stopped on: the question's title and the chosen label or labels. */
  | { kind: 'answer'; question: string; answer: string }
  /** Take back the message `id`, which has not reached the agent yet: the person edits it instead. */
  | { kind: 'cancel'; id: string }
  /** Hand the waiting messages to the agent now: what it is running goes on in the background, as Claude Code's Send now does. */
  | { kind: 'now' }
  /**
   * Stop one task the agent runs while it goes on: a command it left in the background, or a
   * subagent, by the id its driver said it by (a {@link BackgroundTask}'s `id`, a subagent's
   * `task`), as the ■ on its row in Claude Code does. The agent is told, and goes on.
   */
  | { kind: 'stop-task'; task: string }

/** A line that is a prompt of its own once the turn is over: a message or an answer. */
export type PromptLine = Extract<InboxLine, { kind: 'message' | 'answer' }>

// The session's log: two files in the shape of a run record, written as the agent works.

/** How the run ended: finished, stopped, failed, or waiting on an answer to the question its last turn asked. */
export type LogEndStatus = 'done' | 'stopped' | 'failed' | 'waiting'

/** What the card holds; every field but `id` is optional and the caller's to give or patch. */
export interface LogCard {
  id: string
  startedAt?: string
  intent?: string
  /** The run's short name, two to five words, as a list shows it; absent until something names it. */
  title?: string
  driver?: string
  model?: string
  /** How hard the model thinks, by its agent's names: the one picked, or the one in force when the driver can tell. */
  effort?: string
  branch?: string
  pr?: { number: number; url: string }
  /** How much of the model's context the conversation filled at the last turn ({@link DriverUsage.contextTokens}). */
  contextTokens?: number
  caller?: Record<string, unknown>
}

/** Where the log goes, and the card it starts with. */
export interface SessionLogOptions {
  dir: string
  card: LogCard
  /**
   * The files are there already, from an earlier session of the same run: the diary is kept and
   * appended to, and the card is rewritten `running`. Without it the diary starts empty.
   */
  continue?: boolean
}

/** A card as written. */
export interface WrittenCard extends LogCard {
  startedAt: string
  status: 'running' | LogEndStatus
  endedAt?: string
  cost?: number
}

/**
 * A session's log, as its caller uses it ({@link DriverSession.log}): the card it keeps, patched as
 * the run goes and ended once it is over. agent-driver keeps it in two files at the directory
 * {@link SessionLogOptions.dir} names, in the shape of a run record.
 */
export interface SessionLog {
  readonly card: WrittenCard
  /** The card's path. */
  readonly cardPath: string
  /** The diary's path: one JSON line per thing that happened. */
  readonly diaryPath: string
  /** The live file's path: the message the agent is writing, while it writes it. */
  readonly livePath: string
  /** Write one event to the diary, as the session does with each it sees. */
  record(event: DriverEvent): Promise<void>
  /** Change fields of the card. */
  patch(fields: Partial<Omit<LogCard, 'id'>>): Promise<void>
  /** Name the run: its title on the card, and a line in the diary. */
  title(text: string): Promise<void>
  /** End the log: the card's status and end time, and an `ended` line. */
  end(status: LogEndStatus, detail?: string): Promise<void>
  /** Open an ended log again, for more turns of the same session. */
  reopen(): Promise<void>
  /** Resolves once every write so far has landed. */
  settled(): Promise<void>
}

// Whether a coding agent can start a session here, asked before a run spends a checkout on it.

/** What stands in the way of a session: problems stop it, warnings are said and do not. Each line names its own fix. */
export interface DriverReadiness {
  problems: string[]
  warnings: string[]
  /** What a press does about the problem, when the adapter has a command for it: install the CLI, or log it in. */
  fix?: DriverFix
  /** The CLI's own login is out, and an added account is what runs use: its own login is no account to show. */
  ownLoggedOut?: true
}

/** The command a press runs about a problem: one the adapter declared, never one from a page. */
export interface DriverFix {
  kind: 'install' | 'log-in'
  /** A shell command line, shown under the button as it is run. */
  command: string
  /** The line of `problems` this answers: a page that says it in its own words, beside its press, leaves that line out. */
  problem: string
}

// What a driver sees of a person's several accounts: one account, the rotation it is handed, and
// what it answers a turn on an account with. Which account takes a turn is the rotation's; what an
// added account's login is, and how a turn runs on it, is the driver's.

/** One account as the list keeps it. */
export interface AgentAccount {
  /** Its name, as the person gave it; unique. The person's own login has none until they give one. */
  name: string
  /** An added account's login, as its agent keeps it. None for the person's own: the agent has that one. */
  login?: string
  /** Who the login is at its agent's service, when the computer that made it knew: an agent told it lists what that account may use. */
  accountId?: string
  /** When it was added, ISO 8601. */
  added?: string
  /** When a limit it hit frees, epoch milliseconds: until then no run picks it. */
  limitedUntil?: number
  /** Its windows as the last turn on it said them. */
  windows?: DriverRateWindow[]
  /** When those were said, epoch milliseconds. */
  windowsAt?: number
}

/** What a turn's own output said of the account it ran on, read once the turn is over. */
export interface AccountReading {
  /** Whether the account's limit is what stopped the turn. */
  limited: boolean
  /** When that limit frees, epoch ms, when the agent said. */
  resetsAt?: number
  /** The account's windows as the turn said them. */
  windows?: DriverRateWindow[]
  /** The conversation, so far as the turn got: what the next account continues. */
  sessionId?: string
}

/** What one turn on one account came to, as its agent read it. */
export interface AccountTurn extends AccountReading {
  /** The turn, when it ended with one. */
  turn?: DriverTurn
  /** What it threw, when it did. */
  failure?: unknown
}

/** What a driver gives a rotation to run one turn with. */
export interface RotatedTurn {
  /** The account the session is on, kept across its turns until a limit moves it on. */
  current: { account?: string }
  text: string
  opts: DriverPromptOptions
  emit: (event: DriverEvent) => void
  /** Whether the session or the turn was stopped: a stop is never a limit to switch over. */
  stopped: () => boolean
  /** The conversation the next account continues. */
  continueFrom: (sessionId: string) => void
  /** One turn on `account`: the person's own login, as the agent keeps it, when the account has none. */
  run: (account: AgentAccount, said: string, sent: DriverPromptOptions) => Promise<AccountTurn>
}

/** The accounts a driver's sessions run on. */
export interface AccountRotation {
  /** The account a run takes first in this environment, when any is free. */
  first(env: NodeJS.ProcessEnv): AgentAccount | undefined
  /** A turn on the accounts of this environment, handing over at a limit. */
  turn(env: NodeJS.ProcessEnv, on: RotatedTurn): Promise<DriverTurn>
}

// What only a coding agent knows of its accounts, given with it (`RunAgent.accounts`, #2394): its
// own login, how a new one is signed in, its logout, how full an account is now, and what it keeps
// of an added account beside the list. The list, its order and the next free account taking over
// at a limit are agent-driver's, the same for every agent.

/** One window of an account as a reading says it: its name, how full, and when it resets where that is known. */
export interface UsageWindow {
  /** `five_hour`, `seven_day`, `thirty_day`. */
  window: string
  /** How much of the window is gone, 0-100. */
  percentUsed: number
  /** When it resets, epoch milliseconds, when the reading said. */
  resetsAt?: number
}

/** How the person is told where to sign in to an account being added: each agent's sign-in calls the ones it has a use for. Unsaid, this computer's browser opens and that is all. */
export interface SignInSaid {
  /** A page that gives a code to bring back, on a computer with no browser: the code goes back through `paste`, which says whether the sign-in took it to check. */
  onLink?: (url: string, paste: (code: string) => boolean) => void
  /** The code brought back was not taken: the sign-in waits for another. */
  onRefused?: () => void
  /** The page, as this computer's browser opens on it: what a person copies into a private window. */
  onUrl?: (url: string) => void
  /** A code the person types at `url`, on a computer with no browser. */
  onCode?: (code: string, url: string) => void
  /** Stop it: nothing is kept. */
  signal?: AbortSignal
}

/** What a sign-in came to: the login an added account keeps, or why there is none. */
export type SignedIn = { ok: true; login: string } | { ok: false; error: string }

/** A coding agent's accounts on this computer, as only the agent knows them. */
export interface AgentLogins {
  /** The list, by the name its file and a profile's pick go by: `claude`, `codex`. */
  readonly list: string
  /** The service an account is at, as a person reads it in a sentence: `Claude`, `Codex`. */
  readonly service: string
  /** The logins the agent takes from its environment before its own: one given there is not logged out here. */
  readonly envLogins: readonly string[]
  /** Whether the agent's program is on this computer: an account of it cannot be added before. */
  installed(): Promise<boolean>
  /** Whether the agent has a login of the person's own in `env`, from what it keeps: quick enough to ask before each turn, as asking the agent is not. */
  ownLoginThere(env: NodeJS.ProcessEnv): boolean
  /** Who the person's own login is, as the agent knows them; none when it has no login of theirs, or keeps no name. */
  ownName(env: NodeJS.ProcessEnv): Promise<string | undefined>
  /** Log the person's own login out, with the agent's own logout: their terminal is logged out with it. */
  logOut(env: NodeJS.ProcessEnv): Promise<void>
  /** Sign a new account in, the person told where as `said` lets: its login, or why not. One of `accounts` already is refused, where the agent can tell who an account is. */
  signIn(accounts: readonly AgentAccount[], said: SignInSaid, env: NodeJS.ProcessEnv): Promise<SignedIn>
  /** Whether `code` is the kind of code its sign-in page gives to bring back ({@link SignInSaid.onLink}). */
  isSignInCode(code: string): boolean
  /** Take what the agent keeps of an added account beside the list (a home folder of its own) off this computer, with the account. */
  forget(account: AgentAccount, env: NodeJS.ProcessEnv): Promise<void>
  /** How full the account is now, where the agent can read it now; none where it cannot: what its last turn said stands. */
  usage(account: AgentAccount, env: NodeJS.ProcessEnv): Promise<UsageWindow[] | undefined>
  /**
   * Whether an added account still has its login on this computer, for an agent whose added logins
   * can end (signed out at the service): none signed out is said, and runs skip it, until it is
   * signed in to again under its name. Unsaid: an added login never ends here.
   */
  addedLoginThere?(account: AgentAccount, env: NodeJS.ProcessEnv): boolean
}
