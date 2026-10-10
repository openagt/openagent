import { basename, dirname, join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { isDriverName } from './driver-names.js'
import { isPublishPick, type PublishPick } from './publish-levels.js'
import { nodeFs } from './node-fs.js'

/**
 * The multi-project registry (#390): the list of projects the user has
 * installed OpenAgent into, kept as a single JSON file `.bashrc`-style —
 * `$HOME/.openagent.json` — so it is the user's responsibility to re-create
 * per machine. The same file also holds the user's dashboard preferences (#410)
 * and the machines they saved, so the daemon owns one user file and the UI never
 * needs localStorage.
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
 * A saved machine: another computer running OpenAgent that a run can be sent to. Kept in this
 * file, the person's own, so every browser on this computer shows the same machines and the
 * key that reaches one never leaves the two machines.
 */
export interface MachineRecord {
  /** The machine's address, which is also what names it: saving the same address again replaces it. */
  id: string
  /** The name the person gave it, or its host when they gave none. */
  label: string
  /** Where its OpenAgent answers, as an origin (`http://192.168.1.5:4200`). */
  url: string
  /** The key that machine asks for. Never handed to a browser. */
  token: string
}

/** The cap on saved machines and on a name's length, so a hand-edited file cannot bloat. */
const MACHINE_LIMITS = { count: 50, label: 60 } as const

/**
 * The dashboard's Global options (#410), persisted next to the project list so they
 * survive restarts without localStorage — the daemon reads/writes them, the SPA reads
 * them over `POST /_rpc/onPreferences`. Mostly flat booleans mirroring the Start form's
 * toggles; every field is optional and absent means off, except where a field documents its
 * own default below.
 */

/**
 * A user-defined preset (#626): a named prompt the user saved to re-run their own high-signal
 * prompts, listed as a saved prompt in the launcher's Commands menu beside the project's commands.
 * Just data — the label is the menu item, the prompt is loaded verbatim into the editor. `id` is
 * stable so edits/deletes address one.
 */
export interface CustomPreset {
  id: string
  label: string
  prompt: string
}

/** The cap on saved custom presets, and the per-field lengths — enough for real prompts, bounded
 * so a hand-edited or hostile registry can't bloat the home file. */
const CUSTOM_PRESET_LIMITS = { count: 30, label: 80, prompt: 20_000 } as const

/** The cap on the projects `startFrom` lists, for the same reason. */
const START_FROM_LIMIT = 200

export interface Preferences {
  /** Fire a browser notification when a new item lands on the "needs you" queue (#627). Absent = on. */
  notifyBrowser?: boolean
  /**
   * Also notify on plain agent activity — an agent started, an agent finished (#627). The default-off
   * counterpart to the always-on "needs you" notifications: it keeps you loosely informed of the
   * pipeline moving even when nothing needs you. A *category* toggle: it composes with the method
   * toggle {@link notifyBrowser}.
   */
  notifyNewActivity?: boolean
  /**
   * The "needs you" category (#627): notify when an agent is awaiting your answer or a PR is ready
   * to review. A *category* toggle, like {@link notifyNewActivity}, composing with the method
   * toggle {@link notifyBrowser}. **Absent = on**: unlike the other
   * flat opt-in booleans, human-intervention pings are the baseline OpenAgent leans on, so an
   * unset preference keeps them firing; a user turns them off explicitly.
   */
  notifyHumanIntervention?: boolean
  /** The model to run on (#628), e.g. `opus` / `sonnet`, handed to the project's start hook. Absent = the hook's own default. */
  model?: string
  /** Which coding agent a run starts on (#650): `claude-code` or `codex`, handed to the project's start hook. Absent = the hook's own default. */
  driver?: string
  /** How far a run started from the dashboard publishes its work: `nothing`, or the level handed to the project's start hook, `commit`, `branch`, `pr` or `merge`. The launcher's menu shows it and writes it. Absent = none saved: the daemon decides where a Start goes. */
  publish?: PublishPick
  /**
   * Where an agent started from the launcher starts, per project: the projects, by id, whose
   * launcher is set to "My local branch" (the branch the project's folder is on, as this machine
   * has it). The launcher's "start from" chip shows it and writes it. **A project not listed
   * starts from its main branch**, so the default stores nothing.
   */
  startFrom?: Record<string, 'local'>
  /**
   * Post-merge cleanup: a run started from the launcher, in a project that has the
   * `post-merge-cleanup` command, is followed by a fresh agent running it on the run's branch
   * before the run's pull request merges. The default of the launcher's box, which writes it
   * too. **Absent = off.**
   */
  postMergeCleanup?: boolean
  /** Preferred editor for "Open in editor" (#727): an editor CLI (e.g. `code`, `cursor`, `zed`).
   * Absent falls back to `$OPENAGENT_EDITOR`, then `code`. */
  editor?: string
  /** Dashboard color theme (#725): `system` (follow the OS, the default), `light`, or `dark`. Absent = system. */
  theme?: 'system' | 'light' | 'dark'
  /**
   * The browser bridge (#1237): let an extension running in the user's own Claude session report
   * the question a Claude web agent is parked on, so it shows in the dashboard rather than only on
   * claude.ai. **Absent = off.** It opens the daemon's one route reachable from another origin,
   * so it is opt-in rather than a baseline, and turning it on is what mints the bridge token.
   */
  bridge?: boolean
  /**
   * The bridge browser (#1332): let the daemon run its own Chrome for Testing with the bridge
   * extension installed, signed in once and kept minimized, so web runs stop depending on the
   * user's own Chrome being open. **Absent = off**: it downloads a browser and keeps a signed-in
   * claude.ai session on disk, neither of which should happen unasked. Needs {@link bridge}.
   */
  bridgeBrowser?: boolean
  /** User-defined presets (#626): the user's own saved prompts, shown in the Commands menu beside the project's commands. */
  customPresets?: CustomPreset[]
  /**
   * Whether the Overview's Onboarding checklist has been dismissed (#958). Absent = show it,
   * so a fresh install is walked through setup; dismissing only hides it on the Overview, and
   * the same checklist stays available on the settings page.
   */
  onboardingDismissed?: boolean
}

/** The persisted registry file shape (#410): the project list plus the user preferences. */
export interface Registry {
  projects: ProjectRecord[]
  preferences: Preferences
  /**
   * The shared daemon token (#1051): generated on the first non-loopback bind and reused after.
   * A top-level field, deliberately not a {@link Preferences} one, so it is never shipped to the
   * browser bundle. Absent on a loopback-only machine.
   */
  daemonToken?: string
  /**
   * The saved machines. Top-level like {@link daemonToken}, and for the same reason: each one
   * carries a key, so the list is never part of what the browser is handed.
   */
  machines?: MachineRecord[]
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

/** Owner read/write only: the file holds the daemon token (#1051) and the saved machines' keys. */
export const REGISTRY_FILE_MODE = 0o600

/**
 * Deterministic, URL-safe id for a project path: the sanitized basename plus a
 * short hash of the full path, so two repos named alike still get distinct ids.
 * Pure; same path always yields the same id.
 */
export function projectId(path: string): string {
  // djb2, rendered as base36: short, stable, URL-safe. Not cryptographic.
  let hash = 5381
  for (let i = 0; i < path.length; i++) {
    hash = ((hash * 33) ^ path.charCodeAt(i)) >>> 0
  }
  const name = basename(path)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
  return `${name}-${hash.toString(36)}`
}

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
  /**
   * Replace `to` with `from`, atomically. Optional only so an existing implementation of this
   * seam keeps compiling; without it {@link writeRegistry} falls back to the truncate-then-write
   * this method exists to avoid (#991).
   */
  rename?(from: string, to: string): Promise<void>
  /**
   * Narrow a file's permissions. Optional, and best-effort at the call site: this file holds the
   * daemon token (#1051), so it is written owner-only — but a
   * filesystem that cannot express that (Windows, a FAT volume) must not fail the write.
   */
  chmod?(path: string, mode: number): Promise<void>
}

/** A {@link RegistryFs} backed by `node:fs/promises`. See {@link nodeFs}. */
export function nodeRegistryFs(): RegistryFs {
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
  notifyBrowser: true,
  notifyNewActivity: true,
  notifyHumanIntervention: true,
  bridge: true,
  bridgeBrowser: true,
  onboardingDismissed: true,
  postMergeCleanup: true,
}

const PREFERENCE_KEYS = Object.keys(BOOLEAN_PREFERENCES) as BooleanPreferenceKey[]

/** Keep only the known preference fields, so a hand-edited or browser-supplied
 * object never lands junk (or the wrong type) in the user's home file. */
/** The color themes the dashboard offers (#725); anything else means the default `system`. */
const KNOWN_THEMES = ['system', 'light', 'dark'] as const

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
  // `driver` (#650) is constrained to the known set so junk never reaches the agent; the set is the
  // shared node-free vocabulary (driver-names.ts).
  if (isDriverName(input['driver'] as string | undefined)) preferences.driver = input['driver'] as string
  // `publish` is constrained to the picks the launcher's menu lists.
  if (isPublishPick(input['publish'])) preferences.publish = input['publish']
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
  const customPresets = sanitizeCustomPresets(input['customPresets'])
  if (customPresets.length) preferences.customPresets = customPresets
  return preferences
}

