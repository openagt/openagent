/**
 * How far a run takes its work when its agent finishes, node-free so every surface shares
 * one copy: the registry's preference sanitizer, the daemon's Start and the dashboard bundle.
 * The levels are the words a project's start hook is handed as `PUBLISH`, the ones
 * `agent-runner run --publish` takes, and what the launcher's menu lists. Every level starts
 * with the commit: an agent commits its work in any case, since the branches skill in its
 * checkout asks for a clean branch. Until a person picks, a run commits its work and pushes
 * nothing: what leaves the machine is the person's to ask for.
 */

/** The levels a run can be started at, each going further than the one before. */
export const PUBLISH_LEVELS = ['commit', 'branch', 'pr', 'merge'] as const

/** A level: commit the work, and from there push the branch, open its pull request, or open it set to merge once its checks pass. */
export type PublishLevel = (typeof PUBLISH_LEVELS)[number]

export const PUBLISH_LABELS: Readonly<Record<PublishLevel, string>> = {
  commit: 'Commit',
  branch: 'Publish branch',
  pr: 'Open PR',
  merge: 'Merge on green',
}

export function isPublishLevel(value: unknown): value is PublishLevel {
  return (PUBLISH_LEVELS as readonly unknown[]).includes(value)
}

/**
 * The levels a project is offered: every one where it has a git host; without a git host no pull
 * request can be opened, so they stop at the branch; without a remote nothing can be
 * published at all, so the commit is the only one.
 */
export function offeredPublishLevels(gitHost: boolean, remote = true): readonly PublishLevel[] {
  if (!remote) return ['commit']
  return gitHost ? PUBLISH_LEVELS : ['commit', 'branch']
}

/** The furthest a project's run goes with no pull request: its branch pushed, or its work committed where there is no remote. */
function furthestWithoutRequest(remote: boolean): PublishLevel {
  return remote ? 'branch' : 'commit'
}

/**
 * The level in force in this project. Until a person saves one it is Commit, which pushes nothing.
 * A saved level the project is not offered falls back to the furthest it goes with no pull request.
 */
export function publishLevelIn(saved: PublishLevel | undefined, gitHost: boolean, remote = true): PublishLevel {
  if (saved === undefined) return 'commit'
  if (offeredPublishLevels(gitHost, remote).includes(saved)) return saved
  return furthestWithoutRequest(remote)
}
