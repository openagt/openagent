import { spawn as nodeSpawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { readClaudeQuota } from './claude-code-quota.js'
import { readClaudeModels } from './claude-code-models.js'
import { StreamJsonParser } from './claude-code-stream.js'
import { accountEnv, CLAUDE_TOKEN_ENV } from './claude-accounts.js'
import { type AccountRotation, accountTurn, type AgentCliParser, type CliIo, type ReadyPrompt, readyPrompt, combineFraming, combineSignals, makeEmit, promptSent, readWorkspaceFile, runCliSession, continuingTurn, checkCliReady, type CliSpec, type DriverReadiness, type DriverReadyOptions, type PersonalSetup, finishTurn, agentEnv, attachLog, type SpawnLike, type SessionLog, type Driver, type DriverEvent, type DriverModel, type DriverPromptOptions, type DriverQuota, type DriverSession, type DriverStartOptions, type DriverTurn, steeredWords } from '@openagt/agent-driver'

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
   * Run on the person's Claude accounts (`claude-accounts.ts`), the rotation switching to the next
   * free one when one hits its limit. Off, every turn runs on whatever login Claude Code has, as it
   * always did.
   */
  accounts?: AccountRotation
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
  /** Its agent asks with AskUserQuestion, which the CLI asks over stdin (`--permission-prompt-tool stdio`). */
  readonly ownQuestionTool = true
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

  /**
   * The models Claude Code's own `/model` picker offers, with the person's setup parts as a session
   * loads them: on accounts, those of the account a run takes first, which is what a run is given.
   */
  listModels(opts: { signal?: AbortSignal } = {}): Promise<DriverModel[]> {
    const { bin, env: setupEnv, extraArgs, spawn, accounts } = withPersonal(this.opts)
    const first = accounts?.first(setupEnv ?? process.env)
    const env = first ? accountEnv(first, setupEnv ?? process.env) : setupEnv
    return readClaudeModels({
      ...(bin !== undefined ? { bin } : {}),
      ...(env !== undefined ? { env } : {}),
      // A login in the environment is asked in a folder of its own; the person's own login lives in theirs.
      freshFolder: (env ?? process.env)[CLAUDE_TOKEN_ENV] !== undefined,
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
  /** {@link effortInForce}, read once for the session. */
  private effort: Promise<string | undefined> | undefined
  /** The Claude account the session is on, by name, when it runs on accounts: kept until its limit moves it on. */
  private readonly current: { account?: string } = {}

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
    const emit = withEffort(makeEmit(this.startOpts.onEvent, 'claude-code'), await this.effortInForce())
    const env = this.config.env ?? process.env
    const accounts = this.config.accounts
    const turn = accounts
      ? await accounts.turn(env, {
          current: this.current,
          text,
          opts,
          emit,
          stopped: () => this.startOpts.signal?.aborted === true || this.startOpts.stop?.aborted === true || opts.signal?.aborted === true,
          continueFrom: id => {
            this.lastSessionId = id
          },
          run: (account, said, sent) => {
            const parser = new StreamJsonParser()
            return accountTurn(() => this.turnOn(said, sent, parser, accountEnv(account, env), emit), failed => parser.accountReading(failed))
          },
        })
      : await this.turnOn(text, opts, new StreamJsonParser(), env, emit)
    // Track the agent's session so a later resume continues this exact conversation.
    if (turn.sessionId) this.lastSessionId = turn.sessionId
    return finishTurn(this, turn, opts, emit)
  }

  /** How hard the model thinks: the one picked, else the one Claude Code's settings set, read once for the session. */
  private effortInForce(): Promise<string | undefined> {
    return (this.effort ??= this.startOpts.effort !== undefined ? Promise.resolve(this.startOpts.effort) : settingsEffort(this.cwd, (this.config.env ?? process.env)['HOME'] ?? homedir(), this.config.personal?.skills !== false))
  }

  /**
   * One turn, its own `claude` process, with `env`'s login: on the session's conversation for a
   * `resume` prompt, else a fresh one with the framing.
   */
  private turnOn(said: string, sent: DriverPromptOptions, parser: StreamJsonParser, env: NodeJS.ProcessEnv, emit: (event: DriverEvent) => void): Promise<DriverTurn> {
    const resumeId = sent.resume ? this.lastSessionId : undefined
    const agent = (emitFn: (event: DriverEvent) => void): Promise<DriverTurn> =>
      runCliSession({
        bin: this.config.bin ?? 'claude',
        args: this.buildArgs(combineFraming(this.startOpts.system, sent.system), resumeId),
        cwd: this.cwd,
        env: agentEnv(env, this.log),
        prompt: said,
        ...(sent.added !== undefined ? { added: sent.added } : {}),
        ...(sent.attached !== undefined ? { attached: sent.attached } : {}),
        spawn: this.config.spawn ?? (nodeSpawn as unknown as SpawnLike),
        emit: emitFn,
        signals: combineSignals(this.startOpts.signal, sent.signal),
        parser: talking(parser, promptSent(said, sent)),
        driver: 'claude-code',
        ...(this.startOpts.stop ? { stop: this.startOpts.stop } : {}),
        ...(sent.inbox !== undefined ? { inbox: sent.inbox, steered: line => steeredWords(line, sent) } : {}),
      })
    // The id we captured may outlive what the CLI will resume (#778): its retention, a cleared
    // history, another machine. There is no way to ask first, so the turn tries, and a gone
    // conversation is the caller's to go on without.
    return resumeId === undefined ? agent(emit) : continuingTurn('claude-code', resumeId, emit, isConversationGone, agent)
  }

  /**
   * A fresh prompt whose `claude` process starts now: it reads its settings, its login and the rest
   * of its start-up — about a second, measured — while it waits for the words on stdin. On the
   * account a turn would take first; one at its limit fails the prompt rather than moving on, so a
   * caller that cannot wait for a limit asks again the usual way.
   *
   * The turn is over at its `result` line, not when the process is gone: `claude` takes another
   * three quarters of a second to exit after it answered (measured), which nothing here waits on.
   * The process still exits on its own, and is reaped as every turn's is.
   */
  ready(): ReadyPrompt {
    return readyPrompt((words, stop) => {
      const env = this.config.env ?? process.env
      const first = this.config.accounts?.first(env)
      const parser = new StreamJsonParser()
      let answer: (turn: DriverTurn) => void = () => {}
      const answered = new Promise<DriverTurn>(resolve => {
        answer = resolve
      })
      const talk = talking(parser, words)
      const conversing: AgentCliParser = {
        ...talk,
        push: line => {
          const events = talk.push(line)
          if (parser.answered) answer(parser.result())
          return events
        },
      }
      const turn = runCliSession({
        bin: this.config.bin ?? 'claude',
        args: this.buildArgs(combineFraming(this.startOpts.system)),
        cwd: this.cwd,
        env: agentEnv(first ? accountEnv(first, env) : env, this.log),
        prompt: '',
        spawn: this.config.spawn ?? (nodeSpawn as unknown as SpawnLike),
        emit: makeEmit(this.startOpts.onEvent, 'claude-code'),
        signals: [...combineSignals(this.startOpts.signal), stop],
        parser: conversing,
        driver: 'claude-code',
      })
      return Promise.race([turn, answered])
    })
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
    // `--replay-user-messages`: a message handed over while the turn runs is repeated once the agent read it.
    const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--replay-user-messages']
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
    // Claude Code asks its questions over stdin, which gives the agent its AskUserQuestion tool. The
    // same switch gives it plan mode's two tools, which no run here has: its plan is its reply.
    else args.push('--permission-prompt-tool', 'stdio', '--disallowedTools', 'EnterPlanMode', 'ExitPlanMode')
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
 * `claude` talked to over stdin rather than handed its prompt: the words go once they are known,
 * and stdin stays open for the answers to what the CLI asks during the turn, until its `result`.
 */
function talking(parser: StreamJsonParser, words: string | Promise<string>): AgentCliParser {
  const send = (io: CliIo, text: string): void => {
    for (const line of stdinLines(text).trimEnd().split('\n')) io.write(line)
  }
  return {
    push: line => parser.push(line),
    result: () => parser.result(),
    steer: message => parser.steer(message),
    withdraw: id => parser.withdraw(id),
    hurry: () => parser.hurry(),
    stop: () => parser.stop(),
    converse: io => {
      parser.talk(io)
      // Words already known go at once, before any line of the CLI's is read.
      if (typeof words === 'string') send(io, words)
      else void words.then(text => send(io, text))
    },
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

/** How the CLI reports that the session id we asked it to resume is gone from its history (#778). */
const CONVERSATION_GONE = /No conversation found with session ID/i

/** Whether a failed turn failed because the conversation we tried to resume no longer exists. */
function isConversationGone(err: unknown): boolean {
  return CONVERSATION_GONE.test(err instanceof Error ? err.message : String(err))
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
  // Claude Code's own installer puts `claude` in ~/.local/bin, and its login opens the browser and
  // waits on this computer for the yes: neither needs a terminal.
  fixes: { install: 'curl -fsSL https://claude.ai/install.sh | bash', login: 'claude auth login' },
}

/**
 * Whether a Claude Code session can start here: the CLI installed and logged in. Every part of
 * the person's setup has a switch in Claude Code, so no part is ever a warning here (running as
 * root still is).
 */
export function claudeCodeReady(opts: DriverReadyOptions = {}): Promise<DriverReadiness> {
  return checkCliReady(CLAUDE_CLI, opts)
}
