import { randomUUID } from 'node:crypto'
import { StreamJsonParser } from '@openagt/agent-driver-claude-code'
import { readZip } from './actions-zip.js'
import { combineFraming, makeEmit, promptSent, startEvent, finishTurn, attachLog } from '@openagt/agent-driver'
import type { SessionLog, DriverEvent, DriverPromptOptions, DriverSession, DriverStartOptions, DriverTurn } from '@openagt/hooks'

/**
 * A run's turns on **GitHub Actions** instead of on this machine (#610, #2394): each prompt is one
 * run of the project's workflow, dispatched, polled, and its transcript read back once it ends.
 *
 * The routines fire API was the obvious candidate and turned out unusable: the prompt arrives
 * wrapped as untrusted data, and there is no read-back of any kind. The official
 * `anthropics/claude-code-action@v1` has neither problem: the prompt is passed verbatim, and the
 * run publishes its full transcript. Auth is the same subscription posture as everywhere else
 * (#495): a `claude setup-token` OAuth token held by the repository, never an API key of ours.
 *
 * It keeps `DriverSession`'s shape, so the run's events and its log are a local run's. What
 * changes is the tempo, and those costs are real:
 *
 * - **Minutes, not seconds.** Every `prompt` is a fresh runner and a fresh checkout. Continuity
 *   comes from the branch the previous turn pushed, which the session dispatches onto next time.
 * - **No live stream.** The transcript arrives once, at the end, so the
 *   {@link DriverStartOptions.onEvent} feed replays in a burst rather than trickling.
 * - **Quota is the account's, not the runner's.** Free minutes on a public repo change nothing
 *   about the subscription window every run draws down.
 *
 * The workspace lives on a runner that is gone by the time we read it, so
 * {@link ActionsSession.readCode} reads from the pushed branch over the contents API rather than
 * from disk.
 */

/** Where a run's turns go, and how they are found again. */
export interface ActionsOptions {
  /** Repository owner (user or org) that runs the workflow. */
  owner: string
  /** Repository name. */
  repo: string
  /**
   * GitHub token used to dispatch and to read runs, artifacts, and file contents.
   * Needs `repo` + `workflow` scope. Must belong to a **user**, not an App: the
   * action's `checkHumanActor` rejects a bot-triggered agent run unless the bot is
   * in its `allowed_bots`.
   */
  token: string
  /**
   * Workflow file to dispatch, e.g. `"agent.yml"`. Its contract: inputs `prompt`, `correlation_id`,
   * `branch`, and optionally `model` and `resume_session_id`; the correlation id in the run's
   * display name; the work pushed to `branch`; one artifact named after the correlation id holding
   * `execution.json` (the CLI's transcript as a JSON array) and `meta.json` (`{ "branch": "…" }`).
   */
  workflow: string
  /** Git ref the first turn runs on. Later turns follow the branch the agent pushed. */
  ref?: string
  /** The branch the run's earlier turns pushed: this session's turns start on it and push to it. Absent, the first turn pushes to a new one. */
  branch?: string
  /** How often to poll the run, in ms. Default 5000. */
  pollIntervalMs?: number
  /** Give up on a run after this long, in ms. Default 1 hour (the job cap is 6). */
  timeoutMs?: number
  /** REST base. Default `"https://api.github.com"`. */
  apiBase?: string
  /** `fetch` override for tests. Default the global. */
  fetch?: FetchLike
  /** Clock override for tests. Default `Date.now`. */
  now?: () => number
  /** Sleep override for tests. Default a real timer. */
  sleep?: (ms: number) => Promise<void>
  /**
   * Unique tag mixed into the correlation id. Default a random token; injected in tests for
   * a stable id. Without it a fresh process restarts the session counter at 1, so every run's
   * first turn is `actions-1-turn-1` and runs collide (see {@link ActionsSession}).
   */
  runTag?: () => string
  /**
   * Prefix for the branch each run pushes its work to (#1085). Default `"claude/"`. The session
   * names the branch (prefix + session id) and passes it to the workflow, rather than discovering
   * it after the fact: the action leaves `branch_name` empty for a `workflow_dispatch` run, so
   * there is nothing to discover.
   */
  branchPrefix?: string
}

