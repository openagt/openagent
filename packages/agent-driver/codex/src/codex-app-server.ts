import { codexWindows } from './codex-accounts.js'
import { type AccountReading, type AgentCliParser, type CliIo, type Question, toolQuestion, callArgument, cutOutput, hunkLines, lineCount, oneLine, patchSize, type DriverEvent, type DriverRateWindow, type DriverTurn, type DriverUsage, type FileChange } from '@openagt/agent-driver'

// One turn of Codex's app server (`codex app-server`, JSON-RPC over stdio), talked to and read: the
// requests that open the conversation and start the turn, and what Codex sends back, turned into
// the driver's events and the turn they add up to. The process it runs in, and which conversation a
// turn continues, are the session's (`codex.ts`).

/**
 * Codex's sandbox policy for the shell commands the model writes.
 * `workspace-write` is our default: the agent can edit the workspace it was
 * pointed at, but not the rest of the machine. It is the counterpart of Claude
 * Code's `acceptEdits`, and the reason we never pass Codex's
 * `--dangerously-bypass-approvals-and-sandbox`.
 */
export type CodexSandbox = 'read-only' | 'workspace-write' | 'danger-full-access'

/**
 * What a Codex tool item was given, as it was given: the command without the shell wrapper Codex
 * puts around it, the files a change touches, the MCP tool, or the web search.
 */
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
  /** The prompt; one still to come is sent once the conversation is open ({@link CodexSession.ready}). */
  text: string | Promise<string>
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
  private windows: DriverRateWindow[] | undefined
  /** Whether the account's usage limit is what ended the turn. */
  private stoppedByLimit = false
  /** The question the agent asked with request_user_input, which the turn was stopped on. */
  private asked: Question | undefined
  /** The person asked for the turn to end ({@link stop}): an interrupted end is that stop. */
  private stopping = false
  /** The turn ended interrupted, on the person's Stop. */
  private interrupted = false

  constructor(private readonly turn: CodexTurnRequest) {}

  /**
   * Hand the agent a message while its turn runs (`turn/steer`): Codex adds it to the turn under
   * way, and the agent reads it at its next step. Taken, it has landed; refused (the turn ended
   * meanwhile), it waits for the turn's end with the rest.
   */
  steer(message: { id: string; text: string; words: string }): boolean {
    if (this.ended || this.stopping || this.sessionId === undefined || this.turnId === undefined) return false
    this.request(
      'turn/steer',
      { threadId: this.sessionId, expectedTurnId: this.turnId, input: [{ type: 'text', text: message.words, text_elements: [] }] },
      () => [{ type: 'steered', text: message.text, id: message.id }],
      () => [],
    )
    return true
  }

  /** The person's Stop (`turn/interrupt`): the turn ends where it is, and is over. */
  stop(): boolean {
    if (this.ended || this.sessionId === undefined || this.turnId === undefined) return false
    this.stopping = true
    this.request('turn/interrupt', { threadId: this.sessionId, turnId: this.turnId }, () => [])
    return true
  }

  /** The conversation the turn continues, when it continues one. */
  get resumeId(): string | undefined {
    return this.turn.resumeId
  }

  /**
   * What the turn said of the account it ran on, once it is over. Its limit frees at the latest
   * reset of a window it filled: none when no window said it is full. The conversation is there as
   * soon as Codex said it: what a next account continues.
   */
  accountReading(): AccountReading {
    const full = (this.windows ?? []).filter(w => w.percentUsed >= 100).map(w => w.resetsAt)
    return {
      limited: this.stoppedByLimit,
      ...(full.length > 0 ? { resetsAt: Math.max(...full) } : {}),
      ...(this.windows ? { windows: this.windows } : {}),
      ...(this.sessionId !== undefined ? { sessionId: this.sessionId } : {}),
    }
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
    // A request of the server's own. The agent's question is shown to the person, who answers it
    // in the chat, and the turn is stopped on it, as Claude Code's is; an approval, or a question
    // no card can ask, is refused: nobody is there to answer it.
    if (id !== undefined) {
      const question = method === ASK_REQUEST && this.asked === undefined ? codexQuestion(msg['params']) : undefined
      if (question === undefined) {
        this.send({ id, error: { code: -32601, message: 'agent-driver answers no requests' } })
        return []
      }
      this.asked = question
      const turnId = field(msg['params'], 'turnId')
      this.request('turn/interrupt', { threadId: this.sessionId, turnId: typeof turnId === 'string' ? turnId : this.turnId }, () => [])
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
      ...(this.asked ? { question: this.asked } : {}),
      ...(this.interrupted && this.asked === undefined ? { stopped: true as const } : {}),
    }
  }

  private onThread(result: Record<string, unknown>): DriverEvent[] {
    const threadId = field(result['thread'], 'id')
    if (typeof threadId !== 'string') return this.end('Codex started no conversation')
    // Announced at once: a turn that is stopped or fails before its result must not take the id,
    // the handle a later resume needs, with it.
    this.sessionId = threadId
    const start = (text: string) => this.request('turn/start', { threadId, input: [{ type: 'text', text, text_elements: [] }] }, started => this.onTurn(started['turn']))
    if (typeof this.turn.text === 'string') start(this.turn.text)
    else void this.turn.text.then(start)
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
        // Stopped on the agent's question: asked, and over.
        if (status === 'completed' || (status === 'interrupted' && this.asked !== undefined)) return this.end()
        // Stopped by the person: over too.
        if (status === 'interrupted' && this.stopping) {
          this.interrupted = true
          return this.end()
        }
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
    const refused = this.refused.get(id)
    this.refused.delete(id)
    const error = msg['error']
    if (typeof error === 'object' && error !== null && refused) return refused()
    if (typeof error === 'object' && error !== null) {
      const message = field(error, 'message')
      return this.end(typeof message === 'string' && message.trim() !== '' ? codexErrorMessage(message.trim()) : 'Codex refused the request')
    }
    const result = msg['result']
    return then(typeof result === 'object' && result !== null ? (result as Record<string, unknown>) : {})
  }

  /** A request whose refusal is not the turn's failure: what happens then instead. */
  private readonly refused = new Map<number, () => DriverEvent[]>()

  private request(method: string, params: Record<string, unknown>, then: (result: Record<string, unknown>) => DriverEvent[], refused?: () => DriverEvent[]): void {
    const id = ++this.nextId
    this.pending.set(id, then)
    if (refused) this.refused.set(id, refused)
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

/** The server request request_user_input arrives as. */
const ASK_REQUEST = 'item/tool/requestUserInput'

/**
 * The question a request_user_input request asks, from its params: `{questions: [{id, header,
 * question, isOther, isSecret, options: [{label, description}]}]}`. The first one, as with Claude
 * Code's; one that asks for a secret is no card's to ask, and is refused.
 */
export function codexQuestion(params: unknown): Question | undefined {
  const questions = field(params, 'questions')
  const first: unknown = Array.isArray(questions) ? questions[0] : undefined
  return field(first, 'isSecret') === true ? undefined : toolQuestion(first)
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
