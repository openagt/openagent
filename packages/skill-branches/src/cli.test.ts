import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { lstat, mkdir, mkdtemp, readFile, readlink, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { nodeGitRunner } from '@openagt/agent-data'
import { CLI_BIN_DIR, reconcileBranchLinks, runCli, worktreePath } from './index.js'

// #1725: the command line is the package's functions for an agent in a shell, so every command
// is checked against real git the way the functions are — and the contract on top of them: JSON
// on stdout, a line for a person on stderr, and an exit code that says refusal or failure.

const git = nodeGitRunner()

/** A repo with one commit, a bare `origin`, and a dependency directory for a checkout to inherit. */
async function repoWithOrigin(): Promise<string> {
  const repo = await realpath(await mkdtemp(join(tmpdir(), 'branches-cli-')))
  await git(['init', '-q', '-b', 'main'], repo)
  await git(['config', 'user.email', 't@t'], repo)
  await git(['config', 'user.name', 't'], repo)
  await writeFile(join(repo, 'index.html'), '<h1>Hello</h1>\n')
  await writeFile(join(repo, '.gitignore'), 'node_modules\n')
  await mkdir(join(repo, 'node_modules', 'dep'), { recursive: true })
  await git(['add', '-A'], repo)
  await git(['commit', '-q', '-m', 'init'], repo)
  await git(['init', '-q', '--bare', join(repo, 'origin.git')], repo)
  await git(['remote', 'add', 'origin', join(repo, 'origin.git')], repo)
  return repo
}

interface Ran {
  code: number
  out: unknown
  err: string
}

/** One in-process run of the CLI: its exit code, its stdout parsed, its stderr joined. */
async function run(cwd: string, ...argv: string[]): Promise<Ran> {
  const outLines: string[] = []
  const errLines: string[] = []
  const code = await runCli(argv, { cwd, stdout: line => outLines.push(line), stderr: line => errLines.push(line) })
  return { code, out: outLines.length ? JSON.parse(outLines.join('\n')) : undefined, err: errLines.join('\n') }
}

/** The agent commits its own work (#1638). */
async function commitWork(path: string, file = 'index.html'): Promise<void> {
  await writeFile(join(path, file), `<h1>Welcome ${file}</h1>\n`)
  await git(['config', 'user.email', 't@t'], path)
  await git(['config', 'user.name', 't'], path)
  await git(['add', '-A'], path)
  await git(['commit', '-q', '-m', 'work'], path)
}

async function isSymlink(path: string): Promise<boolean> {
  return lstat(path).then(s => s.isSymbolicLink(), () => false)
}

test('create: a checkout on agent-<id>, the parent dependencies linked in, .branches/ hidden from git', async () => {
  const repo = await repoWithOrigin()
  try {
    const { code, out } = await run(repo, 'create', 'a1')
    const path = worktreePath(repo, 'a1')
    assert.equal(code, 0)
    assert.deepEqual(out, { ok: true, path, branch: 'agent-a1' })
    assert.equal((await git(['rev-parse', '--abbrev-ref', 'HEAD'], path)).trim(), 'agent-a1')
    assert.equal(await isSymlink(join(path, 'node_modules', 'dep')), true, 'the dependency is a link to the parent tree')
    assert.equal((await stat(join(repo, '.branches', 'agent-a1'))).isDirectory(), true)
    assert.match(await readFile(join(repo, '.git', 'info', 'exclude'), 'utf8'), /^\/\.branches$/m, 'the checkouts are hidden through the exclude file')
    assert.doesNotMatch(await git(['status', '--porcelain'], repo), /\.branches/, "and never show up in the project's status")

    // From inside a checkout the same command still acts on the project.
    const nested = await run(join(path, 'node_modules'), 'create', 'a2', '--base', 'HEAD~0')
    assert.equal(nested.code, 0)
    assert.equal((await git(['rev-parse', '--abbrev-ref', 'HEAD'], worktreePath(repo, 'a2'))).trim(), 'agent-a2')
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('create: --base picks the commit the branch starts from', async () => {
  const repo = await repoWithOrigin()
  try {
    const base = (await git(['rev-parse', 'HEAD'], repo)).trim()
    await writeFile(join(repo, 'index.html'), '<h1>Later</h1>\n')
    await git(['commit', '-q', '-am', 'later'], repo)
    assert.equal((await run(repo, 'create', 'a1', '--base', base)).code, 0)
    assert.equal((await git(['rev-parse', 'HEAD'], worktreePath(repo, 'a1'))).trim(), base)
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('create and remove refuse an id that is not path-safe, before any git runs', async () => {
  const repo = await repoWithOrigin()
  try {
    const created = await run(repo, 'create', '../escape')
    assert.equal(created.code, 1)
    assert.deepEqual(created.out, { ok: false, reason: 'invalid-id', agentId: '../escape' })
    assert.match(created.err, /not an agent id/)
    assert.equal(await stat(join(repo, '.branches')).then(() => true, () => false), false, 'nothing was created')
    assert.deepEqual((await run(repo, 'remove', 'a/b')).out, { ok: false, reason: 'invalid-id', agentId: 'a/b' })
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('name: renames the branch to agent-<name> from anywhere in the checkout, and the branches/ link follows', async () => {
  const repo = await repoWithOrigin()
  try {
    await run(repo, 'create', 'a1')
    const path = worktreePath(repo, 'a1')
    await mkdir(join(path, 'src'), { recursive: true })
    const named = await run(join(path, 'src'), 'name', 'add-auth')
    assert.equal(named.code, 0)
    assert.deepEqual(named.out, { ok: true, branch: 'agent-add-auth' })
    assert.equal((await git(['rev-parse', '--abbrev-ref', 'HEAD'], path)).trim(), 'agent-add-auth')
    await assert.rejects(() => git(['rev-parse', '--verify', 'refs/heads/agent-a1'], repo), 'a rename, not a second branch')
    assert.equal(await readlink(join(repo, '.branches', 'agent-add-auth')), 'agent-a1', 'the link carries the new name')
    assert.equal((await stat(path)).isDirectory(), true, 'the checkout directory did not move')

    // The same name again is a no-op; naming again with another name renames again.
    assert.deepEqual((await run(path, 'name', 'add-auth')).out, { ok: true, branch: 'agent-add-auth' })
    assert.deepEqual((await run(path, 'name', 'add-oauth')).out, { ok: true, branch: 'agent-add-oauth' })
    assert.equal(await isSymlink(join(repo, '.branches', 'agent-add-auth')), false, 'the old link is dropped')
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('name: a taken name — local or on the remote — gets a numeric suffix, and the caller reads it back', async () => {
  const repo = await repoWithOrigin()
  try {
    await run(repo, 'create', 'a1')
    await run(repo, 'create', 'a2')
    await run(repo, 'create', 'a3')
    assert.deepEqual((await run(worktreePath(repo, 'a1'), 'name', 'fix-login')).out, { ok: true, branch: 'agent-fix-login' })
    assert.deepEqual((await run(worktreePath(repo, 'a2'), 'name', 'fix-login')).out, { ok: true, branch: 'agent-fix-login-2' })
    // A branch only the remote has counts as taken too: the push would otherwise land on it.
    await git(['push', '-q', 'origin', 'HEAD:refs/heads/agent-remote-only'], repo)
    await git(['fetch', '-q', 'origin'], repo)
    assert.deepEqual((await run(worktreePath(repo, 'a3'), 'name', 'remote-only')).out, { ok: true, branch: 'agent-remote-only-2' })
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('name: refuses a name that is not a session name, and a branch the package did not mint', async () => {
  const repo = await repoWithOrigin()
  try {
    await run(repo, 'create', 'a1')
    const path = worktreePath(repo, 'a1')
    const invalid = await run(path, 'name', 'Add_Auth')
    assert.equal(invalid.code, 1)
    assert.deepEqual(invalid.out, { ok: false, reason: 'invalid-name' })
    assert.match(invalid.err, /\[a-z0-9-\]\+/)
    assert.equal((await git(['rev-parse', '--abbrev-ref', 'HEAD'], path)).trim(), 'agent-a1', 'the branch is untouched')

    const main = await run(repo, 'name', 'my-branch')
    assert.equal(main.code, 1)
    assert.deepEqual(main.out, { ok: false, reason: 'not-an-agent-branch' })
    assert.equal((await git(['rev-parse', '--abbrev-ref', 'HEAD'], repo)).trim(), 'main', "the user's own branch keeps its name")
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('status: the branch, whether the tree is clean, whether the tip is on the remote', async () => {
  const repo = await repoWithOrigin()
  try {
    await run(repo, 'create', 'a1')
    const path = worktreePath(repo, 'a1')
    await writeFile(join(path, 'index.html'), '<h1>Edited</h1>\n')
    assert.deepEqual((await run(path, 'status')).out, { ok: true, path, branch: 'agent-a1', clean: false, onRemote: false })
    await commitWork(path)
    assert.deepEqual((await run(path, 'status')).out, { ok: true, path, branch: 'agent-a1', clean: true, onRemote: false })
    await git(['push', '-q', '--set-upstream', 'origin', 'agent-a1'], path)
    // With a path, from anywhere.
    assert.deepEqual((await run(repo, 'status', path)).out, { ok: true, path, branch: 'agent-a1', clean: true, onRemote: true })
    assert.deepEqual((await run(repo, 'status', join('.branches', 'agent-a1'))).out, { ok: true, path, branch: 'agent-a1', clean: true, onRemote: true })

    const leftover = join(repo, '.branches', 'agent-gone')
    await mkdir(leftover, { recursive: true })
    const refused = await run(repo, 'status', leftover)
    assert.equal(refused.code, 1)
    assert.deepEqual(refused.out, { ok: false, reason: 'not-a-worktree', path: leftover })
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('list: every checkout with the branch it is on now, sized on request', async () => {
  const repo = await repoWithOrigin()
  try {
    assert.deepEqual((await run(repo, 'list')).out, [])
    await run(repo, 'create', 'a1')
    await run(repo, 'create', 'a2')
    await run(worktreePath(repo, 'a2'), 'name', 'renamed')
    const rows = (await run(repo, 'list')).out as { agentId: string; path: string; branch?: string; name?: string; sizeBytes?: number }[]
    // The name is the branch minus the prefix, and only once the agent named its work: a1 is still on its birth branch.
    assert.deepEqual(rows, [
      { agentId: 'a1', path: worktreePath(repo, 'a1'), branch: 'agent-a1' },
      { agentId: 'a2', path: worktreePath(repo, 'a2'), branch: 'agent-renamed', name: 'renamed' },
    ])
    const sized = (await run(repo, 'list', '--sizes')).out as { sizeBytes?: number }[]
    assert.equal(sized.length, 2)
    for (const row of sized) assert.equal(typeof row.sizeBytes, 'number')
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('remove: a dirty checkout is kept and says so; a committed one is reclaimed, its branch kept and not pushed', async () => {
  const repo = await repoWithOrigin()
  try {
    await run(repo, 'create', 'a1')
    const path = worktreePath(repo, 'a1')
    await run(path, 'name', 'add-auth')
    await writeFile(join(path, 'index.html'), '<h1>Edited</h1>\n')
    const kept = await run(repo, 'remove', 'a1')
    assert.equal(kept.code, 1)
    assert.deepEqual(kept.out, { ok: false, reason: 'dirty', branch: 'agent-add-auth' })
    assert.match(kept.err, /agent-add-auth has uncommitted work/)
    assert.equal((await stat(path)).isDirectory(), true)

    await commitWork(path)
    const removed = await run(repo, 'remove', 'a1')
    assert.equal(removed.code, 0)
    assert.deepEqual(removed.out, { ok: true })
    await assert.rejects(() => stat(path), 'the checkout is gone')
    assert.match(await git(['show', 'agent-add-auth:index.html'], repo), /Welcome/, 'the work stays on its branch')
    await assert.rejects(() => git(['rev-parse', '--verify', 'refs/remotes/origin/agent-add-auth'], repo), 'and nothing reached the remote')
    assert.equal(await isSymlink(join(repo, '.branches', 'agent-add-auth')), false, 'its link went with it')
    assert.deepEqual((await run(repo, 'remove', 'a1')).out, { ok: false, reason: 'no-checkout', agentId: 'a1' })
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('remove --from: a checkout with no commit past the commit its branch started from goes, its branch with it, unpushed', async () => {
  const repo = await repoWithOrigin()
  try {
    await run(repo, 'create', 'a1')
    await commitWork(worktreePath(repo, 'a1'))
    await git(['push', '-q', 'origin', 'agent-a1'], repo)
    await run(repo, 'create', 'a2', '--base', 'agent-a1')
    const from = (await git(['rev-parse', 'agent-a1'], repo)).trim()
    assert.deepEqual((await run(repo, 'remove', 'a2', '--from', from)).out, { ok: true, branchesDeleted: ['agent-a2'] })
    await assert.rejects(() => git(['rev-parse', '--verify', 'refs/remotes/origin/agent-a2'], repo), 'nothing reached the remote')
    const usage = await run(repo, 'remove', 'a1', '--from', ' ')
    assert.equal(usage.code, 2)
    assert.match(usage.err, /--from names a commit/)
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('attach: a continued agent is put back on the branch its work is on', async () => {
  const repo = await repoWithOrigin()
  try {
    await run(repo, 'create', 'a1')
    const path = worktreePath(repo, 'a1')
    await run(path, 'name', 'add-auth')
    await commitWork(path)
    await run(repo, 'remove', 'a1')
    const attached = await run(repo, 'attach', 'a1', 'agent-add-auth')
    assert.equal(attached.code, 0)
    assert.deepEqual(attached.out, { ok: true, path, branch: 'agent-add-auth' })
    assert.match(await git(['show', 'HEAD:index.html'], path), /Welcome/, 'with its previous commit')
    assert.equal(await isSymlink(join(path, 'node_modules', 'dep')), true)
    assert.equal(await readlink(join(repo, '.branches', 'agent-add-auth')), 'agent-a1')

    // A branch that is gone starts again from the base named.
    const based = await run(repo, 'attach', 'a2', 'agent-gone', '--base', 'agent-add-auth')
    assert.deepEqual(based.out, { ok: true, path: worktreePath(repo, 'a2'), branch: 'agent-gone', again: true }, 'and says the branch was made again')
    assert.match(await git(['show', 'HEAD:index.html'], worktreePath(repo, 'a2')), /Welcome/, 'on the base, with its commit')
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('prune: removes what the rule allows and reports each checkout it kept, with the reason', async () => {
  const repo = await repoWithOrigin()
  try {
    await run(repo, 'create', 'clean')
    await run(repo, 'create', 'dirty')
    await commitWork(worktreePath(repo, 'clean'))
    await writeFile(join(worktreePath(repo, 'dirty'), 'index.html'), '<h1>Edited</h1>\n')
    const pruned = await run(repo, 'prune')
    assert.equal(pruned.code, 0)
    assert.deepEqual(pruned.out, {
      ok: true,
      removed: ['clean'],
      skipped: [{ agentId: 'dirty', reason: 'dirty', detail: 'agent-dirty has uncommitted work; the checkout was kept' }],
    })
    await assert.rejects(() => stat(worktreePath(repo, 'clean')))
    assert.equal((await stat(worktreePath(repo, 'dirty'))).isDirectory(), true)
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('outside a repository every command refuses rather than failing on git', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'branches-norepo-')))
  try {
    for (const argv of [['list'], ['create', 'a1'], ['name', 'x'], ['status'], ['remove', 'a1'], ['prune'], ['cleanup']]) {
      const ran = await run(dir, ...argv)
      assert.equal(ran.code, 1, argv.join(' '))
      assert.deepEqual(ran.out, { ok: false, reason: 'not-a-repo' }, argv.join(' '))
      assert.equal(ran.err, 'not inside a git repository')
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a command that cannot be read gets the usage and exit code 2, and no JSON', async () => {
  const repo = await repoWithOrigin()
  try {
    for (const argv of [[], ['bogus'], ['name'], ['create'], ['attach', 'a1'], ['status', 'a', 'b'], ['list', '--nope']]) {
      const ran = await run(repo, ...argv)
      assert.equal(ran.code, 2, argv.join(' '))
      assert.equal(ran.out, undefined, argv.join(' '))
      assert.match(ran.err, /usage: branches/)
    }
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('a git failure past the decision is exit 1 with git\'s own line', async () => {
  const repo = await repoWithOrigin()
  try {
    const ran = await run(repo, 'attach', 'a1', 'main')
    assert.equal(ran.code, 1)
    assert.deepEqual(ran.out, { ok: false, reason: 'git-failed', detail: ran.err })
    assert.match(ran.err, /fatal: 'main' is already (checked out|used by worktree)/)
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

/** The executable, as an agent finds it: by name, on a PATH that starts with {@link CLI_BIN_DIR}. */
function exec(cwd: string, ...argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise(resolvePromise => {
    execFile(
      'branches',
      argv,
      { cwd, env: { ...process.env, PATH: `${CLI_BIN_DIR}:${process.env['PATH'] ?? ''}` } },
      (err, stdout, stderr) => resolvePromise({ code: (err as { code?: number } | null)?.code ?? 0, stdout, stderr }),
    )
  })
}

test('the executable runs by name from CLI_BIN_DIR: JSON on stdout, the reason on stderr, the exit code', async () => {
  const repo = await repoWithOrigin()
  try {
    const created = await exec(repo, 'create', 'a1')
    assert.equal(created.code, 0, created.stderr)
    assert.deepEqual(JSON.parse(created.stdout), { ok: true, path: worktreePath(repo, 'a1'), branch: 'agent-a1' })
    await writeFile(join(worktreePath(repo, 'a1'), 'index.html'), '<h1>Edited</h1>\n')
    const kept = await exec(worktreePath(repo, 'a1'), 'remove', 'a1')
    assert.equal(kept.code, 1)
    assert.deepEqual(JSON.parse(kept.stdout), { ok: false, reason: 'dirty', branch: 'agent-a1' })
    assert.equal(kept.stderr.trim(), 'agent-a1 has uncommitted work; the checkout was kept')
    assert.equal((await exec(repo)).code, 2)
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('name: asking again for the name the checkout already carries, suffixed or not, changes nothing (review)', async () => {
  const repo = await repoWithOrigin()
  try {
    await run(repo, 'create', 'a1')
    await run(repo, 'create', 'a2')
    assert.deepEqual((await run(worktreePath(repo, 'a1'), 'name', 'fix-login')).out, { ok: true, branch: 'agent-fix-login' })
    assert.deepEqual((await run(worktreePath(repo, 'a2'), 'name', 'fix-login')).out, { ok: true, branch: 'agent-fix-login-2' })
    assert.deepEqual((await run(worktreePath(repo, 'a2'), 'name', 'fix-login')).out, { ok: true, branch: 'agent-fix-login-2' }, 'no drift to -3')
    // Its own pushed copy does not count as taken either.
    await git(['push', '-q', '--set-upstream', 'origin', 'agent-fix-login-2'], worktreePath(repo, 'a2'))
    await git(['fetch', '-q', 'origin'], repo)
    assert.deepEqual((await run(worktreePath(repo, 'a2'), 'name', 'fix-login')).out, { ok: true, branch: 'agent-fix-login-2' })
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('name: a name spelled like a checkout directory is a name like any other; its link is never listed as a checkout', async () => {
  const repo = await repoWithOrigin()
  try {
    await run(repo, 'create', 'a1')
    const path = worktreePath(repo, 'a1')
    assert.deepEqual((await run(path, 'name', 'agent-zz')).out, { ok: true, branch: 'agent-agent-zz' })
    assert.equal((await git(['rev-parse', '--abbrev-ref', 'HEAD'], path)).trim(), 'agent-agent-zz')
    assert.equal(await readlink(join(repo, '.branches', 'agent-agent-zz')), 'agent-a1')
    assert.deepEqual((await run(repo, 'list')).out, [{ agentId: 'a1', path, branch: 'agent-agent-zz', name: 'agent-zz' }], 'the link beside the checkout is not a checkout')
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('the project is the checkout whose branches/ the command runs under — a project that is itself a linked worktree included (review)', async () => {
  const repo = await repoWithOrigin()
  try {
    const project = join(repo, 'project-wt')
    await git(['worktree', 'add', '-q', '-b', 'project-branch', project], repo)
    await mkdir(join(project, 'node_modules', 'dep'), { recursive: true })
    const created = await run(project, 'create', 'a1')
    assert.equal(created.code, 0)
    assert.equal((created.out as { path: string }).path, worktreePath(project, 'a1'), 'under the registered project, not the main checkout')
    assert.deepEqual(((await run(worktreePath(project, 'a1'), 'list')).out as { agentId: string }[]).map(r => r.agentId), ['a1'])
    assert.deepEqual((await run(repo, 'list')).out, [], 'the main checkout has none')
    assert.deepEqual((await run(worktreePath(project, 'a1'), 'name', 'nested')).out, { ok: true, branch: 'agent-nested' })
    assert.equal(await readlink(join(project, '.branches', 'agent-nested')), 'agent-a1')
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('an id that is not path-safe is refused before the project is even looked for (review)', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'branches-norepo-')))
  try {
    assert.deepEqual((await run(dir, 'remove', '../x')).out, { ok: false, reason: 'invalid-id', agentId: '../x' })
    assert.deepEqual((await run(dir, 'create', '../x')).out, { ok: false, reason: 'invalid-id', agentId: '../x' })
    // `status <path>` names a directory, and answers about that directory: not a checkout.
    assert.deepEqual((await run(dir, 'status', dir)).out, { ok: false, reason: 'not-a-worktree', path: dir })
    assert.deepEqual((await run(dir, 'attach', 'a1', 'main')).out, { ok: false, reason: 'not-a-repo' })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a command named like an Object property is not a command (review)', async () => {
  const repo = await repoWithOrigin()
  try {
    for (const argv of [['constructor'], ['toString'], ['hasOwnProperty']]) {
      const ran = await run(repo, ...argv)
      assert.equal(ran.code, 2, argv.join(' '))
      assert.equal(ran.out, undefined)
    }
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test("remove <name>: a link's name reaches the checkout, and the birth branch is the checkout's own, not the name (#1757)", async () => {
  const repo = await repoWithOrigin()
  try {
    await run(repo, 'create', 'a1')
    const path = worktreePath(repo, 'a1')
    // The agent branches away itself, so the birth branch stays behind; the reconcile links the new name.
    await git(['checkout', '-q', '-b', 'agent-cool-name'], path)
    await commitWork(path)
    await reconcileBranchLinks(repo)
    assert.equal(await readlink(join(repo, '.branches', 'agent-cool-name')), 'agent-a1')
    const removed = await run(repo, 'remove', 'cool-name')
    assert.equal(removed.code, 0)
    assert.deepEqual(removed.out, { ok: true, branchesDeleted: ['agent-a1'] }, 'the birth branch is the directory\'s, not the argument\'s')
    await assert.rejects(() => stat(path), 'the checkout is gone')
    assert.equal(await isSymlink(join(repo, '.branches', 'agent-cool-name')), false, 'and its link')
    assert.match(await git(['rev-parse', '--verify', 'refs/heads/agent-cool-name'], repo), /^[0-9a-f]{40}/, 'the work branch stays')
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('remove --discard: a dirty checkout goes whatever it holds, nothing is pushed, and the branch stays', async () => {
  const repo = await repoWithOrigin()
  try {
    await run(repo, 'create', 'd1')
    const path = worktreePath(repo, 'd1')
    await commitWork(path)
    await writeFile(join(path, 'draft.txt'), 'uncommitted\n')
    const kept = await run(repo, 'remove', 'd1')
    assert.equal(kept.code, 1, 'the reclaim rule keeps it')
    const gone = await run(repo, 'remove', 'd1', '--discard')
    assert.equal(gone.code, 0, gone.err)
    assert.deepEqual(gone.out, { ok: true })
    assert.equal(await stat(path).then(() => true, () => false), false, 'the checkout is gone')
    assert.equal((await git(['rev-parse', '--verify', 'refs/heads/agent-d1'], repo)).trim().length, 40, 'the branch and its commit stay')
    assert.equal(await git(['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/agent-d1'], repo).then(() => true, () => false), false, 'nothing was pushed')
    const missing = await run(repo, 'remove', 'd1', '--discard')
    assert.deepEqual(missing.out, { ok: false, reason: 'no-checkout', agentId: 'd1' })
    assert.equal(missing.code, 1)
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})
