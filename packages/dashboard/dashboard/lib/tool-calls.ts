// How a tool call of the coding agent reads in the chat: a verb, then what it was done to
// ("Read AGENTS.md", "Ran pnpm test"), and how a run of calls sums up ("Ran 2 commands, edited
// README.md, used a tool"). Both drivers say a call as a label and a detail: Claude Code's label is the tool's name
// (Bash, Read, Edit), Codex's is the kind of the item (commandExecution, fileChange), so each has
// its own lines in the one map.

import { sumEdits, type ChangedFile, type FileEdit } from './turn-changes.js'

/**
 * What a call did, for counting a run of calls: a search of the code (`search`), of the file names
 * (`find`) or of the web (`web`) is each its own.
 */
type CallKind = 'command' | 'read' | 'edit' | 'search' | 'find' | 'web' | 'skill' | 'other'

export interface ToolCall {
  /** The grey word: what was done. */
  verb: string
  /** The same word while the call is still going on: "Running", "Reading". */
  doing: string
  /** The dark words: what it was done to. A file reads as its name alone. */
  target?: string
  /** What was looked for is said in the grey of the verb, as Claude Code on the web says a search. */
  plain?: true
  /** The detail as the driver gave it: the whole path, the command. */
  detail?: string
  kind: CallKind
  /** The files the call changed, when its coding agent said them: each once, its lines summed. */
  files?: ChangedFile[]
  /** The lines the call added and removed over all its files. */
  size?: LineCount
}

/** Lines added and removed. */
export interface LineCount {
  added: number
  removed: number
}

function sizeOf(files: readonly ChangedFile[]): LineCount {
  return { added: files.reduce((n, file) => n + file.added, 0), removed: files.reduce((n, file) => n + file.removed, 0) }
}

const CALLS: Record<string, { verb: string; doing: string; kind: CallKind; file?: true; plain?: true; slash?: true }> = {
  // Claude Code: the tool's name.
  Bash: { verb: 'Ran', doing: 'Running', kind: 'command' },
  Read: { verb: 'Read', doing: 'Reading', kind: 'read', file: true },
  Edit: { verb: 'Edited', doing: 'Editing', kind: 'edit', file: true },
  MultiEdit: { verb: 'Edited', doing: 'Editing', kind: 'edit', file: true },
  NotebookEdit: { verb: 'Edited', doing: 'Editing', kind: 'edit', file: true },
  Write: { verb: 'Wrote', doing: 'Writing', kind: 'edit', file: true },
  Grep: { verb: 'Searched', doing: 'Searching', kind: 'search', plain: true },
  Glob: { verb: 'Searched', doing: 'Searching', kind: 'find', plain: true },
  WebSearch: { verb: 'Searched the web', doing: 'Searching the web', kind: 'web', plain: true },
  WebFetch: { verb: 'Fetched', doing: 'Fetching', kind: 'other' },
  // "Ran skill /github", as Claude Code on the web says it.
  Skill: { verb: 'Ran skill', doing: 'Running skill', kind: 'skill', slash: true },
  Task: { verb: 'Started agent', doing: 'Starting agent', kind: 'other' },
  Agent: { verb: 'Started agent', doing: 'Starting agent', kind: 'other' },
  TodoWrite: { verb: 'Updated todos', doing: 'Updating todos', kind: 'other' },
  ToolSearch: { verb: 'Loaded tools', doing: 'Loading tools', kind: 'other' },
  // Codex: the kind of the item.
  commandExecution: { verb: 'Ran', doing: 'Running', kind: 'command' },
  fileChange: { verb: 'Edited', doing: 'Editing', kind: 'edit', file: true },
  mcpToolCall: { verb: 'Called', doing: 'Calling', kind: 'other' },
  webSearch: { verb: 'Searched the web', doing: 'Searching the web', kind: 'web', plain: true },
}

