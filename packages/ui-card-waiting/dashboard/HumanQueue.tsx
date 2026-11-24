import { Coffee } from 'lucide-react'
import { Card, EmptyNote, FadeWhileStale, PanelGroup, PartDescription, SentenceShape, Slot, WaitingList, holdsBack, useModuleHost, useWaiting, type UiCardProps } from '@openagt/ui/module'

/**
 * What needs the person (#632/#1139): the things only a person can clear, as the shell read them
 * (the picked project's, else every project's and the sessions' with no project, which is what the
 * sidebar lists and the page's line counts), as the modules say them, a question to answer, a pull request to merge, work never committed or
 * published. One list, newest first as the shell gives them: a row says what is needed first in
 * its line, so the kinds need no heading of their own. A row about a run opens it; a request no run
 * here opened opens on its git host. The rows stand in a card, and when nothing waits the card says so
 * in its middle. Until what waits is read, by this visit or an earlier one, the
 * card waits in a sentence's room, not saying that nothing waits; while it is only an earlier
 * visit's, the card is faded.
 */
export function HumanQueue(_: UiCardProps) {
  const host = useModuleHost()
  // Not cut down to the projects the card is given: a session with no project is of none of them,
  // and its question was left out of the card while the sidebar and the page's count had it.
  const { items: shown, state } = useWaiting()
  return (
    <FadeWhileStale stale={state === 'kept'} className="flex flex-col *:flex-1">
      <PanelGroup bare title="Human Queue" count={holdsBack(shown) ? shown.length : undefined}>
        <PartDescription>Agents awaiting your approval, review, or input</PartDescription>
        <Slot of={{ state, value: shown }} shape={<SentenceShape />}>
          {() =>
            shown.length === 0 ? (
              <Card>
                <EmptyNote icon={Coffee}>AI doesn't need you.</EmptyNote>
              </Card>
            ) : (
              // The rows in a card as the other parts' are, on its inset: the list pulls itself out by its rows' own.
              <Card className="px-4 py-2">
                <WaitingList items={shown} onOpenAgent={host.openAgent} />
              </Card>
            )
          }
        </Slot>
      </PanelGroup>
    </FadeWhileStale>
  )
}
