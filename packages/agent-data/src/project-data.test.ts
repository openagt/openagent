import { strict as assert } from 'node:assert'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { nodeGitRunner, type GitRunner } from './git.js'
import { readSharing, writeSharing } from './file-branch.js'
import { clearRemoteAccount, readRemoteAccount, writeRemoteAccount, type RemoteAccount } from './remote-account.js'
import { personalFolder, readPersonalFolder, sendPersonalFolderAs, stopSyncingPersonalFolder, syncPersonalFolder } from './personal-folder.js'
import {
  listProjectDir,
  openProjectReader,
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
const git: GitRunner = async (args, cwd) => (args.join(' ') === 'remote get-url origin' && !cwd.includes('/personal') && (await real(['remote'], cwd)).includes('origin') ? 'https://example.com/acme/shop.git\n' : real(args, cwd))
/** One of OpenAgent's accounts at the made-up host: no settings, as the bare origin asks no login. */
const ACCOUNT: RemoteAccount = { login: 'octo', host: 'example.com', config: [] }
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
    await writeRemoteAccount(repo, ACCOUNT, git)
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
    assert.deepEqual(await shareProjectData(repo, true, ACCOUNT, { folder, git }), { ok: true })
    assert.equal(await readSharing(repo, git), true)
    assert.equal((await git(['show', 'agent-data:notes/a.md'], bare)).trim(), 'kept')
    assert.equal(await there(personal), false, 'never in two places')
    assert.equal(await readProjectFile(repo, 'notes/a.md', {}, { folder, git }), 'kept\n')

    await withProjectData(repo, 'another', async dir => writeFile(join(dir, 'notes', 'b.md'), 'b\n'), { folder, git })
    assert.deepEqual(await readRemoteAccount(repo, git), ACCOUNT, 'sent as the account named at the switch')
    assert.deepEqual(await shareProjectData(repo, false, undefined, { folder, git }), { ok: true })
    assert.equal(await readSharing(repo, git), false)
    assert.equal(await readRemoteAccount(repo, git), undefined, 'the account goes with the switch')
    assert.equal(await readFile(join(personal, 'notes', 'a.md'), 'utf8'), 'kept\n')
    assert.equal(await readFile(join(personal, 'notes', 'b.md'), 'utf8'), 'b\n')
    assert.deepEqual(await readdir(join(repo, '.branches', 'agent-data')), ['.git'])
    assert.equal((await git(['show', 'agent-data:notes/b.md'], bare)).trim(), 'b', 'nothing pushed on the way off')

    // On again: the records go back, the remote's copy and the move both kept.
    assert.deepEqual(await shareProjectData(repo, true, ACCOUNT, { folder, git }), { ok: true })
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
    const shared = await shareProjectData(repo, true, ACCOUNT, { folder, git })
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

/** An empty repository for the personal folder to sync with, as a person makes one on a host. */
async function remoteRepo(): Promise<{ bare: string; cleanup: () => Promise<void> }> {
  const bare = await realpath(await mkdtemp(join(tmpdir(), 'personal-remote-')))
  await real(['init', '-q', '--bare', '-b', 'main', bare], bare)
  return { bare, cleanup: () => rm(bare, RETRIED_RM) }
}

test('a personal folder synced with a repository sends every record there, and a second machine synced with it has both machines\' records', async () => {
  const laptop = await setup()
  const server = await setup()
  const { bare, cleanup } = await remoteRepo()
  try {
    await withProjectData(laptop.repo, 'a note', writeNote('from the laptop\n'), { folder: laptop.folder, git })
    assert.deepEqual(await syncPersonalFolder(bare, undefined, { folder: laptop.folder, git }), { ok: true })
    assert.equal((await real(['show', 'main:projects/example.com/acme/shop/notes/a.md'], bare)).trim(), 'from the laptop')

    // The server had records of its own before it synced: both stay.
    await withProjectData(server.repo, 'another', async dir => {
      await mkdir(join(dir, 'notes'), { recursive: true })
      await writeFile(join(dir, 'notes', 'b.md'), 'from the server\n')
    }, { folder: server.folder, git })
    assert.deepEqual(await syncPersonalFolder(bare, undefined, { folder: server.folder, git }), { ok: true })
    assert.equal(await readProjectFile(server.repo, 'notes/a.md', {}, { folder: server.folder, git }), 'from the laptop\n')
    assert.equal(await readProjectFile(server.repo, 'notes/b.md', {}, { folder: server.folder, git }), 'from the server\n')

    // Each write sends; the laptop's next pull takes the server's in.
    assert.deepEqual(await withProjectData(server.repo, 'a third', async dir => writeFile(join(dir, 'notes', 'c.md'), 'c\n'), { folder: server.folder, git }), { ok: true, changed: true, pushed: true })
    assert.deepEqual(await pullProjectData(laptop.repo, { folder: laptop.folder, git }), { ok: true, reach: 'kept' })
    assert.equal(await readProjectFile(laptop.repo, 'notes/c.md', {}, { folder: laptop.folder, git }), 'c\n')
    assert.deepEqual(await readPersonalFolder({ folder: laptop.folder, git }), { path: laptop.folder, remote: bare, unsent: 0 })
  } finally {
    await laptop.cleanup()
    await server.cleanup()
    await cleanup()
  }
})

test('a line both machines changed: the remote\'s wins, and neither machine\'s other records are lost', async () => {
  const laptop = await setup()
  const server = await setup()
  const { bare, cleanup } = await remoteRepo()
  const queue = (text: string) => async (dir: string) => {
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'TODO_AGENTS.md'), text)
  }
  try {
    assert.deepEqual(await syncPersonalFolder(bare, undefined, { folder: laptop.folder, git }), { ok: true })
    assert.deepEqual(await syncPersonalFolder(bare, undefined, { folder: server.folder, git }), { ok: true })
    await withProjectData(laptop.repo, 'laptop queue', queue('- [ ] laptop\n'), { folder: laptop.folder, git })
    // The server writes offline, then comes back: its commit is merged with the laptop's, not dropped.
    await real(['remote', 'set-url', 'origin', '/nowhere'], server.folder)
    const offline = await withProjectData(server.repo, 'server queue', queue('- [ ] server\n'), { folder: server.folder, git })
    assert.equal(offline.ok, false)
    await withProjectData(server.repo, 'server note', writeNote('server\n'), { folder: server.folder, git })
    await real(['remote', 'set-url', 'origin', bare], server.folder)
    assert.deepEqual(await pullProjectData(server.repo, { folder: server.folder, git }), { ok: true, reach: 'kept' })
    assert.equal(await readProjectFile(server.repo, 'TODO_AGENTS.md', {}, { folder: server.folder, git }), '- [ ] laptop\n')
    assert.equal(await readProjectFile(server.repo, 'notes/a.md', {}, { folder: server.folder, git }), 'server\n')
    assert.equal((await readPersonalFolder({ folder: server.folder, git })).unsent, 0)
  } finally {
    await laptop.cleanup()
    await server.cleanup()
    await cleanup()
  }
})

