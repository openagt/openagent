import { execFile, spawn as nodeSpawn } from 'node:child_process'
import { copyFile, lstat, mkdir, readlink, readdir, realpath, rename, rm, stat, symlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { accountFolder, accountHome, codexAccountsPath, codexWindows } from './codex-accounts.js'
import { turnOnAccounts, type AccountsOption, type DriverRateWindow, runCliSession, continuingTurn, finishTurn, agentEnv, attachLog, combineFraming, combineSignals, makeEmit, promptSent, readWorkspaceFile, oneLine, cutOutput, callArgument, lineCount, patchSize, hunkLines, checkCliReady, type AgentCliParser, type CliIo, type CliSpec, type DriverReadiness, type DriverReadyOptions, type PersonalSetup, type SpawnLike, type SessionLog, type Driver, type DriverEvent, type FileChange, type DriverModel, type DriverPromptOptions, type DriverSession, type DriverStartOptions, type DriverTurn, type DriverUsage } from '@openagt/agent-driver'

/**
 * Codex's sandbox policy for the shell commands the model writes.
 * `workspace-write` is our default: the agent can edit the workspace it was
 * pointed at, but not the rest of the machine. It is the counterpart of Claude
 * Code's `acceptEdits`, and the reason we never pass Codex's
 * `--dangerously-bypass-approvals-and-sandbox`.
 */
export type CodexSandbox = 'read-only' | 'workspace-write' | 'danger-full-access'

/** Options for {@link CodexDriver}. */
export interface CodexDriverOptions {
  /** CLI binary to spawn. Default `"codex"` (resolved on `PATH`). */
  bin?: string
  /** Sandbox policy. Default `"workspace-write"`. */
  sandbox?: CodexSandbox
  /**
   * Extra CLI args appended verbatim (escape hatch). Appended last, so a
   * `-c sandbox_workspace_write.writable_roots=...` here replaces the git dir
   * the driver makes writable rather than adding to it.
   */
  extraArgs?: string[]
  /** Environment for the child process. Default `process.env`. */
  env?: NodeJS.ProcessEnv
  /**
   * Which parts of the person's own setup Codex loads. Default all of them, as Codex does on
   * its own. `memory` off is `features.memories=false`; `connectors` off is `features.apps=false`
   * and `features.plugins=false`; `skills` off runs Codex from {@link codexHome}.
   */
  personal?: PersonalSetup
  /**
   * The Codex home a run with `skills` off uses in place of the person's own: a folder that starts
   * with only a link to their login, so their `AGENTS.md`, skills and `config.toml` stay out. Kept,
   * not temporary: Codex saves its conversations there, and a resume must find them. Default
   * {@link defaultCodexHome}.
   */
  codexHome?: string
  /**
   * Run on the person's Codex accounts (`codex-accounts.ts`), switching to the next free one when
   * one hits its limit. Off, every turn runs on whatever login Codex has, as it always did.
   */
  accounts?: AccountsOption
  /** `spawn` override for tests. Default `node:child_process.spawn`. */
  spawn?: SpawnLike
}

/** The Codex home kept on this machine for every project: `$XDG_STATE_HOME/agent-driver/codex-home`, or under `~/.local/state`. */
export function defaultCodexHome(env: NodeJS.ProcessEnv = process.env): string {
  return join(env['XDG_STATE_HOME'] || join(env['HOME'] || homedir(), '.local', 'state'), 'agent-driver', 'codex-home')
}

/** The person's own Codex home, where their login is: `CODEX_HOME`, else `~/.codex`. */
export function personalCodexHome(env: NodeJS.ProcessEnv = process.env): string {
  return env['CODEX_HOME'] || join(env['HOME'] || homedir(), '.codex')
}

/**
 * Make `home` a Codex home that starts with only a link to the login in `personal`, so a session
 * started there is logged in as the person and loads none of their files. Created on first use;
 * the conversations Codex saves there are kept. A link that is missing or points elsewhere is put
 * back. A plain file in its place is a login Codex saved over the link: when it is newer than the
 * person's own, it is copied onto theirs first, so a refreshed login is never lost.
 */
export async function prepareCodexHome(home: string, personal: string): Promise<void> {
  home = resolve(home)
  personal = resolve(personal)
  await mkdir(home, { recursive: true })
  // The same folder, by whatever path: nothing to link.
  if ((await realpath(home)) === (await realpath(personal).catch(() => personal))) return
  const link = join(home, 'auth.json')
  const target = join(personal, 'auth.json')
  const found = await lstat(link).catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') return undefined
    throw err
  })
  if (found?.isSymbolicLink()) {
    if ((await readlink(link)) === target) return
    await rm(link, { force: true })
  } else if (found?.isFile()) {
    // Moved aside first, so of two sessions starting at once only one takes the file, and a link
    // the other already put back is never copied onto the file it points at.
    const aside = `${link}.${process.pid}.${Date.now()}`
    const taken = await rename(link, aside).then(
      () => true,
      (err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') return false
        throw err
      },
    )
    if (taken) {
      const saved = await lstat(aside)
      const theirs = await stat(target).catch(() => undefined)
      if (saved.isFile() && (!theirs || saved.mtimeMs > theirs.mtimeMs)) {
        try {
          await mkdir(personal, { recursive: true })
          await copyFile(aside, target)
        } catch (err) {
          // Put the saved login back where the next start finds it again.
          await rename(aside, link).catch(() => {})
          throw err
        }
      }
      await rm(aside, { force: true })
    }
  } else if (found) {
    throw new Error(`${link} is neither a file nor a link; remove it to let Codex runs use this home`)
  }
  await symlink(target, link).catch(async (err: NodeJS.ErrnoException) => {
    // Another session starting at the same moment made the same link.
    if (err.code !== 'EEXIST' || (await readlink(link).catch(() => undefined)) !== target) throw err
  })
}

