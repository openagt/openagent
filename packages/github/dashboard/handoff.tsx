import { ExternalLink, GitMerge, GitPullRequest, GitPullRequestArrow, GitPullRequestClosed, GitPullRequestDraft } from 'lucide-react'
import type { UiActionAt, UiActionResult, UiHost, UiOffer } from '@openagt/ui/module'
import { server, type Carries, type PrHandoff } from './calls.js'

// The pull request presses of an ended run's work, in the bar above its message box
// (`chat.handoff`), for the run's own checkout and for each of its copies of repos (`repo`): Open
// PR, with a draft under its arrow, the push that brings an open request the newer commits, and
// its merge. What the branch holds and the presses that keep the work on this machine or publish
// its branch are git-branches'; Open PR comes before its Publish branch, which pushes the same
// branch without a request.
//
// Opening a request puts the run's work on GitHub under the person's account, so it is a
// deliberate press, and its word says it has not happened yet. Once a request exists it is not
// offered again: the bar names it. What is offered is what it still needs (`../src/handoff.ts`),
// and under the arrow of an open one its page on GitHub and its Close, asked first.

/** The presses, by the action that offers each. */
export type PressId = 'open-pr' | 'draft-pr' | 'update-pr' | 'merge-pr' | 'pr-page' | 'close-pr'

/** A run, or one of its copies of repos (`repo`), as the bar names it. */
type WorkOn = { projectId: string; agentId: string; repo?: string }

/** What each press offers now, for what was read of the run's request; a press left out is not offered. */
export function prPresses(read: PrHandoff): Partial<Record<PressId, UiOffer>> {
  const pr = read.pr
  const onIt = pr?.state === 'OPEN' ? openPrPresses(pr) : {}
  if (read.armed && pr) return { 'merge-pr': { noteOnly: true, note: `PR #${pr.number} merges when its checks pass.` }, ...onIt }
  if (read.update) return { 'update-pr': { note: 'not in the PR yet', rank: 20 }, ...onIt }
  if (read.merge && pr) return { 'merge-pr': { title: `Merges PR #${pr.number} now, or once its checks pass`, rank: 20 }, ...onIt }
  const open = read.open
  if (!open) return {}
  return {
    'open-pr': { title: `${open.pushed ? 'Opens' : 'Pushes the branch and opens'} a pull request for ${open.branch}`, rank: 30, ...(open.carries ? carriesNote(open.carries) : {}) },
    'draft-pr': { rank: 40 },
  }
}

/**
 * What an open request offers under the arrow, after what it still needs: its page on GitHub, and
 * its Close, in the danger colour and asked first, since its review and its checks go with it.
 */
function openPrPresses(pr: NonNullable<PrHandoff['pr']>): Partial<Record<PressId, UiOffer>> {
  const repo = /github\.com\/([^/]+\/[^/]+)\/pull\//.exec(pr.url)?.[1]
  const named = [pr.title !== '' ? `“${pr.title}”` : `PR #${pr.number}`, repo !== undefined ? ` on ${repo}` : ''].join('')
  return {
    'pr-page': { href: pr.url, rank: 60 },
    'close-pr': {
      danger: true,
      rank: 70,
      confirm: { title: `Close PR #${pr.number}?`, description: `${named} is closed without merging. Its branch stays; you can reopen it on GitHub.`, confirmLabel: 'Close PR', danger: true },
    },
  }
}

/**
 * What a request would carry beyond the run's own work, beside the press that opens it: the run
 * started from a branch of this machine, and that branch's own unlanded commits go up with it.
 * Said, never blocked: the request is still one press, and this is where a person sees before it
 * that it takes more than this run's changes.
 */
function carriesNote(carries: Carries): Pick<UiOffer, 'note' | 'title'> {
  const base = /^[0-9a-f]{40}$/.test(carries.base) ? 'the main branch' : carries.base.replace(/^origin\//, '')
  const files = `${carries.files} file${carries.files === 1 ? '' : 's'}`
  const commits = `${carries.commits} commit${carries.commits === 1 ? '' : 's'}`
  return { note: `${files} over ${base}`, title: `A pull request against ${base} carries ${commits} · ${files} · +${carries.insertions} −${carries.deletions}, this run's work among them.` }
}

/** How long one read of a run's request answers every press that asks: the bar asks each at once. */
const SHARED_MS = 1_000
const shared = new Map<string, { at: number; read: Promise<PrHandoff> }>()

/** What the bar offers for the run's request, or a copy's: one read shared by the presses that ask within a second. */
function readPresses(host: UiHost, on: WorkOn): Promise<PrHandoff> {
  const key = `${on.projectId}\n${on.agentId}\n${on.repo ?? ''}`
  const known = shared.get(key)
  if (known && Date.now() - known.at < SHARED_MS) return known.read
  const read = server(host).pullRequest(on.projectId, { agentId: on.agentId, ...(on.repo !== undefined ? { repo: on.repo } : {}) })
  shared.set(key, { at: Date.now(), read })
  read.catch(() => shared.delete(key))
  return read
}

/** What a press answered: the request it acted on is read anew. */
function pressed(on: WorkOn, answer: UiActionResult): UiActionResult {
  shared.delete(`${on.projectId}\n${on.agentId}\n${on.repo ?? ''}`)
  return answer
}

/** One press: offered as {@link prPresses} says, for the run's request as it is read now. */
function press(id: PressId, action: Omit<UiActionAt<'chat.handoff'>, 'place' | 'id' | 'offer'>): UiActionAt<'chat.handoff'> {
  return { place: 'chat.handoff', id, ...action, offer: async (host, on) => prPresses(await readPresses(host, on))[id] }
}

const repoOf = (on: WorkOn) => (on.repo !== undefined ? { repo: on.repo } : {})

/** The bar's pull request presses. */
export const handoffActions: UiActionAt<'chat.handoff'>[] = [
  press('open-pr', { label: 'Open PR', busyLabel: 'Opening PR…', icon: GitPullRequest, run: async (host, on) => pressed(on, await server(host).openPr(on.projectId, { agentId: on.agentId, ...repoOf(on) })) }),
  press('draft-pr', { label: 'Create draft PR', busyLabel: 'Opening PR…', icon: GitPullRequestDraft, run: async (host, on) => pressed(on, await server(host).openPr(on.projectId, { agentId: on.agentId, ...repoOf(on), draft: true })) }),
  press('update-pr', { label: 'Update PR', busyLabel: 'Updating PR…', icon: GitPullRequestArrow, run: async (host, on) => pressed(on, await server(host).updatePr(on.projectId, { agentId: on.agentId, ...repoOf(on) })) }),
  press('merge-pr', { label: 'Merge PR', busyLabel: 'Merging…', icon: GitMerge, run: async (host, on) => pressed(on, await server(host).mergePr(on.projectId, { agentId: on.agentId, ...repoOf(on) })) }),
  press('pr-page', { label: 'Open on GitHub', icon: ExternalLink }),
  press('close-pr', { label: 'Close PR', busyLabel: 'Closing PR…', icon: GitPullRequestClosed, run: async (host, on) => pressed(on, await server(host).closePr(on.projectId, { agentId: on.agentId, ...repoOf(on) })) }),
]
