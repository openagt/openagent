import { MAX_CONSOLE_TEXT, MAX_CONSOLE_WHERE, type ConsoleLevel, type ConsoleLine } from './stream.js'

/**
 * The page's console, as the browser's process keeps it: what the page's code logged, the errors
 * nothing caught, and what the browser itself said about the page (a file that did not load).
 * Each arrives as a DevTools event and becomes one line of plain text here: the text is the
 * page's own, so it is cut to a length and cleared of control characters before anyone, a person
 * or an agent, reads it.
 */

/** A line before it has its number. */
export type Said = Omit<ConsoleLine, 'n'>

/** How many lines a browser keeps: the newest. */
export const KEPT_LINES = 500
/** How much of the console `browser console` prints: the errors, then the newest lines that fit. */
export const PRINT_LIMIT = 10_000
/** How much of one line it prints: so many characters, on so many lines. */
const PRINT_LINE_LIMIT = 1_000
const PRINT_LINE_BREAKS = 12
/** How much of a value is looked at: a page may log a text of any length, and only the line's own length is kept. */
const VALUE_LIMIT = 4 * MAX_CONSOLE_TEXT
/** How many of a call's values are looked at. */
const VALUES_LIMIT = 50
/**
 * How much a page may say in one second. A page that says more is no longer listened to until
 * it goes to another address: every line costs this process work, whoever reads it.
 */
export const FLOOD_LINES = 1_000
export const FLOOD_BYTES = 8 * 1024 * 1024

/** A value as DevTools hands it over. */
interface RemoteObject {
  type?: string
  subtype?: string
  value?: unknown
  unserializableValue?: string
  description?: string
  preview?: ObjectPreview
}

interface ObjectPreview {
  subtype?: string
  description?: string
  overflow?: boolean
  properties?: { name?: string; type?: string; value?: string }[]
}

interface StackTrace {
  callFrames?: { url?: string; lineNumber?: number }[]
}

/**
 * `text` no longer than `limit`, and without what could pass for something else where it is read:
 * control characters, the marks that turn the direction of text, and any line break but `\n`
 * (which, with a tab, stays unless `oneLine`). Only its beginning is looked at, whatever its length.
 */
