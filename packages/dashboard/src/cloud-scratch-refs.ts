import { join } from 'node:path'
import { DATA_BRANCH, nodeGitRunner, type GitRunner } from '@openagt/agent-data'
import { OPENAGENT_DIR } from './openagent-dir.js'
import { prsForBranch, type LinkedPr } from './dashboard/pull-requests.js'
import { listAgents, type AgentMeta } from './store/index.js'
import { nodeFs } from './node-fs.js'
import { errorMessage } from './error-message.js'
import { startProjectPass, type ProjectPass, type ProjectsSource } from './project-pass.js'

// Sweep the scratch refs a cloud hand-off leaves on origin (#1547).
//
// Every "Run on: Claude web" run pushes two refs that nothing ever consumes again: the slash-free
// `cloud-*` ref the driver pushes so the cloud session has a ref it can clone at (#1320,
// anthropics/claude-code#87235), and the run branch (`agent-…`) pushed beside it. The session does its work on its own `claude/*`
// branch and opens its PR from there, so once provisioning settles both refs are dead names on
// origin — one pair per web run, accumulating forever.
//
// The driver cannot safely delete its own ref: session creation only signals "session created",
// not "clone finished", and a ref deleted in that window strands the session (recoverable only
// with `claude --teleport`). So the daemon sweeps instead, and every deletion has to clear four
// gates:
//
// - **Old enough** (~a day) that no provisioning can still be reading it. A run branch is aged
//   from its run's start, off the run's record (the records are shared across machines, so every
//   machine's runs are known here); a `cloud-*` ref carries nothing, so the sweep remembers when
//   it first saw one and only ages it from there — which also keeps a ref pushed by *another*
//   machine safe, since each machine only deletes what it has itself watched for a day.
// - **Holds no work**: its tip is already reachable from origin's default branch. That is what
//   separates a web run's empty scratch branch from a local run's branch holding unmerged commits —
//   the one thing this sweep must never delete.
// - **No open PR**, so a deletion can never close one.
// - **Not a live agent's**: a run the caller names as `busy` keeps its branch. The daemon names
//   none, since it runs no agent.
//
// Never throws, and conservative on every unprovable case: a ref it cannot prove dead simply
// stays, and the next sweep asks again.

/** How long a scratch ref is left alone before it may go: safely past any provisioning. */
export const SCRATCH_REF_SAFE_AGE_MS = 24 * 60 * 60 * 1000

/**
 * The shape of the pre-hand-off ref the cloud driver pushes: its own session id, a counter plus
 * the 8-hex tag (`cloud-1-3955352b`). Anchored tightly so a user's own `cloud-…` branch that does
 * not match the driver's naming is never even a candidate.
 */
export const CLOUD_SCRATCH_REF = /^cloud-\d+-[0-9a-f]{8}$/

/**
 * Where the sweep remembers when it first saw each `cloud-*` ref, under `.openagent/`
 * (gitignored, like the other per-repo bookkeeping). Needed because the ref's name carries no
 * timestamp and its commit date says nothing — the driver pushes the worktree's HEAD, which is
 * however old the base commit happens to be, not when the hand-off happened.
 */
const CLOUD_REFS_FILE = 'cloud-refs.json'

/** When the sweep first saw each `cloud-*` ref on origin, ISO, keyed by short ref name. */
interface CloudRefsState {
  firstSeen: Record<string, string>
}

/** Minimal fs seam so the state IO is unit-testable without touching disk. */
export interface ScratchFs {
  read(path: string): Promise<string>
  write(path: string, contents: string): Promise<void>
  mkdir(path: string): Promise<void>
}

/** A {@link ScratchFs} backed by `node:fs/promises`. See {@link nodeFs}. */
function nodeScratchFs(): ScratchFs {
  const { read, write, mkdir } = nodeFs()
  return { read, write, mkdir }
}

/** The first-seen state file path for a repo. */
export function cloudRefsStatePath(cwd: string): string {
  return join(cwd, OPENAGENT_DIR, CLOUD_REFS_FILE)
}

