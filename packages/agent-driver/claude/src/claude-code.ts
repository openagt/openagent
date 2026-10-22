import { spawn as nodeSpawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { readClaudeQuota } from './claude-code-quota.js'
import { readClaudeModels } from './claude-code-models.js'
import { accountEnv, accountsPath, freesIn, isLimited, markLimited, noteWindows, pickAccount, readAccounts, type ClaudeAccount } from './claude-accounts.js'
import { combineFraming, combineSignals, makeEmit, promptSent, readWorkspaceFile, cutOutput, callArgument, lineCount, patchSize, runCliSession, continuingTurn, checkCliReady, type CliSpec, type DriverReadiness, type DriverReadyOptions, type PersonalSetup, finishTurn, agentEnv, oneLine, attachLog, type SpawnLike, type SessionLog, type Driver, type DriverEvent, type FileChange, type DriverModel, type DriverPromptOptions, type DriverQuota, type DriverRateLimit, type DriverRateWindow, type DriverSession, type DriverStartOptions, type DriverTurn, type DriverUsage } from '@openagt/agent-driver'

/** Claude Code permission modes we pass through to the CLI. */
export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan'

/** A stdio MCP server spec, as written into the `--mcp-config` file (#452). */
export interface McpServerSpec {
  command: string
  args?: string[]
  env?: Record<string, string>
}

/** Options for {@link ClaudeCodeDriver}. */
export interface ClaudeCodeDriverOptions {
  /** CLI binary to spawn. Default `"claude"` (resolved on `PATH`). */
  bin?: string
  /**
   * Permission mode. Default `"acceptEdits"` so file writes are non-interactive.
   * A fully autonomous build that also runs installs / tests needs
   * `"bypassPermissions"` (or {@link dangerouslySkipPermissions}).
   */
  permissionMode?: PermissionMode
  /** Add `--dangerously-skip-permissions`. Only for sandboxes with no network. */
  dangerouslySkipPermissions?: boolean
  /** Extra CLI args appended verbatim (escape hatch). */
  extraArgs?: string[]
  /**
   * MCP servers to expose to the agent for this session (#452). Written to a
   * temp config file passed via `--mcp-config`, so they merge with the user's
   * own configured MCP servers rather than replacing them.
   */
  mcpServers?: Record<string, McpServerSpec>
  /** Environment for the child process. Default `process.env`. */
  env?: NodeJS.ProcessEnv
  /**
   * Which parts of the person's own setup Claude Code loads. Default all of them, as Claude Code
   * does on its own. `memory` off is `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`; `connectors` off is
   * `ENABLE_CLAUDEAI_MCP_SERVERS=false`; `skills` off is `--setting-sources project,local`, which
   * leaves out the person's `~/.claude` settings, `CLAUDE.md` and skills together.
   */
  personal?: PersonalSetup
  /**
   * Run on the person's Claude accounts (`claude-accounts.ts`), switching to the next free one when
   * one hits its limit. Off, every turn runs on whatever login Claude Code has, as it always did.
   */
  accounts?: ClaudeAccountsOption
  /** `spawn` override for tests. Default `node:child_process.spawn`. */
  spawn?: SpawnLike
}

/** Which accounts file a session runs on, and the account it starts on when that one is free. */
export interface ClaudeAccountsOption {
  /** The file. Default {@link accountsPath} of the session's environment. */
  path?: string
  /** The account to start on, by name: a scheduler's pick. Else the first free one. */
  prefer?: string
  /** The clock, for tests. */
  now?: () => number
}

/** Every account the session may use is at its limit: the turn cannot go on. */
export class UsageLimitError extends Error {
  override readonly name = 'UsageLimitError'
}

/** What the next account is told after a switch: the prompt is in the conversation already. */
export const GO_ON = 'A usage limit stopped you. The work goes on now on another Claude account: continue where you stopped.'

/** Why no account can take the turn: each is at its limit, and the first to free says when. */
function allLimited(accounts: ClaudeAccount[], now: number): string {
  const first = accounts.filter(a => a.limitedUntil !== undefined).sort((a, b) => a.limitedUntil! - b.limitedUntil!)[0]
  const count = accounts.length === 1 ? 'The Claude account is' : `All ${accounts.length} Claude accounts are`
  return `${count} at their limit${first?.limitedUntil !== undefined ? `: ${first.name}'s is free again in ${freesIn(first.limitedUntil, now)}` : ''}.`
}

/** Whether the session or the turn was stopped: a stop is never a limit to switch over. */
function signalled(...signals: (AbortSignal | undefined)[]): boolean {
  return signals.some(signal => signal?.aborted === true)
}

/**
 * The first real {@link Driver}: wraps the **Claude Code CLI** in print mode
 * (`claude -p --output-format stream-json`). Each {@link DriverSession.prompt}
 * spawns a fresh non-interactive invocation, so every loop pass gets fresh
 * context. We stream its JSON events to {@link DriverStartOptions.onEvent}
 * for the caller's UI and return the final `result` text as the turn.
 *
 * True black box: we prompt and read the result; Claude Code owns its own loop,
 * tools, and (subscription-based) auth. A second agent slots in behind the same
 * `Driver` interface without touching the orchestration above it.
 */
export class ClaudeCodeDriver implements Driver {
  readonly id = 'claude-code'
  constructor(private readonly opts: ClaudeCodeDriverOptions = {}) {}

  start(opts: DriverStartOptions): Promise<DriverSession> {
    return Promise.resolve(new ClaudeCodeSession(withPersonal(this.opts), opts))
  }

  /** Where the account's subscription quota stands (#521). Account-wide, so no session. */
  readQuota(opts: { signal?: AbortSignal } = {}): Promise<DriverQuota> {
    const env = withPersonal(this.opts).env
    return readClaudeQuota({
      ...(this.opts.bin !== undefined ? { bin: this.opts.bin } : {}),
      ...(env !== undefined ? { env } : {}),
      ...(this.opts.spawn !== undefined ? { spawn: this.opts.spawn } : {}),
      ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    })
  }

  /** The models Claude Code's own `/model` picker offers, with the person's setup parts as a session loads them. */
  listModels(opts: { signal?: AbortSignal } = {}): Promise<DriverModel[]> {
    const { bin, env, extraArgs, spawn } = withPersonal(this.opts)
    return readClaudeModels({
      ...(bin !== undefined ? { bin } : {}),
      ...(env !== undefined ? { env } : {}),
      ...(extraArgs !== undefined ? { extraArgs } : {}),
      ...(spawn !== undefined ? { spawn } : {}),
      ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    })
  }
}

/** The options with the person's setup parts that are off turned into Claude Code's own switches. */
function withPersonal(opts: ClaudeCodeDriverOptions): ClaudeCodeDriverOptions {
  const personal = opts.personal
  if (!personal) return opts
  const env: NodeJS.ProcessEnv = { ...(opts.env ?? process.env) }
  if (!personal.memory) env['CLAUDE_CODE_DISABLE_AUTO_MEMORY'] = '1'
  if (!personal.connectors) env['ENABLE_CLAUDEAI_MCP_SERVERS'] = 'false'
  const extraArgs = [...(personal.skills ? [] : ['--setting-sources', 'project,local']), ...(opts.extraArgs ?? [])]
  return { ...opts, env, ...(extraArgs.length > 0 ? { extraArgs } : {}) }
}

/**
 * The effort Claude Code's settings set (`effortLevel`), as it reads them when none is passed: the
 * checkout's local settings, its project settings, then the person's own, which `skills` off
 * leaves out (`--setting-sources project,local`). None when no file sets one: Claude Code does not
 * say which default it then uses.
 */
export async function settingsEffort(cwd: string, home: string, user: boolean): Promise<string | undefined> {
  const files = [join(cwd, '.claude', 'settings.local.json'), join(cwd, '.claude', 'settings.json'), ...(user ? [join(home, '.claude', 'settings.json')] : [])]
  for (const file of files) {
    const settings = await readFile(file, 'utf8').then(text => JSON.parse(text) as unknown, () => undefined)
    const level = typeof settings === 'object' && settings !== null ? (settings as Record<string, unknown>)['effortLevel'] : undefined
    if (typeof level === 'string' && level !== '') return level
  }
  return undefined
}

/** The model said with `effort`, when there is one. */
function withEffort(emit: (event: DriverEvent) => void, effort: string | undefined): (event: DriverEvent) => void {
  if (effort === undefined) return emit
  return event => emit(event.type === 'model' ? { ...event, effort } : event)
}

let sessionCounter = 0

/** One workspace-bound Claude Code session. `prompt` is a fresh CLI invocation. */
export class ClaudeCodeSession implements DriverSession {
  readonly id: string
  readonly cwd: string
  /** Path to the written `--mcp-config` file, lazily created on first use. */
  private mcpConfigPath: string | undefined
  /**
   * The agent's own session id from the last turn (#714). Retained so a
   * {@link DriverPromptOptions.resume} prompt can `--resume` the same
   * conversation; resume keeps the id stable, so consecutive chat messages chain.
   */
  private lastSessionId: string | undefined
  readonly log?: SessionLog
  private readonly startOpts: DriverStartOptions
  /** How hard the model thinks: the one picked, else the one Claude Code's settings set, read once for the session. */
  private effort: Promise<string | undefined> | undefined
  /** The Claude account the session is on, by name, when it runs on accounts: kept until its limit moves it on. */
  private account: string | undefined

  constructor(
    private readonly config: ClaudeCodeDriverOptions,
    startOpts: DriverStartOptions,
  ) {
    const attached = attachLog(startOpts)
    this.startOpts = attached.opts
    if (attached.log) this.log = attached.log
    this.cwd = startOpts.cwd
    this.id = `claude-code-${++sessionCounter}`
    // Resume a finished agent (#720): seeding lastSessionId makes the very first `resume` prompt
    // `--resume` this conversation, exactly as a mid-run chat turn continues its own session.
    this.lastSessionId = startOpts.resumeSessionId
  }

  async prompt(text: string, opts: DriverPromptOptions = {}): Promise<DriverTurn> {
    const system = combineFraming(this.startOpts.system, opts.system)
    const effort = await (this.effort ??= this.startOpts.effort !== undefined ? Promise.resolve(this.startOpts.effort) : settingsEffort(this.cwd, (this.config.env ?? process.env)['HOME'] ?? homedir(), this.config.personal?.skills !== false))
    const emit = withEffort(makeEmit(this.startOpts.onEvent, 'claude-code'), effort)
    const signals = combineSignals(this.startOpts.signal, opts.signal)
    const env = this.config.env ?? process.env
    const turnOn = (said: string, sent: DriverPromptOptions, parser: StreamJsonParser, turnEnv: NodeJS.ProcessEnv): Promise<DriverTurn> => {
      const resumeId = sent.resume ? this.lastSessionId : undefined
      const agent = (id: string | undefined, emitFn: (event: DriverEvent) => void): Promise<DriverTurn> =>
        runCliSession({
          bin: this.config.bin ?? 'claude',
          args: this.buildArgs(system, id),
          cwd: this.cwd,
          env: agentEnv(turnEnv, this.log),
          prompt: said,
          ...(sent.added !== undefined ? { added: sent.added } : {}),
          ...(sent.attached !== undefined ? { attached: sent.attached } : {}),
          stdin: stdinLines(promptSent(said, sent)),
          spawn: this.config.spawn ?? (nodeSpawn as unknown as SpawnLike),
          emit: emitFn,
          signals,
          parser,
          driver: 'claude-code',
        })
      // The id we captured may outlive what the CLI will resume (#778): its retention, a cleared
      // history, another machine. There is no way to ask first, so the turn tries, and a gone
      // conversation is the caller's to go on without.
      return resumeId === undefined ? agent(undefined, emit) : continuingTurn('claude-code', resumeId, emit, isConversationGone, held => agent(resumeId, held))
    }

    const accounts = this.config.accounts
    const turn = accounts ? await this.onAccounts(accounts, text, opts, emit, env, turnOn) : await turnOn(text, opts, new StreamJsonParser(), env)
    // Track the agent's session so a later resume continues this exact conversation.
    if (turn.sessionId) this.lastSessionId = turn.sessionId
    return finishTurn(this, turn, opts, emit)
  }

  /**
   * A turn on the person's Claude accounts (`claude-accounts.ts`): on the one the session is on, or
   * the first free one. The account's windows are kept as the turn says them; a turn its account's
   * limit stops marks the account limited until it frees, and the same conversation goes on with
   * the next free account, told to go on where it stopped. Every account at its limit ends the turn.
   */
  private async onAccounts(
    accounts: ClaudeAccountsOption,
    text: string,
    opts: DriverPromptOptions,
    emit: (event: DriverEvent) => void,
    env: NodeJS.ProcessEnv,
    turnOn: (said: string, sent: DriverPromptOptions, parser: StreamJsonParser, turnEnv: NodeJS.ProcessEnv) => Promise<DriverTurn>,
  ): Promise<DriverTurn> {
    const now = accounts.now ?? Date.now
    const path = accounts.path ?? accountsPath(env)
    let said = text
    let sent = opts
    // One account is no choice: the turn tries it, as one always did, whatever a limit said of it before.
    if (readAccounts(path).length < 2) return turnOn(text, opts, new StreamJsonParser(), env)
    for (;;) {
      const all = readAccounts(path)
      const account = (this.account !== undefined ? all.find(a => a.name === this.account && !isLimited(a, now())) : undefined) ?? pickAccount(all, now(), accounts.prefer)
      if (account === undefined) throw new UsageLimitError(allLimited(all, now()))
      this.account = account.name
      const parser = new StreamJsonParser()
      let turn: DriverTurn | undefined
      let failure: unknown
      try {
        turn = await turnOn(said, sent, parser, accountEnv(account, env))
      } catch (err) {
        failure = err
      }
      if (parser.windows) noteWindows(account.name, parser.windows, now(), path)
      const limited = parser.stoppedByLimit || (failure !== undefined && parser.rejected !== undefined)
      if (!limited || signalled(this.startOpts.signal, opts.signal)) {
        if (turn === undefined) throw failure
        return turn
      }
      const after = markLimited(account.name, parser.rejected?.resetsAt, now(), path)
      const next = pickAccount(after, now())
      if (next === undefined) throw new UsageLimitError(allLimited(after, now()))
      const frees = after.find(a => a.name === account.name)?.limitedUntil
      emit({ type: 'notice', message: `↻ Switched to ${next.name}'s Claude: ${account.name}'s hit its limit${frees !== undefined ? `, free again in ${freesIn(frees, now())}` : ''}.` })
      this.account = next.name
      if (turn?.sessionId) this.lastSessionId = turn.sessionId
      else if (parser.session !== undefined) this.lastSessionId = parser.session
      // The prompt is in the conversation already: the next account is told to go on with it, and
      // nothing of what went with it is handed over twice.
      const { attached: _attached, added: _added, inbox: _inbox, onInboxLine: _onInboxLine, ...rest } = opts
      said = GO_ON
      sent = { ...rest, resume: true }
    }
  }

  readCode(path: string): Promise<string> {
    return readWorkspaceFile(this.cwd, path)
  }

  dispose(): Promise<void> {
    // Each prompt spawns and reaps its own process, so the only durable thing is
    // the temp MCP config file; drop it. The session id reaches the UI via the
    // emitted result event.
    if (this.mcpConfigPath) {
      try {
        rmSync(dirname(this.mcpConfigPath), { recursive: true, force: true })
      } catch {
        // Best effort: the temp dir lands under the OS tmp and is reaped anyway.
      }
      this.mcpConfigPath = undefined
    }
    return Promise.resolve()
  }

  private buildArgs(system: string, resumeId?: string): string[] {
    // `--include-partial-messages`: the reply also comes in pieces as it is written, before the whole message.
    const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages']
    if (this.config.dangerouslySkipPermissions) args.push('--dangerously-skip-permissions')
    else args.push('--permission-mode', this.config.permissionMode ?? 'acceptEdits')
    // Resume the same conversation for a chat turn (#714). Skip the system append then:
    // the resumed transcript already carries its framing, so re-appending only duplicates it.
    if (resumeId) args.push('--resume', resumeId)
    else if (system) args.push('--append-system-prompt', system)
    if (this.startOpts.model) args.push('--model', this.startOpts.model)
    // How hard the model may think (`claude --effort <level>`); the CLI's own default when none.
    if (this.startOpts.effort) args.push('--effort', this.startOpts.effort)
    // Nothing to do in the folder, so nothing to do it with: the CLI's built-in tools and the MCP
    // servers it would otherwise load are most of what such a turn sends, and a model with no tool
    // cannot go looking for the files the words it is naming happen to mention.
    if (this.startOpts.noTools) args.push('--tools', '', '--strict-mcp-config')
    const mcpConfig = this.startOpts.noTools ? undefined : this.mcpConfigFile()
    if (mcpConfig) args.push('--mcp-config', mcpConfig)
    if (this.config.extraArgs) args.push(...this.config.extraArgs)
    return args
  }

  /**
   * Lazily materialize the `--mcp-config` file for {@link ClaudeCodeDriverOptions.mcpServers}.
   * Written once and reused across the session's prompts; `undefined` when no
   * servers are configured. Not `--strict-mcp-config`, so these merge with the
   * user's own MCP servers rather than replacing them.
   */
  private mcpConfigFile(): string | undefined {
    const servers = this.config.mcpServers
    if (!servers || Object.keys(servers).length === 0) return undefined
    if (!this.mcpConfigPath) {
      const dir = mkdtempSync(join(tmpdir(), 'agent-driver-mcp-'))
      this.mcpConfigPath = join(dir, 'mcp.json')
      writeFileSync(this.mcpConfigPath, JSON.stringify({ mcpServers: servers }))
    }
    return this.mcpConfigPath
  }
}

/**
 * The prompt as the CLI's stream-json input: first the request that turns thinking text on, then
 * the user's message. A plain `-p` run sends thinking blocks with their text empty; asked for
 * `summarized`, it fills them with its own short summary.
 */
function stdinLines(text: string): string {
  const thinking = { type: 'control_request', request_id: 'thinking', request: { subtype: 'set_max_thinking_tokens', max_thinking_tokens: null, thinking_display: 'summarized' } }
  const message = { type: 'user', message: { role: 'user', content: text } }
  return `${JSON.stringify(thinking)}\n${JSON.stringify(message)}\n`
}

/** The input keys, in order, whose value says what a tool call did; the first one present is the call's detail. */
const DETAIL_KEYS = ['skill', 'command', 'file_path', 'notebook_path', 'path', 'url', 'pattern', 'query', 'description', 'prompt']

/**
 * The tools Claude Code starts an in-process subagent with. `Agent` is its name today; `Task` is
 * the same tool in versions before it was renamed. Both are accepted — one string compare, and an
 * older CLI shows its subagents rather than nothing.
 */
const AGENT_TOOLS = new Set(['Agent', 'Task'])

/**
 * The subagent one `Agent` call starts, off the call's own input: `description` is the name Claude
 * gave the task, `subagent_type` the kind of agent, `prompt` what it was told to do, and `model`
 * only when the call overrode the parent's — absent means the parent's model, which the CLI does
 * not repeat here, so we leave it out rather than guess.
 */
function claudeSubagent(id: string, input: unknown, status: 'working' | 'ended' | 'failed'): Extract<DriverEvent, { type: 'subagent' }> {
  const fields = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
  const said = (key: string): string | undefined => {
    const value = fields[key]
    return typeof value === 'string' && value.trim() !== '' ? value : undefined
  }
  const name = said('description')
  const role = said('subagent_type')
  const model = said('model')
  const prompt = said('prompt')
  return {
    type: 'subagent',
    id,
    status,
    ...(name !== undefined ? { name: oneLine(name) } : {}),
    ...(role !== undefined ? { role: oneLine(role) } : {}),
    ...(model !== undefined ? { model: oneLine(model) } : {}),
    ...(prompt !== undefined ? { prompt: cutOutput(prompt) } : {}),
  }
}

/**
 * What an edit or a write did to its file, off the CLI's own account of the call: a file it made
 * holds its content's lines, all added; a file it changed holds a patch, whose `+` and `-` lines
 * are counted. Any other call's account names no file this way, and says nothing.
 */
function fileChange(result: unknown): FileChange | undefined {
  if (typeof result !== 'object' || result === null) return undefined
  const account = result as Record<string, unknown>
  const path = account['filePath']
  if (typeof path !== 'string') return undefined
  if (account['type'] === 'create') return { path, added: typeof account['content'] === 'string' ? lineCount(account['content']) : 0, removed: 0, created: true }
  const patch = account['structuredPatch']
  if (!Array.isArray(patch)) return undefined
  const lines = patch.flatMap(hunk => (typeof hunk === 'object' && hunk !== null && Array.isArray((hunk as Record<string, unknown>)['lines']) ? ((hunk as Record<string, unknown>)['lines'] as unknown[]) : []))
  return { path, ...patchSize(lines.filter((line): line is string => typeof line === 'string')) }
}

/** The one argument that says what a tool call did, as it was given. */
function toolArgument(input: unknown): string | undefined {
  if (typeof input !== 'object' || input === null) return undefined
  const fields = input as Record<string, unknown>
  const key = DETAIL_KEYS.find(k => typeof fields[k] === 'string' && (fields[k] as string).trim() !== '')
  return key === undefined ? undefined : (fields[key] as string)
}

/**
 * The few words Claude gives a call to say what it does ("List project files"), its `description`,
 * when the call's detail is something else (a command): a call whose detail is that description
 * (a subagent's) has nothing more to say.
 */
function callSummary(input: unknown): { summary?: string } {
  if (typeof input !== 'object' || input === null) return {}
  const summary = (input as Record<string, unknown>)['description']
  if (typeof summary !== 'string' || summary.trim() === '' || toolArgument(input) === summary) return {}
  return { summary: summary.replace(/\s+/g, ' ').trim() }
}

/**
 * The subagent a stream line is from, by its `Agent` call's id: the CLI writes it on every line a
 * subagent's own conversation makes (`parent_tool_use_id`), and nothing on the agent's own.
 */
function withinSubagent(obj: Record<string, unknown>): string | undefined {
  const parent = obj['parent_tool_use_id']
  return typeof parent === 'string' && parent !== '' ? parent : undefined
}

/** The one argument that says what a tool call did, on one line and cut short. */
export function toolDetail(input: unknown): string | undefined {
  return callArgument(toolArgument(input)).detail
}

/**
 * What a tool gave back, from a `tool_result` block: its `content` is the text itself, or a list
 * of blocks whose text ones hold it (an image block holds none).
 */
function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map(part => (typeof part === 'object' && part !== null && (part as Record<string, unknown>)['type'] === 'text' ? (part as Record<string, unknown>)['text'] : undefined))
    .filter(text => typeof text === 'string')
    .join('\n')
}

