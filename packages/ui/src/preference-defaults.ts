import type { Preferences } from './registry.js'

/**
 * What an unset preference means, and the bounds the controls that write them share.
 *
 * A leaf module (no `node:*`) so `client.ts` can export it and the dashboard reads the same values
 * the daemon acts on.
 *
 * No cycle: `registry.ts` re-exports the bounds from here, and the `Preferences` import going the
 * other way is type-only, so it erases.
 */

/**
 * Notifications have two axes (B5): `notifyBrowser` says whether they reach you in the browser at
 * all, and `notifyHumanIntervention` / `notifyNewActivity` say *what* they are about. A category
 * delivers only while the browser switch is on too.
 */

/** What a notification is about. */
export type NotifyCategory = 'humanIntervention' | 'newActivity'

/** The preference key each category is stored under. */
const CATEGORY_KEYS = {
  humanIntervention: 'notifyHumanIntervention',
  newActivity: 'notifyNewActivity',
} as const satisfies Record<NotifyCategory, keyof Preferences>

/**
 * What each switch means when nobody has said.
 *
 * The polarities are not uniform, and that is the point of writing them down once: browser
 * delivery and the "needs you" category fire unless you turn them off, while plain activity is
 * opt-in.
 */
export const NOTIFICATION_DEFAULTS = {
  browser: true,
  categories: { humanIntervention: true, newActivity: false },
} as const satisfies { browser: boolean; categories: Record<NotifyCategory, boolean> }

/** Whether browser delivery is switched on, with its default applied. */
export function browserNotifyEnabled(preferences: Preferences): boolean {
  return preferences.notifyBrowser ?? NOTIFICATION_DEFAULTS.browser
}

/** Whether a category is switched on, with its default applied. */
export function notifyCategoryEnabled(preferences: Preferences, category: NotifyCategory): boolean {
  return preferences[CATEGORY_KEYS[category]] ?? NOTIFICATION_DEFAULTS.categories[category]
}

/** Whether a category delivers: both browser delivery and the category have to be on. */
export function notifies(preferences: Preferences, category: NotifyCategory): boolean {
  return browserNotifyEnabled(preferences) && notifyCategoryEnabled(preferences, category)
}

/**
 * How far either side of the quota boundary the usage bar's handle reaches, in percentage points
 * (#960): the bound of the stop line a module puts on the bar, which the bar clamps a drag to.
 */
export const MAX_SPEND_OFFSET = 50
