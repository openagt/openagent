import { withPersonalFolder, type PersonalFolderDeps, foldersOf, madeAtEachCall, type Folders } from '@openagt/store-filesystem'
import { StoreOrder, type Scope, type Store, type StoreBackend } from '@openagt/hooks'

/**
 * The person's own folder as a git repository: every save to a scope kept there (the person's,
 * and each project's that stays on this computer) is one commit, pushed when the folder syncs
 * with a repository of the person's; a fresh read first takes in what their other computers
 * pushed. The store below writes the files: this one makes their commit.
 *
 * A save whose push lost a race takes the remote in again and is made once more, from the files
 * as they are then. A push that still fails, or that has no account to go as, keeps the commit
 * here, and the next save or fresh read sends it: the save is kept all the same. This computer's
 * scope is not in the folder, and is passed on untouched.
 */
export function gitRepositoryStore(next: Store, folders: Folders, deps: PersonalFolderDeps = {}): Store {
  const inFolder = (scope: Scope): boolean => scope.kind !== 'computer'
  // Takes in what the remote has and sends what waits here. One that fails reads what is here.
  const sync = (): Promise<unknown> => withPersonalFolder(folders.personal, 'sync', async () => {}, deps)
  return {
    async read(scope, path, opts) {
      if (opts?.fresh && inFolder(scope)) await sync()
      return next.read(scope, path, opts)
    },
    async list(scope, dir, opts) {
      if (opts?.fresh && inFolder(scope)) await sync()
      return next.list(scope, dir, opts)
    },
    async save(scope, changes, message) {
      if (!inFolder(scope)) return next.save(scope, changes, message)
      // What the last making of the save threw: the folder's write reports it only as words.
      let thrown: { error: unknown } | undefined
      const written = await withPersonalFolder(
        folders.personal,
        message,
        async () => {
          thrown = undefined
          try {
            await next.save(scope, changes, message)
          } catch (error) {
            thrown = { error }
            throw error
          }
        },
        deps,
      )
      if (thrown) throw thrown.error
      if (!written.ok && !written.committed) throw new Error(written.error)
    },
    watch: (scope, path, onChange) => next.watch(scope, path, onChange),
  }
}

/** The git repository store as a link of the chain, wrapping the filesystem store. With no folders given, they are the environment's at each call. */
export function gitRepositoryBackend(opts: { folders?: Folders; deps?: PersonalFolderDeps } = {}): StoreBackend {
  const { folders, deps } = opts
  return {
    order: StoreOrder.GIT_REPOSITORY,
    wrap: next => (folders ? gitRepositoryStore(next, folders, deps) : madeAtEachCall(() => gitRepositoryStore(next, foldersOf(), deps))),
  }
}