/** How the CLI reports that the session id we asked it to resume is gone from its history (#778). */
const CONVERSATION_GONE = /No conversation found with session ID/i

/** Whether a failed turn failed because the conversation we tried to resume no longer exists. */
function isConversationGone(err: unknown): boolean {
  return CONVERSATION_GONE.test(err instanceof Error ? err.message : String(err))
}

/**
 * Incremental parser for Claude Code's `stream-json` output: newline-delimited
 * JSON, one object per line. We surface assistant text, thinking, tool calls and what each call
 * gave back as {@link DriverEvent}s and keep the final `result` line as the turn text.
 * Kept separate from the process plumbing so it is unit-testable in isolation.
 */
export class StreamJsonParser {
  private finalText = ''
  private assistantText = ''
  private sessionId?: string
  private usage?: DriverUsage
  /** How full the conversation was at the last model call of this turn: that call's own `usage`. */
  private context?: number
  /** The text block being written, as far as its pieces have got. */
  private partial = ''
  /** The subagents of this turn that have not ended yet, by their `Agent` call's id, as they were announced. */
  private readonly subagents = new Map<string, Extract<DriverEvent, { type: 'subagent' }>>()
  /**
   * The subagents the CLI runs in the background, by their call's id: the call answers at once that
   * the subagent began, and the CLI's `task_notification` says when it is over.
   */
  private readonly backgrounded = new Set<string>()
  /** The agent's message is the CLI's own "You've hit your limit" (`error: "rate_limit"`): the account's limit stopped the turn. */
  stoppedByLimit = false
  /** A rate-limit line said `rejected`: a turn that failed after it failed on the account's limit. When it frees, where said. */
  rejected: { resetsAt?: number } | undefined
  /** The account's windows as this turn's last rate-limit line said them. */
  windows: DriverRateWindow[] | undefined

