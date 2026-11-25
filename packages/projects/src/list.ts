import { isAbsolute, resolve } from 'node:path'
import { stat } from 'node:fs/promises'
import { projectId } from './project-id.js'
import { projectNameOf, repositoryAddress, defineSetting, PROJECTS, type ProjectRecord, type ProjectRef, type Settings } from '@openagt/hooks'

// The list of projects on this computer (#390, #2394): the PROJECTS setting of the catalog, which
// only this module writes and the shell reads, for its sidebar, its routes and every read that
// finds a project's folder by its id. Each write reads the list as the store has it then, so a
// project added while another is removed keeps both changes.

/**
 * The folders the person added to look for repos in, beside the home folder (`repos.ts`), each
 * absolute and listed once. This module's alone: Settings › Repos shows and changes it.
 */
export const REPO_FOLDERS = defineSetting<string[]>({
  key: 'projects.folders',
  scope: 'computer',
  default: [],
  parse: value => (Array.isArray(value) ? [...new Set(value.filter((folder): folder is string => typeof folder === 'string' && isAbsolute(folder)))].slice(0, MAX_REPO_FOLDERS) : undefined),
})

/** The cap on added repo folders, so a hand-edited file cannot make a crawl of everything. */
export const MAX_REPO_FOLDERS = 50

/** Writes of the list one at a time in this process: each reads the list, changes it and saves it back. */
let writes: Promise<unknown> = Promise.resolve()

function oneAtATime<T>(write: () => Promise<T>): Promise<T> {
  const result = writes.then(write)
  // A failed write must not stop the next; its caller still gets the error.
  writes = result.catch(() => {})
  return result
}

/**
 * Put the folder at `path` on the list. Idempotent by its resolved path: a folder on the list
 * already answers its record as it is (`addedAt` stays), with `added` false.
 */
export function listProject(settings: Settings, path: string, addedAt: string): Promise<{ record: ProjectRecord; added: boolean }> {
  return oneAtATime(async () => {
    const absolute = resolve(path)
    const listed = await settings.get(PROJECTS)
    const there = listed.find(project => resolve(project.path) === absolute)
    if (there) return { record: there, added: false }
    const record: ProjectRecord = { id: projectId(absolute), path: absolute, addedAt }
    await settings.set(PROJECTS, [...listed, record])
    return { record, added: true }
  })
}

/** Take the project `id` off the list: its record, or nothing when no project has that id. Nothing in its folder is touched. */
export function unlistProject(settings: Settings, id: string): Promise<ProjectRecord | undefined> {
  return oneAtATime(async () => {
    const listed = await settings.get(PROJECTS)
    const record = listed.find(project => project.id === id)
    if (record) await settings.set(PROJECTS, listed.filter(project => project.id !== id))
    return record
  })
}

/** Add a folder to look for repos in, by its absolute path; one already there, or one past the cap, is not added. */
export function addRepoFolder(settings: Settings, folder: string): Promise<void> {
  return oneAtATime(async () => {
    const absolute = resolve(folder)
    const folders = await settings.get(REPO_FOLDERS)
    if (folders.includes(absolute) || folders.length >= MAX_REPO_FOLDERS) return
    await settings.set(REPO_FOLDERS, [...folders, absolute])
  })
}

/** Stop looking for repos in a folder the person added; one not there changes nothing. */
export function removeRepoFolder(settings: Settings, folder: string): Promise<void> {
  return oneAtATime(async () => {
    const folders = await settings.get(REPO_FOLDERS)
    if (folders.includes(folder)) await settings.set(REPO_FOLDERS, folders.filter(one => one !== folder))
  })
}

/** Whether `path` is a folder on this computer. */
export async function isFolder(path: string): Promise<boolean> {
  return stat(path).then(s => s.isDirectory(), () => false)
}

/** The project at `dir`, as a hook is given it: its name and its repository's address read off its clone. */
export async function projectRefAt(id: string, dir: string): Promise<ProjectRef> {
  const remote = await repositoryAddress(dir)
  return { id, name: await projectNameOf(dir), dir, ...(remote !== undefined ? { remote } : {}) }
}