/** `imageView` reads "Image view"; a name that is already words is left as it is. */
function asWords(label: string): string {
  if (!/^[a-z]+([A-Z][a-z]*)+$/.test(label)) return label
  const words = label.replace(/[A-Z]/g, c => ` ${c.toLowerCase()}`)
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** A path's last part; several paths (Codex names every file of one change) each cut the same way. */
function fileNames(detail: string): string {
  return detail
    .split(', ')
    .map(path => path.replace(/\/+$/, '').split('/').pop() || path)
    .join(', ')
}

/**
 * A tool of an MCP server, as Claude Code names it (`mcp__github__get_me`): "Used github: Get me",
 * as Claude Code on the web says a call to its connectors.
 */
function mcpCall(label: string): { verb: string; doing: string; tool: string } | undefined {
  const match = /^mcp__(.+?)__(.+)$/.exec(label)
  if (!match) return undefined
  const tool = match[2]!.replace(/_/g, ' ')
  return { verb: `Used ${match[1]}:`, doing: `Using ${match[1]}:`, tool: tool.charAt(0).toUpperCase() + tool.slice(1) }
}

/**
 * One call as the chat says it. A label the map does not know is its own verb; an MCP server's
 * tool is "Used <server>:" and the tool. A call whose coding agent said the files it changed
 * (`changed`) names them and their size: "Created" when it made every one of them, "Updated"
 * otherwise, as Claude Code on the web says them, whatever the tool was called.
 */
export function toolCall(label: string, detail?: string, changed?: readonly FileEdit[]): ToolCall {
  const known = CALLS[label]
  const mcp = mcpCall(label)
  const call: ToolCall = { verb: known?.verb ?? mcp?.verb ?? asWords(label), doing: known?.doing ?? mcp?.doing ?? asWords(label), kind: known?.kind ?? 'other' }
  if (mcp) call.target = mcp.tool
  if (known?.plain) call.plain = true
  if (detail !== undefined) {
    call.detail = detail
    call.target = known?.file ? fileNames(detail) : known?.slash ? `/${detail.replace(/^\//, '')}` : detail
  }
  if (changed !== undefined && changed.length > 0) {
    const files = sumEdits(changed)
    call.kind = 'edit'
    call.verb = files.every(file => file.created) ? 'Created' : 'Updated'
    call.target = files.map(file => file.name).join(', ')
    call.files = files
    call.size = sizeOf(files)
  }
  return call
}

/** A run of calls in one line: its parts, and how much its edits changed. */
export interface CallsSummary {
  /** "Ran 2 commands", "edited README.md", "used a tool": grey words, the file in brighter ones. */
  parts: SummaryPart[]
  /** The lines the edits added and removed, when their coding agent said them. */
  size?: LineCount
}

export interface SummaryPart {
  /** The grey words: "Ran 2 commands", "created a file", "edited". */
  words: string
  /** The one file the edits changed, said by its name. */
  target?: string
}

const count = (n: number, one: string, many: string): string => (n === 1 ? one : `${n} ${many}`)

/**
 * A run of calls in one line, as Claude Code on the web says it: the commands it ran, the files it
 * read, that it searched the code or found files, the files it created and edited, and the tools it
 * used, with how much the edits changed — "Ran 3 commands, searched code, used a tool", "Read 2
 * files, searched code, found files", "Ran 3 commands, created a file, edited a file, used 2 tools
 * +69 −43". One file changed is said by its name ("edited README.md"). A skill, an MCP server's
 * tool and any other step are tools.
 */
export function callsSummary(calls: readonly ToolCall[]): CallsSummary {
  const of = (kind: CallKind) => calls.filter(call => call.kind === kind)
  const edits = of('edit')
  // A file read twice is one file read.
  const read = new Set(of('read').map((call, at) => call.detail ?? at)).size
  const parts: SummaryPart[] = []
  const summary: CallsSummary = { parts }
  const commands = of('command').length
  if (commands > 0) parts.push({ words: `ran ${count(commands, 'a command', 'commands')}` })
  if (read > 0) parts.push({ words: `read ${count(read, 'a file', 'files')}` })
  if (of('search').length > 0) parts.push({ words: 'searched code' })
  if (of('find').length > 0) parts.push({ words: 'found files' })
  if (of('web').length > 0) parts.push({ words: 'searched the web' })
  if (edits.length > 0) {
    // A file a later call edited again is the same file: summed as a turn's are.
    const files = sumEdits(edits.flatMap(call => (call.files ?? []).map(file => ({ path: file.path, added: file.added, removed: file.removed, ...(file.created ? { created: true as const } : {}) }))))
    const created = files.filter(file => file.created).length
    if (files.length === 1) parts.push({ words: created === 1 ? 'created' : 'edited', target: files[0]!.name })
    else if (files.length === 0) parts.push({ words: `edited ${count(edits.length, 'a file', 'files')}` })
    else {
      if (created > 0) parts.push({ words: `created ${count(created, 'a file', 'files')}` })
      if (files.length > created) parts.push({ words: `edited ${count(files.length - created, 'a file', 'files')}` })
    }
    if (files.length > 0) summary.size = sizeOf(files)
  }
  const tools = of('skill').length + of('other').length
  if (tools > 0) parts.push({ words: `used ${count(tools, 'a tool', 'tools')}` })
  if (parts[0]) parts[0].words = parts[0].words.charAt(0).toUpperCase() + parts[0].words.slice(1)
  return summary
}

/** A run of calls in one line, as plain words: what the line says to a screen reader. */
export function summaryWords(summary: CallsSummary): string {
  return summary.parts.map(part => (part.target === undefined ? part.words : `${part.words} ${part.target}`)).join(', ')
}

/**
 * What the agent wrote about a call, said as going on: "Find all markdown files" becomes "Finding
 * all markdown files", "Summarize README" becomes "Summarizing README", as the live line of Claude
 * Code on the web says what is being done. Only words that open with a verb this knows are turned:
 * a description that opens with anything else ("README summary", "npm install") is not a command
 * to turn, and `undefined` leaves it as it was written.
 */
export function doingOf(words: string): string | undefined {
  const match = /^([A-Za-z][A-Za-z-]*)(.*)$/s.exec(words.trim())
  if (!match) return undefined
  const [, first, rest] = match as unknown as [string, string, string]
  const verb = first.toLowerCase()
  // Already going on: "Running tests".
  if (verb.endsWith('ing') && (VERBS.has(verb.slice(0, -3)) || VERBS.has(`${verb.slice(0, -3)}e`) || VERBS.has(verb.slice(0, -4)))) return words.trim()
  if (!VERBS.has(verb)) return undefined
  // A second thing done, after "and" or "then", goes on too: "Waiting 10 seconds then listing
  // files", "Adding a footer and renaming the heading". After a comma it is a list of things, and
  // Claude Code on the web leaves those as they were written ("Showing status, count files").
  const more = rest.replace(/\b(and|then)(\s+)([A-Za-z][A-Za-z-]*)/g, (whole, joint: string, space: string, next: string) => (VERBS.has(next.toLowerCase()) ? `${joint}${space}${ingOf(next)}` : whole))
  return ingOf(first) + more
}

/**
 * What the agent wrote about a call, said as done: "Wait 10 seconds then list files" becomes
 * "Waited 10 seconds then listed files", as Claude Code on the web's row says a call once it is
 * over. By the same rules as `doingOf`; words it does not know to turn are `undefined`.
 */
export function doneOf(words: string): string | undefined {
  const match = /^([A-Za-z][A-Za-z-]*)(.*)$/s.exec(words.trim())
  if (!match) return undefined
  const [, first, rest] = match as unknown as [string, string, string]
  const verb = stemOf(first.toLowerCase())
  if (verb === undefined) return undefined
  const more = rest.replace(/\b(and|then)(\s+)([A-Za-z][A-Za-z-]*)/g, (whole, joint: string, space: string, next: string) => {
    const stem = stemOf(next.toLowerCase())
    return stem !== undefined ? `${joint}${space}${asWritten(next, pastOf(stem))}` : whole
  })
  return asWritten(first, pastOf(verb)) + more
}

/** The verb a word is, as this knows it: "list", or "listing" said as going on. */
function stemOf(word: string): string | undefined {
  if (VERBS.has(word)) return word
  if (!word.endsWith('ing')) return undefined
  const stem = word.slice(0, -3)
  return [stem, `${stem}e`, stem.slice(0, -1), stem.endsWith('y') ? `${stem.slice(0, -1)}ie` : undefined].find(verb => verb !== undefined && VERBS.has(verb))
}

/** A verb this knows, in its past form. */
function pastOf(verb: string): string {
  const irregular = IRREGULAR[verb]
  if (irregular !== undefined) return irregular
  if (DOUBLED.has(verb)) return `${verb}${verb.at(-1)}ed`
  if (verb.endsWith('e')) return `${verb}d`
  if (/[^aeiou]y$/.test(verb)) return `${verb.slice(0, -1)}ied`
  return `${verb}ed`
}

/** The verbs whose past is a word of its own: "run", "ran". */
const IRREGULAR: Record<string, string> = {
  build: 'built', cut: 'cut', drive: 'drove', find: 'found', get: 'got', give: 'gave', hold: 'held', keep: 'kept', leave: 'left', make: 'made', put: 'put',
  read: 'read', rebuild: 'rebuilt', reread: 'reread', 're-read': 're-read', rerun: 'reran', reset: 'reset', rewrite: 'rewrote', run: 'ran',
  send: 'sent', set: 'set', sleep: 'slept', split: 'split', take: 'took', tell: 'told', write: 'wrote',
}

/** A word turned, its first letter as it was written. */
function asWritten(word: string, turned: string): string {
  return word[0] === word[0]!.toUpperCase() ? turned.charAt(0).toUpperCase() + turned.slice(1) : turned
}

/** A verb this knows, in its "-ing" form, its first letter as it was written. */
function ingOf(word: string): string {
  const verb = word.toLowerCase()
  const doing = DOUBLED.has(verb) ? verb + verb.at(-1) + 'ing' : verb.endsWith('ie') ? verb.slice(0, -2) + 'ying' : /[^aeioy]e$/.test(verb) ? verb.slice(0, -1) + 'ing' : verb + 'ing'
  return word[0] === word[0]!.toUpperCase() ? doing.charAt(0).toUpperCase() + doing.slice(1) : doing
}

/** The verbs a description of a call opens with, by what the agents wrote: each turned by the rules of `doingOf`. */
const VERBS = new Set(
  (
    'add analyze append apply archive audit build bump calculate call change check clean clear clone close collect commit compare compile compute ' +
    'configure confirm convert copy count create cut debug decode delete deploy describe detect diff disable display download draft drop dump echo ' +
    'edit enable encode ensure evaluate examine execute explore export extract fetch filter find fix format gather generate get grab grep identify ' +
    'import inspect install investigate kill launch lint list load locate log look make map measure merge migrate move open outline parse patch pick ' +
    'ping plan prepare preview print profile prune publish pull push query read rebase rebuild record refactor refresh reload remove rename render ' +
    'replace report rerun research reset resolve restart restore retry review revert rewrite run save scan search serve set show shorten sort split ' +
    'start stash stop study summarize survey sync tag test tidy trace translate trim try unzip update upgrade upload use validate verify view wait ' +
    'watch write zip adjust type sleep tail peek answer approve ask assign cancel claim comment drive give hand hold join keep label land leave link mark name note pause poll post ' +
    'probe queue reach recheck reply request reread re-read resume return send share stage switch take tell turn unstage walk wire'
  ).split(' '),
)

/** The verbs whose last letter is doubled before "-ing" and "-ed": "run", "running", "grep", "grepped". */
const DOUBLED = new Set(['commit', 'cut', 'debug', 'drop', 'format', 'get', 'grab', 'grep', 'log', 'map', 'plan', 'put', 'rerun', 'run', 'set', 'stop', 'tag', 'unzip', 'zip', 'scan', 'ship', 'skip', 'submit', 'trim'])
