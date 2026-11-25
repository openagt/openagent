import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { GIT_READ_TIMEOUT_MS, GIT_WRITE_TIMEOUT_MS, GIT_SLOW_TIMEOUT_MS, gitTimeoutMs, gitReason, pushBranch, GitTimeoutError, isGitTimeout } from './git.js'
import type { GitRunner } from '@openagt/hooks'

/**
 * Git invocations a caller may run through the runner — the package's own and a caller's (#997) —
 * against the budget each should get. The point of the split is that these are not all the same number.
 */
const BUDGETS: { args: string[]; ms: number }[] = [
  // The network and a whole checkout: the two the flat 10s budget was killing.
  { args: ['push', 'origin', 'agent-1'], ms: GIT_SLOW_TIMEOUT_MS },
  { args: ['worktree', 'add', '-b', 'agent-1', '/wt', 'main'], ms: GIT_SLOW_TIMEOUT_MS },
  { args: ['worktree', 'add', '/wt', 'agent-1'], ms: GIT_SLOW_TIMEOUT_MS },
  { args: ['clone', 'https://example.com/repo.git', '/dest'], ms: GIT_SLOW_TIMEOUT_MS },
  { args: ['fetch', 'origin'], ms: GIT_SLOW_TIMEOUT_MS },
  // Local mutations.
  { args: ['add', '-A'], ms: GIT_WRITE_TIMEOUT_MS },
  { args: ['commit', '-m', 'msg', '--', 'path'], ms: GIT_WRITE_TIMEOUT_MS },
  { args: ['init'], ms: GIT_WRITE_TIMEOUT_MS },
  { args: ['checkout', 'branch', '--', 'TODO.md'], ms: GIT_WRITE_TIMEOUT_MS },
  { args: ['worktree', 'remove', '--force', '/wt'], ms: GIT_WRITE_TIMEOUT_MS },
  { args: ['worktree', 'prune'], ms: GIT_WRITE_TIMEOUT_MS },
  // Reads, which must stay short so a hung one does not hold the daemon for minutes.
  { args: ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], ms: GIT_READ_TIMEOUT_MS },
  { args: ['status', '--porcelain'], ms: GIT_READ_TIMEOUT_MS },
  { args: ['rev-parse', '--abbrev-ref', 'HEAD'], ms: GIT_READ_TIMEOUT_MS },
  { args: ['rev-parse', '--git-common-dir'], ms: GIT_READ_TIMEOUT_MS },
  { args: ['rev-list', '--count', 'a..b'], ms: GIT_READ_TIMEOUT_MS },
  { args: ['log', '--format=%H%x1f%s', 'a..b'], ms: GIT_READ_TIMEOUT_MS },
  { args: ['diff', '--numstat', 'HEAD'], ms: GIT_READ_TIMEOUT_MS },
  { args: ['show', 'HEAD:TODO.md'], ms: GIT_READ_TIMEOUT_MS },
  { args: ['remote', 'get-url', 'origin'], ms: GIT_READ_TIMEOUT_MS },
  { args: ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], ms: GIT_READ_TIMEOUT_MS },
  { args: ['branch', '--list', '--merged', 'main', 'topic'], ms: GIT_READ_TIMEOUT_MS },
  { args: ['branch', '--remotes', '--contains', 'refs/heads/agent-x', '--format=%(refname:short)'], ms: GIT_READ_TIMEOUT_MS },
  { args: ['branch'], ms: GIT_READ_TIMEOUT_MS },
  // A global option ahead of the subcommand is not one of its flags (#1757): the listing still reads.
  { args: ['-C', '/repo', 'branch', '--list'], ms: GIT_READ_TIMEOUT_MS },
  { args: ['-c', 'core.quotepath=off', 'branch'], ms: GIT_READ_TIMEOUT_MS },
  { args: ['-C', '/repo', 'branch', '-D', 'agent-1'], ms: GIT_WRITE_TIMEOUT_MS },
  { args: ['branch', '-D', 'agent-1'], ms: GIT_WRITE_TIMEOUT_MS },
  { args: ['branch', '-m', 'agent-1', 'agent-cool'], ms: GIT_WRITE_TIMEOUT_MS },
  { args: ['branch', 'topic', 'abc123'], ms: GIT_WRITE_TIMEOUT_MS },
  { args: ['show-ref', '--verify', '--quiet', 'refs/heads/agent-x'], ms: GIT_READ_TIMEOUT_MS },
  { args: ['for-each-ref', '--format=%(refname)', 'refs/heads/', 'refs/remotes/'], ms: GIT_READ_TIMEOUT_MS },
  { args: ['worktree', 'list', '--porcelain'], ms: GIT_READ_TIMEOUT_MS },
]

for (const { args, ms } of BUDGETS) {
  test(`gitTimeoutMs: \`git ${args.join(' ')}\` gets ${ms}ms (#997)`, () => {
    assert.equal(gitTimeoutMs(args), ms)
  })
}

