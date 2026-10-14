import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import type { ModuleServerHost } from '@openagt/dashboard/module-server'
import { readAgentFileContent, readAgentTree, resolveAgentFiles } from './tree.js'

let dir: string
let root: string
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

/** The host for a run that has a checkout at `path`. */
const inCheckout = (path: string): ModuleServerHost => ({
  root,
  run: async () => ({ checkout: path, changedNothing: false }),
  mergeCommit: async () => ({ pending: false }),
})

/** A pull request on a run's branch, as the git host answers it. */
type Pr = { number: number; mergeCommit?: string } & Record<string, unknown>

/**
 * The host for a run with no checkout, the given record, and the given pull requests on its
 * branch. "Changed nothing" is the core's rule, as the core's host answers it: it ended `done` or
 * `failed` on this machine, with no pull request, and was not landed.
 */
function deps(agent: { status?: string; host?: string; branch?: string; pr?: { number: number }; base?: string; landed?: string }, prs: { value?: Pr[]; pending?: boolean } = {}): ModuleServerHost {
  return {
    root,
    run: async () => ({
      record: agent,
      changedNothing: !agent.pr && agent.landed === undefined && (agent.status === 'done' || agent.status === 'failed' || agent.status === 'stopped') && agent.host === 'this-machine',
    }),
    mergeCommit: async (_branch, number) => {
      if (prs.pending && prs.value === undefined) return { pending: true }
      const pr = prs.value?.find(pr => pr.number === number)
      return pr?.mergeCommit ? { pending: false, commit: pr.mergeCommit } : { pending: false }
    },
  }
}

/** Where the run with no checkout that `host` describes has its files. */
const resolve = (host: ModuleServerHost) => resolveAgentFiles(host, 'run-x', undefined, 'this-machine')

/** Commit a change on the current branch of `cwd`: files written, files removed. */
function commit(cwd: string, message: string, write: Record<string, string>, remove: string[] = []): string {
  for (const [path, text] of Object.entries(write)) execFileSync('sh', ['-c', `mkdir -p "$(dirname '${path}')" && printf '%s' '${text}' > '${path}'`], { cwd })
  for (const path of remove) git(cwd, 'rm', '-q', path)
  git(cwd, 'add', '-A')
  git(cwd, 'commit', '-q', '-m', message)
  return git(cwd, 'rev-parse', 'HEAD')
}

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agent-files-'))
  root = join(dir, 'repo')
  execFileSync('git', ['init', '-q', '-b', 'main', root])
  git(root, 'config', 'user.email', 't@t')
  git(root, 'config', 'user.name', 't')
  commit(root, 'base', { 'a.txt': 'a\n', 'c.txt': 'c\n', 'src/d.txt': 'd\n' })
})
after(() => rm(dir, { recursive: true, force: true }))

test('a live checkout lists every file that is there on disk, committed or not, and none that was deleted', async () => {
  const path = join(dir, 'wt-live')
  git(root, 'worktree', 'add', '-q', '-b', 'agent-live', path)
  commit(path, 'work', { 'a.txt': 'a2\n', 'b.txt': 'b\n' }, ['c.txt'])
  await writeFile(join(path, 'e.txt'), 'new\n')
  await unlink(join(path, 'src/d.txt'))

  const at = await resolveAgentFiles(inCheckout(path), 'run-live')
  assert.deepEqual(at, { source: 'checkout', path })
  assert.deepEqual(await readAgentTree(root, at), { source: 'checkout', files: ['a.txt', 'b.txt', 'e.txt'] })
  assert.equal((await readAgentFileContent(root, at, 'a.txt'))?.text, 'a2', 'the checkout’s copy, not the project’s')
  assert.equal(await readAgentFileContent(root, at, 'src/d.txt'), null, 'a file deleted on disk is not read')
})

test('with no checkout, the local branch is read by ref', async () => {
  git(root, 'branch', 'agent-local', 'main')
  const path = join(dir, 'wt-local')
  git(root, 'worktree', 'add', '-q', path, 'agent-local')
  const tip = commit(path, 'work', { 'a.txt': 'local\n', 'f.txt': 'f\n' }, ['src/d.txt'])
  git(root, 'worktree', 'remove', path)

  const at = await resolve(deps({ branch: 'agent-local' }))
  assert.deepEqual(at, { source: 'branch', branch: 'agent-local', ref: tip })
  assert.deepEqual(await readAgentTree(root, at), { source: 'branch', branch: 'agent-local', files: ['a.txt', 'c.txt', 'f.txt'] })
  assert.deepEqual(await readAgentFileContent(root, at, 'f.txt'), { path: 'f.txt', text: 'f', truncated: false, binary: false })
  assert.equal(await readAgentFileContent(root, at, '../x'), null, 'an unsafe path is refused')
})

