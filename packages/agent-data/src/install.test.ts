import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { FIRST_COMMIT_MESSAGE, installProject } from './install.js'
import { openagentGitignore, gitignorePath } from './openagent-gitignore.js'
import type { GitRunner } from './git.js'
import type { InstallFs } from './install.js'

/** An in-memory {@link InstallFs} so the install logic is tested without touching disk. */
function memFs(seed: Record<string, string> = {}): InstallFs & { files: Map<string, string> } {
  const files = new Map<string, string>(Object.entries(seed))
  return {
    files,
    async write(path, contents) {
      files.set(path, contents)
    },
    async exists(path) {
      return files.has(path)
    },
    async mkdir() {
      // no-op: the memory fs has no directories
    },
  }
}

/** A scriptable {@link GitRunner} that records every call's args. */
function fakeGit(script: (args: string[], cwd: string) => Promise<string> | string) {
  const calls: string[][] = []
  const git: GitRunner = async (args, cwd) => {
    calls.push(args)
    return script(args, cwd)
  }
  return { git, calls }
}

const CWD = '/proj'

/** A git that answers as a repository with commits does: inside a work tree, HEAD resolves. */
const inRepoWithCommits = (args: string[]): string => (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree' ? 'true' : '')

test('installProject on a repo with commits seeds the ignore file and commits nothing', async () => {
  const fs = memFs()
  const { git, calls } = fakeGit(inRepoWithCommits)

  assert.deepEqual(await installProject(CWD, { git, fs }), { ok: true })
  assert.equal(fs.files.get(gitignorePath(CWD)), openagentGitignore())

  assert.deepEqual(
    calls.map(args => args[0]),
    ['rev-parse', 'rev-parse'],
    'two questions and nothing else: no add, no commit, the branch is the person’s',
  )
})

test('installProject seeds .openagent/.gitignore ignoring everything, itself included (#313/#1582)', async () => {
  const fs = memFs()
  const { git } = fakeGit(inRepoWithCommits)

  await installProject(CWD, { git, fs })
  const ignore = fs.files.get(gitignorePath(CWD)) ?? ''
  // Everything under .openagent/ stays out of git: the lasting records live on the data branch
  // (#1582), and nothing is un-ignored, so the directory leaves no trace in the repository.
  const rules = ignore.split('\n').filter(line => line && !line.startsWith('#'))
  assert.deepEqual(rules, ['*'])
})

/** A real repository in a temporary folder, removed after `body`. */
async function withRealRepo(body: (repo: string, git: (...args: string[]) => string) => Promise<void>): Promise<void> {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { execFileSync } = await import('node:child_process')
  const repo = await mkdtemp(join(tmpdir(), 'oa-install-'))
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: repo, encoding: 'utf8' })
  try {
    git('init', '-q')
    git('config', 'user.email', 'git@example.com')
    git('config', 'user.name', 'Test')
    await body(repo, git)
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
}

test('against real git: adding a project leaves the person’s repository as it was, their uncommitted and staged work included (#1638)', async () => {
  const { writeFile, readFile } = await import('node:fs/promises')
  const { join } = await import('node:path')
  await withRealRepo(async (repo, git) => {
    await writeFile(join(repo, 'file.ts'), 'one\n')
    git('add', 'file.ts')
    git('commit', '-q', '-m', 'theirs')
    await writeFile(join(repo, 'file.ts'), 'two\n')
    await writeFile(join(repo, 'staged.ts'), 'new\n')
    git('add', 'staged.ts')
    const before = { log: git('log', '--format=%H %s'), status: git('status', '--porcelain', '-uall') }

    assert.deepEqual(await installProject(repo), { ok: true })

    assert.equal(await readFile(gitignorePath(repo), 'utf8'), openagentGitignore(), 'the ignore file is written')
    assert.equal(git('log', '--format=%H %s'), before.log, 'no commit on the person’s branch')
    assert.equal(git('status', '--porcelain', '-uall'), before.status, 'git shows no new file, and their changes are as they left them')
    assert.deepEqual(await installProject(repo), { ok: true, alreadyActivated: true })
  })
})

test('against real git: a repository with no commit gets an empty first one, and a file the person staged stays staged, uncommitted', async () => {
  const { writeFile } = await import('node:fs/promises')
  const { join } = await import('node:path')
  await withRealRepo(async (repo, git) => {
    await writeFile(join(repo, 'staged.ts'), 'new\n')
    await writeFile(join(repo, 'loose.ts'), 'new\n')
    git('add', 'staged.ts')

    assert.deepEqual(await installProject(repo), { ok: true })

    assert.equal(git('log', '--format=%s').trim(), FIRST_COMMIT_MESSAGE)
    assert.equal(git('ls-tree', '-r', '--name-only', 'HEAD'), '', 'the commit holds no file')
    assert.equal(git('status', '--porcelain', '-uall'), 'A  staged.ts\n?? loose.ts\n', 'their files are where they left them')
    // An agent's branch can start now.
    git('branch', 'agent-x')
  })
})

