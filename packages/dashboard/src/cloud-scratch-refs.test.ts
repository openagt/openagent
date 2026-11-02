import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  CLOUD_SCRATCH_REF,
  SCRATCH_REF_SAFE_AGE_MS,
  cloudRefsStatePath,
  startCloudScratchSweep,
  sweepCloudScratchRefs,
  type ScratchFs,
  type ScratchSweepResult,
} from './cloud-scratch-refs.js'
import type { GitRunner } from '@openagt/agent-data'
import type { LinkedPr } from './dashboard/pull-requests.js'
import type { AgentMeta } from './store/index.js'

const DAY = 24 * 60 * 60 * 1000
/** The sweep's "now" for every test: refs age against this, never against the wall clock. */
const NOW = Date.parse('2026-08-17T12:00:00.000Z')

const SHA = 'a'.repeat(40)
const MAIN_SHA = 'b'.repeat(40)

/** A run branch started 26 hours before {@link NOW}: past the safe age. */
const OLD_RUN = 'agent-2026-08-16T10-00-00-000Z'
const OLD_RUN_ID = '2026-08-16T10-00-00-000Z'
/** A run branch started one hour before {@link NOW}: inside the safe age. */
const YOUNG_RUN = 'agent-2026-08-17T11-00-00-000Z'
const YOUNG_RUN_ID = '2026-08-17T11-00-00-000Z'
/** A branch a run named itself, recorded on the run that started 26 hours before {@link NOW}. */
const NAMED_RUN = 'agent-some-session-name'

/** A finished run's record, as the project's runs provider answers it (#1774): its id, its start, and the branch its work is on. */
const run = (id: string, startedAt: string, branch: string): AgentMeta => ({ id, status: 'done', startedAt, updatedAt: startedAt, branch })
/** The project's runs: the two run branches, and nothing for any other name on origin. */
const RUNS = async (): Promise<AgentMeta[]> => [run(OLD_RUN_ID, '2026-08-16T10:00:00.000Z', OLD_RUN), run(YOUNG_RUN_ID, '2026-08-17T11:00:00.000Z', YOUNG_RUN)]
/** An aged run branch under the pre-#1581 slashed spelling: still on remotes, still swept. */
/** The shape the cloud driver pushes (#1320): counter + 8-hex tag, slash-free. */
const CLOUD_REF = 'cloud-1-3955352b'

/** A {@link GitRunner} over a canned origin, recording every deletion it is asked for. */
function fakeGit(opts: {
  /** branch -> tip sha on origin. */
  heads: Record<string, string>
  /** Which branch HEAD points at. Default `main`. */
  defaultBranch?: string
  /** The shas reachable from the default branch ('all' for every one). Default 'all'. */
  landed?: Set<string> | 'all'
  /** Locally-known commits (#1601): sha -> its tree and parent. Everything else is not local. */
  commits?: Record<string, { tree: string; parent?: string }>
  refuseDeletes?: boolean
  noRemote?: boolean
}) {
  const deleted: string[] = []
  const git: GitRunner = async args => {
    if (args[0] === 'ls-remote') {
      if (opts.noRemote) throw new Error("fatal: 'origin' does not appear to be a git repository")
      const name = opts.defaultBranch ?? 'main'
      const lines = [`ref: refs/heads/${name}\tHEAD`, `${opts.heads[name] ?? MAIN_SHA}\tHEAD`]
      for (const [branch, sha] of Object.entries(opts.heads)) lines.push(`${sha}\trefs/heads/${branch}`)
      return lines.join('\n') + '\n'
    }
    if (args[0] === 'merge-base' && args[1] === '--is-ancestor') {
      const landed = opts.landed ?? 'all'
      if (landed === 'all' || landed.has(args[2]!)) return ''
      throw new Error('exit 1') // not an ancestor
    }
    if (args[0] === 'cat-file') {
      const sha = /^([0-9a-f]+)\^\{commit\}$/.exec(args[2] ?? '')?.[1]
      if (sha && opts.commits?.[sha]) return ''
      throw new Error('exit 1') // not a local object
    }
    if (args[0] === 'rev-parse') {
      const match = /^([0-9a-f]+)(\^?)(?:\^\{tree\})?$/.exec(args[1] ?? '')
      const commit = match ? opts.commits?.[match[1]!] : undefined
      if (!match || !commit) throw new Error('exit 128')
      const spec = args[1]!
      if (spec.endsWith('^^{tree}')) {
        const parent = commit.parent ? opts.commits?.[commit.parent] : undefined
        if (!parent) throw new Error('exit 128')
        return `${parent.tree}\n`
      }
      if (spec.endsWith('^{tree}')) return `${commit.tree}\n`
      if (spec.endsWith('^')) {
        if (!commit.parent) throw new Error('exit 128')
        return `${commit.parent}\n`
      }
      throw new Error(`unexpected rev-parse ${spec}`)
    }
    if (args[0] === 'fetch') throw new Error('exit 128') // the canned origin serves no objects
    if (args[0] === 'push' && args[2] === '--delete') {
      if (opts.refuseDeletes) throw new Error('remote hung up')
      deleted.push(args[3]!)
      return ''
    }
    throw new Error(`unexpected git ${args.join(' ')}`)
  }
  return { git, deleted }
}