/**
 * Keep only the projects set to start from the local branch: a map from a project's id to the one
 * word `local`. Any other value is dropped (the main branch is the absent entry), and the map is
 * capped at {@link START_FROM_LIMIT} projects. An id is not checked against the project list: a
 * project removed and added again has the same id, and its pick with it.
 */
function sanitizeStartFrom(value: unknown): Record<string, 'local'> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const ids = Object.entries(value).filter(([id, from]) => id !== '' && from === 'local').map(([id]) => id)
  return Object.fromEntries(ids.slice(0, START_FROM_LIMIT).map(id => [id, 'local' as const]))
}

/**
 * Keep only well-formed custom presets (#626): each needs a non-empty id, label, and prompt;
 * label/prompt are trimmed and length-capped, the list capped at {@link CUSTOM_PRESET_LIMITS.count},
 * and duplicate ids dropped. A malformed entry is skipped, not thrown — a bad registry never breaks the read.
 */
export function sanitizeCustomPresets(value: unknown): CustomPreset[] {
  if (!Array.isArray(value)) return []
  const out: CustomPreset[] = []
  const seen = new Set<string>()
  for (const raw of value) {
    if (out.length >= CUSTOM_PRESET_LIMITS.count) break
    if (typeof raw !== 'object' || raw === null) continue
    const { id, label, prompt } = raw as Record<string, unknown>
    if (typeof id !== 'string' || typeof label !== 'string' || typeof prompt !== 'string') continue
    const trimmedId = id.trim()
    const trimmedLabel = label.trim().slice(0, CUSTOM_PRESET_LIMITS.label)
    const trimmedPrompt = prompt.trim().slice(0, CUSTOM_PRESET_LIMITS.prompt)
    if (!trimmedId || !trimmedLabel || !trimmedPrompt || seen.has(trimmedId)) continue
    seen.add(trimmedId)
    out.push({ id: trimmedId, label: trimmedLabel, prompt: trimmedPrompt })
  }
  return out
}