/** The slice of `fetch` this client uses. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

let sessionCounter = 0

/** A short random tag so correlation ids stay unique across processes. */
const randomRunTag = (): string => randomUUID().slice(0, 8)

/** One Actions-backed session. Each `prompt` is one workflow run. */
export class ActionsSession implements DriverSession {
  readonly id: string
  readonly cwd: string
  /** The branch the last run pushed; set once a run reports it, and the next turn builds on it. */
  private pushed: string | undefined
  /** The branch this session asks each run to push to. Stable across turns, so they chain. */
  private readonly runBranch: string
  /** The agent's own session id, carried across turns so `resume` can continue it. */
  private lastSessionId: string | undefined
  private turnCounter = 0
  readonly log?: SessionLog
  private readonly startOpts: DriverStartOptions

  constructor(
    private readonly config: ActionsOptions,
    startOpts: DriverStartOptions,
  ) {
    const attached = attachLog(startOpts)
    this.startOpts = attached.opts
    if (attached.log) this.log = attached.log
    this.cwd = startOpts.cwd
    // The counter reads well in logs within one process; the random tag is what keeps the
    // correlation id unique across processes, since each turn is a process of its own.
    this.id = `actions-${++sessionCounter}-${(config.runTag ?? randomRunTag)()}`
    this.pushed = config.branch
    this.runBranch = config.branch ?? `${config.branchPrefix ?? 'claude/'}${this.id}`
    this.lastSessionId = startOpts.resumeSessionId
  }

  /** The branch the run's work is on, once a turn pushed it. */
  get branch(): string | undefined {
    return this.pushed
  }

  async prompt(text: string, opts: DriverPromptOptions = {}): Promise<DriverTurn> {
    const emit = makeEmit(this.startOpts.onEvent, 'github-actions')
    // The action takes `prompt` as an action input, not through a shell, so a
    // multi-line prompt is safe. The framing rides in front of it (as with Codex):
    // `--append-system-prompt` would have to survive shell-quoting inside the
    // workflow, and a system prompt is not worth an injection seam.
    const framing = combineFraming(this.startOpts.system, opts.system)
    const framed = framing ? `${framing}\n\n${text}` : text
    const prompt = promptSent(framed, opts)
    emit(startEvent(framed, opts))

    // How we find our run: the dispatch API returns no run id, so the workflow echoes this
    // into its run-name and artifact name and we match on it. It must be unique per run (the
    // session's random tag) so a fresh process never latches onto a stale same-named run.
    const correlationId = `${this.id}-turn-${++this.turnCounter}`
    const resume = opts.resume ? this.lastSessionId : undefined

    await this.dispatch(prompt, correlationId, resume)
    emit({ type: 'notice', message: `Dispatched ${correlationId} to ${this.config.owner}/${this.config.repo}; waiting for the runner.` })

    const run = await this.awaitWorkflowRun(correlationId, emit, opts.signal)
    if (run === 'stopped') return { text: '', stopped: true }
    const artifact = await this.readRunArtifact(run.id, correlationId)
    if (artifact.branch) this.pushed = artifact.branch

    const turn = replayTranscript(artifact.execution, emit)
    if (turn.sessionId) this.lastSessionId = turn.sessionId
    emit({ type: 'result', text: turn.text, ...(turn.sessionId ? { sessionId: turn.sessionId } : {}), ...(turn.usage ? { usage: turn.usage } : {}) })
    return finishTurn(this, turn, opts, emit)
  }