/** An in-memory {@link ScratchFs}, so the first-seen state round-trips without disk. */
function memFs() {
  const files = new Map<string, string>()
  const fs: ScratchFs = {
    read: async path => {
      const contents = files.get(path)
      if (contents === undefined) throw new Error('ENOENT')
      return contents
    },
    write: async (path, contents) => void files.set(path, contents),
    mkdir: async () => {},
  }
  return { files, fs }
}

/** Seed the first-seen state as a sweep `ageMs` ago would have left it. */
function seenState(files: Map<string, string>, firstSeen: Record<string, string>): void {
  files.set(cloudRefsStatePath('/repo'), JSON.stringify({ firstSeen }))
}

const pr = (state: string): LinkedPr => ({ number: 7, url: 'https://x/7', state, title: 'work' })
const noPrs = async (): Promise<LinkedPr[]> => []

test('the driver ref shape matches the real leftovers and nothing looser (#1547)', () => {
  assert.ok(CLOUD_SCRATCH_REF.test('cloud-1-3955352b')) // the first live run's actual leftover
  assert.ok(CLOUD_SCRATCH_REF.test('cloud-12-0a1b2c3d'))
  assert.ok(!CLOUD_SCRATCH_REF.test('cloud-experiments')) // a user's own branch
  assert.ok(!CLOUD_SCRATCH_REF.test('cloud-1-XYZ')) // not the driver's tag charset
  assert.ok(!CLOUD_SCRATCH_REF.test('my-cloud-1-3955352b'))
})

test('an aged run branch whose work is on the default branch is deleted from origin (#1547)', async () => {
  const { git, deleted } = fakeGit({ heads: { main: MAIN_SHA, [OLD_RUN]: SHA } })
  const { fs } = memFs()
  const result = await sweepCloudScratchRefs('/repo', { agents: RUNS, git, fs, prs: noPrs, now: () => NOW })
  assert.deepEqual(result.deleted, [OLD_RUN])
  assert.deepEqual(deleted, [OLD_RUN])
  assert.deepEqual(result.failed, [])
})

test('a run branch inside the safe age is kept: its run may still be provisioning (#1547)', async () => {
  const { git, deleted } = fakeGit({ heads: { main: MAIN_SHA, [YOUNG_RUN]: SHA } })
  const { fs } = memFs()
  const result = await sweepCloudScratchRefs('/repo', { agents: RUNS, git, fs, prs: noPrs, now: () => NOW })
  assert.deepEqual(result.deleted, [])
  assert.deepEqual(deleted, [])
  assert.deepEqual(result.kept, [{ ref: YOUNG_RUN, reason: 'young' }])
})