/** Keep well-formed machines, one per address (first wins), names and count capped. */
function sanitizeMachines(value: unknown): MachineRecord[] {
  if (!Array.isArray(value)) return []
  const machines: MachineRecord[] = []
  const seen = new Set<string>()
  for (const raw of value) {
    if (machines.length >= MACHINE_LIMITS.count) break
    if (typeof raw !== 'object' || raw === null) continue
    const { label, url, token } = raw as Record<string, unknown>
    if (typeof label !== 'string' || typeof url !== 'string' || typeof token !== 'string') continue
    if (!url || !token || seen.has(url)) continue
    seen.add(url)
    machines.push({ id: url, label: label.trim().slice(0, MACHINE_LIMITS.label) || url, url, token })
  }
  return machines
}

/**
 * Read the whole registry. Forgiving: a missing / unreadable / malformed file — or one in a shape
 * this no longer writes — yields an empty registry, never throws. Projects are deduped by resolved
 * path and unknown preference fields are dropped.
 */
export async function readRegistry(
  fs: RegistryFs = nodeRegistryFs(),
  env: NodeJS.ProcessEnv = process.env,
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
  const machines = sanitizeMachines(obj.machines)
  return {
    projects,
    preferences: sanitizePreferences(obj.preferences),
    // #1051: kept only as a non-empty string, so a hand-edited registry can't smuggle a junk token.
    ...(typeof obj.daemonToken === 'string' && obj.daemonToken ? { daemonToken: obj.daemonToken } : {}),
    ...(machines.length ? { machines } : {}),
  }
}

