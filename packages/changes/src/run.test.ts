import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import type { ModuleServerHost } from '@openagt/dashboard/module-server'
import { readAgentChanges as readChanges, readAgentCommitChanges as readCommitChanges, readAgentCommitFileDiff, readAgentCommits, readAgentFileDiff, resolveAgentWork, type AgentChanges, type FileMark } from './run.js'

/** Marks without their line counts: what most cases here are about. One case checks the counts. */
const plain = (marks: Record<string, FileMark>): Record<string, FileMark> => Object.fromEntries(Object.entries(marks).map(([path, { status, committed }]) => [path, { status, committed }]))
const readAgentChanges = async (...args: Parameters<typeof readChanges>): Promise<AgentChanges> => {
  const read = await readChanges(...args)
  return 'changes' in read ? { ...read, changes: plain(read.changes) } : read
}
const readAgentCommitChanges = async (...args: Parameters<typeof readCommitChanges>) => {
  const marks = await readCommitChanges(...args)
  return marks && plain(marks)
}

let dir: string
let root: string
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

/** The host for a run that has a checkout at `path`, and the record given, when one is. */
const inCheckout = (path: string, record?: { baseCommit?: string }): ModuleServerHost => ({
  root,
  run: async () => ({ checkout: path, ...(record ? { record } : {}), changedNothing: false }),
  mergeCommit: async () => ({ pending: false }),
})

/** A pull request on a run's branch, as the git host answers it. */
type Pr = { number: number; mergeCommit?: string } & Record<string, unknown>

/**
 * The host for a run with no checkout, the given record, and the given pull requests on its
 * branch. "Changed nothing" is the core's rule, as the core's host answers it: it ended `done` or
 * `failed` on this machine, with no pull request, and was not landed.
 */
function deps(agent: { status?: string; host?: string; branch?: string; pr?: { number: number }; base?: string; baseCommit?: string; landed?: string }, prs: { value?: Pr[]; pending?: boolean } = {}): ModuleServerHost {
  return {
    root,
    run: async () => ({
      record: agent,
      changedNothing: !agent.pr && agent.landed === undefined && (agent.status === 'done' || agent.status === 'failed' || agent.status === 'stopped') && agent.host === 'this-machine',
    }),
    mergeCommit: async (_branch, number) => {
      if (prs.pending && prs.value === undefined) return { pending: true }
      const pr = prs.value?.find(pr => pr.number === number)
      return pr?.mergeCommit ? { pending: false, commit: pr.mergeCommit, ...(typeof pr['headRefOid'] === 'string' ? { head: pr['headRefOid'] } : {}) } : { pending: false }
    },
  }
}

/** Where the run with no checkout that `host` describes has its work. */
const resolve = (host: ModuleServerHost) => resolveAgentWork(host, 'run-x', undefined, 'this-machine')

/** Commit a change on the current branch of `cwd`: files written, files removed. */
function commit(cwd: string, message: string, write: Record<string, string>, remove: string[] = []): string {
  for (const [path, text] of Object.entries(write)) execFileSync('sh', ['-c', `mkdir -p "$(dirname '${path}')" && printf '%s' '${text}' > '${path}'`], { cwd })
  for (const path of remove) git(cwd, 'rm', '-q', path)
  git(cwd, 'add', '-A')
  git(cwd, 'commit', '-q', '-m', message)
  return git(cwd, 'rev-parse', 'HEAD')
}

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agent-changes-'))
  root = join(dir, 'repo')
  execFileSync('git', ['init', '-q', '-b', 'main', root])
  git(root, 'config', 'user.email', 't@t')
  git(root, 'config', 'user.name', 't')
  commit(root, 'base', { 'a.txt': 'a\n', 'c.txt': 'c\n', 'src/d.txt': 'd\n' })
})
after(() => rm(dir, { recursive: true, force: true }))

