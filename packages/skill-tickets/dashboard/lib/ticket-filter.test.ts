import { describe, expect, test } from 'vitest'
import type { WorkspaceTicket } from './types.js'
import {
  PRIORITY_BUCKETS,
  bucketUnionRange,
  defaultView,
  filterRows,
  flattenTickets,
  formatTicketsView,
  hasAnyFilter,
  parseTicketsView,
  rangeFacetCounts,
  sortByKey,
  sortRows,
  stageFacetCounts,
  topicFacetCounts,
  unlinkedCount,
  withBucketToggled,
  withNone,
  withRange,
  type TicketRow,
  type TicketsView,
} from './ticket-filter.js'

const ticket = (file: string, over: Partial<WorkspaceTicket> = {}): WorkspaceTicket => ({
  file,
  title: file.replace('.md', ''),
  summary: '',
  date: '2026-01-01T00:00:00.000Z',
  planned: false,
  ...over,
})

const row = (file: string, over: Partial<WorkspaceTicket> = {}, projectId = 'p1'): TicketRow => ({
  projectId,
  projectName: projectId,
  ticket: ticket(file, over),
})

const filtersWith = (patch: Partial<TicketsView['filters']>) => ({ ...defaultView().filters, ...patch })

describe('flattenTickets', () => {
  test('pools every project into rows that remember where they came from', () => {
    const rows = flattenTickets([
      { projectId: 'a', projectName: 'Alpha', tickets: [ticket('a1.md')] },
      { projectId: 'b', projectName: 'Beta', tickets: [ticket('b1.md'), ticket('b2.md')] },
    ])
    expect(rows.map(r => [r.projectId, r.ticket.file])).toEqual([
      ['a', 'a1.md'],
      ['b', 'b1.md'],
      ['b', 'b2.md'],
    ])
  })
})

describe('search (q)', () => {
  test('matches case-insensitively across title, summary, filename, and topics — every word', () => {
    const rows = [
      row('2026-07-31_improve-lock.md', { title: 'Improve the lock mechanism', summary: 'Locks are racy.' }),
      row('other.md', { title: 'Something else', topics: ['Locks'] }),
      row('nope.md', { title: 'Unrelated' }),
    ]
    expect(filterRows(rows, filtersWith({ q: 'lock' })).map(r => r.ticket.file)).toEqual(['2026-07-31_improve-lock.md', 'other.md'])
    // Both words must land (AND), wherever each of them lands.
    expect(filterRows(rows, filtersWith({ q: 'lock racy' })).map(r => r.ticket.file)).toEqual(['2026-07-31_improve-lock.md'])
    expect(filterRows(rows, filtersWith({ q: '  ' }))).toHaveLength(3)
  })
})

describe('priority facet (buckets + range + none)', () => {
  const rows = [row('crit.md', { priority: '9' }), row('mid.md', { priority: '5' }), row('low.md', { priority: '1' }), row('bare.md')]

  test('a bucket selects its span; none selects the unprioritized; both OR together', () => {
    const buckets = filtersWith({ priority: { buckets: ['critical'], range: null, none: false } })
    expect(filterRows(rows, buckets).map(r => r.ticket.file)).toEqual(['crit.md'])
    const withNoneToo = filtersWith({ priority: { buckets: ['critical'], range: null, none: true } })
    expect(filterRows(rows, withNoneToo).map(r => r.ticket.file)).toEqual(['crit.md', 'bare.md'])
  })

  test('a range is inclusive and never admits a ticket that names no value', () => {
    const f = filtersWith({ priority: { buckets: [], range: [5, 9], none: false } })
    expect(filterRows(rows, f).map(r => r.ticket.file)).toEqual(['crit.md', 'mid.md'])
  })

  test('the update helpers keep buckets and range mutually exclusive, none independent', () => {
    let f = { buckets: [], range: null, none: false } as ReturnType<typeof withNone>
    f = withBucketToggled(f, 'critical')
    f = withNone(f, true)
    expect(f).toEqual({ buckets: ['critical'], range: null, none: true })
    f = withRange(f, [2, 6])
    expect(f).toEqual({ buckets: [], range: [2, 6], none: true })
    f = withBucketToggled(f, 'low')
    expect(f).toEqual({ buckets: ['low'], range: null, none: true })
  })
})

