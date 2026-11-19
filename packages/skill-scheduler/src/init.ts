import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { isMap, isScalar, isSeq, parseDocument, type YAMLSeq } from 'yaml'
import { OPENAGENT_DIR } from '@openagt/agent-data'

/**
 * `init`: this tool's lines written into a dashboard's hooks file, so the scheduler runs while the
 * dashboard is open. The tool writes its own lines: the dashboard names no tool. A person's file
 * is never overwritten: a list gains a line only when it lacks it. Its `open` and `close` lines are
 * all the file holds since runs start through the dashboard's run host (#2394); they go when the
 * scheduler starts and stops with the app (`app.lifecycle`, #2394's step 6).
 *
 * The lines name the tool bare, with no `npx`: the dashboard brings this tool and puts it on a
 * line's PATH, so nothing is fetched from npm to run one. With `npx`, a
 * project that installed nothing would get the unrelated package that holds the name `scheduler`
 * on npm.
 *
 * A line that already runs the tool is the tool's line, however it is spelled: a person's own
 * (`npx @openagt/skill-scheduler@0.1 start`) included. `init` writes no second line beside it, and
 * `removeHooks` takes it out with the rest.
 */

/** The lines, in the order a new file lists them: `open` and `close`, each a list. */
const HOOK_LINES: Readonly<Record<string, readonly string[]>> = {
  open: ['scheduler start'],
  close: ['scheduler stop --unless-keep-alive'],
}

/** This tool, as a hook line names it: its package or its command. */
const TOOL = { name: '@openagt/skill-scheduler', commands: ['scheduler'] }

const HOOKS_FILE = `${OPENAGENT_DIR}/hooks.yml`

export type InitOutcome =
  | { ok: true; file: string; added: string[]; kept: string[] }
  | { ok: false; reason: 'no-dashboard' | 'unreadable'; file: string; detail?: string }

/** What taking the lines out answered: the keys that lost a line, or why the file could not be changed. */
export type RemoveOutcome = { ok: true; file: string; removed: string[] } | { ok: false; reason: 'unreadable'; file: string; detail?: string }

/**
 * Whether a shell line runs this tool: one of its commands, bare or by a path, or its package's
 * name, with or without a version, stands in the line as a word of its own. A name inside another
 * word is not it. How the hooks file is read, to write no second line beside one that already runs
 * the tool and to take its own lines back.
 */
export function runsTool(line: string): boolean {
  return line
    .split(/[\s"'`=;|&()<>]+/)
    .some(word => word.replace(/@[\w.^~<>=*-]+$/, '') === TOOL.name || TOOL.commands.includes(word.slice(word.lastIndexOf('/') + 1)))
}

/** One item of a hooks list, as the line it is. */
function lineOf(item: unknown): string {
  return String(isScalar(item) ? item.value : item)
}

/** The lists of the hooks file that hold this tool's lines, as written; none for a file that is not there or cannot be read. */
async function lists(repo: string): Promise<Record<string, string[]>> {
  const raw = await readFile(join(repo, HOOKS_FILE), 'utf8').catch(() => '')
  const doc = parseDocument(raw)
  if (doc.errors.length > 0 || !isMap(doc.contents)) return {}
  const found: Record<string, string[]> = {}
  for (const key of Object.keys(HOOK_LINES)) {
    const list = doc.get(key, true)
    if (isSeq(list)) found[key] = (list as YAMLSeq).items.map(item => lineOf(item))
  }
  return found
}

/** Write the lines into `<repo>/.openagent/hooks.yml`, each only where no line of its list runs the tool yet; nothing where the dashboard has no directory. */
export async function initHooks(repo: string): Promise<InitOutcome> {
  const present = await lists(repo)
  const missing = Object.fromEntries(Object.entries(HOOK_LINES).filter(([key]) => !(present[key] ?? []).some(runsTool)))
  return writeHookLines(repo, missing)
}

/**
 * Take this tool's lines out of the hooks file: every `open` and `close` line that runs it. A list
 * left empty goes with its key; every other line, key and comment stays, and a file left with
 * nothing in it is deleted. A file that is not there has nothing to take.
 */
export async function removeHooks(repo: string): Promise<RemoveOutcome> {
  const file = join(repo, HOOKS_FILE)
  const raw = await readFile(file, 'utf8').catch(() => undefined)
  if (raw === undefined) return { ok: true, file, removed: [] }
  const doc = parseDocument(raw)
  const error = doc.errors[0]
  if (error) return { ok: false, reason: 'unreadable', file, detail: error.message.split('\n')[0] ?? error.message }
  if (!isMap(doc.contents)) return { ok: true, file, removed: [] }
  const removed: string[] = []
  for (const key of Object.keys(HOOK_LINES)) {
    const list = doc.get(key, true)
    if (!isSeq(list)) continue
    const seq = list as YAMLSeq
    const kept = seq.items.filter(item => !runsTool(lineOf(item)))
    if (kept.length === seq.items.length) continue
    removed.push(key)
    if (kept.length === 0) doc.delete(key)
    else seq.items = kept
  }
  if (removed.length === 0) return { ok: true, file, removed }
  // A file that held nothing but these lines goes with them: it was this tool's.
  if (doc.contents.items.length === 0 && !/^\s*#/m.test(raw)) await rm(file)
  else await writeFile(file, doc.toString({ lineWidth: 0 }))
  return { ok: true, file, removed }
}

/**
 * Write `lines` into `<repo>/.openagent/hooks.yml`, each key a list of lines. The dashboard's
 * directory must be there already (the dashboard makes it when the project is added, and hides it
 * from git); without it nothing is written. `added` names the keys that gained a line, `kept` the
 * ones a person set otherwise.
 */
async function writeHookLines(repo: string, lines: Readonly<Record<string, readonly string[]>>): Promise<InitOutcome> {
  const file = join(repo, HOOKS_FILE)
  if (!(await stat(join(repo, OPENAGENT_DIR)).then(found => found.isDirectory(), () => false))) return { ok: false, reason: 'no-dashboard', file }
  const raw = await readFile(file, 'utf8').catch(() => '')
  const doc = parseDocument(raw)
  const error = doc.errors[0]
  if (error) return { ok: false, reason: 'unreadable', file, detail: error.message.split('\n')[0] ?? error.message }
  // An empty file, or one of comments only, is an empty map.
  if (doc.contents === null) doc.contents = doc.createNode({}) as unknown as typeof doc.contents
  if (!isMap(doc.contents)) return { ok: false, reason: 'unreadable', file, detail: 'the file is not a YAML map' }
  const added: string[] = []
  const kept: string[] = []
  for (const [key, list] of Object.entries(lines)) {
    const present = doc.get(key, true)
    if (present == null) {
      doc.set(key, doc.createNode([...list]))
      added.push(key)
    } else if (isSeq(present)) {
      const seq = present as YAMLSeq
      const there = seq.items.map(item => lineOf(item).trim())
      const missing = list.filter(line => !there.includes(line))
      for (const line of missing) seq.add(doc.createNode(line))
      if (missing.length > 0) added.push(key)
    } else {
      kept.push(key)
    }
  }
  if (added.length > 0) {
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, doc.toString({ lineWidth: 0 }))
  }
  return { ok: true, file, added, kept }
}
