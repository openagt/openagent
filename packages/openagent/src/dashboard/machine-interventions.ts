import { interventionKey } from './keys.js'
import type { Intervention } from './interventions.js'
import type { ProjectionRead } from './projects.js'

/**
 * The Human Queue of the person's other computers, beside this one's own: what needs the person in
 * a run there (its question, the work it left unpublished, the PR it opened) and the PRs of a
 * project only another computer has. Each computer says the items of its own projects only, never
 * the ones it lists of other computers', so two computers never ask each other in a circle. Here
 * each item is named by the project as it is listed here: this computer's own of the same
 * repository, else the other computer's under its id here; and an item of a run there is marked
 * with that computer.
 */

/** What the person's other computers said of their Human Queues, each as named here, and the projects here that one which did not answer has. */
export interface MachinesQueue {
  said: ProjectionRead<Intervention>[]
  /** Projects here whose items on a computer that did not answer are not known: none of them is read whole. */
  unread: string[]
}

/** The longest list a computer is taken at its word for, and the longest strings in it. */
const MAX_ITEMS = 500
const MAX_WORD = 2_048
const KINDS: ReadonlySet<string> = new Set(['pr', 'awaiting', 'uncommitted', 'unpushed'])

/** What a computer answered as its Human Queue, the items that read as items, each in the fields an item has: anything else is dropped. */
export function interventionsOf(said: unknown): ProjectionRead<Intervention> {
  if (!said || typeof said !== 'object') return { items: [], whole: [] }
  const { items, whole } = said as Record<string, unknown>
  const word = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= MAX_WORD
  const count = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0
  const read: Intervention[] = []
  for (const raw of Array.isArray(items) ? items.slice(0, MAX_ITEMS) : []) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    if (!word(item.projectId) || !word(item.projectName) || !word(item.kind) || !KINDS.has(item.kind) || !word(item.title)) continue
    read.push({
      projectId: item.projectId,
      projectName: item.projectName,
      kind: item.kind as Intervention['kind'],
      title: item.title,
      ...(word(item.question) ? { question: item.question } : {}),
      // Only a page on the web: the row opens it.
      ...(word(item.url) && /^https?:\/\//.test(item.url) ? { url: item.url } : {}),
      ...(count(item.number) ? { number: item.number } : {}),
      ...(word(item.awaitId) ? { awaitId: item.awaitId } : {}),
      ...(word(item.agentId) ? { agentId: item.agentId } : {}),
      ...(word(item.branch) ? { branch: item.branch } : {}),
      ...(count(item.commits) ? { commits: item.commits } : {}),
      ...(typeof item.gitHost === 'boolean' ? { gitHost: item.gitHost } : {}),
      ...(count(item.files) ? { files: item.files } : {}),
      ...(word(item.createdAt) && !Number.isNaN(Date.parse(item.createdAt)) ? { createdAt: item.createdAt } : {}),
    })
  }
  return { items: read, whole: Array.isArray(whole) ? whole.filter(word) : [] }
}

/**
 * A computer's Human Queue as named here: each item by `idHere` of its project's id there, and one
 * about a run marked with the computer it runs on. An item of a project not listed here is dropped.
 */
export function namedHere(said: ProjectionRead<Intervention>, idHere: (theirs: string) => string | undefined, computer: string): ProjectionRead<Intervention> {
  const items = said.items.flatMap(item => {
    const projectId = idHere(item.projectId)
    return projectId === undefined ? [] : [{ ...item, projectId, ...(item.agentId !== undefined ? { computer } : {}) }]
  })
  const whole = said.whole.flatMap(id => idHere(id) ?? [])
  return { items, whole }
}

/**
 * This computer's Human Queue with what the other computers said: each item named as its project is
 * here (`names`, by id: one not listed is dropped), once, newest first. Of a PR both list, the one
 * a run opened is kept: its row opens the run. A project is read whole when every computer that has
 * it answered.
 */
export function withMachinesQueue(own: ProjectionRead<Intervention>, machines: MachinesQueue, names: ReadonlyMap<string, string>): ProjectionRead<Intervention> {
  const theirs = machines.said.flatMap(said => said.items.flatMap(item => (names.has(item.projectId) ? [{ ...item, projectName: names.get(item.projectId)! }] : [])))
  const kept = new Map<string, Intervention>()
  for (const item of [...own.items, ...theirs]) {
    const key = interventionKey(item)
    const was = kept.get(key)
    if (!was || (was.agentId === undefined && item.agentId !== undefined)) kept.set(key, item)
  }
  const items = [...kept.values()].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
  const unread = new Set(machines.unread)
  const whole = [...new Set([...own.whole, ...machines.said.flatMap(said => said.whole)])].filter(id => !unread.has(id) && names.has(id))
  return { items, whole }
}

/** How long a computer's Human Queue is taken before it is asked again: a page asks every few seconds. */
export const QUEUE_KEPT_MS = 10_000
/** How long a Human Queue waits for a computer never answered before: what it says after comes at the next read. */
export const QUEUE_FIRST_WAIT_MS = 3_000

/**
 * Each machine asked at most every {@link QUEUE_KEPT_MS}, and what it said last kept: a read is
 * answered at once with that while the machine is asked again behind it. One never answered yet is
 * waited for a little; one whose last ask failed has nothing kept, so its items are not taken as
 * still there.
 */
export class AnswersKept<M extends { id: string }, T> {
  private readonly kept = new Map<string, { at: number; said?: T; asking?: Promise<void> | undefined }>()

  constructor(
    private readonly ask: (machine: M) => Promise<T>,
    private readonly now: () => number = Date.now,
  ) {}

  /** What each machine said last, by its id: one that never answered, or whose last ask failed, has none. */
  async of(machines: readonly M[]): Promise<Map<string, T>> {
    const waits: Promise<void>[] = []
    for (const machine of machines) {
      const entry = this.kept.get(machine.id)
      if (entry?.asking || (entry && this.now() - entry.at < QUEUE_KEPT_MS)) {
        if (entry.asking && !('said' in entry)) waits.push(entry.asking)
        continue
      }
      const one: { at: number; said?: T; asking?: Promise<void> | undefined } = { at: this.now(), ...(entry && 'said' in entry ? { said: entry.said as T } : {}) }
      one.asking = this.ask(machine).then(
        said => void (one.said = said),
        () => void delete one.said,
      ).finally(() => (one.asking = undefined))
      this.kept.set(machine.id, one)
      if (!('said' in one)) waits.push(one.asking)
    }
    if (waits.length > 0) await Promise.race([Promise.all(waits), new Promise(done => setTimeout(done, QUEUE_FIRST_WAIT_MS).unref())])
    const said = new Map<string, T>()
    for (const machine of machines) {
      const entry = this.kept.get(machine.id)
      if (entry && 'said' in entry) said.set(machine.id, entry.said as T)
    }
    return said
  }
}
