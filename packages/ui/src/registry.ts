import { accentOf, isCodeFont, isDocumentFont, isFont, isPalette, type Accent, type CodeFont, type DocumentFont, type Font, type Palette } from './appearance.js'
import { sanitizeOverviewLayouts, type OverviewLayouts } from './overview-layout.js'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { projectId } from '@openagt/agent-data'
import { isPublishPick, type PublishPick } from './publish-levels.js'
import { nodeFs } from './node-fs.js'

/**
 * The multi-project registry (#390): the list of projects the user has
 * installed OpenAgent into, kept as a single JSON file `.bashrc`-style —
 * `$HOME/.openagent.json` — so it is the user's responsibility to re-create
 * per machine. The same file also holds the user's dashboard preferences (#410),
 * so the daemon owns one user file and the UI never needs localStorage.
 */

/** One registered project. */
export interface ProjectRecord {
  /** Stable, URL-safe id derived from the path. */
  id: string
  /** Absolute repo path. */
  path: string
  /** ISO timestamp the project was added. */
  addedAt: string
}

/**
 * The dashboard's Global options (#410), persisted next to the project list so they
 * survive restarts without localStorage — the daemon reads/writes them, the SPA reads
 * them over `POST /_rpc/onPreferences`. Mostly flat booleans mirroring the Start form's
 * toggles; every field is optional and absent means off, except where a field documents its
 * own default below.
 */
