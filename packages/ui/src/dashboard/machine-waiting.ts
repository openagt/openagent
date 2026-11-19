import { waitingKey } from './keys.js'
import type { Waiting } from './waiting.js'
import type { ProjectionRead } from './projects.js'

/**
 * What waits on the person on their other computers, beside this one's own: what needs them in a
 * run there (its question, the work it left unpublished, the PR it opened), the PRs of a project
 * only another computer has, and what that computer's modules say. Each computer says the items of
 * its own projects only, never the ones it lists of other computers', so two computers never ask
 * each other in a circle. Here each item is named by the project as it is listed here: this
 * computer's own of the same repository, else the other computer's under its id here; and an item
 * of a run there is marked with that computer.
 */

/** What the person's other computers said waits on the person there, each as named here, and the projects here that one which did not answer has. */
export interface MachinesQueue {
  said: ProjectionRead<Waiting>[]
  /** Projects here whose items on a computer that did not answer are not known: none of them is read whole. */
  unread: string[]
}

/** The longest list a computer is taken at its word for, and the longest strings in it. */
const MAX_ITEMS = 500
const MAX_WORD = 2_048
const SCOPES: ReadonlySet<string> = new Set(['computer', 'project', 'run'])
const MARKS: ReadonlySet<string> = new Set(['question', 'pull-request', 'branch', 'changes'])

/**
 * What a computer answered as what waits on the person there, the items that read as items, each
 * in the fields an item has: anything else is dropped. Of what fixes one, only a page on the web is
 * kept: an action is a module's of that computer, and pressed here it would be done here.
 */
export function waitingOf(said: unknown): ProjectionRead<Waiting> {
  if (!said || typeof said !== 'object') return { items: [], whole: [] }
  const { items, whole } = said as Record<string, unknown>
  const word = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= MAX_WORD
  const web = (value: unknown): value is string => word(value) && /^https?:\/\//.test(value)
  const read: Waiting[] = []
  for (const raw of Array.isArray(items) ? items.slice(0, MAX_ITEMS) : []) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    if (item.kind !== 'waiting' || !word(item.projectId) || !word(item.projectName) || !word(item.module) || !word(item.words) || !word(item.scope) || !SCOPES.has(item.scope)) continue
    const fix = item.fix && typeof item.fix === 'object' ? (item.fix as Record<string, unknown>) : undefined
    read.push({
      kind: 'waiting',
      projectId: item.projectId,
      projectName: item.projectName,
      module: item.module,
      scope: item.scope as Waiting['scope'],
      words: item.words,
      ...(word(item.run) ? { run: item.run } : {}),
      ...(word(item.id) ? { id: item.id } : {}),
      ...(word(item.title) ? { title: item.title } : {}),
      ...(word(item.detail) ? { detail: item.detail } : {}),
      ...(word(item.since) && !Number.isNaN(Date.parse(item.since)) ? { since: item.since } : {}),
      ...(word(item.mark) && MARKS.has(item.mark) ? { mark: item.mark as NonNullable<Waiting['mark']> } : {}),
      ...(fix && word(fix.label) && web(fix.href) ? { fix: { label: fix.label, href: fix.href } } : {}),
    })
  }
  return { items: read, whole: Array.isArray(whole) ? whole.filter(word) : [] }
}

/**
 * What a computer said waits on the person, as named here: each item by `idHere` of its project's
 * id there, and one about a run marked with the computer it runs on. An item of a project not
 * listed here is dropped.
 */
export function namedHere(said: ProjectionRead<Waiting>, idHere: (theirs: string) => string | undefined, computer: NonNullable<Waiting['computer']>): ProjectionRead<Waiting> {
  const items = said.items.flatMap(item => {
    const projectId = idHere(item.projectId)
    return projectId === undefined ? [] : [{ ...item, projectId, ...(item.run !== undefined ? { computer } : {}) }]
  })
  const whole = said.whole.flatMap(id => idHere(id) ?? [])
  return { items, whole }
}

/**
 * What waits on the person on this computer, with what the other computers said: each item named
 * as its project is here (`names`, by id: one not listed is dropped), once, newest first. Of a PR
 * both list, the one a run opened is kept: its row opens the run. A project is read whole when
 * every computer that has it answered.
 */
export function withMachinesQueue(own: ProjectionRead<Waiting>, machines: MachinesQueue, names: ReadonlyMap<string, string>): ProjectionRead<Waiting> {
  const theirs = machines.said.flatMap(said => said.items.flatMap(item => (names.has(item.projectId) ? [{ ...item, projectName: names.get(item.projectId)! }] : [])))
  const kept = new Map<string, Waiting>()
  for (const item of [...own.items, ...theirs]) {
    const key = waitingKey(item)
    const was = kept.get(key)
    if (!was || (was.run === undefined && item.run !== undefined)) kept.set(key, item)
  }
  const items = [...kept.values()].sort((a, b) => (b.since ?? '').localeCompare(a.since ?? ''))
  const unread = new Set(machines.unread)
  const whole = [...new Set([...own.whole, ...machines.said.flatMap(said => said.whole)])].filter(id => !unread.has(id) && names.has(id))
  return { items, whole }
}

/** How long what a computer said waits on the person is taken before it is asked again: a page asks every few seconds. */
export const QUEUE_KEPT_MS = 10_000
/** How long the list waits for a computer never answered before: what it says after comes at the next read. */
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
