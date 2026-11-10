import type { ProjectTickets, WorkspaceTicket } from './types.js'
import { parsePriority } from './ticket-priority.js'

// The /tickets filter model (#1144): everything the toolbar can express, as one plain value the
// page owns and the URL carries. Pure functions over in-memory rows — the whole backlog is already
// client-side on one poll, so filtering is instant and the server knows nothing about it.

/** One cross-project row: a ticket plus the project it belongs to, the unit every filter sees. */
export interface TicketRow {
  projectId: string
  projectName: string
  ticket: WorkspaceTicket
}

/** Every project's tickets as one flat pool — what the filters, counts, and flat mode work on. */
export function flattenTickets(groups: ProjectTickets[]): TicketRow[] {
  return groups.flatMap(g => g.tickets.map(ticket => ({ projectId: g.projectId, projectName: g.projectName, ticket })))
}

/** A named span on a 0-10 scale, the quick way to filter a numeric field. */
export interface RangeBucket {
  id: string
  label: string
  min: number
  max: number
}

// The priority buckets follow priorityTone's thresholds (red ≥8, amber ≥5), so the filter's idea
// of "critical" is the same one the rows already colour.
export const PRIORITY_BUCKETS: readonly RangeBucket[] = [
  { id: 'critical', label: 'Critical', min: 8, max: 10 },
  { id: 'medium', label: 'Medium', min: 5, max: 7 },
  { id: 'low', label: 'Low', min: 0, max: 4 },
]

// Effort/uncertainty are the plan preamble's 0-10 keys (0 trivial/obvious, 10 months/unclear).
export const EFFORT_BUCKETS: readonly RangeBucket[] = [
  { id: 'trivial', label: 'Trivial', min: 0, max: 2 },
  { id: 'moderate', label: 'Moderate', min: 3, max: 5 },
  { id: 'large', label: 'Large', min: 6, max: 10 },
]

export const UNCERTAINTY_BUCKETS: readonly RangeBucket[] = [
  { id: 'low', label: 'Low', min: 0, max: 2 },
  { id: 'medium', label: 'Medium', min: 3, max: 5 },
  { id: 'high', label: 'High', min: 6, max: 10 },
]

/**
 * The numeric facets, by the name the filters and the address give each: where it reads its
 * value on a ticket, and its quick buckets. Filtering, counting, sorting and the URL all go
 * through this, so a facet is read the same way everywhere.
 */
export const RANGE_FACETS = {
  priority: { value: (t: WorkspaceTicket) => parsePriority(t.priority), buckets: PRIORITY_BUCKETS },
  effort: { value: (t: WorkspaceTicket) => t.effort, buckets: EFFORT_BUCKETS },
  uncertainty: { value: (t: WorkspaceTicket) => t.uncertainty, buckets: UNCERTAINTY_BUCKETS },
}

export type RangeFacetId = keyof typeof RANGE_FACETS

const RANGE_FACET_IDS = Object.keys(RANGE_FACETS) as RangeFacetId[]

/**
 * One numeric facet's selection: named buckets (unioned), a fine-grained min-max range, and the
 * tickets that name no value at all. Buckets and the range are two ways to say the same thing, so
 * the update helpers keep them mutually exclusive; `none` composes with either — "critical OR
 * unprioritized" is a real triage lens.
 */
export interface RangeFilter {
  buckets: string[]
  range: [number, number] | null
  none: boolean
}

/** The pipeline states a ticket can be filtered by. Claimed means an agent holds its `.lock.md` —
 *  planning it or implementing it directly — and composes with planned rather than excluding it. */
export type StageId = 'unplanned' | 'planned' | 'claimed'

export const STAGES: readonly { id: StageId; label: string }[] = [
  { id: 'unplanned', label: 'Unplanned' },
  { id: 'planned', label: 'Planned' },
  { id: 'claimed', label: 'Claimed' },
]

/** Everything the toolbar can express. OR within a facet, AND across facets. */
export interface TicketFilters {
  /** Case-insensitive search; every whitespace-separated word must match somewhere in the
   *  title, summary, filename, or topics. */
  q: string
  priority: RangeFilter
  effort: RangeFilter
  uncertainty: RangeFilter
  /** Selected topics, lowercase (topic matching is case-insensitive: `UX` and `ux` are one). */
  topics: string[]
  /** Include tickets that name no topics at all. */
  topicsNone: boolean
  stage: StageId[]
  /** Only tickets with no issue link — the locally written ones. */
  unlinked: boolean
}

export type SortKey = 'date' | 'priority' | 'title' | 'effort'
export type SortDir = 'asc' | 'desc'
export interface TicketSort {
  key: SortKey
  dir: SortDir
}