  /** The agent's session id, once a line said it. */
  get session(): string | undefined {
    return this.sessionId
  }

  /** Feed one line; returns the events it produced (may be empty). */
  push(line: string): DriverEvent[] {
    const trimmed = line.trim()
    if (!trimmed) return []
    let obj: Record<string, unknown>
    try {
      obj = JSON.parse(trimmed) as Record<string, unknown>
    } catch {
      return [] // Non-JSON noise (banners etc.); ignore.
    }
    // `null` parses, so the catch above lets it through and every field read below throws — from
    // inside a readline handler, where nothing catches it. Noise is noise whatever it parses to.
    if (typeof obj !== 'object' || obj === null) return []

    // Announced on the very first stream line, so it must not wait for `result`: a turn that is
    // stopped or dies mid-flight would take the id — the agent's `claude --resume` handle — with
    // it (#1322). Emitted only when it changes; every subsequent line repeats the same id.
    const announced: DriverEvent[] = []
    if (typeof obj['session_id'] === 'string' && obj['session_id'] !== this.sessionId) {
      this.sessionId = obj['session_id']
      announced.push({ type: 'session', sessionId: this.sessionId })
    }
    const type = obj['type']
    // The CLI's first line names the model it resolved the pick to (`claude-opus-5-5` for `opus`),
    // or the one it chose when none was picked: what the turn runs on, said before it runs.
    if (type === 'system' && obj['subtype'] === 'init' && typeof obj['model'] === 'string' && obj['model'] !== '') {
      announced.push({ type: 'model', model: obj['model'] })
    }

    // A subagent's task, as the CLI reports it beside the subagent's own messages: one run in the
    // background is over when its task is, and its call's answer only said it began.
    if (type === 'system' && obj['subtype'] === 'task_started' && obj['is_backgrounded'] === true && typeof obj['tool_use_id'] === 'string') {
      this.backgrounded.add(obj['tool_use_id'])
      return announced
    }
    if (type === 'system' && obj['subtype'] === 'task_notification' && typeof obj['tool_use_id'] === 'string') {
      return [...announced, ...this.endSubagent(obj['tool_use_id'], obj['status'] !== 'completed')]
    }

    if (type === 'assistant' && obj['error'] === 'rate_limit') {
      this.stoppedByLimit = true
      this.rejected = { ...this.rejected, ...limitFrees(obj) }
    }
    if (type === 'assistant') return [...announced, ...this.handleAssistant(obj)]
    if (type === 'user') return [...announced, ...this.handleResults(obj)]
    // A subagent's message being written is not the agent's: only its whole message is shown, as the subagent's.
    if (type === 'stream_event') return withinSubagent(obj) !== undefined ? announced : [...announced, ...this.handlePiece(obj['event'])]
    if (type === 'rate_limit_event') {
      const limit = parseRateLimit(obj)
      if (limit?.windows) this.windows = limit.windows
      if (limit?.status === 'rejected') this.rejected = { resetsAt: limit.resetsAt }
      return limit ? [...announced, { type: 'rate-limit', limit }] : announced
    }
    if (type === 'result') {
      const result = obj['result']
      if (typeof result === 'string') this.finalText = result
      const usage = parseUsage(obj)
      if (usage) this.usage = { ...usage, ...(this.context !== undefined ? { contextTokens: this.context } : {}) }
      return announced // The `result` event is emitted by the runner after `close`.
    }
    return announced
  }

