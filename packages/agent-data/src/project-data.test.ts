import { strict as assert } from 'node:assert'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { nodeGitRunner, type GitRunner } from './git.js'
import { readSharing, writeSharing } from './file-branch.js'
import {
  listProjectDir,
  openProjectReader,
  personalFolder,
  projectDataPlace,
  projectKey,
  pullProjectData,
  readProjectFile,
  removePersonalData,
  shareProjectData,
  withProjectData,
  writeProjectDataDetached,
} from './project-data.js'

const real = nodeGitRunner()
/** git, with origin's address read as a host would have it, so the project is named the way a real clone is. */
const git: GitRunner = async (args, cwd) => (args.join(' ') === 'remote get-url origin' && (await real(['remote'], cwd)).includes('origin') ? 'https://example.com/acme/shop.git\n' : real(args, cwd))
const RETRIED_RM = { recursive: true, force: true, maxRetries: 10 } as const
const there = (path: string): Promise<boolean> => stat(path).then(() => true, () => false)

/** A project with a bare origin under a made-up address, and a personal folder of its own: nothing touches the real home. */
async function setup(opts: { remote?: boolean } = {}): Promise<{ repo: string; bare: string; folder: string; cleanup: () => Promise<void> }> {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'project-data-')))
  const repo = join(base, 'repo')
  const bare = join(base, 'origin.git')
  const folder = join(base, 'personal')
  await mkdir(repo)
  await git(['init', '-q', '-b', 'main'], repo)
  await git(['config', 'user.email', 't@t'], repo)
  await git(['config', 'user.name', 't'], repo)
  await writeFile(join(repo, 'README.md'), '# t\n')
  await git(['add', '-A'], repo)
  await git(['commit', '-q', '-m', 'init'], repo)
  if (opts.remote !== false) {
    await git(['init', '-q', '--bare', bare], base)
    await git(['remote', 'add', 'origin', bare], repo)
    await git(['push', '-q', 'origin', 'main'], repo)
  }
  return { repo, bare, folder, cleanup: () => rm(base, RETRIED_RM) }
}

const writeNote = (text: string) => async (dir: string) => {
  await mkdir(join(dir, 'notes'), { recursive: true })
  await writeFile(join(dir, 'notes', 'a.md'), text)
}

test('the personal folder sits beside the registry: under XDG_CONFIG_HOME when set, else ~/.openagent', () => {
  assert.equal(personalFolder({ XDG_CONFIG_HOME: '/x/config', HOME: '/home/me' }), '/x/config/openagent')
  assert.equal(personalFolder({ HOME: '/home/me' }), '/home/me/.openagent')
})

test('a project is named by its repository address, or by its folder when it has none', async () => {
  const { repo, cleanup } = await setup()
  const { repo: local, cleanup: cleanupLocal } = await setup({ remote: false })
  try {
    assert.equal(await projectKey(repo, git), 'example.com/acme/shop')
    assert.equal(await projectKey(local, git), ['local', ...local.split('/').filter(Boolean)].join('/'))
    assert.equal(await projectKey('/x', async () => 'git@host:../../etc\n'), 'host/etc')
  } finally {
    await cleanup()
    await cleanupLocal()
  }
})

test('a project kept on this machine writes to the personal folder, one commit per write, and nothing goes into its repository', async () => {
  const { repo, folder, cleanup } = await setup()
  try {
    const written = await withProjectData(repo, 'a note', writeNote('hi\n'), { folder, git })
    assert.deepEqual(written, { ok: true, changed: true, pushed: false })
    const dir = join(folder, 'projects', 'example.com', 'acme', 'shop')
    assert.equal(await readFile(join(dir, 'notes', 'a.md'), 'utf8'), 'hi\n')
    assert.deepEqual((await git(['log', '--format=%s'], folder)).trim().split('\n'), ['a note', 'create the personal folder'])
    assert.equal((await git(['status', '--porcelain'], folder)).trim(), '', 'the lock file is hidden from git')
    // The project's repository: no data branch, no checkouts directory, nothing untracked.
    assert.equal((await git(['branch', '--list', 'agent-data'], repo)).trim(), '')
    assert.equal(await there(join(repo, '.branches')), false)
    assert.equal((await git(['status', '--porcelain'], repo)).trim(), '')
    // The same write again changes nothing and commits nothing.
    assert.deepEqual(await withProjectData(repo, 'again', writeNote('hi\n'), { folder, git }), { ok: true, changed: false, pushed: false })
  } finally {
    await cleanup()
  }
})

