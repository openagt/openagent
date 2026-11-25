/**
 * How a coding agent's tool calls read in the chat (`RunAgent.calls`, #2394): a verb, then what it
 * was done to ("Read AGENTS.md", "Ran pnpm test"). Each agent names its calls its own way — one by
 * its tool's name, another by the kind of the item it reports — so each says, as data, how its own
 * read; the chat names none of them and reads the words of the run's own agent.
 */

/**
 * What a call did, for counting a run of calls: a search of the code (`search`), of the file names
 * (`find`) or of the web (`web`) is each its own.
 */
export type CallKind = 'command' | 'read' | 'edit' | 'search' | 'find' | 'web' | 'skill' | 'other'

/** How one tool's calls read. */
export interface CallWords {
  /** The grey word: what was done ("Ran", "Read"). */
  verb: string
  /** The same word while the call is still going on ("Running", "Reading"). */
  doing: string
  kind: CallKind
  /**
   * What the call's `detail` is, when the chat says it other than as it was given: `path` a file's
   * path, or several joined by `, `, each said by its name and the one opening the file; `query`
   * what was looked for, said in the grey of the verb; `slash` a command's name, said after a
   * slash (`/github`); `task` the task the agent wrote for a subagent the call starts, said as
   * going on while it starts.
   */
  detail?: 'path' | 'query' | 'slash' | 'task'
}

/**
 * How a family of a tool's names reads, such as the tools of an MCP server (`mcp__github__get_me`):
 * `pattern` is a regular expression's source a label matches whole, and `verb`, `doing` and `target`
 * may name its groups (`$1`). `target` is what the call was done to, said as words: its underscores
 * as spaces, its first letter a capital ("Get me"). A call's `detail`, when it has one, is said
 * instead.
 */
export interface CallFamily {
  pattern: string
  verb: string
  doing: string
  target?: string
  kind: CallKind
}

/** How every call of a coding agent reads: its tools by the label its `action` events give them, then its families of names. */
export interface AgentCalls {
  tools: Readonly<Record<string, CallWords>>
  families?: readonly CallFamily[]
}

/** One call as the chat says it. */
export interface SaidCall {
  /** The grey word: what was done. */
  verb: string
  /** The same word while the call is still going on: "Running", "Reading". */
  doing: string
  /** The dark words: what it was done to. A file reads as its name alone. */
  target?: string
  /** What was looked for is said in the grey of the verb. */
  plain?: true
  /** The detail is the task the call hands a subagent it starts. */
  task?: true
  /** The detail as the agent gave it: the whole path, the command. */
  detail?: string
  /** The one file a file's tool was given, as the agent gave it: what its name opens. */
  path?: string
  kind: CallKind
}

/** `imageView` reads "Image view"; a name that is already words is left as it is. */
function asWords(label: string): string {
  if (!/^[a-z]+([A-Z][a-z]*)+$/.test(label)) return label
  const words = label.replace(/[A-Z]/g, c => ` ${c.toLowerCase()}`)
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** A path's last part; several paths (a change can name every file it made) each cut the same way. */
function fileNames(detail: string): string {
  return detail
    .split(', ')
    .map(path => path.replace(/\/+$/, '').split('/').pop() || path)
    .join(', ')
}

/** A name's words: its underscores as spaces, its first letter a capital. */
function nameWords(name: string): string {
  const words = name.replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** The words of a call of a family its label is of: its groups put where its words name them. */
function familyCall(families: readonly CallFamily[], label: string): SaidCall | undefined {
  for (const family of families) {
    const match = new RegExp(`^(?:${family.pattern})$`).exec(label)
    if (!match) continue
    const fill = (words: string) => words.replace(/\$(\d)/g, (_, n: string) => match[Number(n)] ?? '')
    return { verb: fill(family.verb), doing: fill(family.doing), kind: family.kind, ...(family.target !== undefined ? { target: nameWords(fill(family.target)) } : {}) }
  }
  return undefined
}

/**
 * One call as the chat says it, by the words of its coding agent (`calls`): its tool's, else its
 * family's. A label they do not word is its own verb, a name of joined words said as words
 * ("Image view").
 */
export function saidCall(calls: AgentCalls | undefined, label: string, detail?: string): SaidCall {
  const known = calls !== undefined && Object.prototype.hasOwnProperty.call(calls.tools, label) ? calls.tools[label] : undefined
  const call: SaidCall = known ? { verb: known.verb, doing: known.doing, kind: known.kind } : (familyCall(calls?.families ?? [], label) ?? { verb: asWords(label), doing: asWords(label), kind: 'other' })
  if (known?.detail === 'query') call.plain = true
  if (known?.detail === 'task') call.task = true
  if (detail !== undefined) {
    call.detail = detail
    call.target = known?.detail === 'path' ? fileNames(detail) : known?.detail === 'slash' ? `/${detail.replace(/^\//, '')}` : detail
    if (known?.detail === 'path' && !detail.includes(', ')) call.path = detail
  }
  return call
}
