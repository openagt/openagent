import { nodeGitRunner, type GitRunner } from '@openagt/agent-data'
import { pickAgentPr, prsForBranchOrThrow, type LinkedPr } from './dashboard/pull-requests.js'
import { openRemoteBranchPullRequest, type HandoffResult } from './dashboard/agent-handoff.js'
import { listAgents, projectRuns, startedAtFromAgentId, type AgentMeta, type RunPatch } from './store/index.js'
import { errorMessage } from './error-message.js'
import { startProjectPass, type ProjectPass, type ProjectsSource } from './project-pass.js'

// Adopt the branch a cloud session actually worked on (#1601).
//
// A web run is a local wrapper that hands the task to claude.ai and ends; the cloud session does
// the work on a branch of its own naming (`claude/*`), never the designated run branch. Nothing
// ever told the run's record about that branch, so every surface keyed to it — the session row,
// the PR resolution, the merge — stared at an empty `agent-*` branch, and the run read
// as "nothing committed" while its work sat on origin.
//
// The hand-off anchor (#1601) makes the match exact rather than guessed: the driver pushes an
// empty commit unique to the run as the ref the session clones at, so the session's branch — and
// only it — descends from that commit. This pass walks origin's `claude/*` heads, matches each
// waiting run by that ancestry, and records what it finds onto the run's archive as one commit
// on the data branch: the branch, the PR the session opened for it — and when the run was armed
// for a PR the session never opened, it opens the draft PR itself, which is the armed handoff
// finally resolving against the facts.
//
// Conservative on every unprovable case: a run matching no head (the session has not pushed, or
// did nothing) or more than one (ancestry alone cannot say which) is simply retried next pass,
// and a run older than the window stops being asked about at all.


/** How long after its start a run is still asked about: safely past any cloud session's life. */
export const CLOUD_ADOPTION_WINDOW_MS = 48 * 60 * 60 * 1000

/** What one adoption did, for the daemon to say out loud. */
export interface CloudAdoption {
  agentId: string
  branch: string
  /** The PR now on the run's record, when one was found or opened. */
  pr?: { number: number; url: string }
  /** True when the PR above was opened by this pass (the armed draft), not found. */
  opened?: boolean
}

/** What {@link adoptCloudWork} did to one project. */
export interface CloudWorkResult {
  adopted: CloudAdoption[]
  /** Failures worth a log line; unmatched runs are not one, they are the normal waiting state. */
  failed: { agentId: string; error: string }[]
}

/** Injectable seams so the pass is unit-testable off disk, off the network and off the git host. */
export interface CloudWorkDeps {
  git?: GitRunner
  /** The branch's full PR history; a listing that fails must throw (default {@link prsForBranchOrThrow}). */
  prs?: (cwd: string, branch: string) => Promise<LinkedPr[]>
  /** The project's run records, none older than `since` in epoch ms (default {@link listAgents}). */
  agents?: (cwd: string, since: number) => Promise<AgentMeta[]>
  /** Record the adopted branch and PR on the run's card, as one commit on the data branch (default the `logs` skill's {@link patchRun}). */
  patch?: (cwd: string, agentId: string, patch: RunPatch) => Promise<boolean>
  /** Open the armed draft PR for a remote-only branch (default {@link openRemoteBranchPullRequest}). */
  openPr?: (cwd: string, agent: AgentMeta, branch: string) => Promise<HandoffResult>
  /** The current time in ms (injected so tests can age runs deterministically). */
  now?: () => number
}

/** One `claude/*` branch on origin: its short name and the commit it points at. */
interface CloudHead {
  ref: string
  sha: string
}

/** Where a cloud session's own branches live: what an adopted run's record names. */
const CLOUD_BRANCH_PREFIX = 'claude/'

/** Whether the run's record still carries the branch it was born on, i.e. no adoption happened: no branch, or one that is not a cloud session's. */
function onBirthBranch(meta: AgentMeta): boolean {
  return !meta.branch?.startsWith(CLOUD_BRANCH_PREFIX)
}

/** Whether the run's handoff was armed to open a PR. Absent means armed, matching the agent. */
function prArmed(meta: AgentMeta): boolean {
  return meta.handoff?.pr !== false
}

/** The settled web runs this pass still owes an answer. */
function waitingRuns(agents: AgentMeta[], now: number): AgentMeta[] {
  return agents.filter(meta => {
    if (meta.target !== 'web' || meta.status === 'running' || !meta.cloudAnchor) return false
    const startedAt = meta.startedAt ?? startedAtFromAgentId(meta.id)
    const startedMs = startedAt === undefined ? NaN : Date.parse(startedAt)
    if (!Number.isFinite(startedMs) || now - startedMs > CLOUD_ADOPTION_WINDOW_MS) return false
    // Owed: the branch is not adopted yet, or it is and the armed PR is still unaccounted for.
    // An unarmed run stops being asked about once its branch is recorded — a PR someone opens
    // later is still found live, by branch name, by every surface that shows PRs.
    return onBirthBranch(meta) || (meta.pr === undefined && prArmed(meta) && meta.status === 'done')
  })
}