/** Read a repo's first-seen state. Forgiving: missing/unreadable/malformed yields an empty one. */
async function readState(cwd: string, fs: ScratchFs): Promise<CloudRefsState> {
  try {
    const parsed = JSON.parse(await fs.read(cloudRefsStatePath(cwd))) as unknown
    if (parsed && typeof parsed === 'object') {
      const record = (parsed as Record<string, unknown>)['firstSeen']
      if (record && typeof record === 'object') {
        const firstSeen: Record<string, string> = {}
        for (const [ref, at] of Object.entries(record as Record<string, unknown>)) {
          if (typeof at === 'string') firstSeen[ref] = at
        }
        return { firstSeen }
      }
    }
  } catch {
    // absent / unreadable / malformed -> nothing seen yet
  }
  return { firstSeen: {} }
}

/** Record a repo's first-seen state, creating `.openagent/` as needed. */
async function writeState(cwd: string, state: CloudRefsState, fs: ScratchFs): Promise<void> {
  await fs.mkdir(join(cwd, OPENAGENT_DIR))
  await fs.write(cloudRefsStatePath(cwd), JSON.stringify(state, null, 2))
}

/** Why a candidate ref was kept this sweep. Every one of these is retried on a later pass. */
export type ScratchKeptReason =
  /** Not past the safe age yet — the window a provisioning session could still be reading it. */
  | 'young'
  /** Its agent is one the daemon is still responsible for. */
  | 'busy'
  /** Its tip is not provably on the default branch, so it may hold work. */
  | 'holds-work'
  /** It has an open PR, which a deletion would close. */
  | 'open-pr'

/** What {@link sweepCloudScratchRefs} did to one repo's origin. */
export interface ScratchSweepResult {
  /** Refs deleted from origin (short names). */
  deleted: string[]
  /** Candidate refs kept, and why. Refs matching neither naming are never listed at all. */
  kept: { ref: string; reason: ScratchKeptReason }[]
  /** Refs the sweep decided to delete but could not; retried next sweep. */
  failed: { ref: string; error: string }[]
}

/** Injectable seams so the sweep is unit-testable off disk, off the network and off the git host. */
export interface ScratchSweepDeps {
  git?: GitRunner
  /** The branch's full PR history (default {@link prsForBranch}). */
  prs?: (cwd: string, branch: string) => Promise<LinkedPr[]>
  fs?: ScratchFs
  /** The current time in ms (injected so tests can age refs deterministically). */
  now?: () => number
  /** Override {@link SCRATCH_REF_SAFE_AGE_MS}. */
  ageMs?: number
  /** Agent ids the daemon is still responsible for, whose run branches this must not touch. */
  busy?: ReadonlySet<string>
  /** The project's runs, whose recorded branches are the run branches on origin (default {@link listAgents}). */
  agents?: (cwd: string) => Promise<AgentMeta[]>
}

/** One branch on origin: its short name and the commit it points at. */
interface RemoteHead {
  ref: string
  sha: string
}

/**
 * Parse `git ls-remote --symref origin HEAD 'refs/heads/*'`: the branch HEAD points at (the
 * default branch) plus every branch with its tip. One listing answers everything the
 * classification needs, in one network round-trip.
 */
function parseLsRemote(listing: string): { defaultBranch?: string; heads: RemoteHead[] } {
  const heads: RemoteHead[] = []
  let defaultBranch: string | undefined
  for (const line of listing.split('\n')) {
    const symref = /^ref:\s+refs\/heads\/(\S+)\s+HEAD$/.exec(line)
    if (symref) {
      defaultBranch = symref[1]!
      continue
    }
    const head = /^([0-9a-f]{40,64})\t+refs\/heads\/(.+)$/.exec(line)
    if (head) heads.push({ ref: head[2]!, sha: head[1]! })
  }
  // A remote that answers no symref (some mirrors) still usually has a conventional default.
  if (!defaultBranch) defaultBranch = ['main', 'master'].find(name => heads.some(h => h.ref === name))
  return { ...(defaultBranch !== undefined ? { defaultBranch } : {}), heads }
}

/**
 * Whether `sha` is already reachable from the default branch — the proof the ref holds no work.
 * Tried against the remote's own tip first (the freshest answer, when its object is local because
 * this machine pushed or fetched it), then against the local `origin/<default>` tracking ref
 * (stale is fine: reachable from a stale tip is reachable from a newer one). Unprovable — objects
 * missing, no default branch at all — reads as "not landed", which keeps the ref.
 */