test('a live checkout marks committed and uncommitted changes apart, the uncommitted mark winning', async () => {
  const path = join(dir, 'wt-live')
  git(root, 'worktree', 'add', '-q', '-b', 'agent-live', path)
  commit(path, 'work', { 'a.txt': 'a2\n', 'b.txt': 'b\n' }, ['c.txt'])
  await writeFile(join(path, 'b.txt'), 'b edited\n')
  await writeFile(join(path, 'src/d.txt'), 'd2\n')
  await writeFile(join(path, 'e.txt'), 'new\n')

  const at = await resolveAgentWork(inCheckout(path), 'run-live')
  assert.equal(at.source, 'checkout')
  const read = await readAgentChanges(root, at)
  assert.equal(read.source, 'checkout')
  if (read.source !== 'checkout') return
  assert.deepEqual(read.changes, {
    'a.txt': { status: 'modified', committed: true },
    'b.txt': { status: 'modified', committed: false },
    'c.txt': { status: 'deleted', committed: true },
    'e.txt': { status: 'untracked', committed: false },
    'src/d.txt': { status: 'modified', committed: false },
  })

  const committed = await readAgentFileDiff(root, at, 'a.txt')
  assert.match(committed?.patch ?? '', /-a\n\+a2/, 'a committed file diffs from the fork point')
  const pending = await readAgentFileDiff(root, at, 'src/d.txt')
  assert.match(pending?.patch ?? '', /-d\n\+d2/, 'an uncommitted file diffs against its last commit')
  assert.equal(await readAgentFileDiff(root, at, 'README.md'), null)
})

test('with no checkout, the local branch is read by ref', async () => {
  git(root, 'branch', 'agent-local', 'main')
  const path = join(dir, 'wt-local')
  git(root, 'worktree', 'add', '-q', path, 'agent-local')
  commit(path, 'work', { 'a.txt': 'local\n', 'f.txt': 'f\n' }, ['src/d.txt'])
  git(root, 'worktree', 'remove', path)

  const at = await resolve(deps({ branch: 'agent-local' }))
  assert.equal(at.source, 'branch')
  const read = await readAgentChanges(root, at)
  assert.deepEqual(read, {
    source: 'branch',
    branch: 'agent-local',
    changes: {
      'a.txt': { status: 'modified', committed: true },
      'f.txt': { status: 'added', committed: true },
      'src/d.txt': { status: 'deleted', committed: true },
    },
    merged: false,
  })
  assert.match((await readAgentFileDiff(root, at, 'a.txt'))?.patch ?? '', /-a\n\+local/)
  assert.equal(await readAgentFileDiff(root, at, '../x'), null, 'an unsafe path is refused')
})

test('a branch only origin holds is read from its remote-tracking ref', async () => {
  git(root, 'branch', 'agent-remote', 'main')
  const path = join(dir, 'wt-remote')
  git(root, 'worktree', 'add', '-q', path, 'agent-remote')
  const tip = commit(path, 'work', { 'g.txt': 'g\n' })
  git(root, 'worktree', 'remove', path)
  git(root, 'update-ref', 'refs/remotes/origin/agent-remote', tip)
  git(root, 'branch', '-q', '-D', 'agent-remote')

  const read = await readAgentChanges(root, await resolve(deps({ branch: 'agent-remote' })))
  assert.equal(read.source, 'branch')
  if (read.source === 'branch') assert.deepEqual(read.changes, { 'g.txt': { status: 'added', committed: true } })
})

test('once the branch is gone, the squash commit its pull request merged as is read', async () => {
  git(root, 'checkout', '-q', 'main')
  const squash = commit(root, 'squash (#5)', { 'h.txt': 'h\n', 'a.txt': 'squashed\n' })

  const at = await resolve(deps({ branch: 'agent-squash', pr: { number: 5 } }, { value: [{ number: 5, url: 'u', state: 'MERGED', title: '', mergeCommit: squash }] }))
  assert.deepEqual(at, { source: 'merge', number: 5, ref: squash, base: git(root, 'rev-parse', `${squash}^1`) })
  const read = await readAgentChanges(root, at)
  assert.equal(read.source, 'merge')
  if (read.source === 'merge') {
    assert.equal(read.number, 5)
    assert.deepEqual(read.changes, { 'a.txt': { status: 'modified', committed: true }, 'h.txt': { status: 'added', committed: true } })
  }
})