/**
 * Write the registry back as pretty object-form JSON, creating the parent dir.
 *
 * Atomic (#991): the JSON goes to a temp file beside the real one and is then renamed over it,
 * the same shape #922 gave the daemon state file. A direct write truncates first, so a crash, a
 * kill or a full disk mid-write left a half file — and {@link readRegistry} reports a malformed
 * file as an empty registry, so every project and preference vanished silently. A failed write
 * now only ever damages the temp file. The temp is left behind on failure rather than swept up:
 * one stray file is the cheaper half of that trade.
 *
 * Written owner-only (#1095): the file carries the daemon token, so a default-umask 0644 in a
 * shared home would hand it to every other account on the machine.
 * The mode is set on the temp file, before the rename — narrowing after it would leave a window
 * where the real path is readable. Best-effort: a filesystem with no permission bits still writes.
 */
async function writeRegistry(registry: Registry, fs: RegistryFs, env: NodeJS.ProcessEnv): Promise<void> {
  const file = registryPath(env)
  const { projects, preferences, daemonToken, machines } = registry
  const contents = {
    projects,
    preferences,
    ...(daemonToken ? { daemonToken } : {}),
    ...(machines?.length ? { machines } : {}),
  }
  const json = JSON.stringify(contents, null, 2)
  await fs.mkdir(dirname(file))
  const restrict = (path: string) => fs.chmod?.(path, REGISTRY_FILE_MODE).catch(() => {})
  if (!fs.rename) {
    await fs.write(file, json)
    await restrict(file)
    return
  }
  const temp = `${file}.${process.pid}.tmp`
  await fs.write(temp, json)
  await restrict(temp)
  await fs.rename(temp, file)
}

/**
 * Serializes the read-modify-write mutators below (#991). Each reads the whole registry, edits it
 * and writes it back, and one daemon runs several concurrently: `daemon.ts` and `daemon-runtime.ts`
 * both call {@link addProject} while the dashboard's savePreferences RPC writes through
 * {@link registryPreferencesStore}. Interleaved, the later write was computed from a read taken
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
  fs: RegistryFs = nodeRegistryFs(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<ProjectRecord[]> {
  return (await readRegistry(fs, env)).projects
}

/**
 * Register a project. Idempotent by resolved path: when the path is already
 * registered, the existing record is returned untouched (addedAt survives);
 * otherwise the new record is appended and the file written back (preferences preserved).
 */