/**
 * The second real {@link Driver} (#539): wraps the **Codex CLI** through its
 * app server (`codex app-server`, JSON-RPC over stdio), on the user's own ChatGPT
 * subscription — no API key (#495's "bring your own subscription"). The app server
 * rather than `codex exec --json`, because only it sends the answer in pieces as
 * it is written.
 *
 * The seam always said "Claude Code today, Codex later", and this is that. Same
 * black box: prompt it, let its own loop run, read the code it wrote.
 *
 * Two ways it differs from Claude Code, both of them the agent's business
 * rather than ours:
 *
 * - **Tokens, no price.** Codex reports token counts but never a price, so usage
 *   carries the counts and omits `costUsd` rather than claim a turn cost `$0`,
 *   which would read as free (#540).
 * - **No quota read.** No `readQuota`, for the same reason: the seam is optional
 *   precisely so an agent that can't report one simply doesn't.
 */
export class CodexDriver implements Driver {
  readonly id = 'codex'
  constructor(private readonly opts: CodexDriverOptions = {}) {}

  async start(opts: DriverStartOptions): Promise<DriverSession> {
    const env = this.opts.env ?? process.env
    const personal = this.opts.personal
    const args: string[] = []
    if (personal?.memory === false) args.push('-c', 'features.memories=false')
    if (personal?.connectors === false) args.push('-c', 'features.apps=false', '-c', 'features.plugins=false')
    let sessionEnv = env
    if (personal?.skills === false) {
      const home = resolve(this.opts.codexHome ?? defaultCodexHome(env))
      await prepareCodexHome(home, personalCodexHome(env))
      sessionEnv = { ...env, CODEX_HOME: home }
    }
    const extraArgs = [...args, ...(this.opts.extraArgs ?? [])]
    return new CodexSession({ ...this.opts, env: sessionEnv, ...(extraArgs.length > 0 ? { extraArgs } : {}) }, opts, () => this.listModels())
  }

  /**
   * The models Codex's own picker offers: `codex debug models`, the catalog for the person's
   * login, cut to the entries it lists (`visibility: list`) in its own order (`priority`). Asked
   * from the person's own Codex home, where their login is. The catalog is Codex's word, not a
   * guarantee: a listed model can still be refused when a turn runs.
   */
  listModels(opts: { signal?: AbortSignal } = {}): Promise<DriverModel[]> {
    return new Promise<DriverModel[]>((resolvePromise, rejectPromise) => {
      const bin = this.opts.bin ?? 'codex'
      const spawn = this.opts.spawn ?? (nodeSpawn as unknown as SpawnLike)
      const child = spawn(bin, ['debug', 'models'], { cwd: process.cwd(), env: this.opts.env ?? process.env })
      let settled = false
      const settle = (answer: { models: DriverModel[] } | { error: string; code?: string }) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        opts.signal?.removeEventListener('abort', onAbort)
        child.kill('SIGTERM')
        if ('models' in answer) resolvePromise(answer.models)
        else rejectPromise(Object.assign(new Error(answer.error), answer.code !== undefined ? { code: answer.code } : {}))
      }
      const onAbort = () => settle({ error: 'Codex was not asked for its models: the read was stopped' })
      if (opts.signal?.aborted) return onAbort()
      opts.signal?.addEventListener('abort', onAbort)
      const timer = setTimeout(() => settle({ error: `Codex did not list its models within ${MODELS_TIMEOUT_MS / 1000}s` }), MODELS_TIMEOUT_MS)
      const out: Buffer[] = []
      const err: Buffer[] = []
      child.stdout?.on('data', (chunk: Buffer | string) => out.push(Buffer.from(chunk)))
      child.stderr?.on('data', (chunk: Buffer | string) => err.push(Buffer.from(chunk)))
      // A Codex that is not on this computer says so by the code: the reader says it in its own words.
      child.on('error', e => {
        const { code } = e as NodeJS.ErrnoException
        settle({ error: `\`${bin}\` could not start: ${e.message}`, ...(code !== undefined ? { code } : {}) })
      })
      child.on('close', code => {
        const said = oneLine(Buffer.concat(err).toString('utf8'))
        if (code !== 0) return settle({ error: `\`${bin} debug models\` failed (code ${code})${said ? `: ${said}` : ''}` })
        settle(parseCodexModels(Buffer.concat(out).toString('utf8')))
      })
    })
  }
}

/** How long {@link CodexDriver.listModels} waits for Codex's answer. */
const MODELS_TIMEOUT_MS = 30_000

/** Read `codex debug models`: the models Codex lists (`visibility: list`), by its `priority`. */
export function parseCodexModels(stdout: string): { models: DriverModel[] } | { error: string } {
  let catalog: unknown
  try {
    catalog = JSON.parse(stdout)
  } catch {
    return { error: 'Codex answered its model list in a shape this version cannot read' }
  }
  const entries = (catalog as { models?: unknown } | null)?.models
  if (!Array.isArray(entries)) return { error: 'Codex answered without a model list' }
  const listed: { model: DriverModel; priority: number }[] = []
  for (const entry of entries as Record<string, unknown>[]) {
    const id = entry?.['slug']
    const name = entry?.['display_name']
    if (entry?.['visibility'] !== 'list' || typeof id !== 'string') continue
    const priority = typeof entry['priority'] === 'number' ? entry['priority'] : Number.MAX_SAFE_INTEGER
    // What the catalog says of the model itself: how hard it can think, and how much conversation
    // it holds. `context_window` is what a thread may really use; `max_context_window` is the
    // model's ceiling under other plans.
    const efforts = Array.isArray(entry['supported_reasoning_levels'])
      ? (entry['supported_reasoning_levels'] as Record<string, unknown>[]).map(level => level?.['effort']).filter((level): level is string => typeof level === 'string')
      : []
    const window = entry['context_window']
    const defaultEffort = entry['default_reasoning_level']
    listed.push({
      model: {
        id,
        name: typeof name === 'string' ? name : id,
        ...(efforts.length > 0 ? { efforts } : {}),
        ...(typeof defaultEffort === 'string' && defaultEffort !== '' ? { defaultEffort } : {}),
        ...(typeof window === 'number' && window > 0 ? { contextWindow: window } : {}),
      },
      priority,
    })
  }
  return { models: listed.sort((a, b) => a.priority - b.priority).map(entry => entry.model) }
}