test('a branch the default branch already contains (a true merge) reads its merge commit instead', async () => {
  git(root, 'checkout', '-q', '-b', 'agent-merged')
  commit(root, 'work', { 'i.txt': 'i\n' })
  git(root, 'checkout', '-q', 'main')
  git(root, 'merge', '-q', '--no-ff', '-m', 'merge (#6)', 'agent-merged')
  const merge = git(root, 'rev-parse', 'HEAD')

  const pr = { value: [{ number: 6, url: 'u', state: 'MERGED', title: '', mergeCommit: merge }] }
  const read = await readAgentChanges(root, await resolve(deps({ branch: 'agent-merged', pr: { number: 6 } }, pr)))
  assert.equal(read.source, 'merge')
  if (read.source === 'merge') assert.deepEqual(read.changes, { 'i.txt': { status: 'added', committed: true } })

  const noPr = await resolve(deps({ branch: 'agent-merged' }))
  assert.equal(noPr.source, 'branch', 'with no merge commit to read, the branch still answers')
})

/** A run that finished on this machine. */
const endedHere = { status: 'done', host: 'this-machine' }

test('a run that finished here with no checkout, no branch and no pull request changed nothing', async () => {
  const at = await resolve(deps({ ...endedHere, branch: 'agent-committed-nothing' }))
  assert.deepEqual(at, { source: 'unchanged' })
  assert.deepEqual(await readAgentChanges(root, at), { source: 'unchanged', changes: {} })
  assert.equal(await readAgentFileDiff(root, at, 'a.txt'), null, 'nothing changed, so nothing diffs')
  // A run that failed here was ended by its own tool too: its branch went with its checkout only because it held nothing.
  assert.deepEqual(await resolve(deps({ status: 'failed', host: 'this-machine', branch: 'agent-failed-before-work' })), at)
})

test('no checkout, no branch and no merge commit on this machine: gone', async () => {
  assert.deepEqual(await resolve(deps({ status: 'done', host: 'other-machine', branch: 'agent-never-pushed' })), { source: 'gone' }, 'a run from another machine: its branch may just not be here')
  for (const status of ['waiting']) {
    assert.deepEqual(await resolve(deps({ status, host: 'this-machine', branch: 'agent-renamed-away' })), { source: 'gone' }, `a ${status} run: its record may not name its branch's last name`)
  }
  assert.deepEqual(await resolve(deps({ status: 'done' })), { source: 'gone' }, 'a run that names no machine')
  const unfetched = { value: [{ number: 7, url: 'u', state: 'MERGED', title: '', mergeCommit: 'f'.repeat(40) }] }
  assert.deepEqual(await resolve(deps({ ...endedHere, branch: 'agent-gone', pr: { number: 7 } }, unfetched)), { source: 'gone' }, 'a merge commit this machine has not fetched')
  const other = { value: [{ number: 8, url: 'u', state: 'MERGED', title: '', mergeCommit: git(root, 'rev-parse', 'HEAD') }] }
  assert.deepEqual(await resolve(deps({ ...endedHere, branch: 'agent-gone', pr: { number: 7 } }, other)), { source: 'gone' }, 'another pull request on the branch is not this run’s')
  assert.deepEqual(await readAgentChanges(root, { source: 'gone' }), { source: 'gone' })
})

test('a run starting here has changed nothing yet; one running elsewhere is pending', async () => {
  const unknown: ModuleServerHost = { root, run: async () => undefined, mergeCommit: async () => ({ pending: false }) }
  assert.deepEqual(await resolve(unknown), { source: 'starting' }, 'the page opened before the run wrote its record')
  assert.deepEqual(await resolve(deps({ status: 'running', host: 'this-machine' })), { source: 'starting' }, 'recorded, its checkout not made yet')
  assert.deepEqual(await resolve(deps({ status: 'running', host: 'other-machine', branch: 'agent-not-here' })), { source: 'pending' }, 'running elsewhere, its branch not here yet')
  assert.deepEqual(await readAgentChanges(root, { source: 'starting' }), { source: 'starting', changes: {} })
})

