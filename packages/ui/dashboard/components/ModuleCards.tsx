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
  /** A part of the line under the Overview's title, not a card. */
  line?: boolean
}

/**
 * The views the installed modules put on the Overview (#1818, #2394), for it to lay out: its
 * cards (`overview.card`) and the parts of the line under its title (`overview.line`), each in its
 * own slot, given the projects that have its package, in the order the shell mounted them (by
 * `order`, then package). A project's view is listed only when one of the projects handed in has
 * its package: with one project picked, the views of the packages that project does not have are
 * not, and before the projects are first read none is. A view of this computer's (its devices) is
 * always listed. Each is known by its package and its own id. `loaded` once every package's code is in.
 */
export function useModuleCards(projects: ProjectSummary[]): { cards: OverviewCard[]; line: OverviewCard[]; loaded: boolean } {
  const { views, loaded } = useMountedModules()
  const listed = [...views['overview.card'], ...views['overview.line']].flatMap(view => {
    const View = view.View
    // A view of this computer's is about the computer: it is on every Overview, given every project shown.
    const having = view.computer ? projectsHaving(projects.map(project => project.id), projects) : projectsHaving(view.projects, projects)
    if (having.length === 0 && !view.computer) return []
    const line = view.place === 'overview.line'
    return [
      {
        id: `${view.package}/${view.id}`,
        label: view.label,
        order: view.order ?? 50,
        width: (!line && view.width) || '1/2',
        minWidth: (!line && view.minWidth) || '1/3',
        line,
        node: (
          <ModuleSlot package={view.package} label={`${view.id} card`}>
            <View projects={having} />
          </ModuleSlot>
        ),
      },
    ]
  })
  return { cards: listed.filter(card => !card.line), line: listed.filter(card => card.line), loaded }
}