let sessionCounter = 0

/**
 * One workspace-bound Codex session. Every `prompt` is its own `codex app-server` process, asked
 * for one turn: on a fresh conversation, or, for a `resume` prompt, on the session's conversation
 * continued.
 */
export class CodexSession implements DriverSession {
  readonly id: string
  readonly cwd: string
  readonly log?: SessionLog
  private readonly startOpts: DriverStartOptions
  /**
   * The conversation a `resume` prompt continues: the one the session was started to resume,
   * then the one the last turn reported. Codex keeps the id across a resume, so consecutive
   * messages chain.
   */
  private lastSessionId: string | undefined
  /** Codex's model list, read once for the session the first time it is needed. */
  private listed: Promise<DriverModel[]> | undefined
  /** The Codex account the session is on, by name, when it runs on accounts: kept until its limit moves it on. */
  private readonly current: { account?: string } = {}

  constructor(
    private readonly config: CodexDriverOptions,
    startOpts: DriverStartOptions,
    /** Codex's models, for the effort one thinks at when none was picked and Codex did not say. */
    private readonly models?: () => Promise<DriverModel[]>,
  ) {
    const attached = attachLog(startOpts)
    this.startOpts = attached.opts
    if (attached.log) this.log = attached.log
    this.cwd = startOpts.cwd
    this.id = `codex-${++sessionCounter}`
    this.lastSessionId = startOpts.resumeSessionId
  }

  async prompt(text: string, opts: DriverPromptOptions = {}): Promise<DriverTurn> {
    const env = this.config.env ?? process.env
    const emit = this.withDefaultEffort(makeEmit(this.startOpts.onEvent, 'codex'))
    const accounts = this.config.accounts
    const turn = accounts
      ? await turnOnAccounts({
          option: accounts,
          path: accounts.path ?? codexAccountsPath(env),
          agent: 'Codex',
          current: this.current,
          text,
          opts,
          emit,
          stopped: () => this.startOpts.signal?.aborted === true || opts.signal?.aborted === true,
          continueFrom: id => {
            this.lastSessionId = id
          },
          run: async (account, said, sent) => {
            // An added account's own login, with the conversations of the home the person's own runs from.
            const turnEnv = account.login === undefined ? env : { ...env, CODEX_HOME: await accountHome(accountFolder(account, env), personalCodexHome(env), this.config.personal?.skills !== false) }
            const parser = this.parser(said, sent)
            let turn: DriverTurn | undefined
            let failure: unknown
            try {
              turn = await this.turnOn(said, sent, parser, turnEnv, emit)
            } catch (err) {
              failure = err
            }
            const sessionId = turn?.sessionId ?? parser.session
            const resetsAt = parser.limitFrees()
            return {
              ...(turn !== undefined ? { turn } : { failure }),
              limited: parser.stoppedByLimit,
              ...(resetsAt !== undefined ? { resetsAt } : {}),
              ...(parser.windows ? { windows: parser.windows } : {}),
              ...(sessionId !== undefined ? { sessionId } : {}),
            }
          },
        })
      : await this.turnOn(text, opts, this.parser(text, opts), env, emit)
    if (turn.sessionId) this.lastSessionId = turn.sessionId
    return finishTurn(this, turn, opts, emit)
  }

  /** The reader of one turn: on the session's conversation for a `resume` prompt, else a fresh one with the framing. */
  private parser(text: string, opts: DriverPromptOptions): CodexAppServerParser {
    const resumeId = opts.resume ? this.lastSessionId : undefined
    // A resumed conversation already carries its framing; sending it again only repeats it.
    const framing = resumeId === undefined ? combineFraming(this.startOpts.system, opts.system) : ''
    return new CodexAppServerParser({
      text: promptSent(text, opts),
      cwd: this.cwd,
      sandbox: this.config.sandbox ?? 'workspace-write',
      ...(framing ? { framing } : {}),
      ...(this.startOpts.model ? { model: this.startOpts.model } : {}),
      ...(resumeId !== undefined ? { resumeId } : {}),
    })
  }

  /** One turn, its own `codex app-server` process, with `env`'s Codex home and login. */
  private async turnOn(text: string, opts: DriverPromptOptions, parser: CodexAppServerParser, env: NodeJS.ProcessEnv, emit: (event: DriverEvent) => void): Promise<DriverTurn> {
    const resumeId = parser.resumeId
    // Resolved every turn, not at start: the agent may `git init` in turn 1.
    const gitDir = await gitCommonDir(this.cwd)
    const agent = (emitFn: (event: DriverEvent) => void): Promise<DriverTurn> =>
      runCliSession({
        bin: this.config.bin ?? 'codex',
        args: this.buildArgs(gitDir),
        cwd: this.cwd,
        env: agentEnv(env, this.log),
        prompt: text,
        ...(opts.added !== undefined ? { added: opts.added } : {}),
        ...(opts.attached !== undefined ? { attached: opts.attached } : {}),
        spawn: this.config.spawn ?? (nodeSpawn as unknown as SpawnLike),
        emit: emitFn,
        signals: combineSignals(this.startOpts.signal, opts.signal),
        parser,
        driver: 'codex',
      })
    // A conversation Codex no longer has (its rollout deleted, or never written on this machine) is
    // refused before the turn starts: the caller's to go on without.
    return resumeId === undefined ? agent(emit) : continuingTurn('codex', resumeId, emit, isConversationGone, agent)
  }

