import { useSyncExternalStore } from 'react'

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

function subscribePermission(onChange: () => void): () => void {
  // No permission-change event fires on every browser; the value also changes right after our own
  // requestPermission() resolves (which re-renders anyway). Poll lightly as a backstop.
  const timer = setInterval(onChange, 3000)
  return () => clearInterval(timer)
}
