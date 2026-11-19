import { useSyncExternalStore } from 'react'

// The browser's notification permission as a value a page follows (#627): the notifier never fires
// without it, and the Settings entry says where it stands and asks for it.

/** What the browser says of notifications: `Notification.permission`, or 'unsupported' where it has none. */
export type Permission = NotificationPermission | 'unsupported'

/** `Notification.permission` where the browser supports it, else 'unsupported', followed as it changes. */
export function useNotificationPermission(): Permission {
  return useSyncExternalStore(subscribe, () => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission), () => 'unsupported')
}

/** Ask the browser to allow notifications, which it does only during a press. */
export function askPermission(): void {
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') void Notification.requestPermission().then(() => listeners.forEach(onChange => onChange()))
}

const listeners = new Set<() => void>()

function subscribe(onChange: () => void): () => void {
  // No permission-change event on every browser: read again once our own request is answered, and every 3 s.
  listeners.add(onChange)
  const timer = setInterval(onChange, 3000)
  return () => {
    listeners.delete(onChange)
    clearInterval(timer)
  }
}
