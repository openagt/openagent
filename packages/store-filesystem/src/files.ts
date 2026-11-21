import { watch, type FSWatcher } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises'
import { basename, dirname, join, sep } from 'node:path'
import { checkPath, isUnder, type Changes, type ScopeFiles } from '@openagt/hooks'

// The files of one folder, by store path: how this store reads, lists, writes and watches a
// scope's folder, and how a git store writes the checkout it commits. Every file is written
// whole, through a file beside it renamed into place, so a reader never sees half of one.

/** What a file being written is called until it is renamed into place: never listed, never told to a watcher. */
const WRITING = '.openagent-writing'

/** A file's place on disk, from its store path. */
function onDisk(folder: string, path: string): string {
  return join(folder, ...checkPath(path).split('/'))
}

/** Whether a failed read means there is nothing there: no such file, or a file where a folder was looked for. */
function isMissing(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException).code
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR'
}

/** A file's text in `folder`; none when there is no such file. */
export async function readIn(folder: string, path: string): Promise<string | undefined> {
  return readFile(onDisk(folder, path), 'utf8').catch((err: unknown) => {
    if (isMissing(err)) return undefined
    throw err
  })
}

/** Whether an entry is one the store keeps: git's own folder and a file being written are not. */
function isKept(name: string): boolean {
  return name !== '.git' && !name.endsWith(WRITING)
}

/** The files under `dir` in `folder` (`''` for all of them), each by its path from the folder's top, sorted; none when it is not there. */
export async function listIn(folder: string, dir: string): Promise<string[]> {
  checkPath(dir, { dir: true })
  const found: string[] = []
  const walk = async (rel: string): Promise<void> => {
    const at = rel === '' ? folder : onDisk(folder, rel)
    const entries = await readdir(at, { withFileTypes: true }).catch((err: unknown) => {
      if (isMissing(err)) return []
      throw err
    })
    for (const entry of entries) {
      if (!isKept(entry.name)) continue
      const path = rel === '' ? entry.name : `${rel}/${entry.name}`
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile()) found.push(path)
    }
  }
  await walk(dir)
  return found.sort()
}

/** `folder`'s files, as a save made from them reads them. */
export function filesIn(folder: string): ScopeFiles {
  return { read: path => readIn(folder, path), list: dir => listIn(folder, dir) }
}

/**
 * Write `changes` into `folder`: each file whole, its folders made; a file given `null` removed,
 * with every folder that leaves empty, since a git store keeps no empty folder either.
 */
export async function writeIn(folder: string, changes: Changes): Promise<void> {
  for (const [path, text] of Object.entries(changes)) {
    const file = onDisk(folder, path)
    if (text === null) {
      await rm(file, { force: true })
      await removeEmpty(folder, dirname(file))
      continue
    }
    await mkdir(dirname(file), { recursive: true })
    const writing = join(dirname(file), `.${basename(file)}.${process.pid}${WRITING}`)
    await writeFile(writing, text, 'utf8')
    await rename(writing, file)
  }
}

/** Remove `dir` and each folder above it that is left empty, up to `folder`, which stays. */
async function removeEmpty(folder: string, dir: string): Promise<void> {
  for (let at = dir; at.startsWith(folder + sep); at = dirname(at)) {
    if (!(await rmdir(at).then(() => true, () => false))) return
  }
}

/**
 * Call `onChange` with the store path of each entry under `dir` in `folder` that changes, until the
 * function it answers is called. The folder is made when it is not there yet, so it can be watched.
 */
export function watchIn(folder: string, dir: string, onChange: (path: string) => void): () => void {
  checkPath(dir, { dir: true })
  let watcher: FSWatcher | undefined
  let stopped = false
  void mkdir(folder, { recursive: true })
    .then(() => {
      if (stopped) return
      watcher = watch(folder, { recursive: true }, (_event, name) => {
        if (name === null) return
        const path = name.split(sep).join('/')
        if (!path.split('/').every(isKept)) return
        if (isUnder(path, dir)) onChange(path)
      })
      // A folder removed from under the watcher ends it: there is nothing left to tell.
      watcher.on('error', () => watcher?.close())
    })
    .catch(() => {})
  return () => {
    stopped = true
    watcher?.close()
  }
}
