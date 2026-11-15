import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { personalFolder, withPersonalFolder, type PersonalFolderDeps } from './personal-folder.js'
import type { FileBranchWrite } from './file-branch.js'

/**
 * The person's own name and picture, as OpenAgent shows them: theirs to set, not a git host's.
 * One file in the personal folder, `person.json`, so every computer of theirs that syncs the
 * folder shows the same. A picture is an https address the page loads; the person may copy their
 * name and picture once from a git host account (`github` names the one), and nothing is asked of
 * the git host after that.
 */
export interface PersonRecord {
  name: string
  /** A picture of them: an https address. */
  picture?: string
  /** The GitHub login the name and picture were last copied from. */
  github?: string
}

/** The file in the personal folder. */
export const PERSON_FILE = 'person.json'

/** What a person may be called: one line, at most 60 characters. */
export function isPersonRecordName(name: unknown): name is string {
  return typeof name === 'string' && name.trim().length > 0 && name.trim().length <= 60 && !/[\u0000-\u001f\u007f]/.test(name)
}

/** A picture's address OpenAgent keeps: only one on the web. */
export function isPictureAddress(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2000) return false
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

/** The person as their file says, read strictly; none when there is no file or it says no name. */
export async function readPersonRecord(folder: string = personalFolder()): Promise<PersonRecord | undefined> {
  const text = await readFile(join(folder, PERSON_FILE), 'utf8').catch(() => undefined)
  if (text === undefined) return undefined
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof raw !== 'object' || raw === null) return undefined
  const { name, picture, github } = raw as Record<string, unknown>
  if (!isPersonRecordName(name)) return undefined
  return { name: name.trim(), ...(isPictureAddress(picture) ? { picture } : {}), ...(typeof github === 'string' && github ? { github } : {}) }
}

/** Write the person's file, committed in the personal folder, so it goes to every computer that syncs it. */
export async function writePersonRecord(record: PersonRecord, deps: PersonalFolderDeps = {}): Promise<FileBranchWrite> {
  const folder = deps.folder ?? personalFolder()
  const body = JSON.stringify({ name: record.name.trim(), ...(record.picture ? { picture: record.picture } : {}), ...(record.github ? { github: record.github } : {}) }, null, 2) + '\n'
  return withPersonalFolder(
    folder,
    'update the person',
    async () => {
      await mkdir(folder, { recursive: true })
      await writeFile(join(folder, PERSON_FILE), body)
    },
    deps,
  )
}

/** Forget the person's file: their name is the computer's again, with no picture. */
export async function removePersonRecord(deps: PersonalFolderDeps = {}): Promise<FileBranchWrite> {
  const folder = deps.folder ?? personalFolder()
  return withPersonalFolder(folder, 'forget the person', () => rm(join(folder, PERSON_FILE), { force: true }), deps)
}
