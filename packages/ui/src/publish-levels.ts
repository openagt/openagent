import type { Publish } from '@openagt/hooks'

/**
 * How far a run takes its work when its agent finishes, node-free so every surface shares
 * one copy: the registry's preference sanitizer, the daemon's Start and the dashboard bundle.
 * The levels are the run options' (`RunOptions.publish`); the Auto menu draws the ones the modules
 * offer (`composer.auto`) after "Off", the pick that hands the run no level: nothing is added to
 * the person's message then, and whether the agent commits is its own, by the skills in its
 * checkout. Until a person picks, a run commits its work and pushes nothing: what leaves the
 * machine is the person's to ask for.
 */

/** A level: commit the work, and from there push the branch, open its pull request, or open it set to merge once its checks pass. */
export type PublishLevel = Publish

/** What the Auto menu can pick, in its order: nothing, then each level, each going further than the one before. Spelled here, not imported: the dashboard's bundle takes no value from the hooks' Node entry. */
export const PUBLISH_PICKS = ['nothing', 'commit', 'branch', 'pr', 'merge'] as const satisfies readonly ('nothing' | Publish)[]

/** A pick of the Auto menu. */
export type PublishPick = (typeof PUBLISH_PICKS)[number]

export function isPublishPick(value: unknown): value is PublishPick {
  return (PUBLISH_PICKS as readonly unknown[]).includes(value)
}

/**
 * The pick in force among the picks `offered`. Until a person saves one it is Commit, which pushes
 * nothing. A saved pick that is not offered falls back to the furthest offered short of it: with
 * no git host a pull request's level goes as far as the branch, with no remote as far as the commit.
 */
export function pickIn(saved: PublishPick | undefined, offered: readonly PublishPick[]): PublishPick {
  const wanted = saved ?? 'commit'
  if (offered.includes(wanted)) return wanted
  const reach = PUBLISH_PICKS.indexOf(wanted)
  return [...offered].reverse().find(pick => PUBLISH_PICKS.indexOf(pick) <= reach) ?? 'nothing'
}

/**
 * The pick in force in a project, as a Start decides it whichever page sent it: every level is
 * offered where the project has a git host; without one no pull request can be opened, so the
 * levels stop at the branch; without a remote nothing can be published, so they stop at the commit.
 */
export function publishPickIn(saved: PublishPick | undefined, gitHost: boolean, remote = true): PublishPick {
  return pickIn(saved, !remote ? ['nothing', 'commit'] : gitHost ? PUBLISH_PICKS : ['nothing', 'commit', 'branch'])
}

/** The level a pick hands the run; none for Off. */
export function publishLevelOf(pick: PublishPick): PublishLevel | undefined {
  return pick === 'nothing' ? undefined : pick
}
