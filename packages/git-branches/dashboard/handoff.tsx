import { GitBranchPlus, Undo2, Upload } from 'lucide-react'
import type { UiActionAt, UiActionResult, UiHost, UiOffer } from '@openagt/ui/module'
import { forgetHandoff, mainBranchName, readHandoff, server, type Handoff, type Pressed, type WorkOn } from './calls.js'

// The next steps of an ended run's work, in the bar above its message box (`chat.handoff`): for
// the run's own checkout, and for each of its copies of repos (`repo`). Each action says, through
// its offer, whether it is offered now and how, from what the branch holds (`../src/handoff.ts`).
//
// Uncommitted work comes before every other step: a push would be refused while the checkout is
// unclean, and a merge would leave the newest work behind. The work is named, and the agent is
// asked to commit it: it knows what it changed and writes the message, and nothing is committed on
// its behalf. A branch with no remote reaches the project's own folder by a merge on this machine,
// and a copy of a repo with no remote goes back to the folder it was copied from. A branch with a
// remote is published, by a push: what goes further, a pull request, is the git host's module's,
// whose press comes first where it has one, this one then under its arrow. A run that changed
// nothing offers nothing: silence says it. A reason is said only where something was left behind
// the person may act on.

/** The steps, by the action that offers each. */
export type StepId = 'commit' | 'discard' | 'merge' | 'only-add' | 'push'

/** What each step offers now, for what the branch holds; a step left out is not offered. */
export function nextSteps(handoff: Handoff | null, repo?: string): Partial<Record<StepId, UiOffer>> {
  if (!handoff) return {}
  // Merged into the project's main branch on this machine: the work is in, and its branch went with it.
  if (handoff.landed) return { merge: { noteOnly: true, note: 'Merged into the main branch.' } }
  const paths = handoff.pendingFiles ?? []
  if (paths.length > 0) {
    return {
      commit: { note: `${handoff.empty ? 'Nothing committed — ' : ''}${namePending(paths)} left uncommitted.`, title: paths.join('\n'), rank: 10 },
      discard: {
        danger: true,
        rank: 90,
        confirm: {
          title: 'Discard the uncommitted changes?',
          description: `${namePending(paths)} go back to what the branch holds, and new files are deleted. This cannot be undone.`,
          confirmLabel: 'Discard',
          danger: true,
        },
      },
    }
  }
  // A branch the run's own tool deleted because it held nothing is no loss, so it too is silent.
  if (!handoff.exists) return handoff.unchanged ? {} : { push: { noteOnly: true, note: 'Branch gone — nothing to open a PR from.' } }
  // Commits that undo each other: there is work, and none of it is left to take. Said, so the missing press does not read as a fault.
  if (handoff.empty) return handoff.commits.length > 0 ? { push: { noteOnly: true, note: `Nothing to ${handoff.hasRemote ? 'publish' : 'merge'}: the commits cancel out.` } } : {}
  const main = mainBranchName(handoff.base)
  // The main branch already has the work: there is no step left, with a remote or without one.
  // A copy with no remote is merged into the folder it was copied from: the row names the repo, the hover the folder.
  if (handoff.merged) {
    const folder = handoff.copiedFrom?.path
    return { merge: folder !== undefined ? { noteOnly: true, note: 'Merged into your folder.', title: `Merged into the main branch of ${folder}` } : { noteOnly: true, note: `Merged into ${main}.` } }
  }
  if (!handoff.hasRemote) {
    if (repo === undefined) return { merge: { note: `Not in ${main} yet.`, rank: 20 } }
    // A copy names the folder it was copied from; a repository the agent cloned into the session on its own names none, and its work stays there.
    const from = handoff.copiedFrom
    if (!from) return { merge: { noteOnly: true, note: 'No remote: the work stays in this copy.' } }
    // "Merge" brings the branch to that folder and merges it into the folder's main branch; "Only add the branch" is for a folder busy on another branch.
    return {
      merge: { note: from.hasBranch ? `In your folder, not in ${main} yet.` : `Not in ${main} yet.`, title: `Merges ${handoff.branch} into ${main} in ${from.path}`, rank: 20 },
      ...(from.hasBranch ? {} : { 'only-add': { rank: 70 } }),
    }
  }
  // Published: where the handoff ends here. A pull request is the git host's module's step.
  return handoff.pushed ? {} : { push: { title: `Pushes ${handoff.branch} to origin`, rank: 60 } }
}

/**
 * The uncommitted paths, worded for a one-line bar: the first couple named, the rest counted. The
 * full list is one hover away.
 */
function namePending(paths: readonly string[]): string {
  const shown = paths.slice(0, 2).join(', ')
  const rest = paths.length - Math.min(paths.length, 2)
  return rest > 0 ? `${shown} and ${rest} more` : shown
}

/** What a press answered, as the place takes it: the branch it acted on is read anew. */
function pressed(on: WorkOn, answer: Pressed): UiActionResult {
  forgetHandoff(on)
  return answer
}

/** One step's action: offered as {@link nextSteps} says, for the run's branch as it is read now. */
function step(id: StepId, action: Omit<UiActionAt<'chat.handoff'>, 'place' | 'id' | 'offer'>): UiActionAt<'chat.handoff'> {
  return {
    place: 'chat.handoff',
    id,
    ...action,
    offer: async (host: UiHost, on) => nextSteps(await readHandoff(host, on), on.repo)[id],
  }
}

/** The bar's steps, the first offered being its press and the others under its arrow. */
export const handoffActions: UiActionAt<'chat.handoff'>[] = [
  step('commit', { label: 'Commit', busyLabel: 'Asking…', run: async (host, on) => pressed(on, await server(host).commit(on.projectId, { agentId: on.agentId })) }),
  step('merge', {
    label: 'Merge',
    busyLabel: 'Merging…',
    run: async (host, on) =>
      pressed(on, on.repo === undefined ? await server(host).merge(on.projectId, { agentId: on.agentId }) : await server(host).bring(on.projectId, { agentId: on.agentId, repo: on.repo, merge: true })),
  }),
  step('only-add', { label: 'Only add the branch', busyLabel: 'Adding…', icon: GitBranchPlus, run: async (host, on) => pressed(on, await server(host).bring(on.projectId, { agentId: on.agentId, repo: on.repo ?? '' })) }),
  step('push', { label: 'Publish branch', busyLabel: 'Publishing…', icon: Upload, run: async (host, on) => pressed(on, await server(host).push(on.projectId, { agentId: on.agentId, ...(on.repo !== undefined ? { repo: on.repo } : {}) })) }),
  step('discard', { label: 'Discard changes', busyLabel: 'Discarding…', icon: Undo2, run: async (host, on) => pressed(on, await server(host).discard(on.projectId, { agentId: on.agentId, ...(on.repo !== undefined ? { repo: on.repo } : {}) })) }),
]
