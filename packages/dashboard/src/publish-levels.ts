/**
 * How far a run takes its work when its agent finishes, node-free so every surface shares
 * one copy: the registry's preference sanitizer, the daemon's Start and the dashboard bundle.
 * The levels are the words a project's start hook is handed as `PUBLISH`, the ones
 * `agent-runner run --publish` takes. The launcher's menu offers them after "Off", the pick
 * that hands the hook no level: nothing is added to the person's message then, and whether the
 * agent commits is its own, by the branches skill in its checkout.
 * Until a person picks, a run commits its work and pushes nothing: what leaves the machine is the
 * person's to ask for.
 */

/** The levels a run can be started at, each going further than the one before. */
export const PUBLISH_LEVELS = ['commit', 'branch', 'pr', 'merge'] as const

/** A level: commit the work, and from there push the branch, open its pull request, or open it set to merge once its checks pass. */
export type PublishLevel = (typeof PUBLISH_LEVELS)[number]

/** What the launcher's menu lists, in its order: nothing, then each level. */
export const PUBLISH_PICKS = ['nothing', ...PUBLISH_LEVELS] as const

/** A pick of the launcher's menu. */
export type PublishPick = (typeof PUBLISH_PICKS)[number]

export const PUBLISH_LABELS: Readonly<Record<PublishPick, string>> = {
  nothing: 'Off',
  commit: 'Commit',
  branch: 'Publish branch',
  pr: 'Open PR',
  merge: 'Merge on green',
}

export function isPublishPick(value: unknown): value is PublishPick {
  return (PUBLISH_PICKS as readonly unknown[]).includes(value)
}

/**
 * The picks a project is offered: every one where it has a git host; without a git host no pull
 * request can be opened, so the picks stop at the branch; without a remote nothing can be
 * published at all, so they stop at the commit.
 */
export function offeredPublishPicks(gitHost: boolean, remote = true): readonly PublishPick[] {
  if (!remote) return ['nothing', 'commit']
  return gitHost ? PUBLISH_PICKS : ['nothing', 'commit', 'branch']
}

/** The furthest a project's run goes with no pull request: its branch pushed, or its work committed where there is no remote. */
function furthestWithoutRequest(remote: boolean): PublishPick {
  return remote ? 'branch' : 'commit'
}

/**
 * The pick in force in this project. Until a person saves one it is Commit, which pushes nothing.
 * A saved pick the project is not offered falls back to the furthest it goes with no pull request.
 */
export function publishPickIn(saved: PublishPick | undefined, gitHost: boolean, remote = true): PublishPick {
  if (saved === undefined) return 'commit'
  if (offeredPublishPicks(gitHost, remote).includes(saved)) return saved
  return furthestWithoutRequest(remote)
}

/** The level a pick hands the start hook; none for Off. */
export function publishLevelOf(pick: PublishPick): PublishLevel | undefined {
  return pick === 'nothing' ? undefined : pick
}
