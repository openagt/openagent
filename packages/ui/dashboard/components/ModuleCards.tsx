import { useEffect, useState, type ReactNode } from 'react'
import type { CardWidth, ProjectSummary } from '../../src/index.js'
import { CARD_WIDTHS } from '../../src/client.js'
import { useMountedModules } from '../lib/use-modules.js'
import { projectsHaving, ModuleSlot } from './ModulePageView.js'
import { NEEDS_YOU_ID } from './LinePart.js'
import { SentenceShape } from './ui/slot.js'

/** One card for the Overview to lay out: its id, its name, its widths, and the card itself. */
export interface OverviewCard {
  id: string
  label: string
  /** Its place until a layout names it, lower first: the Overview's own tiles first, then its own cards, then the packages' (50 when unsaid). */
  order: number
  width: CardWidth
  minWidth: CardWidth
  node: ReactNode
  /** What it shows was read by an earlier visit, not yet again: it is drawn faded. A read inside the card says so of itself. */
  stale?: boolean
  /** A part of the line under the Overview's title, not a card. */
  line?: boolean
  /** The card of what needs the person (`needsYou`): the first steps stand under it, and the line's count of what waits scrolls to it. */
  needsYou?: boolean
  /** Its package's code is not in yet: the room the last load's card of what needs the person took, held for it. */
  holding?: boolean
}

/** Where this browser keeps the card of what needs the person as the last load drew it, for the next load's first frame. */
const NEEDS_YOU_KEY = 'openagent:needs-you-card'

/** The card of what needs the person as a load keeps it: where it stands and how wide. */
type KeptCard = Pick<OverviewCard, 'id' | 'label' | 'order' | 'width' | 'minWidth'>

/**
 * The views the installed modules put on the Overview (#1818, #2394), for it to lay out: its
 * cards (`overview.card`) and the parts of the line under its title (`overview.line`), each in its
 * own slot, given the projects that have its package, in the order the shell mounted them (by
 * `order`, then package). A project's view is listed only when one of the projects handed in has
 * its package: with one project picked, the views of the packages that project does not have are
 * not, and before the projects are first read none is. A view of this computer's package is
 * always listed. Each is known by its package and its own id. `loaded` once every package's code is in.
 */
export function useModuleCards(projects: ProjectSummary[]): { cards: OverviewCard[]; line: OverviewCard[]; loaded: boolean } {
  const { views, loaded } = useMountedModules()
  // The first card that says it is of what needs the person is the one.
  let needsYouTaken = false
  const listed = [...views['overview.card'], ...views['overview.line']].flatMap(view => {
    const View = view.View
    // A view of this computer's is about the computer: it is on every Overview, given every project shown.
    const having = view.computer ? projectsHaving(projects.map(project => project.id), projects) : projectsHaving(view.projects, projects)
    if (having.length === 0 && !view.computer) return []
    const line = view.place === 'overview.line'
    const needsYou = !needsYouTaken && view.place === 'overview.card' && view.needsYou === true
    if (needsYou) needsYouTaken = true
    const slot = (
      <ModuleSlot package={view.package} label={`${view.id} card`}>
        <View projects={having} />
      </ModuleSlot>
    )
    return [
      {
        id: `${view.package}/${view.id}`,
        label: view.label,
        order: view.order ?? 50,
        width: (!line && view.width) || '1/2',
        minWidth: (!line && view.minWidth) || '1/3',
        line,
        ...(needsYou ? { needsYou } : {}),
        node: needsYou ? (
          <div id={NEEDS_YOU_ID} className="flex scroll-mt-6 flex-col *:flex-1">
            {slot}
          </div>
        ) : (
          slot
        ),
      },
    ]
  })
  const cards = listed.filter(card => !card.line)
  const needsYou = cards.find(card => card.needsYou)
  // Until every package's code is in, the card of what needs the person the last load drew holds its
  // room, first as it stood: coming in later, it would push down every card of the page.
  const [kept] = useState(readKeptCard)
  const keeps = needsYou && { id: needsYou.id, label: needsYou.label, order: needsYou.order, width: needsYou.width, minWidth: needsYou.minWidth }
  const keptNow = keeps ? JSON.stringify(keeps) : undefined
  useEffect(() => {
    if (!loaded) return
    try {
      if (keptNow === undefined) globalThis.localStorage?.removeItem(NEEDS_YOU_KEY)
      else globalThis.localStorage?.setItem(NEEDS_YOU_KEY, keptNow)
    } catch {
      // No room, or no storage: the next load draws the card once its code is in.
    }
  }, [keptNow, loaded])
  const held: OverviewCard[] =
    !loaded && !needsYou && kept
      ? [
          {
            ...kept,
            needsYou: true,
            holding: true,
            node: (
              <div id={NEEDS_YOU_ID} className="flex scroll-mt-6 flex-col *:flex-1">
                <SentenceShape />
              </div>
            ),
          },
        ]
      : []
  return { cards: [...cards, ...held], line: listed.filter(card => card.line), loaded }
}

/** The modules' notices (`overview.notice`), each in its slot, given the projects shown that have its package: news of this computer, such as a coding agent's newer version. */
export function OverviewNotices({ projects }: { projects: ProjectSummary[] }) {
  const { views } = useMountedModules()
  return (
    <>
      {views['overview.notice'].map(view => {
        const View = view.View
        const having = view.computer ? projectsHaving(projects.map(project => project.id), projects) : projectsHaving(view.projects, projects)
        if (having.length === 0 && !view.computer) return null
        return (
          <ModuleSlot key={`${view.package}/${view.id}`} package={view.package} label={`${view.id} notice`}>
            <View projects={having} />
          </ModuleSlot>
        )
      })}
    </>
  )
}

function readKeptCard(): KeptCard | undefined {
  try {
    const kept: unknown = JSON.parse(globalThis.localStorage?.getItem(NEEDS_YOU_KEY) ?? 'null')
    if (!kept || typeof kept !== 'object') return undefined
    const { id, label, order, width, minWidth } = kept as Record<string, unknown>
    const isWidth = (value: unknown): value is CardWidth => typeof value === 'string' && (CARD_WIDTHS as readonly string[]).includes(value)
    return typeof id === 'string' && typeof label === 'string' && typeof order === 'number' && isWidth(width) && isWidth(minWidth) ? { id, label, order, width, minWidth } : undefined
  } catch {
    return undefined
  }
}
