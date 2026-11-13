// The words of the notification switches, one set for the person's menu and Settings › Notifications.

/** What the Browser row says under its name. */
export function browserHint(permission: NotificationPermission | 'unsupported'): string {
  if (permission === 'denied') return 'Blocked in your browser settings'
  if (permission === 'default') return 'Desktop notifications while the dashboard is open. Switched on, the browser asks to allow them.'
  return 'Desktop notifications while the dashboard is open.'
}

/** What a kind of notification is about, and while the browser delivers none, that it waits on the Browser row. */
export function kindHint(about: string, permission: NotificationPermission | 'unsupported', browser: boolean): string {
  return permission === 'unsupported' || (browser && permission === 'granted') ? about : `${about} Sent once Browser is on.`
}

export const HUMAN_QUEUE_ABOUT = 'An agent awaiting your answer, or a PR ready to review.'
export const NEW_ACTIVITY_ABOUT = 'An agent starts or finishes.'