/** Where the pass keeps origin's `claude/*` heads locally. */
const CLOUD_HEAD_PREFIX = 'refs/remotes/origin/claude/'

/**
 * Bring origin's `claude/*` heads local, once for the whole pass rather than once per head.
 *
 * The objects belong to a cloud VM, so they have to be fetched before any ancestry can be read.
 * This replaces a fetch per unmatched head per waiting run (#1607) — the saving is the call
 * count, not the transfer: a second fetch of heads already local negotiates and sends nothing.
 *
 * The destination refspec is named rather than left to chance. An ordinary checkout would write
 * these refs anyway, because git opportunistically updates the remote-tracking branches its
 * configured refspec covers even when the command line names its own; a checkout cloned with a
 * narrower refspec — `--single-branch` — would not, and would re-fetch every pass forever.
 *
 * Pruned, because these refs are now a standing local copy of a list that used to be read live
 * from origin each pass: without it a `claude/*` branch deleted on origin would go on matching.
 */
async function fetchCloudHeads(git: GitRunner, cwd: string): Promise<void> {
  await git(['fetch', '--prune', 'origin', `+refs/heads/claude/*:${CLOUD_HEAD_PREFIX}*`], cwd)
}

/**
 * The `claude/*` heads descending from `anchor` — the proof a branch is this run's, asked of git
 * once for the whole set rather than once per head.
 *
 * `--contains` is the same ancestry question `merge-base --is-ancestor` answered one head at a
 * time, and asking it this way also answers "how many" in the same call. Unprovable reads as no
 * match and is retried next pass: an anchor whose object is not local is exactly the case where
 * the session has pushed nothing for it to be an ancestor of.
 */
async function headsDescendingFrom(git: GitRunner, cwd: string, anchor: string): Promise<CloudHead[]> {
  const listing = await git(
    ['for-each-ref', `--contains=${anchor}`, '--format=%(objectname) %(refname)', CLOUD_HEAD_PREFIX],
    cwd,
  ).catch(() => '')
  const heads: CloudHead[] = []
  for (const line of listing.split('\n')) {
    const head = /^([0-9a-f]{40,64}) (.+)$/.exec(line.trim())
    if (head?.[2]?.startsWith(CLOUD_HEAD_PREFIX)) {
      heads.push({ ref: `claude/${head[2].slice(CLOUD_HEAD_PREFIX.length)}`, sha: head[1]! })
    }
  }
  return heads
}

/** The default {@link CloudWorkDeps.patch}: the late facts onto the run, through the project's runs provider. */
async function patchProvidedRun(cwd: string, agentId: string, patch: RunPatch): Promise<boolean> {
  const runs = await projectRuns(cwd).catch(() => undefined)
  return runs ? (await runs.patch(agentId, patch)).ok : false
}

/**
 * Adopt one project's cloud work (#1601): match each waiting web run to the `claude/*` head
 * descending from its hand-off anchor, and record the branch and its PR onto the run's archive —
 * opening the armed draft PR when the session never did. Never throws: a repo with no remote
 * (or offline) adopts nothing, and every unmatched run is retried next pass.
 */