test('a write that fails leaves no half-written file in the personal folder', async () => {
  const { repo, folder, cleanup } = await setup()
  try {
    const failed = await withProjectData(
      repo,
      'broken',
      async dir => {
        await writeNote('half\n')(dir)
        throw new Error('the op broke')
      },
      { folder, git },
    )
    assert.deepEqual(failed, { ok: false, committed: false, error: 'the op broke' })
    assert.equal(await there(join(folder, 'projects')), false)
  } finally {
    await cleanup()
  }
})

test('a machine whose git has no name or email still writes: the folder gets one of its own', async () => {
  const { repo, folder, cleanup } = await setup()
  const saved = { ...process.env }
  try {
    process.env.GIT_CONFIG_GLOBAL = '/dev/null'
    process.env.GIT_CONFIG_NOSYSTEM = '1'
    for (const key of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'EMAIL']) delete process.env[key]
    const written = await withProjectData(repo, 'a note', writeNote('hi\n'), { folder, git })
    assert.equal(written.ok, true)
    assert.equal((await git(['log', '-1', '--format=%an <%ae>'], folder)).trim(), 'OpenAgent <openagent@localhost>')
  } finally {
    process.env = saved
    await cleanup()
  }
})

test("an agent's command reads and writes the personal folder from the project's worktree", async () => {
  const { repo, folder, cleanup } = await setup()
  const worktree = join(repo, '..', 'wt')
  try {
    await git(['worktree', 'add', '-q', '-b', 'agent-1', worktree], repo)
    assert.deepEqual(await writeProjectDataDetached(worktree, 'from the agent', writeNote('agent\n'), { folder, git }), { changed: true })
    assert.equal(await readProjectFile(repo, 'notes/a.md', {}, { folder, git }), 'agent\n')
    assert.deepEqual(await listProjectDir(worktree, 'notes', {}, { folder, git }), ['a.md'])
    assert.deepEqual(await listProjectDir(worktree, 'none', {}, { folder, git }), [])
    const reader = await openProjectReader(worktree, { folder, git })
    assert.equal(await reader.read('notes/a.md'), 'agent\n')
    assert.equal(await reader.read('notes/b.md'), undefined)
    assert.deepEqual(await reader.list('notes'), ['a.md'])
  } finally {
    await cleanup()
  }
})

test('concurrent writes to the personal folder take turns: every one lands', async () => {
  const { repo, folder, cleanup } = await setup()
  try {
    const writes = Array.from({ length: 6 }, (_, i) =>
      withProjectData(repo, `note ${i}`, async dir => {
        await mkdir(dir, { recursive: true })
        await writeFile(join(dir, `${i}.md`), `${i}\n`)
      }, { folder, git }),
    )
    for (const written of await Promise.all(writes)) assert.equal(written.ok, true)
    assert.equal((await readdir(join(folder, 'projects', 'example.com', 'acme', 'shop'))).length, 6)
    assert.equal((await git(['rev-list', '--count', 'HEAD'], folder)).trim(), '7')
  } finally {
    await cleanup()
  }
})

test('the pull makes the personal folder on its first turn and says the records stay here', async () => {
  const { repo, folder, cleanup } = await setup()
  try {
    assert.deepEqual(await pullProjectData(repo, { folder, git }), { ok: true, reach: 'kept' })
    assert.equal(await there(join(folder, '.git')), true)
  } finally {
    await cleanup()
  }
})