  /**
   * The model said again with the effort it thinks at, when none was picked and Codex said none:
   * its model's default, as Codex's model list gives it, once the list is read. A list that cannot
   * be read leaves the model as it was said.
   */
  private withDefaultEffort(emit: (event: DriverEvent) => void): (event: DriverEvent) => void {
    if (this.startOpts.effort || !this.models) return emit
    const models = this.models
    return event => {
      emit(event)
      if (event.type !== 'model' || event.effort !== undefined) return
      void (this.listed ??= models()).then(
        listed => {
          const effort = listed.find(m => m.id === event.model)?.defaultEffort
          if (effort !== undefined) emit({ type: 'model', model: event.model, effort })
        },
        () => {},
      )
    }
  }

  readCode(path: string): Promise<string> {
    return readWorkspaceFile(this.cwd, path)
  }

  dispose(): Promise<void> {
    // Each prompt spawns and reaps its own process; nothing durable to free.
    return Promise.resolve()
  }

  private buildArgs(gitDir: string | undefined): string[] {
    const args = ['app-server']
    // `workspace-write` keeps a `.git/` directory at the workspace root read-only,
    // so in a plain checkout (not a worktree) the agent's commit fails on
    // `.git/index.lock` (verified on codex-cli 0.144.4, #1747). The git dir is made
    // writable: committing is the agent's job, and a worktree's git dir already is.
    // The `-c` value is TOML; a JSON string array is a valid TOML array.
    if ((this.config.sandbox ?? 'workspace-write') === 'workspace-write' && gitDir) args.push('-c', `sandbox_workspace_write.writable_roots=${JSON.stringify([gitDir])}`)
    // How hard the model may think: Codex takes it as a config override, by the names its own
    // model list gives ({@link DriverModel.efforts}). Its own default when none is asked for.
    if (this.startOpts.effort) args.push('-c', `model_reasoning_effort=${JSON.stringify(this.startOpts.effort)}`)
    // Nothing to do in the folder, so none of what a session is given to do it with ({@link
    // DriverStartOptions.noTools}). Codex has no one switch for it, as Claude Code's `--tools ""`
    // is: its tools and the rest ride on its feature flags, so they go off one by one.
    if (this.startOpts.noTools) for (const feature of SPARE_FEATURES) args.push('-c', `features.${feature}=false`)
    if (this.config.extraArgs) args.push(...this.config.extraArgs)
    return args
  }
}

/**
 * What a session that has nothing to do can be started without, by the names `codex features list`
 * gives them ({@link DriverStartOptions.noTools}). Measured on codex-cli 0.144.4: a turn that sent
 * 11,338 tokens to be answered in 8 sends 8,799 with these off. The rest is Codex's own base
 * instructions, which come from the binary — a Codex home holding nothing but a login sends the
 * same — so this is as small as such a turn gets, where Claude Code's gets to a sixth.
 *
 * A name this list has and Codex no longer does is ignored by it, silently and without failing
 * (checked), so the list ageing costs the saving and never the run.
 */
const SPARE_FEATURES = [
  'shell_tool',
  'unified_exec',
  'apps',
  'plugins',
  'browser_use',
  'computer_use',
  'image_generation',
  'in_app_browser',
  'multi_agent',
  'tool_suggest',
  'goals',
  'personality',
  'hooks',
] as const

/** The absolute git common dir of `cwd`, or `undefined` when it is not a repository or git is missing. */
function gitCommonDir(cwd: string): Promise<string | undefined> {
  return new Promise(resolve => {
    execFile('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd }, (err, stdout) => {
      const dir = String(stdout).trim()
      resolve(err || !dir ? undefined : dir)
    })
  })
}

/**
 * What a Codex tool item did, on one line: the command without the shell wrapper Codex puts around
 * it, the files a change touches, the MCP tool, or the web search.
 */
export function codexDetail(item: Record<string, unknown>): string | undefined {
  return callArgument(codexArgument(item)).detail
}

