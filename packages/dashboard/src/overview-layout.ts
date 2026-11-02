
// How the Overview lays out its cards: which show, in what order, how wide. A layout is kept per
// project and one for "All projects" (his pick); a project never arranged is laid out as all
// projects are, without the cards it does not have. A card a layout does not name (a package
// installed after it was saved) comes after the ones it names, shown, at its own width: a new
// card is seen. Node-free: the daemon keeps the layouts with the preferences, the page arranges by
// them.

/** How wide a card stands, as a share of the Overview's column. */
export const CARD_WIDTHS = ['1/4', '1/3', '1/2', '2/3', '3/4', '1'] as const
export type CardWidth = (typeof CARD_WIDTHS)[number]

/** One card's place in a layout: its id, and what was picked for it. */
export interface CardPlace {
  id: string
  /** Picked to be hidden. */
  hidden?: true
  /** Picked to stand at this width; its own default when unsaid. */
  width?: CardWidth
}

/** The layouts, by project id, and {@link ALL_PROJECTS} for the Overview of every project. */
export type OverviewLayouts = Record<string, CardPlace[]>

/** The key of the layout of the Overview of every project. */
export const ALL_PROJECTS = '*'

/** What a card says of itself to be laid out: its id, and the widths it stands at. */
export interface LayoutCard {
  id: string
  /** Its width until one is picked. */
  width: CardWidth
  /** The narrowest it fits: a narrower pick is not offered, and a saved one is not kept. */
  minWidth: CardWidth
}

const rank = (width: CardWidth): number => CARD_WIDTHS.indexOf(width)

/** The widths a card fits, narrowest first. */
export function widthsFor(card: Pick<LayoutCard, 'minWidth'>): CardWidth[] {
  return CARD_WIDTHS.filter(width => rank(width) >= rank(card.minWidth))
}

/**
 * The cards in their order, each with its width and whether it is hidden, by the layout of `key`
 * (else the all-projects one, else none): the cards it names first, in its order, then the rest in
 * their own. A name no card has any more is passed over.
 */
export function arrangeCards<C extends LayoutCard>(cards: readonly C[], layouts: OverviewLayouts | undefined, key: string): { card: C; width: CardWidth; hidden: boolean }[] {
  const places = layouts?.[key] ?? layouts?.[ALL_PROJECTS] ?? []
  const byId = new Map(cards.map(card => [card.id, card]))
  const named = places.flatMap(place => {
    const card = byId.get(place.id)
    if (!card) return []
    byId.delete(place.id)
    const width = place.width !== undefined && rank(place.width) >= rank(card.minWidth) ? place.width : card.width
    return [{ card, width, hidden: place.hidden === true }]
  })
  return [...named, ...[...byId.values()].map(card => ({ card, width: card.width, hidden: false }))]
}

/** Caps on what a layout keeps, so a hand-edited or browser-supplied one never fills the settings file. */
const MAX_LAYOUTS = 200
const MAX_CARDS = 50
const MAX_ID = 200

/** Keep only well-formed layouts: string keys, each a list of places with a card id; a malformed place is dropped, not thrown. */
export function sanitizeOverviewLayouts(value: unknown): OverviewLayouts {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const out: OverviewLayouts = {}
  for (const [key, list] of Object.entries(value).slice(0, MAX_LAYOUTS)) {
    if (!key || key.length > MAX_ID || !Array.isArray(list)) continue
    const seen = new Set<string>()
    const places: CardPlace[] = []
    for (const raw of list.slice(0, MAX_CARDS)) {
      if (typeof raw !== 'object' || raw === null) continue
      const { id, hidden, width } = raw as Record<string, unknown>
      if (typeof id !== 'string' || !id || id.length > MAX_ID || seen.has(id)) continue
      seen.add(id)
      places.push({ id, ...(hidden === true ? { hidden: true as const } : {}), ...((CARD_WIDTHS as readonly unknown[]).includes(width) ? { width: width as CardWidth } : {}) })
    }
    out[key] = places
  }
  return out
}