export async function adoptCloudWork(cwd: string, deps: CloudWorkDeps = {}): Promise<CloudWorkResult> {
  const git = deps.git ?? nodeGitRunner()
  const prs = deps.prs ?? prsForBranchOrThrow
  const agents = deps.agents ?? ((project: string, since: number) => listAgents(project, projectRuns, { since }))
  const patchArchive = deps.patch ?? patchProvidedRun
  const openPr = deps.openPr ?? openRemoteBranchPullRequest
  const now = deps.now ? deps.now() : Date.now()
  const result: CloudWorkResult = { adopted: [], failed: [] }

  // Only the window's runs are asked for: an archive grows without bound, and everything older
  // than the window is a record `waitingRuns` would drop anyway — so it is never read (#1607).
  const waiting = waitingRuns(await agents(cwd, now - CLOUD_ADOPTION_WINDOW_MS).catch((): AgentMeta[] => []), now)
  if (waiting.length === 0) return result

  try {
    await fetchCloudHeads(git, cwd)
  } catch {
    return result // no remote, or it cannot be reached: nothing to match against
  }

  for (const run of waiting) {
    const matches = await headsDescendingFrom(git, cwd, run.cloudAnchor!)
    // Exactly one, or nothing happens: zero is a session that has not pushed (or never will),
    // and two is a history this pass cannot arbitrate — both are the next pass's question.
    if (matches.length !== 1) continue
    const head = matches[0]!
    const branch = head.ref
    // A run whose record names some other branch — neither the one it was born on nor this head
    // — is not this pass's to answer: a PR opened here would be recorded against a branch it
    // does not live on.
    if (!onBirthBranch(run) && run.branch !== branch) continue

    // The PR the session opened for its branch, if any — filtered by the run's start so a
    // predecessor's PR on a reused name is never this run's, `latest` so the last PR that saw
    // the branch answers (#1512). "None" and "could not list" must not look alike here: a
    // listing that fails opens nothing this pass (a second draft PR on a branch that already
    // has one is the cost of guessing), and the run is asked again next time.
    const since = run.startedAt ?? startedAtFromAgentId(run.id)
    const listing = await prs(cwd, branch).then(
      found => ({ ok: true as const, pr: pickAgentPr(found, since, 'latest') }),
      (err: unknown) => ({ ok: false as const, error: errorMessage(err) }),
    )
    let pr = listing.ok ? listing.pr : undefined
    let opened = false
    if (!listing.ok) {
      result.failed.push({ agentId: run.id, error: `could not list the PRs of ${branch} (${listing.error}), so no draft PR was opened this pass` })
    } else if (!pr && prArmed(run) && run.status === 'done' && head.sha !== run.cloudAnchor) {
      // The armed handoff, finally resolving (#1601): the run was armed for a PR, the session
      // opened none, and the branch carries something beyond the hand-off itself — so the draft
      // PR the wrapper's epilogue could never open (it saw only the empty run branch) opens now.
      // A run whose PR arming was off gets its branch recorded and nothing else.
      const openedPr = await openPr(cwd, run, branch)
      if (openedPr.ok && openedPr.number !== undefined && openedPr.url) {
        pr = { number: openedPr.number, url: openedPr.url, state: 'OPEN', title: '' }
        opened = true
      } else if (!openedPr.ok) {
        result.failed.push({ agentId: run.id, error: `could not open the armed draft PR for ${branch}: ${openedPr.error}` })
      }
    }

    // One commit on the data branch carries whatever this pass learned: the branch (first time
    // only), the PR (once known). Nothing learned, nothing written — and nothing announced.
    const patch: RunPatch = {
      ...(onBirthBranch(run) ? { branch } : {}),
      ...(pr && run.pr === undefined ? { pr: { number: pr.number, url: pr.url } } : {}),
    }
    if (Object.keys(patch).length === 0) continue
    if (!(await patchArchive(cwd, run.id, patch))) {
      result.failed.push({ agentId: run.id, error: `could not record ${branch} on the run's archive` })
      continue
    }
    result.adopted.push({
      agentId: run.id,
      branch,
      ...(pr ? { pr: { number: pr.number, url: pr.url } } : {}),
      ...(opened ? { opened: true } : {}),
    })
  }
  return result
}

/** What {@link startCloudWorkAdoption} needs from the daemon. */
export interface CloudWorkAdoptionOptions {
  /** The registered projects to pass over. */
  projects: ProjectsSource
  log: (message: string) => void
  /** The per-project pass (default {@link adoptCloudWork}). */
  adopt?: (cwd: string) => Promise<CloudWorkResult>
}

/**
 * Adopt every registered project's cloud work (#1601), one turn per call.
 *
 * Adoptions and failures are said out loud, unmatched runs are not: a session that has not
 * pushed yet is the normal state of every run this watches, and a line per tick about it would
 * be noise. A run's row changing branch with no line explaining why would read as a bug.
 */
export function startCloudWorkAdoption(opts: CloudWorkAdoptionOptions): ProjectPass {
  const adopt = opts.adopt ?? adoptCloudWork

  // No timer of its own (E4): the daemon's one clock calls `tick`.
  return startProjectPass(opts.projects, async cwd => {
    const { adopted, failed } = await adopt(cwd).catch((): CloudWorkResult => ({ adopted: [], failed: [] }))
    for (const adoption of adopted) {
      const prLine = adoption.pr ? (adoption.opened ? `; opened its armed draft PR ${adoption.pr.url}` : `; its PR is ${adoption.pr.url}`) : ''
      opts.log(`[openagent] session ${adoption.agentId}'s cloud work landed on ${adoption.branch} — adopted as its branch (#1601)${prLine}`)
    }
    for (const failure of failed) {
      opts.log(`[openagent] cloud work adoption for session ${failure.agentId}: ${failure.error}`)
    }
  })
}