test('a run whose record names a branch to start from that is not here is pending: it will fail on it, and a later read says so', async () => {
  const recorded = (record: { status: string; host: string; base?: string }): ModuleServerHost => ({ root, run: async () => ({ record, changedNothing: false }), mergeCommit: async () => ({ pending: false }) })
  assert.deepEqual(await resolve(recorded({ status: 'running', host: 'this-machine', base: 'main' })), { source: 'starting' })
  assert.deepEqual(await resolve(recorded({ status: 'running', host: 'this-machine', base: 'deleted-branch' })), { source: 'pending' })
  assert.deepEqual(await resolve(recorded({ status: 'running', host: 'other-machine', base: 'main' })), { source: 'pending' }, 'starting elsewhere: that machine’s branch, not this one’s')
})

test('a checkout reclaimed since it was listed is no source: its branch is read, else pending, never an empty list or a start', async () => {
  const gone = join(dir, 'reclaimed-checkout')
  const withGone = (record?: { status?: string; host?: string; branch?: string }): ModuleServerHost => ({
    root,
    run: async () => ({ checkout: gone, ...(record ? { record } : {}), changedNothing: false }),
    mergeCommit: async () => ({ pending: false }),
  })
  assert.deepEqual(await resolve(withGone()), { source: 'pending' }, 'no record yet')
  assert.deepEqual(await resolve(withGone({ status: 'running', host: 'this-machine' })), { source: 'pending' }, 'its record not caught up: it ended, it is not starting')
  git(root, 'branch', '-f', 'agent-reclaimed', 'HEAD')
  commit(root, 'on main after', { 'after.txt': 'x\n' })
  git(root, 'branch', '-f', 'agent-reclaimed', 'HEAD~1')
  assert.equal((await resolve(withGone({ status: 'running', host: 'this-machine', branch: 'agent-reclaimed' }))).source, 'branch', 'its branch, once named')
})

test('while the pull request is being looked up, the answer is pending', async () => {
  assert.deepEqual(await resolve(deps({ branch: 'agent-gone', pr: { number: 7 } }, { pending: true })), { source: 'pending' })
})