  /**
   * One piece of the message being written: a text block starts empty, and each piece of it adds
   * to the text so far. Thinking and tool input come in pieces too; they are said once whole.
   */
  private handlePiece(event: unknown): DriverEvent[] {
    if (typeof event !== 'object' || event === null) return []
    const e = event as Record<string, unknown>
    if (e['type'] === 'content_block_start') {
      this.partial = ''
      return []
    }
    const delta = e['delta']
    if (e['type'] !== 'content_block_delta' || typeof delta !== 'object' || delta === null) return []
    const d = delta as Record<string, unknown>
    if (d['type'] !== 'text_delta' || typeof d['text'] !== 'string' || d['text'] === '') return []
    this.partial += d['text']
    return [{ type: 'partial', text: this.partial }]
  }

  private handleAssistant(obj: Record<string, unknown>): DriverEvent[] {
    const message = obj['message']
    if (typeof message !== 'object' || message === null) return []
    // A subagent's own message: its events are the subagent's, and nothing of it is the agent's —
    // not its text, which is no part of the agent's reply, nor its usage, which is the subagent's
    // conversation and not the agent's.
    const within = withinSubagent(obj)
    const tag = within !== undefined ? { subagent: within } : {}
    // Every assistant message carries the usage of the one model call that wrote it, so the last
    // of them says how full the conversation is now. The `result` line's usage is the turn's total
    // over every call it made, which is a different number and a much bigger one.
    const context = within === undefined ? contextOf((message as Record<string, unknown>)['usage']) : undefined
    if (context !== undefined) this.context = context
    const events: DriverEvent[] = within !== undefined ? this.subagentModel(within, (message as Record<string, unknown>)['model']) : []
    const content = (message as Record<string, unknown>)['content']
    if (!Array.isArray(content)) return events
    for (const item of content) {
      if (typeof item !== 'object' || item === null) continue
      const block = item as Record<string, unknown>
      if (block['type'] === 'text' && typeof block['text'] === 'string') {
        if (within === undefined) this.assistantText += block['text']
        events.push({ type: 'text', text: block['text'], ...tag })
      } else if (block['type'] === 'tool_use' && typeof block['name'] === 'string') {
        events.push({ type: 'action', label: block['name'], ...callArgument(toolArgument(block['input'])), ...callSummary(block['input']), ...(typeof block['id'] === 'string' ? { id: block['id'] } : {}), ...tag })
        // An `Agent` call is a subagent of its own: said beside its row, never instead of it. The
        // call's id is the subagent's, so its result ends the same row; a call without one cannot
        // be paired with its result and is left as the plain row it always was. A subagent's own
        // `Agent` call is one of its steps: the CLI starts no subagent of a subagent's.
        if (within === undefined && AGENT_TOOLS.has(block['name']) && typeof block['id'] === 'string') {
          const started = claudeSubagent(block['id'], block['input'], 'working')
          this.subagents.set(block['id'], started)
          events.push(started)
        }
      } else if (block['type'] === 'thinking' && typeof block['thinking'] === 'string' && block['thinking'].trim() !== '') {
        events.push({ type: 'thought', text: block['thinking'].trim(), ...tag })
      }
    }
    return events
  }