  /**
   * Read a file the agent produced. The runner is gone, so this reads the branch the
   * run pushed rather than the local workspace — the seam is still the code, just
   * fetched over the contents API.
   */
  async readCode(path: string): Promise<string> {
    if (!this.pushed) throw new Error('No branch yet: readCode is only available after a run has pushed one.')
    const encoded = path.split('/').map(encodeURIComponent).join('/')
    const body = await this.api<{ content?: string; encoding?: string }>(`/repos/${this.owner}/contents/${encoded}?ref=${encodeURIComponent(this.pushed)}`)
    if (typeof body.content !== 'string') throw new Error(`${path} is not a file on ${this.pushed}`)
    return Buffer.from(body.content, body.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8')
  }

  dispose(): Promise<void> {
    // Every run reaps itself on the runner; there is nothing here to free.
    return Promise.resolve()
  }

  /** Fire the workflow. Returns nothing useful: dispatch is 204 with no body, hence the correlation id. */
  private async dispatch(prompt: string, correlationId: string, resume: string | undefined): Promise<void> {
    const inputs: Record<string, string> = { prompt, correlation_id: correlationId, branch: this.runBranch }
    // These reach a shell on the runner as environment variables. They are ids and
    // model names, so anything outside that alphabet is a bug or an attack.
    if (this.startOpts.model) inputs['model'] = assertToken(this.startOpts.model, 'model')
    if (resume) inputs['resume_session_id'] = assertToken(resume, 'resume session id')
    await this.api(`/repos/${this.owner}/actions/workflows/${encodeURIComponent(this.config.workflow)}/dispatches`, {
      method: 'POST',
      body: JSON.stringify({ ref: this.pushed ?? this.config.ref ?? 'main', inputs }),
    })
  }

  /**
   * Poll until our run appears and finishes. Identified by the correlation id in its `run-name`.
   * A Stop ({@link DriverStartOptions.stop}) cancels the run once it is found, and the turn is over.
   */
  private async awaitWorkflowRun(correlationId: string, emit: (event: DriverEvent) => void, promptSignal?: AbortSignal): Promise<WorkflowRun | 'stopped'> {
    const now = this.config.now ?? Date.now
    const sleep = this.config.sleep ?? (ms => new Promise<void>(r => setTimeout(r, ms)))
    const interval = this.config.pollIntervalMs ?? 5000
    const deadline = now() + (this.config.timeoutMs ?? 60 * 60 * 1000)
    let announced = false

    for (;;) {
      const found = await this.findWorkflowRun(correlationId)
      if (found) {
        if (!announced) {
          announced = true
          emit({ type: 'action', label: `run ${found.html_url}` })
        }
        if (found.status === 'completed') {
          if (found.conclusion !== 'success') throw new Error(`GitHub Actions run concluded "${found.conclusion}": ${found.html_url}`)
          return found
        }
      }
      if (this.startOpts.stop?.aborted) {
        // A run asked to stop before GitHub made it is found on the next look, and cancelled then.
        if (found) {
          await this.api(`/repos/${this.owner}/actions/runs/${found.id}/cancel`, { method: 'POST' }).catch(() => undefined)
          return 'stopped'
        }
      }
      if (now() >= deadline) throw new Error(`Timed out waiting for the GitHub Actions run (${correlationId}).`)
      this.throwIfAborted(promptSignal)
      await sleep(interval)
      this.throwIfAborted(promptSignal)
    }
  }

  /** Our run among the workflow's recent ones, or undefined while GitHub is still creating it. */
  private async findWorkflowRun(correlationId: string): Promise<WorkflowRun | undefined> {
    const body = await this.api<{ workflow_runs?: WorkflowRun[] }>(`/repos/${this.owner}/actions/runs?event=workflow_dispatch&per_page=50`)
    return (body.workflow_runs ?? []).find(run => typeof run.name === 'string' && run.name.includes(correlationId))
  }

  /** Download the run's artifact and pull the transcript and the pushed branch out of it. */
  private async readRunArtifact(runId: number, correlationId: string): Promise<{ execution: string; branch?: string }> {
    const list = await this.api<{ artifacts?: { id: number; name: string }[] }>(`/repos/${this.owner}/actions/runs/${runId}/artifacts`)
    const artifact = (list.artifacts ?? []).find(a => a.name.includes(correlationId)) ?? list.artifacts?.[0]
    if (!artifact) throw new Error(`Run ${runId} uploaded no artifact; the workflow must upload the transcript as one.`)

    const res = await this.request(`/repos/${this.owner}/actions/artifacts/${artifact.id}/zip`)
    const entries = readZip(Buffer.from(await res.arrayBuffer()))
    const execution = entries.find(e => e.name.endsWith('execution.json'))
    if (!execution) throw new Error(`Artifact ${artifact.name} has no execution.json (entries: ${entries.map(e => e.name).join(', ') || 'none'})`)

    const meta = entries.find(e => e.name.endsWith('meta.json'))
    const branch = meta ? readBranch(meta.data.toString('utf8')) : undefined
    return { execution: execution.data.toString('utf8'), ...(branch ? { branch } : {}) }
  }

  private get owner(): string {
    return `${this.config.owner}/${this.config.repo}`
  }

  /** The session-wide signal or the per-prompt one (`DriverPromptOptions.signal`) both stop the poll. */
  private throwIfAborted(promptSignal?: AbortSignal): void {
    if (this.startOpts.signal?.aborted || promptSignal?.aborted) throw new Error('Session aborted while waiting for the GitHub Actions run.')
  }

  /** A REST call that expects JSON back. */
  private async api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.request(path, init)
    if (res.status === 202 || res.status === 204) return undefined as T
    return (await res.json()) as T
  }

