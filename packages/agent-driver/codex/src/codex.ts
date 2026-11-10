import { execFile, spawn as nodeSpawn } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { accountEnv, accountFolder, accountHome } from './codex-accounts.js'
import { CodexAppServerParser, type CodexSandbox } from './codex-app-server.js'
import { defaultCodexHome, personalCodexHome, prepareCodexHome } from './codex-home.js'
import { type AccountRotation, accountTurn, type ReadyPrompt, readyPrompt, runCliSession, continuingTurn, finishTurn, agentEnv, attachLog, combineFraming, combineSignals, makeEmit, promptSent, readWorkspaceFile, oneLine, checkCliReady, type CliSpec, type DriverReadiness, type DriverReadyOptions, type PersonalSetup, type SpawnLike, type SessionLog, type Driver, type DriverEvent, type DriverModel, type DriverPromptOptions, type DriverSession, type DriverStartOptions, type DriverTurn, steeredWords } from '@openagt/agent-driver'

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
   * Run on the person's Codex accounts (`codex-accounts.ts`), the rotation switching to the next
   * free one when one hits its limit. Off, every turn runs on whatever login Codex has, as it
   * always did.
   */
  accounts?: AccountRotation
  /** `spawn` override for tests. Default `node:child_process.spawn`. */
  spawn?: SpawnLike
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
  // No `ownQuestionTool`, though the agent has request_user_input: without the `ask` skill most
  // models ask in plain words instead (6 of 20 used the tool, measured on codex-cli 0.166.0 across
  // its 8 models), and with it they use the tool (15 of 20) or the skill's block (3).
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
   * from the person's own Codex home, where their login is; on accounts, from the home a turn on
   * the account runs take first runs from, since Codex fetches the catalog for each login. The
   * catalog is Codex's word, not a guarantee: a listed model can still be refused when a turn runs.
   */
  async listModels(opts: { signal?: AbortSignal } = {}): Promise<DriverModel[]> {
    const env = this.opts.env ?? process.env
    const first = this.opts.accounts?.first(env)
    // The same home a turn on it runs from, so the two never undo each other's links.
    const setup = this.opts.personal?.skills !== false
    const base = setup ? personalCodexHome(env) : resolve(this.opts.codexHome ?? defaultCodexHome(env))
    const home = first?.login !== undefined ? await accountHome(accountFolder(first, env), base, setup) : undefined
    return this.askModels(home !== undefined ? { ...env, CODEX_HOME: home } : env, opts)
  }

  private askModels(env: NodeJS.ProcessEnv, opts: { signal?: AbortSignal }): Promise<DriverModel[]> {
    return new Promise<DriverModel[]>((resolvePromise, rejectPromise) => {
      const bin = this.opts.bin ?? 'codex'
      const spawn = this.opts.spawn ?? (nodeSpawn as unknown as SpawnLike)
      const child = spawn(bin, ['debug', 'models'], { cwd: process.cwd(), env })
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
      ? await accounts.turn(env, {
          current: this.current,
          text,
          opts,
          emit,
          stopped: () => this.startOpts.signal?.aborted === true || this.startOpts.stop?.aborted === true || opts.signal?.aborted === true,
          continueFrom: id => {
            this.lastSessionId = id
          },
          run: async (account, said, sent) => {
            const turnEnv = await accountEnv(account, env, this.config.personal?.skills !== false)
            const parser = this.parser(said, sent)
            return accountTurn(() => this.turnOn(said, sent, parser, turnEnv, emit), () => parser.accountReading())
          },
        })
      : await this.turnOn(text, opts, this.parser(text, opts), env, emit)
    if (turn.sessionId) this.lastSessionId = turn.sessionId
    return finishTurn(this, turn, opts, emit)
  }

  /**
   * A fresh prompt whose `codex app-server` starts now and opens its conversation before the words
   * are known: Codex's start-up and the conversation's are most of a small turn (measured: an
   * answer in two seconds where a fresh process takes four). On the account a turn would take
   * first; one at its limit fails the prompt rather than moving on.
   */
  ready(): ReadyPrompt {
    return readyPrompt(async (words, stop) => {
      const env = this.config.env ?? process.env
      const first = this.config.accounts?.first(env)
      const turnEnv = first === undefined ? env : await accountEnv(first, env, this.config.personal?.skills !== false)
      return this.turnOn('', { signal: stop }, this.parser(words, {}), turnEnv, makeEmit(this.startOpts.onEvent, 'codex'))
    })
  }

  /** The reader of one turn: on the session's conversation for a `resume` prompt, else a fresh one with the framing. Words still to come are sent once the conversation is open. */
  private parser(text: string | Promise<string>, opts: DriverPromptOptions): CodexAppServerParser {
    const resumeId = opts.resume ? this.lastSessionId : undefined
    // A resumed conversation already carries its framing; sending it again only repeats it.
    const framing = resumeId === undefined ? combineFraming(this.startOpts.system, opts.system) : ''
    return new CodexAppServerParser({
      text: typeof text === 'string' ? promptSent(text, opts) : text.then(words => promptSent(words, opts)),
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
        ...(this.startOpts.stop ? { stop: this.startOpts.stop } : {}),
        ...(opts.inbox !== undefined ? { inbox: opts.inbox, steered: line => steeredWords(line, opts) } : {}),
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
    // Codex's own tool for asking the person, request_user_input: off by default, under development
    // on codex-cli 0.166.0. On, the agent asks with it, and the turn stops on its question.
    else args.push('-c', `features.${ASK_FEATURE}=true`)
    if (this.config.extraArgs) args.push(...this.config.extraArgs)
    return args
  }
}

/** The feature that gives a Codex agent its request_user_input tool, by `codex features list`'s name. */
const ASK_FEATURE = 'default_mode_request_user_input'

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

/** How Codex refuses a conversation it has no record of (codex-cli 0.144.4). */
const CONVERSATION_GONE = /no rollout found for thread id/i

/** Whether a failed turn failed because the conversation it continues is not there. */
function isConversationGone(err: unknown): boolean {
  return CONVERSATION_GONE.test(err instanceof Error ? err.message : String(err))
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