  /**
   * The model a subagent runs on, off its first message, when its call did not name one: the call
   * leaves the parent's model unsaid, and the subagent's own message says which model wrote it, so
   * the row is said again with it.
   */
  private subagentModel(id: string, model: unknown): DriverEvent[] {
    const subagent = this.subagents.get(id)
    if (subagent === undefined || subagent.model !== undefined || typeof model !== 'string' || model.trim() === '') return []
    const named = { ...subagent, model: oneLine(model) }
    this.subagents.set(id, named)
    return [named]
  }

  /** A subagent's row over, said again whole, so a reader replaces the row by its id without having to remember what the first one carried. */
  private endSubagent(id: string, failed: boolean): DriverEvent[] {
    const subagent = this.subagents.get(id)
    if (subagent === undefined) return []
    this.subagents.delete(id)
    this.backgrounded.delete(id)
    return [{ ...subagent, status: failed ? 'failed' : 'ended' }]
  }

  /**
   * The CLI's own line after a tool call: a `user` message whose `tool_result` blocks each name
   * the call (`tool_use_id`) and hold what it gave back. A result with no text says nothing. The
   * line of an edit or a write also says, beside the message, what the call did to the file
   * (`tool_use_result`): that is the result's `changed`. The result of an `Agent` call also ends
   * its subagent's row, failed when the result is an error.
   */
  private handleResults(obj: Record<string, unknown>): DriverEvent[] {
    const message = obj['message']
    if (typeof message !== 'object' || message === null) return []
    const content = (message as Record<string, unknown>)['content']
    if (!Array.isArray(content)) return []
    const events: DriverEvent[] = []
    const within = withinSubagent(obj)
    // The line describes one call: with several results on it, there is no telling whose it is.
    const change = content.length === 1 ? fileChange(obj['tool_use_result']) : undefined
    for (const item of content) {
      if (typeof item !== 'object' || item === null) continue
      const block = item as Record<string, unknown>
      if (block['type'] !== 'tool_result' || typeof block['tool_use_id'] !== 'string') continue
      const text = cutOutput(resultText(block['content']))
      const failed = block['is_error'] === true
      if (text !== '' || failed || change) {
        events.push({ type: 'output', id: block['tool_use_id'], text, ...(failed ? { failed: true as const } : {}), ...(change && !failed ? { changed: [change] } : {}), ...(within !== undefined ? { subagent: within } : {}) })
      }
      // A subagent's call: its row is over, unless the CLI runs it in the background, when the call
      // answers that it began and the row ends with its task. One that failed to begin is over.
      if (!this.backgrounded.has(block['tool_use_id']) || failed) events.push(...this.endSubagent(block['tool_use_id'], failed))
    }
    return events
  }

