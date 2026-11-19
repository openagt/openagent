import { defineSetting, type Settings } from '@openagt/hooks'

/**
 * What the browser's notifications are about, each a switch of the person's, kept with them so
 * every computer of theirs tells them the same: what waits on them (the Human Queue: a question to
 * answer, a pull request to review), on unless they switch it off, and plain activity (an agent
 * starts or finishes), off unless they switch it on.
 */
export interface Kinds {
  waiting: boolean
  activity: boolean
}

/** The name of a kind, as a page saves it. */
export type Kind = keyof Kinds

const boolean = (value: unknown): boolean | undefined => (typeof value === 'boolean' ? value : undefined)

/** What waits on the person: on unless they switch it off. */
export const NOTIFY_WAITING = defineSetting<boolean>({ key: 'notifications-browser.waiting', scope: 'person', default: true, parse: boolean })

/** An agent starts or finishes: off unless they switch it on. */
export const NOTIFY_ACTIVITY = defineSetting<boolean>({ key: 'notifications-browser.activity', scope: 'person', default: false, parse: boolean })

const SETTINGS = { waiting: NOTIFY_WAITING, activity: NOTIFY_ACTIVITY } as const satisfies Record<Kind, unknown>

/** Whether `value` names a kind. */
export function isKind(value: unknown): value is Kind {
  return typeof value === 'string' && Object.hasOwn(SETTINGS, value)
}

/** The person's kinds, as their settings keep them. */
export async function readKinds(settings: Settings): Promise<Kinds> {
  const [waiting, activity] = await Promise.all([settings.get(NOTIFY_WAITING), settings.get(NOTIFY_ACTIVITY)])
  return { waiting, activity }
}

/** Switch one kind on or off. */
export function saveKind(settings: Settings, kind: Kind, on: boolean): Promise<void> {
  return settings.set(SETTINGS[kind], on)
}