test('a busy agent keeps its run branch however old the run is', async () => {
  const { git, deleted } = fakeGit({ heads: { main: MAIN_SHA, [OLD_RUN]: SHA } })
  const { fs } = memFs()
  const result = await sweepCloudScratchRefs('/repo', { agents: RUNS, git, fs, prs: noPrs, now: () => NOW, busy: new Set([OLD_RUN_ID]) })
  assert.deepEqual(deleted, [])
  assert.deepEqual(result.kept, [{ ref: OLD_RUN, reason: 'busy' }])
})

test('a tip not provably on the default branch may hold work: kept, and no PR lookup is spent on it', async () => {
  const { git, deleted } = fakeGit({ heads: { main: MAIN_SHA, [OLD_RUN]: SHA }, landed: new Set() })
  const { fs } = memFs()
  let prLookups = 0
  const result = await sweepCloudScratchRefs('/repo', {
    agents: RUNS,
    git,
    fs,
    prs: async () => {
      prLookups++
      return []
    },
    now: () => NOW,
  })
  assert.deepEqual(deleted, [])
  assert.deepEqual(result.kept, [{ ref: OLD_RUN, reason: 'holds-work' }])
  assert.equal(prLookups, 0)
})

test('an open PR keeps the ref — a deletion must never close one; a closed PR does not', async () => {
  const open = fakeGit({ heads: { main: MAIN_SHA, [OLD_RUN]: SHA } })
  const kept = await sweepCloudScratchRefs('/repo', { agents: RUNS, git: open.git, fs: memFs().fs, prs: async () => [pr('OPEN')], now: () => NOW })
  assert.deepEqual(open.deleted, [])
  assert.deepEqual(kept.kept, [{ ref: OLD_RUN, reason: 'open-pr' }])

  const closed = fakeGit({ heads: { main: MAIN_SHA, [OLD_RUN]: SHA } })
  const swept = await sweepCloudScratchRefs('/repo', { agents: RUNS, git: closed.git, fs: memFs().fs, prs: async () => [pr('CLOSED')], now: () => NOW })
  assert.deepEqual(closed.deleted, [OLD_RUN])
  assert.deepEqual(swept.deleted, [OLD_RUN])
})

test('a cloud-* ref is only recorded on first sight — its name carries no age to trust (#1547)', async () => {
  const { git, deleted } = fakeGit({ heads: { main: MAIN_SHA, [CLOUD_REF]: SHA } })
  const { files, fs } = memFs()
  const result = await sweepCloudScratchRefs('/repo', { agents: RUNS, git, fs, prs: noPrs, now: () => NOW })
  assert.deepEqual(deleted, [])
  assert.deepEqual(result.kept, [{ ref: CLOUD_REF, reason: 'young' }])
  const state = JSON.parse(files.get(cloudRefsStatePath('/repo'))!) as { firstSeen: Record<string, string> }
  assert.equal(state.firstSeen[CLOUD_REF], new Date(NOW).toISOString())
})

test('a cloud-* ref goes once it has been watched past the safe age, and its record goes with it', async () => {
  const { git, deleted } = fakeGit({ heads: { main: MAIN_SHA, [CLOUD_REF]: SHA } })
  const { files, fs } = memFs()
  seenState(files, { [CLOUD_REF]: new Date(NOW - SCRATCH_REF_SAFE_AGE_MS).toISOString() })
  const result = await sweepCloudScratchRefs('/repo', { agents: RUNS, git, fs, prs: noPrs, now: () => NOW })
  assert.deepEqual(result.deleted, [CLOUD_REF])
  assert.deepEqual(deleted, [CLOUD_REF])
  const state = JSON.parse(files.get(cloudRefsStatePath('/repo'))!) as { firstSeen: Record<string, string> }
  assert.deepEqual(state.firstSeen, {})
})

