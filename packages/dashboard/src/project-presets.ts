import { join } from 'node:path'
import { OPENAGENT_DIR } from './openagent-dir.js'
import { sanitizeCustomPresets, type CustomPreset } from './registry.js'
import { nodeStoreFs, type StoreFs } from './store/index.js'

/**
 * Project-scoped custom presets (#1025).
 *
 * The user tier (#626) saves a custom preset to the user's home file, so it follows the person
 * across every project and stays private. The project tier saves it into the repo instead, so it
 * travels with the code and everyone who clones the repo gets it — the "share your presets" half
 * of the issue.
 *
 * The store is a plain JSON array of {@link CustomPreset}, the exact shape the user tier uses, so
 * the dashboard renders both from one type and the same sanitizer guards both files.
 */

/** The committed file holding a project's shared custom presets, under `.openagent/`. */
export const PROJECT_PRESETS_FILE = `${OPENAGENT_DIR}/custom-presets.json`

/** The `.openagent/.gitignore` line that un-ignores the presets file so git tracks it. */
const GITIGNORE_NEGATION = '!custom-presets.json'

function gitignorePath(cwd: string): string {
  return join(cwd, OPENAGENT_DIR, '.gitignore')
}

/**
 * Read a project's shared custom presets. Forgiving like every other read here: a missing,
 * unreadable or malformed file yields `[]`, never throws, and the same sanitizer that guards
 * the home file drops any hand-edited or hostile entry.
 */
export async function readProjectPresets(
  cwd: string,
  fs: StoreFs = nodeStoreFs(),
): Promise<CustomPreset[]> {
  let raw: string
  try {
    raw = await fs.read(join(cwd, PROJECT_PRESETS_FILE))
  } catch {
    return []
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  return sanitizeCustomPresets(parsed)
}

/**
 * Write a project's shared custom presets, sanitizing first so the committed file is always
 * well-formed. Also ensures `.openagent/.gitignore` un-ignores the file: the dir's ignore is
 * `*` (nothing is tracked by default), so without a negation git would
 * never see the presets and they could not be shared. Removing every preset writes an empty array
 * rather than deleting the file, so the negation stays in place for the next save.
 */
export async function writeProjectPresets(
  cwd: string,
  presets: CustomPreset[],
  fs: StoreFs = nodeStoreFs(),
): Promise<void> {
  await fs.mkdir(join(cwd, OPENAGENT_DIR))
  await ensureGitignoreNegation(cwd, fs)
  const sanitized = sanitizeCustomPresets(presets)
  await fs.write(join(cwd, PROJECT_PRESETS_FILE), `${JSON.stringify(sanitized, null, 2)}\n`)
}

/** Append the un-ignore line to `.openagent/.gitignore` unless it is already there. */
async function ensureGitignoreNegation(cwd: string, fs: StoreFs): Promise<void> {
  const path = gitignorePath(cwd)
  let current = ''
  try {
    current = await fs.read(path)
  } catch {
    // No .gitignore yet (a pre-install dir): the negation only bites once the `*` ignore exists,
    // so writing a bare negation is harmless and self-heals when install adds the rest.
  }
  if (current.split('\n').some(line => line.trim() === GITIGNORE_NEGATION)) return
  const prefix = current && !current.endsWith('\n') ? `${current}\n` : current
  await fs.write(path, `${prefix}${GITIGNORE_NEGATION}\n`)
}