  /** The final turn: the `result` text, falling back to accumulated assistant text. */
  result(): DriverTurn {
    const text = this.finalText || this.assistantText
    return {
      text,
      ...(this.sessionId ? { sessionId: this.sessionId } : {}),
      ...(this.usage ? { usage: this.usage } : {}),
    }
  }
}

/**
 * Pull the account's quota standing off a `rate_limit_event` line (#517):
 * `{status, resetsAt, rateLimitType}`. The agent emits one per turn, so this is
 * free telemetry — no extra call, no polling. Returns undefined when the payload
 * is missing the parts we'd gate on, so a malformed line stays silent rather
 * than reporting a bogus reset.
 */
function parseRateLimit(obj: Record<string, unknown>): DriverRateLimit | undefined {
  const raw = obj['rate_limit_info']
  if (typeof raw !== 'object' || raw === null) return undefined
  const info = raw as Record<string, unknown>
  const status = info['status']
  const window = info['rateLimitType']
  const resetsAt = info['resetsAt']
  if (typeof status !== 'string' || typeof window !== 'string') return undefined
  if (typeof resetsAt !== 'number' || !Number.isFinite(resetsAt)) return undefined
  // The agent reports epoch seconds; `resetsAt` is millis.
  const windows = rateWindows(info['unifiedWindows'])
  return { status, window, resetsAt: resetsAt * 1000, ...(windows.length > 0 ? { windows } : {}) }
}