test('a cloud-* ref watched for less than the safe age is kept', async () => {
  const { git, deleted } = fakeGit({ heads: { main: MAIN_SHA, [CLOUD_REF]: SHA } })
  const { files, fs } = memFs()
  seenState(files, { [CLOUD_REF]: new Date(NOW - DAY / 2).toISOString() })
  const result = await sweepCloudScratchRefs('/repo', { agents: RUNS, git, fs, prs: noPrs, now: () => NOW })
  assert.deepEqual(deleted, [])
  assert.deepEqual(result.kept, [{ ref: CLOUD_REF, reason: 'young' }])
})

test('a hand-off anchor tip still counts as holding no work: empty commit, landed parent (#1601)', async () => {
  // The anchor is an empty commit on top of the run's HEAD, and no merge ever lands it — a
  // squash merge rewrites the session's history without it — so reachability alone would keep
  // its ref forever.
  const ANCHOR_SHA = 'c'.repeat(40)
  const { git, deleted } = fakeGit({
    heads: { main: MAIN_SHA, [CLOUD_REF]: ANCHOR_SHA },
    landed: new Set([SHA, MAIN_SHA]),
    commits: {
      [ANCHOR_SHA]: { tree: 'tree1', parent: SHA },
      [SHA]: { tree: 'tree1' },
    },
  })
  const { files, fs } = memFs()
  seenState(files, { [CLOUD_REF]: new Date(NOW - SCRATCH_REF_SAFE_AGE_MS).toISOString() })
  const result = await sweepCloudScratchRefs('/repo', { agents: RUNS, git, fs, prs: noPrs, now: () => NOW })
  assert.deepEqual(result.deleted, [CLOUD_REF])
  assert.deepEqual(deleted, [CLOUD_REF])
})

test('a tip that changes something against its parent is not an anchor: kept as holding work (#1601)', async () => {
  const TIP = 'c'.repeat(40)
  const { git, deleted } = fakeGit({
    heads: { main: MAIN_SHA, [CLOUD_REF]: TIP },
    landed: new Set([SHA, MAIN_SHA]),
    commits: {
      [TIP]: { tree: 'tree2', parent: SHA },
      [SHA]: { tree: 'tree1' },
    },
  })
  const { files, fs } = memFs()
  seenState(files, { [CLOUD_REF]: new Date(NOW - SCRATCH_REF_SAFE_AGE_MS).toISOString() })
  const result = await sweepCloudScratchRefs('/repo', { agents: RUNS, git, fs, prs: noPrs, now: () => NOW })
  assert.deepEqual(deleted, [])
  assert.deepEqual(result.kept, [{ ref: CLOUD_REF, reason: 'holds-work' }])
})

test('a record for a ref no longer on origin is pruned — someone else already deleted it', async () => {
  const { git } = fakeGit({ heads: { main: MAIN_SHA } })
  const { files, fs } = memFs()
  seenState(files, { 'cloud-9-deadbeef': new Date(NOW - 2 * DAY).toISOString() })
  await sweepCloudScratchRefs('/repo', { agents: RUNS, git, fs, prs: noPrs, now: () => NOW })
  const state = JSON.parse(files.get(cloudRefsStatePath('/repo'))!) as { firstSeen: Record<string, string> }
  assert.deepEqual(state.firstSeen, {})
})

