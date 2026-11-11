import { useSyncExternalStore } from 'react'
import { updatePreferences } from './preferences.js'

// The browser's notification permission as a subscribable value (#627). It lives here rather than
// in the notifications menu because the Onboarding checklist (#958) asks the same question, and a
// second copy of the polling backstop would be a second thing to keep right.

/** Subscribe to `Notification.permission` where the browser supports it, else 'unsupported'. */
export function useNotificationPermission(): NotificationPermission | 'unsupported' {
  return useSyncExternalStore(
    subscribePermission,
    () => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission),
    () => 'unsupported',
  )
}

/** Browser notifications switched on or off by a press; switched on, the browser is asked for its permission where it was not yet, which it allows only during a press. */
export function setBrowserNotifications(on: boolean): void {
  updatePreferences({ notifyBrowser: on })
  if (on && typeof Notification !== 'undefined' && Notification.permission === 'default') void Notification.requestPermission().then(() => listeners.forEach(onChange => onChange()))
}

const listeners = new Set<() => void>()

function subscribePermission(onChange: () => void): () => void {
  // No permission-change event on every browser: read again once our own request is answered, and every 3 s.
  listeners.add(onChange)
  const timer = setInterval(onChange, 3000)
  return () => {
    listeners.delete(onChange)
    clearInterval(timer)
  }
}
