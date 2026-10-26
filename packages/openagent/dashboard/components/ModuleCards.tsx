import type { ReactNode } from 'react'
import type { CardWidth, ProjectSummary } from '../../src/index.js'
import { useMountedModules } from '../lib/use-modules.js'
import { projectsHaving, ModuleSlot } from './ModulePageView.js'

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
}

/**
 * The cards the installed packages declare (#1818), for the Overview to lay out: each in its own
 * slot, given the projects that have its package, in the order the shell mounted them (by `order`,
 * then package). A project's card is listed only when one of the projects handed in has its
 * package: with one project picked, the cards of the packages that project does not have are not,
 * and before the projects are first read none is. A card of this computer's (its devices) is
 * always listed. Each is known by its package and its own id.
 */
export function useModuleCards(projects: ProjectSummary[]): OverviewCard[] {
  const { cards } = useMountedModules()
  return cards.flatMap(card => {
    const Card = card.Card
    // A card of this computer's is about the computer: it is on every Overview, given every project shown.
    const having = card.computer ? projectsHaving(projects.map(project => project.id), projects) : projectsHaving(card.projects, projects)
    if (having.length === 0 && !card.computer) return []
    return [
      {
        id: `${card.package}/${card.id}`,
        label: card.label,
        order: card.order ?? 50,
        width: card.width ?? '1/2',
        minWidth: card.minWidth ?? '1/3',
        node: (
          <ModuleSlot package={card.package} label={`${card.id} card`}>
            <Card projects={having} />
          </ModuleSlot>
        ),
      },
    ]
  })
}
