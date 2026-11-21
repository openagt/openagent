import { runsAgain, useModuleHost, usePolled, useWaiting, type ActivityItem, type ProjectionRead, type WaitingItem } from '@openagt/ui/module'
import { useKinds } from './kinds.js'
import { ACTIVITY, WAITING, useNewItemNotifications } from './notify.js'

/** Stable empty reads, so a read that is not there does not churn on every render. */
const NOTHING_WAITING: ProjectionRead<WaitingItem> = { items: [], whole: [] }
const NO_ACTIVITY: ProjectionRead<ActivityItem> = { items: [], whole: [] }

/**
 * The notifier, drawn over every page and showing nothing (`app.overlay`): a browser notification
 * for each new thing that waits on the person, from the shell's one read of them, and, when the
 * person asks for it, for each run that starts or ends, read every 15 seconds and as soon as a run
 * changes. A click opens what it is about.
 */
export function Notifier() {
  const host = useModuleHost()
  const kinds = useKinds(host)
  const waiting = useWaiting()
  // Only a fresh read: one stored by an earlier visit, taken as what was already there, would
  // announce everything that came while the page was closed.
  useNewItemNotifications(waiting.state === 'fresh' ? waiting.all : NOTHING_WAITING, kinds?.waiting === true, WAITING, host.openAgent)
  // Read only while it is told of: nothing else here shows it.
  const activityOn = kinds?.activity === true
  const { value: activity } = usePolled<ProjectionRead<ActivityItem>>(activityOn ? () => host.activity() : null, NO_ACTIVITY, 15_000, [activityOn, host], undefined, runsAgain(undefined))
  useNewItemNotifications(activity, activityOn, ACTIVITY, host.openAgent)
  return null
}