/** Project sections (the default), or one flat cross-project list — the only view that can answer
 *  "what is the single highest-priority ticket anywhere". */
export type GroupBy = 'project' | 'none'

/** The page's whole viewing state: filters, sort, grouping. What the URL carries. */
export interface TicketsView {
  filters: TicketFilters
  sort: TicketSort
  group: GroupBy
}

const INACTIVE_RANGE: RangeFilter = { buckets: [], range: null, none: false }

export function defaultView(): TicketsView {
  return {
    filters: {
      q: '',
      priority: { ...INACTIVE_RANGE },
      effort: { ...INACTIVE_RANGE },
      uncertainty: { ...INACTIVE_RANGE },
      topics: [],
      topicsNone: false,
      stage: [],
      unlinked: false,
    },
    sort: { key: 'date', dir: 'desc' },
    group: 'project',
  }
}

/** Whether any filter is active — what the Clear-all affordance keys off. Sort/group are a view
 *  preference, not a filter: they reorder, never hide. */
export function hasAnyFilter(f: TicketFilters): boolean {
  return (
    f.q.trim() !== '' ||
    RANGE_FACET_IDS.some(facet => rangeClauses(f[facet]) > 0) ||
    f.topics.length > 0 ||
    f.topicsNone ||
    f.stage.length > 0 ||
    f.unlinked
  )
}

/** How many clauses a numeric facet's selection holds — its buckets, its range, its `none` — what
 *  its trigger's badge counts. None is no filter at all. */
export function rangeClauses(f: RangeFilter): number {
  return f.buckets.length + (f.range ? 1 : 0) + (f.none ? 1 : 0)
}

/** A ticket's topics, lowercased — the one casing both matching and the facet list use. */
function normalTopics(ticket: WorkspaceTicket): string[] {
  return (ticket.topics ?? []).map(t => t.toLowerCase())
}

/** A ticket against one numeric facet's selection: inactive passes everything; a missing value only
 *  passes on `none`; a present one passes any selected bucket or the range (both inclusive). */
function matchesRange(ticket: WorkspaceTicket, filter: RangeFilter, facet: RangeFacetId): boolean {
  if (rangeClauses(filter) === 0) return true
  const value = RANGE_FACETS[facet].value(ticket)
  if (value === undefined) return filter.none
  if (filter.buckets.some(id => inBucket(value, id, RANGE_FACETS[facet].buckets))) return true
  return filter.range !== null && value >= filter.range[0] && value <= filter.range[1]
}

function inBucket(value: number, id: string, buckets: readonly RangeBucket[]): boolean {
  const bucket = buckets.find(b => b.id === id)
  return bucket !== undefined && value >= bucket.min && value <= bucket.max
}

function matchesStage(ticket: WorkspaceTicket, stage: StageId): boolean {
  if (stage === 'unplanned') return !ticket.planned
  if (stage === 'planned') return ticket.planned
  return ticket.locked === true
}

function matchesQuery(row: TicketRow, q: string): boolean {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const haystack = [row.ticket.title, row.ticket.summary, row.ticket.file, ...normalTopics(row.ticket)].join(' ').toLowerCase()
  return words.every(word => haystack.includes(word))
}

/** The whole predicate: AND across facets, OR within each. */
function matchesFilters(row: TicketRow, f: TicketFilters): boolean {
  const t = row.ticket
  if (!matchesQuery(row, f.q)) return false
  if (!RANGE_FACET_IDS.every(facet => matchesRange(t, f[facet], facet))) return false
  if (f.topics.length > 0 || f.topicsNone) {
    const topics = normalTopics(t)
    const hit = f.topics.some(topic => topics.includes(topic)) || (f.topicsNone && topics.length === 0)
    if (!hit) return false
  }
  if (f.stage.length > 0 && !f.stage.some(stage => matchesStage(t, stage))) return false
  if (f.unlinked && t.issue !== undefined) return false
  return true
}

export function filterRows(rows: TicketRow[], f: TicketFilters): TicketRow[] {
  return rows.filter(row => matchesFilters(row, f))
}

// Where each sort key reads its value. A missing value sorts last in BOTH directions: "Priority ↑"
// must not bury the list under the unprioritized tickets it is trying to rank.
function sortValue(row: TicketRow, key: SortKey): number | string | undefined {
  if (key === 'date') return row.ticket.date
  if (key === 'title') return row.ticket.title.toLowerCase()
  // Priority and effort sort by the very values their facets filter on.
  return RANGE_FACETS[key].value(row.ticket)
}

