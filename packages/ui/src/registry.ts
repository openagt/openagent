import { accentOf, isCodeFont, isDocumentFont, isFont, isPalette, type Accent, type CodeFont, type DocumentFont, type Font, type Palette } from './appearance.js'
import { sanitizeOverviewLayouts, type OverviewLayouts } from './overview-layout.js'
import { dirname, join } from 'node:path'
import { DEFAULT_PROFILE, isProfileId } from '@openagt/hooks'
import { isBranchName } from './branch-name.js'
import { isDriverName } from './driver-names.js'
import { isPublishPick, type PublishPick } from './publish-levels.js'
import { nodeFs } from './node-fs.js'

/**
 * The user's dashboard preferences (#410), kept as a single JSON file `.bashrc`-style —
 * `$HOME/.openagent.json` — so the daemon owns one user file and the UI never needs
 * localStorage. The list of projects is the projects module's (`PROJECTS`, in the store).
 */

/** The cap on the projects `startFrom` lists, so a hand-edited file cannot bloat. */
const START_FROM_LIMIT = 200

/**
 * Where agents started from the launcher start, when it is not the project's main branch: the
 * branch the project's folder is on, whatever that is by then, or one of origin's branches, by name.
 */
export type StartFromPick = { kind: 'local' } | { kind: 'published'; branch: string }

/** A value read as a {@link StartFromPick}: nothing for anything else, a word that is no branch name included. */
export function startFromPick(value: unknown): StartFromPick | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { kind, branch } = value as { kind?: unknown; branch?: unknown }
  if (kind === 'local') return { kind }
  return kind === 'published' && isBranchName(branch) ? { kind, branch } : undefined
}

/**
 * The dashboard's Global options (#410), persisted in the registry file so they
 * survive restarts without localStorage — the daemon reads/writes them, the SPA reads
 * them over `POST /_rpc/onPreferences`. Mostly flat booleans mirroring the Start form's
 * toggles; every field is optional and absent means off, except where a field documents its
 * own default below.
 */
