import { nodeBranchFileFs, withProjectData, type BranchFileFs, type CommitMessage, type FileBranchWrite } from '@openagt/agent-data'

// Where the queue lives: `TODO_AGENTS.md` at the root of the project's data directory (its
// directory in the personal folder, or the checkout of its `agent-data` branch when shared).

/** The plain-file seams an operation on the branch's files needs. */
export type QueueFiles = BranchFileFs

/**
 * A caller's write funnel: apply `op` to a checkout of the branch, commit, push. The default is
 * the persistent checkout's serialized cycle; a test's fake stands in.
 */
export type QueueFunnel = (root: string, message: CommitMessage, op: (dir: string) => Promise<void>) => Promise<FileBranchWrite>

/** Injectable seams so every operation is unit-testable off disk and git; production takes the defaults. */
export interface QueueDeps extends Partial<QueueFiles> {
  funnel?: QueueFunnel
}

/** The default funnel: the project's data write. */
const queueFunnel: QueueFunnel = (root, message, op) => withProjectData(root, message, op)

/** Fill in whatever a caller left out, so an operation reads the same way in tests and out. */
export function resolveQueueDeps(deps: QueueDeps): QueueFiles & { funnel: QueueFunnel } {
  const fs = nodeBranchFileFs()
  return {
    read: deps.read ?? fs.read,
    write: deps.write ?? fs.write,
    remove: deps.remove ?? fs.remove,
    list: deps.list ?? fs.list,
    funnel: deps.funnel ?? queueFunnel,
  }
}