describe('stage facet', () => {
  const rows = [
    row('un.md'),
    row('planned.md', { planned: true }),
    row('claimed.md', { locked: true }),
    row('both.md', { planned: true, locked: true }),
  ]

  test('unplanned/planned split on the plan; claimed is the lock, composing with planned', () => {
    expect(filterRows(rows, filtersWith({ stage: ['unplanned'] })).map(r => r.ticket.file)).toEqual(['un.md', 'claimed.md'])
    expect(filterRows(rows, filtersWith({ stage: ['claimed'] })).map(r => r.ticket.file)).toEqual(['claimed.md', 'both.md'])
    // OR within the facet.
    expect(filterRows(rows, filtersWith({ stage: ['planned', 'claimed'] }))).toHaveLength(3)
  })
})

describe('topics facet', () => {
  test('matches case-insensitively (UX and ux are one topic) and none selects the topicless', () => {
    const rows = [row('a.md', { topics: ['UX'] }), row('b.md', { topics: ['ux', 'dx'] }), row('c.md')]
    expect(filterRows(rows, filtersWith({ topics: ['ux'] })).map(r => r.ticket.file)).toEqual(['a.md', 'b.md'])
    expect(filterRows(rows, filtersWith({ topicsNone: true })).map(r => r.ticket.file)).toEqual(['c.md'])
  })
})

describe('unlinked facet', () => {
  test('unlinked keeps only tickets with no issue link', () => {
    const rows = [
      row('a.md', { issue: { label: '#1', url: 'https://x/1' } }, 'p1'),
      row('b.md', {}, 'p2'),
    ]
    expect(filterRows(rows, filtersWith({ unlinked: true })).map(r => r.ticket.file)).toEqual(['b.md'])
  })
})

describe('sortRows', () => {
  const rows = [
    row('old-high.md', { priority: '8', date: '2026-01-01T00:00:00.000Z' }),
    row('new-low.md', { priority: '2', date: '2026-03-01T00:00:00.000Z' }),
    row('bare.md', { date: '2026-02-01T00:00:00.000Z' }),
  ]

  test('sorts by the key with direction; a missing value is last in BOTH directions', () => {
    expect(sortRows(rows, { key: 'priority', dir: 'desc' }).map(r => r.ticket.file)).toEqual(['old-high.md', 'new-low.md', 'bare.md'])
    expect(sortRows(rows, { key: 'priority', dir: 'asc' }).map(r => r.ticket.file)).toEqual(['new-low.md', 'old-high.md', 'bare.md'])
  })

  test('ties fall back to newest-first', () => {
    const tied = [
      row('older.md', { priority: '5', date: '2026-01-01T00:00:00.000Z' }),
      row('newer.md', { priority: '5', date: '2026-02-01T00:00:00.000Z' }),
    ]
    expect(sortRows(tied, { key: 'priority', dir: 'desc' }).map(r => r.ticket.file)).toEqual(['newer.md', 'older.md'])
  })

  test('sortByKey starts each key at its natural direction', () => {
    expect(sortByKey('date')).toEqual({ key: 'date', dir: 'desc' })
    expect(sortByKey('priority')).toEqual({ key: 'priority', dir: 'desc' })
    expect(sortByKey('title')).toEqual({ key: 'title', dir: 'asc' })
    expect(sortByKey('effort')).toEqual({ key: 'effort', dir: 'asc' })
  })
})

describe('bucketUnionRange', () => {
  const f = (buckets: string[]) => ({ buckets, range: null, none: false })

  test('a single bucket or an adjacent pair is one span; skipping the middle is not', () => {
    expect(bucketUnionRange(f(['critical']), PRIORITY_BUCKETS)).toEqual([8, 10])
    expect(bucketUnionRange(f(['medium', 'critical']), PRIORITY_BUCKETS)).toEqual([5, 10])
    expect(bucketUnionRange(f(['low', 'medium', 'critical']), PRIORITY_BUCKETS)).toEqual([0, 10])
    // Critical ∪ Low skips Medium — no [min,max] pair can say that.
    expect(bucketUnionRange(f(['critical', 'low']), PRIORITY_BUCKETS)).toBeNull()
    expect(bucketUnionRange(f([]), PRIORITY_BUCKETS)).toBeNull()
  })
})