test('a run started from another run’s branch is measured from the commit its own work begins at: in its checkout, on its branch, and once it is landed and its branch gone', async () => {
  git(root, 'checkout', '-q', 'main')
  // A main agent's branch with work of its own, and a subagent's started from it.
  const mainPath = join(dir, 'wt-main-agent')
  git(root, 'worktree', 'add', '-q', '-b', 'agent-main-agent', mainPath, 'main')
  const start = commit(mainPath, 'the main agent’s work', { 'plan.txt': 'plan\n' })
  const subPath = join(dir, 'wt-subagent')
  git(root, 'worktree', 'add', '-q', '-b', 'agent-subagent', subPath, 'agent-main-agent')
  const tip = commit(subPath, 'the subagent’s part', { 'part.txt': 'part\n' })
  const own = { 'part.txt': { status: 'added', committed: true } }

  // In its checkout: without the commit on its record, the main agent's work reads as its own.
  const unknown = await readAgentChanges(root, await resolveAgentWork(inCheckout(subPath), 'run-sub'))
  assert.deepEqual(unknown.source === 'checkout' && Object.keys(unknown.changes).sort(), ['part.txt', 'plan.txt'])
  const live = await resolveAgentWork(inCheckout(subPath, { baseCommit: start }), 'run-sub')
  const liveRead = await readAgentChanges(root, live)
  assert.deepEqual(liveRead.source === 'checkout' && liveRead.changes, own)
  assert.equal(await readAgentFileDiff(root, live, 'plan.txt'), null, 'the main agent’s file is no change of this run')

  // On its branch, its checkout gone.
  git(root, 'worktree', 'remove', subPath)
  const onBranch = await resolve(deps({ status: 'done', host: 'this-machine', branch: 'agent-subagent', baseCommit: start }))
  assert.deepEqual(onBranch, { source: 'branch', branch: 'agent-subagent', ref: tip, base: start, merged: false })
  const branchRead = await readAgentChanges(root, onBranch)
  assert.deepEqual(branchRead.source === 'branch' && branchRead.changes, own)
  // A commit this machine does not have is no base: the default branch is.
  const elsewhere = await readAgentChanges(root, await resolve(deps({ branch: 'agent-subagent', baseCommit: '0'.repeat(40) })))
  assert.deepEqual(elsewhere.source === 'branch' && Object.keys(elsewhere.changes).sort(), ['part.txt', 'plan.txt'])

  // Landed: merged into the main agent's branch, its own branch gone, its last commit kept and on its record.
  git(mainPath, 'merge', '-q', '--no-ff', '-m', 'Merge branch agent-subagent', 'agent-subagent')
  git(root, 'update-ref', 'refs/landed/run-sub', tip)
  git(root, 'branch', '-q', '-D', 'agent-subagent')
  const landed = await resolve(deps({ status: 'done', host: 'this-machine', baseCommit: start, landed: tip }))
  assert.deepEqual(landed, { source: 'landed', ref: tip, base: start })
  const landedRead = await readAgentChanges(root, landed)
  assert.equal(landedRead.source, 'landed')
  if (landedRead.source !== 'landed') return
  assert.deepEqual(landedRead.changes, own)
  assert.match((await readAgentFileDiff(root, landed, 'part.txt'))?.patch ?? '', /\+part/)

  // The main agent's branch squashed and deleted later changes nothing: the kept ref holds the commit.
  git(root, 'worktree', 'remove', mainPath)
  git(root, 'branch', '-q', '-D', 'agent-main-agent')
  assert.deepEqual(await readAgentChanges(root, await resolve(deps({ status: 'done', host: 'this-machine', baseCommit: start, landed: tip }))), landedRead)

  // A landed run whose commit this machine does not have is gone, never "changed nothing".
  assert.deepEqual(await resolve(deps({ status: 'done', host: 'this-machine', landed: '0'.repeat(40) })), { source: 'gone' })
})

test('a run from the default branch whose record names its start: what it took in from the default branch is not marked, and its changes are still marked once the default branch has them', async () => {
  git(root, 'checkout', '-q', 'main')
  const start = git(root, 'rev-parse', 'main')
  const path = join(dir, 'wt-started')
  git(root, 'worktree', 'add', '-q', '-b', 'agent-started', path, 'main')
  commit(path, 'own work', { 'own.txt': 'own\n' })
  // The default branch moves on, and the run takes it in.
  commit(root, 'somebody else', { 'theirs.txt': 'theirs\n' })
  git(path, 'merge', '-q', '--no-ff', '-m', 'take main in', 'main')
  const own = { 'own.txt': { status: 'added', committed: true } }
  const live = await readAgentChanges(root, await resolveAgentWork(inCheckout(path, { baseCommit: start }), 'run-started'))
  assert.deepEqual(live.source === 'checkout' && live.changes, own)

  // Merged into the default branch, its branch still here: measured from its start.
  git(root, 'worktree', 'remove', path)
  git(root, 'merge', '-q', '--ff-only', 'agent-started')
  const merged = await readAgentChanges(root, await resolve(deps({ status: 'done', host: 'this-machine', branch: 'agent-started', baseCommit: start })))
  assert.equal(merged.source, 'branch')
  assert.ok(merged.source === 'branch' && merged.changes['own.txt'], 'what it changed is still read')
  // With no start on its record, nothing is left to mark once it is merged.
  const unnamed = await readAgentChanges(root, await resolve(deps({ status: 'done', host: 'this-machine', branch: 'agent-started' })))
  assert.deepEqual(unnamed.source === 'branch' && unnamed.changes, {})
  git(root, 'branch', '-q', '-D', 'agent-started')
})