async function landed(git: GitRunner, cwd: string, sha: string, defaultBranch: string | undefined, heads: RemoteHead[]): Promise<boolean> {
  if (defaultBranch === undefined) return false
  const remoteTip = heads.find(h => h.ref === defaultBranch)?.sha
  for (const tip of [remoteTip, `refs/remotes/origin/${defaultBranch}`]) {
    if (!tip) continue
    const ancestor = await git(['merge-base', '--is-ancestor', sha, tip], cwd).then(
      () => true,
      () => false,
    )
    if (ancestor) return true
  }
  return false
}

/**
 * Whether `sha` is an empty commit sitting on a landed parent — the hand-off anchor's shape
 * (#1601): its tree is its parent's tree, so it holds no work of its own, and the parent being
 * on the default branch means everything under it landed. The commit object may not be local
 * (another machine pushed the ref), so the ref is fetched first when needed; anything still
 * unprovable reads as "holds work", which keeps the ref for a later sweep.
 */
async function emptyTipOnLandedParent(
  git: GitRunner,
  cwd: string,
  ref: string,
  sha: string,
  defaultBranch: string | undefined,
  heads: RemoteHead[],
): Promise<boolean> {
  const present = await git(['cat-file', '-e', `${sha}^{commit}`], cwd).then(
    () => true,
    () => false,
  )
  if (!present && !(await git(['fetch', 'origin', `refs/heads/${ref}`], cwd).then(() => true, () => false))) return false
  try {
    const tree = (await git(['rev-parse', `${sha}^{tree}`], cwd)).trim()
    const parent = (await git(['rev-parse', `${sha}^`], cwd)).trim()
    const parentTree = (await git(['rev-parse', `${sha}^^{tree}`], cwd)).trim()
    if (!tree || !parent || tree !== parentTree) return false
    return await landed(git, cwd, parent, defaultBranch, heads)
  } catch {
    return false
  }
}

/**
 * Sweep one repo's origin for the dead refs cloud hand-offs left behind (#1547), deleting the
 * ones that clear every gate. Never throws: a repo with no remote (or offline) sweeps nothing,
 * and a failed deletion is reported and retried next sweep.
 */
