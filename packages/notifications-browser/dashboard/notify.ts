import { useEffect, useRef } from 'react'
import { waitingKey, type ActivityItem, type ProjectionRead, type WaitingItem } from '@openagt/ui/module'
import { SeenTracker } from './seen.js'

// Browser notifications for the two feeds (#627): what waits on the person, which the shell reads
// for every part that shows it, and the runs that start or end. One engine: what differs per feed
// is wording and where a click goes, which is what a spec is.
//
// Two guards keep it quiet: it never fires unless its kind is on AND the browser allows it, and a
// project's backlog is absorbed as a baseline the first time that project is read whole: the person
// only hears of what happens while they are watching, never of what was already there.
//
// The baseline used to be a count: the first two observations, whatever they held (#1625). A page
// opened while the daemon could not reach the git host spent both of them on empty lists, and the
// first fetch that did reach the git host announced every already-open pull request as new.

/** The per-feed half: identity plus wording and click target. */
export interface NotificationSpec<T> {
  keyOf: (item: T) => string
  title: (first: T, count: number) => string
  /** How one item reads in the notification body. */
  label: (item: T) => string
  /** Where a click goes: an external URL, opened in a new tab, else the run it is about, opened in this one; `undefined` only brings this tab forward. */
  opens: (first: T) => { url: string } | { projectId: string; agentId: string } | undefined
}

/** Open a run of this dashboard in this tab. */
type OpenAgent = (projectId: string, agentId: string) => void

function fire<T>(items: T[], spec: NotificationSpec<T>, openAgent: OpenAgent): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  const first = items[0]
  if (!first) return
  // Every open tab of the dashboard fires its own: one tag per item, so the system shows one.
  const notification = new Notification(spec.title(first, items.length), { body: items.map(spec.label).join('\n'), tag: spec.keyOf(first) })
  notification.onclick = () => {
    const opens = spec.opens(first)
    if (opens && 'url' in opens) window.open(opens.url, '_blank', 'noopener')
    else {
      window.focus()
      if (opens) openAgent(opens.projectId, opens.agentId)
    }
    notification.close()
  }
}

/**
 * Fire a browser notification when a new item appears in a watched feed. `enabled` is the kind's
 * switch; the browser's permission is the remaining gate (checked in {@link fire}). Harmless where
 * notifications are unsupported.
 */
export function useNewItemNotifications<T extends { projectId: string }>(read: ProjectionRead<T>, enabled: boolean, spec: NotificationSpec<T>, openAgent: OpenAgent): void {
  // A click comes long after the render that fired: it opens the run as the page navigates by then.
  const open = useRef(openAgent)
  open.current = openAgent
  const tracker = useRef<SeenTracker<T> | undefined>(undefined)
  tracker.current ??= new SeenTracker<T>(spec.keyOf, item => item.projectId)
  const lastRead = useRef<ProjectionRead<T> | undefined>(undefined)

  useEffect(() => {
    // A switch flipped re-runs this effect with the SAME feed, and observing it again would be
    // busywork: every item is already in the baseline. Only a genuine fetch is worth folding in.
    if (read === lastRead.current) return
    lastRead.current = read
    // Observed whether or not the kind is on, which is what keeps switching it on from replaying the
    // backlog: what happened while it was off is still "already there".
    const fresh = tracker.current!.observe(read.items, read.whole)
    if (enabled && fresh.length > 0) fire(fresh, spec, (projectId, agentId) => open.current(projectId, agentId))
    // The spec is a module const (stable identity), so the feed and the switch are the deps.
  }, [read, enabled]) // eslint-disable-line react-hooks/exhaustive-deps
}

/** What waits on the person: a question to answer, a pull request to review, work left. */
export const WAITING: NotificationSpec<WaitingItem> = {
  keyOf: waitingKey,
  title: (first, count) => (count === 1 ? `Human Queue · ${first.projectName}` : `${count} items in your Human Queue`),
  // Each by what it is about, as the list's rows: the run's name, what it needs, and what that adds (the question, the request's number, the work left).
  label: item => `${item.title ?? item.projectName} — ${item.detail !== undefined ? `${item.words}: ${item.detail}` : item.words}`,
  // An item about a run opens the run here; one about no run, the page that fixes it (a request opened by hand, on the git host).
  opens: first => (first.run !== undefined ? { projectId: first.projectId, agentId: first.run } : first.fix !== undefined && 'href' in first.fix ? { url: first.fix.href } : undefined),
}

/**
 * The stable identity of an activity item: its kind, project and run. The kind is part of the key
 * so a run's `started` and `finished` are two announcements, each made once.
 */
export function activityKey(item: ActivityItem): string {
  return `${item.kind}:${item.projectId}:${item.agentId}`
}

/** A run that started or ended. */
export const ACTIVITY: NotificationSpec<ActivityItem> = {
  keyOf: activityKey,
  title: (first, count) => (count === 1 ? `${first.kind === 'started' ? 'Agent started' : 'Agent finished'} · ${first.projectName}` : `${count} agent updates`),
  label: item => `${item.kind === 'started' ? 'Started' : 'Finished'}: ${item.title ?? 'a session'}`,
  opens: first => ({ projectId: first.projectId, agentId: first.agentId }),
}
