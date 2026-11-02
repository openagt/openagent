import { contextPreferences, resolveProjectPath } from './context.js'
import { detectEditors, type EditorInfo } from '../dashboard/open-in-app.js'
import { readProjectPresets, writeProjectPresets } from '../project-presets.js'
import type { CustomPreset, Preferences } from '../registry.js'

// The user-preferences surface behind the new dashboard (#410): the driver and model the Start
// form uses, and the rest of Settings. Persisted daemon-side in the same `openagent.json` as the
// project list, so they survive restarts with no localStorage. The store is wired into the
// dashboard context, which the one host always wires in full (D3) — there is no second host left
// to degrade for.

/** The outcome of a {@link savePreferences} write. */
export type SavePreferencesResult = { ok: true } | { ok: false; error: string }

/** The user's stored dashboard preferences, or `{}` when the read fails. */
export async function onPreferences(): Promise<Preferences> {
  return contextPreferences().read().catch(() => ({}))
}

/** Persist the dashboard preferences (sanitized in the store). */
export async function savePreferences(preferences: Preferences): Promise<SavePreferencesResult> {
  // A failed write returns the advertised typed error rather than rejecting the RPC, so the
  // client renders it instead of losing the save to an exception it cannot read.
  try {
    await contextPreferences().save(preferences)
    return { ok: true }
  } catch {
    return { ok: false, error: 'failed to save preferences' }
  }
}

/** The outcome of a patch write (#1148): the stored result, so the caller can adopt it. */
export type PatchPreferencesResult<T> = { ok: true; preferences: T } | { ok: false; error: string }

/**
 * Merge the keys the caller changed into the stored preferences (#1148), and hand back what is
 * now stored. The write half of the fix for a stale tab reverting settings it never touched:
 * {@link savePreferences} replaces the whole block, so a client's snapshot overwrote whatever
 * anyone else had changed since it loaded. Returning the merged result also lets the caller
 * adopt the truth it just wrote against, so a tab converges instead of staying stale.
 */
export async function patchPreferences(patch: Preferences): Promise<PatchPreferencesResult<Preferences>> {
  // Typed error rather than a rejection, like `savePreferences` — one shape for every failure.
  try {
    return { ok: true, preferences: await contextPreferences().patch(patch) }
  } catch {
    return { ok: false, error: 'failed to save preferences' }
  }
}

/**
 * A project's shared custom presets (#1025), committed into its `.openagent/` so they travel
 * with the repo — the team-shared counterpart to the user-tier {@link onPreferences} presets. Read
 * from the project's own checkout, so this resolves the project id to its workspace path rather than
 * touching the home registry. `[]` for an unknown project.
 */
export async function onProjectPresets(projectId: string): Promise<CustomPreset[]> {
  const cwd = await resolveProjectPath(projectId)
  if (!cwd) return []
  return readProjectPresets(cwd).catch(() => [])
}

/** Persist a project's shared custom presets into its `.openagent/` (#1025). */
export async function saveProjectPresets(
  projectId: string,
  presets: CustomPreset[],
): Promise<SavePreferencesResult> {
  const cwd = await resolveProjectPath(projectId)
  if (!cwd) return { ok: false, error: 'unknown project' }
  try {
    await writeProjectPresets(cwd, presets)
    return { ok: true }
  } catch {
    return { ok: false, error: 'failed to save presets' }
  }
}

/** The editors installed on this server (#727), for the "Preferred editor" picker. */
export async function onEditors(): Promise<EditorInfo[]> {
  return detectEditors().catch(() => [])
}
