import { DATA_BRANCH, nodeGitRunner } from '@openagt/git-branches'
import { ensureFileBranch, fileBranchPath, listBranchFiles, openBranchReader, readBranchFile, readSharing, withFileBranch, writeFileBranchDetached, type BranchReader, type FileBranchDeps, filesIn, listIn, watchIn, writeIn } from '@openagt/store-filesystem'
import { changesOf, StoreOrder, type ProjectRef, type Scope, type Store, type StoreBackend, type StoreContext } from '@openagt/hooks'

/**
 * A shared project's data on its repository's `agent-data` branch: the project the person shares
 * (the repository's own `agent-data.share` setting) is kept here, every other scope is passed on.
 *
 * A long-lived process (the app, a run) works in the clone's checkout of the branch,
 * `.branches/agent-data`: a save takes in what origin has, writes its files there with the
 * filesystem store's writer, commits and pushes; one whose push lost a race is made once more from
 * the files as they are then. A read is the checkout's, or origin's copy, fetched first, when it is
 * fresh. A one-shot process (a command an agent runs) keeps no checkout: it reads origin's copy,
 * fetched once, and writes through a throwaway checkout of origin's tip, pushed straight to the
 * branch.
 */
export function gitBranchStore(next: Store, context: StoreContext, deps: FileBranchDeps = {}): Store {
  const git = deps.git ?? nodeGitRunner()
  const shared = async (scope: Scope): Promise<ProjectRef | undefined> =>
    scope.kind === 'project' && (await readSharing(scope.project.dir, git)) ? scope.project : undefined
  // A one-shot process's reads of each project: origin's copy, fetched once, and again after each
  // of its own writes, which go straight to origin.
  const readers = new Map<string, Promise<BranchReader>>()
  const reader = (project: ProjectRef): Promise<BranchReader> => {
    let open = readers.get(project.id)
    if (!open) {
      open = openBranchReader(project.dir, DATA_BRANCH, deps)
      readers.set(project.id, open)
    }
    return open
  }
  /** The checkout of the branch, when it is there and on the branch: what a long-lived process reads. */
  const checkout = async (project: ProjectRef): Promise<string | undefined> => {
    const path = await fileBranchPath(project.dir, DATA_BRANCH, git)
    const on = await git(['rev-parse', '--abbrev-ref', 'HEAD'], path).then(
      out => out.trim() === DATA_BRANCH,
      () => false,
    )
    return on ? path : undefined
  }
  return {
    async read(scope, path, opts) {
      const project = await shared(scope)
      if (!project) return next.read(scope, path, opts)
      if (context.oneShot) return (await reader(project)).read(path)
      return readBranchFile(project.dir, DATA_BRANCH, path, opts?.fresh ? { fresh: true } : {}, deps)
    },
    async list(scope, dir, opts) {
      const project = await shared(scope)
      if (!project) return next.list(scope, dir, opts)
      if (context.oneShot) return (await reader(project)).files(dir)
      const at = opts?.fresh ? undefined : await checkout(project)
      return at !== undefined ? listIn(at, dir) : listBranchFiles(project.dir, DATA_BRANCH, dir, opts?.fresh ? { fresh: true } : {}, deps)
    },
    async save(scope, changes, message) {
      const project = await shared(scope)
      if (!project) return next.save(scope, changes, message)
      // What the last making of the save threw: the branch's write reports it only as words.
      let thrown: { error: unknown } | undefined
      const write = async (dir: string): Promise<void> => {
        thrown = undefined
        try {
          await writeIn(dir, await changesOf(changes, filesIn(dir)))
        } catch (error) {
          thrown = { error }
          throw error
        }
      }
      if (context.oneShot) {
        try {
          await writeFileBranchDetached(project.dir, DATA_BRANCH, message, write, deps)
        } catch (error) {
          throw thrown ? thrown.error : error
        } finally {
          readers.delete(project.id)
        }
        return
      }
      const written = await withFileBranch(project.dir, DATA_BRANCH, message, write, deps)
      if (thrown) throw thrown.error
      // Committed but not pushed: kept here, and the next save or pull sends it.
      if (!written.ok && !written.committed) throw new Error(written.error)
    },
    watch(scope, path, onChange) {
      if (scope.kind !== 'project') return next.watch(scope, path, onChange)
      if (context.oneShot) throw new Error('A command keeps no checkout of a shared project to watch')
      let stop: (() => void) | undefined
      let stopped = false
      void (async () => {
        const project = await shared(scope)
        if (stopped) return
        if (!project) {
          stop = next.watch(scope, path, onChange)
          return
        }
        await ensureFileBranch(project.dir, DATA_BRANCH, deps)
        const at = await fileBranchPath(project.dir, DATA_BRANCH, git)
        if (!stopped) stop = watchIn(at, path, onChange)
      })().catch(() => {})
      return () => {
        stopped = true
        stop?.()
      }
    },
  }
}

/** The git branch store as a link of the chain, outermost: it sees a shared project's calls before the person's folder does. */
export function gitBranchBackend(opts: { deps?: FileBranchDeps } = {}): StoreBackend {
  return {
    order: StoreOrder.GIT_BRANCH,
    wrap: (next, context) => gitBranchStore(next, context, opts.deps),
  }
}