/** When the limit an agent's "You've hit your limit" message is about frees, where the message's `apiErrorParams` say. */
function limitFrees(obj: Record<string, unknown>): { resetsAt?: number } {
  const params = obj['apiErrorParams']
  const info = typeof params === 'object' && params !== null ? (params as Record<string, unknown>)['rate_limit_info'] : undefined
  const resetsAt = typeof info === 'object' && info !== null ? (info as Record<string, unknown>)['resetsAt'] : undefined
  return typeof resetsAt === 'number' && Number.isFinite(resetsAt) ? { resetsAt: resetsAt * 1000 } : {}
}

/** The account's windows off a rate-limit line's `unifiedWindows`: `{five_hour: {utilization: 0.02, resetsAt}}`, the share 0-1. */
function rateWindows(raw: unknown): DriverRateWindow[] {
  if (typeof raw !== 'object' || raw === null) return []
  const windows: DriverRateWindow[] = []
  for (const [window, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue
    const { utilization, resetsAt } = value as Record<string, unknown>
    if (typeof utilization !== 'number' || !Number.isFinite(utilization) || typeof resetsAt !== 'number' || !Number.isFinite(resetsAt)) continue
    windows.push({ window, percentUsed: Math.round(utilization * 1000) / 10, resetsAt: resetsAt * 1000 })
  }
  return windows
}

/**
 * Pull token + cost accounting off Claude Code's `result` line (#322):
 * `total_cost_usd` plus a `usage` object of token counts. Returns undefined when
 * the line carries neither, so a driver/agent that omits usage stays usage-free.
 */
/**
 * How full the conversation was at one model call: the whole prompt it was given (the cached part
 * included) and what it wrote back. `undefined` when the message carries no usage.
 */
export function contextOf(raw: unknown): number | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const usage = raw as Record<string, unknown>
  const num = (key: string): number => {
    const value = usage[key]
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
  }
  const total = num('input_tokens') + num('cache_read_input_tokens') + num('cache_creation_input_tokens') + num('output_tokens')
  return total > 0 ? total : undefined
}

