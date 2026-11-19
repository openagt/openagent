/**
 * Where a step stands in the run pipeline (`run.step`), the way universal-middleware orders
 * middleware around its handler: below 0 a step prepares the run, at 0 are the agent's turns,
 * above 0 a step finishes it. A step may stand anywhere between two of these; steps at the same
 * place run in the distribution's order.
 */
export const RunOrder = {
  /**
   * github, agent-driver: the accounts the run works as, first of all: everything of the run that
   * reaches a remote goes as them, from the project's clone and its checkout's fetch on.
   */
  ACCOUNTS: -600,
  /** projects: the project's repo is on this machine. */
  CLONE: -500,
  /** git-branches: the run's own worktree. */
  WORKSPACE: -400,
  /** skills: the run's skills linked into its worktree. */
  SKILLS: -300,
  /** What the prompt gets before the agent starts. */
  CONTEXT: -100,
  /** agent-driver: the agent's turns. */
  RUN: 0,
  /** The run's record saved, its pull request read back. */
  RECORD: 100,
  /** git-branches: the worktree reclaimed. */
  CLEANUP: 200,
  /** Telling people how the run ended. */
  NOTIFY: 800,
} as const

/**
 * Where a backend stands in the store's chain (`store.backend`): a lower one wraps a higher one,
 * so it sees each call first and passes on what it does not keep. The filesystem store stands
 * last, the end of the chain.
 */
export const StoreOrder = {
  /** store-git-branch: a shared project's data, on its branch. */
  GIT_BRANCH: -200,
  /** store-git-repository: the person's folder, synced with a repository of theirs. */
  GIT_REPOSITORY: -100,
  /** store-filesystem: files on this computer. */
  FILESYSTEM: 1000,
} as const