test('a branch only origin holds is read from its remote-tracking ref', async () => {
  git(root, 'branch', 'agent-remote', 'main')
  const path = join(dir, 'wt-remote')
  git(root, 'worktree', 'add', '-q', path, 'agent-remote')
  const tip = commit(path, 'work', { 'g.txt': 'g\n' })
  git(root, 'worktree', 'remove', path)
  git(root, 'update-ref', 'refs/remotes/origin/agent-remote', tip)
  git(root, 'branch', '-q', '-D', 'agent-remote')

  const tree = await readAgentTree(root, await resolve(deps({ branch: 'agent-remote' })))
  assert.ok(tree.source === 'branch' && tree.files.includes('g.txt'))
})

test('once the branch is gone, the commit its pull request merged as is read; a branch still here answers before it', async () => {
  git(root, 'checkout', '-q', 'main')
  const squash = commit(root, 'squash (#5)', { 'h.txt': 'h\n', 'a.txt': 'squashed\n' })
  const pr = { value: [{ number: 5, url: 'u', state: 'MERGED', title: '', mergeCommit: squash }] }

  const at = await resolve(deps({ branch: 'agent-squash', pr: { number: 5 } }, pr))
  assert.deepEqual(at, { source: 'merge', number: 5, ref: squash })
  const tree = await readAgentTree(root, at)
  assert.ok(tree.source === 'merge' && tree.number === 5 && tree.files.includes('h.txt'))
  assert.deepEqual(await readAgentFileContent(root, at, 'h.txt'), { path: 'h.txt', text: 'h', truncated: false, binary: false })
  assert.equal((await resolve(deps({ branch: 'agent-local', pr: { number: 5 } }, pr))).source, 'branch')
})

/** A run that finished on this machine. */
const endedHere = { status: 'done', host: 'this-machine' }

test('a run that finished here with no checkout, no branch and no pull request changed nothing, and the project reads as its default branch has it', async () => {
  const at = await resolve(deps({ ...endedHere, branch: 'agent-committed-nothing' }))
  assert.deepEqual(at, { source: 'unchanged', ref: git(root, 'rev-parse', 'main') })
  assert.deepEqual(await readAgentTree(root, at), { source: 'unchanged', files: git(root, 'ls-tree', '-r', '--name-only', 'main').split('\n') })
  assert.equal((await readAgentFileContent(root, at, 'a.txt'))?.text, git(root, 'show', 'main:a.txt'), 'a file reads as the default branch has it')
  // A run that failed here was ended by its own tool too: its branch went with its checkout only because it held nothing.
  assert.deepEqual(await resolve(deps({ status: 'failed', host: 'this-machine', branch: 'agent-failed-before-work' })), at)
})

test('a landed run, its branch gone, is read at the last commit its record kept', async () => {
  const path = join(dir, 'wt-landed')
  git(root, 'worktree', 'add', '-q', '-b', 'agent-landed', path, 'main')
  const tip = commit(path, 'part', { 'part.txt': 'part\n' })
  git(root, 'worktree', 'remove', path)
  git(root, 'update-ref', 'refs/landed/run-landed', tip)
  git(root, 'branch', '-q', '-D', 'agent-landed')

  const at = await resolve(deps({ ...endedHere, landed: tip }))
  assert.deepEqual(at, { source: 'landed', ref: tip })
  const tree = await readAgentTree(root, at)
  assert.ok(tree.source === 'landed' && tree.files.includes('part.txt'))
  assert.deepEqual(await resolve(deps({ ...endedHere, landed: '0'.repeat(40) })), { source: 'gone' }, 'a commit this machine does not have is gone, never "changed nothing"')
})

test('no checkout, no branch and no merge commit on this machine: gone', async () => {
  assert.deepEqual(await resolve(deps({ status: 'done', host: 'other-machine', branch: 'agent-never-pushed' })), { source: 'gone' }, 'a run from another machine: its branch may just not be here')
  assert.deepEqual(await resolve(deps({ status: 'waiting', host: 'this-machine', branch: 'agent-renamed-away' })), { source: 'gone' }, 'a waiting run: its record may not name its branch’s last name')
  assert.deepEqual(await resolve(deps({ status: 'done' })), { source: 'gone' }, 'a run that names no machine')
  const unfetched = { value: [{ number: 7, url: 'u', state: 'MERGED', title: '', mergeCommit: 'f'.repeat(40) }] }
  assert.deepEqual(await resolve(deps({ ...endedHere, branch: 'agent-gone', pr: { number: 7 } }, unfetched)), { source: 'gone' }, 'a merge commit this machine has not fetched')
  const other = { value: [{ number: 8, url: 'u', state: 'MERGED', title: '', mergeCommit: git(root, 'rev-parse', 'HEAD') }] }
  assert.deepEqual(await resolve(deps({ ...endedHere, branch: 'agent-gone', pr: { number: 7 } }, other)), { source: 'gone' }, 'another pull request on the branch is not this run’s')
  assert.deepEqual(await readAgentTree(root, { source: 'gone' }), { source: 'gone' })
})

