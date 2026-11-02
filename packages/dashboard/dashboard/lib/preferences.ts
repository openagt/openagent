import { createContext, useContext, useEffect, useSyncExternalStore } from 'react'
import type { CustomPreset, Preferences } from '../../src/index.js'
import { browserNotifyEnabled, notifyCategoryEnabled } from '../../src/client.js'
import { onPreferences, patchPreferences, onProjectPresets, saveProjectPresets } from '../rpc/preferences.js'

// The dashboard's Global options (#410), owned by the daemon and persisted in the same
// `openagent.json` as the project list — no more localStorage. Loaded once over its RPC
// and cached in this module so every component (the Start form's toggles, the notifications
// menu, Settings) reads one shared value and stays in lockstep: an update writes through to the
// cache, notifies subscribers, and persists daemon-side. Prerender has no daemon, so the
// server snapshot is the empty default and the real values load on the client.
//
// A write sends only the keys it changed (#1148) and adopts what comes back. Sending the whole
// cached object meant a tab replayed every value it happened to hold, so a tab open since before
// someone else's change reverted it on its next write — most visibly the theme.
//
// One tier: your settings. Every write goes to one place.

const EMPTY: Preferences = {}
let cache: Preferences | null = null
let loading: Promise<void> | null = null
/** Each project's shared custom presets, committed in its `.openagent/custom-presets.json` (#1025). */
const projectPresets = new Map<string, CustomPreset[]>()
const projectPresetLoads = new Set<string>()
const EMPTY_PRESETS: CustomPreset[] = []
/**
 * Write bookkeeping per tier (#1148), so nothing the daemon answers can replace the value the
 * user just chose: `writes` orders one write's reply against a newer write's, and `pending`
 * (still in flight, so its keys are not stored yet) tells a refresh to keep its hands off.
 */
let globalWrites = 0
let globalPending = 0
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * The project whose own page is open (an agent's or its "New agent" page), by id, set by the shell
 * from the route; null on every other page. Its committed presets are the ones offered.
 */
export const OpenProjectContext = createContext<string | null>(null)

function ensureLoaded(): void {
  if (!cache && !loading) {
    loading = onPreferences()
      // `??=`, not `=`: a toggle made while this initial load was in flight already populated
      // the cache and persisted, so the load must not overwrite it with the pre-toggle value.
      .then(preferences => {
        cache ??= preferences
      })
      .catch(() => {
        cache ??= {}
      })
      .finally(() => {
        loading = null
        notify()
      })
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('focus', refreshPreferences)
  // Switching back to a tab in an already-focused window fires no `focus` event, and that is
  // exactly when a tab is showing values someone changed in another one (#1148).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshPreferences()
  })
}

/** Load a project's shared custom presets (#1025) once, from its committed `.openagent/`. */
function ensureProjectPresetsLoaded(projectId: string | null): void {
  if (!projectId || projectPresets.has(projectId) || projectPresetLoads.has(projectId)) return
  projectPresetLoads.add(projectId)
  void onProjectPresets(projectId)
    .then(presets => {
      // `??=` reasoning as elsewhere: a save during the load already wrote this entry.
      if (!projectPresets.has(projectId)) projectPresets.set(projectId, presets)
    })
    .catch(() => {
      if (!projectPresets.has(projectId)) projectPresets.set(projectId, [])
    })
    .finally(() => {
      projectPresetLoads.delete(projectId)
      notify()
    })
}

/**
 * The open project's shared custom presets (#1025): the ones committed into its `.openagent/`,
 * so everyone who clones the repo sees them. Empty with no project open, since there is no repo to
 * read them from.
 */
export function useProjectPresets(): CustomPreset[] {
  const projectId = useContext(OpenProjectContext)
  const value = useSyncExternalStore(
    subscribe,
    () => (projectId ? (projectPresets.get(projectId) ?? EMPTY_PRESETS) : EMPTY_PRESETS),
    () => EMPTY_PRESETS,
  )
  useEffect(() => ensureProjectPresetsLoaded(projectId), [projectId])
  return value
}