function parseUsage(obj: Record<string, unknown>): DriverUsage | undefined {
  const cost = obj['total_cost_usd']
  const raw = obj['usage']
  const hasUsage = typeof raw === 'object' && raw !== null
  if (typeof cost !== 'number' && !hasUsage) return undefined
  const usage = (hasUsage ? raw : {}) as Record<string, unknown>
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  // Omit costUsd when there is no price, never 0: a spending limit reads 0 as "free"
  // and undefined as "unknown" (#540), and Codex reports tokens without a price.
  return {
    ...(typeof cost === 'number' && Number.isFinite(cost) ? { costUsd: cost } : {}),
    inputTokens: num(usage['input_tokens']),
    outputTokens: num(usage['output_tokens']),
    cacheReadTokens: num(usage['cache_read_input_tokens']),
    cacheCreationTokens: num(usage['cache_creation_input_tokens']),
  }
}

/** How the Claude Code CLI is asked whether a session can start. */
const CLAUDE_CLI: CliSpec = {
  bin: 'claude',
  install: 'install Claude Code and make sure `claude` is on your PATH: https://claude.com/claude-code',
  authArgs: ['auth', 'status'],
  // Prints JSON (`{"loggedIn": true, ...}`) and exits 0 either way, so the flag is the answer.
  // A version too old to know the subcommand prints usage, which reads as "could not say".
  loggedIn: ({ output }) => {
    try {
      const value = (JSON.parse(output) as Record<string, unknown> | null)?.['loggedIn']
      return typeof value === 'boolean' ? value : undefined
    } catch {
      return undefined
    }
  },
  login: 'claude auth login',
}

/**
 * Whether a Claude Code session can start here: the CLI installed and logged in. Every part of
 * the person's setup has a switch in Claude Code, so no part is ever a warning here (running as
 * root still is).
 */
export function claudeCodeReady(opts: DriverReadyOptions = {}): Promise<DriverReadiness> {
  return checkCliReady(CLAUDE_CLI, opts)
}