export interface Preferences {
  /** The model to run on (#628), e.g. `opus` / `sonnet`, handed to the run. Absent = the coding agent's own default. */
  model?: string
  /**
   * How hard that model may think, by the coding agent's own names (`low`, `medium`, `high`, …),
   * handed to the run. Absent = the agent's own default. Kept whatever the model:
   * a model that does not take one simply never shows it, and the pick stays for the one that does.
   */
  effort?: string
  /** Which coding agent a run starts on (#650): `claude-code` or `codex`, handed to the run. Absent = the run's own default, Claude Code. */
  driver?: string
  /** How far a run started from the dashboard publishes its work: `nothing`, or the level handed to the run, `commit`, `branch`, `pr` or `merge`. The launcher's menu shows it and writes it. Absent = none saved: the daemon decides where a Start goes. */
  publish?: PublishPick
  /**
   * Where an agent started from the launcher starts, per project, by its id: "My local branch",
   * or a branch of origin's. The launcher's branch menu shows it and writes it. **A project not
   * listed starts from its main branch**, so the default stores nothing.
   */
  startFrom?: Record<string, StartFromPick>
  /**
   * The profile a run started from the launcher is on, by its id. The launcher's "Profile" pick
   * writes it. **Absent = Default.**
   */
  profile?: string
  /**
   * Name each run: a small model is asked for the two to five words a list of runs shows in place
   * of the first line of the prompt (agent-driver's `engine/title.ts`). It is one short turn of the
   * cheapest model with no tools, measured at a thirtieth of a cent a run, and it is the only
   * money OpenAgent spends on something a person only looks at — so it can be turned off, and the
   * run keeps the person's own words. **Absent = on.**
   */
  nameRuns?: boolean
  /**
   * How the sidebar orders its list of runs: `created` (newest started first), `updated` (the one
   * that last did something first, as Claude Code's list does by default) or `name`. **Absent =
   * `created`**: a run keeps its place while a person talks to it.
   */
  recentsSort?: 'created' | 'updated' | 'name'
  /**
   * What a row of the sidebar's list shows beside the run's name and age: whose run it is
   * (`recentsPerson`) and which coding agent ran it (`recentsAgent`). **Absent = neither**: the
   * row's hover says both, and a row is its name first.
   */
  recentsPerson?: boolean
  recentsAgent?: boolean
  /**
   * What the sidebar's list is grouped by, each group under its own line: the runs' `project`, or
   * the `day` they are ordered by. **Absent = `none`**, one list.
   */
  recentsGroup?: 'none' | 'project' | 'day'
  /**
   * Show what the agent thought between its steps: a row of its own inside the panel a run of calls
   * opens, saying the thought's first words. Thinking is not a step the agent took, and Claude Code
   * on the web shows none of it, so it is off unless a person asks to read it. **Absent = off.**
   */
  showThinking?: boolean
  /** Preferred editor for "Open in editor" (#727): an editor CLI (e.g. `code`, `cursor`, `zed`).
   * Absent falls back to `$OPENAGENT_EDITOR`, then `code`. */
  editor?: string
  /** Dashboard color theme (#725): `system` (follow the OS, the default), `light`, or `dark`. Absent = system. */
  theme?: 'system' | 'light' | 'dark'
  /** The page's colours (`appearance.ts`). Absent = OpenAgent's own. */
  palette?: Palette
  /** The colour of buttons, links and what is picked, one of the palette's. Absent = the palette's own. */
  accent?: Accent
  /** The font of the page and the chat. Absent = IBM Plex Sans. */
  font?: Font
  /** The font of code. Absent = JetBrains Mono. */
  codeFont?: CodeFont
  /** The font a Markdown file is read in, in the Files pane. Absent = Source Serif 4. */
  documentFont?: DocumentFont
  /**
   * Whether the Overview's Onboarding checklist has been dismissed (#958). Absent = show it,
   * so a fresh install is walked through setup; its ✕ sets it, and a switch in Settings ›
   * Appearance clears it.
   */
  onboardingDismissed?: boolean
  /** How the Overview lays out its cards, per project and for all projects ({@link OverviewLayouts}); absent = each card in its own order and width. */
  overviewLayouts?: OverviewLayouts
}

/** The persisted registry file shape (#410): the user preferences. */
export interface Registry {
  preferences: Preferences
}

/** A read/write handle for the user preferences, wired into the dashboard's context by the daemon. */
export interface PreferencesStore {
  read(): Promise<Preferences>
  save(preferences: Preferences): Promise<void>
  /**
   * Merge only the keys the caller changed (#1148) and hand back the stored result. Preferred over
   * {@link save}, which replaces the whole block from a snapshot that may already be stale.
   */
  patch(patch: Preferences): Promise<Preferences>
}

/** The registry file name: a single file under `$XDG_CONFIG_HOME` (dotted under `$HOME`). */
export const REGISTRY_FILE = 'openagent.json'

/** Owner read/write only: the file is the person's own. */
export const REGISTRY_FILE_MODE = 0o600

/**
 * The registry file path, resolved from `env` (injectable so tests never touch
 * the real home): `$XDG_CONFIG_HOME/openagent.json` when set, else the
 * dotted `$HOME/.openagent.json`. A single file, not a directory (#390).
 */
export function registryPath(env: NodeJS.ProcessEnv): string {
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, REGISTRY_FILE)
  return join(env.HOME ?? '', '.' + REGISTRY_FILE)
}