export async function addProject(
  path: string,
  addedAt: string,
  fs: RegistryFs = nodeRegistryFs(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<ProjectRecord> {
  return serialize(async () => {
    const absolute = resolve(path)
    const registry = await readRegistry(fs, env)
    const existing = registry.projects.find(project => resolve(project.path) === absolute)
    if (existing) return existing

    const record: ProjectRecord = { id: projectId(absolute), path: absolute, addedAt }
    registry.projects.push(record)
    await writeRegistry(registry, fs, env)
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
  fs: RegistryFs = nodeRegistryFs(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<ProjectRecord | undefined> {
  return serialize(async () => {
    const registry = await readRegistry(fs, env)
    const removed = registry.projects.find(project => project.id === id)
    if (!removed) return undefined
    registry.projects = registry.projects.filter(project => project.id !== id)
    await writeRegistry(registry, fs, env)
    return removed
  })
}

/** The user's dashboard preferences (#410), or `{}` when none are stored. */
export async function readPreferences(
  fs: RegistryFs = nodeRegistryFs(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<Preferences> {
  return (await readRegistry(fs, env)).preferences
}

/** Persist the dashboard preferences (#410), sanitized, preserving the project list. */
export async function writePreferences(
  preferences: Preferences,
  fs: RegistryFs = nodeRegistryFs(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  return serialize(async () => {
    const registry = await readRegistry(fs, env)
    await writeRegistry({ ...registry, preferences: sanitizePreferences(preferences) }, fs, env)
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
  fs: RegistryFs = nodeRegistryFs(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<Preferences> {
  return serialize(async () => {
    const registry = await readRegistry(fs, env)
    const preferences = sanitizePreferences({ ...registry.preferences, ...patch })
    await writeRegistry({ ...registry, preferences }, fs, env)
    return preferences
  })
}

/**
 * The shared daemon token (#1051): read the persisted one, or generate + persist it now. Called
 * only on a non-loopback bind, so a loopback-only machine never grows one. Serialized with the
 * other mutators so two concurrent binds can't each write a different token. `base64url` of 32
 * random bytes: URL-safe, so it drops straight into a `?token=` without encoding.
 */
export async function ensureDaemonToken(
  fs: RegistryFs = nodeRegistryFs(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  return serialize(async () => {
    const registry = await readRegistry(fs, env)
    if (registry.daemonToken) return registry.daemonToken
    const daemonToken = randomBytes(32).toString('base64url')
    await writeRegistry({ ...registry, daemonToken }, fs, env)
    return daemonToken
  })
}

/** The persisted daemon token (#1051), or `undefined` when none exists. A pure read, so a process
 * that only prints the reachable URL never generates one. */
export async function readDaemonToken(
  fs: RegistryFs = nodeRegistryFs(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
  return (await readRegistry(fs, env)).daemonToken
}

/** The saved machines, newest first. Forgiving like every read of this file: none on a bad file. */
export async function listMachines(
  fs: RegistryFs = nodeRegistryFs(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<MachineRecord[]> {
  return (await readRegistry(fs, env)).machines ?? []
}

/**
 * Save a machine, newest first. One per address: saving an address again replaces its name and
 * its key, which is how a machine whose key changed is fixed. Answers the stored record.
 */
export async function addMachine(
  machine: { url: string; token: string; label?: string },
  fs: RegistryFs = nodeRegistryFs(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<MachineRecord> {
  return serialize(async () => {
    const registry = await readRegistry(fs, env)
    const record: MachineRecord = {
      id: machine.url,
      label: machine.label?.trim().slice(0, MACHINE_LIMITS.label) || hostOf(machine.url),
      url: machine.url,
      token: machine.token,
    }
    const machines = [record, ...(registry.machines ?? []).filter(saved => saved.id !== record.id)].slice(0, MACHINE_LIMITS.count)
    await writeRegistry({ ...registry, machines }, fs, env)
    return record
  })
}

/** Take a saved machine off the list, by id. Answers whether one was there. */
export async function removeMachine(
  id: string,
  fs: RegistryFs = nodeRegistryFs(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  return serialize(async () => {
    const registry = await readRegistry(fs, env)
    const machines = (registry.machines ?? []).filter(saved => saved.id !== id)
    if (machines.length === (registry.machines ?? []).length) return false
    await writeRegistry({ ...registry, machines }, fs, env)
    return true
  })
}

/** An address's host and port (`192.168.1.5:4200`): a machine's name when the person gave none. */
function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** A {@link PreferencesStore} bound to the real registry file, wired by the daemon so the
 * dashboard's preferences RPCs read/write the user's home file.
 *
 * `onChange` is handed **the keys the caller wrote**, not the merged result, so a listener can
 * tell "this write switched the setting on" from "it was already on and something else changed"
 * (#1161). It runs after the write has landed, and its failure is swallowed: the save succeeded,
 * and a listener must not be able to report otherwise: a setting saved in the browser has to
 * reach the daemon's own services without a restart.
 */
export function registryPreferencesStore(
  fs: RegistryFs = nodeRegistryFs(),
  env: NodeJS.ProcessEnv = process.env,
  onChange?: (written: Preferences) => void,
): PreferencesStore {
  const changed = <T>(written: Preferences, result: T): T => {
    try {
      onChange?.(written)
    } catch {
      // The write landed; a listener that throws is not the writer's problem.
    }
    return result
  }
  return {
    read: () => readPreferences(fs, env),
    save: async preferences => changed(preferences, await writePreferences(preferences, fs, env)),
    patch: async patch => changed(patch, await patchPreferences(patch, fs, env)),
  }
}