test('a repository that cannot be reached is said, and the folder keeps no remote; stopping the sync keeps every record', async () => {
  const { repo, folder, cleanup } = await setup()
  const remote = await remoteRepo()
  try {
    await withProjectData(repo, 'a note', writeNote('kept\n'), { folder, git })
    const refused = await syncPersonalFolder(join(folder, 'nowhere.git'), undefined, { folder, git })
    // git's own reason, not the last of the lines git adds after it ("…and the repository exists.").
    assert.match((refused as { error: string }).error, /^the repository could not be reached: '.+nowhere\.git' does not appear to be a git repository$/)
    assert.equal((await readPersonalFolder({ folder, git })).remote, undefined)
    assert.deepEqual(await syncPersonalFolder('--upload-pack=touch /tmp/x', undefined, { folder, git }), { ok: false, error: 'no repository address given' })

    assert.deepEqual(await syncPersonalFolder(remote.bare, undefined, { folder, git }), { ok: true })
    await writeRemoteAccount(folder, ACCOUNT, git)
    assert.equal((await readPersonalFolder({ folder, git })).account, 'octo')
    assert.deepEqual(await stopSyncingPersonalFolder({ folder, git }), { ok: true })
    assert.equal((await readPersonalFolder({ folder, git })).remote, undefined)
    assert.equal((await readPersonalFolder({ folder, git })).account, undefined, 'the account goes with the sync')
    assert.deepEqual(await withProjectData(repo, 'after', async dir => writeFile(join(dir, 'notes', 'b.md'), 'b\n'), { folder, git }), { ok: true, changed: true, pushed: false })
    assert.equal(await readProjectFile(repo, 'notes/a.md', {}, { folder, git }), 'kept\n')
  } finally {
    await cleanup()
    await remote.cleanup()
  }
})

