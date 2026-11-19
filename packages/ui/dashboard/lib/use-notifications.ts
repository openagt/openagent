import { useEffect, useRef } from 'react'
import type { Activity, Waiting } from '../../src/index.js'
import { SeenTracker, activityKey, waitingKey, type ProjectionRead } from '../../src/client.js'

// Browser notifications for the two feeds the shell already polls (#627): the "needs you"
// queue and the "new activity" feed. One engine — identity and baseline are imported from
// OpenAgent, beside the item types they read, so they cannot drift from them. What differs per
// feed is wording and where a click goes, which is what a spec is.
//
// Two guards keep it quiet: it never fires unless enabled AND the browser permission is granted,
// and a project's backlog is absorbed as a baseline the first time that project is read whole —
// you only hear about what happens while you are watching, never what was already there.
//
// The baseline used to be a count: the first two observations, whatever they held (#1625). A page
// opened while the daemon could not reach the git host spent both of them on empty lists, and the first
// fetch that did reach the git host announced every already-open pull request as new.

/** The per-feed half: identity plus wording and click target. */
interface NotificationSpec<T> {
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
 * Fire a browser notification when a new item appears in a watched feed. `enabled` folds the
 * gates the caller owns (the category toggle AND the browser method); the browser permission is
 * the remaining gate (checked in {@link fire}). No-op on the server (no `window`), and harmless
 * when notifications are unsupported.
 */
function useNewItemNotifications<T extends { projectId: string }>(
  read: ProjectionRead<T>,
  enabled: boolean,
  spec: NotificationSpec<T>,
  openAgent: OpenAgent,
): void {
  // A click comes long after the render that fired: it opens the run as the page navigates by then.
  const open = useRef(openAgent)
  open.current = openAgent
  const tracker = useRef<SeenTracker<T> | undefined>(undefined)
  tracker.current ??= new SeenTracker<T>(spec.keyOf, item => item.projectId)
  const lastRead = useRef<ProjectionRead<T> | undefined>(undefined)

  useEffect(() => {
    // A toggle flip re-runs this effect with the SAME feed, and re-observing it would be busywork:
    // every item is already in the baseline. Only a genuine fetch is worth folding in.
    if (read === lastRead.current) return
    lastRead.current = read
    // Observed whether or not notifications are on, which is what keeps flipping the toggle from
    // replaying the backlog: what happened while it was off is still "already there".
    const fresh = tracker.current!.observe(read.items, read.whole)
    if (enabled && fresh.length > 0) fire(fresh, spec, (projectId, agentId) => open.current(projectId, agentId))
    // The spec is a module const (stable identity), so the feed and the toggle are the deps.
  }, [read, enabled]) // eslint-disable-line react-hooks/exhaustive-deps
}

const WAITING: NotificationSpec<Waiting> = {
  keyOf: waitingKey,
  title: (first, count) => (count === 1 ? `Human Queue · ${first.projectName}` : `${count} items in your Human Queue`),
  // Each by what it is about, as the list's rows: the run's name, what it needs, and what that adds (the question, the request's number, the work left).
  label: item => `${item.title ?? item.projectName} — ${item.detail !== undefined ? `${item.words}: ${item.detail}` : item.words}`,
  // An item about a run opens the run here; one about no run, the page that fixes it (a request opened by hand, on the git host).
  opens: first => (first.run !== undefined ? { projectId: first.projectId, agentId: first.run } : first.fix !== undefined && 'href' in first.fix ? { url: first.fix.href } : undefined),
}

const ACTIVITY: NotificationSpec<Activity> = {
  keyOf: activityKey,
  title: (first, count) =>
    count === 1 ? `${first.kind === 'started' ? 'Agent started' : 'Agent finished'} · ${first.projectName}` : `${count} agent updates`,
  label: item => `${item.kind === 'started' ? 'Started' : 'Finished'}: ${item.title ?? 'a session'}`,
  opens: first => ({ projectId: first.projectId, agentId: first.agentId }),
}

/** Notify when something new waits on the person (#627). */
export function useWaitingNotifications(waiting: ProjectionRead<Waiting>, enabled: boolean, openAgent: OpenAgent): void {
  useNewItemNotifications(waiting, enabled, WAITING, openAgent)
}

/** Notify when an agent starts or finishes (#627). */
export function useActivityNotifications(activity: ProjectionRead<Activity>, enabled: boolean, openAgent: OpenAgent): void {
  useNewItemNotifications(activity, enabled, ACTIVITY, openAgent)
}