test('a run starting here, in a project with no remote, reads the project HEAD its checkout is made from; one running elsewhere is pending', async () => {
  const head = git(root, 'rev-parse', 'HEAD')
  const unknown: ModuleServerHost = { root, run: async () => undefined, mergeCommit: async () => ({ pending: false }) }
  assert.deepEqual(await resolve(unknown), { source: 'starting', ref: head }, 'the page opened before the run wrote its record')
  assert.deepEqual(await resolve(deps({ status: 'running', host: 'this-machine' })), { source: 'starting', ref: head }, 'recorded, its checkout not made yet')
  assert.deepEqual(await resolve(deps({ status: 'running', host: 'other-machine', branch: 'agent-not-here' })), { source: 'pending' }, 'running elsewhere, its branch not here yet')
  const tree = await readAgentTree(root, { source: 'starting', ref: head })
  assert.deepEqual(tree, { source: 'starting', files: git(root, 'ls-tree', '-r', '--name-only', head).split('\n') })
})

test('a run starting here, in a project with a remote, reads origin’s default branch, never the branch the user has out', async () => {
  const project = join(dir, 'with-origin')
  execFileSync('git', ['init', '-q', '-b', 'main', project])
  git(project, 'config', 'user.email', 't@t')
  git(project, 'config', 'user.name', 't')
  const shared = commit(project, 'base', { 'a.txt': 'a\n' })
  execFileSync('git', ['init', '-q', '--bare', join(dir, 'with-origin.git')])
  git(project, 'remote', 'add', 'origin', join(dir, 'with-origin.git'))
  git(project, 'push', '-q', 'origin', 'main')
  git(project, 'checkout', '-q', '-b', 'my-feature')
  commit(project, 'unpushed', { 'secret.txt': 's\n' })
  const host: ModuleServerHost = { root: project, run: async () => undefined, mergeCommit: async () => ({ pending: false }) }
  assert.deepEqual(await resolveAgentFiles(host, 'run-x', undefined, 'this-machine'), { source: 'starting', ref: shared })
})

test('a run starting here whose record names the branch it starts from reads that branch, commits that are not pushed included; a branch that is not here is pending', async () => {
  const project = join(dir, 'with-origin-and-base')
  execFileSync('git', ['init', '-q', '-b', 'main', project])
  git(project, 'config', 'user.email', 't@t')
  git(project, 'config', 'user.name', 't')
  const shared = commit(project, 'base', { 'a.txt': 'a\n' })
  execFileSync('git', ['init', '-q', '--bare', join(dir, 'with-origin-and-base.git')])
  git(project, 'remote', 'add', 'origin', join(dir, 'with-origin-and-base.git'))
  git(project, 'push', '-q', 'origin', 'main')
  git(project, 'checkout', '-q', '-b', 'my-feature')
  const unpushed = commit(project, 'unpushed', { 'mine.txt': 'm\n' })
  const recorded = (record: { status: string; host: string; base?: string }): ModuleServerHost => ({ root: project, run: async () => ({ record, changedNothing: false }), mergeCommit: async () => ({ pending: false }) })
  const from = (host: ModuleServerHost) => resolveAgentFiles(host, 'run-x', undefined, 'this-machine')
  assert.deepEqual(await from(recorded({ status: 'running', host: 'this-machine', base: 'my-feature' })), { source: 'starting', ref: unpushed })
  assert.deepEqual((await readAgentTree(project, { source: 'starting', ref: unpushed })), { source: 'starting', files: ['a.txt', 'mine.txt'] })
  assert.deepEqual(await from(recorded({ status: 'running', host: 'this-machine' })), { source: 'starting', ref: shared }, 'no branch named: origin’s default branch, as before')
  assert.deepEqual(await from(recorded({ status: 'running', host: 'this-machine', base: 'deleted-branch' })), { source: 'pending' }, 'the run will fail on it: a later read says so')
  assert.deepEqual(await from(recorded({ status: 'running', host: 'other-machine', base: 'my-feature' })), { source: 'pending' }, 'starting elsewhere: that machine’s branch, not this one’s')
})

test('a checkout reclaimed since it was listed is no source: its branch is read, else pending, never an empty tree or a start', async () => {
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