/** Ordered copy: by the sort key with missing-last, ties falling back to newest-first — the one
 *  tiebreak that means the same thing for every ticket (#1265). */
export function sortRows(rows: TicketRow[], sort: TicketSort): TicketRow[] {
  const dir = sort.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const va = sortValue(a, sort.key)
    const vb = sortValue(b, sort.key)
    if (va !== vb) {
      if (va === undefined) return 1
      if (vb === undefined) return -1
      const diff = typeof va === 'string' ? va.localeCompare(vb as string) : va - (vb as number)
      if (diff !== 0) return diff * dir
    }
    return b.ticket.date.localeCompare(a.ticket.date)
  })
}

/** How a key sorts when first picked: newest/highest-first for date and priority, A-Z and
 *  easiest-first for title and effort. */
const DEFAULT_DIR: Record<SortKey, SortDir> = { date: 'desc', priority: 'desc', title: 'asc', effort: 'asc' }

/** The sort a freshly picked key starts at — its own natural direction. Direction changes are the
 *  menu's explicit asc/desc pair, not a hidden re-click. */
export function sortByKey(key: SortKey): TicketSort {
  return { key, dir: DEFAULT_DIR[key] }
}

/**
 * The single contiguous span a bucket selection covers, or null when it covers none — or when the
 * selection skips a middle bucket, which no one [min,max] pair can express. The slider mirrors the
 * union when this returns one, and dims when it cannot (#1144 follow-up).
 */
export function bucketUnionRange(filter: RangeFilter, buckets: readonly RangeBucket[]): [number, number] | null {
  const spans = buckets.filter(b => filter.buckets.includes(b.id)).sort((a, b) => a.min - b.min)
  if (spans.length === 0) return null
  for (let i = 1; i < spans.length; i++) {
    if (spans[i]!.min > spans[i - 1]!.max + 1) return null
  }
  return [spans[0]!.min, spans[spans.length - 1]!.max]
}

// Bucket and slider drive the same selection, so engaging one clears the other — two half-active
// inputs disagreeing about the range is the state this rules out. `none` survives both.

export function withBucketToggled(f: RangeFilter, id: string): RangeFilter {
  return { buckets: toggled(f.buckets, id), range: null, none: f.none }
}

export function withRange(f: RangeFilter, range: [number, number] | null): RangeFilter {
  return { buckets: [], range, none: f.none }
}

export function withNone(f: RangeFilter, none: boolean): RangeFilter {
  return { ...f, none }
}

export function toggled(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter(v => v !== value) : [...list, value]
}

/**
 * Per-option counts for one facet, computed with every OTHER filter applied but this facet's own
 * selection ignored — so an option always answers "how many rows would this show under the current
 * other constraints", instead of every unselected option collapsing to 0 the moment one is picked.
 */
function rowsForFacet(rows: TicketRow[], f: TicketFilters, patch: Partial<TicketFilters>): TicketRow[] {
  return filterRows(rows, { ...f, ...patch })
}

export interface RangeFacetCounts {
  buckets: Record<string, number>
  none: number
}

export function rangeFacetCounts(rows: TicketRow[], f: TicketFilters, facet: RangeFacetId): RangeFacetCounts {
  const pool = rowsForFacet(rows, f, { [facet]: { ...INACTIVE_RANGE } })
  const { value, buckets } = RANGE_FACETS[facet]
  const counts: Record<string, number> = {}
  for (const bucket of buckets) {
    counts[bucket.id] = pool.filter(r => {
      const v = value(r.ticket)
      return v !== undefined && v >= bucket.min && v <= bucket.max
    }).length
  }
  return { buckets: counts, none: pool.filter(r => value(r.ticket) === undefined).length }
}

/** Topic options with counts (self-facet excluded), most common first so the busy tags lead. */
export function topicFacetCounts(rows: TicketRow[], f: TicketFilters): { topics: [string, number][]; none: number } {
  const pool = rowsForFacet(rows, f, { topics: [], topicsNone: false })
  const counts = new Map<string, number>()
  for (const row of pool) {
    for (const topic of new Set(normalTopics(row.ticket))) counts.set(topic, (counts.get(topic) ?? 0) + 1)
  }
  // Selected topics stay listed even when the other filters leave them at 0, or they could not be unpicked.
  for (const topic of f.topics) if (!counts.has(topic)) counts.set(topic, 0)
  const topics = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  return { topics, none: pool.filter(r => normalTopics(r.ticket).length === 0).length }
}