/** What a Codex tool item was given, as it was given: see {@link codexDetail}. */
function codexArgument(item: Record<string, unknown>): string | undefined {
  const command = item['command']
  if (typeof command === 'string') return command.replace(/^\S*sh -lc (['"])([\s\S]*)\1$/, '$2')
  const changes = item['changes']
  if (Array.isArray(changes)) {
    const paths = changes.map(c => (typeof c === 'object' && c !== null ? (c as Record<string, unknown>)['path'] : undefined)).filter(p => typeof p === 'string')
    return paths.length > 0 ? paths.join(', ') : undefined
  }
  if (typeof item['server'] === 'string' && typeof item['tool'] === 'string') return `${item['server']}.${item['tool']}`
  // A call that names a tool and no server: a collab call, which says which operation it is
  // (`spawnAgent`) and, in `agentsStates`, the agents it concerns. Without this the row read as a
  // bare label with nothing beside it.
  if (typeof item['tool'] === 'string' && item['tool'] !== '') {
    const named = collabAgents(item)
      .map(agent => agent.name)
      .filter((name): name is string => name !== undefined)
    return named.length > 0 ? `${item['tool']} ${named.join(', ')}` : item['tool']
  }
  if (typeof item['query'] === 'string') return item['query']
  return undefined
}

/**
 * The item types of a collab call — the app-server's own spelling, and the core protocol's name
 * for the same thing, which `codex exec --json` emits. Our driver speaks app-server, so
 * `collabAgentToolCall` is the one that arrives; the other is one string compare and costs nothing.
 */
const COLLAB_ITEMS = new Set(['collabAgentToolCall', 'collab_tool_call'])

/**
 * The collab operations after which the agents a call names are still working: `spawnAgent` starts
 * an agent that goes on after the call is over, and `sendInput` and `resumeAgent` give a live one
 * more to do. The rest end the row — `wait` comes back when the agent has answered and
 * `closeAgent` ends it, and so does an operation we do not know: a row that never resolves is the
 * bug this is here to avoid.
 */
const COLLAB_LIVE = new Set(['spawnAgent', 'sendInput', 'resumeAgent'])

/** The agents a collab call concerns, one per `agentsStates` entry: what keys the row, the name, the role. */
function collabAgents(item: Record<string, unknown>): { key?: string; name?: string; role?: string }[] {
  const states = item['agentsStates']
  if (!Array.isArray(states)) return []
  return states
    .map(raw => {
      if (typeof raw !== 'object' || raw === null) return undefined
      const state = raw as Record<string, unknown>
      const said = (key: string): string | undefined => {
        const value = state[key]
        return typeof value === 'string' && value.trim() !== '' ? value : undefined
      }
      // The thread is the agent itself and the same across the call's notifications; the nickname
      // is the fallback when an entry names no thread.
      const key = said('agentThreadId') ?? said('threadId') ?? said('id') ?? said('agentNickname')
      const name = said('agentNickname')
      const role = said('agentRole')
      if (key === undefined && name === undefined && role === undefined) return undefined
      return { ...(key !== undefined ? { key } : {}), ...(name !== undefined ? { name } : {}), ...(role !== undefined ? { role } : {}) }
    })
    .filter((agent): agent is { key?: string; name?: string; role?: string } => agent !== undefined)
}

/**
 * The subagents one collab item describes, one event each: the names and roles come from its
 * `agentsStates`, the model and the prompt from the item. A row's id is the item's id and the
 * agent's own thread joined, because one call can concern several agents and the item id alone
 * could not tell them apart; an item whose agents cannot be read at all is still one row, for the
 * status and the prompt it does carry.
 */
function codexSubagents(item: Record<string, unknown>, completed: boolean): Extract<DriverEvent, { type: 'subagent' }>[] {
  const itemId = typeof item['id'] === 'string' && item['id'] !== '' ? item['id'] : undefined
  const bad = item['status'] === 'failed' || item['status'] === 'declined'
  const tool = item['tool']
  const status: 'working' | 'ended' | 'failed' = bad ? 'failed' : !completed || (typeof tool === 'string' && COLLAB_LIVE.has(tool)) ? 'working' : 'ended'
  const model = typeof item['model'] === 'string' && item['model'].trim() !== '' ? oneLine(item['model']) : undefined
  const prompt = typeof item['prompt'] === 'string' && item['prompt'].trim() !== '' ? cutOutput(item['prompt']) : undefined
  const common = { type: 'subagent' as const, status, ...(model !== undefined ? { model } : {}), ...(prompt !== undefined ? { prompt } : {}) }
  const agents = collabAgents(item)
  if (agents.length === 0) return itemId === undefined ? [] : [{ ...common, id: itemId }]
  return agents.map((agent, index) => {
    const key = agent.key ?? String(index)
    return {
      ...common,
      id: itemId === undefined ? key : `${itemId}:${key}`,
      ...(agent.name !== undefined ? { name: oneLine(agent.name) } : {}),
      ...(agent.role !== undefined ? { role: oneLine(agent.role) } : {}),
    }
  })
}

/**
 * One file of a Codex change: its path, its kind (`add`, `delete`, `update`, as a word or as
 * `{ type }`) and its `diff`. A changed file's diff is a patch, whose `+` and `-` lines are
 * counted. An added or a deleted file's diff is the file's content when it is no patch: every
 * line of it is added, or removed. A change with no path says nothing.
 */
function codexFileChange(raw: unknown): FileChange[] {
  if (typeof raw !== 'object' || raw === null) return []
  const change = raw as Record<string, unknown>
  const path = change['path']
  if (typeof path !== 'string') return []
  const kindOf = change['kind']
  const kind = typeof kindOf === 'string' ? kindOf : typeof kindOf === 'object' && kindOf !== null ? (kindOf as Record<string, unknown>)['type'] : undefined
  const diff = typeof change['diff'] === 'string' ? change['diff'] : ''
  const hunks = hunkLines(diff)
  if (kind === 'add') return [{ path, added: hunks ? patchSize(hunks).added : lineCount(diff), removed: 0, created: true }]
  if (kind === 'delete') return [{ path, added: 0, removed: hunks ? patchSize(hunks).removed : lineCount(diff) }]
  return [{ path, ...patchSize(hunks ?? []) }]
}

/** The one turn a {@link CodexAppServerParser} asks for. */
export interface CodexTurnRequest {
  /** The prompt. */
  text: string
  /** The workspace. */
  cwd: string
  sandbox: CodexSandbox
  /** The framing, given to a fresh conversation as Codex's developer instructions. */
  framing?: string
  model?: string
  /** The conversation to continue; without it, a fresh one starts. */
  resumeId?: string
}

/** What Codex says when the account's usage limit stops a turn (codex-cli 0.144.4). */
const USAGE_LIMIT = /you've hit your usage limit/i

/** How Codex refuses a conversation it has no record of (codex-cli 0.144.4). */
const CONVERSATION_GONE = /no rollout found for thread id/i

/** Whether a failed turn failed because the conversation it continues is not there. */
function isConversationGone(err: unknown): boolean {
  return CONVERSATION_GONE.test(err instanceof Error ? err.message : String(err))
}

/** Items that are the conversation itself, not the agent using a tool. */
const NOT_TOOLS = new Set(['userMessage', 'agentMessage', 'reasoning'])

/** A field of a JSON object, when `value` is one. */
function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined
}

/**
 * Talks to `codex app-server` (JSON-RPC, one JSON message per line, over stdio) for one turn, and
 * reads what it sends back. The exchange, as observed on codex-cli 0.144.4:
 * ```
 * → {"id":1,"method":"initialize","params":{"clientInfo":{...}}}         ← {"id":1,"result":{...}}
 * → {"method":"initialized"}
 * → {"id":2,"method":"thread/start","params":{"cwd":...}}                ← {"id":2,"result":{"thread":{"id":"01a0..."},"model":"gpt-5.5",...}}
 *   (or "thread/resume" with the threadId)
 * → {"id":3,"method":"turn/start","params":{"threadId":...,"input":[...]}} ← {"id":3,"result":{"turn":{"id":"01a1..."}}}
 * ← {"method":"item/started","params":{"item":{"type":"commandExecution","command":"/bin/zsh -lc 'ls'",...}}}
 * ← {"method":"item/agentMessage/delta","params":{"itemId":"msg_1","delta":"Crea"}}
 * ← {"method":"item/completed","params":{"item":{"type":"agentMessage","id":"msg_1","text":"Created hello.txt"}}}
 * ← {"method":"thread/tokenUsage/updated","params":{"turnId":"01a1...","tokenUsage":{"last":{"inputTokens":13686,...}}}}
 * ← {"method":"turn/completed","params":{"turn":{"status":"completed"|"failed"|"interrupted","error":{"message":...}}}}
 * ```
 * Closing stdin ends the server at once, turn or no turn, so it is closed only once the turn has
 * completed, or a request was refused.
 */
export class CodexAppServerParser implements AgentCliParser {
  private io: CliIo | undefined
  private nextId = 0
  private readonly pending = new Map<number, (result: Record<string, unknown>) => DriverEvent[]>()
  private text = ''
  /** The message being written, as far as its pieces have got. */
  private partial = ''
  private sessionId: string | undefined
  private turnId: string | undefined
  private usage: DriverUsage | undefined
  /** How full the conversation was at the last model call of this turn. */
  private context: number | undefined
  private failed: string | undefined
  private ended = false
  /** The account's windows as the turn last said them (`account/rateLimits/updated`). */
  windows: DriverRateWindow[] | undefined
  /** Whether the account's usage limit is what ended the turn. */
  stoppedByLimit = false

  constructor(private readonly turn: CodexTurnRequest) {}

  /** The conversation the turn continues, when it continues one. */
  get resumeId(): string | undefined {
    return this.turn.resumeId
  }

  /** The conversation, as soon as Codex said it: what a next account continues. */
  get session(): string | undefined {
    return this.sessionId
  }

  /** When the limit that stopped the turn frees, epoch ms: the latest reset of a window it filled. None when no window said it is full. */
  limitFrees(): number | undefined {
    const full = (this.windows ?? []).filter(w => w.percentUsed >= 100).map(w => w.resetsAt)
    return full.length > 0 ? Math.max(...full) : undefined
  }

  converse(io: CliIo): void {
    this.io = io
    this.request('initialize', { clientInfo: { name: 'agent-driver', version: '1' } }, () => {
      this.send({ method: 'initialized' })
      // No approval is ever asked: a turn nobody watches could not answer one. The sandbox is what
      // bounds the agent.
      const thread = {
        cwd: this.turn.cwd,
        approvalPolicy: 'never',
        sandbox: this.turn.sandbox,
        ...(this.turn.model ? { model: this.turn.model } : {}),
      }
      const onThread = (result: Record<string, unknown>) => this.onThread(result)
      if (this.turn.resumeId !== undefined) this.request('thread/resume', { ...thread, threadId: this.turn.resumeId }, onThread)
      else this.request('thread/start', { ...thread, ...(this.turn.framing ? { developerInstructions: this.turn.framing } : {}) }, onThread)
      return []
    })
  }

  push(line: string): DriverEvent[] {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(line) as Record<string, unknown>
    } catch {
      return [] // Banners and other noise: not every line is a message.
    }
    // `null` parses, so the catch above lets it through and every field read below throws — from
    // inside a readline handler, where nothing catches it. Noise is noise whatever it parses to.
    if (typeof msg !== 'object' || msg === null) return []
    const method = msg['method']
    const id = msg['id']
    if (typeof method !== 'string') return typeof id === 'number' ? this.onResponse(id, msg) : []
    // A request of the server's own: an approval or a question nobody is there to answer.
    if (id !== undefined) {
      this.send({ id, error: { code: -32601, message: 'agent-driver answers no requests' } })
      return []
    }
    const params = msg['params']
    return typeof params === 'object' && params !== null ? this.onNotification(method, params as Record<string, unknown>) : []
  }

  failure(): string | undefined {
    if (this.failed !== undefined) return this.failed
    // Output that stopped before the turn ended: failed, for a reason it never said.
    return this.ended ? undefined : ''
  }

  result(): DriverTurn {
    // Tokens but no `costUsd`: Codex prices nothing, and a `$0` would read as free
    // rather than as "we don't know" (#540).
    return {
      text: this.text,
      ...(this.sessionId ? { sessionId: this.sessionId } : {}),
      ...(this.usage ? { usage: { ...this.usage, ...(this.context !== undefined ? { contextTokens: this.context } : {}) } } : {}),
    }
  }

  private onThread(result: Record<string, unknown>): DriverEvent[] {
    const threadId = field(result['thread'], 'id')
    if (typeof threadId !== 'string') return this.end('Codex started no conversation')
    // Announced at once: a turn that is stopped or fails before its result must not take the id,
    // the handle a later resume needs, with it.
    this.sessionId = threadId
    this.request('turn/start', { threadId, input: [{ type: 'text', text: this.turn.text, text_elements: [] }] }, started => this.onTurn(started['turn']))
    const events: DriverEvent[] = [{ type: 'session', sessionId: threadId }]
    // The model the conversation runs on, by Codex's own id, even when none was picked, and how
    // hard it thinks when that was set: picked, or in the person's config; none for the model's own.
    const model = result['model']
    const effort = result['reasoningEffort']
    if (typeof model === 'string' && model !== '') events.push({ type: 'model', model, ...(typeof effort === 'string' && effort !== '' ? { effort } : {}) })
    return events
  }

  /** The turn this process runs, from whichever says it first: the answer to `turn/start`, or `turn/started`. */
  private onTurn(turn: unknown): DriverEvent[] {
    const turnId = field(turn, 'id')
    if (typeof turnId === 'string') this.turnId ??= turnId
    return []
  }

  private onNotification(method: string, params: Record<string, unknown>): DriverEvent[] {
    switch (method) {
      case 'turn/started':
        return this.onTurn(params['turn'])
      case 'item/agentMessage/delta': {
        const delta = params['delta']
        if (typeof delta !== 'string' || delta === '') return []
        this.partial += delta
        return [{ type: 'partial', text: this.partial }]
      }
      case 'thread/tokenUsage/updated': {
        // A resumed conversation first repeats its last turn's reading: only this turn's count.
        if (this.turnId === undefined || params['turnId'] !== this.turnId) return []
        // `last` is one model call; a turn makes several, and its usage is their sum. How full
        // the conversation is, though, is that one call's prompt and answer — the newest reading
        // wins rather than being added, or a long turn would read as a window many times over.
        const last = parseCodexUsage(field(params['tokenUsage'], 'last'))
        if (last) {
          this.usage = addUsage(this.usage, last)
          this.context = last.inputTokens + last.cacheReadTokens + last.cacheCreationTokens + last.outputTokens
        }
        return []
      }
      case 'account/rateLimits/updated': {
        const windows = codexWindows(params['rateLimits'])
        if (windows.length > 0) this.windows = windows
        return []
      }
      case 'turn/completed': {
        const status = field(params['turn'], 'status')
        if (status === 'completed') return this.end()
        const error = field(params['turn'], 'error')
        // Codex's own word for it, and its sentence ("You've hit your usage limit…") when an older one says no word.
        const info = field(error, 'codexErrorInfo')
        const message = field(error, 'message')
        if (info === 'usageLimitExceeded' || (info == null && typeof message === 'string' && USAGE_LIMIT.test(message))) this.stoppedByLimit = true
        return this.end(typeof message === 'string' && message.trim() !== '' ? codexErrorMessage(message.trim()) : `Codex's turn ended ${typeof status === 'string' ? status : 'without finishing'}`)
      }
      case 'item/started':
      case 'item/completed':
        return this.onItem(method === 'item/completed', params['item'])
      default:
        return []
    }
  }

  private onItem(completed: boolean, raw: unknown): DriverEvent[] {
    if (typeof raw !== 'object' || raw === null) return []
    const item = raw as Record<string, unknown>
    const type = item['type']
    if (typeof type !== 'string') return []
    if (type === 'agentMessage') {
      this.partial = ''
      const text = item['text']
      if (!completed || typeof text !== 'string') return []
      // Codex narrates in several messages; the last is its answer, and the
      // rest are progress. Keep the last as the turn, stream them all.
      this.text = text
      return [{ type: 'text', text }]
    }
    if (type === 'reasoning') {
      // Codex's summary of its thinking: a one-line headline, sometimes a few.
      const summary = item['summary']
      const text = Array.isArray(summary) ? summary.filter(s => typeof s === 'string').join('\n').trim() : ''
      return completed && text !== '' ? [{ type: 'thought', text }] : []
    }
    // Any other item is the agent using a tool: its kind, and what it did.
    if (NOT_TOOLS.has(type)) return []
    const id = item['id']
    // A collab call is one or more subagents of the agent's own, said beside the call's own row.
    const collab = COLLAB_ITEMS.has(type) ? codexSubagents(item, completed) : []
    if (!completed) return [{ type: 'action', label: type, ...callArgument(codexArgument(item)), ...(typeof id === 'string' ? { id } : {}) }, ...collab]
    if (typeof id !== 'string') return collab
    // A collab call reports neither changed files nor printed output, so the paths below gave a
    // finished one no `output` at all and a reader's row stayed live for ever (the rule that a
    // call which gave nothing back has no `output` stands for every other tool).
    if (COLLAB_ITEMS.has(type)) {
      const failed = item['status'] === 'failed' || item['status'] === 'declined'
      return [{ type: 'output', id, text: '', ...(failed ? { failed: true as const } : {}) }, ...collab]
    }
    // A change to files that finished reports each file and its patch. A change that did not go
    // through changed none.
    if (Array.isArray(item['changes'])) {
      const changed = item['status'] === 'failed' || item['status'] === 'declined' ? [] : item['changes'].flatMap(codexFileChange)
      return changed.length > 0 ? [{ type: 'output', id, text: '', changed }] : []
    }
    // A command that finished reports all it printed, and its exit code. Other tools report neither.
    const printed = item['aggregatedOutput']
    const exitCode = item['exitCode']
    if (typeof printed !== 'string') return []
    const text = cutOutput(printed)
    const failed = typeof exitCode === 'number' && exitCode !== 0
    if (text === '' && !failed) return []
    return [{ type: 'output', id, text, ...(failed ? { failed: true as const } : {}), ...(typeof exitCode === 'number' ? { exitCode } : {}) }]
  }

  private onResponse(id: number, msg: Record<string, unknown>): DriverEvent[] {
    const then = this.pending.get(id)
    if (!then) return []
    this.pending.delete(id)
    const error = msg['error']
    if (typeof error === 'object' && error !== null) {
      const message = field(error, 'message')
      return this.end(typeof message === 'string' && message.trim() !== '' ? codexErrorMessage(message.trim()) : 'Codex refused the request')
    }
    const result = msg['result']
    return then(typeof result === 'object' && result !== null ? (result as Record<string, unknown>) : {})
  }

  private request(method: string, params: Record<string, unknown>, then: (result: Record<string, unknown>) => DriverEvent[]): void {
    const id = ++this.nextId
    this.pending.set(id, then)
    this.send({ id, method, params })
  }

  private send(msg: Record<string, unknown>): void {
    this.io?.write(JSON.stringify(msg))
  }

  /** The turn is over, or failed with `reason`: stdin closes, and with it the server. */
  private end(reason?: string): DriverEvent[] {
    if (reason !== undefined) this.failed ??= reason
    this.ended = true
    this.io?.end()
    return []
  }
}

/** Two token readings added up. */
function addUsage(a: DriverUsage | undefined, b: DriverUsage): DriverUsage {
  if (!a) return b
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
  }
}

