import { withLockFile } from '@openagt/git-branches'
import { changesOf, StoreOrder, type Store, type StoreBackend } from '@openagt/hooks'
import { filesIn, listIn, readIn, watchIn, writeIn } from './files.js'
import { foldersOf, lockFile, scopeFolder, type Folders } from './folders.js'

/**
 * The end of the store's chain: every scope's files, in its folder on this computer. A save takes
 * its scope's lock file first, so a save made from the files as they are (a setting set beside the
 * others) is made from what the save before it wrote, in this process or another one.
 */
export function filesystemStore(folders: Folders): Store {
  return {
    read: (scope, path) => readIn(scopeFolder(scope, folders), path),
    list: (scope, dir) => listIn(scopeFolder(scope, folders), dir),
    save: (scope, changes, _message) =>
      withLockFile(lockFile(scope, folders), {}, async () => {
        const folder = scopeFolder(scope, folders)
        await writeIn(folder, await changesOf(changes, filesIn(folder)))
      }),
    watch: (scope, path, onChange) => watchIn(scopeFolder(scope, folders), path, onChange),
  }
}

/**
 * The filesystem store as a link of the chain, the last one: it passes nothing on. With no folders
 * given, its folders are the environment's at each call, as every other reader of the personal
 * folder finds it.
 */
export function filesystemBackend(opts: { folders?: Folders } = {}): StoreBackend {
  const { folders } = opts
  return {
    order: StoreOrder.FILESYSTEM,
    wrap: () => (folders ? filesystemStore(folders) : madeAtEachCall(() => filesystemStore(foldersOf()))),
  }
}

/** A store made anew for each call: one whose folders are the environment's as it is then. */
export function madeAtEachCall(make: () => Store): Store {
  return {
    read: (scope, path, opts) => make().read(scope, path, opts),
    list: (scope, dir, opts) => make().list(scope, dir, opts),
    save: (scope, changes, message) => make().save(scope, changes, message),
    watch: (scope, path, onChange) => make().watch(scope, path, onChange),
  }
}