/** Minimal fs seam so the registry is unit-testable without touching disk. */
export interface RegistryFs {
  /** Rejects when the file is absent. */
  read(path: string): Promise<string>
  write(path: string, contents: string): Promise<void>
  /** Recursive; used on the registry file's parent dir. */
  mkdir(path: string): Promise<void>
  /** Replace `to` with `from`, atomically: how {@link writeRegistry} avoids a truncate-then-write (#991). */
  rename(from: string, to: string): Promise<void>
  /**
   * Narrow a file's permissions. Best-effort at the call site: this file is written owner-only,
   * but a filesystem that cannot express that (Windows, a FAT volume) must not fail the write.
   */
  chmod(path: string, mode: number): Promise<void>
}

/** A {@link RegistryFs} backed by `node:fs/promises`. See {@link nodeFs}. */
function nodeRegistryFs(): RegistryFs {
  const { read, write, mkdir, rename, chmod } = nodeFs()
  return { read, write, mkdir, rename, chmod }
}

/** The boolean keys of {@link Preferences}, computed so the table below cannot drift from the type. */
type BooleanPreferenceKey = {
  [K in keyof Preferences]-?: NonNullable<Preferences[K]> extends boolean ? K : never
}[keyof Preferences]

/**
 * Every boolean preference, as a `Record` over {@link BooleanPreferenceKey} so the compiler
 * enforces completeness in both directions (#944): a typo fails as an unknown property, and
 * omitting a newly added boolean preference fails as a missing one. A plain `as const` array
 * only caught the first — an omission made {@link sanitizePreferences} silently drop the new
 * preference on every save, the write-then-vanish failure shape for a settings file.
 */
const BOOLEAN_PREFERENCES: Record<BooleanPreferenceKey, true> = {
  onboardingDismissed: true,
  nameRuns: true,
  showThinking: true,
  recentsPerson: true,
  recentsAgent: true,
}

const PREFERENCE_KEYS = Object.keys(BOOLEAN_PREFERENCES) as BooleanPreferenceKey[]

/** The color themes the dashboard offers (#725); anything else means the default `system`. */
const KNOWN_THEMES = ['system', 'light', 'dark'] as const

/** Keep only the known preference fields, so a hand-edited or browser-supplied
 * object never lands junk (or the wrong type) in the user's home file. */