/**
 * The sentence inside a Codex failure message. An API refusal arrives as the API's own JSON body,
 * `{"type":"error","status":400,"error":{"message":"..."}}`, whose inner message is the part a
 * person reads; any other message is already that sentence.
 */
function codexErrorMessage(message: string): string {
  try {
    const body = JSON.parse(message) as { error?: { message?: unknown } } | null
    const inner = body?.error?.message
    if (typeof inner === 'string' && inner.trim() !== '') return inner.trim()
  } catch {
    // Not JSON: already the sentence.
  }
  return message
}

/**
 * Map one Codex token reading (a `tokenUsage.last`) onto {@link DriverUsage}. The dialect is
 * OpenAI's Responses API shape, flattened:
 * `{inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens, totalTokens}`.
 *
 * Two things that shape the mapping, both verified against codex-cli 0.144.4:
 *
 * - `inputTokens` is the **total** input, cached included. Repeating one prompt
 *   held it at 12218 while `cachedInputTokens` rose 9984 -> 12032; a non-cached
 *   count would have fallen. So the uncached part is the difference, which is what
 *   {@link DriverUsage.inputTokens} means here.
 * - `reasoningOutputTokens` is a **subset** of `outputTokens` (as
 *   `cachedInputTokens` is of `inputTokens`), so adding it would double-count.
 *
 * No price, and no cache-*write* count: OpenAI caches implicitly and bills no
 * separate write, so `cacheCreationTokens` is honestly 0 rather than a guess.
 */