test('whether a run’s work is merged: not while the default branch lacks it, once that branch has it, once its pull request merged at its last commit, and never with work left uncommitted', async () => {
  git(root, 'checkout', '-q', 'main')
  const start = git(root, 'rev-parse', 'main')
  const path = join(dir, 'wt-waiting')
  git(root, 'worktree', 'add', '-q', '-b', 'agent-waiting', path, 'main')
  const run = { status: 'done', host: 'this-machine', branch: 'agent-waiting', baseCommit: start }

  // Nothing changed yet: nothing is merged, whatever the default branch holds.
  const idle = await readAgentChanges(root, await resolveAgentWork(inCheckout(path, { baseCommit: start }), 'run-waiting'))
  assert.equal(idle.source === 'checkout' && idle.merged, false)

  const tip = commit(path, 'own work', { 'kept.txt': 'kept\n' }, ['c.txt'])
  const waiting = await readAgentChanges(root, await resolveAgentWork(inCheckout(path, { baseCommit: start }), 'run-waiting'))
  assert.equal(waiting.source === 'checkout' && waiting.merged, false, 'the default branch does not have it yet')

  // Squashed by its pull request, the branch still here: merged when the request merged this very commit.
  const squashed = { value: [{ number: 9, url: 'u', state: 'MERGED', title: '', mergeCommit: start, headRefOid: tip }] }
  const bySquash = await resolve(deps({ ...run, pr: { number: 9 } }, squashed))
  assert.deepEqual(bySquash, { source: 'branch', branch: 'agent-waiting', ref: tip, base: start, merged: true })
  const movedOn = { value: [{ number: 9, url: 'u', state: 'MERGED', title: '', mergeCommit: start, headRefOid: start }] }
  assert.equal((await resolve(deps({ ...run, pr: { number: 9 } }, movedOn)) as { merged?: boolean }).merged, false, 'a commit made after the merge is not merged')
  assert.equal((await resolve(deps({ ...run, pr: { number: 9 } }, { pending: true })) as { merged?: boolean }).merged, false, 'a lookup still out says nothing')

  // The default branch takes it in.
  git(root, 'merge', '-q', '--ff-only', 'agent-waiting')
  const inCheckoutRead = await readAgentChanges(root, await resolveAgentWork(inCheckout(path, { baseCommit: start }), 'run-waiting'))
  assert.deepEqual(inCheckoutRead.source === 'checkout' && [inCheckoutRead.merged, inCheckoutRead.changes], [true, { 'c.txt': { status: 'deleted', committed: true }, 'kept.txt': { status: 'added', committed: true } }])
  // More work on disk, not committed: that is not merged.
  await writeFile(join(path, 'more.txt'), 'more\n')
  const dirty = await readAgentChanges(root, await resolveAgentWork(inCheckout(path, { baseCommit: start }), 'run-waiting'))
  assert.equal(dirty.source === 'checkout' && dirty.merged, false)
  await unlink(join(path, 'more.txt'))

  git(root, 'worktree', 'remove', path)
  const onBranch = await readAgentChanges(root, await resolve(deps(run)))
  assert.deepEqual(onBranch, { source: 'branch', branch: 'agent-waiting', changes: { 'c.txt': { status: 'deleted', committed: true }, 'kept.txt': { status: 'added', committed: true } }, merged: true })
  assert.match((await readAgentFileDiff(root, await resolve(deps(run)), 'kept.txt'))?.patch ?? '', /\+kept/, 'its diff is still read')

  // Landed, its branch gone: merged by what it is.
  git(root, 'update-ref', 'refs/landed/run-waiting', tip)
  git(root, 'branch', '-q', '-D', 'agent-waiting')
  const landed = await readAgentChanges(root, await resolve(deps({ status: 'done', host: 'this-machine', baseCommit: start, landed: tip })))
  assert.equal(landed.source === 'landed' && landed.merged, true)
})