test('the git budgets stay split rather than collapsing to one number (#997)', () => {
  // Pinned on purpose: widening reads to "fix" a slow op would let a hung read hold the daemon.
  assert.equal(GIT_READ_TIMEOUT_MS, 10_000)
  assert.equal(GIT_WRITE_TIMEOUT_MS, 30_000)
  assert.equal(GIT_SLOW_TIMEOUT_MS, 120_000)
})

test('gitTimeoutMs: a slow op gets far longer than a read (#997)', () => {
  assert.ok(
    gitTimeoutMs(['push', 'origin', 'b']) > gitTimeoutMs(['rev-parse', 'HEAD']) * 2,
    'push must not run under a read budget',
  )
  assert.ok(
    gitTimeoutMs(['worktree', 'add', '-b', 'b', '/wt']) > gitTimeoutMs(['worktree', 'list']) * 2,
    'worktree add must not run under the budget its read sibling gets',
  )
})

test('gitTimeoutMs: an unknown subcommand is treated as a mutation, not as slow (#997)', () => {
  assert.equal(gitTimeoutMs(['bisect', 'start']), GIT_WRITE_TIMEOUT_MS)
  assert.equal(gitTimeoutMs([]), GIT_WRITE_TIMEOUT_MS)
})

test('gitTimeoutMs: leading flags do not hide the subcommand (#997)', () => {
  assert.equal(gitTimeoutMs(['--no-pager', 'status', '--porcelain']), GIT_READ_TIMEOUT_MS)
  assert.equal(gitTimeoutMs(['--no-pager', 'push', 'origin', 'b']), GIT_SLOW_TIMEOUT_MS)
})

test('gitTimeoutMs: the value of a global option is not mistaken for the subcommand', () => {
  assert.equal(gitTimeoutMs(['-C', '/repo', 'push', 'origin', 'b']), GIT_SLOW_TIMEOUT_MS)
  assert.equal(gitTimeoutMs(['-C', '/repo', 'status', '--porcelain']), GIT_READ_TIMEOUT_MS)
  assert.equal(gitTimeoutMs(['-C', '/repo', 'commit', '-m', 'msg']), GIT_WRITE_TIMEOUT_MS)
  assert.equal(gitTimeoutMs(['-c', 'user.name=x', 'fetch', 'origin']), GIT_SLOW_TIMEOUT_MS)
  assert.equal(gitTimeoutMs(['--git-dir', '/repo/.git', 'clone', 'url', '/dest']), GIT_SLOW_TIMEOUT_MS)
  assert.equal(gitTimeoutMs(['--work-tree', '/repo', 'pull']), GIT_SLOW_TIMEOUT_MS)
  assert.equal(gitTimeoutMs(['--namespace', 'ns', 'log']), GIT_READ_TIMEOUT_MS)
  assert.equal(gitTimeoutMs(['--exec-path', '/libexec', 'push']), GIT_SLOW_TIMEOUT_MS)
})

test('gitTimeoutMs: a global option before `worktree` does not hide `add`', () => {
  assert.equal(gitTimeoutMs(['-C', '/repo', 'worktree', 'add', '-b', 'b', '/wt']), GIT_SLOW_TIMEOUT_MS)
  assert.equal(gitTimeoutMs(['-C', '/repo', 'worktree', 'list', '--porcelain']), GIT_READ_TIMEOUT_MS)
})

test('gitTimeoutMs: an inline `--opt=value` global option carries its own value', () => {
  assert.equal(gitTimeoutMs(['--git-dir=/repo/.git', 'push', 'origin', 'b']), GIT_SLOW_TIMEOUT_MS)
  assert.equal(gitTimeoutMs(['--git-dir=/repo/.git', 'status']), GIT_READ_TIMEOUT_MS)
})

test('a failed push comes back as an error rather than throwing', async () => {
  const git: GitRunner = async () => {
    throw new Error('no remote configured')
  }
  const result = await pushBranch('/repo', 'b', git)
  assert.deepEqual(result, { ok: false, error: 'no remote configured' })
})

test('a timed-out push says so instead of reading like a rejected push (#997)', async () => {
  const git: GitRunner = async args => {
    throw new GitTimeoutError(args, GIT_SLOW_TIMEOUT_MS)
  }
  const result = await pushBranch('/repo', 'b', git)
  assert.equal(result.ok, false)
  const error = result.ok === false ? result.error : ''
  // A SIGTERM'd push has empty stderr, so this used to surface as a bare 'Command failed: git push'.
  assert.match(error, /timed out after 120000ms/)
  assert.match(error, /push origin b/)
})

test('a timeout is distinguishable from a git rejection (#997)', () => {
  assert.equal(isGitTimeout(new GitTimeoutError(['push'], 120_000)), true)
  assert.equal(isGitTimeout(new Error("fatal: 'origin' does not appear to be a git repository")), false)
})

test("a push failure shows git's reason, not the command echoed back", () => {
  // execFile buries the useful line under its own 'Command failed:' preamble.
  const err = new Error("Command failed: git push origin b\nfatal: 'origin' does not appear to be a git repository\n")
  assert.equal(gitReason(err), "fatal: 'origin' does not appear to be a git repository")
  assert.equal(gitReason(new Error('something odd')), 'something odd')
})