export function parseCodexUsage(raw: unknown): DriverUsage | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const usage = raw as Record<string, unknown>
  const num = (key: string): number => {
    const value = usage[key]
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
  }
  const input = num('inputTokens')
  const cached = Math.min(num('cachedInputTokens'), input)
  return {
    inputTokens: input - cached,
    outputTokens: num('outputTokens'),
    cacheReadTokens: cached,
    cacheCreationTokens: 0,
  }
}

/** How the Codex CLI is asked whether a session can start. */
const CODEX_CLI: CliSpec = {
  bin: 'codex',
  install: 'install the Codex CLI and make sure `codex` is on your PATH: https://developers.openai.com/codex/cli',
  authArgs: ['login', 'status'],
  // A sentence, not JSON: "Logged in using ChatGPT", or "Not logged in". The negative first,
  // since it contains the positive.
  loggedIn: ({ output }) => (/not logged in/i.test(output) ? false : /logged in/i.test(output) ? true : undefined),
  login: 'codex login',
  // Codex's own installer puts `codex` in ~/.local/bin, and its login opens the browser and waits on
  // this computer for the sign-in: neither needs a terminal.
  fixes: { install: 'curl -fsSL https://chatgpt.com/codex/install.sh | sh', login: 'codex login' },
}

/** What {@link codexReady} takes: the CLI questions, and the setup parts a run turns off. */
export interface CodexReadyOptions extends DriverReadyOptions {
  personal?: PersonalSetup
  /** The folder of skills Codex loads from the person's home whatever its own home is. Default `~/.agents/skills`. */
  agentsSkills?: string
}

/**
 * Whether a Codex session can start here: the CLI installed and logged in. With `skills` off, a
 * `~/.agents/skills` that holds skills is a warning: Codex reads that folder from the person's
 * home whatever its own home is, and no switch keeps it out. With `skills` off, `memory` on is a
 * warning too: Codex keeps its memories in the person's own home, which the run does not use.
 */
export async function codexReady(opts: CodexReadyOptions = {}): Promise<DriverReadiness> {
  const ready = await checkCliReady(CODEX_CLI, opts)
  if (opts.personal?.skills === false) {
    const dir = opts.agentsSkills ?? join(homedir(), '.agents', 'skills')
    const skills = await readdir(dir).catch(() => [])
    if (skills.some(name => !name.startsWith('.'))) ready.warnings.push(`Codex loads your skills in ${dir} even with \`skills\` off: it has no switch for that folder. Move them out to keep them out of runs.`)
    if (opts.personal.memory) ready.warnings.push('`memory` on does nothing for Codex while `skills` is off: Codex keeps its memories in your own Codex home, which runs then do not use. Turn `skills` on too to bring them back, or `memory` off.')
  }
  return ready
}