test('a personal folder on a repository at a host is sent only as an account of OpenAgent\'s: with none, the commit stays here and the reason is said', async () => {
  const { repo, folder, cleanup } = await setup()
  const remote = await remoteRepo()
  // The folder's origin reads as one on a host, as a repository a person made there does.
  const hosted: GitRunner = async (args, cwd) => {
    const said = await git(args, cwd)
    return args.join(' ') === 'remote get-url origin' && cwd === folder ? 'https://example.com/me/agent.git\n' : said
  }
  try {
    const refused = await syncPersonalFolder(remote.bare, undefined, { folder, git: hosted })
    assert.equal(refused.ok, false)
    assert.match((refused as { error: string }).error, /OpenAgent sends nothing to example\.com as your own login/)
    assert.equal((await readPersonalFolder({ folder, git })).remote, undefined, 'left as it was')

    assert.deepEqual(await syncPersonalFolder(remote.bare, ACCOUNT, { folder, git: hosted }), { ok: true })
    assert.equal((await readPersonalFolder({ folder, git })).account, 'octo')
    assert.deepEqual(await withProjectData(repo, 'a note', writeNote('sent\n'), { folder, git: hosted }), { ok: true, changed: true, pushed: true })
    assert.equal((await real(['show', 'main:projects/example.com/acme/shop/notes/a.md'], remote.bare)).trim(), 'sent')

    // The account forgotten (a new computer, an update): a change is made all the same, and waits here.
    await clearRemoteAccount(folder, git)
    assert.deepEqual(await withProjectData(repo, 'a later note', writeNote('waits\n'), { folder, git: hosted }), { ok: true, changed: true, pushed: false })
    assert.equal((await readPersonalFolder({ folder, git })).unsent, 1)
    assert.equal((await real(['show', 'main:projects/example.com/acme/shop/notes/a.md'], remote.bare)).trim(), 'sent')
    // An account named: what waited goes at once.
    assert.deepEqual(await sendPersonalFolderAs(ACCOUNT, { folder, git: hosted }), { ok: true })
    assert.equal((await readPersonalFolder({ folder, git })).unsent, 0)
    assert.equal((await real(['show', 'main:projects/example.com/acme/shop/notes/a.md'], remote.bare)).trim(), 'waits')

    // A repository that refuses: the folder is sent as it was, and git's reason is said plainly.
    await real(['remote', 'set-url', 'origin', join(folder, 'nowhere.git')], folder)
    await withProjectData(repo, 'one more', writeNote('more\n'), { folder, git: hosted })
    const unsent = await sendPersonalFolderAs({ login: 'other', host: 'example.com', config: [] }, { folder, git: hosted })
    assert.equal(unsent.ok, false)
    assert.doesNotMatch((unsent as { error: string }).error, /Command failed|push -q/)
    assert.equal((await readPersonalFolder({ folder, git })).account, 'octo', 'left as it was')
    await clearRemoteAccount(folder, git)
    assert.equal((await sendPersonalFolderAs(ACCOUNT, { folder, git: hosted })).ok, false)
    assert.equal((await readPersonalFolder({ folder, git })).account, undefined, 'none named, as before')
  } finally {
    await cleanup()
    await remote.cleanup()
  }
})