test('a branch a run named itself is a run branch too, when the run\'s record names it: aged from the run\'s start (#1774)', async () => {
  const { git, deleted } = fakeGit({ heads: { main: MAIN_SHA, [NAMED_RUN]: SHA } })
  const named = async (): Promise<AgentMeta[]> => [run(OLD_RUN_ID, '2026-08-16T10:00:00.000Z', NAMED_RUN)]
  const result = await sweepCloudScratchRefs('/repo', { agents: named, git, fs: memFs().fs, prs: noPrs, now: () => NOW })
  assert.deepEqual(result.deleted, [NAMED_RUN])
  assert.deepEqual(deleted, [NAMED_RUN])
  // The same name with no record naming it, or a record whose start cannot be read, is nobody's to delete.
  const unread = async (): Promise<AgentMeta[]> => [run(OLD_RUN_ID, 'yesterday-ish', NAMED_RUN)]
  assert.deepEqual(await sweepCloudScratchRefs('/repo', { agents: unread, git: fakeGit({ heads: { main: MAIN_SHA, [NAMED_RUN]: SHA } }).git, fs: memFs().fs, prs: noPrs, now: () => NOW }), { deleted: [], kept: [], failed: [] })
})

test('the default branch and the data branch are never candidates, even when a run\'s record names them (#1827)', async () => {
  // A failed 2026-08-18 run recorded `branch: main`; under the run-branch rule the sweep then asked
  // origin to delete main every hour (GitHub refused only because it is the default branch).
  const heads = { main: MAIN_SHA, 'agent-data': SHA, [OLD_RUN]: SHA }
  const { git, deleted } = fakeGit({ heads })
  const naming = async (): Promise<AgentMeta[]> => [run(OLD_RUN_ID, '2026-08-16T10:00:00.000Z', 'main'), run(YOUNG_RUN_ID, '2026-08-16T10:00:00.000Z', 'agent-data')]
  const result = await sweepCloudScratchRefs('/repo', { agents: naming, git, fs: memFs().fs, prs: noPrs, now: () => NOW })
  assert.deepEqual(deleted, [])
  assert.deepEqual(result, { deleted: [], kept: [], failed: [] })
})

test('every other branch is never even a candidate: a name no run\'s record names is nobody\'s to delete', async () => {
  const heads = {
    main: MAIN_SHA,
    'claude/implement-something-abc123': SHA,
    'agent-some-session-name': SHA,
    'agent-not-a-timestamp': SHA,
    'openagent/some-session-name': SHA,
    'openagent/agent-not-a-timestamp': SHA,
    'feature/cloud-1-3955352b': SHA,
  }
  const { git, deleted } = fakeGit({ heads })
  const result = await sweepCloudScratchRefs('/repo', { agents: RUNS, git, fs: memFs().fs, prs: noPrs, now: () => NOW })
  assert.deepEqual(deleted, [])
  assert.deepEqual(result, { deleted: [], kept: [], failed: [] })
})

test('a repo with no reachable remote sweeps nothing and never throws', async () => {
  const { git } = fakeGit({ heads: {}, noRemote: true })
  const { files, fs } = memFs()
  const result = await sweepCloudScratchRefs('/repo', { agents: RUNS, git, fs, prs: noPrs, now: () => NOW })
  assert.deepEqual(result, { deleted: [], kept: [], failed: [] })
  assert.equal(files.size, 0)
})

test('a deletion the remote refuses is reported and its record kept, so the retry does not restart the day', async () => {
  const { git } = fakeGit({ heads: { main: MAIN_SHA, [CLOUD_REF]: SHA }, refuseDeletes: true })
  const { files, fs } = memFs()
  const seenAt = new Date(NOW - 2 * DAY).toISOString()
  seenState(files, { [CLOUD_REF]: seenAt })
  const result = await sweepCloudScratchRefs('/repo', { agents: RUNS, git, fs, prs: noPrs, now: () => NOW })
  assert.deepEqual(result.deleted, [])
  assert.equal(result.failed.length, 1)
  assert.equal(result.failed[0]!.ref, CLOUD_REF)
  const state = JSON.parse(files.get(cloudRefsStatePath('/repo'))!) as { firstSeen: Record<string, string> }
  assert.equal(state.firstSeen[CLOUD_REF], seenAt)
})

