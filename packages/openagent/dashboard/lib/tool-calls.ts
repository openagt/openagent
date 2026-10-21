// How a tool call of the coding agent reads in the chat: a verb, then what it was done to
// ("Read AGENTS.md", "Ran pnpm test"), and how a run of calls sums up ("Ran 2 commands, read 1
// file"). Both drivers say a call as a label and a detail: Claude Code's label is the tool's name
// (Bash, Read, Edit), Codex's is the kind of the item (commandExecution, fileChange), so each has
// its own lines in the one map.

import { sumEdits, type ChangedFile, type FileEdit } from './turn-changes.js'

/** What a call did, for counting a run of calls. */
type CallKind = 'command' | 'read' | 'edit' | 'search' | 'skill' | 'other'

export interface ToolCall {
  /** The grey word: what was done. */
  verb: string
  /** The same word while the call is still going on: "Running", "Reading". */
  doing: string
  /** The dark words: what it was done to. A file reads as its name alone. */
  target?: string
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

const CALLS: Record<string, { verb: string; doing: string; kind: CallKind; file?: true }> = {
  // Claude Code: the tool's name.
  Bash: { verb: 'Ran', doing: 'Running', kind: 'command' },
  Read: { verb: 'Read', doing: 'Reading', kind: 'read', file: true },
  Edit: { verb: 'Edited', doing: 'Editing', kind: 'edit', file: true },
  MultiEdit: { verb: 'Edited', doing: 'Editing', kind: 'edit', file: true },
  NotebookEdit: { verb: 'Edited', doing: 'Editing', kind: 'edit', file: true },
  Write: { verb: 'Wrote', doing: 'Writing', kind: 'edit', file: true },
  Grep: { verb: 'Searched', doing: 'Searching', kind: 'search' },
  Glob: { verb: 'Searched', doing: 'Searching', kind: 'search' },
  WebSearch: { verb: 'Searched the web', doing: 'Searching the web', kind: 'search' },
  WebFetch: { verb: 'Fetched', doing: 'Fetching', kind: 'other' },
  Skill: { verb: 'Used skill', doing: 'Using skill', kind: 'skill' },
  Task: { verb: 'Started agent', doing: 'Starting agent', kind: 'other' },
  Agent: { verb: 'Started agent', doing: 'Starting agent', kind: 'other' },
  TodoWrite: { verb: 'Updated todos', doing: 'Updating todos', kind: 'other' },
  // Codex: the kind of the item.
  commandExecution: { verb: 'Ran', doing: 'Running', kind: 'command' },
  fileChange: { verb: 'Edited', doing: 'Editing', kind: 'edit', file: true },
  mcpToolCall: { verb: 'Called', doing: 'Calling', kind: 'other' },
  webSearch: { verb: 'Searched the web', doing: 'Searching the web', kind: 'search' },
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
 * One call as the chat says it. A label the map does not know is its own verb. A call whose coding
 * agent said the files it changed (`changed`) names them and their size: "Created" when it made
 * every one of them, "Edited" otherwise, whatever the tool was called.
 */
export function toolCall(label: string, detail?: string, changed?: readonly FileEdit[]): ToolCall {
  const known = CALLS[label]
  const call: ToolCall = { verb: known?.verb ?? asWords(label), doing: known?.doing ?? asWords(label), kind: known?.kind ?? 'other' }
  if (detail !== undefined) {
    call.detail = detail
    call.target = known?.file ? fileNames(detail) : detail
  }
  if (changed !== undefined && changed.length > 0) {
    const files = sumEdits(changed)
    call.kind = 'edit'
    call.verb = files.every(file => file.created) ? 'Created' : 'Edited'
    call.target = files.map(file => file.name).join(', ')
    call.files = files
    call.size = sizeOf(files)
  }
  return call
}

/** A run of calls in one line: its words, the file its edits changed, and how much. */
export interface CallsSummary {
  /** The grey words: "Ran 2 commands, edited", "Edited", "Ran a command". */
  words: string
  /** What the edits changed: the file's name, or how many files. */
  target?: string
  /** The lines the edits added and removed, when their coding agent said them. */
  size?: LineCount
}

/**
 * A run of calls in one line, as Claude Code on the web says it: how many commands it ran, and the
 * file its edits changed with how much — "Ran 2 commands, edited README.md +12 −54". An edit is
 * said by its file and is no command; every other step counts as one, whatever it was. Several
 * files are said by how many ("edited 3 files"), "created" when the run made every one of them.
 */
export function callsSummary(calls: readonly ToolCall[]): CallsSummary {
  const edits = calls.filter(call => call.kind === 'edit')
  const commands = calls.length - edits.length
  const parts = commands === 0 ? [] : [commands === 1 ? 'ran a command' : `ran ${commands} commands`]
  const summary: CallsSummary = { words: '' }
  if (edits.length > 0) {
    // A file a later call edited again is the same file: summed as a turn's are.
    const files = sumEdits(edits.flatMap(call => (call.files ?? []).map(file => ({ path: file.path, added: file.added, removed: file.removed, ...(file.created ? { created: true as const } : {}) }))))
    parts.push(files.length > 0 && files.every(file => file.created) ? 'created' : 'edited')
    summary.target = files.length === 1 ? files[0]!.name : files.length > 1 ? `${files.length} files` : edits.length === 1 ? 'a file' : `${edits.length} files`
    if (files.length > 0) summary.size = sizeOf(files)
  }
  const words = parts.join(', ')
  summary.words = words.charAt(0).toUpperCase() + words.slice(1)
  return summary
}

/** A run of calls in one line, as plain words: what the line says to a screen reader. */
export function summaryWords(summary: CallsSummary): string {
  return summary.target === undefined ? summary.words : `${summary.words} ${summary.target}`
}