  /** A REST call, with auth and error handling. */
  private request(path: string, init: RequestInit = {}): Promise<Response> {
    return githubRequest(this.config, path, init)
  }
}

/** A REST call to GitHub as `config.token`, with error handling: a call that fails throws, saying the call and GitHub's answer. */
export async function githubRequest(config: Pick<ActionsOptions, 'token' | 'apiBase' | 'fetch'>, path: string, init: RequestInit = {}): Promise<Response> {
  const doFetch = config.fetch ?? (globalThis.fetch as FetchLike)
  const res = await doFetch(`${config.apiBase ?? 'https://api.github.com'}${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${config.token}`,
      'x-github-api-version': '2022-11-28',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  })
  if (!res.ok) throw new GitHubError(res.status, `GitHub API ${init.method ?? 'GET'} ${path} failed (${res.status} ${res.statusText}): ${await safeText(res)}`)
  return res
}

/** A call GitHub answered with an error: its status is how a caller tells "not there" (404) from the rest. */
export class GitHubError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

/** A workflow run, as much of it as we read. */
interface WorkflowRun {
  id: number
  name?: string
  status?: string
  conclusion?: string | null
  html_url?: string
}

/**
 * Turn the action's `execution_file` into a turn, replaying its events on the way.
 *
 * The adapter is thin on purpose: the file is a JSON **array** of exactly the
 * SDKMessage objects the CLI emits one-per-line, so the existing
 * {@link StreamJsonParser} reads it verbatim once the array is unwrapped. The whole
 * difference between running locally and running on a runner is array-vs-JSONL.
 *
 * Events replay in a burst at the end rather than live — that is the honest cost of
 * this host, and a caller sees the same event stream either way.
 */
export function replayTranscript(json: string, emit: (event: DriverEvent) => void = () => {}): DriverTurn {
  let messages: unknown
  try {
    messages = JSON.parse(json)
  } catch (err) {
    throw new Error(`Could not parse the run transcript as JSON: ${(err as Error).message}`)
  }
  if (!Array.isArray(messages)) throw new Error('The run transcript is not a JSON array of messages.')

  const parser = new StreamJsonParser()
  for (const message of messages) {
    for (const event of parser.push(JSON.stringify(message))) emit(event)
  }
  return parser.result()
}

/** The branch the run pushed, from the workflow's `meta.json`. Absent when the agent pushed nothing. */
function readBranch(json: string): string | undefined {
  try {
    const meta = JSON.parse(json) as Record<string, unknown>
    const branch = meta['branch']
    return typeof branch === 'string' && branch ? branch : undefined
  } catch {
    return undefined // A malformed meta file costs us `readCode`, not the turn.
  }
}

/** Reject anything that is not an opaque id, since these reach a shell on the runner. */
function assertToken(value: string, what: string): string {
  if (!/^[A-Za-z0-9._:-]+$/.test(value)) throw new Error(`Refusing to pass an unsafe ${what} to the workflow: ${value}`)
  return value
}

/** An error body, best-effort — a failure to read one must not replace the real error. */
async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500)
  } catch {
    return '<no body>'
  }
}
