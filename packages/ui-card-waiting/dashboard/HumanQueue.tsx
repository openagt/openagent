import { useMemo } from 'react'
import { FadeWhileStale, PanelGroup, PartDescription, SentenceShape, Slot, WaitingList, holdsBack, useModuleHost, useWaiting, type UiCardProps } from '@openagt/ui/module'

/**
 * What needs the person (#632/#1139): the things only a person can clear in the projects shown, as
 * the modules say them, a question to answer, a pull request to merge, work never committed or
 * published. One list, newest first as the shell gives them: a row says what is needed first in
 * its line, so the kinds need no heading of their own. A row about a run opens it; a request no run
 * here opened opens on its git host. Until what waits is read, by this visit or an earlier one, the
 * card waits in a sentence's room, not saying that nothing waits; while it is only an earlier
 * visit's, the card is faded.
 */
export function HumanQueue({ projects }: UiCardProps) {
  const host = useModuleHost()
  const { items, state } = useWaiting()
  const shown = useMemo(() => {
    const ids = new Set(projects.map(project => project.id))
    return items.filter(item => ids.has(item.projectId))
  }, [items, projects])
  return (
    <FadeWhileStale stale={state === 'kept'} className="flex flex-col *:flex-1">
      <PanelGroup bare title={<span className="text-warning">Human Queue</span>} count={holdsBack(shown) ? shown.length : undefined}>
        <PartDescription>Agents awaiting your approval, review, or input</PartDescription>
        <Slot of={{ state, value: shown }} shape={<SentenceShape />}>
          {() => <WaitingList items={shown} onOpenAgent={host.openAgent} empty="AI doesn't need you." />}
        </Slot>
      </PanelGroup>
    </FadeWhileStale>
  )
}