export function stageFacetCounts(rows: TicketRow[], f: TicketFilters): Record<StageId, number> {
  const pool = rowsForFacet(rows, f, { stage: [] })
  return {
    unplanned: pool.filter(r => matchesStage(r.ticket, 'unplanned')).length,
    planned: pool.filter(r => matchesStage(r.ticket, 'planned')).length,
    claimed: pool.filter(r => matchesStage(r.ticket, 'claimed')).length,
  }
}

export function unlinkedCount(rows: TicketRow[], f: TicketFilters): number {
  return rowsForFacet(rows, f, { unlinked: false }).filter(r => r.ticket.issue === undefined).length
}

// ---- The URL codec (#784's doctrine: the URL is the selection — filters are selection too). ----
// `/tickets?q=lock&priority=critical,none&stage=unplanned&sort=priority` is shareable, reloadable,
// and survives opening a ticket and coming back. Defaults are omitted so the bare page stays `/tickets`.

const RANGE_TOKEN = /^(\d{1,2})-(\d{1,2})$/

function parseRangeFilter(raw: string | null, buckets: readonly RangeBucket[]): RangeFilter {
  const filter: RangeFilter = { ...INACTIVE_RANGE }
  if (!raw) return filter
  for (const token of raw.split(',')) {
    if (token === 'none') filter.none = true
    else if (buckets.some(b => b.id === token)) filter.buckets = [...filter.buckets, token]
    else {
      const range = RANGE_TOKEN.exec(token)
      if (range) {
        const [min, max] = [Number(range[1]), Number(range[2])]
        if (min <= max && max <= 10) filter.range = [min, max]
      }
      // Anything else in a hand-typed URL is ignored, not an error.
    }
  }
  return filter
}

function formatRangeFilter(f: RangeFilter): string {
  const tokens = [...f.buckets]
  if (f.range) tokens.push(`${f.range[0]}-${f.range[1]}`)
  if (f.none) tokens.push('none')
  return tokens.join(',')
}

const SORT_KEYS: readonly SortKey[] = ['date', 'priority', 'title', 'effort']

/** The view a query string carries. Tolerant: junk params and junk tokens read as defaults. */
export function parseTicketsView(search: string): TicketsView {
  const params = new URLSearchParams(search)
  const view = defaultView()
  view.filters.q = params.get('q') ?? ''
  for (const facet of RANGE_FACET_IDS) view.filters[facet] = parseRangeFilter(params.get(facet), RANGE_FACETS[facet].buckets)
  const topics = (params.get('topics') ?? '').split(',').filter(Boolean)
  // `none` is a reserved token, not a topic name — same word the numeric facets use.
  view.filters.topicsNone = topics.includes('none')
  view.filters.topics = topics.filter(t => t !== 'none').map(t => t.toLowerCase())
  view.filters.stage = (params.get('stage') ?? '')
    .split(',')
    .filter((s): s is StageId => STAGES.some(stage => stage.id === s))
  view.filters.unlinked = params.get('issue') === 'none'
  const sortKey = params.get('sort')
  if (sortKey && SORT_KEYS.includes(sortKey as SortKey)) view.sort.key = sortKey as SortKey
  const dir = params.get('dir')
  view.sort.dir = dir === 'asc' || dir === 'desc' ? dir : DEFAULT_DIR[view.sort.key]
  if (params.get('group') === 'none') view.group = 'none'
  return view
}

/** The query parameters a view is written in; every other parameter of the address is someone else's. */
const VIEW_PARAMS = ['q', 'priority', 'effort', 'uncertainty', 'topics', 'stage', 'issue', 'sort', 'dir', 'group'] as const

/**
 * The query string (no leading `?`) for a view; nothing of the view when everything is at its
 * default. `search` is the address's current query: the parameters in it that are not the view's
 * (the dashboard's picked project) are kept as they are.
 */
export function formatTicketsView(view: TicketsView, search = ''): string {
  const params = new URLSearchParams(search)
  for (const name of VIEW_PARAMS) params.delete(name)
  const f = view.filters
  if (f.q.trim()) params.set('q', f.q.trim())
  for (const facet of RANGE_FACET_IDS) {
    const value = formatRangeFilter(f[facet])
    if (value) params.set(facet, value)
  }
  const topics = [...f.topics, ...(f.topicsNone ? ['none'] : [])]
  if (topics.length) params.set('topics', topics.join(','))
  if (f.stage.length) params.set('stage', f.stage.join(','))
  if (f.unlinked) params.set('issue', 'none')
  if (view.sort.key !== 'date') params.set('sort', view.sort.key)
  if (view.sort.dir !== DEFAULT_DIR[view.sort.key]) params.set('dir', view.sort.dir)
  if (view.group === 'none') params.set('group', 'none')
  return params.toString()
}