export interface Preferences {
  /** How far a run started from the dashboard publishes its work: `nothing`, or the level handed to the run, `commit`, `branch`, `pr` or `merge`. The launcher's menu shows it and writes it. Absent = none saved: the daemon decides where a Start goes. */
  publish?: PublishPick
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

/** The persisted registry file shape (#410): the project list plus the user preferences. */
export interface Registry {
  projects: ProjectRecord[]
  preferences: Preferences
  /** The folders the person added to look for repos in, besides the home folder (dashboard/repos.ts), absolute. */
  repoFolders?: string[]
}

/** The cap on added repo folders, so a hand-edited file cannot make a crawl of everything. */
const MAX_REPO_FOLDERS = 50

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

/** True when `value` is a well-formed {@link ProjectRecord}. */
function isRecord(value: unknown): value is ProjectRecord {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.id === 'string' && typeof record.path === 'string' && typeof record.addedAt === 'string'
}

/** Keep well-formed records, deduped by resolved path (first wins). */
function dedupeProjects(values: unknown[]): ProjectRecord[] {
  const seen = new Set<string>()
  const projects: ProjectRecord[] = []
  for (const value of values) {
    if (!isRecord(value)) continue
    const key = resolve(value.path)
    if (seen.has(key)) continue
    seen.add(key)
    projects.push(value)
  }
  return projects
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
  // `publish` is constrained to the picks the launcher's menu lists.
  if (isPublishPick(input['publish'])) preferences.publish = input['publish']
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

/** Whether a value reads as a computer's own name: the letters a host name has, at a host name's length. A page shows it. */
export function isHostName(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._-]{1,253}$/.test(value)
}

/**
 * Read the whole registry. Forgiving: a missing / unreadable / malformed file — or one in a shape
 * this no longer writes — yields an empty registry, never throws. Projects are deduped by resolved
 * path and unknown preference fields are dropped.
 */
export async function readRegistry(
  env: NodeJS.ProcessEnv = process.env,
  fs: RegistryFs = nodeRegistryFs(),
): Promise<Registry> {
  const empty: Registry = { projects: [], preferences: {} }
  let parsed: unknown
  try {
    parsed = JSON.parse(await fs.read(registryPath(env)))
  } catch {
    return empty
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return empty
  const obj = parsed as Record<string, unknown>
  const projects = Array.isArray(obj.projects) ? dedupeProjects(obj.projects) : []
  const repoFolders = Array.isArray(obj.repoFolders) ? [...new Set(obj.repoFolders.filter((folder): folder is string => typeof folder === 'string' && isAbsolute(folder)))].slice(0, MAX_REPO_FOLDERS) : []
  return {
    projects,
    preferences: sanitizePreferences(obj.preferences),
    ...(repoFolders.length ? { repoFolders } : {}),
  }
}

/**
 * Write the registry back as pretty object-form JSON, creating the parent dir.
 *
 * Atomic (#991): the JSON goes to a temp file beside the real one and is then renamed over it.
 * A direct write truncates first, so a crash, a kill or a full disk mid-write left a half file —
 * and {@link readRegistry} reports a malformed file as an empty registry, so every project and
 * preference vanished silently. A failed write now only ever damages the temp file. The temp is
 * left behind on failure rather than swept up: one stray file is the cheaper half of that trade.
 *
 * Written owner-only (#1095): a default-umask 0644 in a shared home would hand the person's
 * projects and preferences to every other account on the machine.
 * The mode is set on the temp file, before the rename — narrowing after it would leave a window
 * where the real path is readable. Best-effort: a filesystem with no permission bits still writes.
 */
async function writeRegistry(registry: Registry, env: NodeJS.ProcessEnv, fs: RegistryFs): Promise<void> {
  const file = registryPath(env)
  const { projects, preferences, repoFolders } = registry
  const contents = {
    projects,
    preferences,
    ...(repoFolders?.length ? { repoFolders } : {}),
  }
  const json = JSON.stringify(contents, null, 2)
  await fs.mkdir(dirname(file))
  const temp = `${file}.${process.pid}.tmp`
  await fs.write(temp, json)
  await fs.chmod(temp, REGISTRY_FILE_MODE).catch(() => {})
  await fs.rename(temp, file)
}

/**
 * Serializes the read-modify-write mutators below (#991). Each reads the whole registry, edits it
 * and writes it back, and one daemon runs several concurrently: a project added while the
 * dashboard's savePreferences RPC writes through {@link registryPreferencesStore}. Interleaved, the later write was computed from a read taken
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

/**
 * Read the registry's project list. Forgiving: a missing / unreadable / malformed
 * file yields `[]`, never throws. Deduped by resolved path, first wins.
 */
export async function listProjects(
  env: NodeJS.ProcessEnv = process.env,
  fs: RegistryFs = nodeRegistryFs(),
): Promise<ProjectRecord[]> {
  return (await readRegistry(env, fs)).projects
}

/**
 * Register a project. Idempotent by resolved path: when the path is already
 * registered, the existing record is returned untouched (addedAt survives);
 * otherwise the new record is appended and the file written back (preferences preserved).
 */
export async function addProject(
  path: string,
  addedAt: string,
  env: NodeJS.ProcessEnv = process.env,
  fs: RegistryFs = nodeRegistryFs(),
): Promise<ProjectRecord> {
  return serialize(async () => {
    const absolute = resolve(path)
    const registry = await readRegistry(env, fs)
    const existing = registry.projects.find(project => resolve(project.path) === absolute)
    if (existing) return existing

    const record: ProjectRecord = { id: projectId(absolute), path: absolute, addedAt }
    registry.projects.push(record)
    await writeRegistry(registry, env, fs)
    return record
  })
}

/**
 * Take a project off the list, by id. Answers the record that was removed, or `undefined` when
 * no project has that id. Only the list changes: nothing in the project's folder is touched, so
 * a project whose folder is gone is removed like any other.
 */
export async function removeProject(
  id: string,
  env: NodeJS.ProcessEnv = process.env,
  fs: RegistryFs = nodeRegistryFs(),
): Promise<ProjectRecord | undefined> {
  return serialize(async () => {
    const registry = await readRegistry(env, fs)
    const removed = registry.projects.find(project => project.id === id)
    if (!removed) return undefined
    registry.projects = registry.projects.filter(project => project.id !== id)
    await writeRegistry(registry, env, fs)
    return removed
  })
}

/** The folders the person added to look for repos in (dashboard/repos.ts). Forgiving, like {@link listProjects}. */
export async function listRepoFolders(env: NodeJS.ProcessEnv = process.env, fs: RegistryFs = nodeRegistryFs()): Promise<string[]> {
  return (await readRegistry(env, fs)).repoFolders ?? []
}

/** Add a folder to look for repos in, by its absolute path; one already there is not added again. */
export async function addRepoFolder(folder: string, env: NodeJS.ProcessEnv = process.env, fs: RegistryFs = nodeRegistryFs()): Promise<void> {
  return serialize(async () => {
    const absolute = resolve(folder)
    const registry = await readRegistry(env, fs)
    const folders = registry.repoFolders ?? []
    if (folders.includes(absolute) || folders.length >= MAX_REPO_FOLDERS) return
    registry.repoFolders = [...folders, absolute]
    await writeRegistry(registry, env, fs)
  })
}

/** Stop looking for repos in a folder the person added; one not there changes nothing. */
export async function removeRepoFolder(folder: string, env: NodeJS.ProcessEnv = process.env, fs: RegistryFs = nodeRegistryFs()): Promise<void> {
  return serialize(async () => {
    const registry = await readRegistry(env, fs)
    const folders = registry.repoFolders ?? []
    if (!folders.includes(folder)) return
    const kept = folders.filter(one => one !== folder)
    if (kept.length) registry.repoFolders = kept
    else delete registry.repoFolders
    await writeRegistry(registry, env, fs)
  })
}

/** The user's dashboard preferences (#410), or `{}` when none are stored. */
export async function readPreferences(
  env: NodeJS.ProcessEnv = process.env,
  fs: RegistryFs = nodeRegistryFs(),
): Promise<Preferences> {
  return (await readRegistry(env, fs)).preferences
}

/** Persist the dashboard preferences (#410), sanitized, preserving the project list. */
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