test('a shared project writes to its own branch, pushed, and leaves the personal folder alone', async () => {
  const { repo, bare, folder, cleanup } = await setup()
  try {
    await writeSharing(repo, true, git)
    const place = await projectDataPlace(repo, { folder, git })
    assert.equal(place.kind, 'branch')
    assert.deepEqual(await withProjectData(repo, 'a note', writeNote('shared\n'), { folder, git }), { ok: true, changed: true, pushed: true })
    assert.equal((await git(['show', 'agent-data:notes/a.md'], bare)).trim(), 'shared')
    assert.equal(await there(folder), false)
  } finally {
    await cleanup()
  }
})

test('the share switch moves the records: on, to the branch and its remote; off, back to the personal folder, the remote keeping its copy', async () => {
  const { repo, bare, folder, cleanup } = await setup()
  const personal = join(folder, 'projects', 'example.com', 'acme', 'shop')
  try {
    await withProjectData(repo, 'a note', writeNote('kept\n'), { folder, git })
    assert.deepEqual(await shareProjectData(repo, true, { folder, git }), { ok: true })
    assert.equal(await readSharing(repo, git), true)
    assert.equal((await git(['show', 'agent-data:notes/a.md'], bare)).trim(), 'kept')
    assert.equal(await there(personal), false, 'never in two places')
    assert.equal(await readProjectFile(repo, 'notes/a.md', {}, { folder, git }), 'kept\n')

    await withProjectData(repo, 'another', async dir => writeFile(join(dir, 'notes', 'b.md'), 'b\n'), { folder, git })
    assert.deepEqual(await shareProjectData(repo, false, { folder, git }), { ok: true })
    assert.equal(await readSharing(repo, git), false)
    assert.equal(await readFile(join(personal, 'notes', 'a.md'), 'utf8'), 'kept\n')
    assert.equal(await readFile(join(personal, 'notes', 'b.md'), 'utf8'), 'b\n')
    assert.deepEqual(await readdir(join(repo, '.branches', 'agent-data')), ['.git'])
    assert.equal((await git(['show', 'agent-data:notes/b.md'], bare)).trim(), 'b', 'nothing pushed on the way off')

    // On again: the records go back, the remote's copy and the move both kept.
    assert.deepEqual(await shareProjectData(repo, true, { folder, git }), { ok: true })
    assert.equal((await git(['show', 'agent-data:notes/b.md'], bare)).trim(), 'b')
    assert.equal(await there(personal), false)
  } finally {
    await cleanup()
  }
})

test('a remote that refuses the records: the switch goes back to off and the records stay in the personal folder', async () => {
  const { repo, bare, folder, cleanup } = await setup()
  try {
    await withProjectData(repo, 'a note', writeNote('kept\n'), { folder, git })
    await rm(bare, RETRIED_RM)
    const shared = await shareProjectData(repo, true, { folder, git })
    assert.equal(shared.ok, false)
    assert.equal(await readSharing(repo, git), false)
    assert.equal(await readProjectFile(repo, 'notes/a.md', {}, { folder, git }), 'kept\n')
  } finally {
    await cleanup()
  }
})

test("removing the project's records takes its directory out of the personal folder as one commit", async () => {
  const { repo, folder, cleanup } = await setup()
  try {
    assert.deepEqual(await removePersonalData(repo, { folder, git }), { ok: true })
    await withProjectData(repo, 'a note', writeNote('kept\n'), { folder, git })
    const dir = join(folder, 'projects', 'example.com', 'acme', 'shop')
    assert.deepEqual(await removePersonalData(repo, { folder, git }), { ok: true, removed: dir })
    assert.equal(await there(dir), false)
    assert.equal((await git(['log', '-1', '--format=%s'], folder)).trim(), 'remove projects/example.com/acme/shop')
  } finally {
    await cleanup()
  }
})