function clean(text: string, limit: number, oneLine = false): string {
  const plain = text
    .slice(0, 2 * limit)
    .replace(/[\u2028\u2029]/g, '\n')
    .replace(oneLine ? /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g : /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
  return plain.length > limit ? `${plain.slice(0, limit - 1)}…` : plain
}

function line(level: ConsoleLevel, text: string, at: number, where?: string): Said {
  return { at, level, text: clean(text, MAX_CONSOLE_TEXT), ...(where ? { where } : {}) }
}

/** The time DevTools gives, in milliseconds since 1970; `now` when it gives none. */
function when(stamp: unknown, now: number): number {
  return typeof stamp === 'number' && Number.isFinite(stamp) && stamp > 0 ? Math.round(stamp) : now
}

/** An address, and the line in it when there is one (`first` is the number the address's first line has). */
function place(url: unknown, lineNumber?: unknown, first = 0): string | undefined {
  if (typeof url !== 'string' || !url) return undefined
  const at = typeof lineNumber === 'number' && Number.isInteger(lineNumber) && lineNumber >= first ? `:${lineNumber - first + 1}` : ''
  return clean(url, MAX_CONSOLE_WHERE - at.length, true) + at
}

/** An object as a console shows it at a glance: `{a: 1, b: "x"}`, `[1, 2, …]`. */
function glance(preview: ObjectPreview | undefined): string | undefined {
  if (!preview?.properties || (preview.subtype !== undefined && preview.subtype !== 'array')) return undefined
  const value = (prop: { type?: string; value?: string }): string => (prop.type === 'string' ? JSON.stringify(prop.value ?? '') : (prop.value ?? prop.type ?? ''))
  const more = preview.overflow ? ['…'] : []
  if (preview.subtype === 'array') return `[${[...preview.properties.map(value), ...more].join(', ')}]`
  const named = preview.description && preview.description !== 'Object' ? `${preview.description} ` : ''
  return `${named}{${[...preview.properties.map(prop => `${prop.name ?? ''}: ${value(prop)}`), ...more].join(', ')}}`
}

/** One value, as text. */
function show(arg: RemoteObject | undefined): string {
  if (!arg) return ''
  switch (arg.type) {
    case 'string':
      return String(arg.value ?? '').slice(0, VALUE_LIMIT)
    case 'undefined':
      return 'undefined'
    case 'number':
    case 'boolean':
    case 'bigint':
      return arg.unserializableValue ?? String(arg.value)
    case 'function':
      return `ƒ ${(arg.description ?? '').split('\n')[0]!.slice(0, 80)}`
    case 'object':
      if (arg.subtype === 'null') return 'null'
      return (glance(arg.preview) ?? arg.description ?? 'Object').slice(0, VALUE_LIMIT)
    default:
      return (arg.description ?? String(arg.value ?? '')).slice(0, VALUE_LIMIT)
  }
}

/** What a console call says: its values side by side, the first one's `%s`-style marks filled in from the next ones. */
function joined(args: RemoteObject[]): string {
  const [first, ...rest] = args.slice(0, VALUES_LIMIT)
  const pattern = first?.type === 'string' ? show(first) : ''
  if (!pattern.includes('%')) return args.slice(0, VALUES_LIMIT).map(show).join(' ')
  let taken = 0
  const head = pattern.replace(/%([sdifoOc%])/g, (mark, kind: string) => {
    if (kind === '%') return '%'
    if (taken >= rest.length) return mark
    const arg = rest[taken++]
    // `%c` styles the text after it: the style is taken and says nothing.
    return kind === 'c' ? '' : show(arg)
  })
  return [head, ...rest.slice(taken).map(show)].join(' ')
}

const CALL_LEVEL: Record<string, ConsoleLevel> = { error: 'error', assert: 'error', warning: 'warning', info: 'info', debug: 'debug' }
/** The console calls that say nothing of their own. */
const SILENT = new Set(['clear', 'endGroup', 'profile', 'profileEnd'])

/** The line a console call makes (`Runtime.consoleAPICalled`): `console.log`, `console.error`, … */
export function consoleCall(params: Record<string, unknown>, now = Date.now()): Said | undefined {
  const type = String(params['type'] ?? 'log')
  if (SILENT.has(type)) return undefined
  const said = joined(Array.isArray(params['args']) ? (params['args'] as RemoteObject[]) : [])
  const frame = (params['stackTrace'] as StackTrace | undefined)?.callFrames?.[0]
  return line(
    Object.hasOwn(CALL_LEVEL, type) ? CALL_LEVEL[type]! : 'log',
    type === 'assert' ? `Assertion failed${said ? `: ${said}` : ''}` : said,
    when(params['timestamp'], now),
    place(frame?.url, frame?.lineNumber),
  )
}

/** The line an error nothing caught makes (`Runtime.exceptionThrown`). */
export function thrown(params: Record<string, unknown>, now = Date.now()): Said | undefined {
  const details = params['exceptionDetails'] as { text?: string; url?: string; lineNumber?: number; stackTrace?: StackTrace; exception?: RemoteObject } | undefined
  if (!details) return undefined
  const head = details.text ?? 'Uncaught'
  const what = show(details.exception)
  const frame = details.stackTrace?.callFrames?.[0]
  // A syntax error's own sentence is already the whole text; any other error follows "Uncaught".
  const sentence = what.split('\n')[0]!
  const text = !what || (sentence && head.includes(sentence)) ? head : `${head} ${what}`
  return line('error', text, when(params['timestamp'], now), place(details.url ?? frame?.url, details.url ? details.lineNumber : frame?.lineNumber))
}

const ENTRY_LEVEL: Record<string, ConsoleLevel> = { error: 'error', warning: 'warning', info: 'info', verbose: 'debug' }

/** The line the browser's own remark makes (`Log.entryAdded`): a file that did not load, a blocked request, … */
export function logEntry(params: Record<string, unknown>, now = Date.now()): Said | undefined {
  const entry = params['entry'] as { source?: string; level?: string; text?: string; timestamp?: number; url?: string; lineNumber?: number } | undefined
  if (!entry || typeof entry.text !== 'string') return undefined
  const level = typeof entry.level === 'string' && Object.hasOwn(ENTRY_LEVEL, entry.level) ? ENTRY_LEVEL[entry.level]! : 'log'
  // A remark about the network names the file that was asked for, not a line in it.
  return line(level, entry.text, when(entry.timestamp, now), entry.source === 'network' ? place(entry.url) : place(entry.url, entry.lineNumber, 1))
}

/** The line that says the page went to another address; `errors`, how many errors that page had said already (a tab the agent came back to). */
export function went(url: string, now = Date.now(), errors = 0): Said {
  return { ...line('went', clean(url, MAX_CONSOLE_TEXT, true), now), ...(errors > 0 ? { errors } : {}) }
}

/** The line that says the page is no longer listened to. */
export function flooded(now = Date.now()): Said {
  return line('warning', 'The page logs too much: the console stopped listening, until the page goes to another address.', now)
}

/**
 * The console's lines as a browser keeps them: the newest {@link KEPT_LINES}, each numbered as
 * it is added, so whoever follows them knows the next one it has not got.
 */
export function consoleLog(kept = KEPT_LINES) {
  const lines: ConsoleLine[] = []
  let newest = 0
  return {
    lines: lines as readonly ConsoleLine[],
    /** The number of the newest line; 0 before any. */
    get newest(): number {
      return newest
    },
    add(said: Said): void {
      lines.push({ n: ++newest, ...said })
      if (lines.length > kept) lines.shift()
    },
    /** The line numbered `n`; the oldest kept when that one is gone; nothing when `n` is past the newest. */
    from(n: number): ConsoleLine | undefined {
      const first = newest - lines.length + 1
      return lines[Math.max(n, first) - first]
    },
    /** How many errors were said after line `n`, among the lines kept. */
    errorsAfter(n: number): number {
      return lines.reduce((count, said) => (said.level === 'error' && said.n > n ? count + 1 : count), 0)
    },
  }
}

/**
 * Which of a page's lines are new. DevTools says a page's kept lines again each time the page
 * is listened to anew (a tab the agent comes back to): until the listening has `settled`, a line
 * no newer than the newest one heard from that page before is one of those.
 */
export function heardOnce(): (page: string) => { fresh: (at: number) => boolean; settled: () => void } {
  const newest = new Map<string, number>()
  return page => {
    let before = newest.get(page)
    return {
      fresh(at) {
        if (before !== undefined && at <= before) return false
        newest.set(page, Math.max(newest.get(page) ?? 0, at))
        return true
      },
      settled() {
        before = undefined
      },
    }
  }
}

const count = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/** One line as `browser console` prints it; what follows a line break is set in, so each line begins with its time. */
function printed(said: ConsoleLine): string {
  const time = new Date(said.at).toTimeString().slice(0, 8)
  if (said.level === 'went') return `${time} → ${said.text}`
  const rows = said.text.split('\n')
  const shown = rows.length > PRINT_LINE_BREAKS + 1 ? [...rows.slice(0, PRINT_LINE_BREAKS + 1), '…'].join('\n') : said.text
  const text = shown.length > PRINT_LINE_LIMIT ? `${shown.slice(0, PRINT_LINE_LIMIT - 1)}…` : shown
  return `${time} ${said.level}: ${text.replace(/\n/g, '\n    ')}${said.where ? ` (${said.where})` : ''}`
}

/**
 * The console as the agent reads it: how much there is, then the lines, oldest first. When they
 * do not all fit in {@link PRINT_LIMIT}, the errors are printed before anything else, the newest
 * first, and then the newest of the other lines: an error is what the agent came to read, and a
 * page that says much after it does not hide it.
 */
export function printConsole(lines: readonly ConsoleLine[]): string {
  const messages = lines.filter(said => said.level !== 'went')
  if (messages.length === 0) return 'The console is empty.'
  const texts = lines.map(printed)
  const kept = new Set<number>()
  let room = PRINT_LIMIT
  const take = (wanted: (said: ConsoleLine) => boolean): void => {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (kept.has(i) || !wanted(lines[i]!)) continue
      if (texts[i]!.length + 1 > room) return
      room -= texts[i]!.length + 1
      kept.add(i)
    }
  }
  take(said => said.level === 'error')
  take(() => true)
  const left = lines.length - kept.size
  const errors = messages.filter(said => said.level === 'error').length
  return [
    `Console: ${count(messages.length, 'message')}, ${count(errors, 'error')}.`,
    ...(left ? [`… ${count(left, 'line')} not printed: the errors come first, then the newest lines`] : []),
    ...texts.filter((_, i) => kept.has(i)),
  ].join('\n')
}

/** What a page print begins with when the page logged errors the agent was not told of. */
export function errorsNote(fresh: number): string {
  return `Console: ${count(fresh, 'new error')}. Read ${fresh === 1 ? 'it' : 'them'} with the \`console\` command.`
}