function sanitizePreferences(value: unknown): Preferences {
  if (typeof value !== 'object' || value === null) return {}
  const input = value as Record<string, unknown>
  const preferences: Preferences = {}
  for (const key of PREFERENCE_KEYS) {
    if (typeof input[key] === 'boolean') preferences[key] = input[key] as boolean
  }
  // `model` (#628) is a free-form string preference; the rest are booleans. A blank string is "no
  // choice", same as absent, so it is dropped rather than persisted. So is the literal word
  // "Default": that was a picker *label* whose stored value was empty (#1143), and a file carrying
  // it as the value — hand-edited, or written by a build that mistook the two — would otherwise be
  // handed to the CLI as `--model Default` and fail the turn on a word nobody chose.
  const model = typeof input['model'] === 'string' ? input['model'].trim() : ''
  if (model && model.toLowerCase() !== 'default') preferences.model = model
  // `effort` is free-form too: the levels come from the agent's own model list, and a level this
  // version has never heard of still belongs to the agent that offered it.
  const effort = typeof input['effort'] === 'string' ? input['effort'].trim() : ''
  if (effort) preferences.effort = effort.slice(0, 20)
  // `driver` (#650) is constrained to the known set so junk never reaches the agent; the set is the
  // shared node-free vocabulary (driver-names.ts).
  if (isDriverName(input['driver'] as string | undefined)) preferences.driver = input['driver'] as string
  // `publish` is constrained to the picks the launcher's menu lists.
  if (isPublishPick(input['publish'])) preferences.publish = input['publish']
  // `profile` names a profile by its id; Default is the absent entry.
  const profile = typeof input['profile'] === 'string' ? input['profile'].trim() : ''
  if (isProfileId(profile) && profile !== DEFAULT_PROFILE) preferences.profile = profile
  const startFrom = sanitizeStartFrom(input['startFrom'])
  if (Object.keys(startFrom).length) preferences.startFrom = startFrom
  // `editor` (#727) is a free-form CLI name, trimmed and length-capped so junk / a huge string
  // never lands in the file. A blank string is "no choice" (fall back to env / `code`), so dropped.
  if (typeof input['editor'] === 'string' && input['editor'].trim())
    preferences.editor = input['editor'].trim().slice(0, 100)
  // `theme` (#725) is constrained to the known set; anything else (incl. absent) means the default
  // `system`, so it is simply dropped rather than persisted.
  if (typeof input['theme'] === 'string' && (KNOWN_THEMES as readonly string[]).includes(input['theme']))
    preferences.theme = input['theme'] as (typeof KNOWN_THEMES)[number]
  // How the page looks beyond light or dark: each a pick from its list; the default is stored as nothing.
  if (isPalette(input['palette']) && input['palette'] !== 'openagent') preferences.palette = input['palette']
  const accent = accentOf(preferences.palette, input['accent'])
  if (accent) preferences.accent = accent
  if (isFont(input['font']) && input['font'] !== 'ibm-plex-sans') preferences.font = input['font']
  if (isCodeFont(input['codeFont']) && input['codeFont'] !== 'jetbrains-mono') preferences.codeFont = input['codeFont']
  if (isDocumentFont(input['documentFont']) && input['documentFont'] !== 'source-serif-4') preferences.documentFont = input['documentFont']
  // `recentsSort` is constrained to the known set; the default, `created`, is stored as nothing.
  if (input['recentsSort'] === 'updated' || input['recentsSort'] === 'name') preferences.recentsSort = input['recentsSort']
  // How the list is grouped: constrained to the known set; the default, one list, is stored as nothing.
  if (input['recentsGroup'] === 'project' || input['recentsGroup'] === 'day') preferences.recentsGroup = input['recentsGroup']
  const overviewLayouts = sanitizeOverviewLayouts(input['overviewLayouts'])
  if (Object.keys(overviewLayouts).length) preferences.overviewLayouts = overviewLayouts
  return preferences
}

/**
 * Keep only the projects set to start from the local branch: a map from a project's id to the one
 * word `local`. Any other value is dropped (the main branch is the absent entry), and the map is
 * capped at {@link START_FROM_LIMIT} projects. An id is not checked against the project list: a
 * project removed and added again has the same id, and its pick with it.
 */
function sanitizeStartFrom(value: unknown): Record<string, StartFromPick> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const picks = Object.entries(value).flatMap(([id, from]) => {
    const pick = startFromPick(from)
    return id !== '' && pick ? [[id, pick] as const] : []
  })
  return Object.fromEntries(picks.slice(0, START_FROM_LIMIT))
}

/** Whether a value reads as a computer's own name: the letters a host name has, at a host name's length. A page shows it. */
export function isHostName(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._-]{1,253}$/.test(value)
}

/**
 * Read the whole registry. Forgiving: a missing / unreadable / malformed file — or one in a shape
 * this no longer writes — yields an empty registry, never throws. Unknown preference fields are dropped.
 */
