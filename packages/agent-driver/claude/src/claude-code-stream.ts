import { randomUUID } from 'node:crypto'
import { type AccountReading, type CliIo, type Question, toolQuestion, cutOutput, callArgument, lineCount, patchSize, oneLine, type DriverEvent, type FileChange, type DriverRateLimit, type DriverRateWindow, type DriverTurn, type DriverUsage } from '@openagt/agent-driver'

// What Claude Code says on its `stream-json` output, read: one JSON object per line, turned into the
// driver's events and the turn they add up to. The process it comes from, and what is written to
// its stdin, are the session's (`claude-code.ts`).

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

/** The report in what an `Agent` call that ran in the foreground gave back: the CLI frames it and indents every line. */
function handBack(result: string): string | undefined {
  const report = /^\[Subagent hand-back\][^\n]*The report follows:\n([\s\S]*?)(?:\nagentId: |$)/.exec(result)?.[1]
  return report?.replace(/^ {2}/gm, '')
}

/**
 * The subagent a stream line is from, by its `Agent` call's id: the CLI writes it on every line a
 * subagent's own conversation makes (`parent_tool_use_id`), and nothing on the agent's own.
 */
function withinSubagent(obj: Record<string, unknown>): string | undefined {
  const parent = obj['parent_tool_use_id']
  return typeof parent === 'string' && parent !== '' ? parent : undefined
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
  /** The tokens of each model call of the turn, by its message's id. */
  private readonly callTokens = new Map<string, number>()
  /** The subagents whose own messages were seen: what they said is their report. */
  private readonly saidBy = new Set<string>()
  /** The agent's message is the CLI's own "You've hit your limit" (`error: "rate_limit"`): the account's limit stopped the turn. */
  private stoppedByLimit = false
  /** A rate-limit line said `rejected`: a turn that failed after it failed on the account's limit. When it frees, where said. */
  private rejected: { resetsAt?: number } | undefined
  /** The account's windows as this turn's last rate-limit line said them. */
  private windows: DriverRateWindow[] | undefined
  /** The turn is over and answered: its `result` said so, or the turn was stopped on the agent's question. */
  answered = false
  /** The CLI's stdin, while the turn is talked to: where its permission requests are answered. */
  private io: CliIo | undefined
  /** The question the agent asked with AskUserQuestion, which the turn was stopped on. */
  private asked: Question | undefined
  /** The ids of the agent's AskUserQuestion calls: the question is the card, not a step. */
  private readonly askCalls = new Set<string>()
  /** The person asked for the turn to end ({@link stop}): an end that is not a success is that stop. */
  private stopping = false
  /** The turn's `result` said it succeeded. */
  private succeeded = false
  /** The messages handed over while the turn runs and not read yet, by the uuid each went with. */
  private readonly steering = new Map<string, { id: string; text: string }>()
  /** The tasks the agent waits on now, by their id: what Send now puts in the background. */
  private readonly foreground = new Set<string>()
  /** Send now came before any call the agent waits on: the next one goes in the background. */
  private hurrying = false
  /** How many tasks the CLI runs in the background now, as its last `background_tasks_changed` said. */
  private background = 0

  /** Answer the CLI's requests on `io` from now on, and close it when the turn is over. */
  talk(io: CliIo): void {
    this.io = io
  }

  /**
   * Hand the agent a message while its turn runs: Claude Code queues it and reads it at its next
   * step, then says so by repeating it (`--replay-user-messages`) under the uuid it was sent with.
   */
  steer(message: { id: string; text: string; words: string }): boolean {
    if (!this.io || this.answered || this.stopping) return false
    const uuid = randomUUID()
    this.steering.set(uuid, { id: message.id, text: message.text })
    this.io.write(JSON.stringify({ type: 'user', message: { role: 'user', content: message.words }, parent_tool_use_id: null, uuid }))
    return true
  }

  /** Take back a message the agent has not read: Claude Code drops it from its queue. */
  withdraw(id: string): void {
    for (const [uuid, message] of this.steering) {
      if (message.id !== id) continue
      this.steering.delete(uuid)
      this.control(`withdraw-${uuid}`, { subtype: 'cancel_async_message', message_uuid: uuid })
    }
  }

  /**
   * Send now: what the agent waits on goes on in the background, as Ctrl+B does in Claude Code, so
   * its call answers at once and the agent reads the messages waiting. Asked before any call has
   * begun, the request would do nothing: the next call to begin goes in the background instead.
   */
  hurry(): void {
    if (this.steering.size === 0) return
    if (this.foreground.size > 0) this.control(`hurry-${randomUUID()}`, { subtype: 'background_tasks' })
    else this.hurrying = true
  }

  /** The person's Stop, as Esc in Claude Code: the turn is interrupted where it is, and is over. */
  stop(): boolean {
    if (!this.io || this.answered) return false
    this.stopping = true
    this.control(`stop-${randomUUID()}`, { subtype: 'interrupt' })
    return true
  }

  private foregroundTask(subtype: unknown, task: string, obj: Record<string, unknown>): void {
    const patch = typeof obj['patch'] === 'object' && obj['patch'] !== null ? (obj['patch'] as Record<string, unknown>) : {}
    if (subtype === 'task_started' && obj['is_backgrounded'] !== true) {
      this.foreground.add(task)
      if (!this.hurrying || this.steering.size === 0) return
      this.hurrying = false
      this.control(`hurry-${randomUUID()}`, { subtype: 'background_tasks' })
    } else if (subtype === 'task_notification' || (subtype === 'task_updated' && (patch['is_backgrounded'] === true || patch['status'] !== undefined))) {
      this.foreground.delete(task)
    }
  }

  private control(id: string, request: Record<string, unknown>): void {
    this.io?.write(JSON.stringify({ type: 'control_request', request_id: id, request }))
  }

  /** What the turn said of the account it ran on, once it is over: `failed` when it failed. */
  accountReading(failed: boolean): AccountReading {
    return {
      limited: this.stoppedByLimit || (failed && this.rejected !== undefined),
      ...(this.rejected?.resetsAt !== undefined ? { resetsAt: this.rejected.resetsAt } : {}),
      ...(this.windows ? { windows: this.windows } : {}),
      ...(this.sessionId !== undefined ? { sessionId: this.sessionId } : {}),
    }
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
    // The calls the agent waits on, for Send now, by their task: one begins in the foreground, and
    // is over when its task is or when it goes on in the background.
    if (type === 'system' && typeof obj['task_id'] === 'string') this.foregroundTask(obj['subtype'], obj['task_id'], obj)
    if (type === 'system' && obj['subtype'] === 'task_started' && obj['is_backgrounded'] === true && typeof obj['tool_use_id'] === 'string') {
      this.backgrounded.add(obj['tool_use_id'])
      return announced
    }
    if (type === 'system' && obj['subtype'] === 'task_progress' && typeof obj['tool_use_id'] === 'string') {
      return [...announced, ...this.subagentUsage(obj['tool_use_id'], obj['usage'])]
    }
    if (type === 'system' && obj['subtype'] === 'task_notification' && typeof obj['tool_use_id'] === 'string') {
      const report = obj['handback_report']
      this.subagentUsage(obj['tool_use_id'], obj['usage'])
      return [...announced, ...this.reported(obj['tool_use_id'], typeof report === 'object' && report !== null ? (report as Record<string, unknown>)['text'] : undefined), ...this.endSubagent(obj['tool_use_id'], obj['status'] !== 'completed')]
    }

    if (type === 'control_request') return [...announced, ...this.handleRequest(obj)]

    if (type === 'assistant' && obj['error'] === 'rate_limit') {
      this.stoppedByLimit = true
      this.rejected = { ...this.rejected, ...limitFrees(obj) }
    }
    if (type === 'assistant') return [...announced, ...this.handleAssistant(obj)]
    // A user line the CLI repeats is one it read: a message handed over while the turn ran landed
    // here. The CLI repeats its own lines too (the prompt, a background task's note): not the person's.
    if (type === 'user' && obj['isReplay'] === true) {
      const uuid = obj['uuid']
      const landed = typeof uuid === 'string' ? this.steering.get(uuid) : undefined
      if (landed === undefined) return announced
      this.steering.delete(uuid as string)
      return [...announced, { type: 'steered', text: landed.text, id: landed.id }]
    }
    if (type === 'user') return [...announced, ...this.handleResults(obj)]
    // A subagent's message being written is not the agent's: only its whole message is shown, as the subagent's.
    if (type === 'stream_event') return withinSubagent(obj) !== undefined ? announced : [...announced, ...this.handlePiece(obj['event'])]
    if (type === 'rate_limit_event') {
      const limit = parseRateLimit(obj)
      if (limit?.windows) this.windows = limit.windows
      if (limit?.status === 'rejected') this.rejected = { resetsAt: limit.resetsAt }
      return limit ? [...announced, { type: 'rate-limit', limit }] : announced
    }
    // The work the CLI runs in the background, as a level: every change says the whole set.
    if (type === 'system' && obj['subtype'] === 'background_tasks_changed' && Array.isArray(obj['tasks'])) this.background = obj['tasks'].length
    if (type === 'result') {
      this.succeeded = obj['subtype'] === 'success' && obj['is_error'] !== true
      const result = obj['result']
      if (typeof result === 'string') this.finalText = result
      const usage = parseUsage(obj)
      if (usage) this.usage = { ...usage, ...(this.context !== undefined ? { contextTokens: this.context } : {}) }
      // The agent waits on work it runs in the background: the CLI says a result each time the
      // agent is idle, and the work's end wakes it for another. The turn goes on, and a message
      // sent meanwhile still reaches it.
      if (this.background > 0 && this.asked === undefined && !this.stopping) return announced
      // The turn's last line: nothing more is coming to answer, so the CLI may exit.
      this.io?.end()
      this.answered = this.asked !== undefined || this.stopping || this.succeeded
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
      const block = e['content_block']
      return typeof block === 'object' && block !== null && (block as Record<string, unknown>)['type'] === 'thinking' ? [{ type: 'thinking' }] : []
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
    events.push(...this.turnTokens(message as Record<string, unknown>))
    const content = (message as Record<string, unknown>)['content']
    if (!Array.isArray(content)) return events
    for (const item of content) {
      if (typeof item !== 'object' || item === null) continue
      const block = item as Record<string, unknown>
      if (block['type'] === 'text' && typeof block['text'] === 'string') {
        if (within === undefined) this.assistantText += block['text']
        else this.saidBy.add(within)
        events.push({ type: 'text', text: block['text'], ...tag })
      } else if (block['type'] === 'tool_use' && block['name'] === ASK_TOOL && within === undefined) {
        if (typeof block['id'] === 'string') this.askCalls.add(block['id'])
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

  /** What a subagent handed back when it ended, as its own text, when it said nothing that is its text: a handback is no message of its. */
  private reported(id: string, text: unknown): DriverEvent[] {
    if (typeof text !== 'string' || text.trim() === '' || this.saidBy.has(id)) return []
    return [{ type: 'text', text: text.trim(), subagent: id }]
  }

  /** How many tokens the turn has gone through, once more with this message: each model call counted once, its blocks come as lines of their own. */
  private turnTokens(message: Record<string, unknown>): DriverEvent[] {
    const tokens = contextOf(message['usage'])
    const id = message['id']
    if (tokens === undefined || typeof id !== 'string' || this.callTokens.get(id) === tokens) return []
    this.callTokens.set(id, tokens)
    return [{ type: 'tokens', tokens: [...this.callTokens.values()].reduce((all, one) => all + one, 0) }]
  }

  /** What a task's line says of how far its subagent got, on its row. */
  private subagentUsage(id: string, raw: unknown): DriverEvent[] {
    const subagent = this.subagents.get(id)
    if (subagent === undefined || typeof raw !== 'object' || raw === null) return []
    const usage = raw as Record<string, unknown>
    const named = {
      ...subagent,
      ...(typeof usage['total_tokens'] === 'number' ? { tokens: usage['total_tokens'] } : {}),
      ...(typeof usage['tool_uses'] === 'number' ? { toolUses: usage['tool_uses'] } : {}),
    }
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
      if (this.askCalls.has(block['tool_use_id'])) continue
      const text = cutOutput(resultText(block['content']))
      const failed = block['is_error'] === true
      if (text !== '' || failed || change) {
        events.push({ type: 'output', id: block['tool_use_id'], text, ...(failed ? { failed: true as const } : {}), ...(change && !failed ? { changed: [change] } : {}), ...(within !== undefined ? { subagent: within } : {}) })
      }
      // A subagent's call: its row is over, unless the CLI runs it in the background, when the call
      // answers that it began and the row ends with its task. One that failed to begin is over.
      // A report in the call's answer, which may come after its task said it was over.
      events.push(...this.reported(block['tool_use_id'], handBack(resultText(block['content']))))
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
      ...(this.asked ? { question: this.asked } : {}),
      ...(this.stopping && !this.succeeded && this.asked === undefined ? { stopped: true as const } : {}),
    }
  }

  /**
   * What the CLI asks before a tool call runs (`can_use_tool`), answered on stdin. The agent's
   * question is shown to the person, who answers it in the chat, and the turn is stopped on it
   * as Esc stops Claude Code's: a denied question is asked once more in plain words, a stopped
   * one is not. A run in this mode has no other call to ask about; one that comes is refused,
   * as `claude -p` refuses what nobody can approve.
   */
  private handleRequest(obj: Record<string, unknown>): DriverEvent[] {
    const request = obj['request']
    const id = obj['request_id']
    if (typeof request !== 'object' || request === null || typeof id !== 'string') return []
    const asks = request as Record<string, unknown>
    // A request this version does not know is answered still, as failed: unanswered, the CLI would wait for it for ever.
    if (asks['subtype'] !== 'can_use_tool') {
      this.io?.write(JSON.stringify({ type: 'control_response', response: { subtype: 'error', request_id: id, error: `OpenAgent does not answer ${String(asks['subtype'])} requests` } }))
      return []
    }
    const tool = typeof asks['tool_name'] === 'string' ? asks['tool_name'] : 'the tool'
    if (tool === ASK_TOOL) {
      if (this.asked !== undefined) return []
      const question = askedQuestion(asks['input'])
      if (question !== undefined) {
        this.asked = question
        this.io?.write(JSON.stringify({ type: 'control_request', request_id: `stop-${id}`, request: { subtype: 'interrupt' } }))
        return []
      }
      this.deny(id, 'This question could not be shown. Ask it in your reply instead.')
      return [{ type: 'notice', message: `Claude Code asked a question in a shape this version of OpenAgent cannot read, so the agent was told to ask it in words.` }]
    }
    this.deny(id, `${tool} needs a person's approval, and nobody here can give it.`)
    return []
  }

  private deny(id: string, message: string): void {
    this.io?.write(JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: id, response: { behavior: 'deny', message } } }))
  }
}

/** Claude Code's own tool for asking the person, given to an agent whose CLI is asked over stdin. */
const ASK_TOOL = 'AskUserQuestion'

/**
 * The question an AskUserQuestion call asks, from its input: `{questions: [{question, header,
 * options: [{label, description}], multiSelect}]}`. The call may ask up to four at once; the card
 * shows one, the first, and the agent asks the rest after its answer.
 */
export function askedQuestion(input: unknown): Question | undefined {
  const questions = typeof input === 'object' && input !== null ? (input as Record<string, unknown>)['questions'] : undefined
  return Array.isArray(questions) ? toolQuestion(questions[0]) : undefined
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