test('the remote symref names the default branch, so a repo defaulting to neither main nor master still works', async () => {
  const { git, deleted } = fakeGit({ heads: { trunk: MAIN_SHA, [OLD_RUN]: SHA }, defaultBranch: 'trunk' })
  const result = await sweepCloudScratchRefs('/repo', { agents: RUNS, git, fs: memFs().fs, prs: noPrs, now: () => NOW })
  assert.deepEqual(result.deleted, [OLD_RUN])
  assert.deepEqual(deleted, [OLD_RUN])
})

test('the service sweeps every project and says out loud only what changed', async () => {
  const logs: string[] = []
  const swept: string[] = []
  const sweep = async (cwd: string): Promise<ScratchSweepResult> => {
    swept.push(cwd)
    if (cwd === '/one') return { deleted: [CLOUD_REF], kept: [], failed: [] }
    return { deleted: [], kept: [{ ref: OLD_RUN, reason: 'young' }], failed: [{ ref: 'cloud-2-00000000', error: 'remote hung up' }] }
  }
  const service = startCloudScratchSweep({
    projects: async () => [{ path: '/one' }, { path: '/two' }],
    log: message => logs.push(message),
    sweep,
  })
  await service.tick()
  service.stop()
  assert.deepEqual(swept, ['/one', '/two'])
  assert.equal(logs.length, 2) // one deletion + one failure; kept refs stay quiet
  assert.match(logs[0]!, new RegExp(CLOUD_REF))
  assert.match(logs[1]!, /could not delete/)
})

test('a stopped service ticks as a no-op', async () => {
  let sweeps = 0
  const service = startCloudScratchSweep({
    projects: async () => [{ path: '/one' }],
    log: () => {},
    sweep: async () => {
      sweeps++
      return { deleted: [], kept: [], failed: [] }
    },
  })
  await service.tick()
  service.stop()
  await service.tick()
  assert.equal(sweeps, 1)
})

test('a branch a run named itself still has to clear every gate: young, busy, holding work, or under an open PR, it is kept', async () => {
  const youngNamed = async (): Promise<AgentMeta[]> => [run(YOUNG_RUN_ID, '2026-08-17T11:00:00.000Z', NAMED_RUN)]
  const young = await sweepCloudScratchRefs('/repo', { agents: youngNamed, git: fakeGit({ heads: { main: MAIN_SHA, [NAMED_RUN]: SHA } }).git, fs: memFs().fs, prs: noPrs, now: () => NOW })
  assert.deepEqual(young.kept, [{ ref: NAMED_RUN, reason: 'young' }])

  const oldNamed = async (): Promise<AgentMeta[]> => [run(OLD_RUN_ID, '2026-08-16T10:00:00.000Z', NAMED_RUN)]
  const busy = await sweepCloudScratchRefs('/repo', { agents: oldNamed, git: fakeGit({ heads: { main: MAIN_SHA, [NAMED_RUN]: SHA } }).git, fs: memFs().fs, prs: noPrs, now: () => NOW, busy: new Set([OLD_RUN_ID]) })
  assert.deepEqual(busy.kept, [{ ref: NAMED_RUN, reason: 'busy' }])

  const work = await sweepCloudScratchRefs('/repo', { agents: oldNamed, git: fakeGit({ heads: { main: MAIN_SHA, [NAMED_RUN]: SHA }, landed: new Set() }).git, fs: memFs().fs, prs: noPrs, now: () => NOW })
  assert.deepEqual(work.kept, [{ ref: NAMED_RUN, reason: 'holds-work' }])

  const open = fakeGit({ heads: { main: MAIN_SHA, [NAMED_RUN]: SHA } })
  const underPr = await sweepCloudScratchRefs('/repo', { agents: oldNamed, git: open.git, fs: memFs().fs, prs: async () => [pr('OPEN')], now: () => NOW })
  assert.deepEqual(underPr.kept, [{ ref: NAMED_RUN, reason: 'open-pr' }])
  assert.deepEqual(open.deleted, [])
})
