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

// One of a kind reads as Claude Code on the web says it: "Ran a command", not "Ran 1 command".
const COUNTED: Record<CallKind, (n: number) => string> = {
  command: n => (n === 1 ? 'ran a command' : `ran ${n} commands`),
  read: n => (n === 1 ? 'read a file' : `read ${n} files`),
  edit: n => (n === 1 ? 'edited a file' : `edited ${n} files`),
  search: n => (n === 1 ? 'searched once' : `searched ${n} times`),
  skill: n => `used ${n} skills`,
  other: n => (n === 1 ? 'used a tool' : `used ${n} tools`),
}

/** One part of a run's line: its words, and the lines its edits added and removed when they are known. */
export interface SummaryPart {
  text: string
  size?: LineCount
}

/**
 * A run of calls in one line, as parts to be joined with ", ": each kind counted, in the order the
 * kinds first came ("Ran 2 commands", "read a file"), a lone skill by its name ("used skill branches"). The edits whose files are known are said by
 * their files instead of counted: one file by its name ("created DESCRIPTION.md"), several by how
 * many ("edited 3 files"), "created" when the run made every one of them, with the lines added and
 * removed over the run. A file edited by several calls of the run is one file. Edits whose files
 * are not known (a run from before the coding agents said them) are counted as calls.
 */
export function callsSummary(calls: readonly ToolCall[]): SummaryPart[] {
  const counts = new Map<CallKind, number>()
  for (const call of calls) counts.set(call.kind, (counts.get(call.kind) ?? 0) + 1)
  const edits = calls.flatMap(call => call.files ?? [])
  // A file a later call of the run edited again is the same file: summed as a turn's are.
  const files = sumEdits(edits.map(file => ({ path: file.path, added: file.added, removed: file.removed, ...(file.created ? { created: true as const } : {}) })))
  const unknown = calls.filter(call => call.kind === 'edit' && call.files === undefined).length
  const parts = [...counts].flatMap(([kind, n]): SummaryPart[] => {
    // A skill is said by its name: "used skill branches".
    if (kind === 'skill' && n === 1) return [{ text: `used skill ${calls.find(call => call.kind === 'skill')?.target ?? ''}`.trim() }]
    if (kind !== 'edit' || files.length === 0) return [{ text: COUNTED[kind](n) }]
    const verb = files.every(file => file.created) ? 'created' : 'edited'
    const named: SummaryPart = { text: files.length === 1 ? `${verb} ${files[0]!.name}` : `${verb} ${files.length} files`, size: sizeOf(files) }
    return unknown > 0 ? [named, { text: COUNTED.edit(unknown) }] : [named]
  })
  const first = parts[0]
  return first ? [{ ...first, text: first.text.charAt(0).toUpperCase() + first.text.slice(1) }, ...parts.slice(1)] : []
}

/** A run's line as one string, its sizes said as the chat draws them: "Ran 3 commands, created DESCRIPTION.md +11 −0". */
export function summaryWords(parts: readonly SummaryPart[]): string {
  return parts.map(part => (part.size ? `${part.text} +${part.size.added} −${part.size.removed}` : part.text)).join(', ')
}