/**
 * Replace the shared presets of `projectId`, the open project, write-through then persist into its `.openagent/`
 * (#1025). Best-effort like {@link updatePreferences}: a failed save is not worth surfacing over a
 * preset edit. A no-op when no project is open — there is no repo to commit them to.
 */
export function saveProjectPresetList(projectId: string | null, next: CustomPreset[]): void {
  if (!projectId) return
  projectPresets.set(projectId, next)
  void saveProjectPresets(projectId, next).catch(() => {})
  notify()
}

/**
 * Merge a patch into the shared preferences, persist it daemon-side, and notify every
 * subscriber so the Start form and the choice gate stay in lockstep. The write-through keeps
 * the UI responsive; the save round-trip is best-effort (a failed save is not worth surfacing
 * over a checkbox toggle).
 *
 * One destination: everything writable here is yours.
 */
export function updatePreferences(patch: Partial<Preferences>): void {
  cache = { ...(cache ?? {}), ...patch }
  const seq = ++globalWrites
  globalPending++
  void patchPreferences(patch)
    .then(result => {
      // Adopt what the daemon now stores, so this tab stops being stale about anything another
      // tab changed. Skipped when a newer write has since gone out: that answer is the more
      // recent truth, and it is about to arrive.
      if (result.ok && seq === globalWrites) {
        cache = result.preferences
        notify()
      }
    })
    .catch(() => {})
    .finally(() => globalPending--)
  notify()
}

/**
 * Re-read your settings (#1148). Wired to the window regaining focus: a tab left open in the
 * background is showing values someone else may have changed, and until #1148 it would also
 * write them back.
 *
 * Skipped while a write is in flight, whether it went out before this read or after it: until the
 * daemon has stored those keys, no read can answer with them, and the write's own reply carries
 * the merged truth anyway.
 */
export function refreshPreferences(): void {
  const seq = globalWrites
  void onPreferences()
    .then(preferences => {
      if (seq !== globalWrites || globalPending > 0) return
      cache = preferences
      notify()
    })
    .catch(() => {})
}

/** The open project's id, or null on a view with none — for deciding a preset can be shared (#1025). */
export function useActiveProjectId(): string | null {
  return useContext(OpenProjectContext)
}

/** The user preferences in force: loaded once from the daemon and kept in sync across components. */
export function usePreferences(): Preferences {
  const preferences = useSyncExternalStore(
    subscribe,
    () => cache ?? EMPTY,
    () => EMPTY,
  )
  useEffect(() => ensureLoaded(), [])
  return preferences
}

/**
 * Whether the preferences have been read. Until then {@link usePreferences} answers the empty
 * default, so a control that shows a saved pick waits for this: drawn before, it would show the
 * default and flip when the read lands.
 */
export function usePreferencesLoaded(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => cache !== null,
    () => false,
  )
}

export type ThemePreference = NonNullable<Preferences['theme']>

/** The chosen dashboard theme (#725); absent follows the OS (`system`). */
export function themePreference(preferences: Preferences): ThemePreference {
  return preferences.theme ?? 'system'
}

/** Whether the dark palette applies, given the theme choice and the OS's dark preference. */
export function resolvedDark(theme: ThemePreference, systemDark: boolean): boolean {
  return theme === 'dark' || (theme === 'system' && systemDark)
}

// The notification defaults are OpenAgent's (#627), not the dashboard's: the polarities are
// not uniform, so they have one home. These stay as named readers because the call sites read
// better for it — and each one says which axis it is asking about (B5).

/** Browser delivery; the browser permission is still the real gate. */
export function notificationsEnabled(preferences: Preferences): boolean {
  return browserNotifyEnabled(preferences)
}

/** The "New activity" category: pings on a session starting or finishing. Composes with browser delivery above. */
export function newActivityEnabled(preferences: Preferences): boolean {
  return notifyCategoryEnabled(preferences, 'newActivity')
}

/** The "needs you" category: a session awaiting your answer, or a PR to review. */
export function humanInterventionEnabled(preferences: Preferences): boolean {
  return notifyCategoryEnabled(preferences, 'humanIntervention')
}
