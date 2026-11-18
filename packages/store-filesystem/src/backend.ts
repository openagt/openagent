import { withLockFile } from '@openagt/agent-data'
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

/** The filesystem store as a link of the chain, the last one: it passes nothing on. Its folders are the environment's when none are given. */
export function filesystemBackend(opts: { folders?: Folders } = {}): StoreBackend {
  return {
    order: StoreOrder.FILESYSTEM,
    wrap: () => filesystemStore(opts.folders ?? foldersOf()),
  }
}