test('a run’s commits are listed newest first, uncommitted work in none; one commit reads as what it alone changed; a commit that is not the run’s is not read', async () => {
  const path = join(dir, 'wt-commits')
  git(root, 'worktree', 'add', '-q', '-b', 'agent-commits', path, 'main')
  const base = git(root, 'rev-parse', 'main')
  const first = commit(path, 'Add b', { 'b.txt': 'b\n' })
  const second = commit(path, 'Change a, drop b', { 'a.txt': 'a3\n' }, ['b.txt'])
  await writeFile(join(path, 'e.txt'), 'not committed\n')

  const at = await resolveAgentWork(inCheckout(path), 'run-commits')
  const commits = await readAgentCommits(root, at)
  assert.deepEqual(commits.map(c => [c.sha, c.subject, c.author]), [[second, 'Change a, drop b', 't'], [first, 'Add b', 't']])
  assert.equal(commits[0]!.short, second.slice(0, commits[0]!.short.length))
  assert.ok(!Number.isNaN(Date.parse(commits[0]!.date)))

  // All changes: b.txt came and went, so it is not marked. One commit: only its own change.
  const read = await readAgentChanges(root, at)
  assert.deepEqual(Object.keys('changes' in read ? read.changes : {}).sort(), ['a.txt', 'e.txt'])
  assert.deepEqual(await readAgentCommitChanges(root, at, first), { 'b.txt': { status: 'added', committed: true } })
  assert.deepEqual(await readAgentCommitChanges(root, at, second), { 'a.txt': { status: 'modified', committed: true }, 'b.txt': { status: 'deleted', committed: true } })
  assert.match((await readAgentCommitFileDiff(root, at, first, 'b.txt'))?.patch ?? '', /\+b/)
  assert.match((await readAgentCommitFileDiff(root, at, second, 'a.txt'))?.patch ?? '', /\+a3/)
  assert.equal(await readAgentCommitFileDiff(root, at, first, 'a.txt'), null, 'a path the commit did not change')
  assert.equal(await readAgentCommitFileDiff(root, at, second, '../outside'), null)

  // The project's own commit is not one of the run's, and neither is a name that is no commit id.
  assert.equal(await readAgentCommitChanges(root, at, base), null)
  assert.equal(await readAgentCommitFileDiff(root, at, base, 'a.txt'), null)
  assert.equal(await readAgentCommitChanges(root, at, 'main'), null)

  // The same list once the checkout is gone, read from the branch; none for a run with nothing measured.
  const onBranch = await resolve(deps({ status: 'done', host: 'this-machine', branch: 'agent-commits' }))
  assert.deepEqual((await readAgentCommits(root, onBranch)).map(c => c.sha), [second, first])
  assert.deepEqual(await readAgentCommitChanges(root, onBranch, first), { 'b.txt': { status: 'added', committed: true } })
  assert.deepEqual(await readAgentCommits(root, { source: 'gone' }), [])
  assert.deepEqual(await readAgentCommits(root, { source: 'unchanged' }), [])
})

test('each changed file carries its lines added and removed, committed or on disk', async () => {
  const path = join(dir, 'wt-counts')
  git(root, 'worktree', 'add', '-q', '-b', 'agent-counts', path, 'main')
  const base = git(root, 'rev-parse', 'main')
  commit(path, 'two lines', { 'counted.txt': 'one\ntwo\n' })
  await writeFile(join(path, 'loose.txt'), 'a\nb\nc\n')
  const read = await readChanges(root, await resolveAgentWork(inCheckout(path, { baseCommit: base }), 'run-counts'))
  assert.ok('changes' in read)
  assert.deepEqual(read.changes['counted.txt'], { status: 'added', committed: true, added: 2, removed: 0 })
  assert.deepEqual(read.changes['loose.txt'], { status: 'untracked', committed: false, added: 3, removed: 0 })
})