describe('facet counts', () => {
  const rows = [
    row('crit.md', { priority: '9', topics: ['dx'] }),
    row('low.md', { priority: '1', topics: ['UX'] }),
    row('bare.md', { locked: true }),
  ]

  test('counts every option with the OTHER facets applied but its own facet ignored', () => {
    // With the dx topic selected, priority counts still cover only dx rows…
    const f = filtersWith({ topics: ['dx'] })
    const priority = rangeFacetCounts(rows, f, 'priority')
    expect(priority.buckets['critical']).toBe(1)
    expect(priority.buckets['low']).toBe(0)
    // …while topic counts ignore the topic selection itself, so ux stays pickable.
    const topics = topicFacetCounts(rows, f)
    expect(topics.topics).toEqual([
      ['dx', 1],
      ['ux', 1],
    ])
    expect(topics.none).toBe(1)
  })

  test('stage and unlinked counts follow the same rule', () => {
    const f = filtersWith({ stage: ['claimed'] })
    expect(stageFacetCounts(rows, f)).toEqual({ unplanned: 3, planned: 0, claimed: 1 })
    expect(unlinkedCount(rows, f)).toBe(1)
  })

  test('effort none-counts come from the pool, so the option can be shown only when real', () => {
    const withEffort = [row('e.md', { effort: 1 }), row('none.md')]
    const counts = rangeFacetCounts(withEffort, defaultView().filters, 'effort')
    expect(counts.buckets['trivial']).toBe(1)
    expect(counts.none).toBe(1)
  })
})

describe('URL codec', () => {
  test('the default view is the empty query string', () => {
    expect(formatTicketsView(defaultView())).toBe('')
    expect(parseTicketsView('')).toEqual(defaultView())
  })

  test('round-trips a fully loaded view', () => {
    const view = defaultView()
    view.filters.q = 'lock races'
    view.filters.priority = { buckets: ['critical'], range: null, none: true }
    view.filters.effort = { buckets: [], range: [2, 6], none: false }
    view.filters.topics = ['dx', 'ux']
    view.filters.topicsNone = true
    view.filters.stage = ['unplanned', 'claimed']
    view.filters.unlinked = true
    view.sort = { key: 'priority', dir: 'asc' }
    view.group = 'none'
    expect(parseTicketsView(`?${formatTicketsView(view)}`)).toEqual(view)
  })

  test('parameters that are not the view\'s are kept as they are, and the view\'s own are replaced', () => {
    const view = defaultView()
    view.filters.q = 'races'
    expect(formatTicketsView(view, '?project=app-a1&q=old&stage=planned')).toBe('project=app-a1&q=races')
    expect(formatTicketsView(defaultView(), '?project=app-a1&sort=title')).toBe('project=app-a1')
    // The dashboard's picked project is not a filter of the page's.
    expect(parseTicketsView('?project=app-a1')).toEqual(defaultView())
  })

  test('a hand-typed URL is input: junk tokens are dropped, not thrown at', () => {
    const view = parseTicketsView('?priority=banana,99-1,none&stage=weird&sort=nope&group=sideways')
    expect(view.filters.priority).toEqual({ buckets: [], range: null, none: true })
    expect(view.filters.stage).toEqual([])
    expect(view.sort).toEqual({ key: 'date', dir: 'desc' })
    expect(view.group).toBe('project')
  })

  test('sort defaults per key are omitted; a flipped direction is written', () => {
    const view = defaultView()
    view.sort = { key: 'priority', dir: 'desc' } // priority's own default direction
    expect(formatTicketsView(view)).toBe('sort=priority')
    view.sort = { key: 'date', dir: 'asc' }
    expect(formatTicketsView(view)).toBe('dir=asc')
    expect(parseTicketsView('?dir=asc').sort).toEqual({ key: 'date', dir: 'asc' })
  })

  test('hasAnyFilter sees filters, never sort or grouping', () => {
    const view = defaultView()
    view.sort = { key: 'title', dir: 'asc' }
    view.group = 'none'
    expect(hasAnyFilter(view.filters)).toBe(false)
    view.filters.q = 'x'
    expect(hasAnyFilter(view.filters)).toBe(true)
  })
})
