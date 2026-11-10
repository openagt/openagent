import { readProjectFile } from '@openagt/agent-data'
import { QUEUE_FILE } from './names.js'

// The agent queue, `TODO_AGENTS.md`: every task agents will work on next, in markdown list items
// banded by `## Priority N` sections from 10 down to 0, first within a band first to be taken. An
// entry is text, or a link back to the ticket it came from. A done entry is deleted: the file is
// the remaining work, and the history of what ran is kept elsewhere.

/**
 * The open entries of the queue, in file order: markdown list items (`-`, `*`, or `1.`); a task
 * checkbox counts only while unchecked. Headings, prose, and blank lines are not entries — which
 * is why the priority sections need no parser support: a priority-sorted file drains in priority
 * order.
 */
export function parseQueueEntries(md: string): string[] {
  return parseQueueSections(md).map(placed => placed.entry)
}

/** An open entry with the `## Priority N` section it sits in; no `priority` for an entry outside any priority section. */
export interface PlacedEntry {
  entry: string
  priority?: number
}

/**
 * The open entries of the queue, in file order, each with the priority of the `## Priority N`
 * section it sits in: what a dashboard shows as sections. The entry rules are
 * {@link parseQueueEntries}'s; a section runs to the next second-level heading, and an entry
 * before any priority section, or under a second-level heading that is not one, has no priority.
 */
export function parseQueueSections(md: string): PlacedEntry[] {
  const placed: PlacedEntry[] = []
  let priority: number | undefined
  for (const line of md.split('\n')) {
    if (SECTION_HEADING.test(line)) {
      const heading = PRIORITY_HEADING.exec(line)
      priority = heading ? Number(heading[1]) : undefined
      continue
    }
    const entry = openEntry(line)
    if (entry !== undefined) placed.push(priority === undefined ? { entry } : { entry, priority })
  }
  return placed
}

/** The open entry a line is, or `undefined`: a list item with text, its task box (only unchecked) dropped. */
function openEntry(line: string): string | undefined {
  const item = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(line)
  if (!item) return undefined
  const text = item[1]!.trim()
  if (!text) return undefined
  const task = /^\[([ xX])\]\s*(.*)$/.exec(text)
  if (!task) return text
  if (task[1] !== ' ') return undefined
  return task[2]!.trim() || undefined
}

/** A `## Priority 7` heading, with whatever gloss the format's example puts after the number. */
const PRIORITY_HEADING = /^##\s+priority\s+(\d{1,2})\b/i

/** Any second-level heading, which is where a priority section ends. */
const SECTION_HEADING = /^##\s+/

/** The line an entry is written as. */
function item(entry: string): string {
  return `- ${entry}`
}

/** The queue with `entry` appended at its end. */
export function appendQueueEntry(md: string, entry: string): string {
  return `${md}${md === '' || md.endsWith('\n') ? '' : '\n'}${item(entry)}\n`
}

/**
 * The queue with `entry` placed in its `## Priority N` section, creating the section when the
 * file has none. Placement, in the order tried: a section for this priority exists — the entry
 * joins its end, so a section keeps its arrival order; otherwise the section is created before
 * the first *lower*-priority section, since the file sorts high to low; every section outranks
 * it — last, as its own section; no priority sections at all — above the file's first heading,
 * because the file's own sections are then unranked and burying a deliberate pick under them is
 * the bug; no headings at all — a plain tail.
 */
export function insertQueueEntry(md: string, entry: string, priority: number): string {
  const lines = md.split('\n')
  const headings = lines
    .map((line, index) => ({ index, priority: Number(PRIORITY_HEADING.exec(line)?.[1]) }))
    .filter(h => Number.isFinite(h.priority))

  const sectionEnd = (from: number): number => {
    let end = lines.findIndex((line, index) => index > from && SECTION_HEADING.test(line))
    if (end === -1) end = lines.length
    while (end > from + 1 && lines[end - 1]!.trim() === '') end--
    return end
  }

  const existing = headings.find(h => h.priority === priority)
  if (existing) {
    lines.splice(sectionEnd(existing.index), 0, item(entry))
    return lines.join('\n')
  }
  const section = [`## Priority ${priority}`, '', item(entry), '']
  const lower = headings.find(h => h.priority < priority)
  if (lower) {
    lines.splice(lower.index, 0, ...section)
    return lines.join('\n')
  }
  if (headings.length) {
    lines.splice(sectionEnd(headings[headings.length - 1]!.index), 0, '', ...section.slice(0, 3))
    return lines.join('\n')
  }
  const firstHeading = lines.findIndex(line => SECTION_HEADING.test(line))
  if (firstHeading === -1) return `${md}${md === '' || md.endsWith('\n') ? '' : '\n'}${section.slice(0, 3).join('\n')}\n`
  lines.splice(firstHeading, 0, ...section)
  return lines.join('\n')
}

/**
 * The queue without `entry`: the first open line whose text is exactly `entry` is deleted. A line
 * nobody has any more changes nothing.
 */
export function removeQueueEntry(md: string, entry: string): string {
  const line = /^\s*(?:[-*]|\d+\.)\s+(?:\[ \]\s*)?(.*)$/
  const lines = md.split('\n')
  const at = lines.findIndex(row => line.exec(row)?.[1]?.trim() === entry)
  if (at === -1) return md
  lines.splice(at, 1)
  return lines.join('\n')
}

/**
 * The queue as it stands: its markdown, or `undefined` when the project has no queue. From
 * anywhere in the repository. `fresh` fetches first, for a long-lived process about to act on
 * the queue, whose local view may trail what other writers pushed.
 */
export async function readQueue(cwd: string, opts: { fresh?: boolean } = {}): Promise<string | undefined> {
  return readProjectFile(cwd, QUEUE_FILE, opts)
}