/** `body` on a git that reads no name or email of this machine's: no global or system config, none of git's identity variables. */
async function withoutMachineIdentity(body: () => Promise<void>): Promise<void> {
  const saved = { ...process.env }
  try {
    process.env.GIT_CONFIG_GLOBAL = '/dev/null'
    process.env.GIT_CONFIG_NOSYSTEM = '1'
    for (const key of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'EMAIL']) delete process.env[key]
    await body()
  } finally {
    // In place: git inherits the environment `process.env` was made from, not an object put in its place.
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
    Object.assign(process.env, saved)
  }
}

test('against real git: a repository with no commit, on a git never given a name or email, gets its first commit as OpenAgent', async () => {
  await withoutMachineIdentity(async () => {
    // Nor a guess from the user and host names, which git makes on a host whose name has a domain.
    Object.assign(process.env, { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'user.useConfigOnly', GIT_CONFIG_VALUE_0: 'true' })
    await withRealRepo(async (repo, git) => {
      git('config', '--unset', 'user.name')
      git('config', '--unset', 'user.email')

      assert.deepEqual(await installProject(repo), { ok: true })

      assert.equal(git('log', '--format=%an <%ae>|%s').trim(), `OpenAgent <openagent@localhost>|${FIRST_COMMIT_MESSAGE}`)
      assert.doesNotMatch(git('config', '--local', '--list'), /^user\./m, 'the person’s git config is left as it was')
    })
  })
})

test('against real git: a git with a name, and an email from the EMAIL variable, makes the first commit with them', async () => {
  await withoutMachineIdentity(async () => {
    process.env.EMAIL = 'mail@example.com'
    await withRealRepo(async (repo, git) => {
      git('config', '--unset', 'user.email')

      assert.deepEqual(await installProject(repo), { ok: true })

      assert.equal(git('log', '--format=%an <%ae>|%cn <%ce>').trim(), 'Test <mail@example.com>|Test <mail@example.com>')
    })
  })
})

test('against real git: a git with a name and an email makes the first commit with them', async () => {
  await withRealRepo(async (repo, git) => {
    assert.deepEqual(await installProject(repo), { ok: true })
    assert.equal(git('log', '--format=%an <%ae>').trim(), 'Test <git@example.com>')
  })
})

test('installProject on an already-activated repo is a no-op that never calls git', async () => {
  const fs = memFs({ [gitignorePath(CWD)]: openagentGitignore() })
  const { git, calls } = fakeGit(() => '')

  assert.deepEqual(await installProject(CWD, { git, fs }), { ok: true, alreadyActivated: true })
  assert.deepEqual(calls, [])
})

test('installProject surfaces a git failure as { ok: false }, never throws, and a first commit that fails leaves no marker, so the next add tries again', async () => {
  const fs = memFs()
  const { git } = fakeGit(args => {
    if (args[0] === 'rev-parse') throw new Error('no')
    if (args.includes('commit-tree')) throw new Error('fatal: unable to write commit')
    return ''
  })

  assert.deepEqual(await installProject(CWD, { git, fs }), { ok: false, error: 'fatal: unable to write commit' })
  assert.equal(fs.files.has(gitignorePath(CWD)), false)
})

test('installProject initializes a git repo when the folder is not one yet, and gives it an empty first commit for agents to start from', async () => {
  const fs = memFs()
  // Both rev-parse questions fail on a non-repo folder; git names an author and a committer; every other git call succeeds.
  const { git, calls } = fakeGit(args => {
    if (args[0] === 'rev-parse') throw new Error('not a git repository')
    if (args[0] === 'var') return 'Test <git@example.com> 1700000000 +0000\n'
    return args[0] === 'commit-tree' ? 'abc123\n' : ''
  })

  assert.deepEqual(await installProject(CWD, { git, fs }), { ok: true, initialized: true })
  assert.deepEqual(
    calls.filter(args => args[0] !== 'rev-parse' && args[0] !== 'var'),
    [['init'], ['commit-tree', '4b825dc642cb6eb9a060e54bf8d69288fbee4904', '-m', FIRST_COMMIT_MESSAGE], ['update-ref', 'HEAD', 'abc123']],
    'the commit is made from the empty tree, never from the index: nothing of the person’s is in it',
  )
})