export async function readRegistry(
  env: NodeJS.ProcessEnv = process.env,
  fs: RegistryFs = nodeRegistryFs(),
): Promise<Registry> {
  const empty: Registry = { preferences: {} }
  let parsed: unknown
  try {
    parsed = JSON.parse(await fs.read(registryPath(env)))
  } catch {
    return empty
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return empty
  return { preferences: sanitizePreferences((parsed as Record<string, unknown>).preferences) }
}

/**
 * Write the registry back as pretty object-form JSON, creating the parent dir.
 *
 * Atomic (#991): the JSON goes to a temp file beside the real one and is then renamed over it.
 * A direct write truncates first, so a crash, a kill or a full disk mid-write left a half file —
 * and {@link readRegistry} reports a malformed file as an empty registry, so every
 * preference vanished silently. A failed write now only ever damages the temp file. The temp is
 * left behind on failure rather than swept up: one stray file is the cheaper half of that trade.
 *
 * Written owner-only (#1095): a default-umask 0644 in a shared home would hand the person's
 * preferences to every other account on the machine.
 * The mode is set on the temp file, before the rename — narrowing after it would leave a window
 * where the real path is readable. Best-effort: a filesystem with no permission bits still writes.
 */
async function writeRegistry(registry: Registry, env: NodeJS.ProcessEnv, fs: RegistryFs): Promise<void> {
  const file = registryPath(env)
  const json = JSON.stringify({ preferences: registry.preferences }, null, 2)
  await fs.mkdir(dirname(file))
  const temp = `${file}.${process.pid}.tmp`
  await fs.write(temp, json)
  await fs.chmod(temp, REGISTRY_FILE_MODE).catch(() => {})
  await fs.rename(temp, file)
}

/**
 * Serializes the read-modify-write mutators below (#991). Each reads the whole registry, edits it
 * and writes it back, and one daemon runs several concurrently: two of the dashboard's
 * savePreferences RPCs writing through {@link registryPreferencesStore}. Interleaved, the later write was computed from a read taken
 * before the earlier one landed, so it silently dropped it. One tail promise for the module, not
 * one per file: the writes are small, and the registry is a single file per machine anyway.
 */
let mutations: Promise<void> = Promise.resolve()

function serialize<T>(mutate: () => Promise<T>): Promise<T> {
  const result = mutations.then(mutate)
  // A rejected mutation must not poison the queue, and must not surface as an unhandled rejection
  // here — the caller still gets `result`, which carries the error.
  mutations = result.then(
    () => {},
    () => {},
  )
  return result
}

/** The user's dashboard preferences (#410), or `{}` when none are stored. */
export async function readPreferences(
  env: NodeJS.ProcessEnv = process.env,
  fs: RegistryFs = nodeRegistryFs(),
): Promise<Preferences> {
  return (await readRegistry(env, fs)).preferences
}

/** Persist the dashboard preferences (#410), sanitized. */
export async function writePreferences(
  preferences: Preferences,
  env: NodeJS.ProcessEnv = process.env,
  fs: RegistryFs = nodeRegistryFs(),
): Promise<void> {
  return serialize(async () => {
    const registry = await readRegistry(env, fs)
    await writeRegistry({ ...registry, preferences: sanitizePreferences(preferences) }, env, fs)
  })
}

/**
 * Merge `patch` over the stored preferences (#1148) and return the result.
 *
 * The counterpart to {@link writePreferences}, which replaces the whole block: a client that
 * sends its entire snapshot replays every value it happens to hold, so a dashboard tab opened
 * before someone else's change silently reverted it on the tab's next write, whatever key that
 * write was actually about. Sending only the changed keys makes a write touch only what it names.
 *
 * Clearing needs no sentinel: {@link sanitizePreferences} already drops blank strings and empty
 * lists, so `{ editor: '' }` merges in as blank and comes out absent, which is how the dashboard
 * clears the editor today.
 */
export async function patchPreferences(
  patch: Preferences,
  env: NodeJS.ProcessEnv = process.env,
  fs: RegistryFs = nodeRegistryFs(),
): Promise<Preferences> {
  return serialize(async () => {
    const registry = await readRegistry(env, fs)
    const preferences = sanitizePreferences({ ...registry.preferences, ...patch })
    await writeRegistry({ ...registry, preferences }, env, fs)
    return preferences
  })
}

/** A {@link PreferencesStore} bound to the real registry file, wired by the daemon so the
 * dashboard's preferences RPCs read/write the user's home file. */
export function registryPreferencesStore(env: NodeJS.ProcessEnv = process.env, fs: RegistryFs = nodeRegistryFs()): PreferencesStore {
  return {
    read: () => readPreferences(env, fs),
    save: preferences => writePreferences(preferences, env, fs),
    patch: patch => patchPreferences(patch, env, fs),
  }
}
