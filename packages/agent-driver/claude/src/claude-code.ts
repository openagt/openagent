import { spawn as nodeSpawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { readClaudeQuota } from './claude-code-quota.js'
import { readClaudeModels } from './claude-code-models.js'
import { combineFraming, combineSignals, makeEmit, promptSent, readWorkspaceFile, cutOutput, callArgument, lineCount, patchSize, runCliSession, checkCliReady, type CliSpec, type DriverReadiness, type DriverReadyOptions, type PersonalSetup, finishTurn, agentEnv, oneLine, attachLog, type SpawnLike, type SessionLog, type Driver, type DriverEvent, type FileChange, type DriverModel, type DriverPromptOptions, type DriverQuota, type DriverRateLimit, type DriverSession, type DriverStartOptions, type DriverTurn, type DriverUsage } from '@openagt/agent-driver'

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
  /** `spawn` override for tests. Default `node:child_process.spawn`. */
  spawn?: SpawnLike
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
    const resumeId = opts.resume ? this.lastSessionId : undefined
    const emit = makeEmit(this.startOpts.onEvent, 'claude-code')
    const signals = combineSignals(this.startOpts.signal, opts.signal)
    const agent = (id: string | undefined, emitFn: (event: DriverEvent) => void): Promise<DriverTurn> =>
      runCliSession({
        bin: this.config.bin ?? 'claude',
        args: this.buildArgs(system, id),
        cwd: this.cwd,
        env: agentEnv(this.config.env ?? process.env, this.log),
        prompt: text,
        ...(opts.added !== undefined ? { added: opts.added } : {}),
        ...(opts.attached !== undefined ? { attached: opts.attached } : {}),
        stdin: stdinLines(promptSent(text, opts)),
        spawn: this.config.spawn ?? (nodeSpawn as unknown as SpawnLike),
        emit: emitFn,
        signals,
        parser: new StreamJsonParser(),
        driver: 'claude-code',
      })

    let turn: DriverTurn
    // On a resume attempt, hold the failure's `error` event back until the conversation-gone
    // case (#778) is ruled out: a turn that recovers on the retry must not show a failed row.
    // Safe to hold — runCliSession emits `error` exactly once, right before it rejects.
    let heldError: DriverEvent | undefined
    try {
      turn = await agent(resumeId, resumeId === undefined ? emit : event => {
        if (event.type === 'error') heldError = event
        else emit(event)
      })
    } catch (err) {
      // The id we captured outlives what the CLI will resume (#778) — its retention, a
      // cleared history, another machine. There is no way to ask first, so let it fail
      // once and continue as a fresh conversation (which gets the system framing back)
      // rather than losing the message the user already typed.
      if (resumeId === undefined || !isConversationGone(err) || signals.some(s => s.aborted)) {
        if (heldError) emit(heldError)
        throw err
      }
      this.lastSessionId = undefined
      emit({ type: 'notice', message: 'That conversation is no longer available; continuing without its history.' })
      // The retry re-sends the same prompt; swallow its duplicate `start` so the user's
      // message appears once in the transcript, not twice.
      let startSeen = false
      turn = await agent(undefined, event => {
        if (event.type === 'start' && !startSeen) startSeen = true
        else emit(event)
      })
    }
    // Track the agent's session so a later resume continues this exact conversation.
    if (turn.sessionId) this.lastSessionId = turn.sessionId
    return finishTurn(this, turn, opts, emit)
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
    const mcpConfig = this.mcpConfigFile()
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
  /** The text block being written, as far as its pieces have got. */
  private partial = ''

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

    if (type === 'assistant') return [...announced, ...this.handleAssistant(obj)]
    if (type === 'user') return [...announced, ...this.handleResults(obj)]
    if (type === 'stream_event') return [...announced, ...this.handlePiece(obj['event'])]
    if (type === 'rate_limit_event') {
      const limit = parseRateLimit(obj)
      return limit ? [...announced, { type: 'rate-limit', limit }] : announced
    }
    if (type === 'result') {
      const result = obj['result']
      if (typeof result === 'string') this.finalText = result
      const usage = parseUsage(obj)
      if (usage) this.usage = usage
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
    const content = (message as Record<string, unknown>)['content']
    if (!Array.isArray(content)) return []
    const events: DriverEvent[] = []
    for (const item of content) {
      if (typeof item !== 'object' || item === null) continue
      const block = item as Record<string, unknown>
      if (block['type'] === 'text' && typeof block['text'] === 'string') {
        this.assistantText += block['text']
        events.push({ type: 'text', text: block['text'] })
      } else if (block['type'] === 'tool_use' && typeof block['name'] === 'string') {
        events.push({ type: 'action', label: block['name'], ...callArgument(toolArgument(block['input'])), ...callSummary(block['input']), ...(typeof block['id'] === 'string' ? { id: block['id'] } : {}) })
      } else if (block['type'] === 'thinking' && typeof block['thinking'] === 'string' && block['thinking'].trim() !== '') {
        events.push({ type: 'thought', text: block['thinking'].trim() })
      }
    }
    return events
  }

  /**
   * The CLI's own line after a tool call: a `user` message whose `tool_result` blocks each name
   * the call (`tool_use_id`) and hold what it gave back. A result with no text says nothing. The
   * line of an edit or a write also says, beside the message, what the call did to the file
   * (`tool_use_result`): that is the result's `changed`.
   */
  private handleResults(obj: Record<string, unknown>): DriverEvent[] {
    const message = obj['message']
    if (typeof message !== 'object' || message === null) return []
    const content = (message as Record<string, unknown>)['content']
    if (!Array.isArray(content)) return []
    const events: DriverEvent[] = []
    // The line describes one call: with several results on it, there is no telling whose it is.
    const change = content.length === 1 ? fileChange(obj['tool_use_result']) : undefined
    for (const item of content) {
      if (typeof item !== 'object' || item === null) continue
      const block = item as Record<string, unknown>
      if (block['type'] !== 'tool_result' || typeof block['tool_use_id'] !== 'string') continue
      const text = cutOutput(resultText(block['content']))
      const failed = block['is_error'] === true
      if (text === '' && !failed && !change) continue
      events.push({ type: 'output', id: block['tool_use_id'], text, ...(failed ? { failed: true as const } : {}), ...(change && !failed ? { changed: [change] } : {}) })
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
  return { status, window, resetsAt: resetsAt * 1000 }
}

/**
 * Pull token + cost accounting off Claude Code's `result` line (#322):
 * `total_cost_usd` plus a `usage` object of token counts. Returns undefined when
 * the line carries neither, so a driver/agent that omits usage stays usage-free.
 */
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