export async function sweepCloudScratchRefs(cwd: string, deps: ScratchSweepDeps = {}): Promise<ScratchSweepResult> {
  const git = deps.git ?? nodeGitRunner()
  const prs = deps.prs ?? prsForBranch
  const fs = deps.fs ?? nodeScratchFs()
  const now = deps.now ? deps.now() : Date.now()
  const ageMs = deps.ageMs ?? SCRATCH_REF_SAFE_AGE_MS
  const result: ScratchSweepResult = { deleted: [], kept: [], failed: [] }

  let listing: string
  try {
    listing = await git(['ls-remote', '--symref', 'origin', 'HEAD', 'refs/heads/*'], cwd)
  } catch {
    return result // no remote, or it cannot be reached: nothing to sweep
  }
  const { defaultBranch, heads } = parseLsRemote(listing)

  const state = await readState(cwd, fs)
  // A run branch is one a run's record names (#1774): the record says when the run started, and
  // whose it is. A branch no record names is nobody's to delete.
  const runs = new Map<string, AgentMeta>()
  for (const run of await (deps.agents ?? listAgents)(cwd).catch((): AgentMeta[] => [])) if (run.branch && !runs.has(run.branch)) runs.set(run.branch, run)
  // Rebuilt from what origin actually has, so entries for refs deleted (by us or anyone) fall away.
  const firstSeen: Record<string, string> = {}
  const candidates: RemoteHead[] = []

  for (const head of heads) {
    if (CLOUD_SCRATCH_REF.test(head.ref)) {
      const seenAt = state.firstSeen[head.ref]
      const seenMs = seenAt === undefined ? NaN : Date.parse(seenAt)
      if (!Number.isFinite(seenMs)) {
        // First sight (or a hand-edited timestamp): the day starts now.
        firstSeen[head.ref] = new Date(now).toISOString()
        result.kept.push({ ref: head.ref, reason: 'young' })
        continue
      }
      firstSeen[head.ref] = seenAt!
      if (now - seenMs < ageMs) {
        result.kept.push({ ref: head.ref, reason: 'young' })
        continue
      }
      candidates.push(head)
      continue
    }
    // The default branch and the data branch are nobody's scratch, whatever a run's record says: a
    // run that recorded `main` as its branch (one that never left it) must not turn the sweep on main.
    if (head.ref === defaultBranch || head.ref === DATA_BRANCH) continue
    const run = runs.get(head.ref)
    if (run) {
      const startedMs = Date.parse(run.startedAt)
      if (!Number.isFinite(startedMs)) continue // a run whose age is unknowable is not ours to delete
      if (deps.busy?.has(run.id)) {
        result.kept.push({ ref: head.ref, reason: 'busy' })
        continue
      }
      if (now - startedMs < ageMs) {
        result.kept.push({ ref: head.ref, reason: 'young' })
        continue
      }
      candidates.push(head)
    }
    // Every other branch — the default, `claude/*`, a branch no run's record names — is not a
    // scratch ref and is never even considered.
  }

  for (const { ref, sha } of candidates) {
    // The work gate first: it is local and free, and it is the one that must never be wrong.
    // A tip the default branch never absorbs still clears it when it is a hand-off anchor
    // (#1601): an empty commit whose parent landed changes nothing, and no merge ever lands
    // the anchor itself — a squash merge rewrites the session's history without it.
    if (!(await landed(git, cwd, sha, defaultBranch, heads)) && !(await emptyTipOnLandedParent(git, cwd, ref, sha, defaultBranch, heads))) {
      result.kept.push({ ref, reason: 'holds-work' })
      continue
    }
    // prsForBranch resolves [] when the git host cannot answer, so a hiccup here fails toward
    // deletion — acceptable only because the work gate already proved the ref holds nothing.
    const history = await prs(cwd, ref).catch((): LinkedPr[] => [])
    if (history.some(pr => pr.state === 'OPEN')) {
      result.kept.push({ ref, reason: 'open-pr' })
      continue
    }
    try {
      await git(['push', 'origin', '--delete', ref], cwd)
      result.deleted.push(ref)
      delete firstSeen[ref]
    } catch (err) {
      // The first-seen entry stays, so the retry next sweep does not restart the day.
      result.failed.push({ ref, error: errorMessage(err) })
    }
  }

  if (JSON.stringify(firstSeen) !== JSON.stringify(state.firstSeen)) {
    await writeState(cwd, { firstSeen }, fs).catch(() => {
      // Best effort: an unwritable state file only delays deletions, never loses work.
    })
  }
  return result
}

/** What {@link startCloudScratchSweep} needs from the daemon. */
export interface CloudScratchSweepOptions {
  /** The registered projects to sweep. */
  projects: ProjectsSource
  log: (message: string) => void
  /** The agents the daemon is still responsible for, whose run branches this must not touch. */
  busy?: () => ReadonlySet<string>
  /** The per-project sweep (default {@link sweepCloudScratchRefs}). */
  sweep?: (cwd: string) => Promise<ScratchSweepResult>
}

/**
 * Sweep every registered project's leftover cloud scratch refs (#1547), one turn per call.
 *
 * Deletions and failures are said out loud, kept refs are not: a candidate that is merely not old
 * enough yet is the normal state of every ref this watches, and a line per tick about it would be
 * noise. A ref vanishing from origin with no line explaining why would read as a bug.
 */
export function startCloudScratchSweep(opts: CloudScratchSweepOptions): ProjectPass {
  const sweep = opts.sweep ?? ((cwd: string) => sweepCloudScratchRefs(cwd, { ...(opts.busy ? { busy: opts.busy() } : {}) }))

  // No timer of its own (E4): the daemon's one clock calls `tick`.
  return startProjectPass(opts.projects, async cwd => {
    const { deleted, failed } = await sweep(cwd).catch((): ScratchSweepResult => ({ deleted: [], kept: [], failed: [] }))
    for (const ref of deleted) {
      opts.log(`[openagent] deleted the leftover cloud hand-off ref ${ref} on origin: its session settled long ago and nothing consumes it (#1547).`)
    }
    for (const item of failed) {
      opts.log(`[openagent] could not delete the leftover ref ${item.ref} on origin: ${item.error}`)
    }
  })
}
