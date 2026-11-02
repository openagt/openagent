import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { ALL_PROJECTS, arrangeCards, sanitizeOverviewLayouts, widthsFor, type LayoutCard } from './overview-layout.js'

const cards: LayoutCard[] = [
  { id: 'summary', width: '1', minWidth: '1/2' },
  { id: 'queue', width: '1/2', minWidth: '1/3' },
  { id: 'tickets', width: '1/2', minWidth: '1/4' },
]
const ids = (arranged: ReturnType<typeof arrangeCards>) => arranged.map(({ card, width, hidden }) => `${card.id}:${width}${hidden ? ':hidden' : ''}`)

test('with no layout the cards stand in their own order and widths', () => {
  assert.deepEqual(ids(arrangeCards(cards, undefined, ALL_PROJECTS)), ['summary:1', 'queue:1/2', 'tickets:1/2'])
})

test('a layout orders, sizes and hides; a card it does not name comes after, shown at its own width; a name no card has is passed over', () => {
  const layouts = { [ALL_PROJECTS]: [{ id: 'tickets', width: '1/4' as const }, { id: 'gone' }, { id: 'summary', hidden: true as const }] }
  assert.deepEqual(ids(arrangeCards(cards, layouts, ALL_PROJECTS)), ['tickets:1/4', 'summary:1:hidden', 'queue:1/2'])
})

test('a width narrower than a card fits is not kept: the card stands at its own', () => {
  const layouts = { [ALL_PROJECTS]: [{ id: 'summary', width: '1/3' as const }, { id: 'queue', width: '1/4' as const }] }
  assert.deepEqual(ids(arrangeCards(cards, layouts, ALL_PROJECTS)), ['summary:1', 'queue:1/2', 'tickets:1/2'])
  assert.deepEqual(widthsFor({ minWidth: '1/3' }), ['1/3', '1/2', '2/3', '3/4', '1'])
})

test("a project's layout is its own; a project never arranged is laid out as all projects are", () => {
  const layouts = { [ALL_PROJECTS]: [{ id: 'queue' }], p1: [{ id: 'tickets' }] }
  assert.equal(arrangeCards(cards, layouts, 'p1')[0]!.card.id, 'tickets')
  assert.equal(arrangeCards(cards, layouts, 'p2')[0]!.card.id, 'queue')
})

test('only well-formed layouts are kept: a malformed place or a repeated card is dropped, an unknown width forgotten', () => {
  assert.deepEqual(sanitizeOverviewLayouts(null), {})
  assert.deepEqual(sanitizeOverviewLayouts(['*']), {})
  assert.deepEqual(
    sanitizeOverviewLayouts({ '*': [{ id: 'a', width: '1/2', hidden: true }, { id: 'a' }, { id: '' }, 'b', { id: 'c', width: '5/6', hidden: 'yes' }], p1: 'x', '': [] }),
    { '*': [{ id: 'a', hidden: true, width: '1/2' }, { id: 'c' }] },
  )
})
