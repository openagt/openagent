import { strict as assert } from 'node:assert'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { nodeGitRunner, readRemoteAccount, type RemoteAccount } from '@openagt/git-branches'
import type { GitRunner } from '@openagt/hooks'
import { readProjectFile, readSharing, withProjectData } from '@openagt/store-filesystem'
import { shareProjectData } from './share.js'

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
